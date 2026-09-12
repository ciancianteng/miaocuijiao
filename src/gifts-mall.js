/**
 * Boss gift mall — pick gift → pick recipient companion → confirm → send_gift.
 * Reuses POST /api/boss/marketplace action=send_gift (same ledger as profile gifts).
 */
(function () {
  "use strict";

  var state = {
    gifts: [],
    companions: [],
    selectedGift: null,
    selectedCompanion: null,
    companionsLoaded: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    if (typeof window.toast === "function") {
      window.toast(String(msg || ""));
      return;
    }
    var el = $("gmToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "gmToast";
      el.className = "gm-toast";
      el.hidden = true;
      document.body.appendChild(el);
    }
    el.textContent = String(msg || "");
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.hidden = true;
    }, 2600);
  }

  function authHeaders() {
    var h = { "Content-Type": "application/json", Accept: "application/json" };
    try {
      var t =
        localStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("customerAuthToken") ||
        "";
      if (t) h.Authorization = "Bearer " + t;
    } catch (_) {}
    return h;
  }

  function readBoss() {
    try {
      var raw = localStorage.getItem("mcjAuthUser");
      if (!raw) return null;
      var u = JSON.parse(raw);
      if (!u || String(u.role || "").toLowerCase() !== "boss") return null;
      return u;
    } catch (_) {
      return null;
    }
  }

  function requireBoss() {
    var u = readBoss();
    if (u) return u;
    toast("请先以老板身份登录");
    try {
      sessionStorage.setItem("mcjReturnTo", location.pathname + location.search);
    } catch (_) {}
    setTimeout(function () {
      location.href = "/login.html";
    }, 400);
    return null;
  }

  function idem() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    return "gm_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function giftEmoji(name) {
    var n = String(name || "");
    if (/鱼|小鱼/.test(n)) return "🐟";
    if (/罐头|猫罐头/.test(n)) return "🥫";
    if (/玫瑰|花/.test(n)) return "🌹";
    if (/钻石|钻/.test(n)) return "💎";
    if (/皇冠|冠/.test(n)) return "👑";
    if (/麦克|话筒/.test(n)) return "🎤";
    if (/火箭/.test(n)) return "🚀";
    return "🎁";
  }

  function giftPrice(g) {
    return Number(g.catFoodPrice != null ? g.catFoodPrice : g.price_catfood || 0);
  }

  function companionMeta(c) {
    var bits = [];
    if (c.game) bits.push(String(c.game));
    if (c.level || c.levelName) bits.push(String(c.level || c.levelName));
    if (!bits.length && c.specialty) bits.push(String(c.specialty));
    return bits.join(" · ") || "在线陪玩";
  }

  function setConfirmEnabled() {
    var btn = $("gmConfirmBtn");
    if (!btn) return;
    btn.disabled = !(state.selectedGift && state.selectedCompanion);
  }

  function updateSummary() {
    var line = $("gmConfirmLine");
    var hint = $("gmConfirmHint");
    if (!line) return;
    if (!state.selectedCompanion || !state.selectedGift) {
      line.innerHTML = "请选择一位陪玩";
      if (hint) hint.hidden = false;
      setConfirmEnabled();
      return;
    }
    line.innerHTML =
      "赠送给：<strong>" +
      escapeHtml(state.selectedCompanion.nickname || "陪玩") +
      "</strong><br>" +
      escapeHtml(state.selectedGift.name || "礼物") +
      " · " +
      giftPrice(state.selectedGift) +
      " 猫粮";
    if (hint) hint.hidden = true;
    setConfirmEnabled();
  }

  function showSuccess(tx, companion, gift) {
    var box = $("gmSuccess");
    if (!box) return;
    var nick = (companion && companion.nickname) || "陪玩";
    var gname = (gift && gift.name) || "礼物";
    var txId = (tx && (tx.id || tx.tx_no)) || "";
    var recv = (tx && tx.receiver_companion_id) || (companion && companion.id) || "";
    box.hidden = false;
    box.innerHTML =
      "<strong>赠送成功</strong>" +
      "<span>礼物：" +
      escapeHtml(gname) +
      " → " +
      escapeHtml(nick) +
      (recv ? "<br>recipient：" + escapeHtml(String(recv)) : "") +
      (txId ? "<br>tx：" + escapeHtml(String(txId)) : "") +
      "</span>";
  }

  function closeSheet() {
    var sheet = $("gmSheet");
    var backdrop = $("gmSheetBackdrop");
    if (sheet) sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("gm-sheet-open");
    state.selectedGift = null;
    state.selectedCompanion = null;
    updateSummary();
  }

  function openSheet(gift) {
    if (!requireBoss()) return;
    state.selectedGift = gift;
    state.selectedCompanion = null;
    var title = $("gmSheetTitle");
    if (title) title.textContent = "选择赠送对象";
    var sub = $("gmSheetGift");
    if (sub) {
      sub.textContent =
        (gift.name || "礼物") + " · " + giftPrice(gift) + " 猫粮";
    }
    var sheet = $("gmSheet");
    var backdrop = $("gmSheetBackdrop");
    if (sheet) sheet.hidden = false;
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add("gm-sheet-open");
    updateSummary();
    renderCompanions();
    if (!state.companionsLoaded) loadCompanions();
  }

  function renderGifts() {
    var grid = $("gmGiftGrid");
    if (!grid) return;
    if (!state.gifts.length) {
      grid.innerHTML = '<p class="gm-empty">暂无可赠送礼物</p>';
      return;
    }
    grid.innerHTML = state.gifts
      .map(function (g) {
        var id = encodeURIComponent(String(g.id || ""));
        var name = escapeHtml(g.name || "礼物");
        var price = giftPrice(g);
        var icon = g.iconUrl
          ? '<img class="gm-gift-icon" src="' +
            escapeHtml(g.iconUrl) +
            '" alt="" loading="lazy" />'
          : '<span class="gm-gift-emoji" aria-hidden="true">' +
            giftEmoji(g.name) +
            "</span>";
        return (
          '<article class="gm-gift-card">' +
          '<div class="gm-gift-visual">' +
          icon +
          "</div>" +
          "<h3>" +
          name +
          "</h3>" +
          '<p class="gm-gift-price"><strong>' +
          price +
          "</strong><span>猫粮</span></p>" +
          '<button type="button" class="gm-btn primary" data-mall-gift-id="' +
          id +
          '">赠送</button>' +
          "</article>"
        );
      })
      .join("");
  }

  function renderCompanions() {
    var list = $("gmCompanionList");
    if (!list) return;
    if (!state.companionsLoaded) {
      list.innerHTML = '<p class="gm-empty soft">加载陪玩名单…</p>';
      return;
    }
    if (!state.companions.length) {
      list.innerHTML = '<p class="gm-empty soft">暂无可选陪玩</p>';
      return;
    }
    var selId = state.selectedCompanion ? String(state.selectedCompanion.id) : "";
    list.innerHTML = state.companions
      .map(function (c) {
        var id = String(c.id || "");
        var nick = escapeHtml(c.nickname || "陪玩");
        var meta = escapeHtml(companionMeta(c));
        var av = escapeHtml(c.avatar_url || "");
        var selected = id === selId ? " is-selected" : "";
        var mark = id === selId ? "✓" : "";
        var avatar = av
          ? '<img class="gm-avatar" src="' + av + '" alt="" loading="lazy" />'
          : '<span class="gm-avatar" aria-hidden="true" style="display:grid;place-items:center;font-weight:800">' +
            nick.slice(0, 1) +
            "</span>";
        return (
          '<button type="button" class="gm-companion-row' +
          selected +
          '" data-pick-companion="' +
          encodeURIComponent(id) +
          '" aria-pressed="' +
          (id === selId ? "true" : "false") +
          '">' +
          avatar +
          '<span class="gm-companion-meta"><strong>' +
          nick +
          "</strong><em>" +
          meta +
          "</em></span>" +
          '<span class="gm-pick-mark" aria-hidden="true">' +
          mark +
          "</span>" +
          "</button>"
        );
      })
      .join("");
  }

  async function loadGifts() {
    var grid = $("gmGiftGrid");
    if (grid) grid.innerHTML = '<p class="gm-empty">加载礼物…</p>';
    try {
      var res = await fetch("/api/boss/marketplace?action=gift_catalog", {
        headers: authHeaders(),
        credentials: "same-origin",
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        throw new Error((data && data.message) || "load_failed");
      }
      state.gifts = Array.isArray(data.gifts) ? data.gifts : [];
      renderGifts();
    } catch (e) {
      if (grid) {
        grid.innerHTML =
          '<p class="gm-empty"><strong>礼物加载失败</strong>请刷新重试</p>';
      }
      toast("礼物加载失败");
    }
  }

  async function loadCompanions() {
    var list = $("gmCompanionList");
    if (list) list.innerHTML = '<p class="gm-empty soft">加载陪玩名单…</p>';
    try {
      var res = await fetch("/api/public/companions", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        throw new Error((data && data.message) || "load_failed");
      }
      state.companions = (Array.isArray(data.companions) ? data.companions : [])
        .filter(function (c) {
          return c && (c.id || c.uid) && (c.nickname || c.name);
        })
        .map(function (c) {
          return {
            id: String(c.id || c.uid),
            nickname: String(c.nickname || c.name || ""),
            avatar_url: c.avatar || c.avatar_url || "",
            game: c.game || c.mainGame || "",
            level: c.level || c.levelName || "",
            specialty: c.specialty || "",
          };
        });
      state.companionsLoaded = true;
      renderCompanions();
    } catch (e) {
      state.companionsLoaded = true;
      state.companions = [];
      if (list) {
        list.innerHTML =
          '<p class="gm-empty soft"><strong>陪玩名单加载失败</strong>请关闭后重试</p>';
      }
      toast("陪玩名单加载失败");
    }
  }

  async function confirmSend() {
    if (!state.selectedGift || !state.selectedCompanion) return;
    if (!requireBoss()) return;
    var btn = $("gmConfirmBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "赠送中…";
    }
    var gift = state.selectedGift;
    var companion = state.selectedCompanion;
    try {
      var res = await fetch("/api/boss/marketplace", {
        method: "POST",
        headers: authHeaders(),
        credentials: "same-origin",
        body: JSON.stringify({
          action: "send_gift",
          companionId: companion.id,
          giftId: gift.id,
          quantity: 1,
          idempotencyKey: idem(),
        }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        var code = String((data && data.code) || "");
        var msg = String((data && data.message) || "赠送失败");
        if (code === "INSUFFICIENT_BALANCE" || /余额不足|insufficient/i.test(msg)) {
          toast("猫粮不足");
          if (data.rechargeUrl && confirm("猫粮余额不足，是否去充值？")) {
            location.href = data.rechargeUrl;
          }
        } else if (/未授权|unauthorized|登录/i.test(msg)) {
          toast("请先登录");
        } else {
          toast(msg);
        }
        return;
      }
      closeSheet();
      showSuccess(data.transaction, companion, gift);
      toast("已赠送「" + (gift.name || "礼物") + "」给 " + (companion.nickname || "陪玩"));
    } catch (e) {
      toast("网络错误，请重试");
    } finally {
      if (btn) {
        btn.textContent = "确认赠送";
        setConfirmEnabled();
      }
    }
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var sendBtn = t.closest("[data-mall-gift-id]");
    if (sendBtn) {
      e.preventDefault();
      e.stopPropagation();
      var gid = decodeURIComponent(sendBtn.getAttribute("data-mall-gift-id") || "");
      var gift = state.gifts.find(function (g) {
        return String(g.id) === String(gid);
      });
      if (gift) openSheet(gift);
      return;
    }

    var pick = t.closest("[data-pick-companion]");
    if (pick) {
      e.preventDefault();
      var cid = decodeURIComponent(pick.getAttribute("data-pick-companion") || "");
      state.selectedCompanion =
        state.companions.find(function (c) {
          return String(c.id) === String(cid);
        }) || null;
      renderCompanions();
      updateSummary();
      return;
    }

    if (t.closest("[data-gm-close]")) {
      e.preventDefault();
      closeSheet();
      return;
    }

    if (t.closest("#gmConfirmBtn")) {
      e.preventDefault();
      confirmSend();
    }
  }

  function boot() {
    if (document.documentElement.getAttribute("data-gifts-mall") !== "1") {
      var root = document.querySelector('[data-gifts-mall="1"]');
      if (!root) return;
    }
    document.addEventListener("click", onClick, true);
    updateSummary();
    loadGifts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
