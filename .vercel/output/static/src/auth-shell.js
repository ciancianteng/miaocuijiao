(function (global) {
  var EYE_OPEN =
    '<svg class="mcj-auth-eye-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M12 5c-5.5 0-9.5 4.5-10.8 6.3a1.2 1.2 0 0 0 0 1.4C2.5 14.5 6.5 19 12 19s9.5-4.5 10.8-6.3a1.2 1.2 0 0 0 0-1.4C21.5 9.5 17.5 5 12 5zm0 12c-3.7 0-6.8-2.9-8.2-5C5.2 9.9 8.3 7 12 7s6.8 2.9 8.2 5c-1.4 2.1-4.5 5-8.2 5zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>' +
    "</svg>";
  var EYE_OFF =
    '<svg class="mcj-auth-eye-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M3.3 2.3 2 3.6l3.1 3.1C3.4 8.1 2.2 9.6 1.2 11a1.2 1.2 0 0 0 0 1.4C2.5 14.5 6.5 19 12 19c2.1 0 4-.6 5.6-1.5l3.4 3.4 1.3-1.3L3.3 2.3zM12 17c-3.7 0-6.8-2.9-8.2-5 .7-1 1.8-2.2 3.2-3.1l1.6 1.6A3 3 0 0 0 12 15c.5 0 1-.1 1.4-.3l1.5 1.5c-.9.5-1.9.8-2.9.8zm8.8-4.7c-.4.6-.9 1.2-1.5 1.8l-1.4-1.4c.6-.5 1.1-1.1 1.5-1.7C18.8 9.9 15.7 7 12 7c-.5 0-1 .1-1.5.2L8.9 5.6C9.9 5.2 10.9 5 12 5c5.5 0 9.5 4.5 10.8 6.3a1.2 1.2 0 0 1 0 1.4z"/>' +
    "</svg>";

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
      ">" +
      '<button class="mcj-auth-eye" type="button" tabindex="-1" data-toggle-password aria-label="显示密码" aria-pressed="false" title="显示密码">' +
      EYE_OPEN +
      "</button>" +
      "</div></label>"
    );
  }

  function setEyeState(btn, showPlain) {
    if (!btn) return;
    btn.innerHTML = showPlain ? EYE_OFF : EYE_OPEN;
    btn.setAttribute("aria-pressed", showPlain ? "true" : "false");
    btn.setAttribute("aria-label", showPlain ? "隐藏密码" : "显示密码");
    btn.setAttribute("title", showPlain ? "隐藏密码" : "显示密码");
  }

  function bindPasswordToggles(root) {
    (root || document).addEventListener("click", function (e) {
      var btn = e.target.closest("[data-toggle-password]");
      if (!btn) return;
      e.preventDefault();
      var wrap = btn.closest(".mcj-auth-password, .password-field") || btn.parentElement;
      var input = wrap && wrap.querySelector("input");
      if (!input) return;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      setEyeState(btn, show);
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

  global.MCJAuthShell = {
    brandHeader: brandHeader,
    passwordField: passwordField,
    bindPasswordToggles: bindPasswordToggles,
    setFormError: setFormError,
    setLoading: setLoading,
    eyeIcons: { open: EYE_OPEN, off: EYE_OFF },
  };
})(window);
