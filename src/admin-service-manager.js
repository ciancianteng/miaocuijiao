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
          enabled: item.enabled !== false,
          showHome: item.showHome !== false,
          allowApply: item.allowApply !== false,
          allowOrder: item.allowOrder !== false,
          displayPositions: positionsOf(item),
          sort: Number(item.sort || item.sortOrder || 100),
        }
      : blankForm();
    state.formOpen = true;
    render();
  }

  function closeForm() {
    state.formOpen = false;
    state.editing = null;
    render();
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
    return (
      '<div class="content-editor" data-service-editor>' +
      '<form class="platform-content-form admin-service-form" data-service-form>' +
      '<div class="admin-service-grid">' +
      '<label class="admin-service-span-2"><span>服务名称</span><input name="name" required maxlength="40" placeholder="例如：LOL陪玩 / 语音陪聊 / 护航" value="' +
      esc(d.name) +
      '"></label>' +
      categoryField +
      '<label><span>新增分类（可选）</span><input name="newCategory" maxlength="20" placeholder="填写后保存时自动加入分类"></label>' +
      '<label class="admin-service-span-2"><span>默认价格</span><input name="defaultPrice" maxlength="40" placeholder="例如：RM30 / RM50 / RM30~RM50" value="' +
      esc(d.defaultPrice || "") +
      '"></label>' +
      renderIconPicker(d.icon || "🎮") +
      renderPositions(d.displayPositions || []) +
      '<div class="admin-service-switches">' +
      switchEnabled +
      switchHome +
      switchApply +
      switchOrder +
      "</div></div>" +
      '<div class="form-actions"><button class="btn primary" type="submit" ' +
      (state.saving ? "disabled" : "") +
      ">" +
      (state.saving ? "保存中…" : "保存") +
      '</button><button class="btn" type="button" data-service-cancel>取消</button></div>' +
      "</form></div>"
    );
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
      renderForm() +
      renderRows() +
      "</div>";
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
    state.saving = true;
    render();
    apiPost({ action: "save", id: payload.id, service: payload })
      .then(function (res) {
        alert(res.message || "服务已保存，全站已同步。");
        state.formOpen = false;
        state.editing = null;
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
      var form = e.target.closest("[data-service-form]");
      if (!form) return;
      e.preventDefault();
      save(form);
    });

    document.addEventListener("change", function (e) {
      var showHome = e.target.closest('[name="showHome"]');
      if (!showHome) return;
      var form = showHome.closest("[data-service-form]");
      if (!form) return;
      var homeBox = form.querySelector('input[name="displayPositions"][value="home"]');
      if (!homeBox) return;
      homeBox.checked = showHome.value !== "false";
    });

    document.addEventListener("input", function (e) {
      var input = e.target.closest("[data-service-search]");
      if (!input) return;
      var wrap = document.querySelector("[data-service-admin]");
      if (!wrap) return;
      var q = String(input.value || "")
        .trim()
        .toLowerCase();
      wrap.querySelectorAll("tbody tr").forEach(function (row) {
        row.hidden = !!(q && row.textContent.toLowerCase().indexOf(q) === -1);
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
