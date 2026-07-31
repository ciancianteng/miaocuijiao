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
    error: "",
    message: "",
    levels: [],
    selectedId: "",
    dragId: "",
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function target() {
    return document.getElementById(TARGET_ID);
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

  function previewHtml(level) {
    if (!level) return '<div class="empty">请选择左侧等级</div>';
    var bg = Levels && Levels.cardBackgroundCss ? Levels.cardBackgroundCss(level) : level.color;
    return (
      '<div class="level-preview-card" style="background:' + esc(bg) + ';border:1px solid ' + esc(level.color) + '66;border-radius:14px;padding:16px;display:grid;gap:10px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
          '<strong style="font-size:18px;color:#fff">' + esc(level.code) + " " + esc(level.name) + "</strong>" +
          '<span style="display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 10px;border-radius:999px;border:1px solid ' + esc(level.badgeBorder) + ";color:" + esc(level.badgeText) + ";background:" + esc(level.color) + '22;font-size:12px;font-weight:700">' +
            '<span style="color:' + esc(level.badgeIcon) + '">' + esc(level.icon || "●") + "</span>" +
            esc(level.code) +
          "</span>" +
        "</div>" +
        '<div style="color:rgba(255,255,255,.72);font-size:13px">' + esc(cardBgLabel(level.cardBackground)) + "背景</div>" +
        '<div style="color:' + esc(level.displayColor) + ';font-weight:800;font-size:16px">' + esc(rangeText(level)) + "</div>" +
        '<div style="color:rgba(255,255,255,.55);font-size:12px;line-height:1.6;white-space:pre-wrap">' + esc(level.upgradeCondition || level.description || "") + "</div>" +
        '<div style="color:rgba(255,255,255,.55);font-size:12px">平台抽成：' + esc(level.commissionRate) + "%</div>" +
      "</div>"
    );
  }

  function listHtml() {
    return state.levels.map(function (level) {
      var active = String(level.id) === String(state.selectedId);
      return (
        '<button type="button" class="mini-btn' + (active ? " primary-lite" : "") + '" data-level-select="' + esc(level.id) + '" draggable="true" data-level-drag="' + esc(level.id) + '" style="justify-content:flex-start;width:100%;text-align:left">' +
          '<span style="opacity:.55;margin-right:8px">⋮⋮</span>' +
          esc(level.code) + " " + esc(level.name) +
          '<span style="margin-left:auto;opacity:.65">' + esc(rangeText(level)) + "</span>" +
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
      '<form class="admin-self-form" data-level-editor>' +
        '<input type="hidden" name="id" value="' + esc(level.id) + '">' +
        '<div class="form-grid">' +
          '<label><span>等级编号</span><input name="code" value="' + esc(level.code) + '" required></label>' +
          '<label><span>等级名称</span><input name="name" value="' + esc(level.name) + '" required placeholder="萌喵"></label>' +
          '<label><span>图标</span><input name="icon" value="' + esc(level.icon) + '" placeholder="💛"></label>' +
          '<label><span>显示颜色</span><input name="color" type="color" value="' + esc(level.color || "#9CA3AF") + '"></label>' +
          '<label><span>首页显示颜色</span><input name="displayColor" type="color" value="' + esc(level.displayColor || level.color || "#9CA3AF") + '"></label>' +
          '<label><span>卡片背景</span><select name="cardBackground" data-admin-control="select">' + bgOptions + "</select></label>" +
          '<label><span>徽章边框</span><input name="badgeBorder" type="color" value="' + esc(level.badgeBorder || level.color || "#9CA3AF") + '"></label>' +
          '<label><span>徽章文字</span><input name="badgeText" type="color" value="' + esc(level.badgeText || "#ffffff") + '"></label>' +
          '<label><span>徽章图标色</span><input name="badgeIcon" type="color" value="' + esc(level.badgeIcon || level.color || "#9CA3AF") + '"></label>' +
          '<label><span>最低价 RM</span><input name="min" type="number" min="0" step="1" value="' + esc(level.min) + '" required></label>' +
          '<label><span>最高价 RM</span><input name="max" type="number" min="0" step="1" value="' + esc(level.max) + '" required></label>' +
          '<label><span>允许最高价以上</span><select name="maxPlus" data-admin-control="switch"><option value="false"' + (!level.maxPlus ? " selected" : "") + '>否</option><option value="true"' + (level.maxPlus ? " selected" : "") + '>是</option></select></label>' +
          '<label><span>平台抽成 %</span><input name="commissionRate" type="number" min="0" max="100" step="0.1" value="' + esc(level.commissionRate) + '"></label>' +
          '<label><span>排序</span><input name="sort" type="number" value="' + esc(level.sort) + '"></label>' +
          '<label><span>开放申请</span><select name="open" data-admin-control="switch"><option value="true"' + (level.open ? " selected" : "") + '>开放</option><option value="false"' + (!level.open ? " selected" : "") + '>关闭</option></select></label>' +
          '<label><span>状态</span><select name="enabled" data-admin-control="switch"><option value="true"' + (level.enabled ? " selected" : "") + '>启用</option><option value="false"' + (!level.enabled ? " selected" : "") + '>停用</option></select></label>' +
          '<label class="wide"><span>升级条件</span><textarea name="upgradeCondition" rows="4" placeholder="订单数 / 好评率 / 认证完成">' + esc(level.upgradeCondition || "") + "</textarea></label>" +
          '<label class="wide"><span>等级说明</span><textarea name="description" rows="3">' + esc(level.description || "") + "</textarea></label>" +
        "</div>" +
        '<div class="row" style="margin-top:14px;gap:10px;flex-wrap:wrap">' +
          '<button class="primary-btn" type="submit"' + (state.saving ? " disabled" : "") + ">保存当前等级</button>" +
          '<button class="ghost-btn" type="button" data-level-save-all>保存全部并同步全站</button>' +
          '<button class="ghost-btn" type="button" data-level-add>新增下一级</button>' +
          '<button class="ghost-btn" type="button" data-level-delete="' + esc(level.id) + '">删除</button>' +
        "</div>" +
      "</form>"
    );
  }

  function pageHtml() {
    if (state.loading) return '<div class="content-loading">正在读取陪玩等级...</div>';
    var level = selected();
    return (
      '<div class="content-admin-head"><div><h3>陪玩等级管理</h3><p>全站陪玩大厅、详情页、排行榜、客服推卡与后台列表统一读取这里的等级配置。</p></div>' +
        '<div class="content-version-meta"><span>' + esc(state.levels.length) + " 个等级</span><span>" + esc(state.message || state.error || "修改后立即预览，保存后全站同步") + "</span></div></div>" +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;align-items:start">' +
        '<section class="panel" style="margin:0"><h2>等级列表</h2><div data-level-list style="display:grid;gap:8px">' + listHtml() + "</div>" +
          '<p class="muted" style="margin:10px 0 0;font-size:12px">拖动左侧手柄可调整排序。</p></section>' +
        '<section class="panel" style="margin:0"><h2>等级设置</h2>' + editorHtml(level) + "</section>" +
        '<section class="panel" style="margin:0"><h2>实时预览</h2><div data-level-preview>' + previewHtml(level) + "</div></section>" +
      "</div>"
    );
  }

  function render() {
    var el = target();
    if (!el) return;
    el.innerHTML = pageHtml();
    if (window.MCJAdminForms && window.MCJAdminForms.enhance) window.MCJAdminForms.enhance(el);
    bind();
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
    var preview = target() && target().querySelector("[data-level-preview]");
    if (preview) preview.innerHTML = previewHtml(next);
    var list = target() && target().querySelector("[data-level-list]");
    if (list) list.innerHTML = listHtml();
  }

  function apiGet() {
    if (Auth && Auth.get) return Auth.get("/api/admin/companion-levels");
    return fetch("/api/admin/companion-levels", { headers: { Accept: "application/json", "x-mcj-admin-role": "admin" } }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "读取失败");
        return body;
      });
    });
  }

  function apiPost(body) {
    if (Auth && Auth.post) return Auth.post("/api/admin/companion-levels", body);
    return fetch("/api/admin/companion-levels", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mcj-admin-role": "admin" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.message || "保存失败");
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
        state.message = "已加载后台等级配置";
        render();
      })
      .catch(function (err) {
        applyLocal(Levels && Levels.read ? Levels.read() : []);
        state.loading = false;
        state.error = err.message || "读取失败，已使用本地默认等级";
        render();
      });
  }

  function saveAll(message) {
    state.saving = true;
    state.message = "保存中…";
    render();
    return apiPost({ action: "save_all", levels: state.levels })
      .then(function (result) {
        applyLocal(result.levels || state.levels);
        state.saving = false;
        state.message = message || result.message || "已保存并同步";
        state.error = "";
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

  function bind() {
    var el = target();
    if (!el || el.dataset.levelBound === "1") return;
    el.dataset.levelBound = "1";

    el.addEventListener("click", function (e) {
      var select = e.target.closest("[data-level-select]");
      if (select) {
        state.selectedId = select.getAttribute("data-level-select");
        render();
        return;
      }
      if (e.target.closest("[data-level-add]")) {
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
        state.selectedId = next.id;
        render();
        return;
      }
      var del = e.target.closest("[data-level-delete]");
      if (del) {
        var id = del.getAttribute("data-level-delete");
        if (!confirm("确认删除该等级？已绑定陪玩需先迁移等级。")) return;
        state.levels = state.levels.filter(function (item) { return String(item.id) !== String(id); });
        state.selectedId = state.levels[0] ? state.levels[0].id : "";
        saveAll("已删除并同步");
        return;
      }
      if (e.target.closest("[data-level-save-all]")) {
        var form = el.querySelector("[data-level-editor]");
        if (form) patchSelectedFromForm(form);
        state.levels = state.levels.map(function (item, index) {
          item.sort = index + 1;
          return item;
        });
        saveAll("已保存全部等级，全站同步");
      }
    });

    el.addEventListener("input", function (e) {
      var form = e.target.closest("[data-level-editor]");
      if (!form) return;
      patchSelectedFromForm(form);
    });
    el.addEventListener("change", function (e) {
      var form = e.target.closest("[data-level-editor]");
      if (!form) return;
      patchSelectedFromForm(form);
    });

    el.addEventListener("submit", function (e) {
      var form = e.target.closest("[data-level-editor]");
      if (!form) return;
      e.preventDefault();
      patchSelectedFromForm(form);
      saveAll("当前等级已保存，全站同步");
    });

    el.addEventListener("dragstart", function (e) {
      var btn = e.target.closest("[data-level-drag]");
      if (!btn) return;
      state.dragId = btn.getAttribute("data-level-drag");
      e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragover", function (e) {
      if (!e.target.closest("[data-level-drag]")) return;
      e.preventDefault();
    });
    el.addEventListener("drop", function (e) {
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
      render();
    });
  }

  function boot() {
    if (!target()) return;
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJAdminCompanionLevels = { reload: load, render: render };
})();
