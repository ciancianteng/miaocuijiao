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
      ">" +
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

  global.MCJAuthShell = {
    brandHeader: brandHeader,
    passwordField: passwordField,
    bindPasswordToggles: bindPasswordToggles,
    setFormError: setFormError,
    setLoading: setLoading,
  };
})(window);
