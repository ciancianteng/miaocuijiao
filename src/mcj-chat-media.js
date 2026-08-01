/**
 * Shared chat media helpers for boss / CS / companion.
 * Compress → upload → send image messages; lightbox preview.
 */
(function (global) {
  "use strict";

  var MAX_BYTES = 10 * 1024 * 1024;
  var TARGET_MAX_EDGE = 1600;
  var TARGET_QUALITY = 0.82;
  var ALLOWED = /image\/(jpeg|jpg|png|webp)/i;

  function toast(msg) {
    if (global.MCJNotify && typeof global.MCJNotify.toast === "function") {
      global.MCJNotify.toast(String(msg || ""));
      return;
    }
    try {
      console.log("[chat-media]", msg);
    } catch (e) {}
  }

  function isImageMessage(m) {
    if (!m) return false;
    var t = String(m.message_type || m.messageType || "").toLowerCase();
    if (t === "image") return true;
    var c = String(m.content || "");
    if (c.indexOf("__IMG__:") === 0) return true;
    if (/^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(c)) return true;
    if (/^https?:\/\/.+\/storage\/v1\/object\/public\/chat-images\//i.test(c)) return true;
    return false;
  }

  function imageUrlOf(m) {
    var c = String((m && m.content) || "");
    if (c.indexOf("__IMG__:") === 0) return c.slice(7);
    return c;
  }

  function imageBubbleHtml(url, escFn) {
    var esc = escFn || function (v) {
      return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      });
    };
    var src = esc(url);
    return (
      '<a class="mcj-chat-img-wrap" href="' +
      src +
      '" data-chat-image="' +
      src +
      '" title="点击放大">' +
      '<img class="mcj-chat-img" src="' +
      src +
      '" alt="图片" loading="lazy" />' +
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
      '<img data-lb-img alt="预览" />';
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el || e.target.closest("[data-lb-close]")) closeLightbox();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeLightbox();
    });
  }

  function openLightbox(url) {
    ensureLightbox();
    var el = document.getElementById("mcjChatLightbox");
    var img = el.querySelector("[data-lb-img]");
    img.src = url;
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
      if (!a) return;
      e.preventDefault();
      openLightbox(a.getAttribute("data-chat-image") || a.href);
    });
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
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
        reject(new Error("图片解析失败"));
      };
      img.src = dataUrl;
    });
  }

  function compressFile(file) {
    return Promise.resolve().then(function () {
      if (!file) throw new Error("未选择文件");
      if (!ALLOWED.test(file.type || "")) throw new Error("仅支持 jpg / jpeg / png / webp");
      if (file.size > MAX_BYTES) throw new Error("单张图片不能超过 10MB");
      return readAsDataUrl(file).then(function (raw) {
        return loadImage(raw).then(function (img) {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, TARGET_MAX_EDGE / Math.max(w, h, 1));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, cw, ch);
          var preferWebp = /image\/webp/i.test(file.type) || true;
          var mime = preferWebp ? "image/jpeg" : file.type || "image/jpeg";
          // Prefer jpeg for size; keep png only if source is png and small
          if (/image\/png/i.test(file.type) && file.size < 400 * 1024) mime = "image/png";
          else mime = "image/jpeg";
          var quality = TARGET_QUALITY;
          var dataUrl = canvas.toDataURL(mime, quality);
          // If still large, lower quality
          var guard = 0;
          while (dataUrl.length > 1.8 * 1024 * 1024 && quality > 0.45 && guard < 6) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL("image/jpeg", quality);
            mime = "image/jpeg";
            guard += 1;
          }
          if (dataUrl.length > 12 * 1024 * 1024) {
            throw new Error("压缩后仍过大，请换一张较小的图片");
          }
          return {
            dataUrl: dataUrl,
            mime: mime,
            filename: String(file.name || "chat.jpg").replace(/\.[^.]+$/, "") + (mime === "image/png" ? ".png" : ".jpg"),
          };
        });
      });
    });
  }

  function uploadDataUrl(dataUrl, filename, token) {
    return fetch("/api/chat-media", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "x-mcj-access-token": token,
        "x-mcj-service-token": token,
        "x-mcj-companion-token": token,
      },
      body: JSON.stringify({ action: "upload", data_url: dataUrl, filename: filename || "chat.jpg" }),
    }).then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (body) {
        if (!res.ok || body.ok === false || !body.url) {
          throw new Error((body && body.message) || "上传失败");
        }
        return body;
      });
    });
  }

  /**
   * Pick files (multi), compress+upload each, call onUploaded(url, meta) per file.
   * onStatus(text) for UX.
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
        var results = [];
        var chain = Promise.resolve();
        files.forEach(function (file, idx) {
          chain = chain.then(function () {
            if (opts.onStatus) opts.onStatus("上传中… (" + (idx + 1) + "/" + files.length + ")");
            return compressFile(file)
              .then(function (packed) {
                return uploadDataUrl(packed.dataUrl, packed.filename, token);
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
                if (opts.onError) opts.onError(err, file);
                else toast((err && err.message) || "发送失败");
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
      ".mcj-chat-img{display:block;max-width:100%;max-height:280px;object-fit:cover;cursor:zoom-in;background:rgba(0,0,0,.2)}" +
      ".mcj-chat-lightbox{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:24px}" +
      ".mcj-chat-lightbox[hidden]{display:none!important}" +
      ".mcj-chat-lightbox img{max-width:min(96vw,1200px);max-height:92vh;object-fit:contain;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.45)}" +
      ".mcj-chat-lightbox-close{position:fixed;top:16px;right:16px;width:42px;height:42px;border:0;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;font-size:28px;cursor:pointer;line-height:1}" +
      "html.mcj-lb-open,html.mcj-lb-open body{overflow:hidden!important}" +
      ".mcj-composer-tools{display:flex;gap:8px;align-items:center;flex:0 0 auto}" +
      ".mcj-composer-tool{width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-size:18px;display:inline-flex;align-items:center;justify-content:center}" +
      ".mcj-composer-tool:disabled{opacity:.45;cursor:not-allowed}" +
      ".mcj-upload-status{font-size:12px;color:#9ca3af;min-height:16px}";
    document.head.appendChild(style);
  }

  injectStyles();

  global.MCJChatMedia = {
    MAX_BYTES: MAX_BYTES,
    isImageMessage: isImageMessage,
    imageUrlOf: imageUrlOf,
    imageBubbleHtml: imageBubbleHtml,
    compressFile: compressFile,
    uploadDataUrl: uploadDataUrl,
    pickAndSendImages: pickAndSendImages,
    openLightbox: openLightbox,
    closeLightbox: closeLightbox,
    bindLightboxClicks: bindLightboxClicks,
    toast: toast,
  };
})(window);
