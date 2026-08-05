(function (global) {
  function brandHeader(title, desc) {
    return (
      '<div class="mcj-auth-brand">' +
      '<p class="mcj-auth-brand-name">妙脆角</p>' +
      '<p class="mcj-auth-brand-en">MEOW CUI JIAO</p>' +
      "</div>" +
      '<h1 class="mcj-auth-title">' +
      title +
      "</h1>" +
      '<p class="mcj-auth-desc">' +
      desc +
      "</p>"
    );
  }

  function passwordField(name, label, attrs) {
    attrs = attrs || 'autocomplete="current-password"';
    return (
      '<label class="mcj-auth-field">' +
      label +
      '<div class="mcj-auth-password password-field">' +
      '<input name="' +
      name +
      '" type="password" required ' +
      attrs +
      ' value="">' +
      '<button class="mcj-auth-eye" type="button" tabindex="-1" data-toggle-password aria-label="显示或隐藏密码">显示</button>' +
      "</div></label>"
    );
  }

  function bindPasswordToggles(root) {
    (root || document).addEventListener("click", function (e) {
      var btn = e.target.closest("[data-toggle-password]");
      if (!btn) return;
      e.preventDefault();
      var wrap = btn.closest(".mcj-auth-password");
      var input = wrap && wrap.querySelector("input");
      if (!input) return;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "隐藏" : "显示";
    });
  }

  function setFormError(form, message) {
    if (!form) return;
    var box = form.querySelector("[data-auth-error]");
    if (!box) {
      box = document.createElement("p");
      box.className = "mcj-auth-error";
      box.setAttribute("data-auth-error", "true");
      form.appendChild(box);
    }
    box.textContent = message || "";
  }

  function setLoading(btn, loading, idleText) {
    if (!btn) return;
    if (loading) {
      btn.dataset.idleText = btn.dataset.idleText || btn.textContent;
      btn.disabled = true;
      btn.textContent = "登录中…";
    } else {
      btn.disabled = false;
      btn.textContent = idleText || btn.dataset.idleText || "登录";
    }
  }

  function inputKey(el) {
    return String((el && (el.name || el.id || el.getAttribute("autocomplete") || "")) || "").toLowerCase();
  }

  function isCodeInput(el) {
    if (!el || el.tagName !== "INPUT") return false;
    if (el.hasAttribute("data-auth-code") || el.hasAttribute("data-auth-sensitive")) return true;
    var ac = String(el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac === "one-time-code") return true;
    var key = inputKey(el);
    return /(^|[_-])(otp|code|verify|verification)([_-]|$)/.test(key) || /otp|logincode|registercode|authlogincode|authregistercode/.test(key);
  }

  function isPasswordInput(el) {
    if (!el || el.tagName !== "INPUT") return false;
    if (String(el.type || "").toLowerCase() === "password") return true;
    var ac = String(el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac === "current-password" || ac === "new-password") return true;
    var key = inputKey(el);
    return /password|passwd|pwd/.test(key);
  }

  function isAccountInput(el) {
    if (!el || el.tagName !== "INPUT") return false;
    if (String(el.type || "").toLowerCase() === "email") return true;
    var ac = String(el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac === "username" || ac === "email" || ac === "tel") return true;
    var key = inputKey(el);
    return /email|account|username|gmail|phone|dial/.test(key);
  }

  function wipeInput(el) {
    if (!el) return;
    try {
      el.value = "";
      el.defaultValue = "";
    } catch (e) {}
    if (el.hasAttribute("value")) el.setAttribute("value", "");
    try {
      el.removeAttribute("value");
    } catch (e2) {}
  }

  /**
   * Clear residual auth form state (OTP / password / optional account).
   * Call on open, close, and login-method switch.
   */
  function clearAuthFields(root, options) {
    options = options || {};
    var scope = root || document;
    if (!scope || !scope.querySelectorAll) return;
    var clearCode = options.clearCode !== false;
    var clearPassword = options.clearPassword !== false;
    var clearAccount = options.clearAccount === true;
    var clearAll = options.clearAll === true;
    var inputs = scope.querySelectorAll("input, textarea, select");
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var tag = String(el.tagName || "").toUpperCase();
      if (tag === "SELECT") {
        if (clearAll) {
          try {
            el.selectedIndex = 0;
          } catch (e) {}
        }
        continue;
      }
      if (clearAll) {
        wipeInput(el);
        continue;
      }
      if (clearCode && isCodeInput(el)) wipeInput(el);
      else if (clearPassword && isPasswordInput(el)) wipeInput(el);
      else if (clearAccount && isAccountInput(el)) wipeInput(el);
    }
    if (!options.keepErrors) {
      scope.querySelectorAll("[data-login-error], [data-auth-error], #loginState, [data-forgot-msg]").forEach(function (box) {
        box.textContent = "";
        box.classList.remove("is-ok");
      });
    }
  }

  function guardOtpAutofill(el) {
    if (!el || el.dataset.mcjOtpGuard === "1") return;
    el.dataset.mcjOtpGuard = "1";
    el.setAttribute("autocomplete", "one-time-code");
    el.setAttribute("inputmode", el.getAttribute("inputmode") || "numeric");
    el.setAttribute("spellcheck", "false");
    // Discourage password-manager dump into OTP until the user focuses.
    if (!el.hasAttribute("readonly")) el.setAttribute("readonly", "readonly");
    function unlock() {
      el.removeAttribute("readonly");
    }
    el.addEventListener("focus", unlock, { once: true });
    el.addEventListener("pointerdown", unlock, { once: true });
  }

  /**
   * Strip default values / harden autocomplete after auth markup is injected.
   * Re-clears OTP shortly after mount to beat delayed browser autofill.
   */
  function prepareAuthForm(root, options) {
    options = options || {};
    var scope = root || document;
    if (!scope || !scope.querySelectorAll) return;
    clearAuthFields(scope, {
      clearCode: true,
      clearPassword: true,
      clearAccount: options.clearAccount === true,
      keepErrors: options.keepErrors === true,
    });
    var guarded = [];
    scope.querySelectorAll("input").forEach(function (el) {
      if (isCodeInput(el)) {
        el.setAttribute("data-auth-code", "1");
        el.setAttribute("data-auth-sensitive", "1");
        wipeInput(el);
        guardOtpAutofill(el);
        guarded.push(el);
      } else if (isPasswordInput(el)) {
        el.setAttribute("data-auth-sensitive", "1");
        wipeInput(el);
        if (!el.getAttribute("autocomplete")) el.setAttribute("autocomplete", "current-password");
        guarded.push(el);
      } else if (isAccountInput(el)) {
        if (!el.getAttribute("autocomplete")) {
          el.setAttribute("autocomplete", el.type === "email" ? "username" : "username");
        }
        if (options.clearAccount) wipeInput(el);
      }
      if (!el.dataset.mcjAuthTouchBound) {
        el.dataset.mcjAuthTouchBound = "1";
        el.addEventListener(
          "input",
          function () {
            el.dataset.mcjAuthTouched = "1";
          },
          true
        );
        el.addEventListener(
          "keydown",
          function () {
            el.dataset.mcjAuthTouched = "1";
          },
          true
        );
      }
    });
    // Beat late autofill into OTP / password without wiping active typing.
    [50, 160, 360].forEach(function (ms) {
      setTimeout(function () {
        if (scope !== document && !scope.isConnected) return;
        guarded.forEach(function (el) {
          if (!el || !el.isConnected) return;
          if (el.dataset.mcjAuthTouched === "1") return;
          if (el.value) wipeInput(el);
        });
      }, ms);
    });
  }

  global.MCJAuthShell = {
    brandHeader: brandHeader,
    passwordField: passwordField,
    bindPasswordToggles: bindPasswordToggles,
    setFormError: setFormError,
    setLoading: setLoading,
    clearAuthFields: clearAuthFields,
    prepareAuthForm: prepareAuthForm,
    isCodeInput: isCodeInput,
    isPasswordInput: isPasswordInput,
  };
})(window);
