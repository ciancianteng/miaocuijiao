(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET_ID = "gameManagement";
  var DEFAULT_ICONS = ["🎮", "🎤", "⚔️", "🛡️", "🎯", "🎲", "💬"];
  var DEFAULT_POSITIONS = [
    { key: "home", label: "首页" },
    { key: "gameplay", label: "更多玩法" },
    { key: "cs_order", label: "客服建单" },
    { key: "companion_apply", label: "陪玩申请" },
    { key: "companion_profile", label: "陪玩资料编辑" },
    { key: "boss_order", label: "老板下单" },
  ];
  var ORDER_TYPES = [
    { value: "text", label: "单行文字" },
    { value: "textarea", label: "多行文字" },
    { value: "number", label: "数字" },
    { value: "select", label: "选项" },
  ];
  var state = {
    loading: true,
    saving: false,
    error: "",
    message: "",
    services: [],
    categories: ["手游", "端游", "语音", "娱乐", "定制", "其他"],
    icons: DEFAULT_ICONS.slice(),
    positions: DEFAULT_POSITIONS.slice(),
    editing: null,
    formOpen: false,
    formDirty: false,
    editorDirty: false,
    editorField: "",
    allowClose: false,
    historyArmed: false,
    ignorePop: false,
    draftTimer: 0,
    vvHeight: 0,
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

  function flagLabel(value, onText, offText) {
    return value === false ? offText : onText;
  }

  function statusChip(text, ok) {
    return '<span class="status ' + (ok ? "ok" : "wait") + '">' + esc(text) + "</span>";
  }

  function apiGet() {
    return Auth.get("/api/admin/services");
  }

  function apiPost(body) {
    return Auth.post("/api/admin/services", body);
  }

  function positionsOf(item) {
    var list = (item && (item.displayPositions || item.display_positions)) || [];
    if (!Array.isArray(list) || !list.length) {
      list = [];
      if (!item || item.showHome !== false) list.push("home");
      if (!item || item.allowApply !== false) list.push("companion_apply", "companion_profile");
      if (!item || item.allowOrder !== false) list.push("boss_order", "cs_order");
    }
    return list.filter(function (key) {
      return String(key || "").indexOf("[[MCJ_SERVICE_META]]") !== 0;
    });
  }

  function orderFieldsOf(item) {
    var list = (item && (item.orderFields || item.order_fields)) || [];
    return Array.isArray(list) ? list.map(copyField) : [];
  }

  function copyField(field, index) {
    field = field || {};
    return {
      key: String(field.key || "f" + index),
      label: field.label || "",
      type: field.type || "text",
      required: field.required === true,
      placeholder: field.placeholder || "",
      options: field.options || "",
    };
  }

  function blankForm() {
    return {
      id: "",
      name: "",
      category: state.categories[0] || "手游",
      icon: "🎮",
      defaultPrice: "",
      content: "",
      requirements: "",
      orderFields: [],
      enabled: true,
      showHome: true,
      allowApply: true,
      allowOrder: true,
      displayPositions: ["home", "gameplay", "boss_order", "companion_apply", "cs_order", "companion_profile"],
      sort: (state.services.length || 0) + 1,
    };
  }

  function formTitle() {
    return state.editing && state.editing.id ? "编辑服务" : "新增服务";
  }

  function isDirty() {
    return !!(state.formDirty || state.editorDirty);
  }

  function draftUserId() {
    try {
      var token = Auth && Auth.getAccessToken ? Auth.getAccessToken() : "";
      var part = String(token || "").split(".")[1] || "";
      if (!part) return "admin";
      var json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
      return String(json.sub || "admin");
    } catch (e) {
      return "admin";
    }
  }

  function draftKey() {
    var id = state.editing && state.editing.id ? state.editing.id : "new";
    return "mcj.serviceDraft.v1." + draftUserId() + "." + id;
  }

  function clearDraft() {
    try {
      localStorage.removeItem(draftKey());
    } catch (e) {}
  }

  function sheet() {
    return document.getElementById("mcjServiceSheet");
  }

  function applyViewport() {
    var root = sheet();
    if (!root || root.hidden) return;
    var vv = window.visualViewport;
    var height = vv ? vv.height : window.innerHeight;
    var top = vv ? vv.offsetTop : 0;
    if (state.vvHeight && Math.abs(height - state.vvHeight) < 48) return;
    state.vvHeight = height;
    root.style.setProperty("--svc-vvh", Math.round(height) + "px");
    root.style.transform = top > 1 ? "translateY(" + Math.round(top) + "px)" : "";
  }

  function bindViewport() {
    if (document.documentElement.dataset.svcViewport === "1") return;
    document.documentElement.dataset.svcViewport = "1";
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", applyViewport);
      window.visualViewport.addEventListener("scroll", applyViewport);
    }
    window.addEventListener("orientationchange", function () {
      state.vvHeight = 0;
      applyViewport();
    });
  }

  function lockPage(on) {
    var root = document.documentElement;
    root.classList.toggle("svc-sheet-lock", !!on);
    document.body.classList.toggle("svc-sheet-lock", !!on);
  }

  function toast(text) {
    var el = document.getElementById("svcToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "svcToast";
      el.className = "svc-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = text || "";
    el.hidden = !text;
    clearTimeout(toast._t);
    if (text) {
      toast._t = setTimeout(function () {
        el.hidden = true;
      }, 2600);
    }
  }

  function renderIconPicker(selected) {
    return (
      '<div class="svc-field"><span class="svc-field-label">服务图标</span>' +
      '<div class="content-row-actions compact" data-service-icon-picker>' +
      state.icons
        .map(function (icon) {
          return (
            '<button class="mini-btn' +
            (icon === selected ? " primary-lite" : "") +
            '" type="button" data-service-icon="' +
            esc(icon) +
            '">' +
            esc(icon) +
            "</button>"
          );
        })
        .join("") +
      '</div><input type="hidden" name="icon" value="' +
      esc(selected || "🎮") +
      '"></div>'
    );
  }

  function renderPositions(selected) {
    var set = {};
    (selected || []).forEach(function (key) {
      set[key] = true;
    });
    return (
      '<div class="svc-field"><span class="svc-field-label">服务显示位置</span>' +
      '<div class="admin-service-switches" data-service-positions>' +
      state.positions
        .map(function (pos) {
          return (
            '<label class="svc-check"><input type="checkbox" name="displayPositions" value="' +
            esc(pos.key) +
            '" ' +
            (set[pos.key] ? "checked" : "") +
            "> " +
            esc(pos.label) +
            "</label>"
          );
        })
        .join("") +
      "</div></div>"
    );
  }

  function orderTypeOptions(selected) {
    return ORDER_TYPES.map(function (item) {
      return '<option value="' + item.value + '" ' + (item.value === selected ? "selected" : "") + ">" + item.label + "</option>";
    }).join("");
  }

  function orderRowHtml(field) {
    var type = field.type || "text";
    return (
      '<div class="svc-order-row" data-order-field data-field-key="' +
      esc(field.key) +
      '">' +
      '<div class="svc-order-top">' +
      '<input type="text" name="orderLabel" maxlength="40" placeholder="字段名称，例如：游戏 ID" value="' +
      esc(field.label || "") +
      '">' +
      '<select name="orderType" data-admin-control="native">' +
      orderTypeOptions(type) +
      "</select>" +
      '<label class="svc-check"><input type="checkbox" name="orderRequired" ' +
      (field.required ? "checked" : "") +
      "> 必填</label></div>" +
      '<input type="text" name="orderPlaceholder" maxlength="120" placeholder="填写提示（可选）" value="' +
      esc(field.placeholder || "") +
      '">' +
      '<input type="text" name="orderOptions" maxlength="300" placeholder="选项用逗号分隔" value="' +
      esc(field.options || "") +
      '" data-order-options ' +
      (type === "select" ? "" : "hidden") +
      ">" +
      '<div class="svc-order-actions">' +
      '<button class="mini-btn" type="button" data-order-up>上移</button>' +
      '<button class="mini-btn" type="button" data-order-down>下移</button>' +
      '<button class="mini-btn danger-btn" type="button" data-order-remove>删除</button>' +
      "</div></div>"
    );
  }

  function textBlock(name, label, value) {
    var count = Array.from(String(value || "")).length;
    return (
      '<div class="svc-field" data-text-field="' +
      name +
      '">' +
      '<div class="svc-label-row"><span>' +
      esc(label) +
      '</span><button class="mini-btn" type="button" data-text-expand="' +
      name +
      '">展开编辑</button></div>' +
      '<textarea class="svc-text" name="' +
      name +
      '" maxlength="8000" wrap="soft" placeholder="可写段落、编号和换行">' +
      esc(value || "") +
      "</textarea>" +
      '<div class="svc-count" data-count-for="' +
      name +
      '">' +
      count +
      " 字</div></div>"
    );
  }

  function renderFormInner() {
    var d = state.editing;
    var Forms = window.MCJAdminForms;
    var categoryOptions = state.categories.slice();
    if (d.category && categoryOptions.indexOf(d.category) < 0) categoryOptions.push(d.category);
    var categoryField = Forms
      ? Forms.selectHtml({ name: "category", label: "服务分类", value: d.category || "手游", options: categoryOptions })
      : '<label class="svc-field"><span>服务分类</span><select name="category" data-admin-control="native">' +
        categoryOptions
          .map(function (cat) {
            return '<option value="' + esc(cat) + '" ' + (d.category === cat ? "selected" : "") + ">" + esc(cat) + "</option>";
          })
          .join("") +
        "</select></label>";
    var switches =
      (Forms
        ? Forms.switchHtml({ name: "enabled", label: "服务状态", checked: d.enabled !== false, onLabel: "启用", offLabel: "停用" })
        : "") +
      (Forms
        ? Forms.switchHtml({ name: "showHome", label: "首页显示", checked: d.showHome !== false, onLabel: "显示", offLabel: "隐藏" })
        : "") +
      (Forms
        ? Forms.switchHtml({ name: "allowApply", label: "允许申请陪玩", checked: d.allowApply !== false, onLabel: "开启", offLabel: "关闭" })
        : "") +
      (Forms
        ? Forms.switchHtml({ name: "allowOrder", label: "允许老板下单", checked: d.allowOrder !== false, onLabel: "开启", offLabel: "关闭" })
        : "");
    return (
      '<div class="svc-draft" data-service-draft hidden>发现未保存的草稿。<div class="svc-order-actions"><button class="mini-btn primary-lite" type="button" data-draft-restore>恢复</button><button class="mini-btn" type="button" data-draft-ignore>忽略</button></div></div>' +
      '<div class="svc-error" data-service-error hidden></div>' +
      '<section class="svc-block"><h4>基础信息</h4>' +
      '<label class="svc-field"><span class="svc-field-label">服务名称</span><input name="name" maxlength="40" autocomplete="off" placeholder="例如：LOL陪玩 / 语音陪聊 / 护航" value="' +
      esc(d.name) +
      '"></label>' +
      categoryField +
      '<label class="svc-field"><span class="svc-field-label">新增分类（可选）</span><input name="newCategory" maxlength="20" autocomplete="off" placeholder="填写后保存时自动加入分类"></label>' +
      '<label class="svc-field"><span class="svc-field-label">默认价格</span><input name="defaultPrice" maxlength="40" autocomplete="off" placeholder="例如：RM30 / RM50 / RM30~RM50" value="' +
      esc(d.defaultPrice || "") +
      '"></label>' +
      '<label class="svc-field"><span class="svc-field-label">计费方式</span><select name="pricingUnit">' +
      '<option value="per_hour"' + ((d.pricingUnit || d.pricing_unit || "per_hour") !== "per_game" ? " selected" : "") + ">按小时</option>" +
      '<option value="per_game"' + ((d.pricingUnit || d.pricing_unit) === "per_game" ? " selected" : "") + ">按局</option>" +
      "</select></label>" +
      renderIconPicker(d.icon || "🎮") +
      "</section>" +
      '<section class="svc-block"><h4>服务说明</h4>' +
      textBlock("content", "服务内容", d.content) +
      textBlock("requirements", "服务要求", d.requirements) +
      "</section>" +
      '<section class="svc-block"><h4>订单要求配置</h4>' +
      "<p>自定义字段只写入这个服务的配置。已经创建的订单仍保留下单时的内容。</p>" +
      '<div class="svc-order" data-order-list>' +
      (d.orderFields || []).map(orderRowHtml).join("") +
      "</div>" +
      '<button class="mini-btn" type="button" data-order-add>添加字段</button>' +
      "</section>" +
      '<section class="svc-block"><h4>显示与开关</h4>' +
      renderPositions(d.displayPositions || []) +
      renderOrderFields(d.orderFields || []) +
      '<div class="admin-service-switches">' +
      switches +
      "</div></section>"
    );
  }

  function editorHtml() {
    return (
      '<div class="svc-editor" data-service-text-editor hidden>' +
      '<div class="svc-editor-card" role="dialog" aria-modal="true">' +
      '<header class="svc-editor-head"><button class="mini-btn" type="button" data-editor-cancel>返回</button><strong data-editor-title>服务内容</strong><button class="mini-btn primary-lite" type="button" data-editor-done>完成编辑</button></header>' +
      '<textarea class="svc-editor-input" data-editor-input maxlength="8000" wrap="soft"></textarea>' +
      '<footer class="svc-editor-foot"><span data-editor-count>0 字</span><span class="svc-order-actions"><button class="btn" type="button" data-editor-cancel>取消</button><button class="btn primary" type="button" data-editor-done>完成编辑</button></span></footer>' +
      "</div></div>"
    );
  }

  function leaveHtml() {
    return (
      '<div class="svc-leave" data-service-leave hidden>' +
      '<div class="svc-leave-card" role="dialog" aria-modal="true">' +
      "<p>当前内容尚未保存，确定要离开吗？</p>" +
      '<div class="svc-leave-actions"><button class="btn" type="button" data-leave-stay>继续编辑</button><button class="btn primary" type="button" data-leave-drop>放弃修改</button></div>' +
      "</div></div>"
    );
  }

  function paintSheet() {
    var root = sheet();
    if (!root) {
      root = document.createElement("div");
      root.id = "mcjServiceSheet";
      root.className = "svc-root";
      root.hidden = true;
      document.body.appendChild(root);
    }
    root.innerHTML =
      '<div class="svc-backdrop" data-service-dismiss></div>' +
      '<section class="svc-panel" role="dialog" aria-modal="true" aria-labelledby="svcSheetTitle">' +
      '<header class="svc-head"><h3 id="svcSheetTitle">' +
      esc(formTitle()) +
      '</h3><button class="svc-x" type="button" data-service-dismiss aria-label="关闭">×</button></header>' +
      '<form class="svc-form" data-service-form novalidate autocomplete="off">' +
      '<div class="svc-scroll">' +
      renderFormInner() +
      "</div>" +
      '<div class="svc-foot"><button class="btn" type="button" data-service-cancel>取消</button><button class="btn primary" type="button" data-service-save>保存</button></div>' +
      "</form></section>" +
      editorHtml() +
      leaveHtml();
    root.hidden = false;
    if (window.MCJAdminForms && window.MCJAdminForms.enhance) window.MCJAdminForms.enhance(root);
    state.vvHeight = 0;
    applyViewport();
    offerDraft();
  }

  function openForm(item) {
    state.editing = item
      ? {
          id: item.id || "",
          name: item.name || "",
          category: item.category || "其他",
          icon: item.icon || "🎮",
          defaultPrice: item.defaultPrice || item.default_price || "",
          pricingUnit: item.pricingUnit || item.pricing_unit || "per_hour",
          content: item.content || "",
          requirements: item.requirements || "",
          orderFields: orderFieldsOf(item),
          enabled: item.enabled !== false,
          showHome: item.showHome !== false,
          allowApply: item.allowApply !== false,
          allowOrder: item.allowOrder !== false,
          displayPositions: positionsOf(item),
          sort: Number(item.sort || item.sortOrder || 100),
        }
      : blankForm();
    state.formOpen = true;
    state.formDirty = false;
    state.editorDirty = false;
    state.editorField = "";
    state.allowClose = false;
    state.saving = false;
    lockPage(true);
    bindViewport();
    paintSheet();
    if (!state.historyArmed) {
      try {
        history.pushState({ mcjServiceForm: 1 }, "");
        state.historyArmed = true;
      } catch (e) {}
    }
  }

  function finishClose() {
    var root = sheet();
    if (root) root.hidden = true;
    lockPage(false);
    state.formOpen = false;
    state.editing = null;
    state.formDirty = false;
    state.editorDirty = false;
    state.editorField = "";
    state.allowClose = false;
    state.saving = false;
    state.vvHeight = 0;
    if (state.historyArmed) {
      state.historyArmed = false;
      state.ignorePop = true;
      try {
        history.back();
      } catch (e) {}
    }
  }

  function requestClose() {
    if (state.saving) return;
    if (isDirty() && !state.allowClose) {
      showLeave();
      return;
    }
    finishClose();
  }

  function showLeave() {
    var box = document.querySelector("[data-service-leave]");
    if (box) box.hidden = false;
  }

  function hideLeave() {
    var box = document.querySelector("[data-service-leave]");
    if (box) box.hidden = true;
  }

  function showError(text) {
    var el = document.querySelector("[data-service-error]");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    if (text) {
      var scroll = document.querySelector(".svc-scroll");
      if (scroll) scroll.scrollTop = 0;
    }
  }

  function focusField(el) {
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch (e) {
      try {
        el.focus();
      } catch (e2) {}
    }
    var scroll = document.querySelector(".svc-scroll");
    if (!scroll) return;
    var top = el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 20;
    scroll.scrollTop = Math.max(0, top);
  }

  function setSaving(on) {
    state.saving = !!on;
    var saveBtn = document.querySelector("[data-service-save]");
    var cancelBtn = document.querySelector("[data-service-cancel]");
    if (saveBtn) {
      saveBtn.disabled = !!on;
      saveBtn.textContent = on ? "保存中…" : "保存";
      saveBtn.setAttribute("aria-busy", on ? "true" : "false");
    }
    if (cancelBtn) cancelBtn.disabled = !!on;
  }

  function readOrderFields(form) {
    return Array.prototype.map
      .call(form.querySelectorAll("[data-order-field]"), function (row) {
        var label = row.querySelector('[name="orderLabel"]');
        var type = row.querySelector('[name="orderType"]');
        var required = row.querySelector('[name="orderRequired"]');
        var placeholder = row.querySelector('[name="orderPlaceholder"]');
        var options = row.querySelector('[name="orderOptions"]');
        return {
          key: row.getAttribute("data-field-key") || "",
          label: label ? label.value : "",
          type: type ? type.value : "text",
          required: !!(required && required.checked),
          placeholder: placeholder ? placeholder.value : "",
          options: options ? options.value : "",
          node: label,
        };
      });
  }

  function collectForm(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      if (key === "displayPositions") {
        if (!data.displayPositions) data.displayPositions = [];
        data.displayPositions.push(String(value));
        return;
      }
      if (key === "orderLabel" || key === "orderType" || key === "orderRequired" || key === "orderPlaceholder" || key === "orderOptions") return;
      data[key] = value;
    });
    var positions = Array.isArray(data.displayPositions) ? data.displayPositions : [];
    var showHome = data.showHome !== "false";
    if (showHome && positions.indexOf("home") < 0) positions.push("home");
    if (!showHome) {
      positions = positions.filter(function (key) {
        return key !== "home";
      });
    }
    var category = String(data.category || "其他").trim();
    var newCategory = String(data.newCategory || "").trim();
    if (newCategory) category = newCategory;
    var contentEl = form.querySelector('[name="content"]');
    var reqEl = form.querySelector('[name="requirements"]');
    var content = contentEl ? contentEl.value : "";
    var requirements = reqEl ? reqEl.value : "";
    if (state.editorDirty && state.editorField) {
      var editor = document.querySelector("[data-editor-input]");
      if (editor && state.editorField === "content") content = editor.value;
      if (editor && state.editorField === "requirements") requirements = editor.value;
    }
    return {
      id: state.editing && state.editing.id ? state.editing.id : "",
      name: String(data.name || "").trim(),
      category: category,
      icon: String(data.icon || "🎮").trim() || "🎮",
      defaultPrice: String(data.defaultPrice || "").trim(),
      pricingUnit: data.pricingUnit === "per_game" ? "per_game" : "per_hour",
      content: content,
      requirements: requirements,
      orderFields: readOrderFields(form).map(function (field) {
        return {
          key: field.key,
          label: String(field.label || "").trim(),
          type: field.type,
          required: field.required,
          placeholder: String(field.placeholder || "").trim(),
          options: String(field.options || "").trim(),
        };
      }),
      enabled: data.enabled !== "false",
      showHome: showHome,
      allowApply: data.allowApply !== "false",
      allowOrder: data.allowOrder !== "false",
      displayPositions: positions,
      sort: Number((state.editing && state.editing.sort) || state.services.length + 1),
      _orderNodes: readOrderFields(form),
    };
  }

  function writeDraft() {
    if (!state.formOpen) return;
    var form = document.querySelector("[data-service-form]");
    if (!form) return;
    try {
      var payload = collectForm(form);
      delete payload._orderNodes;
      localStorage.setItem(draftKey(), JSON.stringify({ savedAt: Date.now(), payload: payload }));
    } catch (e) {}
  }

  function scheduleDraft() {
    clearTimeout(state.draftTimer);
    state.draftTimer = setTimeout(writeDraft, 400);
  }

  function offerDraft() {
    if (state.suppressDraftBanner) {
      state.suppressDraftBanner = false;
      return;
    }
    var banner = document.querySelector("[data-service-draft]");
    if (!banner) return;
    var raw = "";
    try {
      raw = localStorage.getItem(draftKey()) || "";
    } catch (e) {}
    if (!raw) {
      banner.hidden = true;
      return;
    }
    try {
      var draft = JSON.parse(raw);
      if (!draft || !draft.payload) {
        banner.hidden = true;
        return;
      }
      state.pendingDraft = draft.payload;
      banner.hidden = false;
    } catch (e2) {
      banner.hidden = true;
    }
  }

  function restoreDraft() {
    if (!state.pendingDraft || !state.editing) return;
    var id = state.editing.id;
    var sort = state.editing.sort;
    state.editing = Object.assign({}, state.editing, state.pendingDraft, { id: id, sort: sort });
    state.formDirty = true;
    state.pendingDraft = null;
    state.suppressDraftBanner = true;
    paintSheet();
  }

  function updateCount(name, value) {
    var el = document.querySelector('[data-count-for="' + name + '"]');
    if (el) el.textContent = Array.from(String(value || "")).length + " 字";
  }

  function openEditor(field) {
    var form = document.querySelector("[data-service-form]");
    var source = form && form.querySelector('[name="' + field + '"]');
    var editor = document.querySelector("[data-service-text-editor]");
    var input = document.querySelector("[data-editor-input]");
    var title = document.querySelector("[data-editor-title]");
    if (!source || !editor || !input) return;
    state.editorField = field;
    state.editorDirty = false;
    input.value = source.value;
    if (title) title.textContent = field === "requirements" ? "服务要求" : "服务内容";
    var count = document.querySelector("[data-editor-count]");
    if (count) count.textContent = Array.from(input.value).length + " 字";
    editor.hidden = false;
    state.vvHeight = 0;
    applyViewport();
    try {
      input.focus({ preventScroll: true });
    } catch (e) {}
  }

  function closeEditor() {
    var editor = document.querySelector("[data-service-text-editor]");
    if (editor) editor.hidden = true;
    state.editorField = "";
    state.editorDirty = false;
  }

  function finishEditor() {
    var form = document.querySelector("[data-service-form]");
    var source = form && state.editorField ? form.querySelector('[name="' + state.editorField + '"]') : null;
    var input = document.querySelector("[data-editor-input]");
    if (source && input) {
      source.value = input.value;
      updateCount(state.editorField, input.value);
      state.formDirty = true;
    }
    closeEditor();
    scheduleDraft();
  }

  function cancelEditor() {
    closeEditor();
    scheduleDraft();
  }

  function addOrderField() {
    var list = document.querySelector("[data-order-list]");
    if (!list) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = orderRowHtml({
      key: "f" + Date.now().toString(36),
      label: "",
      type: "text",
      required: false,
      placeholder: "",
      options: "",
    });
    var row = wrap.firstChild;
    list.appendChild(row);
    state.formDirty = true;
    var input = row.querySelector('[name="orderLabel"]');
    focusField(input);
    scheduleDraft();
  }

  function moveOrderField(row, dir) {
    if (!row) return;
    var sibling = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    var parent = row.parentNode;
    if (dir < 0) parent.insertBefore(row, sibling);
    else parent.insertBefore(sibling, row);
    state.formDirty = true;
    scheduleDraft();
  }

  function friendlyError(err) {
    var msg = (err && err.message) || "";
    if (/failed to fetch|network|load failed|timeout/i.test(msg)) return "网络异常，保存失败。已填写的内容仍在，请稍后重试。";
    return msg || "保存失败";
  }

  function save(form) {
    if (state.saving) return;
    if (!form) return;
    showError("");
    var payload = collectForm(form);
    if (!payload.name) {
      showError("请填写服务名称");
      focusField(form.querySelector('[name="name"]'));
      return;
    }
    if (!payload.displayPositions.length) {
      showError("请至少勾选一个显示位置");
      focusField(form.querySelector('[name="displayPositions"]'));
      return;
    }
    var blank = (payload._orderNodes || []).find(function (field) {
      return !String(field.label || "").trim();
    });
    if (blank) {
      showError("请填写订单要求字段名称，或删除空白字段。");
      focusField(blank.node);
      return;
    }
    delete payload._orderNodes;
    setSaving(true);
    apiPost({ action: "save", id: payload.id, service: payload })
      .then(function (res) {
        var saved = res && res.service;
        if (!saved || !saved.id) throw new Error("保存失败：数据库未返回新记录。");
        state.formDirty = false;
        state.editorDirty = false;
        clearDraft();
        setSaving(false);
        state.allowClose = true;
        toast(res.message || "服务已保存");
        finishClose();
        return load();
      })
      .catch(function (err) {
        setSaving(false);
        var message = friendlyError(err);
        showError(message);
        if (/服务名称/.test(message)) focusField(form.querySelector('[name="name"]'));
        else if (/显示位置/.test(message)) focusField(form.querySelector('[name="displayPositions"]'));
      });
  }

  function renderRows() {
    if (!state.services.length) {
      return (
        '<div class="content-empty-action"><strong>暂无服务</strong><span>点击「新增服务」添加平台服务。首页、陪玩申请、客服建单、老板下单将读取同一份数据。</span>' +
        '<button class="btn primary" type="button" data-service-new>新增服务</button></div>'
      );
    }
    var rows = state.services
      .map(function (item) {
        return (
          '<tr draggable="true" data-service-row="' +
          esc(item.id) +
          '">' +
          "<td>" +
          esc(item.icon || "🎮") +
          "</td>" +
          "<td>" +
          esc(item.name || "-") +
          "</td>" +
          "<td>" +
          esc(item.category || "-") +
          "</td>" +
          "<td>" +
          esc(item.defaultPrice || item.default_price || "-") +
          "</td>" +
          "<td>" +
          statusChip(flagLabel(item.showHome, "显示", "隐藏"), item.showHome !== false) +
          "</td>" +
          "<td>" +
          statusChip(flagLabel(item.allowApply, "开启", "关闭"), item.allowApply !== false) +
          "</td>" +
          "<td>" +
          statusChip(flagLabel(item.allowOrder, "开启", "关闭"), item.allowOrder !== false) +
          "</td>" +
          "<td>" +
          statusChip(item.enabled === false ? "停用" : "启用", item.enabled !== false) +
          "</td>" +
          "<td>" +
          esc(item.sort == null ? "-" : item.sort) +
          "</td>" +
          "<td>" +
          esc(formatTime(item.updatedAt || item.createdAt)) +
          "</td>" +
          '<td><div class="content-row-actions compact">' +
          '<button class="mini-btn" type="button" data-service-edit="' +
          esc(item.id) +
          '">编辑</button>' +
          '<button class="mini-btn" type="button" data-service-copy="' +
          esc(item.id) +
          '">复制</button>' +
          (item.enabled === false
            ? '<button class="mini-btn primary-lite" type="button" data-service-enable="' + esc(item.id) + '">启用</button>'
            : '<button class="mini-btn" type="button" data-service-disable="' + esc(item.id) + '">停用</button>') +
          '<button class="mini-btn danger-btn" type="button" data-service-delete="' +
          esc(item.id) +
          '">删除</button>' +
          "</div></td></tr>"
        );
      })
      .join("");
    return (
      '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      "<th>图标</th><th>服务名称</th><th>分类</th><th>默认价格</th><th>首页</th><th>申请陪玩</th><th>老板下单</th><th>状态</th><th>排序</th><th>更新时间</th><th>操作</th>" +
      "</tr></thead><tbody data-service-sortable>" +
      rows +
      "</tbody></table></div>" +
      '<p class="admin-sync-note">提示：可拖拽表格行调整排序，松开后立即保存并同步首页。</p>'
    );
  }

  function render() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="content-loading">正在读取服务列表...</div>';
      return;
    }
    box.innerHTML =
      (state.error ? '<div class="admin-sync-note">' + esc(state.error) + "</div>" : "") +
      (state.message && !state.error ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="platform-content-admin base-data-admin" data-service-admin>' +
      '<div class="content-admin-head"><div><h3>服务列表</h3><p>管理平台提供的服务（不是游戏管理）。保存后同步首页、申请陪玩、陪玩资料、客服建单、老板下单与更多玩法。</p></div></div>' +
      '<div class="content-admin-toolbar compact"><input data-service-search placeholder="搜索服务名称 / 分类 / 价格 / 状态">' +
      '<button class="btn primary" type="button" data-service-new>新增服务</button>' +
      '<button class="btn" type="button" data-service-reload>刷新</button></div>' +
      renderRows() +
      "</div>";
    if (window.MCJAdminForms && window.MCJAdminForms.enhance) window.MCJAdminForms.enhance(box);
    bindSortable();
  }

  function load() {
    state.loading = true;
    state.error = "";
    render();
    return apiGet()
      .then(function (res) {
        state.services = (res.services || []).slice().sort(function (a, b) {
          return Number(a.sort || 100) - Number(b.sort || 100);
        });
        if (Array.isArray(res.categories) && res.categories.length) state.categories = res.categories.slice();
        if (Array.isArray(res.icons) && res.icons.length) state.icons = res.icons.slice();
        if (Array.isArray(res.positions) && res.positions.length) state.positions = res.positions.slice();
        state.message = res.message || "";
      })
      .catch(function (err) {
        state.error = err.message || "服务列表读取失败";
        state.services = [];
      })
      .finally(function () {
        state.loading = false;
        render();
      });
  }

  function mutate(action, id, extra) {
    return apiPost(Object.assign({ action: action, id: id }, extra || {}))
      .then(function () {
        return load();
      })
      .catch(function (err) {
        toast(err.message || "操作失败");
      });
  }

  function bindSortable() {
    var tbody = document.querySelector("[data-service-sortable]");
    if (!tbody || tbody.dataset.sortBound === "1") return;
    tbody.dataset.sortBound = "1";
    var dragId = "";
    tbody.addEventListener("dragstart", function (e) {
      var row = e.target.closest("[data-service-row]");
      if (!row) return;
      dragId = row.getAttribute("data-service-row") || "";
      row.style.opacity = "0.55";
      e.dataTransfer.effectAllowed = "move";
    });
    tbody.addEventListener("dragend", function (e) {
      var row = e.target.closest("[data-service-row]");
      if (row) row.style.opacity = "";
    });
    tbody.addEventListener("dragover", function (e) {
      e.preventDefault();
      var row = e.target.closest("[data-service-row]");
      if (!row || !dragId) return;
      var dragging = tbody.querySelector('[data-service-row="' + dragId + '"]');
      if (!dragging || dragging === row) return;
      var rect = row.getBoundingClientRect();
      var before = e.clientY < rect.top + rect.height / 2;
      tbody.insertBefore(dragging, before ? row : row.nextSibling);
    });
    tbody.addEventListener("drop", function (e) {
      e.preventDefault();
      var ids = Array.prototype.map.call(tbody.querySelectorAll("[data-service-row]"), function (row) {
        return row.getAttribute("data-service-row");
      });
      apiPost({ action: "reorder", ids: ids })
        .then(function () {
          return load();
        })
        .catch(function (err) {
          toast(err.message || "排序保存失败");
          load();
        });
    });
  }

  function bind() {
    if (document.documentElement.dataset.serviceAdminBound === "1") return;
    document.documentElement.dataset.serviceAdminBound = "1";

    document.addEventListener("click", function (e) {
      if (!document.getElementById(TARGET_ID)) return;
      var iconBtn = e.target.closest("[data-service-icon]");
      if (iconBtn) {
        var iconForm = iconBtn.closest("[data-service-form]");
        if (!iconForm) return;
        var hidden = iconForm.querySelector('input[name="icon"]');
        if (hidden) hidden.value = iconBtn.getAttribute("data-service-icon") || "🎮";
        iconForm.querySelectorAll("[data-service-icon]").forEach(function (btn) {
          btn.classList.toggle("primary-lite", btn === iconBtn);
        });
        state.formDirty = true;
        scheduleDraft();
        return;
      }
      if (e.target.closest("[data-service-new]")) {
        openForm(null);
        return;
      }
      if (e.target.closest("[data-service-reload]")) {
        load();
        return;
      }
      if (e.target.closest("[data-service-save]")) {
        var saveForm = document.querySelector("[data-service-form]");
        if (saveForm) save(saveForm);
        return;
      }
      if (e.target.closest("[data-service-cancel]") || e.target.closest("[data-service-dismiss]")) {
        requestClose();
        return;
      }
      if (e.target.closest("[data-leave-stay]")) {
        hideLeave();
        return;
      }
      if (e.target.closest("[data-leave-drop]")) {
        clearDraft();
        state.formDirty = false;
        state.editorDirty = false;
        state.allowClose = true;
        hideLeave();
        finishClose();
        return;
      }
      if (e.target.closest("[data-draft-restore]")) {
        restoreDraft();
        return;
      }
      if (e.target.closest("[data-draft-ignore]")) {
        clearDraft();
        state.pendingDraft = null;
        var banner = document.querySelector("[data-service-draft]");
        if (banner) banner.hidden = true;
        return;
      }
      var expand = e.target.closest("[data-text-expand]");
      if (expand) {
        openEditor(expand.getAttribute("data-text-expand"));
        return;
      }
      if (e.target.closest("[data-editor-done]")) {
        finishEditor();
        return;
      }
      if (e.target.closest("[data-editor-cancel]")) {
        cancelEditor();
        return;
      }
      if (e.target.closest("[data-order-add]")) {
        addOrderField();
        return;
      }
      var up = e.target.closest("[data-order-up]");
      if (up) {
        moveOrderField(up.closest("[data-order-field]"), -1);
        return;
      }
      var down = e.target.closest("[data-order-down]");
      if (down) {
        moveOrderField(down.closest("[data-order-field]"), 1);
        return;
      }
      var remove = e.target.closest("[data-order-remove]");
      if (remove) {
        var row = remove.closest("[data-order-field]");
        if (row) row.remove();
        state.formDirty = true;
        scheduleDraft();
        return;
      }
      var editBtn = e.target.closest("[data-service-edit]");
      if (editBtn) {
        var item = state.services.find(function (rowItem) {
          return String(rowItem.id) === String(editBtn.getAttribute("data-service-edit"));
        });
        if (item) openForm(item);
        return;
      }
      var copyBtn = e.target.closest("[data-service-copy]");
      if (copyBtn) {
        mutate("duplicate", copyBtn.getAttribute("data-service-copy"));
        return;
      }
      var enableBtn = e.target.closest("[data-service-enable]");
      if (enableBtn) {
        mutate("enable", enableBtn.getAttribute("data-service-enable"));
        return;
      }
      var disableBtn = e.target.closest("[data-service-disable]");
      if (disableBtn) {
        mutate("disable", disableBtn.getAttribute("data-service-disable"));
        return;
      }
      var deleteBtn = e.target.closest("[data-service-delete]");
      if (deleteBtn) {
        if (!confirm("确认删除该服务？删除后各端将同步移除（历史订单仍保留原服务名）。")) return;
        mutate("delete", deleteBtn.getAttribute("data-service-delete"));
      }
    });

    document.addEventListener("submit", function (e) {
      var form = e.target && e.target.closest ? e.target.closest("[data-service-form]") : null;
      if (!form) return;
      e.preventDefault();
      save(form);
    });

    document.addEventListener("change", function (e) {
      var showHome = e.target.closest && e.target.closest('[name="showHome"]');
      if (showHome) {
        var homeForm = showHome.closest("[data-service-form]");
        var homeBox = homeForm && homeForm.querySelector('input[name="displayPositions"][value="home"]');
        if (homeBox) homeBox.checked = showHome.value !== "false";
      }
      var orderType = e.target.closest && e.target.closest('[name="orderType"]');
      if (orderType) {
        var orderRow = orderType.closest("[data-order-field]");
        var options = orderRow && orderRow.querySelector("[data-order-options]");
        if (options) options.hidden = orderType.value !== "select";
      }
      if (e.target.closest && e.target.closest("[data-service-form]")) {
        state.formDirty = true;
        scheduleDraft();
      }
    });

    document.addEventListener("input", function (e) {
      var search = e.target.closest && e.target.closest("[data-service-search]");
      if (search) {
        var wrap = document.querySelector("[data-service-admin]");
        if (!wrap) return;
        var q = String(search.value || "").trim().toLowerCase();
        wrap.querySelectorAll("tbody tr").forEach(function (row) {
          row.hidden = !!(q && row.textContent.toLowerCase().indexOf(q) === -1);
        });
        return;
      }
      var editorInput = e.target.closest && e.target.closest("[data-editor-input]");
      if (editorInput) {
        state.editorDirty = true;
        var count = document.querySelector("[data-editor-count]");
        if (count) count.textContent = Array.from(editorInput.value).length + " 字";
        scheduleDraft();
        return;
      }
      var named = e.target.closest && e.target.closest("[data-service-form] [name]");
      if (named && (named.name === "content" || named.name === "requirements")) updateCount(named.name, named.value);
      if (e.target.closest && e.target.closest("[data-service-form]")) {
        state.formDirty = true;
        scheduleDraft();
      }
    });

    document.addEventListener("focusin", function (e) {
      var scroll = e.target.closest && e.target.closest(".svc-scroll");
      if (!scroll) return;
      var el = e.target;
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      requestAnimationFrame(function () {
        var field = el.getBoundingClientRect();
        var box = scroll.getBoundingClientRect();
        if (field.bottom > box.bottom - 8) scroll.scrollTop += field.bottom - box.bottom + 16;
        else if (field.top < box.top + 8) scroll.scrollTop -= box.top + 8 - field.top;
      });
    });

    window.addEventListener("beforeunload", function (e) {
      if (!state.formOpen || !isDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    });

    window.addEventListener("popstate", function () {
      if (state.ignorePop) {
        state.ignorePop = false;
        return;
      }
      if (!state.formOpen) return;
      if (isDirty()) {
        try {
          history.pushState({ mcjServiceForm: 1 }, "");
        } catch (err) {}
        showLeave();
        return;
      }
      state.historyArmed = false;
      state.allowClose = true;
      finishClose();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !state.formOpen) return;
      var editor = document.querySelector("[data-service-text-editor]");
      if (editor && !editor.hidden) {
        cancelEditor();
        return;
      }
      var leave = document.querySelector("[data-service-leave]");
      if (leave && !leave.hidden) {
        hideLeave();
        return;
      }
      requestClose();
    });
  }

  function boot() {
    if (!target()) return;
    bind();
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJAdminServiceManager = { reload: load };
})();
