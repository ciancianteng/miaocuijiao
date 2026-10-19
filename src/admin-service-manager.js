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
    levelMarkupCaps: { 1: 5, 2: 8, 3: 10, 4: 13, 5: 15 },
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
      gameName: "",
      platform: "",
      description: "",
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
          gameName: (item.pricePolicy && item.pricePolicy.gameName) || "",
          platform: (item.pricePolicy && item.pricePolicy.platform) || "",
          description: (item.pricePolicy && item.pricePolicy.description) || "",
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
    if (!openFormOverlay()) render();
  }

  function closeForm() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
      return;
    }
    state.formOpen = false;
    state.editing = null;
    render();
  }

  function formTitle() {
    return state.editing && state.editing.id ? "编辑服务" : "新增服务";
  }

  function openFormOverlay() {
    if (!state.formOpen || !state.editing) return false;
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({
        title: formTitle(),
        html: renderForm(),
        onClose: function () {
          state.formOpen = false;
          state.editing = null;
        },
      });
      return true;
    }
    return false;
  }

  function syncFormOverlay() {
    if (!state.formOpen || !state.editing || !window.MCJAdminOverlay) return;
    if (window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) window.MCJAdminOverlay.setBody(renderForm());
    else openFormOverlay();
  }

  function renderIconPicker(selected) {
    return (
      '<div class="admin-service-span-2"><span class="admin-field-label">服务图标</span>' +
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
    var categoryField = Forms
      ? Forms.selectHtml({
          name: "category",
          label: "服务分类",
          value: d.category || "手游",
          options: categoryOptions,
        })
      : '<label><span>服务分类</span><select name="category">' +
        categoryOptions
          .map(function (cat) {
            return '<option value="' + esc(cat) + '" ' + (d.category === cat ? "selected" : "") + ">" + esc(cat) + "</option>";
          })
          .join("") +
        "</select></label>";
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
      '<form class="platform-content-form admin-service-form" data-service-form>' +
      '<section class="svc-section"><h4>基本信息</h4>' +
      '<label class="svc-field"><span>服务名称</span><input name="name" required maxlength="40" placeholder="例如：无畏契约端游" value="' +
      esc(d.name) +
      '"></label>' +
      '<label class="svc-field"><span>游戏名称</span><input name="gameName" maxlength="40" placeholder="例如：无畏契约" value="' +
      esc(d.gameName || "") +
      '"></label>' +
      '<label class="svc-field"><span>平台 / 区服</span><input name="platform" maxlength="60" placeholder="例如：端游 / 国服" value="' +
      esc(d.platform || "") +
      '"></label>' +
      '<label class="svc-field"><span>服务介绍</span><textarea name="description" maxlength="500" rows="3" placeholder="服务内容、适合谁、包含什么">' +
      esc(d.description || "") +
      "</textarea></label>" +
      '<label class="svc-field"><span>展示排序</span><input name="sort" inputmode="numeric" maxlength="6" placeholder="1" value="' +
      esc(d.sort == null ? "" : d.sort) +
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
      '<p class="svc-note">允许自定义单价时必须填写最低和最高价格。陪玩最终单价 = 标准价 + 等级加价，最低加价为 RM 1，最高加价由上方等级规则决定。最低价和最高价会与这个加价范围取交集，没有交集时不能保存。未填写完整价格时，陪玩端显示「平台尚未配置价格」，不能新下单。保存后只影响新订单。</p>' +
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
      '<label class="svc-perm"><input type="checkbox" name="allowSelfOff" value="true"' +
      (d.allowSelfOff ? " checked" : "") +
      "> 允许陪玩自主关闭服务</label>" +
      "</div>" +
      '<p class="svc-note">陪玩端每个服务都有独立的开启接单开关，和在线、离线状态分开。未配置完整价格时不能开启。</p>' +
      "</section>" +
      '<div class="form-actions svc-actions"><button class="btn primary" type="submit" ' +
      (state.saving ? "disabled" : "") +
      ">" +
      (state.saving ? "保存中…" : "保存") +
      '</button><button class="btn" type="button" data-service-cancel>取消</button></div>' +
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
      '<label class="svc-mini-toggle"><input type="checkbox" data-of-required' + (field.required === false ? "" : " checked") + '><i></i><span>必填</span></label>' +
      '<label class="svc-mini-toggle"><input type="checkbox" data-of-enabled' + (field.enabled === false ? "" : " checked") + '><i></i><span>启用</span></label>' +
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

  function renderRows() {
    if (!state.services.length) {
      return (
        '<div class="content-empty-action"><strong>暂无服务</strong><span>点击「新增服务」添加平台服务。首页、陪玩申请、客服建单、老板下单将读取同一份数据。</span>' +
        '<button class="btn primary" type="button" data-service-new>新增服务</button></div>'
      );
    }
    var rows = state.services
      .map(function (item) {
        var policy = item.pricePolicy || {};
        var unit = policy.unit || "局";
        var standardRaw = item.defaultPrice || item.default_price || "";
        var standardNum = Number(standardRaw);
        var standardText =
          String(standardRaw).trim() && Number.isFinite(standardNum) && standardNum > 0
            ? "后台标准价格 RM " + standardRaw + " / " + unit
            : "平台尚未配置价格";
        var range =
          policy.allowSelfPrice && policy.min != null && policy.max != null
            ? "允许范围 RM " + policy.min + "–" + policy.max + " / " + unit
            : policy.allowSelfPrice
              ? "平台尚未配置价格"
              : "平台统一定价";
        var on = item.enabled !== false;
        return (
          '<article class="svc-card" draggable="true" data-service-row="' +
          esc(item.id) +
          '" data-service-card data-category="' +
          esc(item.category || "") +
          '" data-status="' +
          (on ? "on" : "off") +
          '">' +
          '<div class="svc-card-icon" aria-hidden="true">' +
          esc(item.icon || "🎮") +
          "</div>" +
          '<div class="svc-card-main">' +
          "<strong>" +
          esc(item.name || "-") +
          "</strong>" +
          "<span>" +
          esc(item.category || "-") +
          "</span>" +
          "<em>" +
          esc(standardText) +
          "</em>" +
          "<small>" +
          esc(range) +
          "</small>" +
          '<div class="svc-card-tags">' +
          statusChip(on ? "启用" : "停用", on) +
          statusChip(policy.allowSelfPrice ? "可自主定价" : "平台统一定价", !!policy.allowSelfPrice) +
          "</div></div>" +
          '<div class="svc-card-actions">' +
          '<button class="mini-btn" type="button" data-service-edit="' +
          esc(item.id) +
          '">编辑</button>' +
          (on
            ? '<button class="mini-btn" type="button" data-service-disable="' + esc(item.id) + '">停用</button>'
            : '<button class="mini-btn primary-lite" type="button" data-service-enable="' + esc(item.id) + '">启用</button>') +
          "</div></article>"
        );
      })
      .join("");
    return '<div class="svc-list" data-service-sortable>' + rows + "</div>";
  }

  function renderLevelCaps() {
    var caps = state.levelMarkupCaps || {};
    function field(lv, fallback) {
      var value = caps[lv] != null ? caps[lv] : caps[String(lv)];
      if (value == null || value === "") value = fallback;
      return (
        '<label class="svc-field"><span>LV' +
        lv +
        ' 最高加价</span><span class="svc-rm"><i>RM</i><input name="cap' +
        lv +
        '" inputmode="decimal" maxlength="8" value="' +
        esc(value) +
        '"></span></label>'
      );
    }
    return (
      '<form class="svc-section" data-level-caps-form><h4>等级加价上限</h4>' +
      '<p class="svc-note">陪玩可在标准价上加价。最低加价统一为 RM 1，最高加价按真实等级读取。修改后写入数据库，已支付订单的金额保持原样。</p>' +
      '<div class="svc-price-row">' +
      field(1, 5) +
      field(2, 8) +
      field(3, 10) +
      field(4, 13) +
      field(5, 15) +
      '</div><button class="btn" type="submit">保存等级加价</button></form>'
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
      '<div class="content-admin-toolbar compact svc-toolbar"><input data-service-search placeholder="搜索服务">' +
      '<select data-service-category><option value="">全部分类</option>' +
      state.categories
        .map(function (cat) {
          return '<option value="' + esc(cat) + '">' + esc(cat) + "</option>";
        })
        .join("") +
      '</select><select data-service-status><option value="">全部状态</option><option value="on">启用</option><option value="off">停用</option></select>' +
      '<button class="btn primary" type="button" data-service-new>新增服务</button>' +
      '<button class="btn" type="button" data-service-reload>刷新</button></div>' +
      renderLevelCaps() +
      (!window.MCJAdminOverlay ? renderForm() : "") +
      renderRows() +
      "</div>";
    if (window.MCJAdminForms && window.MCJAdminForms.enhance) window.MCJAdminForms.enhance(box);
    bindSortable();
    syncFormOverlay();
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
      gameName: String(data.gameName || "").trim(),
      platform: String(data.platform || "").trim(),
      description: String(data.description || "").trim(),
      allowSelfPrice: data.allowSelfPrice === "true" || data.allowSelfPrice === "on",
      allowSelfOff: data.allowSelfOff === "true" || data.allowSelfOff === "on",
      enabled: data.enabled !== "false",
      showHome: showHome,
      allowApply: data.allowApply !== "false",
      allowOrder: data.allowOrder !== "false",
      displayPositions: positions,
      sort: String(data.sort || "").trim() ? Number(data.sort) : Number((state.editing && state.editing.sort) || state.services.length + 1),
    };
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
        if (res.levelMarkupCaps) state.levelMarkupCaps = res.levelMarkupCaps;
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
    function badMoney(value) {
      var text = String(value || "").trim();
      if (!text) return false;
      return !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text);
    }
    if (badMoney(payload.defaultPrice) || badMoney(payload.priceMin) || badMoney(payload.priceMax)) {
      alert("不允许输入负数或非法字符。");
      return;
    }
    if (String(payload.defaultPrice || "").trim() && !(Number(payload.defaultPrice) > 0)) {
      alert("平台标准价格必须大于 0。");
      return;
    }
    if (payload.allowSelfPrice && (!String(payload.priceMin || "").trim() || !String(payload.priceMax || "").trim())) {
      alert("允许自定义单价时必须同时设置最低和最高价格。");
      return;
    }
    if (
      payload.allowSelfPrice &&
      String(payload.priceMin || "").trim() &&
      String(payload.priceMax || "").trim() &&
      Number(payload.priceMax) < Number(payload.priceMin)
    ) {
      alert("最高价格不能低于最低价格。");
      return;
    }
    if (payload.allowSelfPrice && !(Number(payload.priceMax) > 0)) {
      alert("最高价格必须大于 0。");
      return;
    }
    if (payload.allowSelfPrice && Number(payload.defaultPrice) > 0 && String(payload.priceMin || "").trim() && String(payload.priceMax || "").trim()) {
      var caps = state.levelMarkupCaps || {};
      var highest = Math.max(Number(caps[1] || caps["1"] || 5), Number(caps[2] || caps["2"] || 8), Number(caps[3] || caps["3"] || 10), Number(caps[4] || caps["4"] || 13), Number(caps[5] || caps["5"] || 15));
      var floor = Number(payload.defaultPrice) + 1;
      var ceil = Number(payload.defaultPrice) + highest;
      var lo = Math.max(Number(payload.priceMin), floor);
      var hi = Math.min(Number(payload.priceMax), ceil);
      if (!(hi >= lo)) {
        alert("自定义价格范围与等级加价没有交集。标准价 RM " + payload.defaultPrice + "，等级加价后为 RM " + floor + "–" + ceil + "，后台范围是 RM " + payload.priceMin + "–" + payload.priceMax + "。");
        return;
      }
    }
    var orderFields = readOrderFields(form);
    state.saving = true;
    render();
    apiPost({ action: "save", id: payload.id, service: payload })
      .then(function (res) {
        var serviceId = (res.service && res.service.id) || payload.id;
        if (!serviceId) return res;
        return apiPost({ action: "save_order_fields", id: serviceId, orderFields: orderFields }).then(function () {
          return res;
        });
      })
      .then(function (res) {
        alert((res && res.message) || "服务已保存，全站已同步。");
        if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
          window.MCJAdminOverlay.close();
        } else {
          state.formOpen = false;
          state.editing = null;
        }
        state.saving = false;
        return load();
      })
      .catch(function (err) {
        state.saving = false;
        render();
        alert(err.message || "保存失败");
      });
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

  function saveLevelCaps(form) {
    var caps = {};
    for (var lv = 1; lv <= 5; lv += 1) {
      var input = form.querySelector('[name="cap' + lv + '"]');
      var text = String(input ? input.value : "").trim();
      if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text) || !(Number(text) >= 1)) {
        alert("LV" + lv + " 加价上限必须大于或等于 RM 1。");
        return;
      }
      caps[lv] = Number(text);
    }
    apiPost({ action: "save_level_markup_caps", caps: caps })
      .then(function (res) {
        if (res.levelMarkupCaps) state.levelMarkupCaps = res.levelMarkupCaps;
        alert(res.message || "等级加价上限已保存。");
        return load();
      })
      .catch(function (err) {
        alert(err.message || "等级加价保存失败");
      });
  }

  function bind() {
    if (document.documentElement.dataset.serviceAdminBound === "1") return;
    document.documentElement.dataset.serviceAdminBound = "1";

    document.addEventListener("click", function (e) {
      if (!document.getElementById(TARGET_ID)) return;
      var iconBtn = e.target.closest("[data-service-icon]");
      if (iconBtn) {
        var form = iconBtn.closest("[data-service-form]");
        if (!form) return;
        var hidden = form.querySelector('input[name="icon"]');
        if (hidden) hidden.value = iconBtn.getAttribute("data-service-icon") || "🎮";
        form.querySelectorAll("[data-service-icon]").forEach(function (btn) {
          btn.classList.toggle("primary-lite", btn === iconBtn);
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
      if (e.target.closest("[data-service-cancel]")) {
        closeForm();
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
      var deleteBtn = e.target.closest("[data-service-delete]");
      if (deleteBtn) {
        if (!confirm("确认删除该服务？删除后各端将同步移除（历史订单仍保留原服务名）。")) return;
        mutate("delete", deleteBtn.getAttribute("data-service-delete"));
      }
    });

    document.addEventListener("submit", function (e) {
      var capsForm = e.target.closest("[data-level-caps-form]");
      if (capsForm) {
        e.preventDefault();
        saveLevelCaps(capsForm);
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
      if (!e.target.closest("[data-service-search], [data-service-category], [data-service-status]")) return;
      var wrap = document.querySelector("[data-service-admin]");
      if (!wrap) return;
      var q = String((wrap.querySelector("[data-service-search]") || {}).value || "")
        .trim()
        .toLowerCase();
      var cat = String((wrap.querySelector("[data-service-category]") || {}).value || "");
      var st = String((wrap.querySelector("[data-service-status]") || {}).value || "");
      wrap.querySelectorAll("[data-service-card]").forEach(function (row) {
        var missQ = !!(q && row.textContent.toLowerCase().indexOf(q) === -1);
        var missCat = !!(cat && row.getAttribute("data-category") !== cat);
        var missSt = !!(st && row.getAttribute("data-status") !== st);
        row.hidden = missQ || missCat || missSt;
      });
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
