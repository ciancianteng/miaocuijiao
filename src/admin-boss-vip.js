/**
 * Admin · Boss VIP 等级管理（消费累计自动升级）
 * Extends existing boss_vip_* system — no second membership product.
 */
(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "bossLevelsMount";
  var state = {
    loading: true,
    busy: false,
    error: "",
    message: "",
    tablesReady: true,
    levels: [],
    form: emptyForm(),
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function emptyForm() {
    return {
      id: "",
      name: "",
      spendThreshold: "0",
      benefits: [""],
      sortOrder: "100",
      isActive: true,
    };
  }

  function benefitsToList(raw) {
    var text = String(raw == null ? "" : raw).replace(/\r\n/g, "\n").trim();
    if (!text) return [""];
    var parts = text.split(/\n+|；|;|·|\|/).map(function (s) {
      return s.trim();
    }).filter(Boolean);
    return parts.length ? parts : [""];
  }

  function benefitsToText(list) {
    return (list || [])
      .map(function (s) {
        return String(s || "").trim();
      })
      .filter(Boolean)
      .join("\n");
  }

  function role() {
    try {
      return (
        JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}")
          .adminRole || "admin"
      );
    } catch (e) {
      return "admin";
    }
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign(
      { Accept: "application/json", "Content-Type": "application/json", "x-mcj-admin-role": role() },
      opts.headers || {}
    );
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

  function paintBenefitsEditor() {
    var list = state.form.benefits && state.form.benefits.length ? state.form.benefits : [""];
    return (
      '<div data-vip-benefits-editor style="margin-top:10px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">' +
      "<strong style='font-size:13px'>等级福利（可多条）</strong>" +
      '<button type="button" class="ghost-btn" data-vip-benefit-add>+ 新增福利</button>' +
      "</div>" +
      list
        .map(function (line, idx) {
          return (
            '<div style="display:flex;gap:8px;margin-bottom:6px" data-vip-benefit-row="' +
            idx +
            '">' +
            '<input type="text" data-vip-benefit-input="' +
            idx +
            '" value="' +
            esc(line) +
            '" placeholder="例如：专属客服 / 优先匹配 / 生日福利" style="flex:1">' +
            '<button type="button" class="ghost-btn" data-vip-benefit-remove="' +
            idx +
            '"' +
            (list.length <= 1 ? " disabled" : "") +
            ">删除</button>" +
            "</div>"
          );
        })
        .join("") +
      '<p class="admin-sync-note" style="margin:4px 0 0">保存后老板 VIP 卡 Exclusive Benefits 会同步显示。</p>' +
      "</div>"
    );
  }

  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取 Boss VIP 等级…</div>';
      return;
    }
    var tip = "";
    if (state.error) tip += '<p class="admin-sync-note" style="color:#ff8aa0">' + esc(state.error) + "</p>";
    if (state.message) tip += '<p class="admin-sync-note" style="color:#86efac">' + esc(state.message) + "</p>";
    if (!state.tablesReady) {
      box.innerHTML =
        tip +
        '<p class="admin-sync-note">Boss VIP 功能尚未初始化。请先在 Production 应用 migration <code>20260915090000_boss_vip_spend.sql</code>（勿在未确认时自动执行），初始化后再设置等级名称、消费门槛与福利。</p>';
      return;
    }

    var rows =
      (state.levels || [])
        .map(function (lv, idx) {
          var perkPreview = String(lv.benefits || "")
            .replace(/\r\n/g, "\n")
            .split(/\n+/)
            .map(function (s) {
              return s.trim();
            })
            .filter(Boolean)
            .join(" · ");
          return (
            "<tr>" +
            "<td>L" +
            esc(idx + 1) +
            "</td>" +
            "<td>" +
            esc(lv.name) +
            "</td>" +
            "<td>" +
            esc(lv.spendThreshold) +
            " 猫粮</td>" +
            "<td>" +
            esc(perkPreview || "-") +
            "</td>" +
            "<td>" +
            esc(lv.bossCount || 0) +
            "</td>" +
            "<td>" +
            (lv.isActive ? "启用" : "停用") +
            "</td>" +
            "<td>" +
            '<button type="button" class="ghost-btn" data-vip-edit="' +
            esc(lv.id) +
            '">编辑</button> ' +
            '<button type="button" class="ghost-btn" data-vip-toggle="' +
            esc(lv.id) +
            '" data-vip-active="' +
            (lv.isActive ? "0" : "1") +
            '">' +
            (lv.isActive ? "停用" : "启用") +
            "</button> " +
            '<button type="button" class="ghost-btn" data-vip-up="' +
            esc(lv.id) +
            '"' +
            (idx === 0 ? " disabled" : "") +
            ">上移</button> " +
            '<button type="button" class="ghost-btn" data-vip-down="' +
            esc(lv.id) +
            '"' +
            (idx === state.levels.length - 1 ? " disabled" : "") +
            ">下移</button> " +
            '<button type="button" class="ghost-btn" data-vip-delete="' +
            esc(lv.id) +
            '" data-vip-bosses="' +
            esc(lv.bossCount || 0) +
            '">删除</button>' +
            "</td>" +
            "</tr>"
          );
        })
        .join("") || '<tr><td colspan="7" class="empty">暂无 VIP 等级</td></tr>';

    box.innerHTML =
      tip +
      '<p class="admin-sync-note" style="margin:0 0 12px">老板根据<strong>客服确认的累计有效消费</strong>自动升级 VIP。可配置：等级名称、升级门槛（猫粮）、多条福利、排序、启停。直属分成请到「直属关系管理」。</p>' +
      '<div class="admin-toolbar" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
      '<button type="button" class="primary-btn" data-vip-new' +
      (state.busy ? " disabled" : "") +
      ">新增等级</button>" +
      '<button type="button" class="ghost-btn" data-vip-reload' +
      (state.busy ? " disabled" : "") +
      ">刷新</button>" +
      '<button type="button" class="ghost-btn" data-vip-recast' +
      (state.busy ? " disabled" : "") +
      ">按新门槛重新计算</button>" +
      "</div>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>顺序</th><th>名称</th><th>消费门槛</th><th>福利</th><th>当前老板人数</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      '<div class="admin-card" style="margin:16px 0;padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:12px">' +
      "<h3 style='margin:0 0 10px;font-size:16px'>" +
      (state.form.id ? "编辑 VIP 等级" : "新增 VIP 等级") +
      "</h3>" +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">' +
      '<label>等级名称<input id="vipName" value="' +
      esc(state.form.name) +
      '" placeholder="例如：银卡会员"></label>' +
      '<label>升级所需累计有效消费（猫粮）<input id="vipThreshold" type="number" min="0" step="1" value="' +
      esc(state.form.spendThreshold) +
      '"></label>' +
      '<label>排序（数字越小越靠前）<input id="vipSort" type="number" value="' +
      esc(state.form.sortOrder) +
      '"></label>' +
      '<label>启用<select id="vipActive"><option value="1"' +
      (state.form.isActive ? " selected" : "") +
      '>启用</option><option value="0"' +
      (!state.form.isActive ? " selected" : "") +
      ">停用</option></select></label>" +
      "</div>" +
      paintBenefitsEditor() +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="primary-btn" data-vip-save' +
      (state.busy ? " disabled" : "") +
      ">保存</button>" +
      (state.form.id
        ? '<button type="button" class="ghost-btn" data-vip-cancel>取消编辑</button>'
        : "") +
      "</div></div>";
  }

  function readForm() {
    state.form.name = (document.getElementById("vipName") || {}).value || "";
    state.form.spendThreshold = (document.getElementById("vipThreshold") || {}).value || "0";
    state.form.sortOrder = (document.getElementById("vipSort") || {}).value || "100";
    var active = document.getElementById("vipActive");
    state.form.isActive = !active || active.value !== "0";
    var inputs = target() ? target().querySelectorAll("[data-vip-benefit-input]") : [];
    state.form.benefits = Array.prototype.map.call(inputs, function (el) {
      return el.value || "";
    });
    if (!state.form.benefits.length) state.form.benefits = [""];
  }

  function syncBenefitInputs() {
    readForm();
  }

  function load() {
    state.loading = true;
    state.error = "";
    paint();
    return api("/api/admin/boss-vip?action=list")
      .then(function (body) {
        state.tablesReady = body.tablesReady !== false;
        state.levels = body.levels || [];
        if (body.tablesReady === false) state.error = body.message || "Boss VIP 功能尚未初始化";
        else state.error = "";
      })
      .catch(function (err) {
        var msg = String((err && err.message) || "读取失败");
        if (/does not exist|schema cache|PGRST205|Could not find the table/i.test(msg)) {
          state.tablesReady = false;
          state.error = "Boss VIP 功能尚未初始化";
        } else {
          state.error = msg;
        }
        state.levels = [];
      })
      .then(function () {
        state.loading = false;
        paint();
      });
  }

  function run(task, okMsg) {
    if (state.busy) return;
    state.busy = true;
    state.error = "";
    state.message = "";
    paint();
    return Promise.resolve()
      .then(task)
      .then(function () {
        state.message = okMsg || "已保存";
        return load();
      })
      .catch(function (err) {
        state.error = String((err && err.message) || "操作失败");
        if (/does not exist|schema cache|PGRST205|Could not find the table/i.test(state.error)) {
          state.tablesReady = false;
          state.error = "Boss VIP 功能尚未初始化";
        }
      })
      .then(function () {
        state.busy = false;
        paint();
      });
  }

  function reorder(fromId, dir) {
    var ids = (state.levels || []).map(function (lv) {
      return lv.id;
    });
    var i = ids.indexOf(fromId);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    var tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
    run(function () {
      return api("/api/admin/boss-vip", {
        method: "POST",
        body: JSON.stringify({ action: "reorder", ids: ids }),
      });
    }, "已更新排序");
  }

  document.addEventListener("click", function (e) {
    var sectionBtn = e.target.closest("[data-section='boss-levels']");
    if (sectionBtn) setTimeout(load, 0);
    var box = target();
    if (!box) return;
    if (!box.contains(e.target) && !sectionBtn) return;

    if (e.target.closest("[data-vip-reload]")) {
      load();
      return;
    }
    if (e.target.closest("[data-vip-new]")) {
      state.form = emptyForm();
      paint();
      return;
    }
    if (e.target.closest("[data-vip-cancel]")) {
      state.form = emptyForm();
      paint();
      return;
    }
    if (e.target.closest("[data-vip-benefit-add]")) {
      syncBenefitInputs();
      state.form.benefits.push("");
      paint();
      return;
    }
    var removePerk = e.target.closest("[data-vip-benefit-remove]");
    if (removePerk) {
      syncBenefitInputs();
      var ridx = Number(removePerk.getAttribute("data-vip-benefit-remove"));
      if (state.form.benefits.length <= 1) return;
      state.form.benefits.splice(ridx, 1);
      paint();
      return;
    }
    var edit = e.target.closest("[data-vip-edit]");
    if (edit) {
      var lv = (state.levels || []).find(function (row) {
        return row.id === edit.getAttribute("data-vip-edit");
      });
      if (!lv) return;
      state.form = {
        id: lv.id,
        name: lv.name || "",
        spendThreshold: String(lv.spendThreshold || 0),
        benefits: benefitsToList(lv.benefits),
        sortOrder: String(lv.sortOrder || 100),
        isActive: lv.isActive !== false,
      };
      paint();
      return;
    }
    if (e.target.closest("[data-vip-save]")) {
      readForm();
      run(function () {
        return api("/api/admin/boss-vip", {
          method: "POST",
          body: JSON.stringify({
            action: "upsert",
            level: {
              id: state.form.id,
              name: state.form.name,
              spendThreshold: Number(state.form.spendThreshold || 0),
              benefits: benefitsToText(state.form.benefits),
              sortOrder: Number(state.form.sortOrder || 100),
              isActive: state.form.isActive,
            },
          }),
        }).then(function () {
          state.form = emptyForm();
        });
      }, "已保存 VIP 等级");
      return;
    }
    var toggle = e.target.closest("[data-vip-toggle]");
    if (toggle) {
      run(function () {
        return api("/api/admin/boss-vip", {
          method: "POST",
          body: JSON.stringify({
            action: "set_active",
            id: toggle.getAttribute("data-vip-toggle"),
            isActive: toggle.getAttribute("data-vip-active") === "1",
          }),
        });
      }, "已更新状态");
      return;
    }
    var del = e.target.closest("[data-vip-delete]");
    if (del) {
      var bosses = Number(del.getAttribute("data-vip-bosses") || 0);
      if (bosses > 0) {
        state.error = "该等级仍有 " + bosses + " 位老板使用，请先停用或迁移后再删除";
        paint();
        return;
      }
      if (!confirm("确认删除该未使用等级？历史记录不受影响。")) return;
      run(function () {
        return api("/api/admin/boss-vip", {
          method: "POST",
          body: JSON.stringify({ action: "delete", id: del.getAttribute("data-vip-delete") }),
        });
      }, "已删除等级");
      return;
    }
    var up = e.target.closest("[data-vip-up]");
    if (up) {
      reorder(up.getAttribute("data-vip-up"), -1);
      return;
    }
    var down = e.target.closest("[data-vip-down]");
    if (down) {
      reorder(down.getAttribute("data-vip-down"), 1);
      return;
    }
    if (e.target.closest("[data-vip-recast]")) {
      run(function () {
        return api("/api/admin/boss-vip", {
          method: "POST",
          body: JSON.stringify({ action: "recast_all" }),
        });
      }, "已按当前门槛重新计算");
    }
  });

  if (document.getElementById(TARGET)) load();
})();
