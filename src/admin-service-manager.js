(function () {
  "use strict";
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
  var state = {
    loading: true,
    saving: false,
    error: "",
    message: "",
    loadFailed: false,
    services: [],
    categories: ["端游", "手游", "娱乐陪伴", "语音", "娱乐", "定制", "其他"],
    categoryRows: [
      { name: "端游", sort: 1, enabled: true },
      { name: "手游", sort: 2, enabled: true },
      { name: "娱乐陪伴", sort: 3, enabled: true },
    ],
    icons: DEFAULT_ICONS.slice(),
    positions: DEFAULT_POSITIONS.slice(),
    editing: null,
    formOpen: false,
    query: "",
    letter: "",
    categoryFilter: "全部",
    categoryPanelOpen: false,
    letterOpen: false,
    moreOpenId: "",
  };

  function authApi() {
    var api = window.MCJAdminAuthFetch;
    if (!api || typeof api.get !== "function") throw new Error("后台鉴权模块未加载");
    return api;
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

  function flagLabel(value, onText, offText) {
    return value === false ? offText : onText;
  }

  function statusChip(text, ok) {
    return '<span class="status ' + (ok ? "ok" : "wait") + '">' + esc(text) + "</span>";
  }

  function apiGet() {
    return authApi().get("/api/admin/services");
  }

  function apiPost(body) {
    return authApi().post("/api/admin/services", body);
  }

  function positionsOf(item) {
    var list = (item && (item.displayPositions || item.display_positions)) || [];
    if (!Array.isArray(list) || !list.length) {
      list = [];
      if (!item || item.showHome !== false) list.push("home");
      if (!item || item.allowApply !== false) list.push("companion_apply", "companion_profile");
      if (!item || item.allowOrder !== false) list.push("boss_order", "cs_order");
    }
    return list;
  }

  function blankForm() {
    return {
      id: "",
      name: "",
      category: state.categories[0] || "手游",
      icon: "🎮",
      defaultPrice: "",
      priceMin: "",
      priceMax: "",
      unit: "局",
      description: "",
      requirements: "",
      allowSelfPrice: false,
      allowSelfOff: false,
      orderFields: [],
      enabled: true,
      showHome: true,
      allowApply: true,
      allowOrder: true,
      displayPositions: ["home", "gameplay", "boss_order", "companion_apply", "cs_order", "companion_profile"],
      sort: (state.services.length || 0) + 1,
    };
  }

  function openForm(item) {
    state.editing = item
      ? {
          id: item.id || "",
          name: item.name || "",
          category: item.category || "其他",
          icon: item.icon || "🎮",
          defaultPrice: item.defaultPrice || item.default_price || "",
          priceMin: item.pricePolicy && item.pricePolicy.min != null ? item.pricePolicy.min : "",
          priceMax: item.pricePolicy && item.pricePolicy.max != null ? item.pricePolicy.max : "",
          unit: (item.pricePolicy && item.pricePolicy.unit) || "局",
          description: (item.pricePolicy && item.pricePolicy.description) || "",
          requirements: (item.pricePolicy && item.pricePolicy.requirements) || "",
          allowSelfPrice: !!(item.pricePolicy && item.pricePolicy.allowSelfPrice),
          allowSelfOff: !!(item.pricePolicy && item.pricePolicy.allowSelfOff),
          orderFields: Array.isArray(item.orderFields) ? item.orderFields : [],
          enabled: item.enabled !== false,
          showHome: item.showHome !== false,
          allowApply: item.allowApply !== false,
          allowOrder: item.allowOrder !== false,
          displayPositions: positionsOf(item),
          sort: Number(item.sort || item.sortOrder || 100),
        }
      : blankForm();
    state.formOpen = true;
    state.formSignature = "";
    openSvcDialog();
  }

  function formSignature(form) {
    if (!form) return "";
    var parts = [];
    new FormData(form).forEach(function (value, key) {
      parts.push(key + "=" + value);
    });
    form.querySelectorAll("[data-order-field]").forEach(function (row) {
      var name = row.querySelector("[data-of-name]");
      var kind = row.querySelector("[data-of-kind]");
      var placeholder = row.querySelector("[data-of-placeholder]");
      var options = row.querySelector("[data-of-options]");
      var required = row.querySelector("[data-of-required]");
      var enabled = row.querySelector("[data-of-enabled]");
      parts.push(
        "of=" +
          ((name && name.value) || "") +
          "|" +
          ((kind && kind.value) || "") +
          "|" +
          ((placeholder && placeholder.value) || "") +
          "|" +
          ((options && options.value) || "") +
          "|" +
          (required && required.checked ? "1" : "0") +
          "|" +
          (enabled && enabled.checked ? "1" : "0")
      );
    });
    return parts.join("&");
  }

  function formIsDirty() {
    var form = document.querySelector("[data-service-form]");
    if (!form || !state.formSignature) return false;
    return formSignature(form) !== state.formSignature;
  }

  function requestCloseForm() {
    if (state.saving) return;
    if (formIsDirty() && !window.confirm("有未保存的修改，确定关闭？")) return;
    closeForm();
  }

  function closeForm() {
    state.formOpen = false;
    state.editing = null;
    state.formSignature = "";
    state.saving = false;
    var dialog = document.getElementById("svcEditDialog");
    if (dialog) {
      dialog.classList.remove("is-open");
      dialog.hidden = true;
      var body = dialog.querySelector("[data-svc-dialog-body]");
      if (body) body.innerHTML = "";
    }
    document.body.classList.remove("svc-dialog-lock");
    document.body.style.top = "";
    if (state.lockY) window.scrollTo(0, state.lockY);
    state.lockY = 0;
    if (state.viewportPin) {
      window.visualViewport.removeEventListener("resize", state.viewportPin);
      window.visualViewport.removeEventListener("scroll", state.viewportPin);
      state.viewportPin = null;
    }
  }

  function formTitle() {
    return state.editing && state.editing.id ? "编辑服务" : "新增服务";
  }

  function ensureSvcDialog() {
    var dialog = document.getElementById("svcEditDialog");
    if (dialog) return dialog;
    dialog = document.createElement("div");
    dialog.id = "svcEditDialog";
    dialog.className = "svc-dialog";
    dialog.hidden = true;
    dialog.innerHTML =
      '<div class="svc-dialog-backdrop" data-svc-dialog-close></div>' +
      '<div class="svc-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="svcEditTitle">' +
      '<header class="svc-dialog-head"><h3 id="svcEditTitle" data-svc-dialog-title></h3>' +
      '<button type="button" class="svc-dialog-x" data-svc-dialog-close aria-label="关闭">×</button></header>' +
      '<div class="svc-dialog-body" data-svc-dialog-body></div>' +
      '<p class="svc-dialog-error" data-svc-form-error hidden></p>' +
      '<footer class="svc-dialog-foot">' +
      '<button class="btn" type="button" data-service-cancel>取消</button>' +
      '<button class="btn primary" type="submit" form="svcEditForm" data-service-save>保存</button>' +
      "</footer></div>";
    document.body.appendChild(dialog);
    return dialog;
  }

  function pinSvcDialog() {
    var dialog = document.getElementById("svcEditDialog");
    var panel = dialog && dialog.querySelector(".svc-dialog-panel");
    if (!panel || !window.visualViewport) return;
    var height = Math.max(280, window.visualViewport.height - 8);
    panel.style.maxHeight = height + "px";
  }

  function openSvcDialog() {
    if (!state.formOpen || !state.editing) return;
    var dialog = ensureSvcDialog();
    var title = dialog.querySelector("[data-svc-dialog-title]");
    var body = dialog.querySelector("[data-svc-dialog-body]");
    var error = dialog.querySelector("[data-svc-form-error]");
    var saveBtn = dialog.querySelector("[data-service-save]");
    if (title) title.textContent = formTitle();
    if (body) body.innerHTML = renderForm();
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "保存";
    }
    state.lockY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = "-" + state.lockY + "px";
    document.body.classList.add("svc-dialog-lock");
    dialog.hidden = false;
    dialog.classList.add("is-open");
    if (window.MCJAdminForms && window.MCJAdminForms.enhance) window.MCJAdminForms.enhance(dialog);
    if (body && body.dataset.svcSelectScroll !== "1") {
      body.dataset.svcSelectScroll = "1";
      body.addEventListener("scroll", function () {
        if (window.MCJAdminForms && window.MCJAdminForms.closeSelect) window.MCJAdminForms.closeSelect();
      }, { passive: true });
    }
    var form = dialog.querySelector("[data-service-form]");
    state.formSignature = formSignature(form);
    pinSvcDialog();
    if (window.visualViewport && !state.viewportPin) {
      state.viewportPin = function () {
        pinSvcDialog();
      };
      window.visualViewport.addEventListener("resize", state.viewportPin);
      window.visualViewport.addEventListener("scroll", state.viewportPin);
    }
    var closeBtn = dialog.querySelector(".svc-dialog-x");
    if (closeBtn) {
      try {
        closeBtn.focus({ preventScroll: true });
      } catch (e) {}
    }
  }

  function renderIconPicker(selected) {
    return (
      '<div class="admin-service-span-2"><span class="admin-field-label">服务图标</span>' +
      '<div class="svc-icon-picker" data-service-icon-picker>' +
      state.icons
        .map(function (icon) {
          return (
            '<button class="svc-icon-pick' +
            (icon === selected ? " is-on" : "") +
            '" type="button" data-service-icon="' +
            esc(icon) +
            '" aria-pressed="' +
            (icon === selected ? "true" : "false") +
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
      '<div class="admin-service-span-2"><span class="admin-field-label">服务显示位置</span>' +
      '<div class="admin-service-switches">' +
      state.positions
        .map(function (pos) {
          return (
            '<label><input type="checkbox" name="displayPositions" value="' +
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

  function renderForm() {
    if (!state.formOpen || !state.editing) return "";
    var d = state.editing;
    var Forms = window.MCJAdminForms;
    var categoryOptions = state.categories.slice();
    if (d.category && categoryOptions.indexOf(d.category) < 0) categoryOptions.push(d.category);
    var categoryField =
      '<div class="svc-field svc-select-host">' +
      (Forms
        ? Forms.selectHtml({
            name: "category",
            label: "服务分类",
            value: d.category || "手游",
            options: categoryOptions,
          })
        : '<span>服务分类</span><select name="category">' +
          categoryOptions
            .map(function (cat) {
              return '<option value="' + esc(cat) + '" ' + (d.category === cat ? "selected" : "") + ">" + esc(cat) + "</option>";
            })
            .join("") +
          "</select>") +
      "</div>";
    var switchEnabled = Forms
      ? Forms.switchHtml({ name: "enabled", label: "服务状态", checked: d.enabled !== false, onLabel: "启用", offLabel: "停用" })
      : "";
    var switchHome = Forms
      ? Forms.switchHtml({ name: "showHome", label: "首页显示", checked: d.showHome !== false, onLabel: "显示", offLabel: "隐藏" })
      : "";
    var switchApply = Forms
      ? Forms.switchHtml({ name: "allowApply", label: "允许申请陪玩", checked: d.allowApply !== false, onLabel: "开启", offLabel: "关闭" })
      : "";
    var switchOrder = Forms
      ? Forms.switchHtml({ name: "allowOrder", label: "允许老板下单", checked: d.allowOrder !== false, onLabel: "开启", offLabel: "关闭" })
      : "";
    function unitOpt(value) {
      return '<option value="' + value + '"' + (d.unit === value ? " selected" : "") + ">每" + value + "</option>";
    }
    return (
      '<div class="content-editor svc-editor" data-service-editor>' +
      '<form id="svcEditForm" class="platform-content-form admin-service-form" data-service-form>' +
      '<section class="svc-section"><h4>基本信息</h4>' +
      '<label class="svc-field"><span>服务名称</span><input name="name" required maxlength="40" placeholder="例如：无畏契约端游" value="' +
      esc(d.name) +
      '"></label>' +
      categoryField +
      '<label class="svc-field"><span>新增分类</span><input name="newCategory" maxlength="20" placeholder="可选，保存时加入分类"></label>' +
      renderIconPicker(d.icon || "🎮") +
      "</section>" +
      '<section class="svc-section"><h4>服务定价</h4>' +
      '<label class="svc-field"><span>默认价格</span><span class="svc-rm"><i>RM</i><input name="defaultPrice" inputmode="decimal" maxlength="12" placeholder="25" value="' +
      esc(d.defaultPrice || "") +
      '"></span></label>' +
      '<div class="svc-price-row">' +
      '<label class="svc-field"><span>最低价格</span><span class="svc-rm"><i>RM</i><input name="priceMin" inputmode="decimal" maxlength="12" placeholder="20" value="' +
      esc(d.priceMin) +
      '"></span></label>' +
      '<label class="svc-field"><span>最高价格</span><span class="svc-rm"><i>RM</i><input name="priceMax" inputmode="decimal" maxlength="12" placeholder="40" value="' +
      esc(d.priceMax) +
      '"></span></label>' +
      "</div>" +
      '<label class="svc-field"><span>计费单位</span><select name="unit">' +
      unitOpt("局") +
      unitOpt("小时") +
      unitOpt("场") +
      unitOpt("次") +
      "</select></label>" +
      '<label class="svc-field"><span>服务内容</span><textarea name="description" maxlength="500" rows="3" placeholder="只有老板下单时看到">' +
      esc(d.description || "") +
      "</textarea></label>" +
      '<label class="svc-field"><span>服务要求</span><textarea name="requirements" maxlength="800" rows="3" placeholder="只有陪玩接单时看到">' +
      esc(d.requirements || "") +
      "</textarea></label>" +
      '<p class="svc-note">保存后只影响新订单。已有订单保留下单当时的金额和内容。</p>' +
      "</section>" +
      '<section class="svc-section"><h4>订单要求配置</h4>' +
      renderOrderFields(d.orderFields || []) +
      "</section>" +
      '<section class="svc-section"><h4>服务展示设置</h4>' +
      renderPositions(d.displayPositions || []) +
      '<div class="admin-service-switches">' +
      switchHome +
      switchApply +
      switchOrder +
      "</div></section>" +
      '<section class="svc-section"><h4>陪玩权限设置</h4>' +
      '<div class="admin-service-switches">' +
      switchEnabled +
      '<label class="svc-perm"><input type="checkbox" name="allowSelfPrice" value="true"' +
      (d.allowSelfPrice ? " checked" : "") +
      "> 允许陪玩自主定价</label>" +
      '<p class="svc-note">每位陪玩可单独开启或关闭是否接此服务。未允许自主定价时，后端会拒绝改价。</p>' +
      "</div></section>" +
      "</form></div>"
    );
  }

  function orderFieldRow(field) {
    field = field || {};
    var kind = field.kind || "text";
    var options = Array.isArray(field.options) ? field.options.join(",") : "";
    function opt(value, label) {
      return '<option value="' + value + '"' + (kind === value ? " selected" : "") + ">" + label + "</option>";
    }
    return (
      '<article class="svc-field-card" data-order-field>' +
      '<div class="svc-field-card-top">' +
      '<input data-of-name maxlength="40" placeholder="字段名称" value="' + esc(field.name || "") + '">' +
      '<select data-of-kind>' +
      opt("text", "文本") +
      opt("number", "数字") +
      opt("select", "单选") +
      opt("multiselect", "多选") +
      opt("textarea", "长文本") +
      "</select>" +
      '<div class="svc-icon-actions">' +
      '<button class="svc-icon-btn" type="button" data-of-up aria-label="上移">↑</button>' +
      '<button class="svc-icon-btn" type="button" data-of-down aria-label="下移">↓</button>' +
      '<button class="svc-icon-btn danger" type="button" data-of-remove aria-label="删除">×</button>' +
      "</div></div>" +
      '<div class="svc-field-card-flags">' +
      '<label class="svc-mini-toggle"><input type="checkbox" data-of-required' + (field.required === false ? "" : " checked") + '><i aria-hidden="true"></i><span>必填</span></label>' +
      '<label class="svc-mini-toggle"><input type="checkbox" data-of-enabled' + (field.enabled === false ? "" : " checked") + '><i aria-hidden="true"></i><span>启用</span></label>' +
      "</div>" +
      '<input data-of-placeholder maxlength="80" placeholder="placeholder" value="' + esc(field.placeholder || "") + '">' +
      '<input data-of-options maxlength="400" placeholder="单选/多选选项，逗号分隔，可随时增改" value="' + esc(options) + '">' +
      "</article>"
    );
  }

  function renderOrderFields(fields) {
    var rows = (Array.isArray(fields) ? fields : []).map(orderFieldRow).join("");
    return (
      '<div class="admin-service-span-2" data-order-fields-wrap>' +
      "<span>订单要求配置</span>" +
      '<p class="admin-sync-note">老板下单时按这里的字段填写。保存后只影响新订单，已有订单保留下单当时的内容。</p>' +
      '<div class="svc-field-list" data-order-fields>' +
      rows +
      "</div>" +
      '<button class="btn svc-add-field" type="button" data-of-add>添加字段</button>' +
      "</div>"
    );
  }

  function readOrderFields(form) {
    if (!form) return [];
    return Array.prototype.map.call(form.querySelectorAll("[data-order-field]"), function (row, index) {
      return {
        name: (row.querySelector("[data-of-name]") || {}).value || "",
        kind: (row.querySelector("[data-of-kind]") || {}).value || "text",
        required: !!(row.querySelector("[data-of-required]") || {}).checked,
        enabled: !!(row.querySelector("[data-of-enabled]") || {}).checked,
        placeholder: (row.querySelector("[data-of-placeholder]") || {}).value || "",
        options: (row.querySelector("[data-of-options]") || {}).value || "",
        sort: index,
      };
    }).filter(function (field) {
      return String(field.name || "").trim();
    });
  }

  function pinyinApi() {
    return window.MCJServicePinyinOrder || null;
  }

  function serviceInitial(name) {
    var api = pinyinApi();
    return api && api.initialOf ? api.initialOf(name) : "#";
  }

  function serviceMatches(name, query) {
    var api = pinyinApi();
    if (api && api.matchesQuery) return api.matchesQuery(name, query);
    var q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    return String(name || "").toLowerCase().indexOf(q) >= 0;
  }

  function filteredServices() {
    return state.services.filter(function (item) {
      var name = item.name || "";
      if (state.categoryFilter && state.categoryFilter !== "全部") {
        if (String(item.category || "").trim() !== String(state.categoryFilter).trim()) return false;
      }
      if (!serviceMatches(name, state.query)) return false;
      if (state.letter && serviceInitial(name) !== state.letter) return false;
      return true;
    });
  }

  function serviceGroups() {
    var matched = filteredServices();
    var api = pinyinApi();
    var ordered = api && api.sortByPinyin ? api.sortByPinyin(matched).map(function (row) { return row.item; }) : matched;
    return ordered;
  }

  function letterNavHtml() {
    var used = {};
    state.services.forEach(function (item) {
      if (state.categoryFilter && state.categoryFilter !== "全部") {
        if (String(item.category || "").trim() !== String(state.categoryFilter).trim()) return;
      }
      if (serviceMatches(item.name || "", state.query)) used[serviceInitial(item.name || "")] = 1;
    });
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
    var allOn = !state.letter;
    var body =
      '<div class="svc-letters" role="tablist">' +
      '<button type="button" class="svc-letter svc-letter-all' +
      (allOn ? " is-on" : "") +
      '" data-service-letter="ALL" aria-pressed="' +
      (allOn ? "true" : "false") +
      '">ALL</button>' +
      letters
        .map(function (letter) {
          var on = state.letter === letter;
          var has = !!used[letter];
          return (
            '<button type="button" class="svc-letter' +
            (on ? " is-on" : "") +
            '" data-service-letter="' +
            letter +
            '"' +
            (has ? "" : " disabled") +
            ' aria-pressed="' +
            (on ? "true" : "false") +
            '">' +
            letter +
            "</button>"
          );
        })
        .join("") +
      "</div>";
    return (
      '<div class="svc-letter-wrap' +
      (state.letterOpen ? " is-open" : "") +
      '">' +
      '<button type="button" class="svc-letter-toggle mini-btn" data-letter-toggle aria-expanded="' +
      (state.letterOpen ? "true" : "false") +
      '">A–Z 筛选' +
      (state.letter ? " · " + esc(state.letter) : "") +
      (state.letterOpen ? " ▴" : " ▾") +
      "</button>" +
      (state.letterOpen ? body : "") +
      "</div>"
    );
  }

  function categoryTabsHtml() {
    var tabs = ["全部"].concat(
      (state.categoryRows || [])
        .slice()
        .sort(function (a, b) {
          return Number(a.sort || 0) - Number(b.sort || 0) || String(a.name).localeCompare(String(b.name), "zh");
        })
        .filter(function (row) {
          return row.enabled !== false;
        })
        .map(function (row) {
          return row.name;
        })
    );
    return (
      '<div class="svc-cat-tabs" role="tablist" aria-label="服务分类">' +
      tabs
        .map(function (name) {
          var on = state.categoryFilter === name;
          var count =
            name === "全部"
              ? state.services.length
              : state.services.filter(function (row) {
                  return String(row.category || "").trim() === String(name).trim();
                }).length;
          return (
            '<button type="button" class="svc-cat-tab' +
            (on ? " is-on" : "") +
            '" data-cat-filter="' +
            esc(name) +
            '" aria-pressed="' +
            (on ? "true" : "false") +
            '">' +
            esc(name) +
            "<i>" +
            count +
            "</i></button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function serviceRowHtml(item) {
    var policy = item.pricePolicy || {};
    var unit = policy.unit || "局";
    var price = item.defaultPrice || item.default_price || "-";
    var on = item.enabled !== false;
    var moreOpen = state.moreOpenId && String(state.moreOpenId) === String(item.id);
    return (
      '<article class="svc-row" data-service-row="' +
      esc(item.id) +
      '">' +
      '<div class="svc-row-main">' +
      "<strong>" +
      esc(item.name || "-") +
      "</strong>" +
      '<span class="svc-row-meta">' +
      esc(item.category || "未分类") +
      " · " +
      esc(price) +
      " 猫粮/" +
      esc(unit) +
      "</span></div>" +
      statusChip(on ? "启用" : "停用", on) +
      '<div class="svc-row-actions">' +
      '<button class="mini-btn" type="button" data-service-edit="' +
      esc(item.id) +
      '">编辑</button>' +
      '<div class="svc-more' +
      (moreOpen ? " is-open" : "") +
      '">' +
      '<button class="mini-btn" type="button" data-service-more="' +
      esc(item.id) +
      '" aria-expanded="' +
      (moreOpen ? "true" : "false") +
      '">更多</button>' +
      (moreOpen
        ? '<div class="svc-more-menu" role="menu">' +
          (on
            ? '<button type="button" data-service-disable="' + esc(item.id) + '">停用</button>'
            : '<button type="button" data-service-enable="' + esc(item.id) + '">启用</button>') +
          '<button type="button" data-service-copy="' +
          esc(item.id) +
          '">复制</button>' +
          '<button type="button" class="danger" data-service-delete="' +
          esc(item.id) +
          '">删除</button>' +
          "</div>"
        : "") +
      "</div></div></article>"
    );
  }

  function renderRows() {
    if (state.loadFailed && !state.services.length) {
      return (
        '<div class="content-empty-action svc-load-failed"><strong>服务列表读取失败</strong><span>' +
        esc(state.error || "请检查网络后重试，不会显示假的空数据。") +
        '</span><button class="btn primary" type="button" data-service-reload>重新加载</button></div>'
      );
    }
    if (!state.services.length) {
      return (
        '<div class="content-empty-action"><strong>暂无服务</strong><span>当前数据库确实没有服务记录。</span>' +
        '<button class="btn primary" type="button" data-service-new>新增服务</button></div>'
      );
    }
    var rows = serviceGroups();
    if (!rows.length) return '<div class="content-empty-action"><strong>没有匹配的服务</strong></div>';
    return '<div class="svc-row-list" data-service-sortable>' + rows.map(serviceRowHtml).join("") + "</div>";
  }

  function categoryCount(name) {
    return state.services.filter(function (row) {
      return String(row.category || "").trim() === String(name || "").trim();
    }).length;
  }

  function categoryPanelHtml() {
    if (!state.categoryPanelOpen) return "";
    var rows = (state.categoryRows || []).slice().sort(function (a, b) {
      return Number(a.sort || 0) - Number(b.sort || 0) || String(a.name).localeCompare(String(b.name), "zh");
    });
    var list = rows
      .map(function (row, index) {
        var on = row.enabled !== false;
        var count = categoryCount(row.name);
        return (
          '<article class="svc-cat-row" data-cat-row="' +
          esc(row.name) +
          '">' +
          '<div class="svc-cat-main">' +
          "<strong>" +
          esc(row.name) +
          "</strong>" +
          statusChip(on ? "启用" : "停用", on) +
          "<em>" +
          count +
          " 个</em></div>" +
          '<div class="svc-cat-actions">' +
          '<button class="mini-btn" type="button" data-cat-up="' +
          esc(row.name) +
          '"' +
          (index === 0 ? " disabled" : "") +
          ">上移</button>" +
          '<button class="mini-btn" type="button" data-cat-down="' +
          esc(row.name) +
          '"' +
          (index === rows.length - 1 ? " disabled" : "") +
          ">下移</button>" +
          '<button class="mini-btn" type="button" data-cat-rename="' +
          esc(row.name) +
          '">改名</button>' +
          (on
            ? '<button class="mini-btn" type="button" data-cat-disable="' + esc(row.name) + '">停用</button>'
            : '<button class="mini-btn primary-lite" type="button" data-cat-enable="' + esc(row.name) + '">启用</button>') +
          '<button class="mini-btn danger" type="button" data-cat-delete="' +
          esc(row.name) +
          '">删除</button>' +
          "</div></article>"
        );
      })
      .join("");
    return (
      '<section class="svc-cat-panel" data-service-categories>' +
      '<form class="svc-cat-add" data-cat-add-form>' +
      '<input name="name" maxlength="20" placeholder="新分类名称" required>' +
      '<button class="btn primary" type="submit">新增分类</button></form>' +
      '<div class="svc-cat-list">' +
      (list || '<div class="content-empty-action"><strong>暂无分类</strong></div>') +
      "</div></section>"
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
      '<div class="svc-shell" data-service-admin>' +
      '<div class="svc-topbar">' +
      "<h3>服务管理</h3>" +
      '<div class="svc-topbar-actions">' +
      '<button class="mini-btn" type="button" data-cat-panel-toggle aria-expanded="' +
      (state.categoryPanelOpen ? "true" : "false") +
      '">分类管理</button>' +
      '<button class="btn primary svc-new-btn" type="button" data-service-new>新增服务</button>' +
      "</div></div>" +
      (state.error
        ? '<div class="admin-sync-note svc-error-banner">' +
          esc(state.error) +
          ' <button class="mini-btn" type="button" data-service-reload>重试</button></div>'
        : "") +
      (state.message && !state.error ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      categoryPanelHtml() +
      '<div class="svc-toolbar"><input data-service-search value="' +
      esc(state.query) +
      '" placeholder="搜索中文、拼音或首字母" autocomplete="off"></div>' +
      categoryTabsHtml() +
      letterNavHtml() +
      '<div data-service-groups>' +
      renderRows() +
      "</div></div>";
    if (window.MCJAdminForms && window.MCJAdminForms.enhance) window.MCJAdminForms.enhance(box);
    bindSortable();
  }

  function collectForm(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      if (key === "displayPositions") {
        if (!data.displayPositions) data.displayPositions = [];
        data.displayPositions.push(String(value));
        return;
      }
      data[key] = value;
    });
    var positions = Array.isArray(data.displayPositions) ? data.displayPositions : [];
    var showHome = data.showHome !== "false";
    if (showHome && positions.indexOf("home") < 0) positions.push("home");
    if (!showHome) positions = positions.filter(function (key) {
      return key !== "home";
    });
    var category = String(data.category || "其他").trim();
    var newCategory = String(data.newCategory || "").trim();
    if (newCategory) category = newCategory;
    return {
      id: state.editing && state.editing.id ? state.editing.id : "",
      name: String(data.name || "").trim(),
      category: category,
      icon: String(data.icon || "🎮").trim() || "🎮",
      defaultPrice: String(data.defaultPrice || "").trim(),
      priceMin: String(data.priceMin || "").trim(),
      priceMax: String(data.priceMax || "").trim(),
      unit: String(data.unit || "局").trim() || "局",
      description: String(data.description || "").trim(),
      requirements: String(data.requirements || "").trim(),
      allowSelfPrice: data.allowSelfPrice === "true" || data.allowSelfPrice === "on",
      allowSelfOff: data.allowSelfOff === "true" || data.allowSelfOff === "on",
      enabled: data.enabled !== "false",
      showHome: showHome,
      allowApply: data.allowApply !== "false",
      allowOrder: data.allowOrder !== "false",
      displayPositions: positions,
      sort: Number((state.editing && state.editing.sort) || state.services.length + 1),
    };
  }

  function load() {
    state.loading = true;
    state.error = "";
    state.loadFailed = false;
    render();
    return apiGet()
      .then(function (res) {
        if (res && res.ok === false) {
          throw new Error(res.message || "服务列表读取失败");
        }
        state.services = (res.services || []).slice().sort(function (a, b) {
          return Number(a.sort || 100) - Number(b.sort || 100);
        });
        if (Array.isArray(res.categories) && res.categories.length) state.categories = res.categories.slice();
        if (Array.isArray(res.categoryRows) && res.categoryRows.length) {
          state.categoryRows = res.categoryRows.slice();
        } else if (Array.isArray(res.categories) && res.categories.length) {
          state.categoryRows = res.categories.map(function (name, i) {
            return { name: name, sort: i + 1, enabled: true };
          });
        }
        if (Array.isArray(res.icons) && res.icons.length) state.icons = res.icons.slice();
        if (Array.isArray(res.positions) && res.positions.length) state.positions = res.positions.slice();
        state.message = res.message || "";
        state.loadFailed = false;
        state.error = "";
        if (state.categoryFilter !== "全部" && state.categories.indexOf(state.categoryFilter) < 0) {
          state.categoryFilter = "全部";
        }
      })
      .catch(function (err) {
        state.error = err.message || "服务列表读取失败";
        state.loadFailed = true;
        // Keep last good snapshot — never paint fake empty catalog on read failure.
      })
      .finally(function () {
        state.loading = false;
        render();
      });
  }

  function save(form) {
    var payload = collectForm(form);
    if (!payload.name) {
      alert("请填写服务名称");
      return;
    }
    if (!payload.displayPositions.length) {
      alert("请至少勾选一个显示位置");
      return;
    }
    var orderFields = readOrderFields(form);
    if (state.saving) return;
    state.saving = true;
    var saveBtn = document.querySelector("[data-service-save]");
    var errorEl = document.querySelector("[data-svc-form-error]");
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "保存中…";
    }
    apiPost({ action: "save", id: payload.id, service: payload })
      .then(function (res) {
        var serviceId = (res.service && res.service.id) || payload.id;
        if (!serviceId) return res;
        return apiPost({ action: "save_order_fields", id: serviceId, orderFields: orderFields }).then(function () {
          return res;
        });
      })
      .then(function (res) {
        var saved = (res && res.service) || null;
        var next = Object.assign({}, state.editing || {}, payload, saved || {});
        if (saved && saved.pricePolicy) next.pricePolicy = saved.pricePolicy;
        else {
          next.pricePolicy = {
            min: payload.priceMin,
            max: payload.priceMax,
            unit: payload.unit,
            description: payload.description,
            requirements: payload.requirements,
            allowSelfPrice: payload.allowSelfPrice,
            allowSelfOff: payload.allowSelfOff,
          };
        }
        next.defaultPrice = payload.defaultPrice;
        next.orderFields = orderFields;
        var idx = state.services.findIndex(function (row) {
          return String(row.id) === String(next.id);
        });
        if (idx >= 0) state.services[idx] = Object.assign({}, state.services[idx], next);
        else if (next.id) state.services.push(next);
        state.message = (res && res.message) || "服务已保存，全站已同步。";
        state.formSignature = formSignature(form);
        state.saving = false;
        var scrollY = state.lockY || 0;
        closeForm();
        refreshServiceList();
        window.scrollTo(0, scrollY);
      })
      .catch(function (err) {
        state.saving = false;
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = "保存";
        }
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent = err.message || "保存失败";
        }
      });
  }

  function refreshServiceList() {
    var main = document.querySelector(".admin-content, .admin-main, main");
    var mainY = main ? main.scrollTop : 0;
    var y = window.scrollY || 0;
    var groups = document.querySelector("[data-service-groups]");
    var nav = document.querySelector(".svc-letters");
    var note = document.querySelector("[data-service-admin]");
    if (!groups || !nav) {
      render();
    } else {
      nav.outerHTML = letterNavHtml();
      groups.innerHTML = renderRows();
      if (note && state.message) {
        var old = note.querySelector(".admin-sync-note");
        if (old) old.textContent = state.message;
      }
    }
    if (main) main.scrollTop = mainY;
    window.scrollTo(0, y);
  }

  function mutate(action, id, extra) {
    return apiPost(Object.assign({ action: action, id: id }, extra || {}))
      .then(function (res) {
        if (res && res.message) {
          /* keep quiet for enable/disable unless needed */
        }
        return load();
      })
      .catch(function (err) {
        alert(err.message || "操作失败");
      });
  }

  function applyCategoryResult(res, fallbackMessage) {
    if (res && Array.isArray(res.categoryRows)) state.categoryRows = res.categoryRows.slice();
    if (res && Array.isArray(res.categories)) state.categories = res.categories.slice();
    state.message = (res && res.message) || fallbackMessage || "分类已更新";
    return load();
  }

  function orderedCategoryNames() {
    return (state.categoryRows || [])
      .slice()
      .sort(function (a, b) {
        return Number(a.sort || 0) - Number(b.sort || 0) || String(a.name).localeCompare(String(b.name), "zh");
      })
      .map(function (row) {
        return row.name;
      });
  }

  function moveCategory(name, delta) {
    var names = orderedCategoryNames();
    var idx = names.indexOf(name);
    var next = idx + delta;
    if (idx < 0 || next < 0 || next >= names.length) return;
    var tmp = names[idx];
    names[idx] = names[next];
    names[next] = tmp;
    apiPost({ action: "reorder_categories", names: names })
      .then(function (res) {
        return applyCategoryResult(res, "分类顺序已更新");
      })
      .catch(function (err) {
        alert(err.message || "调整分类顺序失败");
      });
  }

  function renameCategory(name) {
    var next = window.prompt("修改分类名称（不会删除游戏服务）", name || "");
    if (next == null) return;
    next = String(next).trim();
    if (!next || next === name) return;
    apiPost({ action: "update_category", name: name, newName: next })
      .then(function (res) {
        return applyCategoryResult(res, "分类已改名");
      })
      .catch(function (err) {
        alert(err.message || "改名失败");
      });
  }

  function toggleCategory(name, enabled) {
    apiPost({ action: "toggle_category", name: name, enabled: !!enabled })
      .then(function (res) {
        return applyCategoryResult(res, enabled ? "分类已启用" : "分类已停用");
      })
      .catch(function (err) {
        alert(err.message || "启停失败");
      });
  }

  function deleteCategorySafe(name) {
    var count = categoryCount(name);
    var others = orderedCategoryNames().filter(function (n) {
      return n !== name;
    });
    if (count > 0) {
      if (!others.length) {
        alert("该分类下仍有游戏服务，且没有可迁移的目标分类。请先新增目标分类。");
        return;
      }
      var target = window.prompt(
        "分类「" +
          name +
          "」下有 " +
          count +
          " 个游戏服务。删除分类不会删除服务或价格。\n请输入要迁移到的目标分类名称：\n" +
          others.join(" / "),
        others[0]
      );
      if (target == null) return;
      target = String(target).trim();
      if (!target || target === name) {
        alert("请填写有效的迁移目标分类。");
        return;
      }
      if (!confirm("确认删除分类「" + name + "」，并将 " + count + " 个游戏服务迁移到「" + target + "」？服务与基础价格全部保留。")) {
        return;
      }
      apiPost({ action: "delete_category", name: name, reassignTo: target })
        .then(function (res) {
          return applyCategoryResult(res, "分类已安全删除");
        })
        .catch(function (err) {
          alert(err.message || "删除失败");
        });
      return;
    }
    if (!confirm("确认删除空分类「" + name + "」？不会删除任何游戏服务。")) return;
    apiPost({ action: "delete_category", name: name })
      .then(function (res) {
        return applyCategoryResult(res, "分类已删除");
      })
      .catch(function (err) {
        alert(err.message || "删除失败");
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
          alert(err.message || "排序保存失败");
          load();
        });
    });
  }

  function bind() {
    if (document.documentElement.dataset.serviceAdminBound === "1") return;
    document.documentElement.dataset.serviceAdminBound = "1";

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var dialog = document.getElementById("svcEditDialog");
      if (!dialog || dialog.hidden) return;
      requestCloseForm();
    });

    document.addEventListener("click", function (e) {
      if (!document.getElementById(TARGET_ID)) return;
      var iconBtn = e.target.closest("[data-service-icon]");
      if (iconBtn) {
        var form = iconBtn.closest("[data-service-form]");
        if (!form) return;
        var hidden = form.querySelector('input[name="icon"]');
        if (hidden) hidden.value = iconBtn.getAttribute("data-service-icon") || "🎮";
        form.querySelectorAll("[data-service-icon]").forEach(function (btn) {
          var on = btn === iconBtn;
          btn.classList.toggle("is-on", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        });
        return;
      }
      var letterBtn = e.target.closest("[data-service-letter]");
      if (letterBtn && !letterBtn.disabled) {
        var next = letterBtn.getAttribute("data-service-letter") || "";
        if (next === "ALL") state.letter = "";
        else state.letter = state.letter === next ? "" : next;
        var groups = document.querySelector("[data-service-groups]");
        if (groups) groups.innerHTML = renderRows();
        document.querySelectorAll("[data-service-letter]").forEach(function (btn) {
          var key = btn.getAttribute("data-service-letter") || "";
          var active = key === "ALL" ? !state.letter : key === state.letter;
          btn.classList.toggle("is-on", active);
          btn.setAttribute("aria-pressed", active ? "true" : "false");
        });
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
      if (e.target.closest("[data-svc-dialog-close], [data-service-cancel]")) {
        requestCloseForm();
        return;
      }
      if (e.target.closest("[data-of-add]")) {
        var host = document.querySelector("[data-order-fields]");
        if (host) host.insertAdjacentHTML("beforeend", orderFieldRow({ required: true, enabled: true, kind: "text" }));
        return;
      }
      var removeField = e.target.closest("[data-of-remove]");
      if (removeField) {
        var row = removeField.closest("[data-order-field]");
        if (row && confirm("确认删除这个订单字段？已有订单仍保留原来的内容。")) row.remove();
        return;
      }
      var upField = e.target.closest("[data-of-up]");
      if (upField) {
        var current = upField.closest("[data-order-field]");
        if (current && current.previousElementSibling) current.parentNode.insertBefore(current, current.previousElementSibling);
        return;
      }
      var downField = e.target.closest("[data-of-down]");
      if (downField) {
        var downRow = downField.closest("[data-order-field]");
        if (downRow && downRow.nextElementSibling) downRow.parentNode.insertBefore(downRow.nextElementSibling, downRow);
        return;
      }
      var editBtn = e.target.closest("[data-service-edit]");
      if (editBtn) {
        var item = state.services.find(function (row) {
          return String(row.id) === String(editBtn.getAttribute("data-service-edit"));
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
      var moreBtn = e.target.closest("[data-service-more]");
      if (moreBtn) {
        var mid = moreBtn.getAttribute("data-service-more") || "";
        state.moreOpenId = String(state.moreOpenId) === String(mid) ? "" : mid;
        render();
        return;
      }
      var catFilter = e.target.closest("[data-cat-filter]");
      if (catFilter) {
        state.categoryFilter = catFilter.getAttribute("data-cat-filter") || "全部";
        state.moreOpenId = "";
        render();
        return;
      }
      if (e.target.closest("[data-cat-panel-toggle]")) {
        state.categoryPanelOpen = !state.categoryPanelOpen;
        render();
        return;
      }
      if (e.target.closest("[data-letter-toggle]")) {
        state.letterOpen = !state.letterOpen;
        render();
        return;
      }
      var deleteBtn = e.target.closest("[data-service-delete]");
      if (deleteBtn) {
        var delId = deleteBtn.getAttribute("data-service-delete");
        var delItem = state.services.find(function (row) {
          return String(row.id) === String(delId);
        });
        var delName = (delItem && delItem.name) || "该服务";
        if (!confirm("确认删除「" + delName + "」？\n\n第一次确认：删除后各端服务列表将同步移除。历史订单金额与快照仍保留。")) return;
        if (!confirm("再次确认删除「" + delName + "」？\n\n若仍有陪玩资料引用，需要强制删除才会继续。建议优先「停用」。")) return;
        state.moreOpenId = "";
        apiPost({ action: "delete", id: delId })
          .then(function () {
            return load();
          })
          .catch(function (err) {
            if (err && (err.status === 409 || /仍被引用|SERVICE_IN_USE/.test(String(err.message || "")))) {
              if (confirm((err.message || "服务仍被引用。") + "\n\n是否强制删除？历史订单不会改价。")) {
                return apiPost({ action: "delete", id: delId, force: true }).then(function () {
                  return load();
                });
              }
              return;
            }
            alert((err && err.message) || "删除失败");
          })
          .catch(function (err2) {
            alert((err2 && err2.message) || "删除失败");
          });
        return;
      }

      var catUp = e.target.closest("[data-cat-up]");
      if (catUp) {
        moveCategory(catUp.getAttribute("data-cat-up"), -1);
        return;
      }
      var catDown = e.target.closest("[data-cat-down]");
      if (catDown) {
        moveCategory(catDown.getAttribute("data-cat-down"), 1);
        return;
      }
      var catRename = e.target.closest("[data-cat-rename]");
      if (catRename) {
        renameCategory(catRename.getAttribute("data-cat-rename"));
        return;
      }
      var catEnable = e.target.closest("[data-cat-enable]");
      if (catEnable) {
        toggleCategory(catEnable.getAttribute("data-cat-enable"), true);
        return;
      }
      var catDisable = e.target.closest("[data-cat-disable]");
      if (catDisable) {
        toggleCategory(catDisable.getAttribute("data-cat-disable"), false);
        return;
      }
      var catDelete = e.target.closest("[data-cat-delete]");
      if (catDelete) {
        deleteCategorySafe(catDelete.getAttribute("data-cat-delete"));
      }
    });

    document.addEventListener("submit", function (e) {
      var catForm = e.target.closest("[data-cat-add-form]");
      if (catForm) {
        e.preventDefault();
        var name = String((new FormData(catForm).get("name") || "")).trim();
        if (!name) return;
        apiPost({ action: "add_category", name: name })
          .then(function (res) {
            if (res && res.categoryRows) state.categoryRows = res.categoryRows.slice();
            if (res && res.categories) state.categories = res.categories.slice();
            state.message = (res && res.message) || "分类已添加";
            render();
          })
          .catch(function (err) {
            alert(err.message || "新增分类失败");
          });
        return;
      }
      var form = e.target.closest("[data-service-form]");
      if (!form) return;
      e.preventDefault();
      save(form);
    });

    document.addEventListener("change", function (e) {
      if (e.target.closest("[data-service-category], [data-service-status]")) {
        e.target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      var showHome = e.target.closest('[name="showHome"]');
      if (!showHome) return;
      var form = showHome.closest("[data-service-form]");
      if (!form) return;
      var homeBox = form.querySelector('input[name="displayPositions"][value="home"]');
      if (!homeBox) return;
      homeBox.checked = showHome.value !== "false";
    });

    document.addEventListener("input", function (e) {
      if (!e.target.closest("[data-service-search]")) return;
      state.query = String(e.target.value || "");
      var groups = document.querySelector("[data-service-groups]");
      var nav = document.querySelector(".svc-letter-wrap");
      var tabs = document.querySelector(".svc-cat-tabs");
      if (nav) nav.outerHTML = letterNavHtml();
      if (tabs) tabs.outerHTML = categoryTabsHtml();
      if (groups) groups.innerHTML = renderRows();
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
