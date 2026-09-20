(function () {
  "use strict";

  var cfg = window.MCJGuideTutorialConfig;
  if (!cfg || !cfg.roles) return;

  var root = document.getElementById("mcjGuideRoot");
  if (!root) return;

  var params = new URLSearchParams(location.search);
  var state = {
    view: "picker", // picker | step | done
    role: "",
    index: 0,
  };

  var bootRole = String(params.get("role") || "").toLowerCase();
  if (bootRole === "boss" || bootRole === "companion") {
    state.role = bootRole;
    state.view = "step";
    state.index = Math.max(0, Number(params.get("step") || 1) - 1);
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function roleCfg() {
    return cfg.roles[state.role] || null;
  }

  function steps() {
    var r = roleCfg();
    return (r && r.steps) || [];
  }

  function syncUrl() {
    var u = new URL(location.href);
    if (state.view === "picker") {
      u.searchParams.delete("role");
      u.searchParams.delete("step");
    } else {
      u.searchParams.set("role", state.role);
      if (state.view === "step") u.searchParams.set("step", String(state.index + 1));
      else u.searchParams.delete("step");
    }
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  }

  function assetUrl(slot) {
    return "/assets/guide/" + encodeURIComponent(slot) + ".png";
  }

  function phoneVisual(step) {
    var slot = step.visualSlot || "slot";
    var label = step.visualLabel || slot;
    var hl = step.highlight || "";
    var mock = step.visualMock || "";
    var mockBlock = mock
      ? '<div class="mcj-guide-mock" data-guide-mock>' + mock + "</div>"
      : "";
    return (
      '<div class="mcj-guide-phone" data-slot="' +
      esc(slot) +
      '">' +
      '<img alt="" hidden data-guide-shot src="' +
      esc(assetUrl(slot)) +
      '">' +
      (mockBlock ||
        '<div class="mcj-guide-phone-placeholder" data-guide-ph>' +
          '<span class="slot-badge">待补真实截图</span>' +
          '<div class="slot-stage">' +
          "<strong>" +
          esc(label) +
          "</strong>" +
          "<small>请放入手机比例真实截图<br><code>assets/guide/" +
          esc(slot) +
          ".png</code></small>" +
          '<div class="mcj-guide-hl" data-label="' +
          esc(hl) +
          '"></div>' +
          "</div></div>") +
      (mock
        ? '<div class="mcj-guide-phone-placeholder" data-guide-ph hidden></div>'
        : "") +
      "</div>"
    );
  }

  function bindShot(el) {
    var img = el.querySelector("[data-guide-shot]");
    var ph = el.querySelector("[data-guide-ph]");
    var mock = el.querySelector("[data-guide-mock]");
    if (!img) return;
    img.addEventListener("load", function () {
      img.hidden = false;
      if (ph) ph.hidden = true;
      if (mock) mock.hidden = true;
    });
    img.addEventListener("error", function () {
      img.hidden = true;
      if (mock) {
        mock.hidden = false;
        if (ph) ph.hidden = true;
      } else if (ph) {
        ph.hidden = false;
      }
    });
  }

  function paintPicker() {
    return (
      '<p class="mcj-guide-lead">请选择你想了解：约 1～2 分钟走完真实流程示意。</p>' +
      '<div class="mcj-guide-cards">' +
      Object.keys(cfg.roles)
        .map(function (key) {
          var r = cfg.roles[key];
          return (
            '<button type="button" class="mcj-guide-card" data-pick-role="' +
            esc(key) +
            '">' +
            '<span class="emoji" aria-hidden="true">' +
            esc(r.cardEmoji) +
            "</span>" +
            "<strong>" +
            esc(r.cardTitle) +
            "</strong>" +
            "<span>" +
            esc(r.cardDesc) +
            "</span></button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function paintStep() {
    var r = roleCfg();
    var list = steps();
    if (!r || !list.length) return paintPicker();
    if (state.index >= list.length) {
      state.view = "done";
      return paintDone();
    }
    var step = list[state.index];
    var n = list.length;
    var i = state.index + 1;
    return (
      '<div class="mcj-guide-progress"><span>' +
      esc(r.flowTitle) +
      '</span><strong>' +
      i +
      " / " +
      n +
      "</strong></div>" +
      '<h2 class="mcj-guide-step-title">' +
      esc(step.title) +
      "</h2>" +
      '<p class="mcj-guide-step-cap">' +
      esc(step.caption) +
      "</p>" +
      phoneVisual(step) +
      '<div class="mcj-guide-arrow" aria-hidden="true">↓</div>' +
      '<p class="mcj-guide-step-cap" style="text-align:center;margin-bottom:0">① 对照高亮区域　② 按说明操作</p>'
    );
  }

  function paintDone() {
    var r = roleCfg();
    if (!r) return paintPicker();
    return (
      '<div class="mcj-guide-done">' +
      "<h2>" +
      esc(r.doneTitle) +
      "</h2>" +
      "<p>" +
      esc(r.doneBody) +
      "</p>" +
      '<a class="mcj-guide-btn primary" href="' +
      esc(r.doneHref) +
      '">' +
      esc(r.doneCta) +
      "</a>" +
      '<p class="mcj-guide-home-hint"><a href="/guide.html">返回角色选择</a></p>' +
      "</div>"
    );
  }

  function footerHtml() {
    if (state.view !== "step") return "";
    var list = steps();
    var atStart = state.index <= 0;
    var atEnd = state.index >= list.length - 1;
    return (
      '<div class="mcj-guide-footer"><div class="mcj-guide-footer-inner">' +
      '<button type="button" class="mcj-guide-btn" data-prev' +
      (atStart ? " disabled" : "") +
      ">上一页</button>" +
      '<button type="button" class="mcj-guide-btn primary" data-next>' +
      (atEnd ? "完成" : "下一步") +
      "</button>" +
      "</div></div>"
    );
  }

  function paint() {
    syncUrl();
    var title = "新手教学";
    if (state.view === "step" && roleCfg()) title = roleCfg().flowTitle;
    if (state.view === "done" && roleCfg()) title = "教学完成";
    var backHref = state.view === "picker" ? "/mine.html" : "/guide.html";
    var backLabel = state.view === "picker" ? "返回" : "角色";
    var body =
      state.view === "picker" ? paintPicker() : state.view === "done" ? paintDone() : paintStep();
    root.innerHTML =
      '<div class="mcj-guide">' +
      '<header class="mcj-guide-top">' +
      '<a class="back" href="' +
      esc(backHref) +
      '">' +
      esc(backLabel) +
      "</a>" +
      "<h1>" +
      esc(title) +
      "</h1>" +
      '<button type="button" class="skip" data-skip>跳过</button>' +
      "</header>" +
      '<main class="mcj-guide-body">' +
      body +
      "</main>" +
      footerHtml() +
      "</div>";
    root.querySelectorAll(".mcj-guide-phone").forEach(bindShot);
  }

  root.addEventListener("click", function (e) {
    var pick = e.target.closest("[data-pick-role]");
    if (pick) {
      state.role = pick.getAttribute("data-pick-role") || "boss";
      state.index = 0;
      state.view = "step";
      paint();
      return;
    }
    if (e.target.closest("[data-skip]")) {
      var r = roleCfg();
      if (r && r.doneHref) location.assign(r.doneHref);
      else location.assign("/mine.html");
      return;
    }
    if (e.target.closest("[data-prev]")) {
      if (state.index > 0) {
        state.index -= 1;
        paint();
      }
      return;
    }
    if (e.target.closest("[data-next]")) {
      var list = steps();
      if (state.index >= list.length - 1) {
        state.view = "done";
        paint();
      } else {
        state.index += 1;
        paint();
      }
    }
  });

  paint();
})();
