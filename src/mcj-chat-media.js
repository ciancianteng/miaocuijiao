/**
 * Shared chat media helpers for boss / CS / companion.
 * Compress → upload → send image messages; lightbox preview.
 * Durable content: prefer storageRef (chat-images-private:path); display via signed https.
 */
(function (global) {
  "use strict";

  var MAX_BYTES = 10 * 1024 * 1024;
  var TARGET_MAX_EDGE = 1600;
  var TARGET_QUALITY = 0.82;
  var ALLOWED = /image\/(jpeg|jpg|png|webp)/i;
  var IMG_TAG = "__IMG__:";

  function toast(msg) {
    if (global.MCJNotify && typeof global.MCJNotify.toast === "function") {
      global.MCJNotify.toast(String(msg || ""));
      return;
    }
    try {
      console.log("[chat-media]", msg);
    } catch (e) {}
  }

  function stripImageTag(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    if (s.indexOf(IMG_TAG) === 0) s = s.slice(IMG_TAG.length).trim();
    // Repair legacy bug: slice(7) left a leading ":" → ":https://..."
    if (s.charAt(0) === ":" && /^:https?:\/\//i.test(s)) s = s.slice(1);
    return s.trim();
  }

  function normalizeImageUrl(raw) {
    var s = stripImageTag(raw);
    if (!s) return "";
    if (/^(blob:|data:)/i.test(s)) return "";
    if (/^chat-images-private:/i.test(s)) return s;
    if (/^conv\//i.test(s)) return "chat-images-private:" + s;
    if (!/^https?:\/\//i.test(s)) return "";
    return s;
  }

  function isHttpsUrl(s) {
    return /^https?:\/\//i.test(String(s || ""));
  }

  function isImageMessage(m) {
    if (!m) return false;
    var t = String(m.message_type || m.messageType || "").toLowerCase();
    if (t === "image") return true;
    var c = String(m.content || "");
    if (c.indexOf(IMG_TAG) === 0) return true;
    if (normalizeImageUrl(m.imageUrl || m.image_url || m.mediaUrl || m.media_url || m.storageRef)) {
      return true;
    }
    var bare = normalizeImageUrl(c);
    if (!bare) return false;
    if (/^chat-images-private:/i.test(bare) || /^conv\//i.test(c)) return true;
    if (/\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(bare)) return true;
    if (/\/storage\/v1\/object\/(?:public|sign)\/chat-images(?:-private)?\//i.test(bare)) return true;
    return false;
  }

  /**
   * Resolve a displayable https image URL for a message.
   * Prefer signed/public https fields; never return blob/data.
   */
  function imageUrlOf(m) {
    if (!m) return "";
    var fields = [m.imageUrl, m.image_url, m.mediaUrl, m.media_url, m.content];
    var i;
    for (i = 0; i < fields.length; i++) {
      var u = normalizeImageUrl(fields[i]);
      if (u && isHttpsUrl(u)) return u;
    }
    return "";
  }

  function storageRefOf(m) {
    if (!m) return "";
    var raw = m.storageRef || m.storage_ref || "";
    if (/^chat-images-private:/i.test(String(raw))) return String(raw);
    var c = normalizeImageUrl(m.content);
    if (/^chat-images-private:/i.test(c)) return c;
    return "";
  }

  /** Cache-bust only when URL has no unique path token; Storage paths already include ts+uuid. */
  function displayUrl(url, createdAt) {
    var u = normalizeImageUrl(url);
    if (!u || !isHttpsUrl(u)) return "";
    if (/[?&](v|t)=/i.test(u)) return u;
    if (/\/\d{10,}-[a-f0-9]{4,}-/i.test(u)) return u;
    var ts = createdAt ? Date.parse(createdAt) : NaN;
    if (!ts || isNaN(ts)) return u;
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "v=" + ts;
  }

  function imageBubbleHtml(url, escFn, meta) {
    var esc = escFn || function (v) {
      return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      });
    };
    meta = meta || {};
    var srcRaw = displayUrl(url, meta.createdAt || meta.created_at) || (isHttpsUrl(url) ? url : "");
    if (!srcRaw) {
      return '<span class="mcj-chat-img-missing">[图片]</span>';
    }
    var src = esc(srcRaw);
    var ref = esc(meta.storageRef || "");
    return (
      '<a class="mcj-chat-img-wrap" href="' +
      src +
      '" data-chat-image="' +
      src +
      '"' +
      (ref ? ' data-chat-storage-ref="' + ref + '"' : "") +
      (meta.conversationId ? ' data-chat-conversation="' + esc(meta.conversationId) + '"' : "") +
      ' title="点击放大">' +
      '<img class="mcj-chat-img" src="' +
      src +
      '" alt="图片" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-mcj-chat-img="1" data-mcj-img-resign />' +
      "</a>"
    );
  }

  function ensureLightbox() {
    if (document.getElementById("mcjChatLightbox")) return;
    var el = document.createElement("div");
    el.id = "mcjChatLightbox";
    el.className = "mcj-chat-lightbox";
    el.hidden = true;
    el.innerHTML =
      '<button type="button" class="mcj-chat-lightbox-close" data-lb-close aria-label="关闭">×</button>' +
      '<figure class="mcj-chat-lightbox-figure">' +
      '<img data-lb-img alt="预览" />' +
      '<figcaption data-lb-meta class="mcj-chat-lightbox-meta"></figcaption>' +
      "</figure>";
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el || e.target.closest("[data-lb-close]")) closeLightbox();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeLightbox();
    });
  }

  function openLightbox(url, meta) {
    ensureLightbox();
    var el = document.getElementById("mcjChatLightbox");
    var img = el.querySelector("[data-lb-img]");
    var cap = el.querySelector("[data-lb-meta]");
    var href = normalizeImageUrl(url) || url;
    img.src = isHttpsUrl(href) ? href : url;
    if (cap) {
      var parts = [];
      if (meta && meta.sender) parts.push(String(meta.sender));
      if (meta && meta.time) parts.push(String(meta.time));
      cap.textContent = parts.join(" · ");
      cap.hidden = !parts.length;
    }
    el.hidden = false;
    document.documentElement.classList.add("mcj-lb-open");
  }

  function closeLightbox() {
    var el = document.getElementById("mcjChatLightbox");
    if (!el) return;
    el.hidden = true;
    var img = el.querySelector("[data-lb-img]");
    if (img) img.removeAttribute("src");
    document.documentElement.classList.remove("mcj-lb-open");
  }

  function bindLightboxClicks(root) {
    ensureLightbox();
    var scope = root || document;
    if (scope.__mcjLbBound) return;
    scope.__mcjLbBound = true;
    scope.addEventListener("click", function (e) {
      var a = e.target.closest("[data-chat-image]");
      if (!a || !scope.contains(a)) return;
      e.preventDefault();
      var bubble = a.closest("[data-msg-id], .cs-msg, .support-msg, .mcj-msg");
      var sender = "";
      var time = "";
      if (bubble) {
        sender = bubble.getAttribute("data-sender-name") || "";
        time = bubble.getAttribute("data-created-at") || "";
      }
      openLightbox(a.getAttribute("data-chat-image") || a.href, { sender: sender, time: time });
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("读取图片失败"));
      };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("图片解码失败"));
      };
      img.src = dataUrl;
    });
  }

  function canvasToJpegDataUrl(canvas, quality) {
    try {
      return canvas.toDataURL("image/jpeg", quality);
    } catch (e) {
      return "";
    }
  }

  function compressFile(file) {
    if (!file || !ALLOWED.test(file.type || "")) {
      return Promise.reject(new Error("仅支持 JPG / JPEG / PNG / WEBP"));
    }
    if (file.size > MAX_BYTES) {
      return Promise.reject(new Error("单张图片不能超过 10MB"));
    }
    var filename = String(file.name || "chat.jpg");
    return readFileAsDataUrl(file).then(function (dataUrl) {
      // Small enough PNG/WebP/JPEG: skip re-encode when under ~1.2MB.
      if (file.size < 1.2 * 1024 * 1024 && /image\/(jpeg|jpg|png|webp)/i.test(file.type || "")) {
        return { dataUrl: dataUrl, filename: filename };
      }
      return loadImage(dataUrl).then(function (img) {
        var w = img.naturalWidth || img.width || 0;
        var h = img.naturalHeight || img.height || 0;
        if (!w || !h) return { dataUrl: dataUrl, filename: filename };
        var scale = Math.min(1, TARGET_MAX_EDGE / Math.max(w, h));
        var tw = Math.max(1, Math.round(w * scale));
        var th = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement("canvas");
        canvas.width = tw;
        canvas.height = th;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, tw, th);
        var out = canvasToJpegDataUrl(canvas, TARGET_QUALITY);
        if (!out || out.length < 32) return { dataUrl: dataUrl, filename: filename };
        var base = filename.replace(/\.[^.]+$/, "") || "chat";
        return { dataUrl: out, filename: base + ".jpg" };
      });
    });
  }

  function uploadDataUrl(dataUrl, filename, token, conversationId) {
    return fetch("/api/chat-media", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + String(token || ""),
      },
      body: JSON.stringify({
        action: "upload",
        data_url: dataUrl,
        filename: filename || "chat.jpg",
        conversation_id: conversationId || "",
        conversationId: conversationId || "",
      }),
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          if (!res.ok || body.ok === false || !body.url) {
            throw new Error((body && body.message) || "图片发送失败，请重试");
          }
          return body;
        });
    });
  }

  function signUrl(raw, conversationId, token) {
    return fetch("/api/chat-media", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + String(token || ""),
      },
      body: JSON.stringify({
        action: "sign",
        conversation_id: conversationId || "",
        conversationId: conversationId || "",
        url: raw,
        storageRef: raw,
      }),
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          if (!res.ok || body.ok === false || !body.url) {
            throw new Error((body && body.message) || "图片加载失败");
          }
          return body.url;
        });
    });
  }

  /**
   * Pick files (multi), compress+upload each, call onUploaded(url, meta) per file.
   * meta includes storageRef for durable message content.
   */
  function pickAndSendImages(opts) {
    opts = opts || {};
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/jpg,image/png,image/webp";
    input.multiple = !!opts.multiple;
    input.style.display = "none";
    document.body.appendChild(input);
    return new Promise(function (resolve) {
      input.addEventListener("change", function () {
        var files = Array.prototype.slice.call(input.files || []);
        input.remove();
        if (!files.length) {
          resolve([]);
          return;
        }
        var token = opts.token || "";
        if (!token) {
          toast("请先登录");
          resolve([]);
          return;
        }
        var conversationId = String(opts.conversationId || opts.conversation_id || "").trim();
        if (!conversationId) {
          toast("缺少会话，无法上传图片");
          resolve([]);
          return;
        }
        var results = [];
        var chain = Promise.resolve();
        files.forEach(function (file, idx) {
          chain = chain.then(function () {
            if (opts.onStatus) opts.onStatus("上传中… (" + (idx + 1) + "/" + files.length + ")");
            return compressFile(file)
              .then(function (packed) {
                return uploadDataUrl(packed.dataUrl, packed.filename, token, conversationId);
              })
              .then(function (up) {
                results.push(up);
                if (opts.onUploaded) return opts.onUploaded(up.url, up, file);
              })
              .then(function () {
                if (opts.onStatus) opts.onStatus("发送成功");
              })
              .catch(function (err) {
                if (opts.onStatus) opts.onStatus("发送失败");
                var msg = (err && err.message) || "图片发送失败，请重试";
                if (!/图片发送失败/.test(msg)) msg = "图片发送失败，请重试";
                if (opts.onError) opts.onError(new Error(msg), file);
                else toast(msg);
              });
          });
        });
        chain.then(function () {
          resolve(results);
        });
      });
      input.click();
    });
  }

  function injectStyles() {
    if (document.getElementById("mcj-chat-media-css")) return;
    var style = document.createElement("style");
    style.id = "mcj-chat-media-css";
    style.textContent =
      ".mcj-chat-img-wrap{display:inline-block;max-width:min(240px,70vw);border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.12)}" +
      ".mcj-chat-img{display:block;max-width:100%;max-height:280px;width:auto;height:auto;object-fit:contain;cursor:zoom-in;background:rgba(0,0,0,.2)}" +
      ".mcj-chat-img-missing{color:#9ca3af;font-size:13px}" +
      ".mcj-chat-lightbox{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:24px}" +
      ".mcj-chat-lightbox[hidden]{display:none!important}" +
      ".mcj-chat-lightbox-figure{margin:0;max-width:min(96vw,1200px);max-height:92vh;display:flex;flex-direction:column;align-items:center;gap:10px}" +
      ".mcj-chat-lightbox img{max-width:min(96vw,1200px);max-height:86vh;width:auto;height:auto;object-fit:contain;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.45)}" +
      ".mcj-chat-lightbox-meta{color:rgba(255,255,255,.82);font-size:13px;text-align:center}" +
      ".mcj-chat-lightbox-close{position:fixed;top:16px;right:16px;width:42px;height:42px;border:0;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;font-size:28px;cursor:pointer;line-height:1}" +
      "html.mcj-lb-open,html.mcj-lb-open body{overflow:hidden!important}" +
      ".mcj-composer-tools{display:flex;gap:8px;align-items:center;flex:0 0 auto}" +
      ".mcj-composer-tool{min-width:40px;height:40px;padding:0 10px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-size:13px;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap}" +
      ".mcj-composer-tool:disabled{opacity:.45;cursor:not-allowed}" +
      ".mcj-composer-tool-img{font-size:12px;letter-spacing:0}" +
      ".mcj-upload-status{font-size:12px;color:#9ca3af;min-height:16px}";
    document.head.appendChild(style);
  }

  injectStyles();

  global.MCJChatMedia = {
    MAX_BYTES: MAX_BYTES,
    IMG_TAG: IMG_TAG,
    isImageMessage: isImageMessage,
    imageUrlOf: imageUrlOf,
    storageRefOf: storageRefOf,
    normalizeImageUrl: normalizeImageUrl,
    stripImageTag: stripImageTag,
    displayUrl: displayUrl,
    imageBubbleHtml: imageBubbleHtml,
    compressFile: compressFile,
    uploadDataUrl: uploadDataUrl,
    signUrl: signUrl,
    pickAndSendImages: pickAndSendImages,
    openLightbox: openLightbox,
    closeLightbox: closeLightbox,
    bindLightboxClicks: bindLightboxClicks,
    toast: toast,
  };
})(typeof window !== "undefined" ? window : globalThis);
