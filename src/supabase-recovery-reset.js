/**
 * Supabase Auth password-recovery landing (Dashboard "Send password recovery").
 *
 * Expected URL (implicit):
 *   /auth/reset-password/#access_token=...&refresh_token=...&type=recovery
 * or Site URL root / with the same hash (redirected here by bootstrap).
 *
 * Flow: detect recovery session → Set New Password form → auth.updateUser({ password }).
 * Uses anon key from /api/public/realtime-config only (never service_role).
 */
(function (global) {
  "use strict";

  if (global.MCJSupabaseRecoveryReset) return;

  var LOCAL_SDK = "/vendor/supabase.js";
  var CDN_SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.js";
  var STYLE_ID = "mcj-recovery-reset-style";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function parseHashParams() {
    var raw = String(location.hash || "").replace(/^#/, "");
    var out = {};
    if (!raw) return out;
    raw.split("&").forEach(function (part) {
      var i = part.indexOf("=");
      if (i < 0) return;
      var k = decodeURIComponent(part.slice(0, i).replace(/\+/g, " "));
      var v = decodeURIComponent(part.slice(i + 1).replace(/\+/g, " "));
      out[k] = v;
    });
    return out;
  }

  function parseQueryParams() {
    var out = {};
    try {
      var sp = new URLSearchParams(location.search || "");
      sp.forEach(function (v, k) {
        out[k] = v;
      });
    } catch (e) {}
    return out;
  }

  /** True when URL looks like a Supabase recovery callback (strict — used for auto-redirect). */
  function looksLikeRecoveryUrl() {
    var hash = parseHashParams();
    var q = parseQueryParams();
    var type = String(hash.type || q.type || "").toLowerCase();
    if (type === "recovery") return true;
    // Implicit recovery usually includes type=recovery; also accept token pair on reset path only.
    if (/\/auth\/reset-password\/?/i.test(String(location.pathname || ""))) {
      if (hash.access_token && hash.refresh_token) return true;
      if (q.code && !q.error) return true;
    }
    return false;
  }

  function loadSdk() {
    if (global.supabase && global.supabase.createClient) return Promise.resolve(global.supabase);
    return new Promise(function (resolve, reject) {
      function attach(src, isFallback) {
        var s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = function () {
          if (global.supabase && global.supabase.createClient) resolve(global.supabase);
          else if (!isFallback) attach(CDN_SDK, true);
          else reject(new Error("Supabase SDK 加载失败"));
        };
        s.onerror = function () {
          if (!isFallback) attach(CDN_SDK, true);
          else reject(new Error("Supabase SDK 网络加载失败"));
        };
        document.head.appendChild(s);
      }
      attach(LOCAL_SDK, false);
    });
  }

  function fetchAnonConfig() {
    return fetch("/api/public/realtime-config", { credentials: "same-origin", cache: "no-store" }).then(function (r) {
      return r.json().then(function (body) {
        if (!body || !body.ok || !body.url || !body.anonKey) {
          throw new Error((body && body.message) || "Auth 客户端未配置");
        }
        return body;
      });
    });
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = document.createElement("style");
    css.id = STYLE_ID;
    css.textContent =
      ".mcj-recovery-page{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(1200px 600px at 50% -10%,rgba(255,120,180,.18),transparent),#07070a;color:#f7f7fb;font-family:Segoe UI,PingFang SC,Microsoft YaHei,sans-serif}" +
      ".mcj-recovery-card{width:min(440px,100%);padding:28px 24px;border-radius:18px;border:1px solid rgba(255,160,200,.28);background:linear-gradient(165deg,rgba(36,20,32,.98),rgba(12,10,16,.98));box-shadow:0 18px 48px rgba(0,0,0,.45)}" +
      ".mcj-recovery-card h1{margin:0 0 8px;font-size:1.35rem;font-weight:800;color:#ffe6f1}" +
      ".mcj-recovery-card .desc{margin:0 0 20px;font-size:14px;line-height:1.5;color:rgba(255,220,235,.78)}" +
      ".mcj-recovery-card label{display:flex;flex-direction:column;gap:8px;margin:0 0 14px;font-size:13px;font-weight:700;color:#ffd6e7}" +
      ".mcj-recovery-card input{appearance:none;width:100%;box-sizing:border-box;min-height:48px;padding:10px 14px;border-radius:14px;border:1px solid rgba(255,160,200,.28);background:rgba(8,8,12,.75);color:#fff;font-size:15px;font-family:inherit}" +
      ".mcj-recovery-card input:focus{outline:none;border-color:rgba(255,143,197,.75);box-shadow:0 0 0 2px rgba(255,143,197,.22)}" +
      ".mcj-recovery-card button{appearance:none;width:100%;min-height:48px;margin-top:6px;border:0;border-radius:14px;font-size:15px;font-weight:800;font-family:inherit;cursor:pointer;background:linear-gradient(135deg,#ff8fc5,#ff6aa8);color:#1a0812}" +
      ".mcj-recovery-card button:disabled{opacity:.55;cursor:not-allowed}" +
      ".mcj-recovery-card .msg{min-height:1.2em;margin:12px 0 0;font-size:13px;font-weight:700;color:#ff8fc5;line-height:1.35}" +
      ".mcj-recovery-card .msg.is-ok{color:#9dffc2}" +
      ".mcj-recovery-card .links{margin-top:16px;display:flex;flex-wrap:wrap;gap:12px}" +
      ".mcj-recovery-card .links a{color:#ffd6e7;font-size:13px;font-weight:700}";
    document.head.appendChild(css);
  }

  function mountShell(root) {
    ensureStyles();
    root.className = (root.className || "") + " mcj-recovery-page";
    root.innerHTML =
      '<div class="mcj-recovery-card" data-recovery-card>' +
      "<h1>设置新密码</h1>" +
      '<p class="desc" data-recovery-desc>正在验证重置链接…</p>' +
      '<form data-recovery-form hidden>' +
      '<label>新密码<input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="至少 8 位"></label>' +
      '<label>确认新密码<input name="password2" type="password" autocomplete="new-password" minlength="8" required placeholder="再次输入新密码"></label>' +
      '<button type="submit" data-recovery-submit>保存新密码</button>' +
      "</form>" +
      '<p class="msg" data-recovery-msg></p>' +
      '<div class="links"><a href="/admin/login/">返回后台登录</a><a href="/">返回首页</a></div>' +
      "</div>";
    return {
      desc: root.querySelector("[data-recovery-desc]"),
      form: root.querySelector("[data-recovery-form]"),
      msg: root.querySelector("[data-recovery-msg]"),
      submit: root.querySelector("[data-recovery-submit]"),
    };
  }

  function setMsg(ui, text, ok) {
    if (!ui.msg) return;
    ui.msg.textContent = text || "";
    ui.msg.className = "msg" + (ok ? " is-ok" : "");
  }

  function clearHashKeepPath() {
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {}
  }

  function createRecoveryClient(sb, cfg) {
    return sb.createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "implicit",
      },
    });
  }

  async function establishRecoverySession(client) {
    var hash = parseHashParams();
    var q = parseQueryParams();
    var ready = false;
    var recoveryEvent = false;

    var unsub = client.auth.onAuthStateChange(function (event) {
      if (event === "PASSWORD_RECOVERY") recoveryEvent = true;
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "PASSWORD_RECOVERY") {
        ready = true;
      }
    });

    // Implicit grant: tokens in hash
    if (hash.access_token && hash.refresh_token) {
      var setRes = await client.auth.setSession({
        access_token: hash.access_token,
        refresh_token: hash.refresh_token,
      });
      if (setRes.error) throw setRes.error;
      if (String(hash.type || "").toLowerCase() === "recovery") recoveryEvent = true;
      clearHashKeepPath();
    } else if (q.code) {
      // PKCE code exchange (if enabled on project)
      var exch = await client.auth.exchangeCodeForSession(String(q.code));
      if (exch.error) throw exch.error;
      try {
        history.replaceState(null, "", location.pathname);
      } catch (e) {}
    } else {
      // detectSessionInUrl may already have consumed; fall through to getSession
      await new Promise(function (r) {
        setTimeout(r, 50);
      });
    }

    var sessionRes = await client.auth.getSession();
    if (sessionRes.error) throw sessionRes.error;
    var session = sessionRes.data && sessionRes.data.session;
    if (!session) {
      try {
        if (unsub && unsub.data && unsub.data.subscription) unsub.data.subscription.unsubscribe();
      } catch (e) {}
      throw new Error("重置链接无效或已过期，请重新发送密码恢复邮件。");
    }

    // Prefer PASSWORD_RECOVERY; allow type=recovery hash or any valid session from recovery link.
    if (!recoveryEvent && String(hash.type || q.type || "").toLowerCase() !== "recovery") {
      // Session exists from link — still allow password update (Dashboard recovery).
      recoveryEvent = true;
    }

    return { session: session, recoveryEvent: recoveryEvent, unsub: unsub };
  }

  function loginPathForEmail(email) {
    // Default admin login for production admin recovery; generic fallback homepage.
    if (/admin|meowcuijiao/i.test(String(email || ""))) return "/admin/login/";
    return "/admin/login/";
  }

  /**
   * @param {HTMLElement|string} rootOrSelector
   */
  function mount(rootOrSelector) {
    var root =
      typeof rootOrSelector === "string"
        ? document.querySelector(rootOrSelector)
        : rootOrSelector || document.getElementById("recoveryResetApp");
    if (!root) throw new Error("缺少重置密码根节点");

    var ui = mountShell(root);
    var busy = false;

    return Promise.all([loadSdk(), fetchAnonConfig()])
      .then(function (pair) {
        var client = createRecoveryClient(pair[0], pair[1]);
        return establishRecoverySession(client).then(function (ctx) {
          var email = (ctx.session.user && ctx.session.user.email) || "";
          ui.desc.textContent = email
            ? "已验证重置链接（" + email + "）。请设置新密码。"
            : "已验证重置链接。请设置新密码。";
          ui.form.hidden = false;
          setMsg(ui, "", false);

          ui.form.addEventListener("submit", function (e) {
            e.preventDefault();
            if (busy) return;
            var fd = new FormData(ui.form);
            var password = String(fd.get("password") || "");
            var password2 = String(fd.get("password2") || "");
            if (password.length < 8) {
              setMsg(ui, "密码至少 8 位。", false);
              return;
            }
            if (password !== password2) {
              setMsg(ui, "两次输入的密码不一致。", false);
              return;
            }
            busy = true;
            ui.submit.disabled = true;
            setMsg(ui, "正在保存…", false);
            client.auth
              .updateUser({ password: password })
              .then(function (res) {
                if (res.error) throw res.error;
                setMsg(ui, "密码已更新，请使用新密码登录。", true);
                ui.form.hidden = true;
                ui.desc.textContent = "密码修改成功。";
                return client.auth.signOut().catch(function () {});
              })
              .then(function () {
                setTimeout(function () {
                  location.replace(loginPathForEmail(email));
                }, 1200);
              })
              .catch(function (err) {
                busy = false;
                ui.submit.disabled = false;
                setMsg(ui, (err && err.message) || "保存失败，请重试。", false);
              });
          });
        });
      })
      .catch(function (err) {
        ui.form.hidden = true;
        ui.desc.textContent = "无法打开重置页面";
        setMsg(ui, (err && err.message) || "重置链接无效或已过期。", false);
      });
  }

  /**
   * If current location has recovery tokens and is not already the reset page,
   * redirect to /auth/reset-password/ keeping hash/query.
   */
  function redirectIfRecoveryCallback() {
    var path = String(location.pathname || "");
    if (/\/auth\/reset-password\/?/i.test(path)) return false;
    if (!looksLikeRecoveryUrl()) return false;
    var target = "/auth/reset-password/" + (location.search || "") + (location.hash || "");
    location.replace(target);
    return true;
  }

  global.MCJSupabaseRecoveryReset = {
    mount: mount,
    looksLikeRecoveryUrl: looksLikeRecoveryUrl,
    redirectIfRecoveryCallback: redirectIfRecoveryCallback,
  };

  // Auto-redirect from Site URL landings (/ or /admin/login/) as early as this script loads.
  try {
    redirectIfRecoveryCallback();
  } catch (e) {}
})(typeof window !== "undefined" ? window : globalThis);
