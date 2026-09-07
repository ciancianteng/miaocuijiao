(function () {
  "use strict";

  var Auth = window.MCJAdminAuthFetch;
  var TARGET_ID = "companionTagManagement";
  var CATEGORIES = ["风格", "服务", "性格", "时段", "其它"];
  var state = {
    loading: true,
    saving: false,
    error: "",
    message: "",
    tags: [],
    editing: null,
    formOpen: false,
    tableReady: true,
    source: "",
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
    if (Auth && Auth.get) return Auth.get("/api/admin/companion-tags");
    return fetch("/api/admin/companion-tags", {
      headers: { Accept: "application/json", "x-mcj-admin-role": "admin" },
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "读取失败");
        return body;
      });
    });
  }

  function apiPost(body) {
    if (Auth && Auth.post) return Auth.post("/api/admin/companion-tags", body);
    return fetch("/api/admin/companion-tags", {
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

  function categoryOptions(selected) {
    var current = String(selected || "风格").trim() || "风格";
    var list = CATEGORIES.slice();
    if (list.indexOf(current) < 0) list.push(current);
    return list
      .map(function (name) {
        return (
          '<option value="' +
          esc(name) +
          '"' +
          (name === current ? " selected" : "") +
          ">" +
          esc(name) +
          "</option>"
        );
      })
      .join("");
  }

  function blank() {
    return {
      id: "",
      name: "",
      group: "风格",
      selfSelectable: true,
      requiresAudit: false,
      showInHall: true,
      supportsFilter: true,
      sort: (state.tags.length + 1) * 10,
      enabled: true,
    };
  }

  function tagFormTitle() {
    return state.editing && state.editing.id ? "编辑标签" : "新增标签";
  }

  function openFormOverlay() {
    if (!state.formOpen || !state.editing) return false;
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({
        title: tagFormTitle(),
        html: formHtml(state.editing),
        onClose: function () {
          state.formOpen = false;
          state.editing = null;
        },
      });
      return true;
    }
    return false;
  }

  function closeFormOverlay() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
      return;
    }
    state.formOpen = false;
    state.editing = null;
    render();
  }

  function formHtml(row) {
    row = row || blank();
    return (
      '<form class="admin-self-form" data-tag-form>' +
        '<input type="hidden" name="id" value="' +
        esc(row.id || "") +
        '">' +
        '<div class="form-grid">' +
          '<label><span>标签名称</span><input name="name" required maxlength="40" value="' +
          esc(row.name || "") +
          '" placeholder="例如：随和、技术流、话多"></label>' +
          '<label><span>分类</span><select name="group">' +
          categoryOptions(row.group) +
          "</select></label>" +
          '<label><span>排序</span><input name="sort" type="number" min="0" step="1" value="' +
          esc(row.sort != null ? row.sort : 100) +
          '"></label>' +
          '<label><span>陪玩可选</span><select name="selfSelectable" data-admin-control="switch"><option value="true"' +
          (row.selfSelectable !== false ? " selected" : "") +
          '>开启</option><option value="false"' +
          (row.selfSelectable === false ? " selected" : "") +
          ">关闭</option></select></label>" +
          '<label><span>公开展示</span><select name="showInHall" data-admin-control="switch"><option value="true"' +
          (row.showInHall !== false ? " selected" : "") +
          '>开启</option><option value="false"' +
          (row.showInHall === false ? " selected" : "") +
          ">关闭</option></select></label>" +
          '<label><span>状态</span><select name="enabled" data-admin-control="switch"><option value="true"' +
          (row.enabled !== false ? " selected" : "") +
          '>启用</option><option value="false"' +
          (row.enabled === false ? " selected" : "") +
          ">停用</option></select></label>" +
          '<input type="hidden" name="requiresAudit" value="' +
          (row.requiresAudit ? "true" : "false") +
          '">' +
          '<input type="hidden" name="supportsFilter" value="' +
          (row.supportsFilter === false ? "false" : "true") +
          '">' +
        "</div>" +
        '<div class="row" style="margin-top:12px;gap:10px">' +
          '<button class="primary-btn" type="submit"' +
          (state.tableReady ? "" : " disabled") +
          ">保存标签</button>" +
          '<button class="ghost-btn" type="button" data-tag-cancel>取消</button>' +
        "</div>" +
      "</form>"
    );
  }

  function rowsHtml() {
    if (!state.tags.length) {
      return (
        '<tr><td colspan="7"><div class="empty">' +
        (state.tableReady
          ? "暂无标签。点击「新增标签」开始配置。"
          : "标签数据表尚未就绪，请联系运维完成内部迁移后再管理。") +
        "</div></td></tr>"
      );
    }
    return state.tags
      .map(function (tag) {
        return (
          "<tr>" +
          "<td><strong>" +
          esc(tag.name) +
          "</strong></td>" +
          "<td>" +
          esc(tag.group || "-") +
          "</td>" +
          "<td>" +
          (tag.selfSelectable !== false ? "开启" : "关闭") +
          "</td>" +
          "<td>" +
          (tag.showInHall !== false ? "开启" : "关闭") +
          "</td>" +
          "<td>" +
          esc(tag.sort) +
          "</td>" +
          '<td><span class="status ' +
          (tag.enabled !== false ? "ok" : "wait") +
          '">' +
          (tag.enabled !== false ? "启用" : "停用") +
          "</span></td>" +
          '<td><div class="row"><button class="mini-btn" type="button" data-tag-edit="' +
          esc(tag.id) +
          '">编辑</button>' +
          '<button class="mini-btn" type="button" data-tag-toggle="' +
          esc(tag.id) +
          '" data-enabled="' +
          (tag.enabled !== false ? "false" : "true") +
          '">' +
          (tag.enabled !== false ? "停用" : "启用") +
          "</button>" +
          '<button class="mini-btn" type="button" data-tag-delete="' +
          esc(tag.id) +
          '" data-tag-name="' +
          esc(tag.name) +
          '">删除</button></div></td>' +
          "</tr>"
        );
      })
      .join("");
  }

  function statusNoteHtml() {
    if (state.tableReady) return "";
    return (
      '<div class="panel" style="margin:0 0 14px;padding:14px 16px;border:1px solid rgba(251,191,36,.35);background:rgba(251,191,36,.08)">' +
      '<h4 style="margin:0 0 6px;color:#fde68a">标签表未就绪</h4>' +
      '<p class="muted" style="margin:0;font-size:12px;line-height:1.55">生产管理页不提供 SQL / 数据库密码 / PAT 操作。请由运维在内部执行 companion-tags 迁移脚本后再使用本页。</p>' +
      "</div>"
    );
  }

  function pageHtml() {
    if (state.loading) return '<div class="content-loading">正在读取陪玩标签...</div>';
    return (
      '<div class="content-admin-head"><div><h3>陪玩标签管理</h3><p>维护陪玩普通标签：新增、改名、分类、可选、公开展示与排序。声线请到「声线管理」。</p></div>' +
      '<div class="content-version-meta"><span>' +
      esc(state.tags.length) +
      " 个标签</span><span>" +
      esc(state.message || state.error || "保存后同步申请页与大厅筛选") +
      "</span></div></div>" +
      statusNoteHtml() +
      '<div class="content-admin-toolbar compact">' +
      '<button class="btn primary" type="button" data-tag-new' +
      (state.tableReady ? "" : " disabled") +
      ">新增标签</button>" +
      '<button class="btn" type="button" data-tag-reload>刷新</button></div>' +
      (!window.MCJAdminOverlay && state.formOpen ? '<div class="panel" style="margin-bottom:14px">' + formHtml(state.editing) + "</div>" : "") +
      '<div class="table-wrap"><table><thead><tr><th>标签名称</th><th>分类</th><th>陪玩可选</th><th>公开展示</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      rowsHtml() +
      "</tbody></table></div>"
    );
  }

  function render() {
    var el = target();
    if (!el) return;
    el.innerHTML = pageHtml();
    if (window.MCJAdminForms && window.MCJAdminForms.enhance) window.MCJAdminForms.enhance(el);
    bind();
  }

  function load() {
    state.loading = true;
    render();
    apiGet()
      .then(function (result) {
        state.tags = result.items || result.tags || [];
        state.tableReady = result.tableReady !== false;
        state.source = result.source || "";
        state.loading = false;
        state.message = state.tableReady
          ? "已从数据库加载标签"
          : result.message || "标签表未就绪，请联系运维";
        state.error = "";
        render();
      })
      .catch(function (err) {
        state.tags = [];
        state.loading = false;
        state.error = err.message || "读取失败";
        state.message = "";
        render();
      });
  }

  function collect(form) {
    var fd = new FormData(form);
    return {
      id: String(fd.get("id") || "").trim(),
      name: String(fd.get("name") || "").trim(),
      group: String(fd.get("group") || "风格").trim() || "风格",
      sort: Number(fd.get("sort") || 100),
      selfSelectable: String(fd.get("selfSelectable")) !== "false",
      requiresAudit: String(fd.get("requiresAudit")) === "true",
      showInHall: String(fd.get("showInHall")) !== "false",
      supportsFilter: String(fd.get("supportsFilter")) !== "false",
      enabled: String(fd.get("enabled")) !== "false",
    };
  }

  function bind() {
    var el = target();
    if (!el || el.dataset.tagBound === "1") return;
    el.dataset.tagBound = "1";

    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-tag-new]")) {
        if (!state.tableReady) {
          alert("标签表未就绪，无法新增。请联系运维完成内部迁移。");
          return;
        }
        state.editing = blank();
        state.formOpen = true;
        if (!openFormOverlay()) render();
        return;
      }
      if (e.target.closest("[data-tag-cancel]")) {
        closeFormOverlay();
        return;
      }
      if (e.target.closest("[data-tag-reload]")) {
        load();
        return;
      }
      var edit = e.target.closest("[data-tag-edit]");
      if (edit) {
        state.editing =
          state.tags.find(function (item) {
            return String(item.id) === String(edit.getAttribute("data-tag-edit"));
          }) || blank();
        state.formOpen = true;
        if (!openFormOverlay()) render();
        return;
      }
      var tog = e.target.closest("[data-tag-toggle]");
      if (tog) {
        if (!state.tableReady) {
          alert("标签表未就绪，无法修改状态。");
          return;
        }
        var enabled = tog.getAttribute("data-enabled") === "true";
        apiPost({ action: enabled ? "enable" : "disable", id: tog.getAttribute("data-tag-toggle") })
          .then(function () {
            load();
          })
          .catch(function (err) {
            alert(err.message || "操作失败");
          });
        return;
      }
      var del = e.target.closest("[data-tag-delete]");
      if (del) {
        if (!state.tableReady) {
          alert("标签表未就绪，无法删除。");
          return;
        }
        var tagName = del.getAttribute("data-tag-name") || "该标签";
        if (!confirm('确认删除标签「' + tagName + '」？删除后不可恢复。')) return;
        apiPost({ action: "delete", id: del.getAttribute("data-tag-delete") })
          .then(function () {
            load();
          })
          .catch(function (err) {
            alert(err.message || "删除失败");
          });
      }
    });

    el.addEventListener("submit", function (e) {
      var form = e.target.closest("[data-tag-form]");
      if (!form) return;
      e.preventDefault();
      if (!state.tableReady) {
        alert("标签表未就绪，无法保存。");
        return;
      }
      var payload = collect(form);
      if (!payload.name) {
        alert("请填写标签名称");
        return;
      }
      apiPost({
        action: "save",
        id: payload.id,
        payload: {
          title: payload.name,
          enabled: payload.enabled,
          sort: payload.sort,
          draft: payload,
        },
      })
        .then(function () {
          if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
            window.MCJAdminOverlay.close();
          } else {
            state.formOpen = false;
            state.editing = null;
          }
          load();
          if (window.MCJTaxonomy) {
            if (window.MCJTaxonomy.notifyChanged) window.MCJTaxonomy.notifyChanged();
            else if (window.MCJTaxonomy.reload) window.MCJTaxonomy.reload();
          }
        })
        .catch(function (err) {
          alert(err.message || "保存失败");
        });
    });
  }

  function boot() {
    if (!target()) return;
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJAdminCompanionTags = { reload: load };
})();
