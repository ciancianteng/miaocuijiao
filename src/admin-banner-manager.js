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
    editingId: "",
    editMeta: { title: "", link: "", sort_order: 100 },
    crop: { scale: 1, offsetX: 0, offsetY: 0 },
    natural: { width: 0, height: 0 },
  };
  var DESKTOP_RATIO = 1920 / 700;

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
  function resetDraft(keepEditing) {
    if (state.draft && state.draft.url && state.draft.url.indexOf("blob:") === 0) {
      URL.revokeObjectURL(state.draft.url);
    }
    state.draft = null;
    state.crop = { scale: 1, offsetX: 0, offsetY: 0 };
    state.natural = { width: 0, height: 0 };
    if (!keepEditing) {
      state.editingId = "";
      state.editMeta = { title: "", link: "", sort_order: 100 };
    }
  }
  function acceptFile(file) {
    if (!file) return;
    if (ACCEPT.indexOf(file.type) < 0) {
      alert("仅支持 JPG、PNG、WEBP 图片。");
      return;
    }
    var keepEditing = !!state.editingId;
    resetDraft(keepEditing);
    if (keepEditing) {
      /* preserve editingId/editMeta */
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      state.draft = { file: file, url: url };
      state.natural = { width: img.naturalWidth, height: img.naturalHeight };
      var frameRatio = DESKTOP_RATIO;
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
        '<p class="admin-sync-note">拖动图片或调整滑杆，确认宽屏预览正确后点击保存。也可重新拖入图片更换。</p>' +
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
          var editing = state.editingId && String(state.editingId) === String(item.id);
          return (
            '<article class="banner-ops-card' +
            (active ? " is-active" : "") +
            (editing ? " is-editing" : "") +
            '" data-banner-id="' +
            esc(item.id) +
            '">' +
            '<div class="banner-ops-card-thumb">' +
            (item.image_url
              ? '<img src="' + esc(item.image_url) + '" alt="">'
              : '<div class="banner-ops-preview-empty">无图片</div>') +
            "</div>" +
            '<div class="banner-ops-card-body">' +
            '<div class="banner-ops-card-meta"><span>' +
            esc(formatTime(item.created_at)) +
            "</span>" +
            (active ? '<span class="banner-ops-badge live">使用中</span>' : "") +
            (editing ? '<span class="banner-ops-badge live">编辑中</span>' : "") +
            "</div>" +
            '<label class="banner-ops-sort">标题 <input type="text" maxlength="80" value="' +
            esc(item.title || "") +
            '" data-banner-title="' +
            esc(item.id) +
            '" placeholder="可选标题" style="width:140px"></label>' +
            '<label class="banner-ops-sort">链接 <input type="text" maxlength="240" value="' +
            esc(item.button_link || item.link || "") +
            '" data-banner-link="' +
            esc(item.id) +
            '" placeholder="可选跳转" style="width:160px"></label>' +
            '<div class="banner-ops-card-actions">' +
            '<label class="banner-ops-sort">排序 <input type="number" min="0" step="1" value="' +
            esc(item.sort_order != null ? item.sort_order : 100) +
            '" data-banner-sort="' +
            esc(item.id) +
            '" style="width:72px"></label>' +
            '<button class="mini-btn primary-lite" type="button" data-banner-edit="' +
            esc(item.id) +
            '">编辑图片</button>' +
            '<button class="mini-btn" type="button" data-banner-save-meta="' +
            esc(item.id) +
            '">保存标题/链接</button>' +
            (active
              ? ""
              : '<button class="mini-btn" type="button" data-banner-set="' +
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
    var editing = !!state.editingId;
    var publishLabel = state.publishing
      ? (editing ? "上传中/发布中…" : "上传中/发布中…")
      : editing
        ? "保存编辑并发布"
        : "保存并发布";
    box.innerHTML =
      (state.error ? '<div class="admin-sync-note">' + esc(state.error) + "</div>" : "") +
      (state.message && !state.error ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="banner-ops">' +
      '<section class="banner-ops-section">' +
      "<h3>首页 Banner 实时预览</h3>" +
      "<p>宽屏比例（约 1920×700）。保存成功后首页会读取当前启用 Banner。</p>" +
      '<div class="banner-ops-preview" data-banner-live-preview>' +
      (previewUrl
        ? '<img src="' + esc(previewUrl) + '" alt="当前 Banner" style="transform:' + esc(state.draft ? cropTransformStyle() : "none") + '">'
        : '<div class="banner-ops-preview-empty">暂无 Banner，请上传并发布</div>') +
      "</div></section>" +
      '<section class="banner-ops-section">' +
      "<h3>" + (editing ? "编辑 Banner（上传 / 裁剪 / 保存）" : "上传 / 裁剪 / 发布") + "</h3>" +
      "<p>" + (editing
        ? "正在编辑历史 Banner。可直接更换图片、裁剪预览后保存；保存后仍会更新首页当前图。"
        : "上传后可裁剪，再点击保存并发布到首页。也可从下方历史记录点「编辑图片」。") + "</p>" +
      (editing
        ? '<div class="admin-sync-note">编辑中：' + esc(state.editingId) +
          ' · 标题/链接可在下方历史卡片修改，或保存图片时一并带上当前草稿。</div>'
        : "") +
      renderUploadZone() +
      (state.draft
        ? '<div class="admin-sync-note">图片已选择，请调整裁剪后点击下方「' + (editing ? "保存编辑并发布" : "保存并发布") + '」，否则首页不会更新。</div>'
        : "") +
      '<div class="banner-ops-actions">' +
      '<button class="primary-btn" type="button" data-banner-publish ' +
      (state.publishing || !state.draft ? "disabled" : "") +
      ">" + publishLabel + "</button>" +
      (editing
        ? '<button class="mini-btn" type="button" data-banner-cancel-edit">取消编辑</button>'
        : "") +
      "</div></section>" +
      '<section class="banner-ops-section">' +
      "<h3>历史 Banner</h3>" +
      "<p>点「编辑图片」进入上方编辑区（上传 / 预览 / 裁剪 / 保存）。「设为当前」会立刻切换首页 Banner。</p>" +
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
    var input = zone && zone.querySelector("[data-banner-file]");
    if (!zone || !input || zone.dataset.bound === "1") return;
    zone.dataset.bound = "1";
    // Transparent full-zone <input type="file"> handles native click.
    // Never preventDefault on click — that cancels the system file picker.
    // Fallback: clicking non-input area (if any) still opens the picker.
    zone.addEventListener("click", function (e) {
      if (e.target === input) return;
      input.click();
    });
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      acceptFile(file);
      input.value = "";
    });
    function onDragEnterOver(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      zone.classList.add("is-dragover");
    }
    function onDragLeave(e) {
      e.preventDefault();
      e.stopPropagation();
      // relatedTarget may be null or leave the zone entirely
      var next = e.relatedTarget;
      if (next && zone.contains(next)) return;
      zone.classList.remove("is-dragover");
    }
    function onDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove("is-dragover");
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) acceptFile(file);
    }
    ["dragenter", "dragover"].forEach(function (name) {
      zone.addEventListener(name, onDragEnterOver);
      input.addEventListener(name, onDragEnterOver);
    });
    zone.addEventListener("dragleave", onDragLeave);
    input.addEventListener("dragleave", onDragLeave);
    zone.addEventListener("drop", onDrop);
    input.addEventListener("drop", onDrop);
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
        var outH = 700;
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
  function applyDraftImage(file, url) {
    var img = new Image();
    img.onload = function () {
      state.draft = { file: file || null, url: url };
      state.natural = { width: img.naturalWidth, height: img.naturalHeight };
      var imageRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
      state.crop.scale = imageRatio > DESKTOP_RATIO ? 1 : DESKTOP_RATIO / imageRatio;
      state.crop.offsetX = 0;
      state.crop.offsetY = 0;
      render();
      bind();
      var stage = document.querySelector("[data-banner-crop-stage]");
      if (stage) stage.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    img.onerror = function () {
      alert("图片加载失败，请重新上传。");
      if (url && url.indexOf("blob:") === 0) URL.revokeObjectURL(url);
      resetDraft(false);
      render();
      bind();
    };
    img.src = url;
  }
  function openEdit(id) {
    var item = state.history.find(function (row) {
      return String(row.id) === String(id);
    });
    if (!item || !item.image_url) {
      alert("该 Banner 没有可编辑的图片。");
      return;
    }
    resetDraft(false);
    state.editingId = String(item.id);
    state.editMeta = {
      title: item.title || "",
      link: item.button_link || item.link || "",
      sort_order: item.sort_order != null ? item.sort_order : 100,
    };
    var remote = item.image_url;
    // Prefer blob so canvas export is not CORS-tainted.
    fetch(remote, { mode: "cors", credentials: "omit" })
      .then(function (res) {
        if (!res.ok) throw new Error("fetch failed");
        return res.blob();
      })
      .then(function (blob) {
        var type = blob.type || "image/jpeg";
        var file = new File([blob], "banner-edit.jpg", { type: type });
        applyDraftImage(file, URL.createObjectURL(blob));
      })
      .catch(function () {
        // Fallback: show remote image; user can replace if canvas export fails.
        applyDraftImage(null, remote);
      });
  }
  function cancelEdit() {
    resetDraft(false);
    render();
    bind();
  }
  function publish() {
    if (!state.draft || state.publishing) return;
    state.publishing = true;
    state.error = "";
    state.message = "上传中/发布中…";
    render();
    exportCoverDataUrl()
      .then(function (dataUrl) {
        var editingId = state.editingId;
        if (editingId) {
          var card = document.querySelector('[data-banner-id="' + editingId + '"]');
          var titleInput = card && card.querySelector('[data-banner-title="' + editingId + '"]');
          var linkInput = card && card.querySelector('[data-banner-link="' + editingId + '"]');
          var sortInput = card && card.querySelector('[data-banner-sort="' + editingId + '"]');
          return apiPost({
            action: "update",
            id: editingId,
            image_data: dataUrl,
            filename: (state.draft.file && state.draft.file.name) || "homepage-banner.jpg",
            title: titleInput ? titleInput.value : state.editMeta.title,
            link: linkInput ? linkInput.value : state.editMeta.link,
            button_link: linkInput ? linkInput.value : state.editMeta.link,
            sort_order: Number(sortInput && sortInput.value != null ? sortInput.value : state.editMeta.sort_order),
            is_main: true,
            is_active: true,
          });
        }
        return apiPost({
          action: "publish",
          image_data: dataUrl,
          filename: (state.draft.file && state.draft.file.name) || "homepage-banner.jpg",
          is_main: true,
          is_active: true,
        });
      })
      .then(function (res) {
        var okMsg = res.message || (state.editingId ? "Banner 已保存" : "Banner 发布成功");
        state.message = okMsg;
        alert(okMsg);
        resetDraft(false);
        state.current = res.banner || state.current;
        state.publishing = false;
        try {
          localStorage.setItem("mcj_banner_published_at", String(Date.now()));
          window.dispatchEvent(new Event("mcj:platform-data-updated"));
        } catch (e) {}
        return load();
      })
      .catch(function (err) {
        var msg = err.message || "保存失败";
        state.error = msg;
        state.message = "";
        alert(msg);
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
    var cancelBtn = document.querySelector("[data-banner-cancel-edit]");
    if (cancelBtn) cancelBtn.onclick = cancelEdit;
    document.querySelectorAll("[data-banner-edit]").forEach(function (btn) {
      btn.onclick = function () {
        openEdit(btn.getAttribute("data-banner-edit"));
      };
    });
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
    document.querySelectorAll("[data-banner-save-meta]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-banner-save-meta");
        var card = btn.closest("[data-banner-id]");
        var titleInput = card && card.querySelector('[data-banner-title="' + id + '"]');
        var linkInput = card && card.querySelector('[data-banner-link="' + id + '"]');
        var sortInput = card && card.querySelector('[data-banner-sort="' + id + '"]');
        var sortOrder = Number(sortInput && sortInput.value != null ? sortInput.value : 100);
        apiPost({
          action: "update",
          id: id,
          title: titleInput ? titleInput.value : "",
          link: linkInput ? linkInput.value : "",
          button_link: linkInput ? linkInput.value : "",
          sort_order: sortOrder,
        })
          .then(function (res) {
            alert(res.message || "Banner 已保存");
            try {
              localStorage.setItem("mcj_banner_published_at", String(Date.now()));
              window.dispatchEvent(new Event("mcj:platform-data-updated"));
            } catch (e) {}
            return load();
          })
          .catch(function (err) {
            alert(err.message || "保存失败");
          });
      };
    });
    document.querySelectorAll("[data-banner-sort]").forEach(function (input) {
      input.onchange = function () {
        var id = input.getAttribute("data-banner-sort");
        var sortOrder = Number(input.value || 100);
        apiPost({ action: "update", id: id, sort_order: sortOrder })
          .then(function (res) {
            alert(res.message || "排序已保存");
            return load();
          })
          .catch(function (err) {
            alert(err.message || "排序保存失败");
          });
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
