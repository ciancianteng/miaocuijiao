/**
 * Admin boot / Error Boundary — never leave a blank black screen.
 * Safe for login page: does not fetch platform_settings or business APIs.
 */
(function (global) {
  if (global.MCJAdminBootGuard) return;

  var STYLE_ID = "mcj-admin-boot-guard-style";
  var HOST_ID = "mcjAdminBootFail";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = document.createElement("style");
    css.id = STYLE_ID;
    css.textContent =
      "#" +
      HOST_ID +
      "{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;" +
      "padding:24px;background:#07070a;color:#f7f7fb;font-family:Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;}" +
      "#" +
      HOST_ID +
      " .mcj-boot-card{max-width:440px;width:100%;padding:24px;border-radius:16px;background:#16161c;" +
      "border:1px solid rgba(255,143,197,.35);box-shadow:0 18px 48px rgba(0,0,0,.45);}" +
      "#" +
      HOST_ID +
      " h1{margin:0 0 8px;font-size:20px;font-weight:700;}" +
      "#" +
      HOST_ID +
      " p{margin:0 0 14px;line-height:1.5;opacity:.88;}" +
      "#" +
      HOST_ID +
      " pre{margin:0;padding:12px;border-radius:10px;background:rgba(255,255,255,.04);" +
      "font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto;opacity:.75;}" +
      "#" +
      HOST_ID +
      " .mcj-boot-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;}" +
      "#" +
      HOST_ID +
      " button,#" +
      HOST_ID +
      " a.mcj-boot-link{appearance:none;border:0;cursor:pointer;padding:10px 14px;border-radius:10px;" +
      "font:inherit;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;}" +
      "#" +
      HOST_ID +
      " button.primary{background:#ff8fc5;color:#111;}" +
      "#" +
      HOST_ID +
      " a.mcj-boot-link{border:1px solid rgba(255,255,255,.22);color:#f7f7fb;background:transparent;}";
    document.head.appendChild(css);
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function show(detail) {
    try {
      ensureStyle();
      var existing = document.getElementById(HOST_ID);
      if (existing) existing.remove();
      var host = document.createElement("div");
      host.id = HOST_ID;
      host.setAttribute("role", "alert");
      host.innerHTML =
        '<div class="mcj-boot-card">' +
        "<h1>后台初始化失败</h1>" +
        "<p>页面脚本异常。登录页不依赖业务数据；请重新加载，或返回首页。</p>" +
        "<pre>" +
        esc(detail) +
        "</pre>" +
        '<div class="mcj-boot-actions">' +
        '<button type="button" class="primary" data-boot-reload>重新加载</button>' +
        '<a class="mcj-boot-link" href="/">返回首页</a>' +
        "</div></div>";
      (document.body || document.documentElement).appendChild(host);
      var btn = host.querySelector("[data-boot-reload]");
      if (btn) {
        btn.addEventListener("click", function () {
          location.reload();
        });
      }
    } catch (e) {
      try {
        document.body.textContent = "后台初始化失败: " + String(detail || e);
      } catch (_) {}
    }
  }

  function detailFromError(err, source) {
    if (!err) return source || "unknown";
    if (typeof err === "string") return (source ? source + ": " : "") + err;
    var msg = err.message || err.reason || String(err);
    var stack = err.stack || (err.error && err.error.stack) || "";
    return (source ? "[" + source + "] " : "") + msg + (stack ? "\n" + stack : "");
  }

  var ready = false;
  var forceShow = false;

  function markReady() {
    ready = true;
  }

  function install() {
    if (global.__MCJAdminBootGuardInstalled) return;
    global.__MCJAdminBootGuardInstalled = true;
    global.addEventListener("error", function (ev) {
      // Script/module load failures during init — not images/fonts.
      if (ev && ev.target && ev.target !== global && ev.target.tagName) {
        var tag = String(ev.target.tagName || "").toUpperCase();
        if (tag === "SCRIPT" && !ready) {
          var src = ev.target.src || "(inline)";
          show("脚本加载失败: " + src);
        }
        return;
      }
      if (ready && !forceShow) return;
      var msg = detailFromError(ev.error || ev.message, "error");
      if (/ResizeObserver|Script error\.?/i.test(String(ev.message || ""))) return;
      show(msg);
    }, true);
    global.addEventListener("unhandledrejection", function (ev) {
      if (ready && !forceShow) return;
      show(detailFromError(ev.reason, "unhandledrejection"));
    });
  }

  install();

  global.MCJAdminBootGuard = {
    show: function (detail) {
      forceShow = true;
      show(detail);
    },
    markReady: markReady,
    install: install,
  };
})(typeof window !== "undefined" ? window : globalThis);
