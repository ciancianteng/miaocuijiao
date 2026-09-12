(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "table-companion_applications";
  var state = { loading: true, error: "", rows: [], filter: "pending", message: "", levels: [], selectedLevelById: {} };

  function certMethodOf(item) {
    var mode = String(
      (item && (item.certificationMethod || item.certification_method || item.credential_mode || item.auth_mode || item.authMode)) || ""
    ).trim().toLowerCase();
    if (mode === "id_card") return "身份证认证";
    if (mode === "deposit") return "押金认证";
    if (item && item.certificationMethodLabel) return String(item.certificationMethodLabel);
    return "未选择";
  }
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
        if (!res.ok || body.ok === false) {
          var err = new Error(body.message || "请求失败");
          err.code = body.code || "";
          err.blockReasons = body.blockReasons || body.block_reasons || [];
          err.publish = body.publish || null;
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  function loadLevels() {
    return api("/api/admin/companion-levels")
      .then(function (res) {
        var list = res.levels || res.data || [];
        state.levels = (list || []).filter(function (lv) {
          return lv && (lv.enabled !== false && lv.open !== false);
        });
        return state.levels;
      })
      .catch(function () {
        state.levels = state.levels || [];
        return state.levels;
      });
  }
  function levelBasePrice(lv) {
    if (!lv) return 0;
    var n = Number(lv.basePrice != null ? lv.basePrice : lv.base_price != null ? lv.base_price : lv.min);
    return Number.isFinite(n) ? n : 0;
  }
  function levelOptionLabel(lv) {
    var code = lv.code || lv.name || lv.id || "";
    var name = lv.name && lv.code && lv.name !== lv.code ? (" " + lv.name) : (lv.name && !lv.code ? lv.name : "");
    var price = levelBasePrice(lv);
    return String(code) + (name && name !== (" " + code) ? name : "") + (price > 0 ? (" · 基础价格 " + price + " 猫粮") : "");
  }
  function selectedLevel(id) {
    var key = String(state.selectedLevelById[id] || "").trim();
    if (!key) return null;
    return (state.levels || []).find(function (lv) {
      return String(lv.id) === key || String(lv.code) === key || String(lv.name) === key;
    }) || null;
  }
  function levelPickerHtml(id) {
    var selected = String(state.selectedLevelById[id] || "");
    var lv = selectedLevel(id);
    var opts =
      '<option value="">请选择等级</option>' +
      (state.levels || [])
        .map(function (item) {
          var value = String(item.id || item.code || "");
          return (
            '<option value="' +
            esc(value) +
            '" ' +
            (selected === value ? "selected" : "") +
            ">" +
            esc(levelOptionLabel(item)) +
            "</option>"
          );
        })
        .join("");
    var preview = lv
      ? '<div class="admin-sync-note" data-capp-level-preview="' +
        esc(id) +
        '">等级：' +
        esc((lv.code || "") + " " + (lv.name || "")) +
        " · 基础价格：" +
        esc(String(levelBasePrice(lv))) +
        " 猫粮</div>"
      : '<div class="admin-sync-note" data-capp-level-preview="' +
        esc(id) +
        '">通过审核前必须选择陪玩等级；价格将按该等级 base_price 自动写入。</div>';
    return (
      '<div class="capp-level-picker" data-capp-level-wrap="' +
      esc(id) +
      '"><label>陪玩等级 <select data-capp-level="' +
      esc(id) +
      '">' +
      opts +
      "</select></label>" +
      preview +
      "</div>"
    );
  }
  function statusCode(row) {
    return String(row.application_status || row.applicationStatus || row.verification_status || row.auditStatus || "pending").toLowerCase();
  }
  function statusLabel(code) {
    var key = String(code || "").toLowerCase().trim();
    var map = {
      draft: "草稿中",
      pending: "审核中",
      review: "审核中",
      submitted: "审核中",
      resubmit: "需要补资料",
      need_more: "需要补资料",
      approved: "审核通过",
      verified: "审核通过",
      passed: "审核通过",
      rejected: "审核未通过",
    };
    if (map[key]) return map[key];
    if (!key || /^[a-z][a-z0-9_]*$/i.test(key)) return "-";
    return String(code);
  }
  function isApplicationQueue(row) {
    var code = statusCode(row);
    if (/approved|verified|passed/.test(code) && !row.application_submitted_at && !row.applicationSubmittedAt) {
      /* still show if they have submitted_at */
    }
    return !!row.id && (row.application_submitted_at || row.applicationSubmittedAt || row.game || row.mainGame || row.main_service || /pending|resubmit|rejected|approved|review|submitted/.test(code));
  }
  function missingPrice(row) {
    if (!row) return true;
    if (row.missingPrice === true || row.missing_price === true) return true;
    if (row.missingPrice === false || row.missing_price === false) return false;
    var p = Number(row.price);
    if (Number.isFinite(p) && p > 0) return false;
    var gp = row.game_prices || row.gamePrices || {};
    if (typeof gp === "string") {
      try {
        gp = JSON.parse(gp);
      } catch (e) {
        gp = {};
      }
    }
    return !Object.keys(gp || {}).some(function (k) {
      var n = Number(gp[k]);
      return Number.isFinite(n) && n > 0;
    });
  }
  function hallVisible(row) {
    return row && (row.hallVisible === true || row.hall_visible === true || row.publishReady === true);
  }
  function approvedButHidden(row) {
    if (!row) return false;
    if (row.approvedButHidden === true || row.approved_but_hidden === true) return true;
    var code = statusCode(row);
    if (!/approved|verified|passed/.test(code)) return false;
    if (row.isTestAccount === true || row.is_test_account === true) return false;
    return !hallVisible(row);
  }
  function publishHint(row) {
    if (!row) return "";
    if (row.isTestAccount === true || row.is_test_account === true) return "测试账号隔离";
    if (hallVisible(row)) return "已上大厅";
    var reasons = row.blockReasons || row.block_reasons || row.criticalMissing || [];
    if (Array.isArray(reasons) && reasons.length) return reasons.join("、");
    return row.listingBlockReason || row.publishStatusLabel || "";
  }
  function filteredRows() {
    var list = (state.rows || []).filter(isApplicationQueue);
    var f = state.filter || "all";
    if (f === "all") return list;
    if (f === "pending") return list.filter(function (r) { return /pending|review|submitted/.test(statusCode(r)); });
    if (f === "resubmit") return list.filter(function (r) { return /resubmit|need_more/.test(statusCode(r)); });
    if (f === "approved") return list.filter(function (r) { return /approved|verified|passed/.test(statusCode(r)); });
    if (f === "approved_missing_price") {
      return list.filter(function (r) {
        return /approved|verified|passed/.test(statusCode(r)) && missingPrice(r);
      });
    }
    if (f === "approved_not_in_hall") {
      return list.filter(function (r) {
        return approvedButHidden(r);
      });
    }
    if (f === "rejected") return list.filter(function (r) { return /rejected/.test(statusCode(r)); });
    return list;
  }
  function paint() {
    var box = document.getElementById(TARGET);
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取陪玩申请…</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="admin-sync-note error">' +
        esc(state.error) +
        ' <button class="mini-btn" type="button" data-capp-reload>重试</button></div>';
      return;
    }
    var rows = filteredRows();
    var body = rows
      .map(function (item) {
        var code = statusCode(item);
        var id = item.id || item.playerId || "";
        var noPrice = missingPrice(item);
        var hidden = approvedButHidden(item);
        var hint = publishHint(item);
        var statusText = statusLabel(code);
        if (noPrice) statusText += " · 缺价格";
        if (/approved|verified|passed/.test(code)) {
          if (item.isTestAccount === true || item.is_test_account === true) statusText += " · 测试隔离";
          else if (hallVisible(item)) statusText += " · 已上大厅";
          else if (hidden) statusText += " · 未上大厅";
        }
        return (
          "<tr>" +
          "<td>" +
          esc(id) +
          "</td><td>" +
          esc(item.nickname || item.name || "-") +
          "</td><td>" +
          esc(item.phone || item.email || "-") +
          "</td><td>" +
          esc(item.game || item.mainGame || item.main_service || "-") +
          "</td><td title=\"" +
          esc(hint) +
          "\">" +
          esc(statusText) +
          (hidden && hint ? "<br><small>" + esc(hint) + "</small>" : "") +
          "</td><td>" +
          esc(certMethodOf(item)) +
          "</td><td>" +
          esc(item.depositStatus || item.deposit_status || "-") +
          "</td><td>" +
          levelPickerHtml(id) +
          '<button class="mini-btn primary-lite" type="button" data-capp-open="' +
          esc(id) +
          '">审核</button> ' +
          '<button class="mini-btn" type="button" data-capp-approve="' +
          esc(id) +
          '"' +
          (selectedLevel(id) ? "" : " disabled") +
          '>通过</button> ' +
          '<button class="mini-btn" type="button" data-capp-resubmit="' +
          esc(id) +
          '">补资料</button> ' +
          '<button class="mini-btn danger-btn" type="button" data-capp-reject="' +
          esc(id) +
          '">拒绝</button>' +
          "</td></tr>"
        );
      })
      .join("");
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>陪玩申请审核</h3><p>通过审核前必须选择陪玩等级。系统按等级 base_price 初始化服务价格；真实用户须具备昵称、游戏，且账号 active；测试账号保持隔离不进正式大厅。</p></div>' +
      '<div class="content-admin-toolbar compact"><select data-capp-filter>' +
      [
        ["pending", "审核中"],
        ["resubmit", "需要补资料"],
        ["approved", "审核通过"],
        ["approved_not_in_hall", "已通过但未上大厅"],
        ["approved_missing_price", "已通过但缺价格"],
        ["rejected", "审核未通过"],
        ["all", "全部"],
      ]
        .map(function (pair) {
          return (
            '<option value="' +
            pair[0] +
            '" ' +
            (state.filter === pair[0] ? "selected" : "") +
            ">" +
            pair[1] +
            "</option>"
          );
        })
        .join("") +
      '</select><button class="mini-btn" type="button" data-capp-reload>刷新</button></div></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="table-wrap"><table><thead><tr><th>申请ID</th><th>昵称</th><th>联系方式</th><th>游戏</th><th>申请/大厅状态</th><th>认证方式</th><th>押金</th><th>操作</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="8">暂无陪玩申请</td></tr>') +
      "</tbody></table></div>";
  }
  function load() {
    state.loading = true;
    state.error = "";
    paint();
    Promise.all([api("/api/admin/players"), loadLevels()])
      .then(function (pair) {
        var res = pair[0] || {};
        state.rows = res.players || res.data || [];
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        paint();
      });
  }
  function review(id, status, reason, levelId) {
    var payload = { status: status, rejectReason: reason || "" };
    if (status === "approved") {
      payload.levelId = levelId || "";
      payload.level_id = levelId || "";
    }
    return api("/api/admin/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review_application",
        id: id,
        payload: payload,
      }),
    }).then(function (res) {
      state.message = res.message || "审核已保存";
      if (res.approvedButHidden && Array.isArray(res.blockReasons) && res.blockReasons.length) {
        state.message += "；未上大厅原因：" + res.blockReasons.join("、");
      }
      if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadList) {
        window.MCJAdminPlayerBridge.reloadList();
      }
      load();
      return res;
    });
  }
  function openDetail(id) {
    if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadDetail) {
      window.MCJAdminPlayerBridge.reloadDetail(id, "edit");
      return;
    }
    var btn = document.querySelector('[data-player-action="edit"][data-player-id="' + id + '"]');
    if (btn) btn.click();
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-capp-reload]")) {
      load();
      return;
    }
    var open = e.target.closest("[data-capp-open]");
    if (open) {
      openDetail(open.getAttribute("data-capp-open"));
      return;
    }
    var approve = e.target.closest("[data-capp-approve]");
    if (approve) {
      if (approve.disabled) {
        alert("请先选择陪玩等级后再通过审核。");
        return;
      }
      var approveId = approve.getAttribute("data-capp-approve");
      var lv = selectedLevel(approveId);
      if (!lv || !lv.id) {
        alert("请先选择陪玩等级后再通过审核。");
        return;
      }
      var base = levelBasePrice(lv);
      if (!(base > 0)) {
        alert("所选等级缺少有效的基础价格 base_price，无法通过。");
        return;
      }
      if (!confirm("确认通过该陪玩申请？\n等级：" + levelOptionLabel(lv) + "\n通过后将按该等级基础价格初始化服务，并同步大厅展示条件；测试账号仍隔离。")) return;
      review(approveId, "approved", "", lv.id)
        .then(function (res) {
          var msg = (res && res.message) || "已通过。";
          if (res && res.hallVisible) msg = "已通过，已同步进入陪玩大厅。";
          else if (res && res.approvedButHidden) {
            msg =
              "已通过，但未进入大厅：" +
              ((res.blockReasons && res.blockReasons.join("、")) || "请检查资料完整性");
          }
          alert(msg);
        })
        .catch(function (err) {
          var extra =
            err && Array.isArray(err.blockReasons) && err.blockReasons.length
              ? "\n原因：" + err.blockReasons.join("、")
              : "";
          alert((err.message || "操作失败") + extra);
        });
      return;
    }
    var resubmit = e.target.closest("[data-capp-resubmit]");
    if (resubmit) {
      var reason = prompt("请填写需要补交的资料说明（必填）", "");
      if (reason == null) return;
      if (!String(reason).trim()) {
        alert("要求补资料时必须填写原因");
        return;
      }
      review(resubmit.getAttribute("data-capp-resubmit"), "resubmit", reason).catch(function (err) {
        alert(err.message || "操作失败");
      });
      return;
    }
    var reject = e.target.closest("[data-capp-reject]");
    if (reject) {
      var reason2 = prompt("请填写拒绝原因（必填）", "");
      if (reason2 == null) return;
      if (!String(reason2).trim()) {
        alert("拒绝时必须填写原因");
        return;
      }
      review(reject.getAttribute("data-capp-reject"), "rejected", reason2).catch(function (err) {
        alert(err.message || "操作失败");
      });
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target.matches("[data-capp-filter]")) {
      state.filter = e.target.value || "pending";
      paint();
      return;
    }
    var levelSel = e.target.closest("[data-capp-level]");
    if (levelSel) {
      var pid = levelSel.getAttribute("data-capp-level");
      state.selectedLevelById[pid] = levelSel.value || "";
      paint();
    }
  });
  function maybeLoad() {
    if (document.getElementById(TARGET)) load();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeLoad);
  } else {
    maybeLoad();
  }
  window.addEventListener("hashchange", function () {
    if ((location.hash || "").replace("#", "") === "companion-applications") load();
  });
  window.MCJAdminCompanionApplicationsReload = load;
})();
