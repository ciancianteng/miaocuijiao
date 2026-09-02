/**
 * Boss · 直属分成中心（UI only）
 * Uses existing read APIs only — no schema / settlement logic changes.
 * Formula display: platform fee × commission % (from API summary.formula).
 */
(function () {
  "use strict";
  var root = document.getElementById("directCompanionsApp");
  if (!root) return;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return "0.00";
    return n.toFixed(2);
  }

  function shortId(v) {
    var s = String(v || "");
    return s.length > 10 ? s.slice(0, 8) + "…" : s || "-";
  }

  function fmtTime(v) {
    if (!v) return "-";
    return String(v).replace("T", " ").slice(0, 19);
  }

  function statusBadge(status) {
    var s = String(status || "").toLowerCase();
    if (s === "active" || s === "settled" || s === "completed" || s === "paid") {
      return '<span class="badge ok">' + esc(statusLabel(s)) + "</span>";
    }
    if (s === "pending" || s === "processing") {
      return '<span class="badge warn">' + esc(statusLabel(s)) + "</span>";
    }
    if (!s) return '<span class="badge muted">-</span>';
    return '<span class="badge muted">' + esc(statusLabel(s)) + "</span>";
  }

  function statusLabel(s) {
    var map = {
      active: "生效中",
      inactive: "已停用",
      unbound: "已解绑",
      settled: "已结算",
      completed: "已完成",
      pending: "待结算",
      void: "已作废",
      paid: "已到账",
    };
    return map[s] || s;
  }

  function token() {
    if (window.MCJBossAuth && typeof window.MCJBossAuth.getAccessToken === "function") {
      return window.MCJBossAuth.getAccessToken() || "";
    }
    try {
      return localStorage.getItem("access_token") || sessionStorage.getItem("access_token") || "";
    } catch (e) {
      return "";
    }
  }

  function paint(html) {
    root.innerHTML = html;
  }

  function companionName(map, companionId, row) {
    if (row && row.companion && row.companion.displayName) return row.companion.displayName;
    var hit = map[companionId];
    if (hit && hit.displayName) return hit.displayName;
    return companionId ? shortId(companionId) : "-";
  }

  function deriveLevel(companions, earnings) {
    var activeCount = companions.filter(function (c) {
      return String(c.status || "").toLowerCase() === "active";
    }).length;
    var latest = earnings[0] || null;
    var levelCode = (latest && (latest.bossLevelCode || latest.boss_level_code)) || "";
    var levelId = (latest && (latest.bossLevelId || latest.boss_level_id)) || "";
    var rate = latest && latest.bossCommissionRate != null ? Number(latest.bossCommissionRate) : null;
    if (rate == null || !Number.isFinite(rate)) {
      var override = companions.find(function (c) {
        return c.commissionRate != null && c.commissionRate !== "";
      });
      if (override) rate = Number(override.commissionRate);
    }
    return {
      activeCount: activeCount,
      levelCode: levelCode || (levelId ? shortId(levelId) : "默认等级"),
      levelId: levelId,
      rate: rate,
      hasRate: rate != null && Number.isFinite(rate),
    };
  }

  function renderRelationCard(companions, tablesReady) {
    if (tablesReady === false) {
      return (
        '<section class="panel">' +
        "<h2>生效中的直属关系</h2>" +
        '<p class="sub">当前绑定的直属陪玩与绑定状态</p>' +
        '<p class="message">直属关系功能尚未开通</p>' +
        "</section>"
      );
    }
    var active = companions.filter(function (c) {
      return String(c.status || "").toLowerCase() === "active";
    });
    var rows =
      active
        .map(function (r) {
          var c = r.companion || {};
          var rateText =
            r.commissionRate == null || r.commissionRate === ""
              ? "平台默认"
              : money(r.commissionRate) + "%";
          return (
            '<div class="rel-row">' +
            "<div><span>直属陪玩</span><strong>" +
            esc(c.displayName || "陪玩") +
            '</strong><span style="display:block;margin-top:4px">' +
            esc(c.companionCode || shortId(c.id || r.companionId)) +
            "</span></div>" +
            "<div><span>绑定状态</span><strong>" +
            statusBadge(r.status || "active") +
            "</strong></div>" +
            "<div><span>关系分成</span><strong>" +
            esc(rateText) +
            "</strong></div>" +
            "<div><span>绑定时间</span><strong>" +
            esc(fmtTime(r.boundAt)) +
            "</strong></div>" +
            "</div>"
          );
        })
        .join("") ||
      '<div class="empty">暂无生效中的直属陪玩<br>由后台完成绑定后，将显示在此处</div>';

    return (
      '<section class="panel">' +
      "<h2>生效中的直属关系</h2>" +
      '<p class="sub">当前绑定陪玩 · 绑定状态 · 只读展示（解绑/换绑由后台操作）</p>' +
      '<div class="rel-list">' +
      rows +
      "</div></section>"
    );
  }

  function renderCommissionCard(summary, earnings) {
    var total = summary.totalBossCommission != null ? summary.totalBossCommission : 0;
    var count = summary.count != null ? summary.count : earnings.length;
    var formulaZh = "平台抽成金额 × 分成比例%";
    var formulaCode = summary.formula || "boss_commission = platform_fee × rate / 100";
    return (
      '<section class="panel">' +
      "<h2>直属分成概览</h2>" +
      '<p class="sub">分成来自平台抽成，不扣减陪玩服务收入</p>' +
      '<div class="stat-grid">' +
      '<div class="stat"><span>累计已获分成</span><strong class="money">RM ' +
      esc(money(total)) +
      "</strong><em>按已返回明细汇总</em></div>" +
      '<div class="stat"><span>成功分成笔数</span><strong>' +
      esc(count) +
      "</strong><em>订单完成后结算的直属分成</em></div>" +
      "</div>" +
      '<div class="formula" style="margin-top:12px">结算公式：<strong>' +
      esc(formulaZh) +
      "</strong><br><code>" +
      esc(formulaCode) +
      "</code>" +
      (summary.note ? "<br>" + esc(summary.note) : "") +
      "</div></section>"
    );
  }

  function renderLevelCard(level) {
    var rateText = level.hasRate ? money(level.rate) + "%" : "平台默认";
    var progressNote =
      "邀请进度按当前生效直属陪玩数统计。下一等级门槛由平台等级规则管理。";
    var pct = Math.min(100, level.activeCount * 20);
    return (
      '<section class="panel">' +
      "<h2>老板等级 / 进度</h2>" +
      '<p class="sub">当前等级、分成比例与邀请进度</p>' +
      '<div class="stat-grid">' +
      '<div class="stat"><span>当前等级</span><strong>' +
      esc(level.levelCode) +
      "</strong><em>" +
      (level.levelId ? "ID " + esc(shortId(level.levelId)) : "来自最近结算快照") +
      "</em></div>" +
      '<div class="stat"><span>当前分成比例</span><strong>' +
      esc(rateText) +
      "</strong><em>用于平台抽成内的直属分成</em></div>" +
      '<div class="stat"><span>下一等级要求</span><strong>平台规则</strong><em>达到更多生效直属后自动升级</em></div>' +
      '<div class="stat"><span>邀请进度</span><strong>' +
      esc(level.activeCount) +
      " 位直属</strong><em>" +
      esc(progressNote) +
      "</em>" +
      '<div class="progress" aria-hidden="true"><i style="width:' +
      esc(pct) +
      '%"></i></div></div>' +
      "</div></section>"
    );
  }

  function renderHistoryTable(earnings, companionMap, companions) {
    var byId = {};
    companions.forEach(function (r) {
      if (r.companionId) byId[r.companionId] = r.companion || { id: r.companionId };
    });
    Object.keys(companionMap || {}).forEach(function (k) {
      byId[k] = companionMap[k];
    });

    if (!earnings.length) {
      return (
        '<section class="panel">' +
        "<h2>收益明细</h2>" +
        '<p class="sub">订单 · 陪玩 · 平台抽成 · 分成% · 到账金额 · 状态</p>' +
        '<div class="empty">暂无直属分成记录</div></section>'
      );
    }

    var body = earnings
      .map(function (e) {
        var name = companionName(byId, e.companionId, null);
        return (
          "<tr>" +
          "<td><strong>" +
          esc(shortId(e.orderId)) +
          '</strong><div class="cell-muted">' +
          esc(fmtTime(e.settledAt || e.createdAt)) +
          "</div></td>" +
          "<td>" +
          esc(name) +
          '<div class="cell-muted">' +
          esc(shortId(e.companionId)) +
          "</div></td>" +
          '<td class="money">RM ' +
          esc(money(e.platformFeeAmount)) +
          '<div class="cell-muted">费率 ' +
          esc(money(e.platformFeeRate)) +
          "%</div></td>" +
          "<td>" +
          esc(money(e.bossCommissionRate)) +
          "%</td>" +
          '<td class="money">RM ' +
          esc(money(e.bossCommissionAmount)) +
          "</td>" +
          "<td>" +
          statusBadge(e.status || "settled") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    return (
      '<section class="panel">' +
      "<h2>收益明细</h2>" +
      '<p class="sub">订单 · 陪玩 · 平台抽成 · 分成% · 到账金额 · 状态</p>' +
      '<div class="table-wrap"><table class="earn">' +
      "<thead><tr>" +
      "<th>订单</th><th>陪玩</th><th>平台抽成</th><th>分成%</th><th>分成金额</th><th>状态</th>" +
      "</tr></thead><tbody>" +
      body +
      "</tbody></table></div></section>"
    );
  }

  function renderWalletSection(summary, earnings) {
    var total = Number(summary.totalBossCommission || 0);
    var settled = earnings.filter(function (e) {
      var s = String(e.status || "settled").toLowerCase();
      return s === "settled" || s === "completed" || s === "paid";
    });
    var available = settled.reduce(function (sum, e) {
      return sum + Number(e.bossCommissionAmount || 0);
    }, 0);
    available = Math.round(available * 100) / 100;

    var hist =
      settled
        .slice(0, 8)
        .map(function (e) {
          return (
            '<div class="rel-row" style="grid-template-columns:1.2fr 1fr 1fr">' +
            "<div><span>入账</span><strong>订单 " +
            esc(shortId(e.orderId)) +
            "</strong></div>" +
            '<div><span>金额</span><strong class="money">RM ' +
            esc(money(e.bossCommissionAmount)) +
            "</strong></div>" +
            "<div><span>状态</span><strong>" +
            statusBadge(e.status || "settled") +
            "</strong><div class='cell-muted'>" +
            esc(fmtTime(e.settledAt)) +
            "</div></div>" +
            "</div>"
          );
        })
        .join("") || '<div class="empty">暂无分成入账记录</div>';

    return (
      '<section class="panel" id="boss-commission-wallet">' +
      "<h2>分成钱包</h2>" +
      '<p class="sub">直属分成入账概览（与猫粮充值钱包相互独立）</p>' +
      '<div class="stat-grid">' +
      '<div class="stat"><span>可展示余额（已结算）</span><strong class="money">RM ' +
      esc(money(available)) +
      "</strong><em>来自已结算分成明细</em></div>" +
      '<div class="stat"><span>累计已获</span><strong class="money">RM ' +
      esc(money(total)) +
      "</strong><em>历史分成合计</em></div>" +
      "</div>" +
      '<div class="wallet-actions">' +
      '<a class="boss-btn primary" href="support.html">申请提现 / 联系客服</a>' +
      '<a class="ghost-btn" href="recharge.html">猫粮钱包流水</a>' +
      "</div>" +
      '<p class="hint">直属分成提现请通过客服办理；此处仅展示已有结算明细，不改动结算规则。</p>' +
      "<h2 style=\"margin-top:18px;font-size:16px\">提现 / 入账记录</h2>" +
      '<div class="hist-list" style="margin-top:10px">' +
      hist +
      "</div></section>"
    );
  }

  function load() {
    if (!token()) {
      paint(
        '<section class="page-head"><div><h1>直属分成中心</h1><p>请先登录老板账号</p></div></section>' +
          '<p class="message bad">未登录</p><p><a class="ghost-btn" href="mine.html">去登录</a></p>'
      );
      return;
    }
    paint(
      '<section class="page-head"><div><h1>直属分成中心</h1><p>加载中…</p></div></section><div class="empty">正在读取直属关系与分成明细</div>'
    );
    var headers = { Accept: "application/json", Authorization: "Bearer " + token() };
    Promise.all([
      fetch("/api/boss/direct-companions", { headers: headers, cache: "no-store" }).then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "读取直属陪玩失败");
          return body;
        });
      }),
      fetch("/api/boss/commission-earnings?limit=100", { headers: headers, cache: "no-store" })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok) return { ok: false, earnings: [], summary: {} };
            return body;
          });
        })
        .catch(function () {
          return { ok: false, earnings: [], summary: {} };
        }),
    ])
      .then(function (pair) {
        var body = pair[0] || {};
        var earningsBody = pair[1] || {};
        var companions = body.companions || [];
        var earnings = earningsBody.earnings || [];
        var summary = earningsBody.summary || {};
        var level = deriveLevel(companions, earnings);
        var note = "";
        if (body.tablesReady === false) {
          note = '<p class="message">直属关系功能尚未开通</p>';
        } else if (earningsBody.tablesReady === false) {
          note = '<p class="message">直属分成表尚未初始化</p>';
        }

        paint(
          '<section class="page-head"><div><h1>直属分成中心</h1><p>直属陪玩关系、分成概览、等级进度、收益明细与分成钱包。分成从平台抽成支付，不扣陪玩收入。</p></div>' +
            '<a class="ghost-btn" href="mine.html">返回我的账号</a></section>' +
            note +
            '<div class="cards">' +
            renderCommissionCard(summary, earnings) +
            renderLevelCard(level) +
            '<section class="panel"><h2>关系速览</h2><p class="sub">生效直属数量</p>' +
            '<div class="stat"><span>生效中直属</span><strong>' +
            esc(
              companions.filter(function (c) {
                return String(c.status || "").toLowerCase() === "active";
              }).length
            ) +
            "</strong><em>详见下方关系卡片</em></div></section>" +
            "</div>" +
            renderRelationCard(companions, body.tablesReady) +
            renderHistoryTable(earnings, {}, companions) +
            renderWalletSection(summary, earnings)
        );
      })
      .catch(function (err) {
        paint(
          '<section class="page-head"><div><h1>直属分成中心</h1></div></section>' +
            '<p class="message bad">' +
            esc(err.message || "读取失败") +
            "</p>"
        );
      });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-logout]");
    if (!btn) return;
    if (window.MCJBossAuth && typeof window.MCJBossAuth.clearSession === "function") {
      window.MCJBossAuth.clearSession();
    }
    location.href = "index.html";
  });

  load();
})();
