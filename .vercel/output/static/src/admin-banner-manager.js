(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET_ID = "crud-banners";
  var ACCEPT = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  var MAX_BYTES = 8 * 1024 * 1024;
  var DESKTOP = { key: "desktop", label: "电脑端 Banner", ratioW: 1920, ratioH: 700, hint: "建议 1920×700 横图（景观）" };
  var MOBILE = { key: "mobile", label: "手机端 Banner", ratioW: 1080, ratioH: 1350, hint: "建议 1080×1350 竖图（平台统一竖版比例）" };
  var SLOTS = [DESKTOP, MOBILE];

  var state = {
    loading: true,
    publishing: false,
    uploadingSlot: "",
    error: "",
    message: "",
    current: null,
    history: [],
    drafts: { desktop: null, mobile: null },
    crops: { desktop: defaultCrop(DESKTOP), mobile: defaultCrop(MOBILE) },
    naturals: { desktop: { width: 0, height: 0 }, mobile: { width: 0, height: 0 } },
    formOpen: false,
    editingId: "",
    meta: defaultMeta(),
    clearMobile: false,
  };

  function defaultCrop(slot) {
    slot = slot || DESKTOP;
    return {
      zoom: 1,
      x: 0,
      y: 0,
      ratioW: slot.ratioW,
      ratioH: slot.ratioH,
      ratio: slot.ratioW + ":" + slot.ratioH,
    };
  }
  function slotSpec(key) {
    return key === "mobile" ? MOBILE : DESKTOP;
  }
  function clamp(n, min, max, fallback) {
    var v = Number(n);
    if (!Number.isFinite(v)) v = fallback;
    return Math.max(min, Math.min(max, v));
  }
  function normalizeCrop(raw, slot) {
    slot = slotSpec(slot && slot.key ? slot.key : slot);
    raw = raw && typeof raw === "object" ? raw : {};
    var zoom = clamp(raw.zoom != null ? raw.zoom : raw.scale, 1, 4, 1);
    var x = clamp(raw.x != null ? raw.x : raw.offsetX != null ? raw.offsetX : raw.nx, -1.5, 1.5, 0);
    var y = clamp(raw.y != null ? raw.y : raw.offsetY != null ? raw.offsetY : raw.ny, -1.5, 1.5, 0);
    if (Math.abs(x) > 2 || Math.abs(y) > 2) {
      x = clamp(x / 640, -1.5, 1.5, 0);
      y = clamp(y / 360, -1.5, 1.5, 0);
    }
    return {
      zoom: zoom,
      x: x,
      y: y,
      ratioW: slot.ratioW,
      ratioH: slot.ratioH,
      ratio: slot.ratioW + ":" + slot.ratioH,
    };
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function target() {
    return document.getElementById(TARGET_ID);
  }
  function bannerRoot() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      return window.MCJAdminOverlay.getBody();
    }
    return target();
  }
  function formatTime(value) {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleString("zh-CN", { hour12: false });
    } catch (e) {
      return String(value);
    }
  }
  function notifyHomepage() {
    try {
      localStorage.setItem("mcj_banner_published_at", String(Date.now()));
      window.dispatchEvent(new Event("mcj:platform-data-updated"));
    } catch (e) {}
  }
  function apiGet() {
    return Auth.get("/api/admin/banners");
  }
  function apiPost(body) {
    return Auth.post("/api/admin/banners", body);
  }
  function defaultMeta() {
    return {
      title: "",
      subtitle: "",
      link: "",
      sort_order: 100,
      is_active: true,
      is_main: false,
    };
  }
  function metaFromItem(item) {
    item = item || {};
    return {
      title: item.title || "",
      subtitle: item.subtitle || "",
      link: item.button_link || item.link || "",
      sort_order: item.sort_order == null ? 100 : Number(item.sort_order),
      is_active: item.is_active !== false,
      is_main: item.is_main === true,
    };
  }
  function readMetaFromDom(root) {
    root = root || bannerRoot();
    if (!root) return Object.assign({}, state.meta);
    var title = root.querySelector("[data-banner-meta-title]");
    var subtitle = root.querySelector("[data-banner-meta-subtitle]");
    var link = root.querySelector("[data-banner-meta-link]");
    var sort = root.querySelector("[data-banner-meta-sort]");
    var active = root.querySelector("[data-banner-meta-active]");
    var main = root.querySelector("[data-banner-meta-main]");
    return {
      title: title ? String(title.value || "").trim() : state.meta.title,
      subtitle: subtitle ? String(subtitle.value || "").trim() : state.meta.subtitle,
      link: link ? String(link.value || "").trim() : state.meta.link,
      sort_order: sort ? Number(sort.value) || 100 : state.meta.sort_order,
      is_active: active ? !!active.checked : state.meta.is_active,
      is_main: main ? !!main.checked : state.meta.is_main,
    };
  }
  function syncMetaFromDom() {
    state.meta = readMetaFromDom();
  }
  function applyList(res) {
    var list = res.banners || res.history || [];
    state.history = list;
    state.current =
      res.current ||
      list.find(function (b) {
        return b.is_main && b.is_active;
      }) ||
      list.find(function (b) {
        return b.is_active;
      }) ||
      null;
    state.message = res.message || "";
  }
  function load() {
    state.loading = true;
    state.error = "";
    renderAll();
    return apiGet()
      .then(function (res) {
        applyList(res);
      })
      .catch(function (err) {
        state.error = err.message || "Banner 读取失败";
        state.current = null;
        state.history = [];
      })
      .finally(function () {
        state.loading = false;
        renderAll();
      });
  }
  function revokeDraft(draft) {
    if (draft && draft.localUrl && String(draft.localUrl).indexOf("blob:") === 0) {
      try {
        URL.revokeObjectURL(draft.localUrl);
      } catch (e) {}
    }
  }
  function resetSlot(slotKey) {
    revokeDraft(state.drafts[slotKey]);
    state.drafts[slotKey] = null;
    state.crops[slotKey] = defaultCrop(slotSpec(slotKey));
    state.naturals[slotKey] = { width: 0, height: 0 };
    if (slotKey === "mobile") state.clearMobile = false;
  }
  function resetDrafts() {
    resetSlot("desktop");
    resetSlot("mobile");
    state.clearMobile = false;
  }
  function mimeOf(file) {
    var type = String((file && file.type) || "").toLowerCase();
    if (ACCEPT.indexOf(type) >= 0) return type === "image/jpg" ? "image/jpeg" : type;
    var name = String((file && file.name) || "").toLowerCase();
    if (/\.jpe?g$/.test(name)) return "image/jpeg";
    if (/\.png$/.test(name)) return "image/png";
    if (/\.webp$/.test(name)) return "image/webp";
    return "";
  }
  function validateFile(file) {
    if (!file) return "请选择图片文件。";
    if (!mimeOf(file)) return "仅支持 JPG、JPEG、PNG、WEBP 图片。";
    if (file.size > MAX_BYTES) return "图片不能超过 8MB，请压缩后再上传。";
    return "";
  }
  function coverBaseSize(natW, natH, frameW, frameH) {
    var imgRatio = natW / Math.max(1, natH);
    var frameRatio = frameW / Math.max(1, frameH);
    if (imgRatio > frameRatio) return { w: frameH * imgRatio, h: frameH };
    return { w: frameW, h: frameW / Math.max(0.0001, imgRatio) };
  }
  function previewUrl(slotKey) {
    var draft = state.drafts[slotKey];
    if (draft && draft.uploadedUrl) return draft.uploadedUrl;
    if (draft && draft.localUrl) return draft.localUrl;
    if (state.clearMobile && slotKey === "mobile") return "";
    if (state.editingId) {
      var item = state.history.find(function (b) {
        return String(b.id) === String(state.editingId);
      });
      if (item) {
        if (slotKey === "mobile") return item.mobile_image_url || "";
        return item.image_url || "";
      }
    }
    if (slotKey === "mobile") return (state.current && state.current.mobile_image_url) || "";
    return (state.current && state.current.image_url) || "";
  }
  function applyCropToImage(img, frame, slotKey) {
    if (!img || !frame) return;
    var slot = slotSpec(slotKey);
    var nat = state.naturals[slotKey] || {};
    var natW = nat.width || img.naturalWidth || slot.ratioW;
    var natH = nat.height || img.naturalHeight || slot.ratioH;
    var fw = Math.max(1, frame.clientWidth || frame.offsetWidth || 640);
    var fh = Math.max(1, frame.clientHeight || frame.offsetHeight || Math.round(fw / (slot.ratioW / slot.ratioH)));
    var crop = normalizeCrop(state.crops[slotKey], slot);
    var base = coverBaseSize(natW, natH, fw, fh);
    var w = base.w * crop.zoom;
    var h = base.h * crop.zoom;
    img.style.width = w + "px";
    img.style.height = h + "px";
    img.style.maxWidth = "none";
    img.style.left = "50%";
    img.style.top = "50%";
    img.style.transform = "translate(calc(-50% + " + crop.x * fw + "px), calc(-50% + " + crop.y * fh + "px))";
  }
  function refreshCropDom() {
    var root = bannerRoot();
    if (!root) return;
    root.querySelectorAll("[data-banner-crop-stage]").forEach(function (stage) {
      var slotKey = stage.getAttribute("data-banner-slot") || "desktop";
      var img = stage.querySelector("[data-banner-crop-img]");
      applyCropToImage(img, stage, slotKey);
      var crop = normalizeCrop(state.crops[slotKey], slotKey);
      var scale = root.querySelector('[data-banner-crop-scale][data-banner-slot="' + slotKey + '"]');
      var x = root.querySelector('[data-banner-crop-x][data-banner-slot="' + slotKey + '"]');
      var y = root.querySelector('[data-banner-crop-y][data-banner-slot="' + slotKey + '"]');
      if (scale) scale.value = String(crop.zoom);
      if (x) x.value = String(Math.round(crop.x * 100));
      if (y) y.value = String(Math.round(crop.y * 100));
    });
  }
  function renderMetaForm() {
    var m = state.meta || defaultMeta();
    return (
      '<div class="banner-ops-form-grid">' +
      '<label class="banner-ops-field">标题' +
      '<input type="text" data-banner-meta-title value="' +
      esc(m.title) +
      '" placeholder="可用 **文字** 标粉"></label>' +
      '<label class="banner-ops-field">副标题' +
      '<input type="text" data-banner-meta-subtitle value="' +
      esc(m.subtitle) +
      '" placeholder="最多两行展示"></label>' +
      '<label class="banner-ops-field">跳转链接' +
      '<input type="text" data-banner-meta-link value="' +
      esc(m.link) +
      '" placeholder="Discord / WhatsApp / Telegram / 站内路径 / https://"></label>' +
      '<label class="banner-ops-field">排序' +
      '<input type="number" data-banner-meta-sort min="0" max="9999" step="1" value="' +
      esc(m.sort_order) +
      '"></label>' +
      '<label class="banner-ops-check"><input type="checkbox" data-banner-meta-active' +
      (m.is_active !== false ? " checked" : "") +
      "> 是否启用</label>" +
      '<label class="banner-ops-check"><input type="checkbox" data-banner-meta-main' +
      (m.is_main ? " checked" : "") +
      "> 是否主 Banner（唯一）</label>" +
      "</div>"
    );
  }
  function renderCropWorkspace(slot, url) {
    if (!url) return "";
    var crop = normalizeCrop(state.crops[slot.key], slot);
    var ratioStyle = "aspect-ratio:" + slot.ratioW + "/" + slot.ratioH;
    return (
      '<div class="banner-ops-crop" data-banner-slot="' +
      slot.key +
      '">' +
      '<div class="banner-ops-crop-head">' +
      "<strong>裁切 · " +
      esc(slot.label) +
      "</strong>" +
      "<span>固定比例 " +
      slot.ratioW +
      "×" +
      slot.ratioH +
      " · 拖拽移动 · 滚轮/滑杆缩放</span>" +
      "</div>" +
      '<div class="banner-ops-crop-workspace">' +
      '<div class="banner-ops-crop-panel"><label>原图预览</label>' +
      '<div class="banner-ops-full-preview" style="' +
      ratioStyle +
      '"><img src="' +
      esc(url) +
      '" alt="原图" decoding="async"></div></div>' +
      '<div class="banner-ops-crop-panel"><label>最终预览（可拖拽）</label>' +
      '<div class="banner-ops-crop-stage" data-banner-crop-stage data-banner-slot="' +
      slot.key +
      '" style="' +
      ratioStyle +
      '" title="拖拽调整显示区域">' +
      '<img data-banner-crop-img src="' +
      esc(url) +
      '" alt="裁切预览" draggable="false" decoding="async">' +
      '<div class="banner-ops-crop-guide" aria-hidden="true"></div></div></div></div>' +
      '<div class="banner-ops-crop-controls">' +
      '<label>缩放<input type="range" data-banner-crop-scale data-banner-slot="' +
      slot.key +
      '" min="1" max="3" step="0.01" value="' +
      crop.zoom +
      '"></label>' +
      '<label>左右<input type="range" data-banner-crop-x data-banner-slot="' +
      slot.key +
      '" min="-100" max="100" step="1" value="' +
      Math.round(crop.x * 100) +
      '"></label>' +
      '<label>上下<input type="range" data-banner-crop-y data-banner-slot="' +
      slot.key +
      '" min="-100" max="100" step="1" value="' +
      Math.round(crop.y * 100) +
      '"></label>' +
      '<button class="mini-btn" type="button" data-banner-crop-reset data-banner-slot="' +
      slot.key +
      '">重置裁切</button>' +
      "</div></div>"
    );
  }
  function renderSlotUpload(slot) {
    var url = previewUrl(slot.key);
    var draft = state.drafts[slot.key];
    var uploaded = !!(draft && draft.uploadedUrl);
    var uploading = state.uploadingSlot === slot.key;
    var ratioStyle = "aspect-ratio:" + slot.ratioW + "/" + slot.ratioH;
    var warn =
      slot.key === "mobile" && !url
        ? '<div class="banner-ops-slot-warn">未上传手机端专属图时，手机首页会自动裁切电脑端横图，主体可能被切掉。请务必上传 1080×1350 竖图。</div>'
        : "";

    var body = "";
    if (uploading) {
      body =
        '<div class="banner-ops-upload has-draft is-uploading" data-banner-upload-zone data-banner-slot="' +
        slot.key +
        '">' +
        '<input class="banner-ops-file" type="file" accept="image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp" data-banner-file data-banner-slot="' +
        slot.key +
        '">' +
        '<div class="banner-ops-upload-overlay"><span>上传中...</span></div>' +
        (url ? '<img class="banner-ops-upload-preview" src="' + esc(url) + '" alt="">' : "") +
        "</div>";
    } else if (url) {
      body =
        renderCropWorkspace(slot, url) +
        '<div class="banner-ops-actions">' +
        '<button class="mini-btn danger" type="button" data-banner-clear-slot="' +
        slot.key +
        '">' +
        (slot.key === "mobile" ? "删除手机端图" : "删除并重选电脑端图") +
        "</button></div>" +
        '<div class="banner-ops-upload banner-ops-upload-replace" data-banner-upload-zone data-banner-slot="' +
        slot.key +
        '">' +
        '<input class="banner-ops-file" type="file" accept="image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp" data-banner-file data-banner-slot="' +
        slot.key +
        '">' +
        '<div class="banner-ops-upload-inner"><div class="banner-ops-upload-title">更换' +
        esc(slot.label) +
        '</div><div class="banner-ops-upload-hint">点击或拖拽替换 · ' +
        esc(slot.hint) +
        "</div></div></div>";
    } else {
      body =
        '<div class="banner-ops-upload" data-banner-upload-zone data-banner-slot="' +
        slot.key +
        '" style="' +
        ratioStyle +
        '">' +
        '<input class="banner-ops-file" type="file" accept="image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp" data-banner-file data-banner-slot="' +
        slot.key +
        '">' +
        '<div class="banner-ops-upload-inner">' +
        '<div class="banner-ops-upload-icon" aria-hidden="true">📷</div>' +
        '<div class="banner-ops-upload-title">上传' +
        esc(slot.label) +
        "</div>" +
        '<div class="banner-ops-upload-sub">点击或拖拽</div>' +
        '<div class="banner-ops-upload-hint">JPG / PNG / WEBP · 最大 8MB · ' +
        esc(slot.hint) +
        "</div></div></div>";
    }

    return (
      '<div class="banner-ops-slot' +
      (slot.key === "mobile" && !url ? " is-missing-mobile" : "") +
      '" data-banner-slot-card="' +
      slot.key +
      '">' +
      "<h4>" +
      esc(slot.label) +
      (slot.key === "desktop" ? ' <span class="banner-ops-slot-req">必填</span>' : ' <span class="banner-ops-slot-opt">推荐</span>') +
      "</h4>" +
      "<p>" +
      esc(slot.hint) +
      "</p>" +
      warn +
      body +
      "</div>"
    );
  }
  function renderSlots() {
    return (
      '<div class="banner-ops-slots">' +
      renderSlotUpload(DESKTOP) +
      renderSlotUpload(MOBILE) +
      "</div>" +
      (!previewUrl("mobile") && previewUrl("desktop")
        ? '<div class="banner-ops-slot-warn banner-ops-slot-warn-global">当前仅有电脑端图：手机端将自动裁切横图显示。强烈建议上传独立手机端竖图（1080×1350）。</div>'
        : "")
    );
  }
  function renderHistory() {
    if (!state.history.length) {
      return '<div class="admin-sync-note">暂无 Banner。点击上方「新增 Banner」创建第一张。</div>';
    }
    return (
      '<div class="banner-ops-history">' +
      state.history
        .map(function (item) {
          var active = item.is_active === true;
          var main = item.is_main === true;
          var title = item.title || "未命名 Banner";
          var hasMobile = !!(item.mobile_image_url || item.has_dedicated_mobile);
          return (
            '<article class="banner-ops-card' +
            (active ? " is-active" : "") +
            (main ? " is-main" : "") +
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
            '<div class="banner-ops-card-title">' +
            esc(title) +
            "</div>" +
            '<div class="banner-ops-card-meta"><span>排序 ' +
            esc(item.sort_order == null ? 100 : item.sort_order) +
            " · " +
            esc(formatTime(item.updated_at || item.created_at)) +
            "</span></div>" +
            '<div class="banner-ops-card-meta">' +
            (main ? '<span class="banner-ops-badge main">主 Banner</span>' : "") +
            (active
              ? '<span class="banner-ops-badge live">启用</span>'
              : '<span class="banner-ops-badge off">关闭</span>') +
            (hasMobile
              ? '<span class="banner-ops-badge live">双端图</span>'
              : '<span class="banner-ops-badge off">缺手机图</span>') +
            "</div>" +
            '<div class="banner-ops-card-actions">' +
            (main
              ? ""
              : '<button class="mini-btn primary-lite" type="button" data-banner-set-main="' +
                esc(item.id) +
                '">设为主</button>') +
            '<button class="mini-btn" type="button" data-banner-toggle="' +
            esc(item.id) +
            '" data-active="' +
            (active ? "1" : "0") +
            '">' +
            (active ? "关闭" : "启用") +
            "</button>" +
            '<button class="mini-btn" type="button" data-banner-edit="' +
            esc(item.id) +
            '">编辑</button>' +
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
  function overlayBodyHtml() {
    var canSave =
      !state.uploadingSlot &&
      !state.publishing &&
      (!!state.editingId || !!previewUrl("desktop"));
    return (
      '<div class="banner-ops-editor">' +
      '<section class="banner-ops-section">' +
      "<h3>" +
      (state.editingId ? "编辑 Banner" : "新增 Banner") +
      "</h3>" +
      "<p>同一条 Banner 记录，分别上传电脑端与手机端图片；标题/链接/排序/启用/主 Banner 共用。电脑端建议 1920×700；手机端统一 1080×1350 竖图。</p>" +
      renderMetaForm() +
      renderSlots() +
      (state.editingId
        ? '<div class="admin-sync-note">可只改文字、开关或裁切；未更换图片时原图保留。删除手机端图后保存会清空专属竖图。</div>'
        : '<div class="admin-sync-note">新建必须先上传电脑端图；手机端强烈建议一并上传。</div>') +
      '<div class="banner-ops-actions banner-ops-actions-sticky">' +
      '<button class="primary-btn" type="button" data-banner-publish ' +
      (canSave ? "" : "disabled") +
      ">" +
      (state.publishing ? "保存中…" : state.editingId ? "保存更新" : "保存并发布") +
      "</button>" +
      '<button class="mini-btn" type="button" data-banner-cancel-edit>取消</button>' +
      "</div></section></div>"
    );
  }
  function renderPage() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="banner-ops-loading">正在读取 Banner...</div>';
      return;
    }
    var thumbUrl = (state.current && state.current.image_url) || "";
    var mobileThumb = (state.current && state.current.mobile_image_url) || "";
    box.innerHTML =
      (state.error ? '<div class="admin-sync-note">' + esc(state.error) + "</div>" : "") +
      (state.message && !state.error ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="banner-ops">' +
      '<section class="banner-ops-section">' +
      "<h3>首页 Banner</h3>" +
      "<p>每条 Banner 一套文案 + 电脑端横图（1920×700）+ 手机端竖图（1080×1350）。主 Banner 优先，其余按排序轮播。</p>" +
      '<div class="banner-ops-current-thumbs">' +
      '<div class="banner-ops-preview banner-ops-preview-banner" data-banner-current-thumb>' +
      (thumbUrl
        ? '<img src="' + esc(thumbUrl) + '" alt="电脑端">'
        : '<div class="banner-ops-preview-empty">暂无 Banner</div>') +
      "</div>" +
      '<div class="banner-ops-preview banner-ops-preview-mobile" data-banner-current-mobile-thumb>' +
      (mobileThumb
        ? '<img src="' + esc(mobileThumb) + '" alt="手机端">'
        : '<div class="banner-ops-preview-empty">手机端未上传</div>') +
      "</div></div>" +
      '<div class="banner-ops-actions">' +
      '<button class="primary-btn" type="button" data-banner-create>新增 Banner</button>' +
      '<button class="mini-btn" type="button" data-banner-reload>刷新列表</button>' +
      "</div></section>" +
      '<section class="banner-ops-section"><h3>Banner 列表</h3>' +
      "<p>设为主、启用/关闭、编辑与删除会立刻同步首页。</p>" +
      renderHistory() +
      "</section>" +
      (!window.MCJAdminOverlay && state.formOpen ? overlayBodyHtml() : "") +
      "</div>";
  }
  function loadNaturalFromUrl(slotKey, url, done) {
    if (!url) {
      state.naturals[slotKey] = { width: 0, height: 0 };
      if (done) done();
      return;
    }
    var img = new Image();
    img.onload = function () {
      state.naturals[slotKey] = { width: img.naturalWidth, height: img.naturalHeight };
      if (done) done();
    };
    img.onerror = function () {
      state.naturals[slotKey] = { width: 0, height: 0 };
      if (done) done();
    };
    img.crossOrigin = "anonymous";
    img.src = url;
  }
  function hydrateSlotFromItem(slotKey, url, cropRaw) {
    var slot = slotSpec(slotKey);
    state.crops[slotKey] = normalizeCrop(cropRaw || {}, slot);
    if (!url) {
      state.drafts[slotKey] = null;
      state.naturals[slotKey] = { width: 0, height: 0 };
      return;
    }
    state.drafts[slotKey] = {
      file: null,
      localUrl: url,
      uploadedUrl: url,
      fromExisting: true,
    };
    loadNaturalFromUrl(slotKey, url, function () {
      requestAnimationFrame(refreshCropDom);
    });
  }
  function openCreateBanner() {
    resetDrafts();
    state.editingId = "";
    state.meta = defaultMeta();
    state.uploadingSlot = "";
    state.publishing = false;
    state.formOpen = true;
    renderAll();
  }
  function openBannerEditor(item) {
    syncMetaFromDom();
    resetDrafts();
    state.uploadingSlot = "";
    state.publishing = false;
    if (item) {
      state.editingId = item.id || "";
      state.meta = metaFromItem(item);
      hydrateSlotFromItem("desktop", item.image_url || "", item.crop_meta || item.crop);
      hydrateSlotFromItem("mobile", item.mobile_image_url || "", item.mobile_crop_meta || item.mobile_crop);
    } else {
      state.editingId = "";
      state.meta = defaultMeta();
    }
    state.formOpen = true;
    renderAll();
  }
  function closeBannerEditor() {
    state.formOpen = false;
    state.editingId = "";
    state.uploadingSlot = "";
    state.publishing = false;
    resetDrafts();
    state.meta = defaultMeta();
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
      renderPage();
      bind();
      return;
    }
    renderAll();
  }
  function syncBannerEditor() {
    if (!state.formOpen || !window.MCJAdminOverlay) return;
    if (window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.setTitle(state.editingId ? "编辑 Banner" : "新增 Banner");
      window.MCJAdminOverlay.setBody(overlayBodyHtml());
    } else {
      window.MCJAdminOverlay.open({
        title: state.editingId ? "编辑 Banner" : "新增 Banner",
        html: overlayBodyHtml(),
        onClose: function () {
          state.formOpen = false;
          state.editingId = "";
          state.uploadingSlot = "";
          state.publishing = false;
          resetDrafts();
          state.meta = defaultMeta();
          renderPage();
          bind();
        },
      });
    }
    requestAnimationFrame(refreshCropDom);
  }
  function renderAll() {
    renderPage();
    syncBannerEditor();
    bind();
    requestAnimationFrame(refreshCropDom);
  }
  function bindCropDrag(slotKey) {
    var root = bannerRoot();
    var stage = root && root.querySelector('[data-banner-crop-stage][data-banner-slot="' + slotKey + '"]');
    var img = stage && stage.querySelector("[data-banner-crop-img]");
    if (!stage || !img || stage.dataset.bound === "1") return;
    stage.dataset.bound = "1";
    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    function move(dx, dy) {
      var fw = Math.max(1, stage.clientWidth);
      var fh = Math.max(1, stage.clientHeight);
      var crop = state.crops[slotKey];
      crop.x = clamp(crop.x + dx / fw, -1.5, 1.5, 0);
      crop.y = clamp(crop.y + dy / fh, -1.5, 1.5, 0);
      refreshCropDom();
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
    stage.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        var delta = e.deltaY > 0 ? -0.05 : 0.05;
        state.crops[slotKey].zoom = clamp(state.crops[slotKey].zoom + delta, 1, 3, 1);
        refreshCropDom();
      },
      { passive: false }
    );
  }
  function bindCropControls() {
    var root = bannerRoot();
    if (!root) return;
    SLOTS.forEach(function (slot) {
      var key = slot.key;
      var scale = root.querySelector('[data-banner-crop-scale][data-banner-slot="' + key + '"]');
      var x = root.querySelector('[data-banner-crop-x][data-banner-slot="' + key + '"]');
      var y = root.querySelector('[data-banner-crop-y][data-banner-slot="' + key + '"]');
      var reset = root.querySelector('[data-banner-crop-reset][data-banner-slot="' + key + '"]');
      if (scale)
        scale.oninput = function () {
          state.crops[key].zoom = clamp(scale.value, 1, 3, 1);
          refreshCropDom();
        };
      if (x)
        x.oninput = function () {
          state.crops[key].x = clamp(Number(x.value) / 100, -1.5, 1.5, 0);
          refreshCropDom();
        };
      if (y)
        y.oninput = function () {
          state.crops[key].y = clamp(Number(y.value) / 100, -1.5, 1.5, 0);
          refreshCropDom();
        };
      if (reset)
        reset.onclick = function () {
          state.crops[key] = defaultCrop(slot);
          refreshCropDom();
        };
      bindCropDrag(key);
    });
  }
  function bindUploadZone() {
    var root = bannerRoot();
    if (!root) return;
    root.querySelectorAll("[data-banner-upload-zone]").forEach(function (zone) {
      if (zone.dataset.bound === "1") return;
      zone.dataset.bound = "1";
      var slotKey = zone.getAttribute("data-banner-slot") || "desktop";
      var input = zone.querySelector("[data-banner-file]");
      if (!input) return;
      input.addEventListener("change", function () {
        acceptFile(slotKey, input.files && input.files[0]);
        input.value = "";
      });
      ["dragenter", "dragover"].forEach(function (name) {
        zone.addEventListener(name, function (e) {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.add("is-dragover");
        });
      });
      ["dragleave", "drop"].forEach(function (name) {
        zone.addEventListener(name, function (e) {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.remove("is-dragover");
          if (name === "drop" && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
            acceptFile(slotKey, e.dataTransfer.files[0]);
          }
        });
      });
    });
  }
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("图片读取失败，请重新选择文件。"));
      };
      reader.readAsDataURL(file);
    });
  }
  function uploadSlotImage(slotKey) {
    var draft = state.drafts[slotKey];
    if (!draft) return Promise.reject(new Error("请先选择" + slotSpec(slotKey).label + "图片。"));
    if (draft.uploadedUrl && !draft.file) return Promise.resolve(draft.uploadedUrl);
    if (draft.uploadedUrl && draft.fromExisting && !draft.file) return Promise.resolve(draft.uploadedUrl);
    if (!draft.file) return Promise.reject(new Error("请先选择图片。"));
    if (draft.uploadedUrl && !draft.needsReupload) return Promise.resolve(draft.uploadedUrl);
    state.uploadingSlot = slotKey;
    renderAll();
    return fileToDataUrl(draft.file)
      .then(function (dataUrl) {
        return apiPost({
          action: "upload",
          image_data: dataUrl,
          filename: (draft.file && draft.file.name) || "homepage-banner-" + slotKey + ".jpg",
        });
      })
      .then(function (res) {
        var url = res.url || res.image_url || "";
        if (!url) throw new Error("上传成功但未返回图片地址。");
        if (!state.drafts[slotKey]) throw new Error("上传被取消，请重新选择图片。");
        state.drafts[slotKey].uploadedUrl = url;
        state.drafts[slotKey].needsReupload = false;
        state.uploadingSlot = "";
        if (slotKey === "mobile") state.clearMobile = false;
        renderAll();
        return url;
      })
      .catch(function (err) {
        state.uploadingSlot = "";
        renderAll();
        throw err;
      });
  }
  function acceptFile(slotKey, file) {
    var err = validateFile(file);
    if (err) {
      alert(err);
      return;
    }
    syncMetaFromDom();
    revokeDraft(state.drafts[slotKey]);
    var slot = slotSpec(slotKey);
    var localUrl = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      state.drafts[slotKey] = { file: file, localUrl: localUrl, uploadedUrl: "", needsReupload: true };
      state.naturals[slotKey] = { width: img.naturalWidth, height: img.naturalHeight };
      var imageRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
      var frameRatio = slot.ratioW / slot.ratioH;
      state.crops[slotKey] = defaultCrop(slot);
      state.crops[slotKey].zoom = imageRatio > frameRatio ? 1 : Math.min(3, frameRatio / imageRatio);
      if (slotKey === "mobile") state.clearMobile = false;
      state.formOpen = true;
      renderAll();
      uploadSlotImage(slotKey).catch(function (uploadErr) {
        alert(uploadErr.message || "图片上传失败，请重试。");
      });
    };
    img.onerror = function () {
      alert("图片读取失败，请换一张试试。");
      URL.revokeObjectURL(localUrl);
    };
    img.src = localUrl;
  }
  function ensureSlotUploaded(slotKey) {
    var draft = state.drafts[slotKey];
    if (!draft) return Promise.resolve("");
    if (draft.file && (!draft.uploadedUrl || draft.needsReupload)) return uploadSlotImage(slotKey);
    return Promise.resolve(draft.uploadedUrl || "");
  }
  function publish() {
    if (state.publishing || state.uploadingSlot) return;
    syncMetaFromDom();
    var meta = state.meta;
    var editingId = state.editingId;
    var desktopUrl = previewUrl("desktop");
    if (!desktopUrl) {
      alert("请先上传电脑端 Banner 图片。");
      return;
    }
    state.publishing = true;
    renderAll();

    Promise.all([ensureSlotUploaded("desktop"), ensureSlotUploaded("mobile")])
      .then(function (urls) {
        var desktopUploaded = urls[0] || desktopUrl;
        var mobileUploaded = urls[1] || "";
        var desktopCrop = normalizeCrop(state.crops.desktop, DESKTOP);
        var mobileCrop = normalizeCrop(state.crops.mobile, MOBILE);
        var desktopDraft = state.drafts.desktop;
        var mobileDraft = state.drafts.mobile;

        if (editingId) {
          var payload = {
            action: "update",
            id: editingId,
            title: meta.title,
            subtitle: meta.subtitle,
            button_link: meta.link,
            sort_order: meta.sort_order,
            is_active: meta.is_active,
            is_main: meta.is_main,
            crop_meta: desktopCrop,
            crop: desktopCrop,
            mobile_crop_meta: mobileCrop,
            mobile_crop: mobileCrop,
          };
          if (desktopDraft && desktopDraft.file && desktopUploaded) payload.image_url = desktopUploaded;
          if (state.clearMobile) {
            payload.clear_mobile_image = true;
            payload.mobile_image_url = "";
          } else if (mobileDraft && mobileDraft.file && mobileUploaded) {
            payload.mobile_image_url = mobileUploaded;
          } else if (mobileDraft && mobileDraft.uploadedUrl && !mobileDraft.fromExisting) {
            payload.mobile_image_url = mobileDraft.uploadedUrl;
          }
          return apiPost(payload);
        }

        var createPayload = {
          action: "publish",
          image_url: desktopUploaded,
          filename: (desktopDraft && desktopDraft.file && desktopDraft.file.name) || "homepage-banner-desktop.jpg",
          title: meta.title,
          subtitle: meta.subtitle,
          button_link: meta.link,
          sort_order: meta.sort_order,
          is_active: meta.is_active,
          is_main: meta.is_main,
          crop_meta: desktopCrop,
          crop: desktopCrop,
          mobile_crop_meta: mobileCrop,
          mobile_crop: mobileCrop,
        };
        if (mobileUploaded) {
          createPayload.mobile_image_url = mobileUploaded;
          createPayload.mobile_filename =
            (mobileDraft && mobileDraft.file && mobileDraft.file.name) || "homepage-banner-mobile.jpg";
        }
        return apiPost(createPayload);
      })
      .then(function (res) {
        alert(res.message || (editingId ? "Banner 已更新" : "Banner 发布成功"));
        resetDrafts();
        state.publishing = false;
        applyList(res);
        notifyHomepage();
        closeBannerEditor();
        return load();
      })
      .catch(function (err) {
        alert(err.message || "保存失败");
        state.publishing = false;
        renderAll();
      });
  }
  function setMain(id) {
    apiPost({ action: "set_main", id: id })
      .then(function (res) {
        notifyHomepage();
        applyList(res);
        return load();
      })
      .catch(function (err) {
        alert(err.message || "操作失败");
      });
  }
  function toggleActive(id, currentlyActive) {
    apiPost({ action: "set_active", id: id, is_active: !currentlyActive })
      .then(function (res) {
        notifyHomepage();
        applyList(res);
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
        notifyHomepage();
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
    var page = target();
    var live = page && page.querySelector("[data-banner-current-thumb]");
    var mobile = page && page.querySelector("[data-banner-current-mobile-thumb]");
    if (live) live.innerHTML = '<img src="' + esc(item.image_url) + '" alt="电脑端预览">';
    if (mobile) {
      mobile.innerHTML = item.mobile_image_url
        ? '<img src="' + esc(item.mobile_image_url) + '" alt="手机端预览">'
        : '<div class="banner-ops-preview-empty">手机端未上传</div>';
    }
  }
  function clearSlot(slotKey) {
    if (slotKey === "desktop") {
      if (!state.editingId) {
        resetSlot("desktop");
        renderAll();
        return;
      }
      if (!confirm("删除电脑端图后需重新上传才能保存。确定？")) return;
      resetSlot("desktop");
      renderAll();
      return;
    }
    if (!confirm("删除手机端专属图？保存后手机将回退裁切电脑端横图。")) return;
    resetSlot("mobile");
    state.clearMobile = true;
    renderAll();
  }
  function bindMetaInputs() {
    var root = bannerRoot();
    if (!root) return;
    root
      .querySelectorAll(
        "[data-banner-meta-title],[data-banner-meta-subtitle],[data-banner-meta-link],[data-banner-meta-sort],[data-banner-meta-active],[data-banner-meta-main]"
      )
      .forEach(function (el) {
        el.onchange = syncMetaFromDom;
        el.oninput = syncMetaFromDom;
      });
  }
  function bind() {
    bindUploadZone();
    bindCropControls();
    bindMetaInputs();
    var root = bannerRoot();
    var publishBtn = root && root.querySelector("[data-banner-publish]");
    if (publishBtn) publishBtn.onclick = publish;
    var cancelBtn = root && root.querySelector("[data-banner-cancel-edit]");
    if (cancelBtn) cancelBtn.onclick = closeBannerEditor;
    if (root) {
      root.querySelectorAll("[data-banner-clear-slot]").forEach(function (btn) {
        btn.onclick = function () {
          clearSlot(btn.getAttribute("data-banner-clear-slot") || "desktop");
        };
      });
    }

    var page = target();
    if (!page) return;
    var createBtn = page.querySelector("[data-banner-create]");
    if (createBtn) createBtn.onclick = openCreateBanner;
    var reloadBtn = page.querySelector("[data-banner-reload]");
    if (reloadBtn) reloadBtn.onclick = load;

    page.querySelectorAll("[data-banner-set-main]").forEach(function (btn) {
      btn.onclick = function () {
        setMain(btn.getAttribute("data-banner-set-main"));
      };
    });
    page.querySelectorAll("[data-banner-toggle]").forEach(function (btn) {
      btn.onclick = function () {
        toggleActive(btn.getAttribute("data-banner-toggle"), btn.getAttribute("data-active") === "1");
      };
    });
    page.querySelectorAll("[data-banner-edit]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-banner-edit");
        var item = state.history.find(function (row) {
          return String(row.id) === String(id);
        });
        if (item) openBannerEditor(item);
      };
    });
    page.querySelectorAll("[data-banner-delete]").forEach(function (btn) {
      btn.onclick = function () {
        removeBanner(btn.getAttribute("data-banner-delete"));
      };
    });
    page.querySelectorAll("[data-banner-preview]").forEach(function (btn) {
      btn.onclick = function () {
        previewHistory(btn.getAttribute("data-banner-preview"));
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
