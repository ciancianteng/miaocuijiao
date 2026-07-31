(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "rechargeCampaignMount";
  var state = { loading: true, error: "", campaigns: [], editing: null, formOpen: false, message: "" };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function role() {
    try {
      var u = JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}");
      return u.adminRole || u.role || "admin";
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
      box.innerHTML = '<div class="admin-sync-note">正在读取充值活动...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML = '<div class="admin-sync-note error">' + esc(state.error) + ' <button class="mini-btn" type="button" data-rc-reload>重试</button></div>';
      return;
    }
    var rows = (state.campaigns || [])
      .map(function (c) {
        return (
          "<tr><td>" +
          esc(c.name) +
          "</td><td>RM" +
          esc(c.payAmountRm) +
          "</td><td>" +
          esc(c.baseCatFood) +
          "</td><td>" +
          esc(c.bonusCatFood) +
          "</td><td><strong>" +
          esc(c.totalCatFood) +
          "</strong></td><td>" +
          (c.enabled ? "启用" : "停用") +
          '</td><td><button class="mini-btn" type="button" data-rc-edit="' +
          esc(c.id) +
          '">编辑</button> <button class="mini-btn" type="button" data-rc-disable="' +
          esc(c.id) +
          '">停用</button></td></tr>'
        );
      })
      .join("");
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>充值活动档位</h3><p>创建实付金额、基础猫粮与赠送猫粮。到账由支付回调写入钱包流水。</p></div><button class="mini-btn primary-lite" type="button" data-rc-new>新建档位</button></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      (state.formOpen ? formHtml() : "") +
      '<div class="table-wrap"><table><thead><tr><th>活动名称</th><th>实付 RM</th><th>基础猫粮</th><th>赠送</th><th>总到账</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7">暂无活动，请先创建。</td></tr>') +
      "</tbody></table></div>";
  }
  function formHtml() {
    var c = state.editing || { name: "", payAmountRm: 300, baseCatFood: 300, bonusCatFood: 100, totalCatFood: 400, enabled: true, sortOrder: 100, description: "", perBossLimit: 0, firstRechargeOnly: false };
    return (
      '<form class="service-account-form-shell" data-rc-form style="margin:12px 0"><div class="form-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">' +
      '<label>活动名称<input name="name" required value="' +
      esc(c.name) +
      '"></label>' +
      '<label>实付金额 RM<input name="payAmountRm" type="number" min="1" step="1" required value="' +
      esc(c.payAmountRm) +
      '"></label>' +
      '<label>基础到账猫粮<input name="baseCatFood" type="number" min="0" step="1" required value="' +
      esc(c.baseCatFood) +
      '"></label>' +
      '<label>额外赠送猫粮<input name="bonusCatFood" type="number" min="0" step="1" value="' +
      esc(c.bonusCatFood) +
      '"></label>' +
      '<label>最终到账<input name="totalCatFood" type="number" min="0" step="1" value="' +
      esc(c.totalCatFood || Number(c.baseCatFood || 0) + Number(c.bonusCatFood || 0)) +
      '"></label>' +
      '<label>排序<input name="sortOrder" type="number" value="' +
      esc(c.sortOrder || 100) +
      '"></label>' +
      '<label>开始时间<input name="startsAt" type="datetime-local" value="' +
      esc((c.startsAt || "").slice(0, 16)) +
      '"></label>' +
      '<label>结束时间<input name="endsAt" type="datetime-local" value="' +
      esc((c.endsAt || "").slice(0, 16)) +
      '"></label>' +
      '<label>每人可参与次数（0=不限）<input name="perBossLimit" type="number" min="0" value="' +
      esc(c.perBossLimit || 0) +
      '"></label>' +
      '<label>只限首次充值<select name="firstRechargeOnly"><option value="false"' +
      (!c.firstRechargeOnly ? " selected" : "") +
      '>否</option><option value="true"' +
      (c.firstRechargeOnly ? " selected" : "") +
      ">是</option></select></label>" +
      '<label>启用<select name="enabled"><option value="true"' +
      (c.enabled !== false ? " selected" : "") +
      '>启用</option><option value="false"' +
      (c.enabled === false ? " selected" : "") +
      ">停用</option></select></label>" +
      '<label class="wide" style="grid-column:1/-1">活动说明<textarea name="description" rows="2">' +
      esc(c.description || "") +
      "</textarea></label>" +
      '</div><div style="display:flex;gap:8px;margin-top:10px"><button class="mini-btn primary-lite" type="submit">保存</button><button class="mini-btn" type="button" data-rc-cancel>取消</button></div></form>'
    );
  }
  function load() {
    state.loading = true;
    state.error = "";
    paint();
    api("/api/admin/recharge-campaigns")
      .then(function (res) {
        state.campaigns = res.campaigns || [];
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        paint();
      });
  }
  function collect(form) {
    var fd = new FormData(form);
    var base = Number(fd.get("baseCatFood") || 0);
    var bonus = Number(fd.get("bonusCatFood") || 0);
    var total = Number(fd.get("totalCatFood") || 0) || base + bonus;
    return {
      id: state.editing && state.editing.id,
      name: String(fd.get("name") || "").trim(),
      payAmountRm: Number(fd.get("payAmountRm") || 0),
      baseCatFood: base,
      bonusCatFood: bonus,
      totalCatFood: total,
      startsAt: fd.get("startsAt") ? new Date(fd.get("startsAt")).toISOString() : null,
      endsAt: fd.get("endsAt") ? new Date(fd.get("endsAt")).toISOString() : null,
      perBossLimit: Number(fd.get("perBossLimit") || 0),
      firstRechargeOnly: fd.get("firstRechargeOnly") === "true",
      enabled: fd.get("enabled") !== "false",
      sortOrder: Number(fd.get("sortOrder") || 100),
      description: String(fd.get("description") || "").trim(),
    };
  }
  document.addEventListener("click", function (e) {
    if (!target() || !target().contains(e.target) && !e.target.closest("[data-rc-reload]")) return;
    if (e.target.closest("[data-rc-reload]")) {
      load();
      return;
    }
    if (e.target.closest("[data-rc-new]")) {
      state.editing = null;
      state.formOpen = true;
      paint();
      return;
    }
    if (e.target.closest("[data-rc-cancel]")) {
      state.formOpen = false;
      state.editing = null;
      paint();
      return;
    }
    var edit = e.target.closest("[data-rc-edit]");
    if (edit) {
      state.editing = (state.campaigns || []).find(function (c) {
        return c.id === edit.dataset.rcEdit;
      });
      state.formOpen = true;
      paint();
      return;
    }
    var dis = e.target.closest("[data-rc-disable]");
    if (dis && confirm("确认停用该充值活动？")) {
      api("/api/admin/recharge-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: dis.dataset.rcDisable }),
      })
        .then(function (res) {
          state.message = res.message || "已停用";
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
    }
  });
  document.addEventListener("submit", function (e) {
    var form = e.target.closest("[data-rc-form]");
    if (!form) return;
    e.preventDefault();
    var payload = collect(form);
    payload.totalCatFood = Number(payload.baseCatFood || 0) + Number(payload.bonusCatFood || 0);
    api("/api/admin/recharge-campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        state.message = res.message || "已保存";
        state.formOpen = false;
        state.editing = null;
        load();
      })
      .catch(function (err) {
        alert(err.message);
      });
  });
  document.addEventListener("input", function (e) {
    var form = e.target.closest("[data-rc-form]");
    if (!form) return;
    if (e.target.name === "baseCatFood" || e.target.name === "bonusCatFood") {
      var base = Number(form.elements.baseCatFood.value || 0);
      var bonus = Number(form.elements.bonusCatFood.value || 0);
      if (form.elements.totalCatFood) form.elements.totalCatFood.value = String(base + bonus);
    }
  });
  document.addEventListener("DOMContentLoaded", load);
  window.MCJAdminRechargeCampaignsReload = load;
})();
