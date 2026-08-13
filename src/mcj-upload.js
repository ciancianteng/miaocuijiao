/**
 * MCJ shared upload — PC + mobile same wiring.
 * Overlay file-input (opacity:0, never display:none) so clicks always open the OS picker.
 * Used by companion-apply + companion-workbench.
 */
(function (global) {
  "use strict";

  var IMAGE_ACCEPT = "image/*,image/jpeg,image/jpg,image/png,image/webp";
  var AUDIO_ACCEPT =
    "audio/mpeg,audio/mp3,audio/mp4,audio/aac,audio/x-m4a,audio/webm,audio/ogg,audio/wav,audio/wave,audio/x-wav,.mp3,.m4a,.aac,.webm,.ogg,.wav";
  var VIDEO_ACCEPT =
    "video/mp4,video/quicktime,video/webm,video/x-m4v,video/3gpp,video/*,.mp4,.mov,.m4v,.webm,.3gp";
  var MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  var MAX_AUDIO_BYTES = 20 * 1024 * 1024;
  var MAX_VIDEO_BYTES = 40 * 1024 * 1024;
  var MAX_VIDEO_SECONDS = 30;
  var IMAGE_MIME = { "image/jpeg": 1, "image/jpg": 1, "image/png": 1, "image/webp": 1 };
  var AUDIO_MIME = {
    "audio/mpeg": 1,
    "audio/mp3": 1,
    "audio/mp4": 1,
    "audio/aac": 1,
    "audio/x-m4a": 1,
    "audio/webm": 1,
    "audio/ogg": 1,
    "audio/wav": 1,
    "audio/wave": 1,
    "audio/x-wav": 1,
  };
  var VIDEO_MIME = {
    "video/mp4": 1,
    "video/quicktime": 1,
    "video/webm": 1,
    "video/x-m4v": 1,
    "video/3gpp": 1,
    "video/3gpp2": 1,
    "video/hevc": 1,
    "video/h265": 1,
    "application/octet-stream": 1,
  };

  function stripMimeParams(mime) {
    return String(mime || "")
      .toLowerCase()
      .split(";")[0]
      .trim();
  }

  function normalizeVideoMime(rawMime, filename) {
    var mime = stripMimeParams(rawMime);
    var name = String(filename || "").toLowerCase();
    var ext = extFromName(name, "");
    if (!mime || mime === "application/octet-stream") {
      if (ext === "mov" || ext === "qt") return "video/quicktime";
      if (ext === "webm") return "video/webm";
      if (ext === "m4v") return "video/x-m4v";
      if (ext === "3gp" || ext === "3gpp") return "video/3gpp";
      if (ext === "mp4") return "video/mp4";
      return "video/mp4";
    }
    if (mime === "video/hevc" || mime === "video/h265" || mime === "video/x-quicktime") {
      return ext === "mov" || ext === "qt" ? "video/quicktime" : "video/mp4";
    }
    return mime;
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isHttpUrl(v) {
    return /^https?:\/\//i.test(String(v || "").trim());
  }

  function isDataUrl(v) {
    return /^data:/i.test(String(v || "").trim());
  }

  function isBlobUrl(v) {
    return /^(blob:|filesystem:|file:)/i.test(String(v || "").trim());
  }

  /** Durable preview/storage value (http URL or storage object path). */
  function isDurableAsset(v) {
    var s = String(v || "").trim();
    if (!s || isDataUrl(s) || isBlobUrl(s)) return false;
    if (isHttpUrl(s)) return true;
    if (/^storage:\/\//i.test(s)) return true;
    // storage object path like "uuid/avatar/xxx.jpg"
    if (/^[a-z0-9_./-]+$/i.test(s) && s.indexOf("/") >= 0) return true;
    return false;
  }

  function normalizeAsset(value) {
    if (!value) return { url: "", path: "", id: "", status: "" };
    if (typeof value === "string") {
      return {
        url: isHttpUrl(value) || isDataUrl(value) ? value : "",
        path: !isHttpUrl(value) && !isDataUrl(value) && !isBlobUrl(value) ? value : "",
        id: "",
        status: value ? "ok" : "",
      };
    }
    return {
      url: String(value.url || value.preview || "").trim(),
      path: String(value.path || value.storagePath || "").trim(),
      id: String(value.id || value.mediaId || "").trim(),
      status: String(value.status || (value.url || value.path ? "ok" : "")).trim(),
      error: String(value.error || "").trim(),
    };
  }

  function previewSrc(asset) {
    var a = normalizeAsset(asset);
    return a.url || (isHttpUrl(a.path) ? a.path : "");
  }

  function hasAsset(asset) {
    var a = normalizeAsset(asset);
    if (a.status === "error" || a.status === "uploading") return false;
    return !!(a.url || a.path) && (isDurableAsset(a.url) || isDurableAsset(a.path) || isDataUrl(a.url));
  }

  function hasDurableAsset(asset) {
    var a = normalizeAsset(asset);
    return isDurableAsset(a.url) || isDurableAsset(a.path);
  }

  function extFromName(name, fallback) {
    var m = String(name || "").match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : fallback || "";
  }

  function validateFile(file, kind) {
    kind = kind || "image";
    if (!file) return { ok: false, error: "请选择文件" };
    var mime = String(file.type || "").toLowerCase();
    var name = String(file.name || "").toLowerCase();
    var ext = extFromName(name, "");
    if (kind === "audio" || kind === "voice") {
      var audioOk =
        AUDIO_MIME[mime] ||
        !mime ||
        /\.(mp3|m4a|aac|webm|ogg|wav)$/i.test(name) ||
        ext === "mp3" ||
        ext === "m4a" ||
        ext === "aac" ||
        ext === "webm" ||
        ext === "wav";
      if (!audioOk) return { ok: false, error: "仅支持 mp3 / m4a / aac / wav 语音" };
      if (file.size > MAX_AUDIO_BYTES) return { ok: false, error: "语音不能超过 20MB" };
      return { ok: true };
    }
    if (kind === "video") {
      var mimeBase = stripMimeParams(mime);
      var videoOk =
        VIDEO_MIME[mimeBase] ||
        /^video\//.test(mimeBase) ||
        !mimeBase ||
        /\.(mp4|mov|m4v|webm|3gp|3gpp|qt)$/i.test(name) ||
        ext === "mp4" ||
        ext === "mov" ||
        ext === "m4v" ||
        ext === "webm" ||
        ext === "3gp" ||
        ext === "3gpp" ||
        ext === "qt";
      if (!videoOk) {
        return { ok: false, code: "video_format", error: "格式错误：仅支持 mp4 / mov（H.264 或 HEVC）" };
      }
      if (file.size > MAX_VIDEO_BYTES) {
        return {
          ok: false,
          code: "video_too_large",
          error: "文件太大：视频不能超过 40MB（当前约 " + (file.size / (1024 * 1024)).toFixed(1) + "MB）",
        };
      }
      return {
        ok: true,
        maxSeconds: MAX_VIDEO_SECONDS,
        contentType: normalizeVideoMime(mime, name),
      };
    }
    var imageOk =
      IMAGE_MIME[mime] ||
      mime === "image/jpg" ||
      !mime ||
      mime === "application/octet-stream" ||
      /\.(jpe?g|png|webp)$/i.test(name) ||
      ext === "jpg" ||
      ext === "jpeg" ||
      ext === "png" ||
      ext === "webp";
    if (!imageOk) return { ok: false, error: "仅支持 jpg / png / webp 图片" };
    if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "单张图片不能超过 10MB" };
    return { ok: true };
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error("请选择文件"));
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("读取文件失败，请重试"));
      };
      reader.readAsDataURL(file);
    });
  }

  /** Probe duration for apply-page video; clear too-long errors for iPhone MOV/MP4. */
  function probeVideoDuration(file, opts) {
    opts = opts || {};
    var maxSeconds = Number(opts.maxSeconds) || MAX_VIDEO_SECONDS;
    return new Promise(function (resolve, reject) {
      if (!file) return reject(Object.assign(new Error("请选择视频文件"), { code: "video_format" }));
      var url = "";
      try {
        url = URL.createObjectURL(file);
      } catch (e) {
        resolve({ ok: true, seconds: null, contentType: normalizeVideoMime(file.type, file.name) });
        return;
      }
      var vid = document.createElement("video");
      vid.preload = "metadata";
      vid.muted = true;
      vid.playsInline = true;
      var settled = false;
      function cleanup() {
        try {
          URL.revokeObjectURL(url);
        } catch (e2) {}
      }
      function done(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(result);
      }
      function fail(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(err);
      }
      var timer = setTimeout(function () {
        // Metadata stall — still allow upload (HEVC edge cases); duration checked server-side when known.
        done({
          ok: true,
          seconds: null,
          contentType: normalizeVideoMime(file.type, file.name),
          warning: "无法读取视频时长，请确保不超过 " + maxSeconds + " 秒",
        });
      }, 10000);
      vid.onloadedmetadata = function () {
        var dur = Number(vid.duration);
        if (!isFinite(dur) || dur <= 0) {
          done({ ok: true, seconds: null, contentType: normalizeVideoMime(file.type, file.name) });
          return;
        }
        if (dur > maxSeconds + 0.5) {
          fail(
            Object.assign(
              new Error("视频太长：最长 " + maxSeconds + " 秒（当前约 " + Math.round(dur) + " 秒）"),
              { code: "video_too_long", seconds: dur }
            )
          );
          return;
        }
        done({ ok: true, seconds: dur, contentType: normalizeVideoMime(file.type, file.name) });
      };
      vid.onerror = function () {
        // Desktop browsers may fail HEVC decode; iPhone Safari usually succeeds.
        done({
          ok: true,
          seconds: null,
          contentType: normalizeVideoMime(file.type, file.name),
          warning: "浏览器无法预览该编码，仍将尝试上传（请使用 H.264/HEVC 的 mp4/mov）",
        });
      };
      vid.src = url;
    });
  }

  /** Compress phone photos before JSON upload — keeps API body small; never for permanent localStorage. */
  function compressImageFile(file, opts) {
    opts = opts || {};
    var maxEdge = Number(opts.maxEdge) || 1600;
    var quality = Number(opts.quality) || 0.82;
    return readAsDataUrl(file).then(function (raw) {
      if (!/^data:image\//i.test(raw)) return raw;
      if (file && file.size <= 700 * 1024 && raw.length < 900 * 1024) return raw;
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width || 0;
            var h = img.naturalHeight || img.height || 0;
            if (!w || !h) return resolve(raw);
            var scale = Math.min(1, maxEdge / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * scale));
            var ch = Math.max(1, Math.round(h * scale));
            var canvas = document.createElement("canvas");
            canvas.width = cw;
            canvas.height = ch;
            var ctx = canvas.getContext("2d");
            if (!ctx) return resolve(raw);
            ctx.drawImage(img, 0, 0, cw, ch);
            var q = quality;
            var out = canvas.toDataURL("image/jpeg", q);
            while (out.length > 1.5 * 1024 * 1024 && q > 0.5) {
              q -= 0.08;
              out = canvas.toDataURL("image/jpeg", q);
            }
            resolve(out || raw);
          } catch (err) {
            resolve(raw);
          }
        };
        img.onerror = function () {
          reject(new Error("图片预览失败，请改用 JPG 或 PNG"));
        };
        img.src = raw;
      });
    });
  }

  /**
   * @param {object} opts
   * @param {string} opts.key - field key (avatar, cover, photos, voiceFile, idFront, …)
   * @param {string} opts.label
   * @param {string} [opts.kind] image|audio
   * @param {string} [opts.accept]
   * @param {boolean} [opts.capture] if true, add capture=environment (forces camera). Default false — show system picker (相册/拍照/文件).
   * @param {boolean} [opts.multiple]
   * @param {object|string} [opts.value] current asset
   * @param {string} [opts.status] idle|uploading|ok|error
   * @param {string} [opts.error]
   * @param {string} [opts.hint]
   * @param {boolean} [opts.busy]
   */
  function renderCard(opts) {
    opts = opts || {};
    var key = String(opts.key || "file");
    var label = String(opts.label || "上传");
    var kind =
      opts.kind === "audio" || opts.kind === "voice"
        ? "audio"
        : opts.kind === "video"
          ? "video"
          : "image";
    var accept =
      opts.accept ||
      (kind === "audio" ? AUDIO_ACCEPT : kind === "video" ? VIDEO_ACCEPT : IMAGE_ACCEPT);
    // Never force camera by default. Only add capture when caller explicitly opts in.
    var captureAttr = opts.capture === true && kind === "image" ? ' capture="environment"' : "";
    var multipleAttr = opts.multiple ? " multiple" : "";
    var multipleData = opts.multiple ? ' data-mcj-multiple="1"' : "";
    var acceptData = ' data-mcj-accept="' + esc(accept) + '"';
    var asset = normalizeAsset(opts.value);
    var status = String(opts.status || asset.status || "").trim();
    var error = String(opts.error || asset.error || "").trim();
    var busy = !!opts.busy || status === "uploading";
    var preview = previewSrc(asset);
    var hasPreview = !!preview && status !== "error";
    var isAudio = kind === "audio";
    var isVideo = kind === "video";
    var stateClass =
      status === "uploading"
        ? "is-uploading"
        : status === "error"
          ? "is-error"
          : hasPreview
            ? "has-preview is-ok"
            : "";
    var stateText =
      status === "uploading"
        ? "上传中…"
        : status === "error"
          ? "上传失败"
          : hasPreview
            ? "上传成功"
            : "";
    var tip =
      opts.hint ||
      (kind === "audio"
        ? "支持 mp3 / m4a / aac / wav；点击选择文件"
        : kind === "video"
          ? "支持 mp4 / mov，最长约 30 秒"
          : "支持 jpg / png / webp；点击选择相册或拍照");

    var inputHtml =
      '<input type="file" class="mcj-upload-input" data-mcj-upload-input="' +
      esc(key) +
      '" accept="' +
      esc(accept) +
      '"' +
      captureAttr +
      multipleAttr +
      (busy ? " disabled" : "") +
      ">";

    var body;
    if (status === "error") {
      body =
        '<div class="mcj-upload-drop is-error" data-mcj-drop="' +
        esc(key) +
        '">' +
        inputHtml +
        '<span class="mcj-upload-plus">！</span>' +
        "<strong>上传失败</strong>" +
        "<small>" +
        esc(error || "请点击重新上传") +
        "</small>" +
        '<span class="mcj-upload-retry">重新上传</span>' +
        "</div>";
    } else if (hasPreview && isAudio) {
      body =
        '<div class="mcj-upload-preview-wrap" data-mcj-drop="' +
        esc(key) +
        '">' +
        '<audio class="mcj-upload-audio" controls preload="metadata" src="' +
        esc(preview) +
        '"></audio>' +
        '<div class="mcj-upload-actions">' +
        '<label class="mcj-upload-btn' +
        (busy ? " is-busy" : "") +
        '">' +
        (busy ? "上传中…" : "重新上传") +
        inputHtml +
        "</label>" +
        '<button type="button" class="mcj-upload-btn danger" data-mcj-clear="' +
        esc(key) +
        '"' +
        (busy ? " disabled" : "") +
        ">删除</button>" +
        "</div></div>";
    } else if (hasPreview && isVideo) {
      body =
        '<div class="mcj-upload-preview-wrap" data-mcj-drop="' +
        esc(key) +
        '">' +
        '<video class="mcj-upload-video" controls preload="metadata" src="' +
        esc(preview) +
        '" playsinline></video>' +
        (stateText
          ? '<span class="mcj-upload-badge">' + esc(busy ? "上传中…" : stateText) + "</span>"
          : "") +
        '<div class="mcj-upload-actions">' +
        '<label class="mcj-upload-btn' +
        (busy ? " is-busy" : "") +
        '">' +
        (busy ? "上传中…" : "重新上传") +
        inputHtml +
        "</label>" +
        '<button type="button" class="mcj-upload-btn danger" data-mcj-clear="' +
        esc(key) +
        '"' +
        (busy ? " disabled" : "") +
        ">删除</button>" +
        "</div></div>";
    } else if (hasPreview) {
      body =
        '<div class="mcj-upload-preview-wrap" data-mcj-drop="' +
        esc(key) +
        '">' +
        '<img class="mcj-upload-preview" src="' +
        esc(preview) +
        '" alt="' +
        esc(label) +
        '">' +
        (stateText
          ? '<span class="mcj-upload-badge">' + esc(busy ? "上传中…" : stateText) + "</span>"
          : "") +
        '<button type="button" class="mcj-upload-remove" data-mcj-clear="' +
        esc(key) +
        '" aria-label="删除"' +
        (busy ? " disabled" : "") +
        ">×</button>" +
        '<label class="mcj-upload-reopen' +
        (busy ? " is-busy" : "") +
        '">' +
        (busy ? "上传中…" : "重新上传") +
        inputHtml +
        "</label>" +
        "</div>";
    } else {
      body =
        '<div class="mcj-upload-drop' +
        (busy ? " is-busy" : "") +
        '" data-mcj-drop="' +
        esc(key) +
        '">' +
        inputHtml +
        '<span class="mcj-upload-plus">＋</span>' +
        "<strong>" +
        esc(busy ? "上传中…" : label) +
        "</strong>" +
        "<small>" +
        esc(tip) +
        "</small>" +
        "</div>";
    }

    return (
      '<div class="mcj-upload form-field ' +
      stateClass +
      '" data-mcj-upload="' +
      esc(key) +
      '" data-mcj-kind="' +
      esc(kind) +
      '"' +
      acceptData +
      multipleData +
      ">" +
      '<span class="mcj-upload-label">' +
      esc(label) +
      "</span>" +
      body +
      (status === "uploading"
        ? '<div class="mcj-upload-progress" aria-hidden="true"><i></i></div>'
        : "") +
      "</div>"
    );
  }

  function isTouchUploadDevice() {
    try {
      return (
        (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
        (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
        /Android|iPhone|iPad|iPod/i.test(String(navigator.userAgent || ""))
      );
    } catch (e) {
      return false;
    }
  }

  function closeSourceSheet() {
    var sheet = document.querySelector("[data-mcj-source-sheet]");
    if (sheet) sheet.remove();
  }

  /**
   * Mobile: show 相册 / 拍照 sheet instead of jumping straight into camera.
   */
  function openSourceSheet(host, onChosen) {
    closeSourceSheet();
    var kind = (host && host.getAttribute("data-mcj-kind")) || "image";
    if (kind === "audio") {
      onChosen({ capture: false });
      return;
    }
    var el = document.createElement("div");
    el.className = "mcj-source-sheet";
    el.setAttribute("data-mcj-source-sheet", "1");
    el.innerHTML =
      '<div class="mcj-source-sheet-panel" role="dialog" aria-label="选择上传方式">' +
      "<strong>选择上传方式</strong>" +
      '<button type="button" data-mcj-source="album">从相册选择</button>' +
      '<button type="button" data-mcj-source="camera">拍照</button>' +
      '<button type="button" class="mcj-source-cancel" data-mcj-source="cancel">取消</button>' +
      "</div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-mcj-source]");
      if (!btn && ev.target !== el) return;
      var mode = btn ? btn.getAttribute("data-mcj-source") : "cancel";
      closeSourceSheet();
      if (mode === "album") onChosen({ capture: false });
      else if (mode === "camera") onChosen({ capture: true });
    });
  }

  function triggerHiddenFilePick(host, opts) {
    opts = opts || {};
    if (!host) return;
    var accept =
      host.getAttribute("data-mcj-accept") ||
      (host.getAttribute("data-mcj-kind") === "audio"
        ? AUDIO_ACCEPT
        : host.getAttribute("data-mcj-kind") === "video"
          ? VIDEO_ACCEPT
          : IMAGE_ACCEPT);
    var multiple = host.getAttribute("data-mcj-multiple") === "1";
    var input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (multiple) input.multiple = true;
    if (opts.capture === true) input.setAttribute("capture", "environment");
    input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px;";
    document.body.appendChild(input);
    input.addEventListener("change", function () {
      var key = host.getAttribute("data-mcj-upload") || "";
      var kind = host.getAttribute("data-mcj-kind") || "image";
      var files = input.files ? Array.prototype.slice.call(input.files) : [];
      try {
        input.remove();
      } catch (e) {}
      if (!files.length) return;
      var root = host.closest("[data-mcj-upload-root]") || host.parentElement;
      // Handled via custom event so bind()'s onPick receives it.
      host.dispatchEvent(
        new CustomEvent("mcj-upload-picked", {
          bubbles: true,
          detail: { key: key, files: files, kind: kind },
        })
      );
    });
    input.click();
  }

  /**
   * Bind click/change/drag-drop once on a root. Calls handlers.onPick({key, files, kind, input}).
   */
  function bind(root, handlers) {
    handlers = handlers || {};
    if (!root || root.__mcjUploadBound) return;
    root.__mcjUploadBound = true;
    root.setAttribute("data-mcj-upload-root", "1");

    function pickFromInput(input) {
      if (!input || !input.files || !input.files.length) return;
      var key = input.getAttribute("data-mcj-upload-input") || "";
      var host = input.closest("[data-mcj-upload]");
      var kind = (host && host.getAttribute("data-mcj-kind")) || "image";
      var files = Array.prototype.slice.call(input.files);
      if (typeof handlers.onPick === "function") {
        handlers.onPick({ key: key, files: files, kind: kind, input: input });
      }
      try {
        input.value = "";
      } catch (e) {}
    }

    root.addEventListener(
      "click",
      function (e) {
        var clearBtn = e.target.closest("[data-mcj-clear]");
        if (clearBtn && root.contains(clearBtn)) {
          e.preventDefault();
          e.stopPropagation();
          var clearKey = clearBtn.getAttribute("data-mcj-clear") || "";
          if (typeof handlers.onClear === "function") handlers.onClear({ key: clearKey });
          return;
        }

        // Mobile image upload: intercept and show 相册 / 拍照 sheet.
        var host = e.target.closest("[data-mcj-upload]");
        if (!host || !root.contains(host)) return;
        if (host.getAttribute("data-mcj-kind") === "audio") return;
        if (!isTouchUploadDevice()) return;
        var fileInput = e.target.closest("[data-mcj-upload-input]") || host.querySelector("[data-mcj-upload-input]");
        if (!fileInput) return;
        // Only intercept primary empty/reupload taps.
        if (e.target.closest("[data-mcj-clear]")) return;
        e.preventDefault();
        e.stopPropagation();
        openSourceSheet(host, function (choice) {
          triggerHiddenFilePick(host, choice);
        });
      },
      true
    );

    root.addEventListener("mcj-upload-picked", function (e) {
      var detail = e.detail || {};
      if (!detail.files || !detail.files.length) return;
      if (typeof handlers.onPick === "function") {
        handlers.onPick({
          key: detail.key,
          files: detail.files,
          kind: detail.kind || "image",
          input: null,
        });
      }
    });

    root.addEventListener("change", function (e) {
      var input = e.target.closest("[data-mcj-upload-input]");
      if (!input || !root.contains(input)) return;
      pickFromInput(input);
    });

    root.addEventListener("dragover", function (e) {
      var drop = e.target.closest("[data-mcj-drop]");
      if (!drop || !root.contains(drop)) return;
      e.preventDefault();
      drop.classList.add("is-dragover");
    });

    root.addEventListener("dragleave", function (e) {
      var drop = e.target.closest("[data-mcj-drop]");
      if (!drop || !root.contains(drop)) return;
      drop.classList.remove("is-dragover");
    });

    root.addEventListener("drop", function (e) {
      var drop = e.target.closest("[data-mcj-drop]");
      if (!drop || !root.contains(drop)) return;
      e.preventDefault();
      drop.classList.remove("is-dragover");
      var host = drop.closest("[data-mcj-upload]");
      var key = (host && host.getAttribute("data-mcj-upload")) || "";
      var kind = (host && host.getAttribute("data-mcj-kind")) || "image";
      var files = e.dataTransfer && e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
      if (!files.length) return;
      if (typeof handlers.onPick === "function") {
        handlers.onPick({ key: key, files: files, kind: kind, input: null });
      }
    });
  }

  global.MCJUpload = {
    IMAGE_ACCEPT: IMAGE_ACCEPT,
    AUDIO_ACCEPT: AUDIO_ACCEPT,
    VIDEO_ACCEPT: VIDEO_ACCEPT,
    MAX_VIDEO_BYTES: MAX_VIDEO_BYTES,
    MAX_VIDEO_SECONDS: MAX_VIDEO_SECONDS,
    esc: esc,
    isHttpUrl: isHttpUrl,
    isDataUrl: isDataUrl,
    isDurableAsset: isDurableAsset,
    normalizeAsset: normalizeAsset,
    previewSrc: previewSrc,
    hasAsset: hasAsset,
    hasDurableAsset: hasDurableAsset,
    validateFile: validateFile,
    normalizeVideoMime: normalizeVideoMime,
    probeVideoDuration: probeVideoDuration,
    readAsDataUrl: readAsDataUrl,
    compressImageFile: compressImageFile,
    renderCard: renderCard,
    bind: bind,
    openSourceSheet: openSourceSheet,
    closeSourceSheet: closeSourceSheet,
    isTouchLike: isTouchUploadDevice,
  };
})(typeof window !== "undefined" ? window : globalThis);
