(function () {
  "use strict";

  var Auth = window.MCJAdminAuthFetch;
  var Levels = window.MCJCompanionLevels;
  var TARGET_ID = "companionLevelSettings";
  var CARD_BG_OPTIONS = [
    ["solid", "纯色"],
    ["gradient", "渐变"],
    ["glass", "玻璃"],
  ];

  var state = {
    loading: true,
    saving: false,
    publishing: false,
    error: "",
    message: "",
    levels: [],
    selectedId: "",
    dragId: "",
    formOpen: false,
    dirty: false,
    lastPublish: null,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function target() {
    return document.getElementById("companionLevelSettingsHub") || document.getElementById("companionLevelSettings");
  }

  function normalize(row, index) {
    if (Levels && Levels.normalizeLevelRecord) return Levels.normalizeLevelRecord(row);
    return Object.assign({ sort: index + 1 }, row || {});
  }

  function selected() {
    return state.levels.find(function (item) { return String(item.id) === String(state.selectedId); }) || state.levels[0] || null;
  }

  function rangeText(level) {
    if (Levels && Levels.formatRange) return Levels.formatRange(level);
    return (level.min || 0) + "-" + (level.max || 0) + (level.maxPlus ? "+" : "") + " 猫粮";
  }

  function cardBgLabel(value) {
    var found = CARD_BG_OPTIONS.find(function (item) { return item[0] === value; });
    return found ? found[1] : "纯色";
  }

  function moduleBlock(title, hint, inner) {
    return (
      '<section class="panel" style="margin:0;padding:14px 16px">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap">' +
          '<h4 style="margin:0;color:#fff;font-size:14px;font-weight:800">' + esc(title) + "</h4>" +
          (hint ? '<span class="muted" style="font-size:11px">' + esc(hint) + "</span>" : "") +
        "</div>" +
        '<div class="form-grid">' + inner + "</div>" +
      "</section>"
    );
  }

  function previewHtml(level) {
    if (!level) return '<div class="empty">请选择左侧等级</div>';
    var bg = Levels && Levels.cardBackgroundCss ? Levels.cardBackgroundCss(level) : level.color;
    var border = level.badgeBorder || level.color || "#9CA3AF";
    var avatarBorder = level.color || border;
    return (
      '<div class="level-preview-stack">' +
        '<div class="level-preview-card" data-companion-level="' + esc(level.id) + '" style="background:' + esc(bg) + ";border-color:" + esc(level.color) + "66\">" +
          '<div class="level-preview-hero">' +
            '<div class="level-preview-avatar" style="border-color:' + esc(avatarBorder) + ";box-shadow:0 0 14px " + esc(avatarBorder) + "55;color:" + esc(level.badgeIcon) + '">' + esc(level.icon || "●") + "</div>" +
            '<div class="level-preview-hero-copy">' +
              '<div class="level-preview-title-row">' +
                '<strong>示例陪玩</strong>' +
                '<span class="companion-level-pill" data-level-id="' + esc(level.id) + '" style="border-color:' + esc(border) + ";color:" + esc(level.badgeText) + ";background:" + esc(level.color) + '22">' +
                  '<span style="color:' + esc(level.badgeIcon) + '">' + esc(level.icon || "●") + "</span>" +
                  esc(level.code) + " " + esc(level.name) +
                "</span>" +
              "</div>" +
              '<div class="level-preview-rate" style="color:' + esc(level.displayColor) + '">' + esc(rangeText(level)) + " / 小时</div>" +
            "</div>" +
          "</div>" +
          '<div class="level-preview-meta">' +
            '<div class="level-preview-meta-card"><span>卡片背景</span><strong>' + esc(cardBgLabel(level.cardBackground)) + "</strong></div>" +
            '<div class="level-preview-meta-card"><span>平台抽成</span><strong>' + esc(level.commissionRate) + "%</strong></div>" +
            '<div class="level-preview-meta-card"><span>状态</span><strong>' + (level.enabled ? "启用" : "停用") + " · " + (level.open ? "开放申请" : "关闭申请") + "</strong></div>" +
            '<div class="level-preview-meta-card"><span>边框色</span><strong>' + esc(border) + "</strong></div>" +
          "</div>" +
          (level.upgradeCondition
            ? '<div class="level-preview-upgrade">' + esc(level.upgradeCondition) + "</div>"
            : "") +
        "</div>" +
        '<div class="level-preview-tag-row">' +
          '<span class="mcj-level-tag" data-level-id="' + esc(level.id) + '" style="border-color:' + esc(border) + ";color:" + esc(level.badgeText) + ";background:" + esc(level.color) + '22">' +
            '<span style="color:' + esc(level.badgeIcon) + '">' + esc(level.icon || "●") + "</span>" + esc(level.code) +
          "</span>" +
          '<span class="muted level-preview-tag-hint">等级标签 · 与前台真实样式同源变量</span>' +
        "</div>" +
      "</div>"
    );
  }

  function listHtml() {
    if (!state.levels.length) return '<div class="empty">暂无等级，点击「新增下一级」创建</div>';
    return state.levels.map(function (level) {
      var active = String(level.id) === String(state.selectedId);
      return (
        '<button type="button" class="mini-btn level-list-item' + (active ? " primary-lite" : "") + '" data-level-edit="' + esc(level.id) + '" draggable="true" data-level-drag="' + esc(level.id) + '">' +
          '<span class="level-list-drag">⋮⋮</span>' +
          '<span class="level-list-dot" style="background:' + esc(level.color || "#9CA3AF") + '"></span>' +
          '<span class="level-list-name">' + esc(level.code) + " " + esc(level.name) + "</span>" +
          '<span class="level-list-range">' + esc(rangeText(level)) + "</span>" +
        "</button>"
      );
    }).join("");
  }

  function editorHtml(level) {
    if (!level) return "";
    var bgOptions = CARD_BG_OPTIONS.map(function (pair) {
      return '<option value="' + pair[0] + '"' + (level.cardBackground === pair[0] ? " selected" : "") + ">" + pair[1] + "</option>";
    }).join("");
    return (
      '<form class="admin-self-form" data-level-editor style="display:grid;gap:14px">' +
        '<input type="hidden" name="id" value="' + esc(level.id) + '">' +
        moduleBlock("① 等级基础", "名称 / 状态 / 排序 / 申请",
          '<label><span>等级编号</span><input name="code" value="' + esc(level.code) + '" required></label>' +
          '<label><span>等级名称</span><input name="name" value="' + esc(level.name) + '" required placeholder="萌喵"></label>' +
          '<label><span>图标</span><input name="icon" value="' + esc(level.icon) + '" placeholder="💛"></label>' +
          '<label><span>排序</span><input name="sort" type="number" value="' + esc(level.sort) + '"></label>' +
          '<label><span>状态</span><select name="enabled" data-admin-control="switch"><option value="true"' + (level.enabled ? " selected" : "") + '>启用</option><option value="false"' + (!level.enabled ? " selected" : "") + '>停用</option></select></label>' +
          '<label><span>是否开放申请</span><select name="open" data-admin-control="switch"><option value="true"' + (level.open ? " selected" : "") + '>开放</option><option value="false"' + (!level.open ? " selected" : "") + '>关闭</option></select></label>'
        ) +
        moduleBlock("② 前台显示", "徽章 / 边框 / 与照片边框统一",
          '<label><span>徽章颜色</span><input name="color" type="color" value="' + esc(level.color || "#9CA3AF") + '"></label>' +
          '<label><span>首页显示色</span><input name="displayColor" type="color" value="' + esc(level.displayColor || level.color || "#9CA3AF") + '"></label>' +
          '<label><span>徽章边框（照片边框同源）</span><input name="badgeBorder" type="color" value="' + esc(level.badgeBorder || level.color || "#9CA3AF") + '"></label>' +
          '<label><span>徽章文字颜色</span><input name="badgeText" type="color" value="' + esc(level.badgeText || "#ffffff") + '"></label>' +
          '<label><span>图标颜色</span><input name="badgeIcon" type="color" value="' + esc(level.badgeIcon || level.color || "#9CA3AF") + '"></label>' +
          '<label><span>卡片背景</span><select name="cardBackground" data-admin-control="select">' + bgOptions + "</select></label>"
        ) +
        moduleBlock("③ 接单规则", "价格区间 · 平台抽成（新订单生效）",
          '<label><span>最低价（猫粮）</span><input name="min" type="number" min="0" step="1" value="' + esc(level.min) + '" required></label>' +
          '<label><span>最高价（猫粮）</span><input name="max" type="number" min="0" step="1" value="' + esc(level.max) + '" required></label>' +
          '<label><span>允许超过最高价</span><select name="maxPlus" data-admin-control="switch"><option value="false"' + (!level.maxPlus ? " selected" : "") + '>否</option><option value="true"' + (level.maxPlus ? " selected" : "") + '>是</option></select></label>' +
          '<label><span>平台抽成 %</span><input name="commissionRate" type="number" min="0" max="100" step="0.1" value="' + esc(level.commissionRate) + '"><span class="muted" style="font-size:11px;font-weight:600">发布后同步该等级陪玩；历史已结算订单不变</span></label>'
        ) +
        moduleBlock("④ 升级规则", "升级条件与等级说明",
          '<label class="wide"><span>升级条件</span><textarea name="upgradeCondition" rows="4" placeholder="订单数 / 好评率 / 认证完成">' + esc(level.upgradeCondition || "") + "</textarea></label>" +
          '<label class="wide"><span>等级说明</span><textarea name="description" rows="3">' + esc(level.description || "") + "</textarea></label>"
        ) +
        '<div class="row level-editor-actions">' +
          '<button class="primary-btn" type="submit" data-level-save-current' + (state.saving || state.publishing ? " disabled" : "") + ">保存当前等级</button>" +
          '<button class="primary-btn level-publish-btn" type="button" data-level-publish' + (state.saving || state.publishing ? " disabled" : "") + '>发布到全站</button>' +
          '<button class="ghost-btn" type="button" data-level-add>新增下一级</button>' +
          '<button class="ghost-btn" type="button" data-level-delete="' + esc(level.id) + '">删除</button>' +
        "</div>" +
        '<p class="admin-sync-note" style="margin:0">「保存当前等级」只写入当前等级；「发布到全站」保存全部并同步陪玩大厅 / 详情 / 限价 / 抽成 / 四端展示。</p>' +
      "</form>"
    );
  }

  function publishResultHtml(result) {
    if (!result) return "";
    var list = result.checklist || result.sync || [];
    var ok = result.ok !== false;
    var rows = list.map(function (item) {
      return (
        '<div class="level-publish-row">' +
          '<span class="level-publish-ok" style="color:' + (item.ok ? "#34d399" : "#fb7185") + '">' + (item.ok ? "✓" : "✗") + "</span>" +
          "<span>" + esc(item.label || item.key) + "</span>" +
          (item.detail ? '<span class="muted level-publish-detail">' + esc(item.detail) + "</span>" : "") +
        "</div>"
      );
    }).join("");
    return (
      '<div class="admin-sync-note' + (ok ? "" : " error") + '" data-level-publish-result style="margin-top:12px">' +
        "<strong>" + esc(ok ? "已同步全站" : (result.message || "发布未完全成功")) + "</strong>" +
        '<div class="level-publish-list">' + rows + "</div>" +
      "</div>"
    );
  }

  function overlayBodyHtml(level) {
    return (
      '<div class="level-admin-overlay-layout">' +
        '<div class="level-admin-editor-col">' + editorHtml(level) + (state.lastPublish ? publishResultHtml(state.lastPublish) : "") + "</div>" +
        '<section class="level-admin-preview-col">' +
          '<h4 class="level-preview-heading">⑤ 实时预览</h4>' +
          '<div data-level-preview>' + previewHtml(level) + "</div>" +
          '<p class="muted level-preview-hint">改颜色 / 价格 / 抽成后右侧即时预览；发布后刷新各端即可一致。</p>' +
        "</section>" +
      "</div>"
    );
  }

  function levelEditorTitle(level) {
    return level ? "全站等级配置 · " + level.code + " " + level.name : "全站等级配置";
  }

  function pageHtml() {
    if (state.loading) return '<div class="content-loading">正在读取全站等级配置...</div>';
    var level = selected();
    var statusText = state.error || state.message || (state.dirty ? "有未发布修改" : "修改后预览 → 保存当前 / 发布到全站");
    var head = (
      '<div class="content-admin-head"><div><h3>全站等级配置中心</h3><p>陪玩大厅、更多玩法、陪玩详情、老板端、客服端、陪玩端统一读取 <code>companion_levels</code>，禁止各页自写一套。</p></div>' +
        '<div class="content-version-meta"><span>' + esc(state.levels.length) + " 个等级</span><span>" + esc(statusText) + "</span></div></div>"
    );
    var toolbar = (
      '<div class="content-admin-toolbar compact level-admin-toolbar">' +
        '<button class="btn primary" type="button" data-level-add>新增下一级</button>' +
        '<button class="btn" type="button" data-level-edit-selected' + (level ? "" : " disabled") + '>编辑选中等级</button>' +
        '<button class="btn" type="button" data-level-publish-page' + (state.levels.length ? "" : " disabled") + '>发布到全站</button>' +
      "</div>"
    );
    var listSection = (
      '<section class="panel level-admin-list-panel"><h2>等级列表</h2><div class="level-admin-list" data-level-list>' + listHtml() + "</div>" +
        '<p class="muted level-admin-list-hint">拖动手柄调整排序；编辑面板按基础 / 前台显示 / 接单规则 / 升级规则分组，右侧实时预览。</p></section>'
    );
    if (!window.MCJAdminOverlay) {
      return (
        '<div class="level-admin-page">' + head + toolbar +
        '<div class="level-admin-layout">' +
          listSection +
          '<div class="level-admin-editor-col">' + editorHtml(level) + (state.lastPublish ? publishResultHtml(state.lastPublish) : "") + "</div>" +
          '<section class="panel level-admin-preview-panel"><h2>⑤ 实时预览</h2><div data-level-preview>' + previewHtml(level) + "</div></section>" +
        "</div></div>"
      );
    }
    return '<div class="level-admin-page">' + head + toolbar + listSection + (state.lastPublish && !state.formOpen ? publishResultHtml(state.lastPublish) : "") + "</div>";
  }

  function openLevelEditor(id) {
    if (id) state.selectedId = id;
    if (!selected()) return;
    state.formOpen = true;
    render();
  }

  function closeLevelEditor() {
    state.formOpen = false;
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
      return;
    }
    render();
  }

  function syncLevelEditor() {
    if (!state.formOpen || !window.MCJAdminOverlay) return;
    var level = selected();
    if (!level) {
      state.formOpen = false;
      if (window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) window.MCJAdminOverlay.close();
      return;
    }
    if (window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.setTitle(levelEditorTitle(level));
      window.MCJAdminOverlay.setBody(overlayBodyHtml(level));
    } else {
      window.MCJAdminOverlay.open({
        title: levelEditorTitle(level),
        html: overlayBodyHtml(level),
        onClose: function () {
          state.formOpen = false;
        },
      });
    }
  }

  function render() {
    var el = target();
    if (!el) return;
    el.innerHTML = pageHtml();
    if (window.MCJAdminForms && window.MCJAdminForms.enhance) window.MCJAdminForms.enhance(el);
    syncLevelEditor();
  }

  function collectEditor(form) {
    var fd = new FormData(form);
    var current = selected() || {};
    return normalize({
      id: String(fd.get("id") || current.id || ""),
      level: current.level,
      code: String(fd.get("code") || "").trim(),
      name: String(fd.get("name") || "").trim(),
      icon: String(fd.get("icon") || "").trim(),
      color: String(fd.get("color") || "#9CA3AF"),
      displayColor: String(fd.get("displayColor") || fd.get("color") || "#9CA3AF"),
      cardBackground: String(fd.get("cardBackground") || "solid"),
      badgeBorder: String(fd.get("badgeBorder") || "#9CA3AF"),
      badgeText: String(fd.get("badgeText") || "#ffffff"),
      badgeIcon: String(fd.get("badgeIcon") || "#9CA3AF"),
      min: Number(fd.get("min") || 0),
      max: Number(fd.get("max") || 0),
      maxPlus: String(fd.get("maxPlus")) === "true",
      commissionRate: Number(fd.get("commissionRate") || 0),
      sort: Number(fd.get("sort") || current.sort || 1),
      open: String(fd.get("open")) !== "false",
      enabled: String(fd.get("enabled")) !== "false",
      upgradeCondition: String(fd.get("upgradeCondition") || ""),
      description: String(fd.get("description") || ""),
    });
  }

  function patchSelectedFromForm(form) {
    var next = collectEditor(form);
    state.levels = state.levels.map(function (item) {
      return String(item.id) === String(next.id) ? next : item;
    });
    state.selectedId = next.id;
    state.dirty = true;
    var overlayBody = window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen() ? window.MCJAdminOverlay.getBody() : null;
    var preview = (overlayBody && overlayBody.querySelector("[data-level-preview]")) || (target() && target().querySelector("[data-level-preview]"));
    if (preview) preview.innerHTML = previewHtml(next);
    var list = target() && target().querySelector("[data-level-list]");
    if (list) list.innerHTML = listHtml();
  }

  function apiGet() {
    if (Auth && Auth.get) return Auth.get("/api/admin/companion-levels");
    return fetch("/api/admin/companion-levels", { headers: { Accept: "application/json", "x-mcj-admin-role": "admin" }, cache: "no-store" }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "读取失败");
        return body;
      });
    });
  }

  function apiPost(body) {
    var req = Auth && Auth.fetch
      ? Auth.fetch("/api/admin/companion-levels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : fetch("/api/admin/companion-levels", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-mcj-admin-role": "admin" },
          body: JSON.stringify(body),
        });
    return req.then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch (e) {
          throw new Error("接口返回格式错误");
        }
        if (!res.ok || data.ok === false) {
          var err = new Error(data.message || "保存失败");
          err.body = data;
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function applyLocal(levels) {
    state.levels = (levels || []).map(normalize).sort(function (a, b) { return a.sort - b.sort || a.level - b.level; });
    if (!state.levels.some(function (item) { return String(item.id) === String(state.selectedId); })) {
      state.selectedId = state.levels[0] ? state.levels[0].id : "";
    }
    if (Levels && Levels.hydrateFromList) Levels.hydrateFromList(state.levels);
    else if (Levels && Levels.save) Levels.save(state.levels);
  }

  function load() {
    state.loading = true;
    state.error = "";
    render();
    apiGet()
      .then(function (result) {
        applyLocal(result.levels || []);
        state.loading = false;
        state.dirty = false;
        state.message = "已加载全站等级配置（companion_levels）";
        render();
      })
      .catch(function (err) {
        applyLocal(Levels && Levels.read ? Levels.read() : []);
        state.loading = false;
        state.error = err.message || "读取失败，已使用本地默认等级";
        render();
      });
  }

  function findEditorForm() {
    var overlayBody = window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen() ? window.MCJAdminOverlay.getBody() : null;
    return (overlayBody && overlayBody.querySelector("[data-level-editor]")) || (target() && target().querySelector("[data-level-editor]"));
  }

  function saveCurrent() {
    var form = findEditorForm();
    if (form) patchSelectedFromForm(form);
    var level = selected();
    if (!level) {
      alert("请先选择要保存的等级");
      return Promise.resolve();
    }
    state.saving = true;
    state.message = "正在保存当前等级…";
    state.error = "";
    render();
    return apiPost({ action: "save_one", level: level })
      .then(function (result) {
        applyLocal(result.levels || state.levels);
        state.saving = false;
        state.dirty = false;
        state.message = result.message || "当前等级已保存";
        state.error = "";
        state.lastPublish = null;
        render();
      })
      .catch(function (err) {
        state.saving = false;
        state.error = err.message || "保存失败";
        state.message = "";
        render();
        alert("保存失败：" + (err.message || "未知错误"));
      });
  }

  function publishAll() {
    var form = findEditorForm();
    if (form) patchSelectedFromForm(form);
    state.levels = state.levels.map(function (item, index) {
      item.sort = index + 1;
      return item;
    });
    if (!state.levels.length) {
      alert("没有可发布的等级");
      return Promise.resolve();
    }
    state.publishing = true;
    state.message = "正在发布到全站…";
    state.error = "";
    state.lastPublish = null;
    render();
    return apiPost({ action: "publish", levels: state.levels, syncCommission: true })
      .then(function (result) {
        applyLocal(result.levels || state.levels);
        state.publishing = false;
        state.dirty = false;
        state.lastPublish = result;
        state.message = result.message || "已同步全站";
        state.error = "";
        render();
      })
      .catch(function (err) {
        state.publishing = false;
        var payload = err && err.body ? err.body : null;
        if (payload && (payload.checklist || payload.sync)) {
          state.lastPublish = payload;
        } else {
          state.lastPublish = {
            ok: false,
            message: err.message || "发布失败",
            checklist: [
              { key: "db", label: "数据库 companion_levels", ok: false, detail: err.message || "失败" },
              { key: "boss_hall", label: "老板端 · 陪玩大厅", ok: false, detail: "未同步" },
              { key: "companion", label: "陪玩端 · 限价与抽成", ok: false, detail: "未同步" },
              { key: "cs", label: "客服端 · 等级展示", ok: false, detail: "未同步" },
              { key: "device", label: "手机 / PC", ok: false, detail: "未同步" },
            ],
          };
        }
        state.error = err.message || "发布失败";
        state.message = "";
        render();
        alert("发布失败：" + (err.message || "未知错误") + "\n禁止静默失败，请根据清单排查。");
      });
  }

  function addLevel() {
    var maxLevel = state.levels.reduce(function (acc, item) { return Math.max(acc, Number(item.level) || 0); }, 0) + 1;
    var next = normalize({
      id: "lv" + maxLevel,
      level: maxLevel,
      code: "Lv" + maxLevel,
      name: "等级" + maxLevel,
      color: "#9CA3AF",
      displayColor: "#9CA3AF",
      cardBackground: "solid",
      badgeBorder: "#9CA3AF",
      badgeText: "#E5E7EB",
      badgeIcon: "#D1D5DB",
      min: 20,
      max: 30,
      commissionRate: 20,
      sort: state.levels.length + 1,
      open: true,
      enabled: true,
      upgradeCondition: "订单数：\n好评率：\n认证完成：",
      description: "",
    });
    state.levels.push(next);
    state.dirty = true;
    openLevelEditor(next.id);
  }

  function deleteLevel(id) {
    if (!confirm("确认删除该等级？已绑定陪玩需先迁移等级。删除后请「发布到全站」。")) return;
    state.levels = state.levels.filter(function (item) { return String(item.id) !== String(id); });
    state.selectedId = state.levels[0] ? state.levels[0].id : "";
    state.dirty = true;
    closeLevelEditor();
    publishAll();
  }

  function bind() {
    if (document.documentElement.dataset.levelAdminBound === "1") return;
    document.documentElement.dataset.levelAdminBound = "1";

    document.addEventListener("click", function (e) {
      if (!target()) return;
      var edit = e.target.closest("[data-level-edit]");
      if (edit) {
        openLevelEditor(edit.getAttribute("data-level-edit"));
        return;
      }
      if (e.target.closest("[data-level-edit-selected]")) {
        openLevelEditor(state.selectedId);
        return;
      }
      if (e.target.closest("[data-level-add]")) {
        addLevel();
        return;
      }
      var del = e.target.closest("[data-level-delete]");
      if (del) {
        deleteLevel(del.getAttribute("data-level-delete"));
        return;
      }
      if (e.target.closest("[data-level-publish]") || e.target.closest("[data-level-publish-page]")) {
        e.preventDefault();
        publishAll();
        return;
      }
    });

    document.addEventListener("input", function (e) {
      var form = e.target.closest("[data-level-editor]");
      if (!form) return;
      patchSelectedFromForm(form);
    });
    document.addEventListener("change", function (e) {
      var form = e.target.closest("[data-level-editor]");
      if (!form) return;
      patchSelectedFromForm(form);
    });

    document.addEventListener("submit", function (e) {
      var form = e.target.closest("[data-level-editor]");
      if (!form) return;
      e.preventDefault();
      saveCurrent();
    });

    document.addEventListener("dragstart", function (e) {
      var btn = e.target.closest("[data-level-drag]");
      if (!btn) return;
      state.dragId = btn.getAttribute("data-level-drag");
      e.dataTransfer.effectAllowed = "move";
    });
    document.addEventListener("dragover", function (e) {
      if (!e.target.closest("[data-level-drag]")) return;
      e.preventDefault();
    });
    document.addEventListener("drop", function (e) {
      var btn = e.target.closest("[data-level-drag]");
      if (!btn || !state.dragId) return;
      e.preventDefault();
      var toId = btn.getAttribute("data-level-drag");
      if (toId === state.dragId) return;
      var fromIndex = state.levels.findIndex(function (item) { return String(item.id) === String(state.dragId); });
      var toIndex = state.levels.findIndex(function (item) { return String(item.id) === String(toId); });
      if (fromIndex < 0 || toIndex < 0) return;
      var moved = state.levels.splice(fromIndex, 1)[0];
      state.levels.splice(toIndex, 0, moved);
      state.levels = state.levels.map(function (item, index) {
        item.sort = index + 1;
        return item;
      });
      state.dragId = "";
      state.dirty = true;
      render();
    });
  }

  function boot() {
    if (!target()) return;
    bind();
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJAdminCompanionLevels = { reload: load, render: render, publish: publishAll, saveCurrent: saveCurrent };
})();
