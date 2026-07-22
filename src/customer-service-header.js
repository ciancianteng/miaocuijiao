(function () {
  function init() {
    if (!window.MCJRoleGate) return;
    window.MCJRoleGate.guard("customer_service");
    var gate = document.querySelector("[data-service-login]");
    var app = document.querySelector("[data-service-app]");
    if (!window.MCJRoleGate.isLogged("customer_service")) {
      if (gate) gate.classList.remove("hide");
      if (app) app.style.display = "none";
    } else {
      if (gate) gate.classList.add("hide");
      if (app) app.style.display = "";
    }
    document.querySelectorAll("[data-service-login-submit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var form = btn.closest("[data-service-login]");
        var idInput = form && form.querySelector('input[name="userId"]');
        var userId = idInput && idInput.value.trim();
        if (!userId) {
          if (idInput) idInput.focus();
          return;
        }
        window.MCJRoleGate.login("customer_service", userId);
        location.reload();
      });
    });
    document.querySelectorAll("[data-service-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-service-view");
        document.querySelectorAll("[data-service-view]").forEach(function (x) { x.classList.toggle("active", x === btn); });
        document.querySelectorAll(".service-view").forEach(function (view) { view.classList.toggle("active", view.id === "service-" + id); });
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
