/**
 * Meow custom 24h time picker (no native <input type="time"> / no AM-PM).
 * Exposes window.MCJTimePicker.open({ value, minuteStep, title, onConfirm }).
 */
(function () {
  "use strict";

  var MINUTE_STEP_DEFAULT = 60; // whole-hour bookings match existing step="60"

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /** Parse to HH:mm (24h). Accepts "21:00", "9:00", "09:00 PM". */
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
    var s = Number(step) || MINUTE_STEP_DEFAULT;
    if (s <= 0 || s > 60) s = 60;
    var out = [];
    for (var m = 0; m < 60; m += s) out.push(pad2(m));
    if (!out.length) out.push("00");
    return out;
  }

  function snapMinute(min, step) {
    var opts = minuteOptions(step);
    var m = pad2(Math.min(59, Math.max(0, Number(min) || 0)));
    if (opts.indexOf(m) >= 0) return m;
    // nearest
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

  function closeExisting() {
    document.querySelectorAll("[data-mcj-time-picker-mask]").forEach(function (el) {
      el.remove();
    });
  }

  function open(opts) {
    opts = opts || {};
    closeExisting();
    var step = opts.minuteStep != null ? opts.minuteStep : MINUTE_STEP_DEFAULT;
    var mins = minuteOptions(step);
    var initial = normalizeTimeValue(opts.value) || "21:00";
    var parts = initial.split(":");
    var hour = pad2(Math.min(23, Math.max(0, Number(parts[0]) || 0)));
    var minute = snapMinute(parts[1], step);

    var mask = document.createElement("div");
    mask.className = "mcj-tp-mask";
    mask.setAttribute("data-mcj-time-picker-mask", "1");
    mask.setAttribute("role", "dialog");
    mask.setAttribute("aria-modal", "true");
    mask.setAttribute("aria-label", opts.title || "选择开始时间");

    function wheelCol(kind, selected, values) {
      var idx = values.indexOf(selected);
      if (idx < 0) idx = 0;
      var prev = values[(idx - 1 + values.length) % values.length];
      var cur = values[idx];
      var next = values[(idx + 1) % values.length];
      return (
        '<div class="mcj-tp-col" data-tp-col="' +
        kind +
        '">' +
        '<button type="button" class="mcj-tp-nav" data-tp-dir="-1" data-tp-kind="' +
        kind +
        '" aria-label="上一项">▲</button>' +
        '<div class="mcj-tp-wheel" data-tp-wheel="' +
        kind +
        '">' +
        '<div class="mcj-tp-item is-faded" data-tp-side="prev">' +
        prev +
        "</div>" +
        '<div class="mcj-tp-item is-active" data-tp-side="cur">' +
        cur +
        "</div>" +
        '<div class="mcj-tp-item is-faded" data-tp-side="next">' +
        next +
        "</div>" +
        "</div>" +
        '<button type="button" class="mcj-tp-nav" data-tp-dir="1" data-tp-kind="' +
        kind +
        '" aria-label="下一项">▼</button>' +
        "</div>"
      );
    }

    function paint() {
      var title = opts.title || "选择开始时间";
      var confirmLabel = "确认 " + hour + ":" + minute;
      mask.innerHTML =
        '<div class="mcj-tp-sheet">' +
        '<div class="mcj-tp-head"><strong>' +
        title +
        "</strong>" +
        '<button type="button" class="mcj-tp-close" data-tp-close aria-label="关闭">×</button></div>' +
        '<div class="mcj-tp-body">' +
        wheelCol("hour", hour, hourValues()) +
        '<div class="mcj-tp-colon">:</div>' +
        wheelCol("minute", minute, mins) +
        "</div>" +
        '<button type="button" class="mcj-tp-confirm" data-tp-confirm>' +
        confirmLabel +
        "</button>" +
        "</div>";
    }

    function hourValues() {
      var a = [];
      for (var i = 0; i < 24; i++) a.push(pad2(i));
      return a;
    }

    function shift(kind, dir) {
      if (kind === "hour") {
        var h = (Number(hour) + dir + 24) % 24;
        hour = pad2(h);
      } else {
        var idx = mins.indexOf(minute);
        if (idx < 0) idx = 0;
        idx = (idx + dir + mins.length) % mins.length;
        minute = mins[idx];
      }
      paint();
      bind();
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }

    function close() {
      document.removeEventListener("keydown", onKey, true);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
    }

    function bind() {
      mask.querySelectorAll("[data-tp-dir]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          shift(btn.getAttribute("data-tp-kind"), Number(btn.getAttribute("data-tp-dir")) || 0);
        });
      });
      var closeBtn = mask.querySelector("[data-tp-close]");
      if (closeBtn) {
        closeBtn.addEventListener("click", function (e) {
          e.preventDefault();
          close();
        });
      }
      var confirm = mask.querySelector("[data-tp-confirm]");
      if (confirm) {
        confirm.addEventListener("click", function (e) {
          e.preventDefault();
          var value = hour + ":" + minute;
          close();
          if (typeof opts.onConfirm === "function") opts.onConfirm(value);
        });
      }
      // tap faded items to step
      mask.querySelectorAll("[data-tp-side]").forEach(function (el) {
        el.addEventListener("click", function (e) {
          e.preventDefault();
          var wheel = el.closest("[data-tp-wheel]");
          if (!wheel) return;
          var kind = wheel.getAttribute("data-tp-wheel");
          var side = el.getAttribute("data-tp-side");
          if (side === "prev") shift(kind, -1);
          else if (side === "next") shift(kind, 1);
        });
      });
    }

    mask.addEventListener("click", function (e) {
      if (e.target === mask) close();
    });

    // wheel scroll / swipe on columns
    mask.addEventListener(
      "wheel",
      function (e) {
        var col = e.target.closest("[data-tp-col]");
        if (!col || !mask.contains(col)) return;
        e.preventDefault();
        var kind = col.getAttribute("data-tp-col");
        shift(kind, e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );

    document.addEventListener("keydown", onKey, true);
    paint();
    bind();
    document.body.appendChild(mask);
    return { close: close };
  }

  /**
   * Minimal start-time card: HH:mm + light chevron. No emoji / decorative icons.
   * End card should mirror this with class `is-readonly` and no chevron.
   */
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

  /** Readonly end-time card — same shell as start, no chevron. */
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

  window.MCJTimePicker = {
    open: open,
    close: closeExisting,
    normalize: normalizeTimeValue,
    pad2: pad2,
    minuteStepDefault: MINUTE_STEP_DEFAULT,
    startCardHtml: startCardHtml,
    endCardHtml: endCardHtml,
  };
})();
