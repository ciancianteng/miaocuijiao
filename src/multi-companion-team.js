/**
 * Multi-companion team bar + checkout (Option 2).
 * Does NOT replace single-companion MCJPlaceOrder / place_order.
 */
(function () {
  "use strict";

  var MAX_TEAM = 4; // product default; backend allows up to 20
  var STORAGE_KEY = "mcjMultiTeamSelection";
  var PICKING_KEY = "mcjMultiTeamPicking";
  var HALL_HREF = "/companion-center.html";
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
    sharedStartTime: "",
    sharedVoiceMode: "game_mic",
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
    link.href = "/src/multi-companion-team.css?v=20260920multiMobileP0";
    link.setAttribute("data-mcj-team-css", "1");
    document.head.appendChild(link);
  }

  function lineSubtotal(line) {
    var hours = Math.max(0.5, money(line.hours || 1));
    var qty = Math.max(1, Math.floor(money(line.quantity || 1) || 1));
    var unit = money(line.unitPrice);
    return Math.round(unit * hours * qty * 100) / 100;
  }

  function lineDurationHours(line) {
    var hours = Math.max(0.5, money(line.hours || 1));
    var qty = Math.max(1, Math.floor(money(line.quantity || 1) || 1));
    return Math.round(hours * qty * 100) / 100;
  }

  function maxTeamDurationHours() {
    if (!state.lines.length) return 1;
    return state.lines.reduce(function (max, line) {
      return Math.max(max, lineDurationHours(line));
    }, 0.5);
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function defaultStartTime() {
    var d = new Date();
    d.setSeconds(0, 0);
    d.setMinutes(0);
    d.setHours(d.getHours() + 1);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function normalizeTimeValue(v) {
    if (window.MCJTimePicker && typeof window.MCJTimePicker.normalize === "function") {
      return window.MCJTimePicker.normalize(v);
    }
    var raw = String(v || "").trim();
    var ampm = raw.match(/\b(am|pm)\b/i);
    var m = raw.match(/(\d{1,2})\s*[:：.]\s*(\d{1,2})/);
    if (!m) return "";
    var h = Number(m[1]) || 0;
    var min = Number(m[2]) || 0;
    if (ampm) {
      var ap = ampm[1].toLowerCase();
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
    }
    return pad2(Math.min(23, Math.max(0, h))) + ":" + pad2(Math.min(59, Math.max(0, min)));
  }

  function addHoursToTime(hhmm, hours) {
    var t = normalizeTimeValue(hhmm);
    if (!t) return "--:--";
    var parts = t.split(":");
    var totalMin = Number(parts[0]) * 60 + Number(parts[1]) + Math.round(Number(hours) * 60);
    totalMin = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
    return pad2(Math.floor(totalMin / 60)) + ":" + pad2(totalMin % 60);
  }

  function scheduleWindowLabel(start, end) {
    return String(start || "") + " – " + String(end || "");
  }

  function ensureSharedStartTime() {
    var start = normalizeTimeValue(state.sharedStartTime);
    if (!start) start = defaultStartTime();
    state.sharedStartTime = start;
    return start;
  }

  function writeTeamStartTime(mask, value) {
    var v = normalizeTimeValue(value) || defaultStartTime();
    state.sharedStartTime = v;
    var card = mask && mask.querySelector("[data-mcj-team-start-time]");
    if (card) {
      card.setAttribute("data-mcj-team-start-time", v);
      var display = card.querySelector("[data-po-start-display]");
      if (display) display.textContent = v;
    }
    return v;
  }

  function readTeamStartTime(mask) {
    var card = mask && mask.querySelector("[data-mcj-team-start-time]");
    if (!card) return ensureSharedStartTime();
    return normalizeTimeValue(card.getAttribute("data-mcj-team-start-time") || "") || ensureSharedStartTime();
  }

  function openTeamStartTimePicker(mask) {
    if (!window.MCJTimePicker || typeof window.MCJTimePicker.open !== "function") {
      toast("时间选择器加载失败，请刷新后重试");
      return;
    }
    window.MCJTimePicker.open({
      title: "选择开始时间",
      value: readTeamStartTime(mask),
      minuteStep: 60,
      onConfirm: function (value) {
        writeTeamStartTime(mask, value);
        persist();
        refreshTeamSchedulePreview();
      },
    });
  }

  function refreshTeamSchedulePreview() {
    var mask = document.querySelector("[data-mcj-team-sheet]");
    if (!mask) return;
    var endEl = mask.querySelector("[data-mcj-team-end-time]");
    var hintEl = mask.querySelector("[data-mcj-team-schedule-preview]");
    var start = readTeamStartTime(mask);
    writeTeamStartTime(mask, start);
    var duration = maxTeamDurationHours();
    var end = addHoursToTime(start, duration);
    if (endEl) endEl.textContent = end;
    if (hintEl) {
      hintEl.textContent =
        "服务时段：" + scheduleWindowLabel(start, end) + "（按最长 " + duration + " 小时自动计算）";
    }
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
            serviceId: l.serviceId || "",
            game: l.game || l.service || "",
            hours: money(l.hours || 1),
            quantity: Math.max(1, Math.floor(money(l.quantity || 1) || 1)),
            services: Array.isArray(l.services) ? l.services : [],
            online: !!l.online,
          };
        }),
        sharedGameId: state.sharedGameId || "",
        sharedNotes: state.sharedNotes || "",
        sharedStartTime: state.sharedStartTime || "",
        sharedVoiceMode: state.sharedVoiceMode || "game_mic",
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
      state.sharedStartTime = normalizeTimeValue(data.sharedStartTime || "") || "";
      state.sharedVoiceMode = data.sharedVoiceMode || "game_mic";
    } catch (e) {
      state.lines = [];
    }
  }

  function clearTeam() {
    state.lines = [];
    state.sharedGameId = "";
    state.sharedNotes = "";
    state.sharedStartTime = "";
    state.sharedVoiceMode = "game_mic";
    state.expanded = false;
    state.pendingIdempotencyKey = "";
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(PICKING_KEY);
    } catch (e) {}
    renderBar();
    closeSheet();
  }

  function isPicking() {
    try {
      return sessionStorage.getItem(PICKING_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setPicking(on) {
    try {
      if (on) sessionStorage.setItem(PICKING_KEY, "1");
      else sessionStorage.removeItem(PICKING_KEY);
    } catch (e) {}
  }

  function continueToHall() {
    setPicking(true);
    state.expanded = false;
    renderBar();
    // Draft stays in sessionStorage (STORAGE_KEY). Only clearTeam() wipes it.
    location.href = HALL_HREF;
  }

  /**
   * Stack multi team bar above the real bottom action bar (profile CS/下单,
   * app tabbar, etc). Measure — do not hardcode a magic bottom offset.
   */
  function syncBottomStackOffset() {
    try {
      var root = document.documentElement;
      var actions =
        document.querySelector(".profile-bottom-bar.pd-bottom-bar") ||
        document.querySelector(".profile-bottom-bar") ||
        document.querySelector(".mobile-bottom-nav.mcj-app-tabbar") ||
        document.querySelector(".mcj-app-tabbar");
      var h = 0;
      if (actions) {
        var rect = actions.getBoundingClientRect();
        h = Math.max(0, Math.ceil(rect.height || 0));
        // Include the bar's own bottom offset from the visual viewport edge.
        var style = window.getComputedStyle(actions);
        var bottomPx = parseFloat(style.bottom) || 0;
        if (bottomPx > 0) h += Math.ceil(bottomPx);
        else {
          // fixed bar may use transform; fall back to viewport gap
          var gap = Math.max(0, window.innerHeight - rect.bottom);
          h += Math.ceil(gap);
        }
      }
      if (!(h > 0)) h = 64;
      root.style.setProperty("--mcj-bottom-actions-h", h + "px");
      // Team bar height for page padding
      var teamBar = document.querySelector("[data-mcj-team-bar]");
      var teamH = teamBar ? Math.ceil(teamBar.getBoundingClientRect().height || 0) : 0;
      root.style.setProperty("--mcj-team-bar-h", (teamH || 64) + "px");
    } catch (e) {}
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
        var resolved = window.MCJPlaceOrder.resolveServices(companion) || [];
        if (resolved.length) return resolved;
      } catch (e) {}
    }
    if (Array.isArray(companion.services) && companion.services.length) {
      return companion.services
        .map(function (s, i) {
          if (!s) return null;
          return {
            name: String(s.name || s.service || "").trim(),
            price: money(s.price != null ? s.price : s.unitPrice != null ? s.unitPrice : 0),
            serviceId: String(s.serviceId || s.service_id || s.id || "").trim(),
            sort: s.sort != null ? Number(s.sort) : i,
          };
        })
        .filter(function (s) {
          return s && s.name;
        });
    }
    var name = companion.service || companion.game || "陪玩";
    return [{ name: name, price: money(companion.unitPrice || companion.price), serviceId: companion.serviceId || "" }];
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
      serviceId: raw.serviceId || raw.service_id || "",
      game: raw.game || raw.service || "陪玩",
      gamePrices: raw.gamePrices || raw.game_prices || {},
      services: raw.services,
      online: raw.online !== false,
    };
    var services = resolveServicesFor(companion);
    if (!services.length) {
      toast("该陪玩暂无可下单服务项目");
      return { ok: false, error: "no_service" };
    }
    // Prefer explicit selection only — never silently rewrite to services[0]
    // when the user already chose a service (e.g. 三角洲@35 → 王者荣耀@30).
    var preferService = String(raw.service || raw.serviceType || "").trim();
    // game blobs like "A,B,C" are not a single selected service name
    if (!preferService) {
      var gameHint = String(raw.game || "").trim();
      if (gameHint && gameHint.indexOf(",") < 0 && gameHint.indexOf("，") < 0 && gameHint.indexOf("、") < 0) {
        preferService = gameHint;
      }
    }
    var preferId = String(raw.serviceId || raw.service_id || "").trim();
    var hasExplicit = !!(preferId || preferService);
    var matched =
      (preferId &&
        services.find(function (s) {
          return (
            String(s.serviceId || "") === preferId ||
            String(s.id || "") === preferId
          );
        })) ||
      (preferService &&
        services.find(function (s) {
          return String(s.name) === preferService;
        })) ||
      (preferService &&
        services.find(function (s) {
          var n = String(s.name || "");
          return n && (preferService.indexOf(n) >= 0 || n.indexOf(preferService) >= 0);
        })) ||
      null;
    var selected = matched;
    if (!selected && !hasExplicit) {
      selected = services.find(function (s) {
        return money(s.price) > 0;
      }) || services[0];
    }
    // SoT: matched service-specific price ?? explicit unitPrice ?? first catalog price.
    // Explicit selection that missed catalog match MUST keep caller unitPrice/name/id —
    // do NOT fall back to services[0] (level-default 30 / first game).
    var lineUnit = 0;
    var lineService = "";
    var lineServiceId = "";
    if (matched) {
      lineUnit = money(matched.price) > 0 ? money(matched.price) : unitPrice;
      lineService = matched.name || preferService || companion.service;
      lineServiceId = String(matched.serviceId || matched.id || preferId || "").trim();
    } else if (hasExplicit) {
      lineUnit = unitPrice;
      lineService = preferService || companion.service || "陪玩";
      lineServiceId = preferId;
    } else {
      lineUnit = money(selected && selected.price) > 0 ? money(selected.price) : unitPrice;
      lineService = (selected && selected.name) || companion.service;
      lineServiceId = (selected && (selected.serviceId || selected.id)) || companion.serviceId || "";
    }
    if (!(lineUnit > 0)) {
      toast("该陪玩所选服务暂无有效单价");
      return { ok: false, error: "no_price" };
    }
    var line = {
      companionId: companionId,
      companionName: companion.companionName,
      avatar: companion.avatar,
      unitPrice: lineUnit,
      service: lineService,
      serviceType: lineService,
      serviceId: lineServiceId,
      game: lineService,
      hours: Math.max(0.5, money(raw.hours || 1) || 1),
      quantity: Math.max(1, Math.floor(money(raw.quantity || 1) || 1)),
      services: services,
      online: companion.online,
    };
    state.lines.push(line);
    persist();
    renderBar();
    syncBottomStackOffset();
    toast(state.lines.length === 1 ? "已加入队伍，可继续选陪玩" : "已加入一起下单");
    if (isPicking() && state.lines.length >= 2) {
      setPicking(false);
      openCheckout();
    }
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
    if (patch.service || patch.serviceType || patch.serviceId) {
      var name = patch.service || patch.serviceType || line.service;
      var sid = String(patch.serviceId || "").trim();
      var hit =
        (sid &&
          (line.services || []).find(function (s) {
            return String(s.serviceId || s.id || "") === sid;
          })) ||
        (line.services || []).find(function (s) {
          return s.name === name;
        });
      if (hit && money(hit.price) > 0) line.unitPrice = money(hit.price);
      else if (patch.unitPrice != null && money(patch.unitPrice) > 0) line.unitPrice = money(patch.unitPrice);
      if (hit) {
        line.serviceId = hit.serviceId || hit.id || sid || line.serviceId || "";
        name = hit.name || name;
      } else if (sid) {
        line.serviceId = sid;
      }
      if (name) {
        line.service = name;
        line.serviceType = name;
        line.game = name;
      }
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
      syncBottomStackOffset();
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
    syncBottomStackOffset();
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
              '" data-svc-id="' +
              esc(s.serviceId || s.id || "") +
              '" data-svc-price="' +
              esc(String(money(s.price))) +
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
      '<div class="mcj-team-field"><span>游戏ID *（共用）</span><input type="text" data-mcj-team-game-id value="' +
      esc(state.sharedGameId) +
      '" placeholder="请输入游戏ID" autocomplete="off" inputmode="text"></div>' +
      '<div class="mcj-team-field mcj-team-schedule-field"><span>服务时间 *</span>' +
      '<div class="mcj-team-time-row">' +
      '<div class="mcj-team-time-col mcj-team-time-start"><span class="mcj-team-time-cap">开始时间</span>' +
      (window.MCJTimePicker && window.MCJTimePicker.startCardHtml
        ? window.MCJTimePicker.startCardHtml(ensureSharedStartTime(), {
            startAttr: "data-mcj-team-start-time",
            openAttr: "data-mcj-team-open-time",
          })
        : '<button type="button" class="mcj-po-time-card is-interactive" data-mcj-team-start-time="' +
          esc(ensureSharedStartTime()) +
          '" data-mcj-team-open-time="1" aria-label="选择开始时间"><span class="mcj-po-time-card-value" data-po-start-display>' +
          esc(ensureSharedStartTime()) +
          '</span><span class="mcj-po-time-card-chevron" aria-hidden="true">›</span></button>') +
      "</div>" +
      '<div class="mcj-team-time-col mcj-team-time-end"><span class="mcj-team-time-cap">预计结束</span>' +
      (window.MCJTimePicker && window.MCJTimePicker.endCardHtml
        ? window.MCJTimePicker.endCardHtml("--", { endAttr: "data-mcj-team-end-time" })
        : '<div class="mcj-po-time-card is-readonly" aria-live="polite"><span class="mcj-po-time-card-value" data-mcj-team-end-time>--</span></div>') +
      "</div></div>" +
      '<p class="mcj-team-time-hint" data-mcj-team-schedule-preview>选择开始时间后自动计算结束时间</p></div>' +
      '<div class="mcj-team-field"><span>订单备注（选填）</span><input type="text" data-mcj-team-notes value="' +
      esc(state.sharedNotes) +
      '" placeholder="选填：特殊要求、开局说明等"></div>' +
      '<div class="mcj-team-field"><span>本单语音方式</span><div class="mcj-team-voice-grid">' +
      '<button type="button" class="mcj-team-voice' +
      (state.sharedVoiceMode === "game_mic" ? " active" : "") +
      '" data-mcj-team-voice="game_mic">🎮 游戏麦</button>' +
      '<button type="button" class="mcj-team-voice' +
      (state.sharedVoiceMode === "discord" ? " active" : "") +
      '" data-mcj-team-voice="discord">🎧 Discord</button>' +
      '<button type="button" class="mcj-team-voice' +
      (state.sharedVoiceMode === "none" ? " active" : "") +
      '" data-mcj-team-voice="none">💬 不需要语音</button>' +
      "</div></div>" +
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
    refreshTeamSchedulePreview();
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
    var startTime = ensureSharedStartTime();
    var endTime = addHoursToTime(startTime, maxTeamDurationHours());
    var schedule = scheduleWindowLabel(startTime, endTime);
    var noteParts = [];
    if (String(state.sharedNotes || "").trim()) noteParts.push(String(state.sharedNotes || "").trim());
    noteParts.push("服务时段：" + schedule);
    var notes = noteParts.join("；");
    return {
      action: "place_multi_order",
      paymentMethod: "catfood",
      gameId: String(state.sharedGameId || "").trim(),
      notes: notes,
      schedule: schedule,
      startTime: startTime,
      endTime: endTime,
      voiceMode: state.sharedVoiceMode || "game_mic",
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
          serviceId: l.serviceId || "",
          game: l.game || l.service,
          gameName: l.game || l.service,
          gameId: String(state.sharedGameId || "").trim(),
          hours: hours,
          quantity: quantity,
          unitPrice: unitPrice,
          totalAmount: totalAmount,
          schedule: schedule,
          startTime: startTime,
          endTime: endTime,
          notes: notes,
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
    var startTime = readTeamStartTime(document.querySelector("[data-mcj-team-sheet]"));
    state.sharedStartTime = startTime;
    if (!state.sharedGameId) {
      toast("请填写游戏ID");
      return;
    }
    if (!ensureSharedStartTime()) {
      toast("请选择开始时间");
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
        var raw = String((err && err.message) || "");
        console.error("[MCJMultiCompanionTeam] submit failed", err);
        if (/Can't find variable|is not defined|ReferenceError|TypeError/i.test(raw)) {
          toast("下单出错了，请刷新页面后重试");
        } else {
          toast(raw || "多人下单失败");
        }
      });
  }

  function normalizeCatalogServices(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(function (s, i) {
        if (!s) return null;
        return {
          name: String(s.name || s.serviceName || s.service_name || "").trim(),
          price: money(s.price != null ? s.price : s.unitPrice != null ? s.unitPrice : 0),
          serviceId: String(s.serviceId || s.service_id || s.id || "").trim(),
          id: String(s.id || s.serviceId || s.service_id || "").trim(),
          sort: s.sort != null ? Number(s.sort) : i,
        };
      })
      .filter(function (s) {
        return s && s.name;
      });
  }

  function pickHallService(services, btn) {
    var filterEl = document.getElementById("gameFilter");
    var filterLabel = "";
    var filterVal = "";
    try {
      if (filterEl && filterEl.value) {
        filterVal = String(filterEl.value || "").trim();
        filterLabel = String(
          (filterEl.selectedOptions && filterEl.selectedOptions[0] && filterEl.selectedOptions[0].text) || ""
        ).trim();
      }
    } catch (e) {}
    var gameAttr = String(btn.getAttribute("data-hall-game") || "").trim();
    var firstGame = gameAttr.split(/[,，、\/|]+/).map(function (s) {
      return String(s || "").trim();
    }).filter(Boolean)[0] || "";
    var preferNames = [filterLabel, firstGame].filter(Boolean);
    var preferIds = [filterVal].filter(function (id) {
      return id && /^[0-9a-f-]{36}$/i.test(id);
    });
    var hit =
      (preferIds[0] &&
        services.find(function (s) {
          return String(s.serviceId || s.id || "") === preferIds[0];
        })) ||
      null;
    for (var i = 0; !hit && i < preferNames.length; i++) {
      var want = preferNames[i];
      hit = services.find(function (s) {
        return String(s.name) === want;
      });
      if (!hit) {
        hit = services.find(function (s) {
          var n = String(s.name || "");
          return n && (want.indexOf(n) >= 0 || n.indexOf(want) >= 0);
        });
      }
    }
    // Prefer a service-specific priced row over pure level-default when no filter.
    if (!hit) {
      hit =
        services.find(function (s) {
          return money(s.price) > 0;
        }) || services[0] || null;
    }
    return hit;
  }

  function addCompanionFromHallButton(btn) {
    var companionId = String(btn.getAttribute("data-hall-team-add") || "").trim();
    var fallback = {
      companionId: companionId,
      companionName: btn.getAttribute("data-hall-name") || "陪玩",
      unitPrice: Number(btn.getAttribute("data-hall-price") || 0),
      avatar: btn.getAttribute("data-hall-avatar") || "",
      game: btn.getAttribute("data-hall-game") || "陪玩",
      service: "",
      status: btn.getAttribute("data-hall-status") || "",
      statusText: btn.getAttribute("data-hall-status-text") || "",
      online: btn.getAttribute("data-hall-online"),
    };
    if (!companionId) {
      addCompanion(fallback);
      return;
    }
    // Resolve live catalog so hall team-add uses service price, not listing level price.
    fetch("/api/boss/marketplace?action=catalog&companionId=" + encodeURIComponent(companionId), {
      headers: authHeaders(),
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || (body && body.ok === false)) throw new Error("catalog");
          return body;
        });
      })
      .then(function (body) {
        var services = normalizeCatalogServices(body && body.services);
        var picked = pickHallService(services, btn);
        if (picked && money(picked.price) > 0) {
          addCompanion(
            Object.assign({}, fallback, {
              service: picked.name,
              serviceType: picked.name,
              serviceId: picked.serviceId || picked.id || "",
              unitPrice: money(picked.price),
              game: picked.name,
              services: services,
            })
          );
          return;
        }
        if (services.length) {
          addCompanion(
            Object.assign({}, fallback, {
              service: (picked && picked.name) || services[0].name,
              serviceId: (picked && (picked.serviceId || picked.id)) || services[0].serviceId || "",
              services: services,
            })
          );
          return;
        }
        addCompanion(fallback);
      })
      .catch(function () {
        addCompanion(fallback);
      });
  }

  function onDocClick(e) {
    var addBtn = e.target.closest("[data-hall-team-add]");
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      addCompanionFromHallButton(addBtn);
      return;
    }
    if (e.target.closest("[data-mcj-team-checkout]")) {
      e.preventDefault();
      openCheckout();
      return;
    }
    if (e.target.closest("[data-mcj-team-continue]")) {
      e.preventDefault();
      continueToHall();
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
        serviceId: svc.getAttribute("data-svc-id") || "",
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
    var voiceBtn = e.target.closest("[data-mcj-team-voice]");
    if (voiceBtn) {
      e.preventDefault();
      state.sharedVoiceMode = voiceBtn.getAttribute("data-mcj-team-voice") || "game_mic";
      persist();
      paintSheet();
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
      refreshTeamSchedulePreview();
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

  document.addEventListener("click", function (e) {
    var openTime = e.target.closest("[data-mcj-team-open-time]");
    if (openTime) {
      e.preventDefault();
      var sheet = openTime.closest("[data-mcj-team-sheet]");
      openTeamStartTimePicker(sheet || document.querySelector("[data-mcj-team-sheet]"));
    }
  });

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
  syncBottomStackOffset();
  window.addEventListener("resize", syncBottomStackOffset);
  window.addEventListener("orientationchange", function () {
    setTimeout(syncBottomStackOffset, 120);
  });
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
    continueToHall: continueToHall,
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
      syncBottomStackOffset: syncBottomStackOffset,
      isPicking: isPicking,
    },
  };
})();
