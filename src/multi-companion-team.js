/**
 * Multi-companion team bar + checkout (Option 2).
 * Does NOT replace single-companion MCJPlaceOrder / place_order.
 */
(function () {
  "use strict";

  var MAX_TEAM = 4; // product default; backend allows up to 20
  var STORAGE_KEY = "mcjMultiTeamSelection";
  var DEFAULT_AVATAR =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#2a1a30"/><circle cx="40" cy="32" r="14" fill="#f3a8cb"/><ellipse cx="40" cy="62" rx="22" ry="16" fill="#f3a8cb"/></svg>'
    );

  var state = {
    lines: [],
    expanded: false,
    sheetOpen: false,
    submitting: false,
    sharedGameId: "",
    sharedNotes: "",
    paymentMethod: "catfood",
    pendingIdempotencyKey: "",
  };

  function money(v) {
    var n = Number(String(v == null ? "" : v).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function looksLikeJwt(t) {
    return typeof t === "string" && t.split(".").length === 3 && t.length > 20;
  }

  function token() {
    var candidates = [
      sessionStorage.getItem("mcjAuthAccessToken"),
      localStorage.getItem("mcjAuthAccessToken"),
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (looksLikeJwt(candidates[i])) return candidates[i];
    }
    return "";
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

  function bossKey() {
    try {
      var u = JSON.parse(
        localStorage.getItem("customerUser") || sessionStorage.getItem("customerUser") || "{}"
      );
      return String(u.id || u.uid || u.email || "anon");
    } catch (e) {
      return "anon";
    }
  }

  function toast(msg) {
    if (window.MCJPlaceOrder && typeof window.MCJToast === "function") {
      /* fall through */
    }
    var text = String(msg || "").trim();
    if (!text) return;
    var el = document.querySelector("[data-mcj-team-toast]");
    if (!el) {
      el = document.createElement("div");
      el.className = "mcj-team-toast";
      el.setAttribute("data-mcj-team-toast", "1");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.classList.remove("show");
    }, 2800);
  }

  function ensureCss() {
    if (document.querySelector('link[data-mcj-team-css]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "src/multi-companion-team.css?v=20260919team2";
    link.setAttribute("data-mcj-team-css", "1");
    document.head.appendChild(link);
  }

  function lineSubtotal(line) {
    var hours = Math.max(0.5, money(line.hours || 1));
    var qty = Math.max(1, Math.floor(money(line.quantity || 1) || 1));
    var unit = money(line.unitPrice);
    return Math.round(unit * hours * qty * 100) / 100;
  }

  function groupTotal() {
    return Math.round(
      state.lines.reduce(function (n, l) {
        return n + lineSubtotal(l);
      }, 0) * 100
    ) / 100;
  }

  function persist() {
    try {
      var payload = {
        bossKey: bossKey(),
        lines: state.lines.map(function (l) {
          return {
            companionId: l.companionId,
            companionName: l.companionName,
            avatar: l.avatar || "",
            unitPrice: money(l.unitPrice),
            service: l.service || "",
            serviceType: l.serviceType || l.service || "",
            game: l.game || l.service || "",
            hours: money(l.hours || 1),
            quantity: Math.max(1, Math.floor(money(l.quantity || 1) || 1)),
            services: Array.isArray(l.services) ? l.services : [],
            online: !!l.online,
          };
        }),
        sharedGameId: state.sharedGameId || "",
        sharedNotes: state.sharedNotes || "",
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {}
  }

  function restore() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || data.bossKey !== bossKey()) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      state.lines = Array.isArray(data.lines) ? data.lines : [];
      state.sharedGameId = data.sharedGameId || "";
      state.sharedNotes = data.sharedNotes || "";
    } catch (e) {
      state.lines = [];
    }
  }

  function clearTeam() {
    state.lines = [];
    state.sharedGameId = "";
    state.sharedNotes = "";
    state.expanded = false;
    state.pendingIdempotencyKey = "";
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    renderBar();
    closeSheet();
  }

  function findLine(companionId) {
    var id = String(companionId || "");
    return state.lines.find(function (l) {
      return String(l.companionId) === id;
    });
  }

  function resolveServicesFor(companion) {
    if (window.MCJPlaceOrder && typeof window.MCJPlaceOrder.resolveServices === "function") {
      try {
        return window.MCJPlaceOrder.resolveServices(companion) || [];
      } catch (e) {}
    }
    var name = companion.service || companion.game || "陪玩";
    return [{ name: name, price: money(companion.unitPrice || companion.price) }];
  }

  function isUnavailable(payload) {
    var st = String(payload.status || payload.availabilityStatus || payload.online || "").toLowerCase();
    var text = String(payload.statusText || payload.availabilityText || "").toLowerCase();
    if (/offline|离线|休息|不可接|unavailable|busy/.test(st + " " + text)) return true;
    if (payload.online === false || payload.online === "0" || payload.online === "false") return true;
    return false;
  }

  function addCompanion(raw) {
    ensureCss();
    var companionId = String(
      (raw && (raw.companionId || raw.companion_id || raw.id || raw.uid)) || ""
    ).trim();
    if (!companionId) {
      toast("缺少陪玩信息");
      return { ok: false, error: "missing_id" };
    }
    if (findLine(companionId)) {
      toast("该陪玩已在一起下单列表中");
      return { ok: false, error: "duplicate" };
    }
    if (state.lines.length >= MAX_TEAM) {
      toast("一起下单最多 " + MAX_TEAM + " 位陪玩");
      return { ok: false, error: "max" };
    }
    if (isUnavailable(raw || {})) {
      toast("该陪玩当前不可接单");
      return { ok: false, error: "unavailable" };
    }
    var unitPrice = money(raw.unitPrice || raw.priceValue || raw.price || raw.price_value);
    if (!(unitPrice > 0)) {
      toast("该陪玩暂无有效单价，无法加入");
      return { ok: false, error: "no_price" };
    }
    var companion = {
      companionId: companionId,
      companionName: raw.companionName || raw.name || raw.nickname || "陪玩",
      avatar: raw.avatar || raw.image || "",
      unitPrice: unitPrice,
      service: raw.service || raw.game || "陪玩",
      game: raw.game || raw.service || "陪玩",
      services: raw.services,
      online: raw.online !== false,
    };
    var services = resolveServicesFor(companion);
    if (!services.length) {
      toast("该陪玩暂无可下单服务项目");
      return { ok: false, error: "no_service" };
    }
    var preferService = String(raw.service || raw.serviceType || raw.game || "").trim();
    var first =
      (preferService &&
        services.find(function (s) {
          return String(s.name) === preferService;
        })) ||
      services[0];
    var lineUnit = money(raw.unitPrice || first.price || unitPrice) || unitPrice;
    var line = {
      companionId: companionId,
      companionName: companion.companionName,
      avatar: companion.avatar,
      unitPrice: lineUnit,
      service: first.name || companion.service,
      serviceType: first.name || companion.service,
      game: first.name || companion.game,
      hours: Math.max(0.5, money(raw.hours || 1) || 1),
      quantity: Math.max(1, Math.floor(money(raw.quantity || 1) || 1)),
      services: services,
      online: companion.online,
    };
    state.lines.push(line);
    persist();
    renderBar();
    toast(state.lines.length === 1 ? "已加入队伍，可继续选陪玩" : "已加入一起下单");
    return { ok: true, count: state.lines.length };
  }

  function removeCompanion(companionId) {
    state.lines = state.lines.filter(function (l) {
      return String(l.companionId) !== String(companionId);
    });
    persist();
    renderBar();
    if (state.lines.length < 2) closeSheet();
    else if (state.sheetOpen) paintSheet();
  }

  function updateLine(companionId, patch) {
    var line = findLine(companionId);
    if (!line) return;
    Object.keys(patch || {}).forEach(function (k) {
      line[k] = patch[k];
    });
    if (patch.service || patch.serviceType) {
      var name = patch.service || patch.serviceType;
      var hit = (line.services || []).find(function (s) {
        return s.name === name;
      });
      if (hit && money(hit.price) > 0) line.unitPrice = money(hit.price);
      line.service = name;
      line.serviceType = name;
      line.game = name;
    }
    persist();
    renderBar();
    if (state.sheetOpen) paintSheetTotals();
  }

  function avatarStackHtml() {
    var lines = state.lines;
    var show = lines.slice(0, 3);
    var extra = lines.length - show.length;
    var html = show
      .map(function (l) {
        return (
          '<img class="mcj-team-avatar" src="' +
          esc(l.avatar || DEFAULT_AVATAR) +
          '" alt="" onerror="this.onerror=null;this.src=\'' +
          DEFAULT_AVATAR +
          '\'">'
        );
      })
      .join("");
    if (extra > 0) {
      html += '<span class="mcj-team-avatar-more">+' + extra + "</span>";
    }
    return html;
  }

  function renderBar() {
    ensureCss();
    var bar = document.querySelector("[data-mcj-team-bar]");
    if (!state.lines.length) {
      if (bar) bar.remove();
      document.documentElement.classList.remove("mcj-team-bar-on");
      return;
    }
    document.documentElement.classList.add("mcj-team-bar-on");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "mcj-team-bar";
      bar.setAttribute("data-mcj-team-bar", "1");
      document.body.appendChild(bar);
    }
    var n = state.lines.length;
    var total = groupTotal();
    var secondaryLabel = n >= 2 ? "查看队伍" : "继续选";
    var secondaryAttr = n >= 2 ? "data-mcj-team-expand" : "data-mcj-team-continue";
    bar.innerHTML =
      '<div class="mcj-team-avatars">' +
      avatarStackHtml() +
      "</div>" +
      '<div class="mcj-team-meta">' +
      "<strong>已选 " +
      n +
      " 人 · " +
      esc(String(total)) +
      "猫粮</strong>" +
      "<span>" +
      (n >= 2 ? "一次付款，分别结算" : "可继续选陪玩，或去结算（单人走普通下单）") +
      "</span>" +
      "</div>" +
      '<div class="mcj-team-bar-actions">' +
      '<button type="button" class="mcj-team-secondary" ' +
      secondaryAttr +
      ' aria-expanded="' +
      (state.expanded ? "true" : "false") +
      '">' +
      secondaryLabel +
      "</button>" +
      '<button type="button" class="mcj-team-checkout" data-mcj-team-checkout>去结算</button>' +
      "</div>";
    if (state.expanded && n >= 2) {
      bar.classList.add("is-expanded");
      var panel = document.createElement("div");
      panel.className = "mcj-team-bar-panel";
      panel.innerHTML = state.lines
        .map(function (l) {
          return (
            '<div class="mcj-team-bar-row">' +
            '<img src="' +
            esc(l.avatar || DEFAULT_AVATAR) +
            '" alt="">' +
            "<span>" +
            esc(l.companionName) +
            " · " +
            esc(l.service || "") +
            "</span>" +
            "<em>" +
            esc(String(lineSubtotal(l))) +
            "</em>" +
            '<button type="button" data-mcj-team-remove="' +
            esc(l.companionId) +
            '" aria-label="移除">×</button>' +
            "</div>"
          );
        })
        .join("");
      bar.appendChild(panel);
    } else {
      bar.classList.remove("is-expanded");
    }
  }

  function closeSheet() {
    state.sheetOpen = false;
    var mask = document.querySelector("[data-mcj-team-sheet]");
    if (mask) mask.remove();
  }

  function paintSheetTotals() {
    var total = groupTotal();
    var el = document.querySelector("[data-mcj-team-sheet-total]");
    if (el) el.textContent = String(total) + " 猫粮";
    var btn = document.querySelector("[data-mcj-team-submit]");
    if (btn) {
      var ok = state.lines.length >= 2;
      btn.disabled = !ok || state.submitting;
      btn.textContent = state.submitting ? "提交中…" : "确认并支付 " + total + "猫粮";
    }
  }

  function paintSheet() {
    ensureCss();
    var mask = document.querySelector("[data-mcj-team-sheet]");
    if (!mask) {
      mask = document.createElement("div");
      mask.className = "mcj-team-sheet-mask";
      mask.setAttribute("data-mcj-team-sheet", "1");
      document.body.appendChild(mask);
    }
    state.sheetOpen = true;
    var rows = state.lines
      .map(function (l) {
        var services = l.services && l.services.length ? l.services : [{ name: l.service, price: l.unitPrice }];
        var chips = services
          .map(function (s) {
            var active = s.name === l.service;
            return (
              '<button type="button" class="mcj-team-chip' +
              (active ? " active" : "") +
              '" data-mcj-team-svc="' +
              esc(l.companionId) +
              '" data-svc="' +
              esc(s.name) +
              '">' +
              esc(s.name) +
              "</button>"
            );
          })
          .join("");
        var hourOpts = [
          { id: "1", label: "1小时", h: 1 },
          { id: "2", label: "2小时", h: 2 },
          { id: "3", label: "3小时", h: 3 },
        ];
        var hours = hourOpts
          .map(function (h) {
            var active = money(l.hours) === h.h;
            return (
              '<button type="button" class="mcj-team-chip' +
              (active ? " active" : "") +
              '" data-mcj-team-hours="' +
              esc(l.companionId) +
              '" data-hours="' +
              h.h +
              '">' +
              h.label +
              "</button>"
            );
          })
          .join("");
        return (
          '<article class="mcj-team-line" data-line="' +
          esc(l.companionId) +
          '">' +
          '<div class="mcj-team-line-head">' +
          '<img src="' +
          esc(l.avatar || DEFAULT_AVATAR) +
          '" alt="">' +
          "<div><strong>" +
          esc(l.companionName) +
          "</strong><span>单价 " +
          esc(String(l.unitPrice)) +
          " · 小计 <em data-line-sub>" +
          esc(String(lineSubtotal(l))) +
          "</em></span></div>" +
          '<button type="button" class="mcj-team-remove" data-mcj-team-remove="' +
          esc(l.companionId) +
          '">移除</button>' +
          "</div>" +
          '<div class="mcj-team-field"><span>游戏/服务</span><div class="mcj-team-chips">' +
          chips +
          "</div></div>" +
          '<div class="mcj-team-field"><span>时长</span><div class="mcj-team-chips">' +
          hours +
          "</div></div>" +
          '<div class="mcj-team-field"><span>数量</span><input type="number" min="1" step="1" value="' +
          esc(String(l.quantity || 1)) +
          '" data-mcj-team-qty="' +
          esc(l.companionId) +
          '"></div>' +
          "</article>"
        );
      })
      .join("");

    var total = groupTotal();
    var summaryRows = state.lines
      .map(function (l, idx) {
        return (
          '<div class="mcj-team-summary-row">' +
          "<span>陪玩" +
          (idx + 1) +
          " · " +
          esc(l.companionName) +
          "</span>" +
          "<span>服务：" +
          esc(l.service || "-") +
          "</span>" +
          "<strong>小计：" +
          esc(String(lineSubtotal(l))) +
          "猫粮</strong>" +
          "</div>"
        );
      })
      .join("");
    mask.innerHTML =
      '<div class="mcj-team-sheet" role="dialog" aria-modal="true" aria-label="多人一起下单">' +
      '<div class="mcj-team-sheet-head">' +
      "<h3>多人一起下单</h3>" +
      '<button type="button" class="mcj-team-sheet-close" data-mcj-team-sheet-close aria-label="关闭">×</button>' +
      "</div>" +
      '<div class="mcj-team-sheet-scroll">' +
      '<div class="mcj-team-summary">' +
      summaryRows +
      "</div>" +
      rows +
      '<div class="mcj-team-field"><span>游戏 ID（共用）</span><input type="text" data-mcj-team-game-id value="' +
      esc(state.sharedGameId) +
      '" placeholder="请填写游戏 ID"></div>' +
      '<div class="mcj-team-field"><span>备注（可选）</span><input type="text" data-mcj-team-notes value="' +
      esc(state.sharedNotes) +
      '" placeholder="给整组订单的备注"></div>' +
      '<p class="mcj-team-pay-hint">本订单一次付款，系统会分别为每位陪玩结算。</p>' +
      "</div>" +
      '<div class="mcj-team-sheet-foot">' +
      '<div class="mcj-team-sheet-total">合计 <strong data-mcj-team-sheet-total>' +
      esc(String(total)) +
      " 猫粮</strong></div>" +
      '<button type="button" class="mcj-team-submit" data-mcj-team-submit' +
      (state.lines.length < 2 ? " disabled" : "") +
      ">确认并支付 " +
      esc(String(total)) +
      "猫粮</button>" +
      "</div></div>";
  }

  function openSingleLegacyFromTeam() {
    if (state.lines.length !== 1) return false;
    var line = state.lines[0];
    if (!window.MCJPlaceOrder || typeof window.MCJPlaceOrder.open !== "function") {
      toast("请使用「立即下单」完成单人订单");
      return false;
    }
    window.MCJPlaceOrder.open({
      companionId: line.companionId,
      companionName: line.companionName,
      avatar: line.avatar,
      unitPrice: line.unitPrice,
      price: line.unitPrice,
      service: line.service,
      game: line.game || line.service,
      services: line.services,
      online: line.online !== false,
    });
    return true;
  }

  function openCheckout() {
    if (!state.lines.length) {
      toast("请先加入陪玩");
      return;
    }
    if (state.lines.length < 2) {
      // Prefer legacy single place_order when only one companion remains.
      if (openSingleLegacyFromTeam()) return;
      toast("多人下单至少选择 2 位陪玩");
      return;
    }
    paintSheet();
  }

  function parseApiJson(res) {
    return res.json().then(function (body) {
      if (!res.ok || body.ok === false) {
        var err = new Error(body.message || "请求失败");
        err.code = body.code || "";
        err.body = body;
        err.status = res.status;
        throw err;
      }
      return body;
    });
  }

  function ensureIdempotencyKey() {
    if (state.pendingIdempotencyKey) return state.pendingIdempotencyKey;
    state.pendingIdempotencyKey =
      "pom-" +
      bossKey().slice(0, 8) +
      "-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 8);
    return state.pendingIdempotencyKey;
  }

  function buildPayload() {
    return {
      action: "place_multi_order",
      paymentMethod: "catfood",
      gameId: String(state.sharedGameId || "").trim(),
      notes: String(state.sharedNotes || "").trim(),
      idempotencyKey: ensureIdempotencyKey(),
      companions: state.lines.map(function (l) {
        var hours = Math.max(0.5, money(l.hours || 1));
        var quantity = Math.max(1, Math.floor(money(l.quantity || 1) || 1));
        var unitPrice = money(l.unitPrice);
        var totalAmount = Math.round(unitPrice * hours * quantity * 100) / 100;
        return {
          companionId: l.companionId,
          companionName: l.companionName,
          serviceType: l.serviceType || l.service,
          serviceName: l.serviceType || l.service,
          game: l.game || l.service,
          gameId: String(state.sharedGameId || "").trim(),
          hours: hours,
          quantity: quantity,
          unitPrice: unitPrice,
          totalAmount: totalAmount,
        };
      }),
    };
  }

  function submitTeam() {
    if (state.submitting) return;
    if (state.lines.length < 2) {
      toast("多人下单至少选择 2 位陪玩");
      return;
    }
    var gameIdEl = document.querySelector("[data-mcj-team-game-id]");
    if (gameIdEl) state.sharedGameId = String(gameIdEl.value || "").trim();
    var notesEl = document.querySelector("[data-mcj-team-notes]");
    if (notesEl) state.sharedNotes = String(notesEl.value || "").trim();
    if (!state.sharedGameId) {
      toast("请填写游戏 ID");
      return;
    }
    if (!token()) {
      toast("请先登录老板账号");
      return;
    }
    var payload = buildPayload();
    // Guard: never loop place_order
    if (payload.action !== "place_multi_order") {
      toast("提交配置错误");
      return;
    }
    state.submitting = true;
    paintSheetTotals();
    fetch("/api/orders", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    })
      .then(parseApiJson)
      .then(function (body) {
        var parent = body.parent || body.order || {};
        var oid = parent.id || "";
        var kids = Array.isArray(body.children) ? body.children : [];
        state.pendingIdempotencyKey = "";
        clearTeam();
        toast("多人订单创建成功");
        if (oid) {
          try {
            var list = [];
            try {
              list = JSON.parse(localStorage.getItem("mcjBossOrdersCache") || "[]");
              if (!Array.isArray(list)) list = [];
            } catch (e1) {
              list = [];
            }
            var row = Object.assign({}, parent, {
              isMultiGroupParent: true,
              children: kids,
            });
            // Cache parent + children so list can hide child cards and still render peer names.
            var childIds = {};
            kids.forEach(function (ch) {
              if (ch && ch.id) childIds[String(ch.id)] = true;
            });
            list = [row]
              .concat(kids)
              .concat(
                list.filter(function (x) {
                  var xid = String(x && x.id);
                  return xid !== String(oid) && !childIds[xid];
                })
              );
            localStorage.setItem("mcjBossOrdersCache", JSON.stringify(list.slice(0, 80)));
          } catch (e2) {}
          location.href = "orders.html?id=" + encodeURIComponent(oid);
          return;
        }
        location.href = "orders.html";
      })
      .catch(function (err) {
        state.submitting = false;
        // Keep pendingIdempotencyKey so duplicate click retries are safe.
        paintSheetTotals();
        toast(err.message || "多人下单失败");
      });
  }

  function onDocClick(e) {
    var addBtn = e.target.closest("[data-hall-team-add]");
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      addCompanion({
        companionId: addBtn.getAttribute("data-hall-team-add") || "",
        companionName: addBtn.getAttribute("data-hall-name") || "陪玩",
        unitPrice: Number(addBtn.getAttribute("data-hall-price") || 0),
        avatar: addBtn.getAttribute("data-hall-avatar") || "",
        game: addBtn.getAttribute("data-hall-game") || "陪玩",
        service: addBtn.getAttribute("data-hall-game") || "陪玩",
        status: addBtn.getAttribute("data-hall-status") || "",
        statusText: addBtn.getAttribute("data-hall-status-text") || "",
        online: addBtn.getAttribute("data-hall-online"),
      });
      return;
    }
    if (e.target.closest("[data-mcj-team-checkout]")) {
      e.preventDefault();
      openCheckout();
      return;
    }
    if (e.target.closest("[data-mcj-team-continue]")) {
      e.preventDefault();
      state.expanded = false;
      renderBar();
      toast("继续浏览陪玩大厅，再选一位");
      return;
    }
    if (e.target.closest("[data-mcj-team-expand]")) {
      e.preventDefault();
      state.expanded = !state.expanded;
      renderBar();
      return;
    }
    var rm = e.target.closest("[data-mcj-team-remove]");
    if (rm) {
      e.preventDefault();
      removeCompanion(rm.getAttribute("data-mcj-team-remove"));
      return;
    }
    if (e.target.closest("[data-mcj-team-sheet-close]") || e.target.matches("[data-mcj-team-sheet]")) {
      if (e.target.matches("[data-mcj-team-sheet]") || e.target.closest("[data-mcj-team-sheet-close]")) {
        closeSheet();
      }
      return;
    }
    var svc = e.target.closest("[data-mcj-team-svc]");
    if (svc) {
      updateLine(svc.getAttribute("data-mcj-team-svc"), {
        service: svc.getAttribute("data-svc"),
        serviceType: svc.getAttribute("data-svc"),
      });
      paintSheet();
      return;
    }
    var hr = e.target.closest("[data-mcj-team-hours]");
    if (hr) {
      updateLine(hr.getAttribute("data-mcj-team-hours"), {
        hours: Number(hr.getAttribute("data-hours") || 1),
      });
      paintSheet();
      return;
    }
    if (e.target.closest("[data-mcj-team-submit]")) {
      e.preventDefault();
      submitTeam();
    }
  }

  function onDocInput(e) {
    var qty = e.target.closest("[data-mcj-team-qty]");
    if (qty) {
      updateLine(qty.getAttribute("data-mcj-team-qty"), {
        quantity: Math.max(1, Math.floor(Number(qty.value) || 1)),
      });
      var article = qty.closest("[data-line]");
      if (article) {
        var sub = article.querySelector("[data-line-sub]");
        var line = findLine(qty.getAttribute("data-mcj-team-qty"));
        if (sub && line) sub.textContent = String(lineSubtotal(line));
      }
      paintSheetTotals();
    }
    if (e.target.matches("[data-mcj-team-game-id]")) {
      state.sharedGameId = String(e.target.value || "").trim();
      persist();
    }
    if (e.target.matches("[data-mcj-team-notes]")) {
      state.sharedNotes = String(e.target.value || "");
      persist();
    }
  }

  function onStorage() {
    /* ignore */
  }

  function onAuthMaybeChanged() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && data.bossKey !== bossKey()) clearTeam();
    } catch (e) {}
  }

  ensureCss();
  restore();
  renderBar();
  document.addEventListener("click", onDocClick, true);
  document.addEventListener("input", onDocInput, true);
  window.addEventListener("storage", onStorage);
  window.addEventListener("mcj-auth-changed", onAuthMaybeChanged);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) onAuthMaybeChanged();
  });

  window.MCJMultiCompanionTeam = {
    add: addCompanion,
    remove: removeCompanion,
    clear: clearTeam,
    openCheckout: openCheckout,
    getLines: function () {
      return state.lines.slice();
    },
    getTotal: groupTotal,
    getCount: function () {
      return state.lines.length;
    },
    MAX_TEAM: MAX_TEAM,
    buildPayload: buildPayload,
    _test: {
      lineSubtotal: lineSubtotal,
      isUnavailable: isUnavailable,
      findLine: findLine,
      state: state,
    },
  };
})();
