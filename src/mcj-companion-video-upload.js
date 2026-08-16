/**
 * Direct companion showcase-video upload to Supabase Storage.
 * Never posts the binary through Vercel (/api/companion body).
 *
 * Flow:
 *  1) prepare_video_upload → signed URL + (optional) TUS endpoint
 *  2) Browser → Supabase (TUS when >= 6MB, else signed PUT)
 *  3) upload_media with storage_path / metadata only
 */
(function (global) {
  "use strict";

  var RESUMABLE_THRESHOLD = 6 * 1024 * 1024;
  var CHUNK_SIZE = 6 * 1024 * 1024;

  function b64(value) {
    try {
      return btoa(unescape(encodeURIComponent(String(value == null ? "" : value))));
    } catch (e) {
      return btoa(String(value == null ? "" : value));
    }
  }

  function safeErrText(value, fallback) {
    if (value == null || value === "") return fallback || "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value && typeof value.message === "string" && value.message.trim()) return value.message;
    try {
      var s = JSON.stringify(value);
      if (s && s !== "{}" && s !== "null") return s.slice(0, 240);
    } catch (e) {}
    return fallback || "上传失败";
  }

  function humanizeUploadHttpError(status, rawMsg) {
    var msg = safeErrText(rawMsg, "");
    if (status === 413 || /413|Payload Too Large|request entity too large|entity too large|body.*limit/i.test(msg)) {
      return "视频文件过大或上传通道限制，请稍后重试。";
    }
    if (/视频最长|最长 30/i.test(msg)) return "视频最长 30 秒";
    if (/50MB|不能超过/i.test(msg)) return msg;
    return msg || "视频上传失败，请稍后重试。";
  }

  function signedPutUpload(file, prep, onProgress) {
    return new Promise(function (resolve, reject) {
      var url = prep.signedUrl;
      if (!url) return reject(new Error("缺少直传地址"));
      var xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      xhr.setRequestHeader("Content-Type", file.type || prep.contentType || "video/mp4");
      xhr.setRequestHeader("x-upsert", "true");
      xhr.upload.onprogress = function (ev) {
        if (!onProgress || !ev.lengthComputable) return;
        onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (onProgress) onProgress(100);
          resolve({ method: "signed_put", path: prep.path, bucket: prep.bucket });
          return;
        }
        var detail = "";
        try {
          detail = xhr.responseText ? safeErrText(JSON.parse(xhr.responseText), xhr.responseText) : "";
        } catch (e) {
          detail = String(xhr.responseText || "").slice(0, 200);
        }
        reject(new Error(humanizeUploadHttpError(xhr.status, detail || "HTTP " + xhr.status)));
      };
      xhr.onerror = function () {
        reject(new Error("视频直传网络失败，请稍后重试。"));
      };
      xhr.send(file);
    });
  }

  function tusUpload(file, prep, accessToken, onProgress) {
    var endpoint = prep.resumableEndpoint;
    var anonKey = prep.anonKey;
    if (!endpoint || !anonKey || !accessToken) {
      return Promise.reject(new Error("缺少 TUS 直传配置"));
    }
    var contentType = file.type || prep.contentType || "video/mp4";
    var metadata =
      "bucketName " +
      b64(prep.bucket) +
      ",objectName " +
      b64(prep.path) +
      ",contentType " +
      b64(contentType) +
      ",cacheControl " +
      b64("3600");

    return fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        apikey: anonKey,
        "x-upsert": "true",
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(file.size),
        "Upload-Metadata": metadata,
      },
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          var parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch (e) {}
          var err = new Error(
            humanizeUploadHttpError(res.status, safeErrText(parsed && (parsed.message || parsed.error), text))
          );
          err.status = res.status;
          throw err;
        });
      }
      var location = res.headers.get("Location") || res.headers.get("location");
      if (!location) throw new Error("TUS 未返回上传地址");
      if (!/^https?:\/\//i.test(location)) {
        var base = String(prep.supabaseUrl || "").replace(/\/$/, "");
        location = base + (location.startsWith("/") ? location : "/" + location);
      }
      return patchTus(location, file, accessToken, anonKey, onProgress).then(function () {
        return { method: "tus", path: prep.path, bucket: prep.bucket };
      });
    });
  }

  function patchTus(location, file, accessToken, anonKey, onProgress) {
    var offset = 0;
    function next() {
      if (offset >= file.size) {
        if (onProgress) onProgress(100);
        return Promise.resolve();
      }
      var end = Math.min(file.size, offset + CHUNK_SIZE);
      var chunk = file.slice(offset, end);
      return fetch(location, {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + accessToken,
          apikey: anonKey,
          "Tus-Resumable": "1.0.0",
          "Upload-Offset": String(offset),
          "Content-Type": "application/offset+octet-stream",
          "Content-Length": String(chunk.size),
        },
        body: chunk,
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) {
            throw new Error(humanizeUploadHttpError(res.status, text));
          });
        }
        var newOffset = Number(res.headers.get("Upload-Offset") || end);
        if (!Number.isFinite(newOffset) || newOffset <= offset) newOffset = end;
        offset = newOffset;
        if (onProgress) onProgress(Math.min(99, Math.round((offset / file.size) * 100)));
        return next();
      });
    }
    return next();
  }

  /**
   * @param {object} opts
   * @param {File|Blob} opts.file
   * @param {object} opts.prep  prepare_video_upload response
   * @param {string} opts.accessToken companion Supabase JWT
   * @param {function=} opts.onProgress
   */
  function uploadCompanionVideoDirect(opts) {
    opts = opts || {};
    var file = opts.file;
    var prep = opts.prep || {};
    var token = opts.accessToken || "";
    var onProgress = opts.onProgress;
    if (!file) return Promise.reject(new Error("请选择视频文件"));
    if (!prep.path || !prep.bucket) return Promise.reject(new Error("缺少直传路径"));

    var preferTus =
      prep.preferResumable !== false &&
      file.size >= RESUMABLE_THRESHOLD &&
      prep.resumableEndpoint &&
      prep.anonKey &&
      token;

    var start = preferTus
      ? tusUpload(file, prep, token, onProgress).catch(function (err) {
          // RLS may not be applied yet on some envs — fall back to signed PUT.
          console.warn("[mcj-video] TUS failed, falling back to signed PUT", err && err.message);
          return signedPutUpload(file, prep, onProgress);
        })
      : signedPutUpload(file, prep, onProgress);

    return start.catch(function (err) {
      var msg = humanizeUploadHttpError(err && err.status, err && err.message);
      var out = new Error(msg);
      out.status = err && err.status;
      throw out;
    });
  }

  global.McjCompanionVideoUpload = {
    upload: uploadCompanionVideoDirect,
    humanizeUploadHttpError: humanizeUploadHttpError,
    safeErrText: safeErrText,
    RESUMABLE_THRESHOLD: RESUMABLE_THRESHOLD,
  };
})(typeof window !== "undefined" ? window : globalThis);
