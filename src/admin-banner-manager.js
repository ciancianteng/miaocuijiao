(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET_ID = "crud-banners";
  var ACCEPT = ["image/jpeg", "image/png", "image/webp"];
  var DESKTOP_RATIO = 1920 / 700;
  var MOBILE_RATIO = 1080 / 1350;
  var state = {
    loading: true,
    publishing: false,
    error: "",
    message: "",
    current: null,
    history: [],
    draft: null,
    mobileDraft: null,
    editingId: "",
    editMeta: { title: "", link: "", sort_order: 100, is_active: true },
    crop: { zoom: 1, x: 0, y: 0 },
    mobileCrop: { zoom: 1, x: 0, y: 0 },
    natural: { width: 0, height: 0 },
    mobileNatural: { width: 0, height: 0 },
    clearMobile: false,
  };
  function defaultEditMeta() {
    return { title: "", link: "", sort_order: 100, is_active: true };
  }

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
  function revokeBlobUrl(url) {
    if (url && String(url).indexOf("blob:") === 0) {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    }
  }
  function canPublish() {
    if (state.publishing) return false;
    if (state.draft && state.draft.url) return true;
    return !!(state.editingId && state.draft && state.draft.reused);
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
        requestAnimationFrame(function () {
          if (!state.draft && state.current) {
            state.crop = normalizeCropState(state.current.crop_meta || state.current.crop || {}, "desktop");
            state.mobileCrop = normalizeCropState(
              state.current.mobile_crop_meta || state.current.mobile_crop || {},
              "mobile"
            );
            applyCropFrames();
          }
        });
      });
  }
  function resetMobileDraft() {
    if (state.mobileDraft && state.mobileDraft.url) {
      revokeBlobUrl(state.mobileDraft.url);
    }
    state.mobileDraft = null;
    state.mobileCrop = { zoom: 1, x: 0, y: 0 };
    state.mobileNatural = { width: 0, height: 0 };
  }
  function resetDraft(keepEditing) {
    if (state.draft && state.draft.url) {
      revokeBlobUrl(state.draft.url);
    }
    state.draft = null;
    state.crop = { zoom: 1, x: 0, y: 0 };
    state.natural = { width: 0, height: 0 };
    resetMobileDraft();
    state.clearMobile = false;
    if (!keepEditing) {
      state.editingId = "";
      state.editMeta = defaultEditMeta();
    }
  }
  function syncEditMetaFromForm() {
    var title = document.querySelector("[data-banner-editor-title]");
    var link = document.querySelector("[data-banner-editor-link]");
    var sort = document.querySelector("[data-banner-editor-sort]");
    var enabled = document.querySelector("[data-banner-editor-enabled]");
    if (title) state.editMeta.title = String(title.value || "").trim();
    if (link) state.editMeta.link = String(link.value || "").trim();
    if (sort) {
      var n = Number(sort.value);
      state.editMeta.sort_order = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 100;
    }
    if (enabled) state.editMeta.is_active = !!enabled.checked;
  }
  function renderMetaForm() {
    var meta = state.editMeta || defaultEditMeta();
    var enabled = meta.is_active !== false;
    return (
      '<div class="banner-ops-form-grid" data-banner-editor-meta>' +
      '<label class="banner-ops-field">Banner 标题' +
      '<input type="text" maxlength="80" data-banner-editor-title value="' +
      esc(meta.title || "") +
      '" placeholder="请输入 Banner 标题"></label>' +
      '<label class="banner-ops-field">跳转链接' +
      '<input type="text" maxlength="240" data-banner-editor-link value="' +
      esc(meta.link || "") +
      '" placeholder="https:// 或站内路径"></label>' +
      '<label class="banner-ops-field">排序' +
      '<input type="number" min="0" step="1" data-banner-editor-sort value="' +
      esc(meta.sort_order != null ? meta.sort_order : 100) +
      '" placeholder="100"></label>' +
      '<label class="banner-ops-check"><input type="checkbox" data-banner-editor-enabled' +
      (enabled ? " checked" : "") +
      "> 启用状态（勾选=启用，取消=停用）</label>" +
      "</div>"
    );
  }
  function acceptFile(file, kind) {
    kind = kind === "mobile" ? "mobile" : "desktop";
    if (!file) return;
    if (ACCEPT.indexOf(file.type) < 0) {
      alert("仅支持 JPG、PNG、WEBP 图片。");
      return;
    }
    syncEditMetaFromForm();
    var preservedEditingId = state.editingId || "";
    var preservedMeta = Object.assign({}, state.editMeta || defaultEditMeta());
    var preservedDesktop = state.draft;
    var preservedMobile = state.mobileDraft;
    var preservedCrop = Object.assign({}, state.crop);
    var preservedMobileCrop = Object.assign({}, state.mobileCrop);
    var preservedNatural = Object.assign({}, state.natural);
    var preservedMobileNatural = Object.assign({}, state.mobileNatural);
    var preservedClearMobile = state.clearMobile;

    if (kind === "desktop") {
      if (state.draft && state.draft.url) revokeBlobUrl(state.draft.url);
      state.draft = null;
      state.crop = { zoom: 1, x: 0, y: 0 };
      state.natural = { width: 0, height: 0 };
    } else {
      if (state.mobileDraft && state.mobileDraft.url) revokeBlobUrl(state.mobileDraft.url);
      state.mobileDraft = null;
      state.mobileCrop = { zoom: 1, x: 0, y: 0 };
      state.mobileNatural = { width: 0, height: 0 };
      state.clearMobile = false;
    }

    state.editingId = preservedEditingId;
    state.editMeta = preservedMeta;
    if (kind === "desktop") {
      state.mobileDraft = preservedMobile;
      state.mobileCrop = preservedMobileCrop;
      state.mobileNatural = preservedMobileNatural;
      state.clearMobile = preservedClearMobile;
    } else {
      state.draft = preservedDesktop;
      state.crop = preservedCrop;
      state.natural = preservedNatural;
    }

    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      if (kind === "mobile") {
        state.mobileDraft = { file: file, url: url, reused: false };
        state.mobileNatural = { width: img.naturalWidth, height: img.naturalHeight };
        state.mobileCrop = { zoom: 1, x: 0, y: 0 };
        state.clearMobile = false;
      } else {
        state.draft = { file: file, url: url, reused: false };
        state.natural = { width: img.naturalWidth, height: img.naturalHeight };
        state.crop = { zoom: 1, x: 0, y: 0 };
      }
      render();
      bind();
      requestAnimationFrame(function () {
        applyCropFrames();
      });
    };
    img.onerror = function () {
      alert("图片读取失败，请换一张试试。");
      revokeBlobUrl(url);
    };
    img.src = url;
  }
  function acceptDesktopFile(file) {
    acceptFile(file, "desktop");
  }
  function acceptMobileFile(file) {
    acceptFile(file, "mobile");
  }
  function clearMobileImage() {
    syncEditMetaFromForm();
    resetMobileDraft();
    state.clearMobile = true;
    render();
    bind();
  }
  function cropApi() {
    return window.MCJBannerCrop || null;
  }
  function normalizeCropState(raw, kind) {
    var api = cropApi();
    var defaults =
      kind === "mobile" ? { ratioW: 1080, ratioH: 1350 } : { ratioW: 1920, ratioH: 700 };
    var fallback = kind === "mobile" ? state.mobileCrop : state.crop;
    var c = api && api.normalizeCrop ? api.normalizeCrop(raw || fallback, defaults) : raw || fallback;
    return {
      zoom: Number(c.zoom != null ? c.zoom : c.scale) || 1,
      x: Number(c.x != null ? c.x : c.offsetX) || 0,
      y: Number(c.y != null ? c.y : c.offsetY) || 0,
    };
  }
  function cropPayload() {
    var c = normalizeCropState(state.crop, "desktop");
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
  function mobileCropPayload() {
    var c = normalizeCropState(state.mobileCrop, "mobile");
    return {
      zoom: c.zoom,
      scale: c.zoom,
      x: c.x,
      y: c.y,
      offsetX: c.x,
      offsetY: c.y,
      ratioW: 1080,
      ratioH: 1350,
      ratio: "1080:1350",
    };
  }
  function applyCropFrames() {
    var api = cropApi();
    if (!api || !api.applyCropToImg) return;
    var desktopCrop = cropPayload();
    var mobileCrop = mobileCropPayload();
    var pairs = [
      [document.querySelector("[data-banner-crop-img]"), document.querySelector("[data-banner-crop-stage]"), desktopCrop],
      [document.querySelector("[data-banner-live-preview] img"), document.querySelector("[data-banner-live-preview]"), desktopCrop],
      [document.querySelector("[data-banner-mobile-crop-img]"), document.querySelector("[data-banner-mobile-crop-stage]"), mobileCrop],
      [document.querySelector("[data-banner-mobile-preview] img"), document.querySelector("[data-banner-mobile-preview]"), mobileCrop],
    ];
    pairs.forEach(function (pair) {
      var img = pair[0];
      var frame = pair[1];
      var crop = pair[2];
      if (!img || !frame) return;
      function run() {
        api.applyCropToImg(img, frame, crop);
      }
      if (img.complete && img.naturalWidth) run();
      else img.addEventListener("load", run, { once: true });
    });
  }
  function renderUploadPanel(kind) {
    var isMobile = kind === "mobile";
    var draft = isMobile ? state.mobileDraft : state.draft;
    var crop = isMobile ? state.mobileCrop : state.crop;
    var zoneAttr = isMobile ? "data-banner-mobile-upload-zone" : "data-banner-upload-zone";
    var fileAttr = isMobile ? "data-banner-mobile-file" : "data-banner-file";
    var stageAttr = isMobile ? "data-banner-mobile-crop-stage" : "data-banner-crop-stage";
    var imgAttr = isMobile ? "data-banner-mobile-crop-img" : "data-banner-crop-img";
    var scaleAttr = isMobile ? "data-banner-mobile-crop-scale" : "data-banner-crop-scale";
    var xAttr = isMobile ? "data-banner-mobile-crop-x" : "data-banner-crop-x";
    var yAttr = isMobile ? "data-banner-mobile-crop-y" : "data-banner-crop-y";
    var title = isMobile ? "手机端 Banner 图片" : "电脑端 Banner 图片";
    var ratioHint = isMobile ? "比例 1080×1350（竖屏）" : "比例 1920×700（横屏）";
    var reqBadge = isMobile
      ? '<span class="banner-ops-slot-opt">可选</span>'
      : '<span class="banner-ops-slot-req">必填</span>';
    var stageClass = isMobile
      ? "banner-ops-crop-stage banner-ops-crop-stage-mobile"
      : "banner-ops-crop-stage";
    var clearBtn = isMobile
      ? '<button class="mini-btn" type="button" data-banner-clear-mobile">清除手机图</button>'
      : "";
    var head =
      '<div class="banner-ops-crop-head"><strong>' +
      title +
      "</strong> " +
      reqBadge +
      " <span>" +
      ratioHint +
      "</span></div>";

    if (draft && draft.url) {
      return (
        '<div class="banner-ops-upload-panel" data-banner-slot-card="' +
        (isMobile ? "mobile" : "desktop") +
        '">' +
        head +
        '<div class="banner-ops-crop">' +
        '<div class="' +
        stageClass +
        '" ' +
        stageAttr +
        ">" +
        "<img " +
        imgAttr +
        ' src="' +
        esc(draft.url) +
        '" alt="">' +
        "</div>" +
        '<div class="banner-ops-crop-controls">' +
        "<label>缩放<input type=\"range\" " +
        scaleAttr +
        ' min="1" max="3" step="0.01" value="' +
        crop.zoom +
        '"></label>' +
        "<label>左右位置<input type=\"range\" " +
        xAttr +
        ' min="-1" max="1" step="0.01" value="' +
        crop.x +
        '"></label>' +
        "<label>上下位置<input type=\"range\" " +
        yAttr +
        ' min="-1" max="1" step="0.01" value="' +
        crop.y +
        '"></label>' +
        clearBtn +
        "</div>" +
        '<p class="admin-sync-note">' +
        (isMobile
          ? "缩放 / 左右 / 上下会写入 mobile_crop_meta，手机首页用同一套参数渲染。"
          : "缩放 / 左右 / 上下会写入 crop_meta，首页用同一套参数渲染。") +
        "</p>" +
        '<div class="banner-ops-upload banner-ops-upload-replace" ' +
        zoneAttr +
        ">" +
        '<input class="banner-ops-file" type="file" accept="image/jpeg,image/png,image/webp" ' +
        fileAttr +
        ' tabindex="-1" aria-hidden="true">' +
        '<div class="banner-ops-upload-inner">' +
        '<div class="banner-ops-upload-title">更换图片</div>' +
        '<div class="banner-ops-upload-hint">点击或拖拽替换</div>' +
        "</div></div></div></div>"
      );
    }

    return (
      '<div class="banner-ops-upload-panel" data-banner-slot-card="' +
      (isMobile ? "mobile" : "desktop") +
      '">' +
      head +
      (isMobile && state.clearMobile
        ? '<div class="admin-sync-note">已标记清除手机图，保存后将移除现有手机端图片。</div>'
        : "") +
      '<div class="banner-ops-upload" ' +
      zoneAttr +
      ">" +
      '<input class="banner-ops-file" type="file" accept="image/jpeg,image/png,image/webp" ' +
      fileAttr +
      ' tabindex="-1" aria-hidden="true">' +
      '<div class="banner-ops-upload-inner">' +
      '<div class="banner-ops-upload-icon" aria-hidden="true">📷</div>' +
      '<div class="banner-ops-upload-title">拖拽图片到这里</div>' +
      '<div class="banner-ops-upload-sub">或点击上传</div>' +
      '<div class="banner-ops-upload-hint">支持 JPG / PNG / WEBP · ' +
      ratioHint +
      "</div>" +
      "</div></div>" +
      (isMobile
        ? '<div class="banner-ops-actions" style="margin-top:8px">' + clearBtn + "</div>"
        : "") +
      "</div>"
    );
  }
  function renderDualUpload() {
    return (
      '<div class="banner-ops-dual-upload">' +
      renderUploadPanel("desktop") +
      renderUploadPanel("mobile") +
      "</div>"
    );
  }
  function renderPreviewGrid() {
    var desktopUrl =
      (state.draft && state.draft.url) || (state.current && state.current.image_url) || "";
    var mobileUrl =
      (state.mobileDraft && state.mobileDraft.url) ||
      (!state.clearMobile && state.current && state.current.mobile_image_url) ||
      "";
    return (
      '<div class="banner-ops-preview-grid">' +
      '<div class="banner-ops-preview-col">' +
      "<h4>电脑端预览</h4>" +
      '<div class="banner-ops-preview" data-banner-live-preview>' +
      (desktopUrl
        ? '<img src="' + esc(desktopUrl) + '" alt="电脑端 Banner">'
        : '<div class="banner-ops-preview-empty">暂无电脑端 Banner</div>') +
      "</div></div>" +
      '<div class="banner-ops-preview-col banner-ops-preview-col-mobile">' +
      "<h4>手机端预览</h4>" +
      '<div class="banner-ops-preview banner-ops-preview-mobile" data-banner-mobile-preview>' +
      (mobileUrl
        ? '<img src="' + esc(mobileUrl) + '" alt="手机端 Banner">'
        : '<div class="banner-ops-preview-empty">暂无手机端 Banner</div>') +
      "</div></div></div>"
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
          var sortOrder = item.sort_order != null ? item.sort_order : 100;
          var hasMobile = !!(item.mobile_image_url && String(item.mobile_image_url).trim());
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
            '<strong class="banner-ops-card-title">' +
            esc(item.title || "(未命名 Banner)") +
            "</strong>" +
            '<div class="banner-ops-card-meta"><span>' +
            esc(formatTime(item.created_at)) +
            "</span>" +
            '<span class="banner-ops-badge">排序 ' +
            esc(sortOrder) +
            "</span>" +
            (hasMobile ? '<span class="banner-ops-badge live">有手机图</span>' : "") +
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
            esc(sortOrder) +
            '" data-banner-sort="' +
            esc(item.id) +
            '" style="width:72px"></label>' +
            '<button class="mini-btn primary-lite" type="button" data-banner-edit="' +
            esc(item.id) +
            '">编辑</button>' +
            '<button class="mini-btn" type="button" data-banner-save-meta="' +
            esc(item.id) +
            '">快捷保存</button>' +
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
      ? "保存中…"
      : editing
        ? "保存修改"
        : "保存并发布";
    var publishDisabled = state.publishing || !canPublish();
    box.innerHTML =
      (state.error ? '<div class="admin-sync-note">' + esc(state.error) + "</div>" : "") +
      (state.message && !state.error ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="banner-ops">' +
      '<section class="banner-ops-section">' +
      "<h3>首页 Banner 实时预览</h3>" +
      "<p>左侧电脑端（约 1920×700），右侧手机端（约 1080×1350）。保存成功后首页会读取当前启用 Banner。</p>" +
      renderPreviewGrid() +
      "</section>" +
      '<section class="banner-ops-section" data-banner-editor>' +
      "<h3>" +
      (editing ? "编辑 Banner" : "新 Banner 编辑区") +
      "</h3>" +
      "<p>" +
      (editing
        ? "已加载历史 Banner。可分别修改电脑端/手机端图片与裁剪，以及标题、链接、排序、启用状态，确认后点「保存修改」。"
        : "发布前请完成电脑端图片（必填）与裁剪；手机端图片可选。确认标题、链接、排序与启用状态后再点「保存并发布」。") +
      "</p>" +
      (editing
        ? '<div class="admin-sync-note">编辑中：' +
          esc(state.editingId) +
          " · 保存修改会覆盖该条 Banner，不会新建。</div>"
        : "") +
      renderMetaForm() +
      renderDualUpload() +
      (state.draft
        ? '<div class="admin-sync-note">电脑端图片已选择，请确认标题/链接/裁剪后点击下方「' +
          (editing ? "保存修改" : "保存并发布") +
          '」，否则不会写入首页。手机端图片为可选项。</div>'
        : '<div class="admin-sync-note">可先填写标题、链接、排序与启用状态，再上传电脑端图片；未点击「' +
          (editing ? "保存修改" : "保存并发布") +
          '」前不会发布到首页。</div>') +
      '<div class="banner-ops-actions">' +
      '<button class="primary-btn" type="button" data-banner-publish ' +
      (publishDisabled ? "disabled" : "") +
      ">" +
      publishLabel +
      "</button>" +
      (editing
        ? '<button class="mini-btn" type="button" data-banner-cancel-edit">取消编辑</button>'
        : '<button class="mini-btn" type="button" data-banner-reset-new">清空草稿</button>') +
      "</div></section>" +
      '<section class="banner-ops-section">' +
      "<h3>历史 Banner</h3>" +
      "<p>点「编辑」将该 Banner 完整加载到上方编辑区。每张 Banner 均可：编辑 / 启用停用 / 删除。首页与后台共用同一数据表 <code>banners</code>（公开接口 <code>/api/platform/content?types=banners</code>）。删除后首页立即消失，无默认蓝色兜底图。</p>" +
      renderHistory() +
      "</section></div>";
  }
  function bindCropDrag(stageSel, imgSel, cropKey, xSel, ySel) {
    var stage = document.querySelector(stageSel);
    var img = document.querySelector(imgSel);
    if (!stage || !img || stage.dataset.bound === "1") return;
    stage.dataset.bound = "1";
    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    function move(dx, dy) {
      var fw = Math.max(1, stage.clientWidth || 1);
      var fh = Math.max(1, stage.clientHeight || 1);
      var crop = state[cropKey];
      crop.x = Math.max(-1.5, Math.min(1.5, crop.x + dx / fw));
      crop.y = Math.max(-1.5, Math.min(1.5, crop.y + dy / fh));
      applyCropFrames();
      var xInput = document.querySelector(xSel);
      var yInput = document.querySelector(ySel);
      if (xInput) xInput.value = String(crop.x);
      if (yInput) yInput.value = String(crop.y);
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
    var mScale = document.querySelector("[data-banner-mobile-crop-scale]");
    var mX = document.querySelector("[data-banner-mobile-crop-x]");
    var mY = document.querySelector("[data-banner-mobile-crop-y]");
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
    if (mScale)
      mScale.oninput = function () {
        state.mobileCrop.zoom = Math.max(1, Number(mScale.value) || 1);
        apply();
      };
    if (mX)
      mX.oninput = function () {
        state.mobileCrop.x = Number(mX.value) || 0;
        apply();
      };
    if (mY)
      mY.oninput = function () {
        state.mobileCrop.y = Number(mY.value) || 0;
        apply();
      };
    bindCropDrag(
      "[data-banner-crop-stage]",
      "[data-banner-crop-img]",
      "crop",
      "[data-banner-crop-x]",
      "[data-banner-crop-y]"
    );
    bindCropDrag(
      "[data-banner-mobile-crop-stage]",
      "[data-banner-mobile-crop-img]",
      "mobileCrop",
      "[data-banner-mobile-crop-x]",
      "[data-banner-mobile-crop-y]"
    );
    requestAnimationFrame(function () {
      applyCropFrames();
    });
  }
  function bindOneUploadZone(zoneSel, fileSel, acceptFn) {
    var zone = document.querySelector(zoneSel);
    var input = zone && zone.querySelector(fileSel);
    if (!zone || !input || zone.dataset.bound === "1") return;
    zone.dataset.bound = "1";
    input.disabled = false;
    input.removeAttribute("disabled");
    input.style.pointerEvents = "auto";
    // Transparent full-zone <input type="file"> must receive the real user click.
    // Never preventDefault / stopPropagation on click — that cancels the OS file picker.
    zone.addEventListener("click", function (e) {
      if (e.target === input || (input.contains && input.contains(e.target))) return;
      try {
        input.click();
      } catch (err) {
        console.error("[Banner 管理] 打开文件选择器失败", err);
      }
    });
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      acceptFn(file);
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
      if (file) acceptFn(file);
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
  function bindUploadZone() {
    bindOneUploadZone("[data-banner-upload-zone]", "[data-banner-file]", acceptDesktopFile);
    bindOneUploadZone(
      "[data-banner-mobile-upload-zone]",
      "[data-banner-mobile-file]",
      acceptMobileFile
    );
  }
  function uploadBannerFileDirect(file, slot) {
    if (!file) return Promise.reject(new Error("没有可上传的图片文件"));
    if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error("Banner 图片不能超过 10MB"));
    var kind = slot === "mobile" ? "mobile" : "desktop";
    state.message = kind === "mobile" ? "正在直传手机端 Banner…" : "正在直传电脑端 Banner…";
    render();
    return apiPost({
      action: "prepare_upload",
      slot: kind,
      filename: file.name || "banner-" + kind + ".jpg",
      mimeType: file.type || "image/jpeg",
      size: file.size || 0,
    }).then(function (prep) {
      if (!prep || !prep.signedUrl || !prep.path) throw new Error("签发直传凭证失败");
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("PUT", prep.signedUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || prep.contentType || "image/jpeg");
        xhr.setRequestHeader("x-upsert", "true");
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(prep);
            return;
          }
          var detail = "";
          try {
            detail = xhr.responseText ? String(xhr.responseText).slice(0, 200) : "";
          } catch (e) {}
          reject(new Error(detail || "Banner 直传失败：HTTP " + xhr.status));
        };
        xhr.onerror = function () {
          reject(new Error("Banner 直传网络失败，请稍后重试"));
        };
        xhr.send(file);
      }).then(function (prepDone) {
        return apiPost({
          action: "confirm_upload",
          bucket: prepDone.bucket,
          path: prepDone.path,
        }).then(function (confirmed) {
          return {
            url: (confirmed && (confirmed.publicUrl || confirmed.url)) || prepDone.publicUrl,
            path: prepDone.path,
            bucket: prepDone.bucket,
            slot: kind,
          };
        });
      });
    });
  }
  function resolveDesktopUpload() {
    if (!state.draft) return Promise.reject(new Error("没有可发布的图片"));
    // Crop-only update on existing banner: persist crop_meta without re-uploading bytes.
    if (state.draft.reused && state.editingId) {
      return Promise.resolve(null);
    }
    if (state.draft.file) return uploadBannerFileDirect(state.draft.file, "desktop");
    if (state.draft.url && /^https?:\/\//i.test(state.draft.url)) {
      return Promise.resolve({ url: state.draft.url, path: "", bucket: "", slot: "desktop" });
    }
    return Promise.reject(new Error("请先上传电脑端 Banner 图片"));
  }
  function resolveMobileUpload() {
    if (!state.mobileDraft) return Promise.resolve(null);
    if (state.mobileDraft.reused) return Promise.resolve(null);
    if (state.mobileDraft.file) return uploadBannerFileDirect(state.mobileDraft.file, "mobile");
    if (state.mobileDraft.url && /^https?:\/\//i.test(state.mobileDraft.url)) {
      return Promise.resolve({ url: state.mobileDraft.url, path: "", bucket: "", slot: "mobile" });
    }
    return Promise.resolve(null);
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
      revokeBlobUrl(url);
      resetDraft(false);
      render();
      bind();
    };
    img.src = url;
  }
  function applyMobileDraftImage(file, url, reused) {
    var img = new Image();
    img.onload = function () {
      state.mobileDraft = { file: file || null, url: url, reused: !!reused };
      state.mobileNatural = { width: img.naturalWidth, height: img.naturalHeight };
      if (!state.mobileCrop || state.mobileCrop.zoom == null) {
        state.mobileCrop = { zoom: 1, x: 0, y: 0 };
      }
      state.clearMobile = false;
      render();
      bind();
      requestAnimationFrame(function () {
        applyCropFrames();
      });
    };
    img.onerror = function () {
      revokeBlobUrl(url);
      state.mobileDraft = { file: null, url: url, reused: !!reused };
      state.clearMobile = false;
      render();
      bind();
      requestAnimationFrame(function () {
        applyCropFrames();
      });
    };
    img.src = url;
  }
  function loadMobileForEdit(item) {
    var remote = item && item.mobile_image_url ? String(item.mobile_image_url).trim() : "";
    if (!remote) {
      resetMobileDraft();
      state.clearMobile = false;
      return;
    }
    state.mobileCrop = normalizeCropState(item.mobile_crop_meta || item.mobile_crop || {}, "mobile");
    state.clearMobile = false;
    fetch(remote, { mode: "cors", credentials: "omit" })
      .then(function (res) {
        if (!res.ok) throw new Error("fetch failed");
        return res.blob();
      })
      .then(function (blob) {
        var type = blob.type || "image/jpeg";
        var file = new File([blob], "banner-edit-mobile.jpg", { type: type });
        var url = URL.createObjectURL(blob);
        state.mobileDraft = { file: file, url: url, reused: true };
        applyMobileDraftImage(file, url, true);
      })
      .catch(function () {
        state.mobileDraft = { file: null, url: remote, reused: true };
        applyMobileDraftImage(null, remote, true);
      });
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
      is_active: item.is_active !== false,
    };
    state.crop = normalizeCropState(item.crop_meta || item.crop || {}, "desktop");
    state.mobileCrop = normalizeCropState(item.mobile_crop_meta || item.mobile_crop || {}, "mobile");
    state.message = "正在加载 Banner 到编辑区…";
    state.error = "";
    render();
    bind();
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
        loadMobileForEdit(item);
      })
      .catch(function () {
        state.draft = { file: null, url: remote, reused: true };
        applyDraftImage(null, remote);
        loadMobileForEdit(item);
      });
  }
  function cancelEdit() {
    resetDraft(false);
    render();
    bind();
  }
  function publish() {
    if (state.publishing) return;
    syncEditMetaFromForm();
    if (!state.draft) {
      alert("请先上传电脑端 Banner 图片");
      return;
    }
    if (!state.editingId && !(state.draft.file || state.draft.url)) {
      alert("请先上传电脑端 Banner 图片");
      return;
    }
    state.publishing = true;
    state.error = "";
    state.message = state.editingId ? "保存修改中…" : "上传中/发布中…";
    render();
    Promise.all([resolveDesktopUpload(), resolveMobileUpload()])
      .then(function (results) {
        var desktopUp = results[0];
        var mobileUp = results[1];
        var editingId = state.editingId;
        var crop = cropPayload();
        var mobileCrop = mobileCropPayload();
        var meta = state.editMeta || defaultEditMeta();
        var title = String(meta.title || "").trim();
        var link = String(meta.link || "").trim();
        var sortOrder = Number(meta.sort_order);
        if (!Number.isFinite(sortOrder)) sortOrder = 100;
        var isActive = meta.is_active !== false;
        // Do NOT set is_main from is_active — that broke sort order.
        var shared = {
          title: title,
          link: link,
          button_link: link,
          sort_order: sortOrder,
          is_active: isActive,
          crop: crop,
          crop_meta: crop,
          mobile_crop_meta: mobileCrop,
        };
        if (editingId) {
          var body = Object.assign(
            {
              action: "update",
              id: editingId,
              filename: (state.draft.file && state.draft.file.name) || "homepage-banner.jpg",
            },
            shared
          );
          if (desktopUp && desktopUp.path) {
            body.storage_path = desktopUp.path;
            body.bucket = desktopUp.bucket;
            body.image_url = desktopUp.url;
          } else if (desktopUp && desktopUp.url) {
            body.image_url = desktopUp.url;
          }
          if (mobileUp && mobileUp.path) {
            body.mobile_storage_path = mobileUp.path;
            body.mobile_bucket = mobileUp.bucket;
            body.mobile_image_url = mobileUp.url;
          } else if (mobileUp && mobileUp.url) {
            body.mobile_image_url = mobileUp.url;
          }
          if (state.clearMobile) body.clear_mobile_image = true;
          return apiPost(body);
        }
        if (!desktopUp || !desktopUp.url) throw new Error("请先上传电脑端 Banner 图片");
        var publishBody = Object.assign(
          {
            action: "publish",
            filename: (state.draft.file && state.draft.file.name) || "homepage-banner.jpg",
            image_url: desktopUp.url,
          },
          shared
        );
        if (desktopUp.path) {
          publishBody.storage_path = desktopUp.path;
          publishBody.bucket = desktopUp.bucket;
        }
        if (mobileUp && mobileUp.url) {
          publishBody.mobile_image_url = mobileUp.url;
          publishBody.mobile_filename =
            (state.mobileDraft && state.mobileDraft.file && state.mobileDraft.file.name) ||
            "homepage-banner-mobile.jpg";
          if (mobileUp.path) {
            publishBody.mobile_storage_path = mobileUp.path;
            publishBody.mobile_bucket = mobileUp.bucket;
          }
        }
        return apiPost(publishBody);
      })
      .then(function (res) {
        var okMsg =
          res.message || (state.editingId ? "Banner 已保存修改" : "Banner 已保存并发布");
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
    if (!confirm("确认删除这张 Banner？删除后首页将立即同步移除，且无法恢复。")) return;
    apiPost({ action: "delete", id: id })
      .then(function (res) {
        alert(res.message || "已删除");
        try {
          localStorage.setItem("mcj_banner_published_at", String(Date.now()));
          window.dispatchEvent(new Event("mcj:platform-data-updated"));
        } catch (e) {}
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
  function bindMetaForm() {
    var root = document.querySelector("[data-banner-editor-meta]");
    if (!root || root.dataset.bound === "1") return;
    root.dataset.bound = "1";
    root.addEventListener("input", function () {
      syncEditMetaFromForm();
    });
    root.addEventListener("change", function () {
      syncEditMetaFromForm();
    });
  }
  function bind() {
    bindUploadZone();
    bindCropControls();
    bindMetaForm();
    var publishBtn = document.querySelector("[data-banner-publish]");
    if (publishBtn) publishBtn.onclick = publish;
    var cancelBtn = document.querySelector("[data-banner-cancel-edit]");
    if (cancelBtn) cancelBtn.onclick = cancelEdit;
    var clearMobileBtn = document.querySelector("[data-banner-clear-mobile]");
    if (clearMobileBtn) clearMobileBtn.onclick = clearMobileImage;
    var resetNewBtn = document.querySelector("[data-banner-reset-new]");
    if (resetNewBtn)
      resetNewBtn.onclick = function () {
        resetDraft(false);
        state.message = "";
        state.error = "";
        render();
        bind();
      };
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
