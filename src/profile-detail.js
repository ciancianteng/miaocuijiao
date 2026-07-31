(function () {
  "use strict";

  var state = {
    companion: null,
    catalog: null,
    draft: null,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatPlain(v);
    var n = Number(v || 0);
    return (Number.isFinite(n) ? n : 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function moneyRate(v, unit) {
    if (window.MCJCurrency) return window.MCJCurrency.formatRate(v, unit || "小时");
    return money(v).replace(/\s*猫粮$/, "") + " 猫粮/" + (unit || "小时");
  }
  function param() {
    var p = new URLSearchParams(location.search);
    return p.get("player") || p.get("id") || p.get("uid") || "";
  }
  function shell() {
    return document.querySelector(".profile-detail-shell");
  }
  function bottom() {
    return document.querySelector(".profile-bottom-bar");
  }
  function token() {
    return localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "";
  }
  function authHeaders() {
    var t = token();
    var h = { Accept: "application/json", "Content-Type": "application/json" };
    if (t) {
      h.Authorization = "Bearer " + t;
      h["x-mcj-access-token"] = t;
    }
    return h;
  }
  function statusClass(code) {
    code = String(code || "offline");
    if (code === "online" || /在线/.test(code)) return "is-online";
    if (code === "busy" || /忙碌/.test(code)) return "is-busy";
    if (code === "paused" || /暂停/.test(code)) return "is-paused";
    return "is-offline";
  }
  function statusHtml(c) {
    var code = c.availabilityStatus || "";
    var text = c.availabilityText || c.status || c.onlineStatus || "离线";
    if (!code) {
      if (/在线/.test(text)) code = "online";
      else if (/忙碌/.test(text)) code = "busy";
      else if (/暂停/.test(text)) code = "paused";
      else code = "offline";
    }
    return '<span class="mcj-status-dot ' + statusClass(code) + '"><i></i>' + esc(text) + "</span>";
  }
  function idem() {
    return "idem-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function renderLoading() {
    var s = shell();
    if (s) s.innerHTML = '<section class="detail-card"><h1>陪玩资料</h1><p>正在读取真实陪玩资料...</p></section>';
  }
  function renderError(msg, opts) {
    opts = opts || {};
    var s = shell();
    var retry =
      opts.retry !== false
        ? '<button type="button" class="order-now" data-profile-reload>重新加载</button>'
        : "";
    if (s)
      s.innerHTML =
        '<section class="detail-card"><h1>暂无资料</h1><p>' +
        esc(msg || "该陪玩资料不存在或已下架") +
        '</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">' +
        retry +
        '<a class="order-now" href="companion-center.html" style="opacity:.9">返回陪玩大厅</a></div></section>';
    var b = bottom();
    if (b) b.hidden = true;
  }

  function displayCurrency(text) {
    if (window.MCJCurrency && window.MCJCurrency.rewriteLegacy) {
      return window.MCJCurrency.rewriteLegacy(text);
    }
    return String(text == null ? "" : text).replace(/RM\s*/gi, "").replace(/(\d+(?:\.\d+)?)\s*[-–]\s*RM?\s*(\d+(?:\.\d+)?)/i, "$1–$2 猫粮");
  }
  function rankText(rank) {
    var n = Number(rank || 0);
    if (n > 0) return "第 " + n + " 名";
    return "暂无排名";
  }
  function metaRow(label, valueHtml) {
    return (
      '<div class="pd-meta-row"><span class="pd-meta-label">' +
      esc(label) +
      '</span><strong class="pd-meta-value">' +
      valueHtml +
      "</strong></div>"
    );
  }

  function render(c) {
    var s = shell();
    if (!s) return;
    if (window.MCJCompanionLevels && window.MCJCompanionLevels.normalizeCompanion) {
      c = window.MCJCompanionLevels.normalizeCompanion(c);
    }
    state.companion = c;
    var image =
      c.cardImageUrl || c.cover || c.avatar || "/default-avatar.png";
    if (!String(image).trim() || /meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(String(image))) {
      image = "/default-avatar.png";
    }
    var hasVoice = !!(c.voiceUrl && String(c.voiceUrl).trim());
    var voice = hasVoice
      ? '<div class="pd-voice-player"><audio controls preload="none" src="' +
        esc(c.voiceUrl) +
        '"></audio></div>'
      : '<p class="pd-voice-empty">该陪玩暂未上传语音</p>';
    var levelText = c.levelLabel || c.level || c.levelName || "-";
    var priceText = displayCurrency(
      (window.MCJCurrency && c.priceDisplay ? window.MCJCurrency.rewriteLegacy(c.priceDisplay) : "") ||
        moneyRate(c.priceValue || c.price, c.pricingUnit || "小时")
    );
    var rangeText = displayCurrency(
      c.levelRange ||
        (window.MCJCompanionLevels && window.MCJCompanionLevels.formatRange
          ? window.MCJCompanionLevels.formatRange(c.levelId || c)
          : "") ||
        "-"
    );
    if (!rangeText || rangeText === "-") rangeText = "暂无价格区间";
    var publicId = c.publicId || (c.companionUid ? "P" + c.companionUid : "");
    var tags = (c.tags || [])
      .slice(0, 6)
      .map(function (t) {
        return "<span>" + esc(t) + "</span>";
      })
      .join("");
    var pop = c.popularity || state.popularity || null;
    var weeklyRank = pop && pop.weekly ? pop.weekly.rank : 0;
    var monthlyRank = pop && pop.monthly ? pop.monthly.rank : 0;
    var popScore = (pop && pop.weekly && (pop.weekly.score || pop.weekly.popularityScore)) || 0;
    var popBadges = "";
    if (pop && pop.weekly) {
      var wr = Number(pop.weekly.rank || 0);
      if (wr === 1) popBadges += '<span class="pop-medal gold">冠军</span>';
      else if (wr === 2) popBadges += '<span class="pop-medal silver">亚军</span>';
      else if (wr === 3) popBadges += '<span class="pop-medal bronze">季军</span>';
      else if (wr > 0 && wr <= 10) popBadges += '<span class="pop-medal" style="background:rgba(255,150,200,.2);color:#ffd6e8">TOP ' + esc(wr) + "</span>";
      if (wr > 0 && wr <= 20) popBadges += '<span class="pop-medal" style="background:rgba(255,150,200,.12);color:#ffd0e4">热门陪玩</span>';
    }
    var statusText = c.availabilityText || c.status || c.onlineStatus || "离线";
    var giftActions = token()
      ? '<div class="pd-info-actions"><button type="button" class="mcj-secondary" data-open-gift>送礼物</button><button type="button" data-open-tip>打赏猫粮</button></div>'
      : "";

    s.setAttribute("data-companion-level", c.levelId || "");
    s.innerHTML =
      '<section class="profile-hero detail-card" data-companion-level="' +
      esc(c.levelId || "") +
      '"><div class="profile-avatar-wrap"><img class="profile-avatar" src="' +
      esc(image) +
      '" alt="' +
      esc(c.name) +
      ' 头像" onerror="this.onerror=null;this.src=\'/default-avatar.png\'">' +
      (popBadges ? '<div class="profile-pop-badges" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center">' + popBadges + "</div>" : "") +
      '</div><div class="profile-info-panel"><p class="detail-label">MEOW CUI JIAO COMPANION</p><h1>' +
      esc(c.name || c.nickname || "陪玩") +
      " " +
      statusHtml(c) +
      '</h1><div class="profile-id">ID：' +
      esc(publicId || "待生成") +
      '</div><p class="profile-bio">' +
      esc(c.desc || c.description || "暂无介绍") +
      '</p><div class="game-line">' +
      esc(c.game || "未设置游戏") +
      " · " +
      esc(priceText) +
      "</div>" +
      (tags ? '<div class="tag-row companion-tags" style="margin-top:10px">' + tags + "</div>" : "") +
      '</div></section><section class="detail-two-col pd-detail-split"><div class="detail-card info-card pd-info-card"><div class="section-head"><h2>基本资料</h2></div><div class="pd-meta-list">' +
      metaRow("游戏", esc(c.game || "综合游戏")) +
      metaRow(
        "等级",
        '<span class="companion-level-pill" data-level-id="' + esc(c.levelId || "") + '">' + esc(levelText) + "</span>"
      ) +
      metaRow("人气值", esc(popScore)) +
      metaRow("在线状态", statusHtml(c) || esc(statusText)) +
      metaRow("价格区间", esc(rangeText)) +
      metaRow("本周排名", esc(rankText(weeklyRank))) +
      metaRow("本月排名", esc(rankText(monthlyRank))) +
      '</div>' +
      giftActions +
      '</div><div class="detail-card price-card pd-voice-card' +
      (hasVoice ? "" : " is-empty") +
      '"><div class="section-head"><h2>语音试听</h2></div><div class="pd-voice-body">' +
      voice +
      '</div></div></section><section class="detail-card game-wall"><div class="section-head"><h2>卡面图片</h2></div><div class="wall-grid"><img src="' +
      esc(image) +
      '" alt="' +
      esc(c.name) +
      ' 卡面" onerror="this.onerror=null;this.src=\'/default-avatar.png\'"></div></section>';

    var b = bottom();
    if (b) {
      b.hidden = false;
      b.className = "profile-bottom-bar pd-bottom-bar";
      b.innerHTML =
        '<a class="pd-bottom-secondary" href="support.html?start=1">咨询客服</a>' +
        '<button type="button" class="order-now mcj-primary pd-bottom-primary" data-open-order>立即下单</button>';
    }
  }

  function closeSheet() {
    document.querySelectorAll(".mcj-sheet-mask").forEach(function (n) {
      n.remove();
    });
  }

  function openSheet(html) {
    closeSheet();
    var mask = document.createElement("div");
    mask.className = "mcj-sheet-mask";
    mask.innerHTML = '<div class="mcj-sheet" role="dialog">' + html + "</div>";
    document.body.appendChild(mask);
    mask.addEventListener("click", function (e) {
      if (e.target === mask) closeSheet();
    });
    return mask;
  }

  function loadCatalog() {
    var id = state.companion && (state.companion.id || state.companion.uid);
    return fetch("/api/boss/marketplace?action=catalog&companionId=" + encodeURIComponent(id), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "读取服务失败");
          return body;
        });
      })
      .then(function (body) {
        state.catalog = body;
        return body;
      });
  }

  function openOrderSheet() {
    var c = state.companion;
    if (!c) {
      alert("陪玩资料尚未加载完成");
      return;
    }
    if (!window.MCJPlaceOrder || typeof window.MCJPlaceOrder.openFromCompanion !== "function") {
      alert("下单组件未加载，请刷新页面后重试");
      return;
    }
    // Open immediately so 立即下单 never feels like a no-op; catalog upgrades price if它回来得及.
    try {
      window.MCJPlaceOrder.openFromCompanion(c, {
        companionId: c.id || c.uid,
        companionName: c.name || c.nickname,
        unitPrice: Number(c.priceValue != null ? c.priceValue : c.price) || 0,
        service: c.game || c.mainGame || "陪玩",
        avatar: c.avatar || c.cover || c.cardImageUrl || "",
        publicId: c.publicId || "",
        pricingUnit: c.pricingUnit || "小时",
      });
    } catch (err) {
      if (window.MCJPlaceOrder && window.MCJPlaceOrder.close) window.MCJPlaceOrder.close();
      alert((err && err.message) || "打开下单弹窗失败");
      return;
    }
    loadCatalog()
      .then(function (cat) {
        if (!document.querySelector(".mcj-po-mask")) return;
        if (window.MCJPlaceOrder && typeof window.MCJPlaceOrder.isSubmitting === "function" && window.MCJPlaceOrder.isSubmitting()) {
          return;
        }
        var catC = (cat && cat.companion) || {};
        var services = (cat && cat.services) || [];
        var selected = services[0] || null;
        var unitPrice = Number(
          (selected && selected.price) || catC.price || c.priceValue || c.price || 0
        );
        if (!(unitPrice > 0)) return;
        var serviceName =
          (selected && selected.name) || catC.game || c.game || c.mainGame || "陪玩";
        window.MCJPlaceOrder.openFromCompanion(c, {
          companionId: c.id || c.uid,
          companionName: catC.name || c.name || c.nickname,
          unitPrice: unitPrice,
          service: serviceName,
          avatar: catC.avatar || c.avatar,
          publicId: catC.publicId || c.publicId || "",
          pricingUnit: (selected && selected.pricingUnit) || catC.pricingUnit || c.pricingUnit || "小时",
        });
      })
      .catch(function () {});
  }

  function openGiftSheet() {
    loadCatalog()
      .then(function (cat) {
        var gifts = cat.gifts || [];
        if (!gifts.length) {
          alert("暂无上架礼物，请先在后台礼物管理配置");
          return;
        }
        var selected = gifts[0];
        var qty = 1;
        var rate = Number((cat.companion && cat.companion.giftCommissionRate) || 20);
        function paint() {
          var gross = Number(selected.catFoodPrice || 0) * qty;
          var fee = Math.round(gross * (rate / 100) * 100) / 100;
          var income = Math.round((gross - fee) * 100) / 100;
          openSheet(
            "<h3>送礼物</h3><div class=\"mcj-gift-grid\">" +
              gifts
                .map(function (g) {
                  return (
                    '<button type="button" class="mcj-gift-card' +
                    (g.id === selected.id ? " active" : "") +
                    '" data-gift="' +
                    esc(g.id) +
                    '"><div style="font-size:28px">🎁</div><strong>' +
                    esc(g.name) +
                    "</strong><span>" +
                    esc(g.catFoodPrice) +
                    " 猫粮</span></button>"
                  );
                })
                .join("") +
              '</div><div class="mcj-qty" style="margin-top:12px">数量 <button type="button" data-gqty="-">-</button><strong data-gqty-val>' +
              qty +
              '</strong><button type="button" data-gqty="+">+</button></div>' +
              "<p>总计 <strong>" +
              gross +
              "</strong> 猫粮 · 平台抽成 " +
              rate +
              "%（" +
              fee +
              "）· 陪玩所得 " +
              income +
              '</p><div class="mcj-actions"><button type="button" class="ghost" data-close-sheet>取消</button><button type="button" class="primary" data-send-gift>确认赠送</button></div>'
          );
          var sheet = document.querySelector(".mcj-sheet");
          sheet.querySelectorAll("[data-gift]").forEach(function (btn) {
            btn.onclick = function () {
              selected =
                gifts.find(function (g) {
                  return g.id === btn.getAttribute("data-gift");
                }) || selected;
              paint();
            };
          });
          sheet.querySelectorAll("[data-gqty]").forEach(function (btn) {
            btn.onclick = function () {
              qty = Math.max(1, qty + (btn.getAttribute("data-gqty") === "+" ? 1 : -1));
              paint();
            };
          });
          sheet.querySelector("[data-close-sheet]").onclick = closeSheet;
          sheet.querySelector("[data-send-gift]").onclick = function () {
            if (!token()) {
              alert("请先登录老板账号");
              location.href = "index.html";
              return;
            }
            fetch("/api/boss/marketplace", {
              method: "POST",
              headers: authHeaders(),
              body: JSON.stringify({
                action: "send_gift",
                companionId: state.companion.id || state.companion.uid,
                giftId: selected.id,
                quantity: qty,
                idempotencyKey: idem(),
              }),
            })
              .then(function (res) {
                return res.json().then(function (body) {
                  if (!res.ok || body.ok === false) throw Object.assign(new Error(body.message || "赠送失败"), body);
                  return body;
                });
              })
              .then(function (body) {
                alert(body.message || "礼物已送出");
                closeSheet();
              })
              .catch(function (err) {
                if (err.code === "INSUFFICIENT_BALANCE" || /余额不足/.test(err.message || "")) {
                  if (confirm("猫粮余额不足，是否去充值？")) location.href = err.rechargeUrl || "recharge.html";
                  return;
                }
                alert(err.message || "赠送失败");
              });
          };
        }
        paint();
      })
      .catch(function (err) {
        alert(err.message || "礼物加载失败");
      });
  }

  function openTipSheet() {
    loadCatalog().then(function (cat) {
      var rate = Number((cat.companion && cat.companion.giftCommissionRate) || 20);
      var amount = 50;
      openSheet(
        "<h3>打赏猫粮</h3><div class=\"mcj-spec-row\">" +
          [10, 20, 50, 100, 200]
            .map(function (n) {
              return '<button type="button" data-tip="' + n + '">' + n + "</button>";
            })
            .join("") +
          '</div><label>自定义数量<input type="number" min="1" data-tip-amount value="50"></label><label>留言<textarea data-tip-msg rows="2" placeholder="陪得很好，谢谢～"></textarea></label><p data-tip-preview></p><div class="mcj-actions"><button type="button" class="ghost" data-close-sheet>取消</button><button type="button" class="primary" data-send-tip>确认打赏</button></div>'
      );
      var sheet = document.querySelector(".mcj-sheet");
      function preview() {
        amount = Math.max(1, Number(sheet.querySelector("[data-tip-amount]").value || 0));
        var fee = Math.round(amount * (rate / 100) * 100) / 100;
        var income = Math.round((amount - fee) * 100) / 100;
        sheet.querySelector("[data-tip-preview]").textContent =
          "打赏 " + amount + " · 平台抽成 " + rate + "%（" + fee + "）· 陪玩所得 " + income;
      }
      preview();
      sheet.querySelectorAll("[data-tip]").forEach(function (btn) {
        btn.onclick = function () {
          sheet.querySelector("[data-tip-amount]").value = btn.getAttribute("data-tip");
          preview();
        };
      });
      sheet.querySelector("[data-tip-amount]").oninput = preview;
      sheet.querySelector("[data-close-sheet]").onclick = closeSheet;
      sheet.querySelector("[data-send-tip]").onclick = function () {
        if (!token()) {
          alert("请先登录老板账号");
          location.href = "index.html";
          return;
        }
        preview();
        fetch("/api/boss/marketplace", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            action: "send_tip",
            companionId: state.companion.id || state.companion.uid,
            amount: amount,
            message: sheet.querySelector("[data-tip-msg]").value || "",
            idempotencyKey: idem(),
          }),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              if (!res.ok || body.ok === false) throw Object.assign(new Error(body.message || "打赏失败"), body);
              return body;
            });
          })
          .then(function (body) {
            alert(body.message || "打赏成功");
            closeSheet();
          })
          .catch(function (err) {
            if (err.code === "INSUFFICIENT_BALANCE" || /余额不足/.test(err.message || "")) {
              if (confirm("猫粮余额不足，是否去充值？")) location.href = err.rechargeUrl || "recharge.html";
              return;
            }
            alert(err.message || "打赏失败");
          });
      };
    });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-profile-reload]")) {
      e.preventDefault();
      load();
      return;
    }
    if (e.target.closest("[data-open-order]")) {
      e.preventDefault();
      openOrderSheet();
      return;
    }
    if (e.target.closest("[data-open-gift]")) {
      e.preventDefault();
      openGiftSheet();
      return;
    }
    if (e.target.closest("[data-open-tip]")) {
      e.preventDefault();
      openTipSheet();
      return;
    }
    if (e.target.closest("[data-fav]")) {
      alert("已记录收藏意向（收藏列表将同步真实陪玩 ID）");
    }
  });

  function load() {
    var id = param();
    if (!id) {
      renderError("缺少陪玩 ID");
      return;
    }
    renderLoading();
    var settled = false;
    var failSafe = setTimeout(function () {
      if (settled) return;
      settled = true;
      renderError("陪玩资料读取超时，请点击重新加载");
    }, 12000);
    fetch("/api/public/companions?id=" + encodeURIComponent(id), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "陪玩资料读取失败");
          return body;
        });
      })
      .then(function (body) {
        var c = (body.companions || [])[0];
        if (!c) {
          if (!settled) {
            settled = true;
            clearTimeout(failSafe);
            renderError("该陪玩资料不存在或已下架", { retry: false });
          }
          return;
        }
        if (!settled) {
          settled = true;
          clearTimeout(failSafe);
          render(c);
        }
        var cid = c.id || c.uid || id;
        var popCtl = typeof AbortController !== "undefined" ? new AbortController() : null;
        var popTimer = setTimeout(function () {
          if (popCtl) popCtl.abort();
        }, 4000);
        fetch("/api/popularity?action=companion&id=" + encodeURIComponent(cid), {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: popCtl ? popCtl.signal : undefined,
        })
          .then(function (res) {
            return res.json().catch(function () {
              return {};
            });
          })
          .then(function (pop) {
            clearTimeout(popTimer);
            state.popularity = pop && pop.ok ? pop : null;
            c.popularity = state.popularity;
            if (state.companion && (state.companion.id === c.id || state.companion.uid === c.uid)) {
              render(c);
            }
          })
          .catch(function () {
            clearTimeout(popTimer);
          });
      })
      .catch(function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(failSafe);
        renderError(err.message || "陪玩资料读取失败");
      });
  }

  load();
  (function maybeAutoOpenOrder() {
    var q = new URLSearchParams(location.search);
    if (q.get("open_order") !== "1" && q.get("order") !== "1") return;
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (state.companion) {
        clearInterval(timer);
        openOrderSheet();
        return;
      }
      if (tries > 80) clearInterval(timer);
    }, 150);
  })();
  if (window.MCJBossHeader && typeof window.MCJBossHeader.sync === "function") {
    window.MCJBossHeader.sync();
  } else {
    document.body.classList.toggle(
      "is-logged-in",
      !!(
        localStorage.getItem("mcjAuthAccessToken") ||
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("customerAuthToken") ||
        sessionStorage.getItem("customerAuthToken")
      )
    );
  }
})();
