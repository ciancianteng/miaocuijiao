/**
 * Client OTP resend cooldown — sessionStorage so refresh keeps the timer.
 * Keyed by action + role + email. Uses absolute deadline (visibility-safe).
 */
(function (global) {
  "use strict";

  var PREFIX = "mcj_otp_cd:";

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function storageKey(action, role, email) {
    return PREFIX + String(action || "otp") + ":" + String(role || "") + ":" + normalizeEmail(email);
  }

  function now() {
    return Date.now();
  }

  function getRemainingSec(action, role, email) {
    try {
      var raw = sessionStorage.getItem(storageKey(action, role, email));
      var until = Number(raw || 0);
      if (!until) return 0;
      return Math.max(0, Math.ceil((until - now()) / 1000));
    } catch (e) {
      return 0;
    }
  }

  function setCooldown(action, role, email, sec) {
    var s = Math.max(0, Number(sec) || 0);
    if (!s) return;
    try {
      sessionStorage.setItem(storageKey(action, role, email), String(now() + s * 1000));
    } catch (e) {}
  }

  function clearCooldown(action, role, email) {
    try {
      sessionStorage.removeItem(storageKey(action, role, email));
    } catch (e) {}
  }

  /**
   * Bind a button to countdown using absolute deadline from sessionStorage.
   * Returns a stop() function.
   */
  function bindButtonCountdown(btn, action, role, email, idleLabel) {
    if (!btn) return function () {};
    var label = idleLabel || btn.getAttribute("data-otp-idle-label") || btn.textContent || "获取验证码";
    btn.setAttribute("data-otp-idle-label", label);
    var timer = null;

    function tick() {
      var left = getRemainingSec(action, role, email);
      if (left <= 0) {
        btn.disabled = false;
        btn.textContent = label;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        return;
      }
      btn.disabled = true;
      btn.textContent = left + "s";
    }

    tick();
    timer = setInterval(tick, 500);
    function onVis() {
      if (document.visibilityState === "visible") tick();
    }
    document.addEventListener("visibilitychange", onVis);
    return function stop() {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }

  global.MCJOtpCooldown = {
    getRemainingSec: getRemainingSec,
    setCooldown: setCooldown,
    clearCooldown: clearCooldown,
    bindButtonCountdown: bindButtonCountdown,
    storageKey: storageKey,
  };
})(typeof window !== "undefined" ? window : globalThis);
