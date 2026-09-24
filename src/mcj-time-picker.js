/**
 * Meow custom 24h time wheel picker (no native <input type="time">).
 * Exposes window.MCJTimePicker.open({ value, minuteStep, title, onConfirm, onCancel }).
 */
(function () {
  "use strict";

  var MINUTE_STEP_DEFAULT = 60;
  var ITEM_H = 44;
  var VISIBLE = 5;
  var PAD_COUNT = Math.floor(VISIBLE / 2);
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

  function buildScrollCol(kind, values, selected) {
    var pads = "";
    for (var p = 0; p < PAD_COUNT; p++) {
      pads += '<div class="mcj-tp-item is-pad" aria-hidden="true"></div>';
    }
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
      '<div class="mcj-tp-col">' +
      '<div class="mcj-tp-scroll" data-tp-scroll="' +
      kind +
      '" role="listbox" aria-label="' +
      (kind === "hour" ? "小时" : "分钟") +
      '">' +
      pads +
      items +
      pads +
      "</div></div>"
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
      buildScrollCol("hour", hours, hour) +
      '<div class="mcj-tp-colon">:</div>' +
      buildScrollCol("minute", mins, minute) +
      "</div>" +
      '<div class="mcj-tp-actions">' +
      '<button type="button" class="mcj-tp-btn ghost" data-tp-cancel>取消</button>' +
      '<button type="button" class="mcj-tp-btn primary" data-tp-confirm>确认</button>' +
      "</div></div>";

    function readScrollValue(kind) {
      var sc = mask.querySelector('[data-tp-scroll="' + kind + '"]');
      if (!sc) return kind === "hour" ? hour : minute;
      var values = kind === "hour" ? hours : mins;
      var idx = Math.round(sc.scrollTop / ITEM_H);
      idx = Math.max(0, Math.min(values.length - 1, idx));
      return values[idx];
    }

    function syncActive(kind) {
      var sc = mask.querySelector('[data-tp-scroll="' + kind + '"]');
      if (!sc) return;
      var selected = kind === "hour" ? hour : minute;
      sc.querySelectorAll(".mcj-tp-item[data-tp-value]").forEach(function (el) {
        var on = el.getAttribute("data-tp-value") === selected;
        el.classList.toggle("is-active", on);
        el.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    function scrollToValue(kind, value, smooth) {
      var sc = mask.querySelector('[data-tp-scroll="' + kind + '"]');
      if (!sc) return;
      var values = kind === "hour" ? hours : mins;
      var idx = values.indexOf(value);
      if (idx < 0) idx = 0;
      var top = idx * ITEM_H;
      if (smooth && typeof sc.scrollTo === "function") {
        sc.scrollTo({ top: top, behavior: "smooth" });
      } else {
        sc.scrollTop = top;
      }
      syncActive(kind);
    }

    function snapScroll(kind) {
      var sc = mask.querySelector('[data-tp-scroll="' + kind + '"]');
      if (!sc) return;
      var values = kind === "hour" ? hours : mins;
      var idx = Math.round(sc.scrollTop / ITEM_H);
      idx = Math.max(0, Math.min(values.length - 1, idx));
      if (kind === "hour") hour = values[idx];
      else minute = values[idx];
      sc.scrollTop = idx * ITEM_H;
      syncActive(kind);
    }

    function bindScroll(kind) {
      var sc = mask.querySelector('[data-tp-scroll="' + kind + '"]');
      if (!sc) return;
      var timer = null;
      sc.addEventListener(
        "scroll",
        function () {
          var values = kind === "hour" ? hours : mins;
          var idx = Math.round(sc.scrollTop / ITEM_H);
          idx = Math.max(0, Math.min(values.length - 1, idx));
          if (kind === "hour") hour = values[idx];
          else minute = values[idx];
          syncActive(kind);
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () {
            snapScroll(kind);
          }, 80);
        },
        { passive: true }
      );
      sc.addEventListener("click", function (e) {
        var item = e.target.closest("[data-tp-value]");
        if (!item || !sc.contains(item)) return;
        var v = item.getAttribute("data-tp-value");
        if (kind === "hour") hour = v;
        else minute = v;
        scrollToValue(kind, v, true);
      });
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
      snapScroll("hour");
      snapScroll("minute");
      close("confirm");
    });
    document.addEventListener("keydown", onKey, true);

    lockScroll();
    document.body.appendChild(mask);
    // next frame: position wheels then animate sheet
    requestAnimationFrame(function () {
      scrollToValue("hour", hour, false);
      scrollToValue("minute", minute, false);
      bindScroll("hour");
      bindScroll("minute");
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
