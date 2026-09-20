(function () {
  "use strict";

  var Auth = window.MCJAdminAuthFetch;
  var TARGET_ID = "companionCertTagManagement";
  var state = {
    loading: true,
    saving: false,
    error: "",
    message: "",
    tags: [],
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

  function apiGet() {
    if (Auth && Auth.get) return Auth.get("/api/admin/companion-cert-tags");
    return fetch("/api/admin/companion-cert-tags", {
      headers: { Accept: "application/json", "x-mcj-admin-role": "admin" },
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "读取失败");
        return body;
      });
    });
  }

  function apiPost(body) {
    if (Auth && Auth.post) return Auth.post("/api/admin/companion-cert-tags", body);
    return fetch("/api/admin/companion-cert-tags", {
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

  function blank() {
    return {
      id: "",
      name: "",
      icon: "🏅",
      color: "#f5c542",
      sort: (state.tags.length + 1) * 10,
      enabled: true,
    };
  }

  function badgePreviewHtml(row) {
    row = row || blank();
    var color = row.color || "#f5c542";
    return (
      '<span class="mcj-cert-badge" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid ' +
      esc(color) +
      ";color:" +
      esc(color) +
      ";background:color-mix(in srgb, " +
      esc(color) +
      ' 16%, transparent);font-size:12px;font-weight:700">' +
      '<span aria-hidden="true">' +
      esc(row.icon || "🏅") +
      "</span>" +
      esc(row.name || "徽章名称") +
      "</span>"
    );
  }

  function formHtml(row) {
    row = row || blank();
    return (
      '<form class="admin-self-form" data-cert-tag-form>' +
      '<input type="hidden" name="id" value="' +
      esc(row.id || "") +
      '">' +
      '<p class="admin-sync-note" style="margin:0 0 12px">自定义前台卡片认证徽章：名称、图标、颜色、启用状态。保存后可在陪玩详情勾选分配。</p>' +
      '<div class="form-grid">' +
      '<label><span>徽章名称</span><input name="name" required value="' +
      esc(row.name || "") +
      '" placeholder="官方推荐 / 金牌陪玩 / 实力认证" data-cert-live="name"></label>' +
      '<label><span>徽章图标</span><input name="icon" value="' +
      esc(row.icon || "🏅") +
      '" placeholder="🏅" data-cert-live="icon"></label>' +
      '<label><span>徽章颜色</span><input name="color" type="color" value="' +
      esc(row.color || "#f5c542") +
      '" data-cert-live="color"></label>' +
      '<label><span>排序</span><input name="sort" type="number" value="' +
      esc(row.sort || 100) +
      '"></label>' +
      '<label><span>前台展示</span><select name="enabled"><option value="true"' +
      (row.enabled !== false ? " selected" : "") +
      ">启用显示</option><option value=\"false\"" +
      (row.enabled === false ? " selected" : "") +
      ">停用（前台不展示）</option></select></label>" +
      '<label class="wide"><span>前台预览</span><div data-cert-preview style="padding:10px 0">' +
      badgePreviewHtml(row) +
      "</div></label>" +
      "</div>" +
      '<div class="row" style="margin-top:12px;gap:10px">' +
      '<button class="primary-btn" type="submit">' +
      (row.id ? "保存徽章" : "创建徽章") +
      "</button>" +
      '<button class="ghost-btn" type="button" data-cert-tag-cancel>取消</button>' +
      "</div></form>"
    );
  }

  function rowsHtml() {
    if (!state.tags.length) {
      return '<tr><td colspan="7"><div class="empty">暂无认证徽章。点击「新增认证徽章」创建名称 / 颜色 / 图标，并启用后即可分配到陪玩卡片。</div></td></tr>';
    }
    return state.tags
      .map(function (tag) {
        return (
          "<tr>" +
          "<td>" +
          badgePreviewHtml(tag) +
          "</td>" +
          "<td>" +
          esc(tag.icon || "-") +
          "</td>" +
          '<td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:' +
          esc(tag.color || "#ccc") +
          ';vertical-align:middle"></span> ' +
          esc(tag.color || "-") +
          "</td>" +
          "<td>" +
          esc(tag.sort) +
          "</td>" +
          '<td><span class="status ' +
          (tag.enabled !== false ? "ok" : "wait") +
          '">' +
          (tag.enabled !== false ? "启用显示" : "已停用") +
          "</span></td>" +
          '<td><div class="row"><button class="mini-btn" type="button" data-cert-tag-edit="' +
          esc(tag.id) +
          '">编辑</button>' +
          '<button class="mini-btn" type="button" data-cert-tag-toggle="' +
          esc(tag.id) +
          '" data-enabled="' +
          (tag.enabled !== false ? "false" : "true") +
          '">' +
          (tag.enabled !== false ? "停用" : "启用") +
          "</button>" +
          '<button class="mini-btn" type="button" data-cert-tag-delete="' +
          esc(tag.id) +
          '">删除</button></div></td>' +
          "</tr>"
        );
      })
      .join("");
  }

  function pageHtml() {
    if (state.loading) return '<div class="content-loading">正在读取认证徽章...</div>';
    return (
      '<div class="content-admin-head"><div><h3>认证徽章管理（前台卡片）</h3><p>自定义创建 / 编辑徽章名称、颜色、图标，并控制是否在陪玩大厅与详情卡片展示。风格标签请到「陪玩标签」；分配到具体陪玩请在陪玩详情勾选。</p></div>' +
      '<button class="primary-btn" type="button" data-cert-tag-add>新增认证徽章</button></div>' +
      (state.error ? '<div class="admin-sync-note" style="color:#c00">' + esc(state.error) + "</div>" : "") +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      (state.formOpen && state.editing && !(window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen())
        ? '<div class="panel" style="margin:12px 0">' + formHtml(state.editing) + "</div>"
        : "") +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>前台预览</th><th>图标</th><th>颜色</th><th>排序</th><th>展示</th><th>操作</th></tr></thead><tbody>' +
      rowsHtml() +
      "</tbody></table></div>"
    );
  }

  function render() {
    var el = target();
    if (!el) return;
    el.innerHTML = pageHtml();
    if (state.formOpen && state.editing && window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({
        title: state.editing.id ? "编辑认证徽章" : "新增认证徽章",
        html: formHtml(state.editing),
        onClose: function () {
          state.formOpen = false;
          state.editing = null;
        },
      });
    }
  }

  function load() {
    state.loading = true;
    state.error = "";
    render();
    apiGet()
      .then(function (body) {
        state.tags = body.items || body.tags || [];
        state.loading = false;
        render();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        render();
      });
  }

  function syncLivePreview(root) {
    if (!root) return;
    var preview = root.querySelector("[data-cert-preview]");
    if (!preview) return;
    var nameEl = root.querySelector('[name="name"]');
    var iconEl = root.querySelector('[name="icon"]');
    var colorEl = root.querySelector('[name="color"]');
    preview.innerHTML = badgePreviewHtml({
      name: nameEl ? nameEl.value : "",
      icon: iconEl ? iconEl.value : "🏅",
      color: colorEl ? colorEl.value : "#f5c542",
    });
  }

  document.addEventListener("input", function (e) {
    if (!e.target || !e.target.getAttribute || !e.target.getAttribute("data-cert-live")) return;
    var form = e.target.closest("[data-cert-tag-form]");
    if (form) syncLivePreview(form);
  });
  document.addEventListener("change", function (e) {
    if (!e.target || !e.target.getAttribute || !e.target.getAttribute("data-cert-live")) return;
    var form = e.target.closest("[data-cert-tag-form]");
    if (form) syncLivePreview(form);
  });

  document.addEventListener("click", function (e) {
    var add = e.target.closest("[data-cert-tag-add]");
    if (add) {
      state.editing = blank();
      state.formOpen = true;
      render();
      return;
    }
    var edit = e.target.closest("[data-cert-tag-edit]");
    if (edit) {
      var id = edit.getAttribute("data-cert-tag-edit");
      state.editing =
        state.tags.find(function (t) {
          return String(t.id) === String(id);
        }) || blank();
      state.formOpen = true;
      render();
      return;
    }
    var cancel = e.target.closest("[data-cert-tag-cancel]");
    if (cancel) {
      state.formOpen = false;
      state.editing = null;
      if (window.MCJAdminOverlay && window.MCJAdminOverlay.close) window.MCJAdminOverlay.close();
      render();
      return;
    }
    var toggle = e.target.closest("[data-cert-tag-toggle]");
    if (toggle) {
      var tid = toggle.getAttribute("data-cert-tag-toggle");
      var en = toggle.getAttribute("data-enabled") === "true";
      apiPost({ action: en ? "enable" : "disable", id: tid })
        .then(function (body) {
          state.tags = body.items || state.tags;
          state.message = body.message || "已更新展示状态";
          render();
        })
        .catch(function (err) {
          alert(err.message || "操作失败");
        });
      return;
    }
    var del = e.target.closest("[data-cert-tag-delete]");
    if (del) {
      if (!confirm("确认删除该认证徽章？已分配的陪玩将失去此徽章。")) return;
      apiPost({ action: "delete", id: del.getAttribute("data-cert-tag-delete") })
        .then(function (body) {
          state.tags = body.items || [];
          state.message = body.message || "已删除";
          render();
        })
        .catch(function (err) {
          alert(err.message || "删除失败");
        });
    }
  });

  document.addEventListener("submit", function (e) {
    var form = e.target.closest("[data-cert-tag-form]");
    if (!form) return;
    e.preventDefault();
    var fd = new FormData(form);
    var draft = {
      id: String(fd.get("id") || "").trim(),
      name: String(fd.get("name") || "").trim(),
      icon: String(fd.get("icon") || "🏅").trim(),
      color: String(fd.get("color") || "#f5c542").trim(),
      sort: Number(fd.get("sort") || 100),
      enabled: String(fd.get("enabled")) !== "false",
    };
    if (!draft.name) {
      alert("请填写徽章名称");
      return;
    }
    state.saving = true;
    apiPost({ action: "save", tag: draft })
      .then(function (body) {
        state.tags = body.items || state.tags;
        state.message = body.message || (draft.id ? "徽章已保存" : "徽章已创建");
        state.formOpen = false;
        state.editing = null;
        state.saving = false;
        if (window.MCJAdminOverlay && window.MCJAdminOverlay.close) window.MCJAdminOverlay.close();
        render();
      })
      .catch(function (err) {
        state.saving = false;
        alert(err.message || "保存失败");
      });
  });

  document.addEventListener("mcj:admin-section", function (e) {
    var section = e && e.detail && e.detail.section;
    if (section === "companion-cert-tags") load();
  });

  function boot() {
    if (!target()) return;
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJAdminCompanionCertTags = { reload: load, render: render };
})();
