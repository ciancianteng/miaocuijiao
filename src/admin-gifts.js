(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "giftManagement";
  var state = { loading: true, gifts: [], error: "", message: "" };

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
  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取礼物...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML = '<div class="admin-sync-note">' + esc(state.error) + ' <button class="mini-btn" data-gift-reload>重试</button></div>';
      return;
    }
    var rows = (state.gifts || [])
      .map(function (g) {
        return (
          "<tr><td>" +
          esc(g.name) +
          "</td><td>" +
          esc(g.catFoodPrice) +
          "</td><td>" +
          (g.enabled ? "启用" : "停用") +
          "</td><td>" +
          (g.featured ? "是" : "否") +
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
      '<div class="admin-section-head compact"><div><h3>礼物管理</h3><p>配置老板端礼物商城。修改后全站同步。抽成变更不影响历史流水。</p></div>' +
      '<button class="mini-btn primary-lite" type="button" data-gift-new>新增礼物</button> <button class="mini-btn" type="button" data-gift-reload>刷新</button></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="table-wrap"><table><thead><tr><th>名称</th><th>猫粮价格</th><th>状态</th><th>推荐</th><th>排序</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">暂无礼物</td></tr>') +
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
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message;
        paint();
      });
  }
  function saveGift(seed) {
    seed = seed || {};
    var isCreate = !seed.id;
    var nameRaw = prompt("礼物名称", seed.name || "");
    if (nameRaw == null) return; // user cancelled
    var name = String(nameRaw).trim();
    if (!name) {
      alert("礼物名称不能为空");
      return;
    }
    var dup = (state.gifts || []).some(function (g) {
      if (!g || (seed.id && String(g.id) === String(seed.id))) return false;
      return String(g.name || "").trim().toLowerCase() === name.toLowerCase();
    });
    if (dup) {
      alert("礼物名称已存在，请换一个名称");
      return;
    }
    var price = prompt("猫粮价格", seed.catFoodPrice != null ? String(seed.catFoodPrice) : "10");
    if (price == null) return;
    var sort = prompt("排序", seed.sortOrder != null ? String(seed.sortOrder) : "100");
    if (sort == null) return;
    // Create defaults: 推荐关闭、状态启用. Edit keeps existing confirm prompts (UI unchanged).
    var featured = isCreate ? false : confirm("是否推荐？");
    var enabled = isCreate ? true : confirm("是否启用？");
    api("/api/admin/gifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        id: seed.id || "",
        name: name,
        catFoodPrice: price,
        sortOrder: sort,
        featured: featured,
        enabled: enabled,
        iconUrl: seed.iconUrl || "",
      }),
    })
      .then(function (res) {
        state.message = res.message || (isCreate ? "礼物已新增（状态：启用，推荐：否）" : "礼物已保存");
        load();
      })
      .catch(function (err) {
        alert(err.message || "保存失败");
      });
  }
  document.addEventListener("click", function (e) {
    if (!target() || !target().contains(e.target)) return;
    if (e.target.closest("[data-gift-reload]")) return load();
    if (e.target.closest("[data-gift-new]")) return saveGift({});
    var edit = e.target.closest("[data-gift-edit]");
    if (edit) {
      try {
        saveGift(JSON.parse(edit.getAttribute("data-gift-edit")));
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
  document.addEventListener("DOMContentLoaded", function () {
    if (target()) load();
  });
})();
