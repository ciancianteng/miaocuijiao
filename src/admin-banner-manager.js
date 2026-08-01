(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET_ID = "crud-banners";
  var ACCEPT = ["image/jpeg", "image/png", "image/webp"];
  var state = {
    loading: true,
    publishing: false,
    error: "",
    message: "",
    current: null,
    history: [],
    draft: null,
    crop: { scale: 1, offsetX: 0, offsetY: 0 },
    natural: { width: 0, height: 0 },
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function target() {
    return document.getElementById(TARGET_ID);
  }
  function formatTime(value) {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleString("zh-CN", { hour12: false });
    } catch (e) {
      return String(value);
    }
  }
  function apiGet() {
    return Auth.get("/api/admin/banners");
  }
  function apiPost(body) {
    return Auth.post("/api/admin/banners", body);
  }
  function load() {
    state.loading = true;
    state.error = "";
    render();
    return apiGet()
      .then(function (res) {
        state.current = res.current || null;
        state.history = res.history || [];
        state.message = res.message || "";
      })
      .catch(function (err) {
        state.error = err.message || "Banner 读取失败";
        state.current = null;
        state.history = [];
      })
      .finally(function () {
        state.loading = false;
        render();
        bind();
      });
  }
  function resetDraft() {
    if (state.draft && state.draft.url && state.draft.url.indexOf("blob:") === 0) {
      URL.revokeObjectURL(state.draft.url);
    }
    state.draft = null;
    state.crop = { scale: 1, offsetX: 0, offsetY: 0 };
    state.natural = { width: 0, height: 0 };
  }
  function acceptFile(file) {
    if (!file) return;
    if (ACCEPT.indexOf(file.type) < 0) {
      alert("仅支持 JPG、PNG、WEBP 图片。");
      return;
    }
    resetDraft();
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      state.draft = { file: file, url: url };
      state.natural = { width: img.naturalWidth, height: img.naturalHeight };
      var frameRatio = 16 / 9;
      var imageRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
      state.crop.scale = imageRatio > frameRatio ? 1 : frameRatio / imageRatio;
      state.crop.offsetX = 0;
      state.crop.offsetY = 0;
      render();
      bind();
    };
    img.onerror = function () {
      alert("图片读取失败，请换一张试试。");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
  function cropTransformStyle() {
    var s = state.crop.scale;
    return (
      "translate(calc(-50% + " +
      state.crop.offsetX +
      "px), calc(-50% + " +
      state.crop.offsetY +
      "px)) scale(" +
      s +
      ")"
    );
  }
  function renderUploadZone() {
    if (state.draft && state.draft.url) {
      return (
        '<div class="banner-ops-crop">' +
        '<div class="banner-ops-crop-stage" data-banner-crop-stage>' +
        '<img data-banner-crop-img src="' +
        esc(state.draft.url) +
        '" style="transform:' +
        esc(cropTransformStyle()) +
        '" alt="">' +
        "</div>" +
        '<div class="banner-ops-crop-controls">' +
        '<label>缩放<input type="range" data-banner-crop-scale min="0.2" max="3" step="0.01" value="' +
        state.crop.scale +
        '"></label>' +
        '<label>左右位置<input type="range" data-banner-crop-x min="-400" max="400" step="1" value="' +
        state.crop.offsetX +
        '"></label>' +
        '<label>上下位置<input type="range" data-banner-crop-y min="-400" max="400" step="1" value="' +
        state.crop.offsetY +
        '"></label>' +
        "</div>" +
        '<p class="admin-sync-note">拖动图片或调整滑杆，确认 16:9 预览正确后点击发布。也可重新拖入图片更换。</p>' +
        '<div class="banner-ops-upload banner-ops-upload-replace" data-banner-upload-zone>' +
        '<input class="banner-ops-file" type="file" accept="image/jpeg,image/png,image/webp" data-banner-file tabindex="-1" aria-hidden="true">' +
        '<div class="banner-ops-upload-inner">' +
        '<div class="banner-ops-upload-title">更换图片</div>' +
        '<div class="banner-ops-upload-hint">点击或拖拽替换</div>' +
        "</div></div></div>"
      );
    }
    return (
      '<div class="banner-ops-upload" data-banner-upload-zone>' +
      '<input class="banner-ops-file" type="file" accept="image/jpeg,image/png,image/webp" data-banner-file tabindex="-1" aria-hidden="true">' +
      '<div class="banner-ops-upload-inner">' +
      '<div class="banner-ops-upload-icon" aria-hidden="true">📷</div>' +
      '<div class="banner-ops-upload-title">拖拽图片到这里</div>' +
      '<div class="banner-ops-upload-sub">或点击上传</div>' +
      '<div class="banner-ops-upload-hint">支持 JPG / PNG / WEBP</div>' +
      "</div></div>"
    );
  }
  function renderHistory() {
    if (!state.history.length) {
      return '<div class="admin-sync-note">暂无历史上传记录。发布第一张 Banner 后会显示在这里。</div>';
    }
    return (
      '<div class="banner-ops-history">' +
      state.history
        .map(function (item) {
          var active = item.is_active || (state.current && state.current.id === item.id);
          return (
            '<article class="banner-ops-card' +
            (active ? " is-active" : "") +
            '" data-banner-id="' +
            esc(item.id) +
            '">' +
            '<div class="banner-ops-card-thumb" data-banner-preview="' +
            esc(item.id) +
            '" title="点击预览">' +
            (item.image_url
              ? '<img src="' + esc(item.image_url) + '" alt="">'
              : '<div class="banner-ops-preview-empty">无图片</div>') +
            "</div>" +
            '<div class="banner-ops-card-body">' +
            '<div class="banner-ops-card-meta"><span>' +
            esc(formatTime(item.created_at)) +
            "</span>" +
            (active ? '<span class="banner-ops-badge live">使用中</span>' : "") +
            "</div>" +
            '<div class="banner-ops-card-actions">' +
            (active
              ? ""
              : '<button class="mini-btn primary-lite" type="button" data-banner-set="' +
                esc(item.id) +
                '">设为当前</button>') +
            '<button class="mini-btn danger" type="button" data-banner-delete="' +
            esc(item.id) +
            '">删除</button>' +
            "</div></div></article>"
          );
        })
        .join("") +
      "</div>"
    );
  }
  function render() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="banner-ops-loading">正在读取 Banner...</div>';
      return;
    }
    var previewUrl =
      (state.draft && state.draft.url) || (state.current && state.current.image_url) || "";
    box.innerHTML =
      (state.error ? '<div class="admin-sync-note">' + esc(state.error) + "</div>" : "") +
      (state.message && !state.error ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="banner-ops">' +
      '<section class="banner-ops-section">' +
      "<h3>首页 Banner 实时预览</h3>" +
      "<p>16:9 宽屏比例。发布成功后首页会读取当前启用 Banner。</p>" +
      '<div class="banner-ops-preview" data-banner-live-preview>' +
      (previewUrl
        ? '<img src="' + esc(previewUrl) + '" alt="当前 Banner">'
        : '<div class="banner-ops-preview-empty">暂无 Banner，请上传并发布</div>') +
      "</div></section>" +
      '<section class="banner-ops-section">' +
      "<h3>上传 / 裁剪 / 发布</h3>" +
      "<p>上传后可裁剪，再点击保存并发布到首页。</p>" +
      renderUploadZone() +
      (state.draft
        ? '<div class="admin-sync-note">图片已选择，请调整裁剪后点击下方「保存并发布」，否则首页不会更新。</div>'
        : "") +
      '<div class="banner-ops-actions">' +
      '<button class="primary-btn" type="button" data-banner-publish ' +
      (state.publishing || !state.draft ? "disabled" : "") +
      ">" + (state.publishing ? "发布中…" : "保存并发布") + "</button>" +
      "</div></section>" +
      '<section class="banner-ops-section">' +
      "<h3>历史 Banner</h3>" +
      "<p>点击「设为当前」会立刻切换首页 Banner。</p>" +
      renderHistory() +
      "</section></div>";
  }
  function bindCropDrag() {
    var stage = document.querySelector("[data-banner-crop-stage]");
    var img = document.querySelector("[data-banner-crop-img]");
    if (!stage || !img || stage.dataset.bound === "1") return;
    stage.dataset.bound = "1";
    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    function move(dx, dy) {
      state.crop.offsetX += dx;
      state.crop.offsetY += dy;
      img.style.transform = cropTransformStyle();
      var xInput = document.querySelector("[data-banner-crop-x]");
      var yInput = document.querySelector("[data-banner-crop-y]");
      if (xInput) xInput.value = String(state.crop.offsetX);
      if (yInput) yInput.value = String(state.crop.offsetY);
    }
    stage.addEventListener("pointerdown", function (e) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      move(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    stage.addEventListener("pointerup", function () {
      dragging = false;
    });
    stage.addEventListener("pointercancel", function () {
      dragging = false;
    });
  }
  function bindCropControls() {
    var scale = document.querySelector("[data-banner-crop-scale]");
    var x = document.querySelector("[data-banner-crop-x]");
    var y = document.querySelector("[data-banner-crop-y]");
    var img = document.querySelector("[data-banner-crop-img]");
    function apply() {
      if (img) img.style.transform = cropTransformStyle();
      var live = document.querySelector("[data-banner-live-preview] img");
      if (live && state.draft) live.src = state.draft.url;
    }
    if (scale)
      scale.oninput = function () {
        state.crop.scale = Number(scale.value) || 1;
        apply();
      };
    if (x)
      x.oninput = function () {
        state.crop.offsetX = Number(x.value) || 0;
        apply();
      };
    if (y)
      y.oninput = function () {
        state.crop.offsetY = Number(y.value) || 0;
        apply();
      };
    bindCropDrag();
  }
  function bindUploadZone() {
    var zone = document.querySelector("[data-banner-upload-zone]");
    var input = document.querySelector("[data-banner-file]");
    if (!zone || !input || zone.dataset.bound === "1") return;
    zone.dataset.bound = "1";
    zone.addEventListener("click", function (e) {
      e.preventDefault();
      input.click();
    });
    input.addEventListener("change", function () {
      acceptFile(input.files && input.files[0]);
      input.value = "";
    });
    ["dragenter", "dragover"].forEach(function (name) {
      zone.addEventListener(name, function (e) {
        e.preventDefault();
        zone.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      zone.addEventListener(name, function (e) {
        e.preventDefault();
        zone.classList.remove("is-dragover");
        if (name === "drop" && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          acceptFile(e.dataTransfer.files[0]);
        }
      });
    });
  }
  function exportCoverDataUrl() {
    return new Promise(function (resolve, reject) {
      if (!state.draft) return reject(new Error("没有可发布的图片"));
      var img = new Image();
      img.onload = function () {
        var stage = document.querySelector("[data-banner-crop-stage]");
        var stageW = stage && stage.clientWidth;
        var stageH = stage && stage.clientHeight;
        if (!stageW || !stageH) {
          reject(new Error("裁剪画布尚未渲染完成，请稍等片刻后重新点击「保存并发布」"));
          return;
        }
        var canvas = document.createElement("canvas");
        var outW = 1920;
        var outH = 1080;
        canvas.width = outW;
        canvas.height = outH;
        var ctx = canvas.getContext("2d");
        var scale = state.crop.scale;
        var drawW = img.naturalWidth * scale;
        var drawH = img.naturalHeight * scale;
        var centerX = stageW / 2 + state.crop.offsetX;
        var centerY = stageH / 2 + state.crop.offsetY;
        var destScale = outW / stageW;
        var dx = (centerX - drawW / 2) * destScale;
        var dy = (centerY - drawH / 2) * destScale;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, dx, dy, drawW * destScale, drawH * destScale);
        var type = state.draft.file && state.draft.file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve(canvas.toDataURL(type, 0.92));
      };
      img.onerror = function () {
        reject(new Error("图片处理失败"));
      };
      img.src = state.draft.url;
    });
  }
  function publish() {
    if (!state.draft || state.publishing) return;
    state.publishing = true;
    render();
    exportCoverDataUrl()
      .then(function (dataUrl) {
        return apiPost({
          action: "publish",
          image_data: dataUrl,
          filename: (state.draft.file && state.draft.file.name) || "homepage-banner.jpg",
        });
      })
      .then(function (res) {
        alert(res.message || "Banner 发布成功");
        resetDraft();
        state.current = res.banner || state.current;
        state.publishing = false;
        try {
          localStorage.setItem("mcj_banner_published_at", String(Date.now()));
          window.dispatchEvent(new Event("mcj:platform-data-updated"));
        } catch (e) {}
        return load();
      })
      .catch(function (err) {
        alert(err.message || "发布失败");
        state.publishing = false;
        render();
        bind();
      });
  }
  function setCurrent(id) {
    apiPost({ action: "set_current", id: id })
      .then(function (res) {
        alert(res.message || "Banner 发布成功");
        try {
          localStorage.setItem("mcj_banner_published_at", String(Date.now()));
          window.dispatchEvent(new Event("mcj:platform-data-updated"));
        } catch (e) {}
        return load();
      })
      .catch(function (err) {
        alert(err.message || "操作失败");
      });
  }
  function removeBanner(id) {
    if (!confirm("确认删除这张 Banner？删除后无法恢复。")) return;
    apiPost({ action: "delete", id: id })
      .then(function (res) {
        alert(res.message || "已删除");
        return load();
      })
      .catch(function (err) {
        alert(err.message || "删除失败");
      });
  }
  function previewHistory(id) {
    var item = state.history.find(function (row) {
      return String(row.id) === String(id);
    });
    if (!item || !item.image_url) return;
    var live = document.querySelector("[data-banner-live-preview]");
    if (!live) return;
    live.innerHTML = '<img src="' + esc(item.image_url) + '" alt="Banner 预览">';
  }
  function bind() {
    bindUploadZone();
    bindCropControls();
    var publishBtn = document.querySelector("[data-banner-publish]");
    if (publishBtn) publishBtn.onclick = publish;
    document.querySelectorAll("[data-banner-set]").forEach(function (btn) {
      btn.onclick = function () {
        setCurrent(btn.getAttribute("data-banner-set"));
      };
    });
    document.querySelectorAll("[data-banner-delete]").forEach(function (btn) {
      btn.onclick = function () {
        removeBanner(btn.getAttribute("data-banner-delete"));
      };
    });
    document.querySelectorAll("[data-banner-preview]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-banner-preview");
        var item = state.history.find(function (row) {
          return String(row.id) === String(id);
        });
        if (!item) return;
        if (item.is_active || (state.current && state.current.id === item.id)) {
          previewHistory(id);
          return;
        }
        setCurrent(id);
      };
    });
  }
  function init() {
    if (!Auth || !target()) return;
    Auth.ensureValidToken()
      .then(load)
      .catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  window.MCJAdminBannerManager = { reload: load };
})();
