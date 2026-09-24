/**
 * Meow custom 24h time wheel picker (no native <input type="time">).
 * Transform-based wheels (reliable on mobile + headless).
 * Exposes window.MCJTimePicker.open({ value, minuteStep, title, onConfirm, onCancel }).
 */
(function () {
  "use strict";

  var MINUTE_STEP_DEFAULT = 60;
  var ITEM_H = 44;
  var VISIBLE = 5;
  var PAD = Math.floor(VISIBLE / 2);
  var scrollLockCount = 0;
  var prevBodyOverflow = "";
  var prevHtmlOverflow = "";

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function normalizeTimeValue(v) {
    var raw = String(v || "").trim();
    if (!raw) return "";
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
    h = Math.min(23, Math.max(0, h));
    min = Math.min(59, Math.max(0, min));
    return pad2(h) + ":" + pad2(min);
  }

  function minuteOptions(step) {
    var s = Number(step);
    if (!Number.isFinite(s) || s <= 0 || s > 60) s = MINUTE_STEP_DEFAULT;
    var out = [];
    for (var m = 0; m < 60; m += s) out.push(pad2(m));
    if (!out.length) out.push("00");
    return out;
  }

  function hourOptions() {
    var a = [];
    for (var i = 0; i < 24; i++) a.push(pad2(i));
    return a;
  }

  function snapMinute(min, step) {
    var opts = minuteOptions(step);
    var m = pad2(Math.min(59, Math.max(0, Number(min) || 0)));
    if (opts.indexOf(m) >= 0) return m;
    var best = opts[0];
    var bestDiff = 99;
    var n = Number(m);
    opts.forEach(function (o) {
      var d = Math.abs(Number(o) - n);
      if (d < bestDiff) {
        bestDiff = d;
        best = o;
      }
    });
    return best;
  }

  function lockScroll() {
    scrollLockCount += 1;
    if (scrollLockCount !== 1) return;
    prevBodyOverflow = document.body.style.overflow;
    prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }

  function unlockScroll() {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount !== 0) return;
    document.body.style.overflow = prevBodyOverflow || "";
    document.documentElement.style.overflow = prevHtmlOverflow || "";
  }

  function closeExisting() {
    document.querySelectorAll("[data-mcj-time-picker-mask]").forEach(function (el) {
      el.remove();
    });
    while (scrollLockCount > 0) unlockScroll();
  }

  function buildCol(kind, values, selected) {
    var items = values
      .map(function (v) {
        return (
          '<div class="mcj-tp-item" data-tp-value="' +
          v +
          '" role="option" aria-selected="' +
          (v === selected ? "true" : "false") +
          '">' +
          v +
          "</div>"
        );
      })
      .join("");
    return (
      '<div class="mcj-tp-col" data-tp-col="' +
      kind +
      '">' +
      '<div class="mcj-tp-viewport" data-tp-viewport="' +
      kind +
      '">' +
      '<div class="mcj-tp-track" data-tp-track="' +
      kind +
      '" data-tp-scroll="' +
      kind +
      '" role="listbox" aria-label="' +
      (kind === "hour" ? "小时" : "分钟") +
      '">' +
      items +
      "</div></div></div>"
    );
  }

  function open(opts) {
    opts = opts || {};
    closeExisting();
    var step = opts.minuteStep != null ? opts.minuteStep : MINUTE_STEP_DEFAULT;
    var mins = minuteOptions(step);
    var hours = hourOptions();
    var initial = normalizeTimeValue(opts.value) || "";
    if (!initial && opts.fallback) initial = normalizeTimeValue(opts.fallback);
    if (!initial) initial = "21:00";
    var parts = initial.split(":");
    var hour = pad2(Math.min(23, Math.max(0, Number(parts[0]) || 0)));
    var minute = snapMinute(parts[1], step);
    var confirmed = false;
    var hourIdx = Math.max(0, hours.indexOf(hour));
    var minuteIdx = Math.max(0, mins.indexOf(minute));

    var mask = document.createElement("div");
    mask.className = "mcj-tp-mask";
    mask.setAttribute("data-mcj-time-picker-mask", "1");
    mask.setAttribute("role", "dialog");
    mask.setAttribute("aria-modal", "true");
    mask.setAttribute("aria-label", opts.title || "选择时间");

    mask.innerHTML =
      '<div class="mcj-tp-sheet" data-tp-sheet="1">' +
      '<div class="mcj-tp-head"><strong>' +
      String(opts.title || "选择时间").replace(/</g, "&lt;") +
      "</strong></div>" +
      '<div class="mcj-tp-body">' +
      '<div class="mcj-tp-highlight" aria-hidden="true"></div>' +
      buildCol("hour", hours, hour) +
      '<div class="mcj-tp-colon">:</div>' +
      buildCol("minute", mins, minute) +
      "</div>" +
      '<div class="mcj-tp-actions">' +
      '<button type="button" class="mcj-tp-btn ghost" data-tp-cancel>取消</button>' +
      '<button type="button" class="mcj-tp-btn primary" data-tp-confirm>确认</button>' +
      "</div></div>";

    function valuesOf(kind) {
      return kind === "hour" ? hours : mins;
    }

    function idxOf(kind) {
      return kind === "hour" ? hourIdx : minuteIdx;
    }

    function setIdx(kind, idx) {
      var values = valuesOf(kind);
      idx = Math.max(0, Math.min(values.length - 1, idx));
      if (kind === "hour") {
        hourIdx = idx;
        hour = values[idx];
      } else {
        minuteIdx = idx;
        minute = values[idx];
      }
    }

    function syncActive(kind) {
      var track = mask.querySelector('[data-tp-track="' + kind + '"]');
      if (!track) return;
      var selected = kind === "hour" ? hour : minute;
      track.querySelectorAll(".mcj-tp-item[data-tp-value]").forEach(function (el) {
        var on = el.getAttribute("data-tp-value") === selected;
        el.classList.toggle("is-active", on);
        el.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    function renderTrack(kind, animate) {
      var track = mask.querySelector('[data-tp-track="' + kind + '"]');
      if (!track) return;
      var idx = idxOf(kind);
      track.style.transition = animate ? "transform 0.18s cubic-bezier(0.22, 1, 0.36, 1)" : "none";
      track.style.transform = "translate3d(0, " + (-idx * ITEM_H) + "px, 0)";
      syncActive(kind);
    }

    function goToValue(kind, value, animate) {
      var values = valuesOf(kind);
      var idx = values.indexOf(value);
      if (idx < 0) idx = 0;
      setIdx(kind, idx);
      renderTrack(kind, !!animate);
    }

    function bindWheel(kind) {
      var viewport = mask.querySelector('[data-tp-viewport="' + kind + '"]');
      var track = mask.querySelector('[data-tp-track="' + kind + '"]');
      if (!viewport || !track) return;

      var dragging = false;
      var startY = 0;
      var startIdx = 0;
      var lastY = 0;
      var lastT = 0;
      var velocity = 0;

      function onPointerDown(y) {
        dragging = true;
        startY = y;
        lastY = y;
        lastT = Date.now();
        startIdx = idxOf(kind);
        velocity = 0;
        track.style.transition = "none";
      }

      function onPointerMove(y) {
        if (!dragging) return;
        var dy = y - startY;
        var now = Date.now();
        var dt = Math.max(1, now - lastT);
        velocity = (y - lastY) / dt;
        lastY = y;
        lastT = now;
        var offset = startIdx * ITEM_H - dy;
        track.style.transform = "translate3d(0, " + -offset + "px, 0)";
        var live = Math.round(offset / ITEM_H);
        var values = valuesOf(kind);
        live = Math.max(0, Math.min(values.length - 1, live));
        if (kind === "hour") {
          hour = values[live];
        } else {
          minute = values[live];
        }
        syncActive(kind);
      }

      function onPointerUp(y) {
        if (!dragging) return;
        dragging = false;
        var dy = y - startY;
        var projected = startIdx * ITEM_H - dy - velocity * 120;
        var idx = Math.round(projected / ITEM_H);
        setIdx(kind, idx);
        renderTrack(kind, true);
      }

      viewport.addEventListener(
        "touchstart",
        function (e) {
          if (!e.touches || !e.touches[0]) return;
          onPointerDown(e.touches[0].clientY);
        },
        { passive: true }
      );
      viewport.addEventListener(
        "touchmove",
        function (e) {
          if (!dragging || !e.touches || !e.touches[0]) return;
          e.preventDefault();
          onPointerMove(e.touches[0].clientY);
        },
        { passive: false }
      );
      viewport.addEventListener(
        "touchend",
        function (e) {
          var y = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : lastY;
          onPointerUp(y);
        },
        { passive: true }
      );

      viewport.addEventListener("mousedown", function (e) {
        e.preventDefault();
        onPointerDown(e.clientY);
        function move(ev) {
          onPointerMove(ev.clientY);
        }
        function up(ev) {
          onPointerUp(ev.clientY);
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
        }
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });

      track.addEventListener("click", function (e) {
        var item = e.target.closest("[data-tp-value]");
        if (!item || !track.contains(item)) return;
        goToValue(kind, item.getAttribute("data-tp-value"), true);
      });

      viewport.addEventListener(
        "wheel",
        function (e) {
          e.preventDefault();
          var dir = e.deltaY > 0 ? 1 : -1;
          setIdx(kind, idxOf(kind) + dir);
          renderTrack(kind, true);
        },
        { passive: false }
      );
    }

    function close(reason) {
      document.removeEventListener("keydown", onKey, true);
      unlockScroll();
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      if (reason === "confirm") {
        confirmed = true;
        if (typeof opts.onConfirm === "function") opts.onConfirm(hour + ":" + minute);
      } else if (!confirmed && typeof opts.onCancel === "function") {
        opts.onCancel();
      }
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close("cancel");
      }
    }

    mask.addEventListener("click", function (e) {
      if (e.target === mask) close("cancel");
    });
    mask.querySelector("[data-tp-cancel]").addEventListener("click", function (e) {
      e.preventDefault();
      close("cancel");
    });
    mask.querySelector("[data-tp-confirm]").addEventListener("click", function (e) {
      e.preventDefault();
      close("confirm");
    });
    document.addEventListener("keydown", onKey, true);

    lockScroll();
    document.body.appendChild(mask);
    bindWheel("hour");
    bindWheel("minute");
    requestAnimationFrame(function () {
      renderTrack("hour", false);
      renderTrack("minute", false);
      mask.classList.add("is-open");
    });

    return { close: function () { close("cancel"); } };
  }

  function startCardHtml(value, attrs) {
    attrs = attrs || {};
    var v = normalizeTimeValue(value) || "21:00";
    var startAttr = attrs.startAttr || "data-po-start-time";
    var openAttr = attrs.openAttr || "data-po-open-time";
    return (
      '<button type="button" class="mcj-po-time-card is-interactive" ' +
      startAttr +
      '="' +
      v +
      '" ' +
      openAttr +
      '="1" aria-label="选择开始时间 ' +
      v +
      '">' +
      '<span class="mcj-po-time-card-value" data-po-start-display>' +
      v +
      "</span>" +
      '<span class="mcj-po-time-card-chevron" aria-hidden="true">›</span>' +
      "</button>"
    );
  }

  function endCardHtml(value, attrs) {
    attrs = attrs || {};
    var v = normalizeTimeValue(value) || "--";
    var endAttr = attrs.endAttr || "data-po-end-time";
    return (
      '<div class="mcj-po-time-card is-readonly" aria-live="polite">' +
      '<span class="mcj-po-time-card-value" ' +
      endAttr +
      ">" +
      v +
      "</span>" +
      "</div>"
    );
  }

  /** Apply / profile editable time card + hidden input. */
  function applyFieldHtml(opts) {
    opts = opts || {};
    var name = String(opts.name || "");
    var label = String(opts.label || "");
    var icon = String(opts.icon || "🕐");
    var value = normalizeTimeValue(opts.value);
    var display = value || "选择时间";
    var emptyClass = value ? "" : " is-empty";
    var title = opts.pickerTitle || ("选择" + label);
    return (
      '<div class="mcj-apply-time-field" data-apply-time-field="' +
      name +
      '">' +
      '<span class="mcj-apply-time-label">' +
      label +
      "</span>" +
      '<button type="button" class="mcj-apply-time-card" data-apply-time-open="' +
      name +
      '" data-apply-time-title="' +
      title.replace(/"/g, "&quot;") +
      '" aria-label="' +
      label +
      " " +
      display +
      '">' +
      '<span class="mcj-apply-time-ico" aria-hidden="true">' +
      icon +
      "</span>" +
      '<span class="mcj-apply-time-value' +
      emptyClass +
      '" data-apply-time-display="' +
      name +
      '">' +
      display +
      "</span>" +
      '<span class="mcj-apply-time-chevron" aria-hidden="true">›</span>' +
      "</button>" +
      '<input type="hidden" name="' +
      name +
      '" data-apply-field value="' +
      (value || "") +
      '">' +
      "</div>"
    );
  }

  window.MCJTimePicker = {
    open: open,
    close: closeExisting,
    normalize: normalizeTimeValue,
    pad2: pad2,
    minuteStepDefault: MINUTE_STEP_DEFAULT,
    startCardHtml: startCardHtml,
    endCardHtml: endCardHtml,
    applyFieldHtml: applyFieldHtml,
  };
})();
