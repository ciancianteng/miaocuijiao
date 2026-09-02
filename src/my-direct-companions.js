/**
 * Boss · 我的直属陪玩（只读）+ 等级卡 / 邀请 / 分成说明
 * 仅消费既有 API，不改结算规则。
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
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
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

  function headers() {
    return { Accept: "application/json", Authorization: "Bearer " + token(), "Content-Type": "application/json" };
  }

  function paint(html) {
    root.innerHTML = html;
  }

  function inviteStatusLabel(s) {
    return (
      {
        pending: "待处理",
        accepted: "已接受",
        rejected: "已拒绝",
        cancelled: "已取消",
        expired: "已过期",
      }[s] ||
      s ||
      "-"
    );
  }

  function load() {
    if (!token()) {
      paint(
        '<section class="page-head"><h1>我的直属陪玩</h1><p>请先登录老板账号</p></section>' +
          '<p class="message bad">未登录</p><p><a class="ghost-btn" href="mine.html">去登录</a></p>'
      );
      return;
    }
    paint(
      '<section class="page-head"><h1>我的直属陪玩</h1><p>等级 · 邀请 · 分成说明</p></section><div class="empty">加载中…</div>'
    );

    Promise.all([
      fetch("/api/boss/direct-companions", { headers: headers(), cache: "no-store" }).then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "读取直属陪玩失败");
          return body;
        });
      }),
      fetch("/api/boss/commission-earnings?limit=30", { headers: headers(), cache: "no-store" })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok) return { ok: false, earnings: [], summary: {} };
            return body;
          });
        })
        .catch(function () {
          return { ok: false, earnings: [], summary: {} };
        }),
      fetch("/api/boss/companion-invitations", { headers: headers(), cache: "no-store" })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok) return { ok: false, invitations: [] };
            return body;
          });
        })
        .catch(function () {
          return { ok: false, invitations: [] };
        }),
    ])
      .then(function (trio) {
        var body = trio[0] || {};
        var earningsBody = trio[1] || {};
        var inviteBody = trio[2] || {};
        var list = body.companions || [];
        var summary = earningsBody.summary || {};
        var earnings = earningsBody.earnings || [];
        var invitations = inviteBody.invitations || [];
        var pendingInvites = invitations.filter(function (i) {
          return String(i.status || "").toLowerCase() === "pending";
        });
        var latestLevel =
          (earnings[0] && (earnings[0].bossLevelCode || earnings[0].bossLevelName)) || "";
        var totalCommission = summary.totalBossCommission != null ? summary.totalBossCommission : 0;

        var companionRows =
          list
            .map(function (r) {
              var c = r.companion || {};
              var rateText =
                r.commissionRate == null || r.commissionRate === ""
                  ? "平台默认"
                  : String(r.commissionRate) + "%";
              return (
                '<div class="row">' +
                "<div><strong>" +
                esc(c.displayName || "陪玩") +
                '</strong><span style="display:block;margin-top:4px">' +
                esc(c.companionCode || c.id || "") +
                "</span></div>" +
                "<div><span>状态</span><strong style='display:block;margin-top:4px'>" +
                esc(r.status === "active" ? "生效中" : r.status || "-") +
                "</strong></div>" +
                "<div><span>分成</span><strong style='display:block;margin-top:4px'>" +
                esc(rateText) +
                "</strong></div>" +
                "<div><span>绑定时间</span><strong style='display:block;margin-top:4px'>" +
                esc(r.boundAt ? String(r.boundAt).replace("T", " ").slice(0, 19) : "-") +
                "</strong></div>" +
                "</div>"
              );
            })
            .join("") || '<div class="empty">暂无直属陪玩<br>由后台管理员绑定后显示</div>';

        var earningsRows =
          earnings
            .slice(0, 10)
            .map(function (e) {
              return (
                '<div class="row">' +
                "<div><strong>订单 " +
                esc(String(e.orderId || "").slice(0, 8)) +
                '</strong><span style="display:block;margin-top:4px">' +
                esc(e.settledAt ? String(e.settledAt).replace("T", " ").slice(0, 19) : "-") +
                "</span></div>" +
                "<div><span>平台抽成</span><strong style='display:block;margin-top:4px'>" +
                esc(e.platformFeeAmount) +
                " (" +
                esc(e.platformFeeRate) +
                "%)</strong></div>" +
                "<div><span>直属分成</span><strong style='display:block;margin-top:4px'>" +
                esc(e.bossCommissionAmount) +
                " (" +
                esc(e.bossCommissionRate) +
                "%)</strong></div>" +
                "<div><span>陪玩到手</span><strong style='display:block;margin-top:4px'>" +
                esc(e.companionIncomeAmount != null ? e.companionIncomeAmount : "-") +
                "</strong></div>" +
                "</div>"
              );
            })
            .join("") || '<div class="empty">暂无直属分成记录</div>';

        var inviteRows =
          invitations
            .slice(0, 12)
            .map(function (inv) {
              var peer = inv.companion || inv.toUser || inv.fromUser || {};
              return (
                '<div class="row">' +
                "<div><strong>" +
                esc(peer.displayName || peer.nickname || inv.companionId || "邀请") +
                '</strong><span style="display:block;margin-top:4px">' +
                esc(inviteStatusLabel(inv.status)) +
                "</span></div>" +
                "<div><span>方向</span><strong style='display:block;margin-top:4px'>" +
                esc(inv.fromRole === "boss" ? "我发出" : "对方发起") +
                "</strong></div>" +
                "<div><span>留言</span><strong style='display:block;margin-top:4px'>" +
                esc(inv.message || "-") +
                "</strong></div>" +
                "<div><span>时间</span><strong style='display:block;margin-top:4px'>" +
                esc(inv.createdAt ? String(inv.createdAt).replace("T", " ").slice(0, 19) : "-") +
                "</strong></div>" +
                "</div>"
              );
            })
            .join("") || '<div class="empty">暂无邀请记录</div>';

        var note = "";
        if (body.tablesReady === false) {
          note = '<p class="message">直属关系功能尚未开通</p>';
        }

        paint(
          '<section class="page-head"><div><h1>我的直属陪玩</h1><p>只读经营视图。解绑/换绑由后台操作。直属分成从平台抽成支付，不扣陪玩收入。</p></div>' +
            '<a class="ghost-btn" href="mine.html">返回我的账号</a></section>' +
            note +
            '<section class="level-card">' +
            '<div class="level-card-main"><span class="eyebrow">Boss 等级</span><strong>' +
            esc(latestLevel || "按关系/默认费率结算") +
            "</strong><p>当前生效直属 " +
            list.length +
            " 人 · 近窗累计分成 " +
            money(totalCommission) +
            "</p></div>" +
            '<div class="level-card-side"><span>结算口径</span><strong>平台抽成 × 分成%</strong><span style="margin-top:10px;display:block">历史快照不改写</span></div>' +
            "</section>" +
            '<section class="panel explain">' +
            "<h2>分成怎么算</h2>" +
            '<div class="money-flow">' +
            '<div class="flow-step"><span>订单</span><strong>RM30</strong></div>' +
            '<div class="flow-arrow">→</div>' +
            '<div class="flow-step fee"><span>平台抽成 20%</span><strong>RM6</strong></div>' +
            '<div class="flow-arrow">→</div>' +
            '<div class="flow-step boss"><span>Boss 5%</span><strong>RM0.30</strong></div>' +
            '<div class="flow-arrow">→</div>' +
            '<div class="flow-step comp"><span>陪玩到手</span><strong>RM24</strong></div>' +
            "</div>" +
            '<p class="message" style="margin-top:12px">示例：' +
            esc(summary.formula || "boss_commission = platform_fee × rate / 100") +
            "。Boss 分成只从平台抽成出，陪玩收入不变。</p>" +
            "</section>" +
            '<section class="panel"><h2>邀请看板 <span class="soft">待处理 ' +
            pendingInvites.length +
            "</span></h2>" +
            '<div class="invite-form">' +
            '<input id="bcrInviteCompanionId" placeholder="陪玩 profiles.id / 用户 ID" />' +
            '<input id="bcrInviteMessage" placeholder="邀请留言（可选）" />' +
            '<button type="button" class="ghost-btn" data-bcr-invite-send>发送邀请</button>' +
            "</div>" +
            '<p class="message" id="bcrInviteMsg" hidden></p>' +
            '<div class="list">' +
            inviteRows +
            "</div></section>" +
            '<section class="panel"><h2>直属分成明细</h2>' +
            '<p class="message">累计 ' +
            money(totalCommission) +
            " · 近 " +
            esc(summary.count || earnings.length || 0) +
            " 笔</p>" +
            '<div class="list">' +
            earningsRows +
            "</div></section>" +
            '<section class="panel"><h2>生效中（' +
            list.length +
            '）</h2><div class="list">' +
            companionRows +
            "</div></section>"
        );
      })
      .catch(function (err) {
        paint(
          '<section class="page-head"><h1>我的直属陪玩</h1></section>' +
            '<p class="message bad">' +
            esc(err.message || "读取失败") +
            "</p>"
        );
      });
  }

  document.addEventListener("click", function (e) {
    var logout = e.target.closest("[data-logout]");
    if (logout) {
      if (window.MCJBossAuth && typeof window.MCJBossAuth.clearSession === "function") {
        window.MCJBossAuth.clearSession();
      }
      location.href = "index.html";
      return;
    }
    var send = e.target.closest("[data-bcr-invite-send]");
    if (!send) return;
    e.preventDefault();
    var companionId = String((document.getElementById("bcrInviteCompanionId") || {}).value || "").trim();
    var message = String((document.getElementById("bcrInviteMessage") || {}).value || "").trim();
    var msg = document.getElementById("bcrInviteMsg");
    if (!companionId) {
      if (msg) {
        msg.hidden = false;
        msg.className = "message bad";
        msg.textContent = "请填写陪玩用户 ID";
      }
      return;
    }
    send.disabled = true;
    fetch("/api/boss/companion-invitations", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action: "invite", companionId: companionId, message: message }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "发送失败");
          return body;
        });
      })
      .then(function (body) {
        if (msg) {
          msg.hidden = false;
          msg.className = "message";
          msg.textContent = body.message || "邀请已发送";
        }
        load();
      })
      .catch(function (err) {
        if (msg) {
          msg.hidden = false;
          msg.className = "message bad";
          msg.textContent = err.message || "发送失败";
        }
      })
      .finally(function () {
        send.disabled = false;
      });
  });

  load();
})();
