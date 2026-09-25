/**
 * 使用教学：老板 / 陪玩 Accordion（默认折叠，点击展开）
 * 保留现有深色粉卡片风格；?mode=walkthrough 仍可逐步翻页
 */
(function () {
  "use strict";

  var CFG = window.MCJ_GUIDE_TUTORIAL || {};
  var root =
    document.getElementById("mcjGuideRoot") ||
    document.getElementById("guide-tutorial-root");
  if (!root) return;

  var params = new URLSearchParams(window.location.search || "");
  var roleParam = String(params.get("role") || "").toLowerCase();
  var mode = String(params.get("mode") || "accordion").toLowerCase();
  var activeTab = roleParam === "companion" ? "companion" : "boss";
  var openId = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderFlow(flow) {
    if (!flow || !flow.length) return "";
    return (
      '<ol class="mcj-guide-flow">' +
      flow
        .map(function (step, i) {
          return (
            '<li class="mcj-guide-flow-item">' +
            '<span class="mcj-guide-flow-n">' +
            (i + 1) +
            "</span>" +
            '<span class="mcj-guide-flow-t">' +
            esc(step) +
            "</span></li>"
          );
        })
        .join("") +
      "</ol>"
    );
  }

  function renderBody(body) {
    if (!body || !body.length) return "";
    return (
      '<ul class="mcj-guide-bullets">' +
      body
        .map(function (line) {
          return "<li>" + esc(line) + "</li>";
        })
        .join("") +
      "</ul>"
    );
  }

  function isCompanionLoggedIn() {
    try {
      var token =
        localStorage.getItem("companionAuthToken") ||
        sessionStorage.getItem("companionAuthToken") ||
        "";
      if (!token) return false;
      var raw =
        localStorage.getItem("companionUser") ||
        sessionStorage.getItem("companionUser") ||
        "";
      if (!raw) return true;
      var u = JSON.parse(raw);
      return !!(u && (u.id || u.user_id || u.userId || u.email));
    } catch (e) {
      return false;
    }
  }

  function companionEntryHref() {
    return isCompanionLoggedIn() ? "/companion/dashboard/" : "/companion/login/";
  }

  /** Compact shortcut for 陪玩教学 tab only — whole control is one tap. */
  function renderCompanionShortcut() {
    var logged = isCompanionLoggedIn();
    var href = companionEntryHref();
    var label = logged ? "进入陪玩工作台 →" : "进入陪玩端 →";
    return (
      '<div class="mcj-guide-companion-shortcut">' +
      '<a class="mcj-guide-companion-go" href="' +
      esc(href) +
      '" data-guide-companion-go="1">' +
      esc(label) +
      "</a></div>"
    );
  }

  function renderLoginCta(opts) {
    opts = opts || {};
    var id = opts.id || "guide-companion-login";
    var logged = isCompanionLoggedIn();
    var href = companionEntryHref();
    var label = logged
      ? "进入陪玩工作台"
      : CFG.companionLoginLabel || "陪玩登录";
    var hint = logged
      ? "已登录陪玩账号，可直接进入工作台、抢单、订单与收益。"
      : CFG.companionLoginHint || "";
    return (
      '<section class="mcj-guide-login-cta" id="' +
      esc(id) +
      '" data-guide-companion-login="1">' +
      "<h2>" +
      esc(label) +
      "</h2>" +
      (hint ? "<p>" + esc(hint) + "</p>" : "") +
      '<a class="mcj-guide-login-btn" href="' +
      esc(href) +
      '" data-guide-companion-login-link="1">' +
      esc(label) +
      " →</a>" +
      "</section>"
    );
  }

  function renderAccordionItem(step, sectionKey) {
    var isOpen = openId === step.id;
    return (
      '<div class="mcj-guide-acc-item' +
      (isOpen ? " is-open" : "") +
      '" id="guide-' +
      esc(step.id) +
      '" data-section="' +
      esc(sectionKey) +
      '" data-step-id="' +
      esc(step.id) +
      '">' +
      '<button type="button" class="mcj-guide-acc-trigger" aria-expanded="' +
      (isOpen ? "true" : "false") +
      '" data-acc-toggle="' +
      esc(step.id) +
      '">' +
      '<span class="mcj-guide-doc-no" aria-hidden="true">' +
      esc(step.no) +
      "</span>" +
      '<span class="mcj-guide-doc-icon" aria-hidden="true">' +
      esc(step.icon || "•") +
      "</span>" +
      '<span class="mcj-guide-acc-text">' +
      '<span class="mcj-guide-doc-card-title">' +
      esc(step.title) +
      "</span>" +
      (step.caption
        ? '<span class="mcj-guide-doc-card-cap">' + esc(step.caption) + "</span>"
        : "") +
      "</span>" +
      '<span class="mcj-guide-acc-chevron" aria-hidden="true"></span>' +
      "</button>" +
      '<div class="mcj-guide-acc-panel" role="region"' +
      (isOpen ? "" : " hidden") +
      ">" +
      '<div class="mcj-guide-acc-panel-inner">' +
      renderFlow(step.flow) +
      renderBody(step.body) +
      (step.tip
        ? '<p class="mcj-guide-doc-tip"><strong>提醒：</strong>' +
          esc(step.tip) +
          "</p>"
        : "") +
      "</div></div></div>"
    );
  }

  function paintAccordion() {
    var boss = CFG.boss || {};
    var companion = CFG.companion || {};
    var section = activeTab === "companion" ? companion : boss;
    var key = activeTab === "companion" ? "companion" : "boss";
    var steps = (section && section.steps) || [];
    var items = steps
      .map(function (s) {
        return renderAccordionItem(s, key);
      })
      .join("");

    root.innerHTML =
      '<div class="mcj-guide" data-guide-accordion="1">' +
      '<div class="mcj-guide-doc">' +
      '<header class="mcj-guide-doc-hero">' +
      '<p class="mcj-guide-kicker">妙脆角 · 使用教学</p>' +
      "<h1>" +
      esc(CFG.pageTitle || "使用教学") +
      "</h1>" +
      '<p class="mcj-guide-doc-lead">' +
      esc(CFG.pageSubtitle || "") +
      "</p>" +
      "</header>" +
      '<div class="mcj-guide-tabs" role="tablist" aria-label="教学角色">' +
      '<button type="button" class="mcj-guide-tab' +
      (activeTab === "boss" ? " is-active" : "") +
      '" role="tab" aria-selected="' +
      (activeTab === "boss" ? "true" : "false") +
      '" data-guide-tab="boss">老板教学</button>' +
      '<button type="button" class="mcj-guide-tab' +
      (activeTab === "companion" ? " is-active" : "") +
      '" role="tab" aria-selected="' +
      (activeTab === "companion" ? "true" : "false") +
      '" data-guide-tab="companion">陪玩教学</button>' +
      "</div>" +
      '<div class="mcj-guide-acc-toolbar">' +
      '<p class="mcj-guide-acc-hint">点标题展开步骤，再次点击可收起。建议一次只看一步。</p>' +
      '<div class="mcj-guide-acc-actions">' +
      '<button type="button" class="mcj-guide-acc-tool" data-acc-expand-all>展开全部</button>' +
      '<button type="button" class="mcj-guide-acc-tool" data-acc-collapse-all>收起全部</button>' +
      "</div></div>" +
      '<section class="mcj-guide-doc-section" data-guide-section="' +
      esc(key) +
      '" id="guide-section-' +
      esc(key) +
      '">' +
      '<div class="mcj-guide-doc-section-head">' +
      '<span class="mcj-guide-doc-badge">' +
      esc(section.badge || "") +
      "</span>" +
      "<h2>" +
      esc(section.title || "") +
      "</h2>" +
      (section.subtitle
        ? '<p class="mcj-guide-doc-section-sub">' + esc(section.subtitle) + "</p>"
        : "") +
      (activeTab === "companion" ? renderCompanionShortcut() : "") +
      "</div>" +
      (activeTab === "companion" ? renderLoginCta({ id: "guide-companion-login" }) : "") +
      '<div class="mcj-guide-acc" data-acc-root="' +
      esc(key) +
      '">' +
      items +
      "</div>" +
      (activeTab === "companion"
        ? '<div class="mcj-guide-login-cta-foot">' +
          renderLoginCta({ id: "guide-companion-login-foot" }) +
          "</div>"
        : "") +
      "</section>" +
      (activeTab === "boss"
        ? '<p class="mcj-guide-switch-hint">想接单？切换到上方「陪玩教学」，可用菜单里的「陪玩登录」或教学内快捷入口进入陪玩端。</p>'
        : "") +
      "</div></div>";

    root.setAttribute("data-guide-mode", "accordion");
    root.setAttribute("data-guide-ready", "1");
    root.setAttribute("data-guide-tab", activeTab);
    document.title = (CFG.pageTitle || "使用教学") + " · 妙脆角";
    bindAccordion();
  }

  function setOpen(id, exclusive) {
    if (exclusive !== false) {
      openId = id;
      var items = root.querySelectorAll(".mcj-guide-acc-item");
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var sid = el.getAttribute("data-step-id");
        var on = sid === openId;
        el.classList.toggle("is-open", on);
        var btn = el.querySelector(".mcj-guide-acc-trigger");
        var panel = el.querySelector(".mcj-guide-acc-panel");
        if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
        if (panel) {
          if (on) panel.removeAttribute("hidden");
          else panel.setAttribute("hidden", "");
        }
      }
      return;
    }
    // expand all mode: openId ignored; toggle class on each
  }

  function bindAccordion() {
    root.querySelectorAll("[data-guide-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.getAttribute("data-guide-tab");
        if (!tab || tab === activeTab) return;
        activeTab = tab;
        openId = null;
        try {
          var u = new URL(window.location.href);
          if (tab === "companion") u.searchParams.set("role", "companion");
          else u.searchParams.set("role", "boss");
          history.replaceState({}, "", u.pathname + u.search);
        } catch (_) {}
        paintAccordion();
      });
    });

    root.querySelectorAll("[data-acc-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-acc-toggle");
        if (openId === id) {
          openId = null;
          setOpen(null);
        } else {
          setOpen(id);
          try {
            var item = root.querySelector('[data-step-id="' + id + '"]');
            if (item)
              item.scrollIntoView({ behavior: "smooth", block: "nearest" });
          } catch (_) {}
        }
      });
    });

    var expandAll = root.querySelector("[data-acc-expand-all]");
    var collapseAll = root.querySelector("[data-acc-collapse-all]");
    if (expandAll) {
      expandAll.addEventListener("click", function () {
        openId = "__ALL__";
        root.querySelectorAll(".mcj-guide-acc-item").forEach(function (el) {
          el.classList.add("is-open");
          var b = el.querySelector(".mcj-guide-acc-trigger");
          var p = el.querySelector(".mcj-guide-acc-panel");
          if (b) b.setAttribute("aria-expanded", "true");
          if (p) p.removeAttribute("hidden");
        });
      });
    }
    if (collapseAll) {
      collapseAll.addEventListener("click", function () {
        openId = null;
        setOpen(null);
      });
    }
  }

  /* walkthrough kept for ?mode=walkthrough */
  function paintWalkthrough() {
    var section = activeTab === "companion" ? CFG.companion : CFG.boss;
    var steps = (section && section.steps) || [];
    var idx = 0;
    function paint() {
      var step = steps[idx] || {};
      root.innerHTML =
        '<div class="mcj-guide"><div class="mcj-guide-shell">' +
        '<div class="mcj-guide-top"><a class="mcj-guide-back back" href="/guide.html">← 抽屉教学</a>' +
        '<span class="mcj-guide-progress">' +
        (idx + 1) +
        " / " +
        steps.length +
        "</span></div>" +
        '<div class="mcj-guide-body"><div class="mcj-guide-step">' +
        '<h2 class="mcj-guide-step-title">' +
        esc(step.no) +
        " · " +
        esc(step.title) +
        "</h2>" +
        (step.caption
          ? '<p class="mcj-guide-step-cap">' + esc(step.caption) + "</p>"
          : "") +
        renderFlow(step.flow) +
        renderBody(step.body) +
        "</div>" +
        '<div class="mcj-guide-nav" style="display:grid;grid-template-columns:1fr 1.4fr;gap:10px;margin-top:20px">' +
        '<button type="button" class="mcj-guide-btn" data-prev ' +
        (idx === 0 ? "disabled" : "") +
        ">上一步</button>" +
        '<button type="button" class="mcj-guide-btn primary" data-next>' +
        (idx >= steps.length - 1 ? "完成" : "下一步") +
        "</button></div></div></div></div>";
      var prev = root.querySelector("[data-prev]");
      var next = root.querySelector("[data-next]");
      if (prev)
        prev.addEventListener("click", function () {
          idx = Math.max(0, idx - 1);
          paint();
        });
      if (next)
        next.addEventListener("click", function () {
          if (idx >= steps.length - 1) {
            location.href = "/guide.html";
            return;
          }
          idx += 1;
          paint();
        });
    }
    paint();
  }

  if (mode === "walkthrough") {
    paintWalkthrough();
  } else {
    paintAccordion();
  }
})();
