(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "giftManagement";
  var RARITY_OPTS = [
    { id: "common", label: "普通" },
    { id: "rare", label: "稀有" },
    { id: "epic", label: "史诗" },
    { id: "legendary", label: "传说" },
  ];
  var EFFECT_OPTS = [
    { id: "none", label: "无动效" },
    { id: "float", label: "飘浮" },
    { id: "burst", label: "爆发" },
    { id: "rain", label: "礼物雨" },
  ];
  var state = {
    loading: true,
    gifts: [],
    error: "",
    message: "",
    formOpen: false,
    editing: null,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function role() {
    try {
      return JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}").adminRole || "admin";
    } catch (e) {
      return "admin";
    }
  }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Accept: "application/json", "x-mcj-admin-role": role() }, opts.headers || {});
    return (Auth && Auth.fetch ? Auth.fetch(path, opts) : fetch(path, opts)).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "请求失败");
        return body;
      });
    });
  }
  function target() {
    return document.getElementById(TARGET);
  }
  function rarityLabel(id) {
    var hit = RARITY_OPTS.find(function (x) {
      return x.id === id;
    });
    return hit ? hit.label : id || "普通";
  }
  function effectLabel(id) {
    var hit = EFFECT_OPTS.find(function (x) {
      return x.id === id;
    });
    return hit ? hit.label : id || "飘浮";
  }
  function formTitle() {
    return state.editing && state.editing.id ? "编辑礼物" : "新增礼物";
  }
  function formHtml() {
    var g = state.editing || {};
    return (
      '<form class="admin-inline-form" data-gift-form>' +
      '<label><span>礼物名称</span><input name="name" required maxlength="40" value="' +
      esc(g.name || "") +
      '" placeholder="例如：小鱼干"></label>' +
      '<label><span>图标 URL / Emoji</span><input name="iconUrl" value="' +
      esc(g.iconUrl || "") +
      '" placeholder="https://… 或 🎁"></label>' +
      '<label><span>猫粮价值</span><input name="catFoodPrice" type="number" min="1" step="1" required value="' +
      esc(g.catFoodPrice != null ? g.catFoodPrice : 10) +
      '"></label>' +
      '<label><span>稀有度</span><select name="rarity">' +
      RARITY_OPTS.map(function (o) {
        return (
          '<option value="' +
          o.id +
          '"' +
          ((g.rarity || "common") === o.id ? " selected" : "") +
          ">" +
          esc(o.label) +
          "</option>"
        );
      }).join("") +
      "</select></label>" +
      '<label><span>动效类型</span><select name="effectType">' +
      EFFECT_OPTS.map(function (o) {
        var cur = g.effectType || "float";
        return (
          '<option value="' +
          o.id +
          '"' +
          (cur === o.id ? " selected" : "") +
          ">" +
          esc(o.label) +
          "</option>"
        );
      }).join("") +
      "</select></label>" +
      '<label><span>排序</span><input name="sortOrder" type="number" value="' +
      esc(g.sortOrder != null ? g.sortOrder : 100) +
      '"></label>' +
      '<label class="checkbox"><input name="enabled" type="checkbox"' +
      (g.enabled === false ? "" : " checked") +
      "> 启用</label>" +
      '<label class="checkbox"><input name="featured" type="checkbox"' +
      (g.featured ? " checked" : "") +
      "> 推荐</label>" +
      '<div class="form-actions"><button class="mini-btn primary-lite" type="submit">保存</button> ' +
      '<button class="mini-btn" type="button" data-gift-cancel>取消</button></div></form>'
    );
  }
  function openForm(seed) {
    state.editing = seed || {};
    state.formOpen = true;
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({
        title: formTitle(),
        html: formHtml(),
        onClose: function () {
          state.formOpen = false;
          state.editing = null;
        },
      });
      return;
    }
    paint();
  }
  function closeForm() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
    }
    state.formOpen = false;
    state.editing = null;
    paint();
  }
  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取礼物...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="admin-sync-note">' +
        esc(state.error) +
        ' <button class="mini-btn" data-gift-reload>重试</button></div>';
      return;
    }
    var rows = (state.gifts || [])
      .map(function (g) {
        var icon = g.iconUrl
          ? /^https?:\/\//i.test(g.iconUrl)
            ? '<img src="' + esc(g.iconUrl) + '" alt="" style="width:28px;height:28px;object-fit:contain;border-radius:6px">'
            : '<span style="font-size:22px">' + esc(g.iconUrl) + "</span>"
          : "🎁";
        return (
          "<tr><td>" +
          icon +
          "</td><td>" +
          esc(g.name) +
          "</td><td>" +
          esc(g.catFoodPrice) +
          "</td><td>" +
          esc(rarityLabel(g.rarity)) +
          "</td><td>" +
          esc(effectLabel(g.effectType || g.animationLevel)) +
          "</td><td>" +
          (g.enabled ? "启用" : "停用") +
          "</td><td>" +
          esc(g.sortOrder) +
          "</td><td>" +
          '<button class="mini-btn" type="button" data-gift-edit=\'' +
          esc(JSON.stringify(g)) +
          "'>编辑</button> " +
          '<button class="mini-btn" type="button" data-gift-del="' +
          esc(g.id) +
          '">下架</button></td></tr>'
        );
      })
      .join("");
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>礼物管理</h3><p>后台配置礼物商城（名称 / 图标 / 猫粮价值 / 稀有度 / 动效 / 启停）。勿在前端硬编码礼物。</p></div>' +
      '<button class="mini-btn primary-lite" type="button" data-gift-new>新增礼物</button> <button class="mini-btn" type="button" data-gift-reload>刷新</button></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      (!window.MCJAdminOverlay && state.formOpen ? '<div class="admin-inline-panel">' + formHtml() + "</div>" : "") +
      '<div class="table-wrap"><table><thead><tr><th>图标</th><th>名称</th><th>猫粮</th><th>稀有度</th><th>动效</th><th>状态</th><th>排序</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8">暂无礼物</td></tr>') +
      "</tbody></table></div>" +
      '<div style="margin-top:12px"><button class="mini-btn" type="button" data-gift-commission>设置默认礼物抽成 %</button></div>';
  }
  function load() {
    state.loading = true;
    paint();
    api("/api/admin/gifts")
      .then(function (res) {
        state.gifts = res.gifts || [];
        state.loading = false;
        state.error = "";
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message;
        paint();
      });
  }
  function submitForm(form) {
    var fd = new FormData(form);
    var payload = {
      action: "save",
      id: (state.editing && state.editing.id) || "",
      name: String(fd.get("name") || "").trim(),
      iconUrl: String(fd.get("iconUrl") || "").trim(),
      catFoodPrice: fd.get("catFoodPrice"),
      rarity: fd.get("rarity") || "common",
      effectType: fd.get("effectType") || "float",
      sortOrder: fd.get("sortOrder") || 100,
      enabled: !!form.querySelector('[name="enabled"]').checked,
      featured: !!form.querySelector('[name="featured"]').checked,
    };
    if (!payload.name) {
      alert("礼物名称不能为空");
      return;
    }
    api("/api/admin/gifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        state.message = res.message || "礼物已保存";
        closeForm();
        load();
      })
      .catch(function (err) {
        alert(err.message || "保存失败");
      });
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-gift-cancel]")) {
      e.preventDefault();
      closeForm();
      return;
    }
    if (!target() || !target().contains(e.target)) return;
    if (e.target.closest("[data-gift-reload]")) return load();
    if (e.target.closest("[data-gift-new]")) return openForm({});
    var edit = e.target.closest("[data-gift-edit]");
    if (edit) {
      try {
        openForm(JSON.parse(edit.getAttribute("data-gift-edit")));
      } catch (err) {
        alert("解析失败");
      }
      return;
    }
    var del = e.target.closest("[data-gift-del]");
    if (del && confirm("确认下架该礼物？")) {
      api("/api/admin/gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "soft_delete", id: del.dataset.giftDel }),
      })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    if (e.target.closest("[data-gift-commission]")) {
      var rate = prompt("默认礼物抽成 %", "20");
      if (rate == null) return;
      api("/api/admin/gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_commission", commissionRate: rate }),
      })
        .then(function (res) {
          alert(res.message || "已保存");
        })
        .catch(function (err) {
          alert(err.message);
        });
    }
  });
  document.addEventListener("submit", function (e) {
    var form = e.target.closest("[data-gift-form]");
    if (!form) return;
    e.preventDefault();
    submitForm(form);
  });
  document.addEventListener("DOMContentLoaded", function () {
    if (target()) load();
  });
})();
