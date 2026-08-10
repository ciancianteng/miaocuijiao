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
    crop: { zoom: 1, x: 0, y: 0 },
    natural: { width: 0, height: 0 },
    previewIndex: 0,
  };
  var DESKTOP_RATIO = 1920 / 700;
  var _cropRetryTimer = 0;
  var _livePreviewRo = null;

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
        var list = activeBannersForPreview();
        if (state.current && state.current.id) {
          var idx = list.findIndex(function (item) {
            return String(item.id) === String(state.current.id);
          });
          state.previewIndex = idx >= 0 ? idx : 0;
        } else {
          state.previewIndex = 0;
        }
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
        watchLivePreviewFrame();
        scheduleApplyCropFrames();
      });
  }
  function resetDraft(keepEditing) {
    if (state.draft && state.draft.url && state.draft.url.indexOf("blob:") === 0) {
      URL.revokeObjectURL(state.draft.url);
    }
    state.draft = null;
    state.crop = { zoom: 1, x: 0, y: 0 };
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
      state.draft = { file: file, url: url, reused: false };
      state.natural = { width: img.naturalWidth, height: img.naturalHeight };
      state.crop = { zoom: 1, x: 0, y: 0 };
      render();
      bind();
      watchLivePreviewFrame();
      scheduleApplyCropFrames();
    };
    img.onerror = function () {
      alert("图片读取失败，请换一张试试。");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
  function cropApi() {
    return window.MCJBannerCrop || null;
  }
  function normalizeCropState(raw) {
    var api = cropApi();
    var c = api && api.normalizeCrop ? api.normalizeCrop(raw || state.crop, { ratioW: 1920, ratioH: 700 }) : raw || state.crop;
    return {
      zoom: Number(c.zoom != null ? c.zoom : c.scale) || 1,
      x: Number(c.x != null ? c.x : c.offsetX) || 0,
      y: Number(c.y != null ? c.y : c.offsetY) || 0,
    };
  }
  function cropPayload() {
    var c = normalizeCropState(state.crop);
    return {
      zoom: c.zoom,
      scale: c.zoom,
      x: c.x,
      y: c.y,
      offsetX: c.x,
      offsetY: c.y,
      ratioW: 1920,
      ratioH: 700,
      ratio: "1920:700",
    };
  }
  function applyCropFrames() {
    var api = cropApi();
    if (!api || !api.applyCropToImg) return;
    var pairs = [
      [document.querySelector("[data-banner-crop-img]"), document.querySelector("[data-banner-crop-stage]"), "draft"],
      [document.querySelector("[data-banner-live-preview] img"), document.querySelector("[data-banner-live-preview]"), "live"],
    ];
    pairs.forEach(function (pair) {
      var img = pair[0];
      var frame = pair[1];
      var kind = pair[2];
      if (!img || !frame) return;
      // P0: never apply crop while the preview frame has no real layout size.
      // Otherwise coverBaseSize(nat, 1×1) collapses the img to ~2.7×1px with !important
      // and the large 1920×700 box looks completely blank.
      var fw = Math.max(0, frame.clientWidth || frame.offsetWidth || 0);
      var fh = Math.max(0, frame.clientHeight || frame.offsetHeight || 0);
      if (fw < 32 || fh < 16) return;
      var crop =
        kind === "live" && !(state.draft && state.draft.url)
          ? normalizeCropState(livePreviewCropSource())
          : cropPayload();
      function run() {
        api.applyCropToImg(img, frame, crop);
      }
      if (img.complete && img.naturalWidth) run();
      else img.addEventListener("load", run, { once: true });
    });
  }

  function livePreviewCropSource() {
    var list = activeBannersForPreview();
    var item = list[state.previewIndex] || list[0] || state.current || null;
    return (item && (item.crop_meta || item.crop)) || {};
  }

  function activeBannersForPreview() {
    var list = (state.history || []).filter(function (item) {
      return item && item.is_active === true && item.image_url;
    });
    list.sort(function (a, b) {
      return Number(a.sort_order != null ? a.sort_order : 100) - Number(b.sort_order != null ? b.sort_order : 100);
    });
    if (!list.length && state.current && state.current.image_url) {
      list = [state.current];
    }
    return list;
  }

  function scheduleApplyCropFrames() {
    if (_cropRetryTimer) {
      clearTimeout(_cropRetryTimer);
      _cropRetryTimer = 0;
    }
    var tries = 0;
    function tick() {
      tries += 1;
      applyCropFrames();
      var live = document.querySelector("[data-banner-live-preview]");
      var stage = document.querySelector("[data-banner-crop-stage]");
      var liveNeeds =
        live &&
        live.querySelector("img") &&
        (live.clientWidth < 32 || live.clientHeight < 16 || !live.querySelector("img[data-crop-ready]"));
      var stageNeeds =
        stage &&
        stage.querySelector("img") &&
        (stage.clientWidth < 32 || stage.clientHeight < 16 || !stage.querySelector("img[data-crop-ready]"));
      if ((liveNeeds || stageNeeds) && tries < 30) {
        _cropRetryTimer = setTimeout(tick, tries < 5 ? 32 : 80);
      }
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(tick);
    });
  }

  function watchLivePreviewFrame() {
    var live = document.querySelector("[data-banner-live-preview]");
    if (!live || typeof ResizeObserver === "undefined") return;
    if (_livePreviewRo) {
      try {
        _livePreviewRo.disconnect();
      } catch (e) {}
      _livePreviewRo = null;
    }
    _livePreviewRo = new ResizeObserver(function () {
      if (live.clientWidth >= 32 && live.clientHeight >= 16) applyCropFrames();
    });
    _livePreviewRo.observe(live);
  }

  function renderLivePreview() {
    // While uploading/editing a draft image, keep existing behavior: preview the draft.
    if (state.draft && state.draft.url) {
      return (
        '<div class="banner-ops-preview" data-banner-live-preview>' +
        '<img src="' +
        esc(state.draft.url) +
        '" alt="当前 Banner">' +
        "</div>"
      );
    }
    var list = activeBannersForPreview();
    if (!list.length) {
      return (
        '<div class="banner-ops-preview" data-banner-live-preview>' +
        '<div class="banner-ops-preview-empty">暂无启用中的 Banner</div>' +
        "</div>"
      );
    }
    if (state.previewIndex < 0 || state.previewIndex >= list.length) state.previewIndex = 0;
    var item = list[state.previewIndex] || list[0];
    var nav =
      list.length > 1
        ? '<div class="banner-ops-preview-nav">' +
          '<button type="button" class="mini-btn" data-banner-preview-prev aria-label="上一张">上一张</button>' +
          '<span class="banner-ops-preview-count">' +
          (state.previewIndex + 1) +
          " / " +
          list.length +
          " · 启用中</span>" +
          '<button type="button" class="mini-btn" data-banner-preview-next aria-label="下一张">下一张</button>' +
          "</div>"
        : "";
    return (
      '<div class="banner-ops-preview" data-banner-live-preview data-banner-preview-id="' +
      esc(item.id) +
      '">' +
      '<img src="' +
      esc(item.image_url) +
      '" alt="' +
      esc(item.title || "当前 Banner") +
      '">' +
      "</div>" +
      nav
    );
  }
  function renderUploadZone() {
    if (state.draft && state.draft.url) {
      return (
        '<div class="banner-ops-crop">' +
        '<div class="banner-ops-crop-stage" data-banner-crop-stage>' +
        '<img data-banner-crop-img src="' +
        esc(state.draft.url) +
        '" alt="">' +
        "</div>" +
        '<div class="banner-ops-crop-controls">' +
        '<label>缩放<input type="range" data-banner-crop-scale min="1" max="3" step="0.01" value="' +
        state.crop.zoom +
        '"></label>' +
        '<label>左右位置<input type="range" data-banner-crop-x min="-1" max="1" step="0.01" value="' +
        state.crop.x +
        '"></label>' +
        '<label>上下位置<input type="range" data-banner-crop-y min="-1" max="1" step="0.01" value="' +
        state.crop.y +
        '"></label>' +
        "</div>" +
        '<p class="admin-sync-note">缩放 / 左右 / 上下会写入数据库 crop_meta，首页用同一套参数渲染。确认预览后点击保存。</p>' +
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
            (item.is_active === false
              ? '<span class="banner-ops-badge">已停用</span>'
              : '<span class="banner-ops-badge live">已启用</span>') +
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
            '<button class="mini-btn" type="button" data-banner-toggle-active="' +
            esc(item.id) +
            '">' +
            (item.is_active === false ? "启用" : "停用") +
            "</button>" +
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
    var editing = !!state.editingId;
    var publishLabel = state.publishing
      ? "上传中/发布中…"
      : editing
        ? "保存编辑并发布"
        : "保存并发布";
    box.innerHTML =
      (state.error ? '<div class="admin-sync-note">' + esc(state.error) + "</div>" : "") +
      (state.message && !state.error ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="banner-ops">' +
      '<section class="banner-ops-section">' +
      "<h3>首页 Banner 实时预览</h3>" +
      "<p>宽屏比例（约 1920×700）。显示当前启用中的 Banner，与首页数据源一致。</p>" +
      renderLivePreview() +
      "</section>" +
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
      var fw = Math.max(1, stage.clientWidth || 1);
      var fh = Math.max(1, stage.clientHeight || 1);
      state.crop.x = Math.max(-1.5, Math.min(1.5, state.crop.x + dx / fw));
      state.crop.y = Math.max(-1.5, Math.min(1.5, state.crop.y + dy / fh));
      applyCropFrames();
      var xInput = document.querySelector("[data-banner-crop-x]");
      var yInput = document.querySelector("[data-banner-crop-y]");
      if (xInput) xInput.value = String(state.crop.x);
      if (yInput) yInput.value = String(state.crop.y);
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
    function apply() {
      applyCropFrames();
    }
    if (scale)
      scale.oninput = function () {
        state.crop.zoom = Math.max(1, Number(scale.value) || 1);
        apply();
      };
    if (x)
      x.oninput = function () {
        state.crop.x = Number(x.value) || 0;
        apply();
      };
    if (y)
      y.oninput = function () {
        state.crop.y = Number(y.value) || 0;
        apply();
      };
    bindCropDrag();
    requestAnimationFrame(function () {
      applyCropFrames();
    });
  }
  function bindUploadZone() {
    var zone = document.querySelector("[data-banner-upload-zone]");
    var input = zone && zone.querySelector("[data-banner-file]");
    if (!zone || !input || zone.dataset.bound === "1") return;
    zone.dataset.bound = "1";
    // Ensure the native control is enabled and reachable.
    input.disabled = false;
    input.removeAttribute("disabled");
    input.style.pointerEvents = "auto";
    // Transparent full-zone <input type="file"> must receive the real user click.
    // Never preventDefault / stopPropagation on click — that cancels the OS file picker
    // (this was the P0 regression: zone click called preventDefault over the input).
    zone.addEventListener("click", function (e) {
      if (e.target === input || (input.contains && input.contains(e.target))) return;
      // Fallback only when click landed on decorative inner (should not happen — input covers zone).
      try {
        input.click();
      } catch (err) {
        console.error("[Banner 管理] 打开文件选择器失败", err);
      }
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
  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error("没有可发布的图片文件"));
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("图片读取失败"));
      };
      reader.readAsDataURL(file);
    });
  }
  function resolvePublishImageData() {
    if (!state.draft) return Promise.reject(new Error("没有可发布的图片"));
    // Crop-only update on existing banner: persist crop_meta without re-uploading bytes.
    if (state.draft.reused && state.editingId) {
      return Promise.resolve(null);
    }
    // Prefer original file bytes — crop is persisted in crop_meta, not baked into pixels.
    if (state.draft.file) return readFileAsDataUrl(state.draft.file);
    // Remote URL without File (CORS fallback): fetch blob then data URL.
    return fetch(state.draft.url, { mode: "cors", credentials: "omit" })
      .then(function (res) {
        if (!res.ok) throw new Error("无法读取原图，请重新上传图片后再保存");
        return res.blob();
      })
      .then(function (blob) {
        var type = blob.type || "image/jpeg";
        var file = new File([blob], "homepage-banner.jpg", { type: type });
        state.draft.file = file;
        return readFileAsDataUrl(file);
      });
  }
  function applyDraftImage(file, url) {
    var img = new Image();
    img.onload = function () {
      var reused = !!(state.draft && state.draft.reused);
      state.draft = { file: file || null, url: url, reused: reused };
      state.natural = { width: img.naturalWidth, height: img.naturalHeight };
      if (!state.crop || state.crop.zoom == null) state.crop = { zoom: 1, x: 0, y: 0 };
      render();
      bind();
      requestAnimationFrame(function () {
        applyCropFrames();
        var stage = document.querySelector("[data-banner-crop-stage]");
        if (stage) stage.scrollIntoView({ behavior: "smooth", block: "center" });
      });
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
    state.crop = normalizeCropState(item.crop_meta || item.crop || {});
    var remote = item.image_url;
    fetch(remote, { mode: "cors", credentials: "omit" })
      .then(function (res) {
        if (!res.ok) throw new Error("fetch failed");
        return res.blob();
      })
      .then(function (blob) {
        var type = blob.type || "image/jpeg";
        var file = new File([blob], "banner-edit.jpg", { type: type });
        var url = URL.createObjectURL(blob);
        state.draft = { file: file, url: url, reused: true };
        applyDraftImage(file, url);
      })
      .catch(function () {
        state.draft = { file: null, url: remote, reused: true };
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
    resolvePublishImageData()
      .then(function (dataUrl) {
        var editingId = state.editingId;
        var crop = cropPayload();
        var mobileCrop = Object.assign({}, crop, { ratioW: 1080, ratioH: 1350, ratio: "1080:1350" });
        if (editingId) {
          var card = document.querySelector('[data-banner-id="' + editingId + '"]');
          var titleInput = card && card.querySelector('[data-banner-title="' + editingId + '"]');
          var linkInput = card && card.querySelector('[data-banner-link="' + editingId + '"]');
          var sortInput = card && card.querySelector('[data-banner-sort="' + editingId + '"]');
          var body = {
            action: "update",
            id: editingId,
            filename: (state.draft.file && state.draft.file.name) || "homepage-banner.jpg",
            title: titleInput ? titleInput.value : state.editMeta.title,
            link: linkInput ? linkInput.value : state.editMeta.link,
            button_link: linkInput ? linkInput.value : state.editMeta.link,
            sort_order: Number(sortInput && sortInput.value != null ? sortInput.value : state.editMeta.sort_order),
            is_main: true,
            is_active: true,
            crop: crop,
            crop_meta: crop,
            mobileCrop: mobileCrop,
            mobile_crop: mobileCrop,
            mobile_crop_meta: mobileCrop,
          };
          if (dataUrl) body.image_data = dataUrl;
          return apiPost(body);
        }
        if (!dataUrl) throw new Error("请先上传 Banner 图片");
        return apiPost({
          action: "publish",
          image_data: dataUrl,
          filename: (state.draft.file && state.draft.file.name) || "homepage-banner.jpg",
          is_main: true,
          is_active: true,
          crop: crop,
          crop_meta: crop,
          mobileCrop: mobileCrop,
          mobile_crop: mobileCrop,
          mobile_crop_meta: mobileCrop,
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
  function toggleActive(id) {
    var item = state.history.find(function (row) {
      return String(row.id) === String(id);
    });
    var next = !(item && item.is_active !== false);
    apiPost({ action: "toggle_active", id: id, is_active: next })
      .then(function (res) {
        alert(res.message || (next ? "Banner 已启用" : "Banner 已停用"));
        try {
          localStorage.setItem("mcj_banner_published_at", String(Date.now()));
          window.dispatchEvent(new Event("mcj:platform-data-updated"));
        } catch (e) {}
        return load();
      })
      .catch(function (err) {
        alert(err.message || "启用/停用失败");
      });
  }
  function previewHistory(id) {
    var list = activeBannersForPreview();
    var idx = list.findIndex(function (row) {
      return String(row.id) === String(id);
    });
    if (idx < 0) {
      var item = state.history.find(function (row) {
        return String(row.id) === String(id);
      });
      if (!item || !item.image_url) return;
      var live = document.querySelector("[data-banner-live-preview]");
      if (!live) return;
      live.innerHTML = '<img src="' + esc(item.image_url) + '" alt="Banner 预览">';
      scheduleApplyCropFrames();
      return;
    }
    state.previewIndex = idx;
    render();
    bind();
    watchLivePreviewFrame();
    scheduleApplyCropFrames();
  }
  function shiftPreview(delta) {
    var list = activeBannersForPreview();
    if (list.length < 2) return;
    state.previewIndex = (state.previewIndex + delta + list.length) % list.length;
    render();
    bind();
    watchLivePreviewFrame();
    scheduleApplyCropFrames();
  }
  function bind() {
    bindUploadZone();
    bindCropControls();
    var publishBtn = document.querySelector("[data-banner-publish]");
    if (publishBtn) publishBtn.onclick = publish;
    var cancelBtn = document.querySelector("[data-banner-cancel-edit]");
    if (cancelBtn) cancelBtn.onclick = cancelEdit;
    var prevBtn = document.querySelector("[data-banner-preview-prev]");
    if (prevBtn) prevBtn.onclick = function () { shiftPreview(-1); };
    var nextBtn = document.querySelector("[data-banner-preview-next]");
    if (nextBtn) nextBtn.onclick = function () { shiftPreview(1); };
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
    document.querySelectorAll("[data-banner-toggle-active]").forEach(function (btn) {
      btn.onclick = function () {
        toggleActive(btn.getAttribute("data-banner-toggle-active"));
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
  function onHashOrSection() {
    var hash = String(location.hash || "").replace(/^#/, "");
    var section = document.body && document.body.dataset ? document.body.dataset.adminSection : "";
    if (hash === "banners" || section === "banners") {
      if (window.MCJAdminAuthFetch && target()) load();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  window.addEventListener("hashchange", onHashOrSection);
  window.MCJAdminBannerManager = { reload: load };
})();
