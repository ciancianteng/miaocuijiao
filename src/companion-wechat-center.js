(function () {
  "use strict";

  if (window.__MCJCompanionWechatLoaded) return;
  window.__MCJCompanionWechatLoaded = true;

  var REMARK = "陪玩";
  var MISSING_ID = "暂无陪玩编号";
  var QR_SRC = "/companion-wechat-admin-qr.jpg";
  var PAGE_TITLES = { "工作台": 1, "审核状态": 1 };
  var groupNick = MISSING_ID;
  var nickRequest = 0;

  function ensureCss() {
    if (document.querySelector("link[data-pw-wx-css]")) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/src/companion-wechat-center.css?v=20261028wxdark1";
    link.setAttribute("data-pw-wx-css", "");
    document.head.appendChild(link);
  }

  function pageTitle() {
    var page = document.querySelector("#companionApp .pw-page");
    if (!page) return "";
    var h2 = page.querySelector(".pw-page-head h2");
    return h2 ? String(h2.textContent || "").trim() : "";
  }

  function mountEntry() {
    var page = document.querySelector("#companionApp .pw-page");
    if (!page) return;
    if (!PAGE_TITLES[pageTitle()]) {
      var stale = page.querySelector("[data-wx-center-entry]");
      if (stale) stale.remove();
      return;
    }
    if (page.querySelector("[data-wx-center-entry]")) return;
    var head = page.querySelector(".pw-page-head");
    if (!head) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-wx-entry";
    btn.setAttribute("data-wx-center-entry", "");
    btn.setAttribute("data-wx-center-open", "");
    btn.innerHTML =
      '<span class="pw-wx-mark" aria-hidden="true"><svg class="pw-wx-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#07C160" d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/></svg></span>' +
      '<span class="pw-wx-entry-copy"><strong>微信对接中心</strong><small>加入官方陪玩对接群</small></span>' +
      '<span class="pw-wx-entry-go">查看</span>';
    head.insertAdjacentElement("afterend", btn);
  }

  function closeZoom() {
    var zoom = document.querySelector("[data-wx-zoom-layer]");
    if (zoom) zoom.remove();
  }

  function closeSheet() {
    closeZoom();
    var sheet = document.querySelector("[data-wx-sheet]");
    if (sheet) sheet.remove();
    document.body.classList.remove("pw-wx-open");
    var opener = document.querySelector("[data-wx-center-entry]");
    if (opener && typeof opener.focus === "function") {
      try { opener.focus(); } catch (e) {}
    }
  }

  function openZoom() {
    closeZoom();
    var layer = document.createElement("div");
    layer.className = "pw-wx-zoom";
    layer.setAttribute("data-wx-zoom-layer", "");
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.setAttribute("aria-label", "放大查看管理员微信二维码");
    layer.innerHTML =
      '<div class="pw-wx-zoom-card">' +
      '<header><h2>管理员微信二维码</h2><button type="button" class="pw-wx-close" data-wx-zoom-close aria-label="关闭放大">×</button></header>' +
      '<img src="' + QR_SRC + '" alt="管理员微信二维码原图" width="674" height="674">' +
      '<p class="pw-wx-live">完整原图。可双指放大查看。</p>' +
      "</div>";
    document.body.appendChild(layer);
    var img = layer.querySelector("img");
    if (img) {
      img.addEventListener("error", function () {
        img.replaceWith(missingNode());
      });
    }
  }

  function missingNode() {
    var p = document.createElement("p");
    p.className = "pw-wx-missing";
    p.setAttribute("data-wx-qr-missing", "");
    p.textContent = "待配置：管理员微信二维码原图未能加载。此处不会使用占位二维码。";
    return p;
  }

  function openSheet() {
    if (document.querySelector("[data-wx-sheet]")) return;
    ensureCss();
    var sheet = document.createElement("div");
    sheet.className = "pw-wx-sheet";
    sheet.setAttribute("data-wx-sheet", "");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "pwWxTitle");
    sheet.innerHTML =
      '<div class="pw-wx-dialog" data-wx-dialog>' +
      '<header class="pw-wx-head">' +
      '<div><p class="pw-wx-kicker">陪玩端</p><h2 id="pwWxTitle">微信对接中心</h2><p>加入官方陪玩对接群</p></div>' +
      '<button type="button" class="pw-wx-close" data-wx-close aria-label="关闭">×</button>' +
      "</header>" +
      '<section class="pw-wx-block">' +
      '<h3>管理员微信</h3>' +
      '<button type="button" class="pw-wx-qr-btn" data-wx-zoom aria-label="放大查看管理员微信二维码">' +
      '<img src="' + QR_SRC + '" alt="管理员微信二维码" width="674" height="674">' +
      "</button>" +
      '<p data-wx-qr-caption>点击二维码可放大。请用微信扫码添加管理员。</p>' +
      "</section>" +
      '<section class="pw-wx-block">' +
      "<h3>添加好友时的备注</h3>" +
      "<p>添加管理员微信时，请备注：</p>" +
      '<p class="pw-wx-remark" data-wx-remark>' + REMARK + "</p>" +
      '<button type="button" class="pw-btn primary pw-wx-copy" data-wx-copy>复制备注</button>' +
      '<p class="pw-wx-live" data-wx-copy-live aria-live="polite"></p>' +
      "</section>" +
      '<section class="pw-wx-block">' +
      "<h3>入群后的群昵称</h3>" +
      "<p>成功入群后，请将群昵称修改为你的陪玩 ID：</p>" +
      '<div class="pw-wx-nickrow">' +
      '<p class="pw-wx-nickline" data-wx-group-nick>' + MISSING_ID + "</p>" +
      '<button type="button" class="pw-btn primary pw-wx-copy pw-wx-nick-copy" data-wx-nick-copy disabled>复制</button>' +
      "</div>" +
      '<p class="pw-wx-live" data-wx-nick-live aria-live="polite"></p>' +
      "<p>添加管理员微信时，请备注『" + REMARK + "』。成功加入微信对接群后，请复制上方陪玩 ID，并把它设为微信群昵称。编号只使用你账号里已保存的陪玩 ID，例如 pw000、pw001。</p>" +
      "</section>" +
      '<section class="pw-wx-block">' +
      "<h3>群用途</h3>" +
      '<ul class="pw-wx-uses">' +
      "<li>平台公告与接单规则通知。</li>" +
      "<li>陪玩账号、资料审核及接单问题协助。</li>" +
      "<li>平台活动、合作信息及陪玩社群沟通。</li>" +
      "</ul>" +
      "</section>" +
      '<div class="pw-wx-actions">' +
      '<button type="button" class="pw-btn" data-wx-close>返回</button>' +
      "</div>" +
      "</div>";
    document.body.appendChild(sheet);
    document.body.classList.add("pw-wx-open");
    var img = sheet.querySelector("img");
    if (img) {
      img.addEventListener("error", function () {
        var btn = sheet.querySelector("[data-wx-zoom]");
        if (btn) btn.replaceWith(missingNode());
        var cap = sheet.querySelector("[data-wx-qr-caption]");
        if (cap) cap.hidden = true;
      });
    }
    var closeBtn = sheet.querySelector("[data-wx-close]");
    if (closeBtn && typeof closeBtn.focus === "function") {
      try { closeBtn.focus(); } catch (e) {}
    }
    loadGroupNick();
  }

  function nickFromPublicId(publicId) {
    var id = String(publicId || "").trim();
    if (!/^PW\d+$/i.test(id)) return MISSING_ID;
    return "pw" + id.slice(2);
  }

  function readToken() {
    try {
      var raw = localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "";
      var session = JSON.parse(raw || "null");
      return session && session.token ? String(session.token) : "";
    } catch (e) {
      return "";
    }
  }

  function applyGroupNick(text, meta) {
    groupNick = text || MISSING_ID;
    if (window.MCJCompanionWechat) window.MCJCompanionWechat.groupNick = groupNick;
    var node = document.querySelector("[data-wx-group-nick]");
    if (node) node.textContent = groupNick;
    var btn = document.querySelector("[data-wx-nick-copy]");
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("is-copied");
      btn.textContent = "复制";
      btn.removeAttribute("data-wx-copied");
    }
    var live = document.querySelector("[data-wx-nick-live]");
    if (live) live.textContent = meta && meta.failed ? "编号暂时无法读取，请刷新页面后再打开。" : "";
  }

  function loadGroupNick() {
    var token = readToken();
    var seq = ++nickRequest;
    var node = document.querySelector("[data-wx-group-nick]");
    var btn = document.querySelector("[data-wx-nick-copy]");
    if (node) node.textContent = "读取中";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "复制";
      btn.classList.remove("is-copied");
    }
    if (!token) {
      applyGroupNick(MISSING_ID);
      return;
    }
    fetch("/api/companion?action=wechat_public_id", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + token,
        "x-mcj-companion-token": token
      }
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false }; }).then(function (body) {
        return { status: res.status, body: body };
      });
    }).then(function (result) {
      if (seq !== nickRequest || readToken() !== token) return;
      var body = result.body || {};
      if (result.status === 200 && body.ok === true) applyGroupNick(nickFromPublicId(body.publicId));
      else applyGroupNick(MISSING_ID, { failed: true });
    }).catch(function () {
      if (seq !== nickRequest || readToken() !== token) return;
      applyGroupNick(MISSING_ID, { failed: true });
    });
  }

  function markCopied(btn) {
    btn.classList.add("is-copied");
    btn.textContent = "已复制备注";
    btn.setAttribute("data-wx-copied", REMARK);
    var live = document.querySelector("[data-wx-copy-live]");
    if (live) live.textContent = "已复制备注：" + REMARK;
  }

  function fallbackCopy(text, selector) {
    var node = document.querySelector(selector || "[data-wx-remark]");
    if (node) {
      var range = document.createRange();
      range.selectNodeContents(node);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      if (ok) return true;
    }
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "8px";
    area.style.left = "8px";
    area.style.fontSize = "16px";
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    var copied = false;
    try { copied = document.execCommand("copy"); } catch (e2) { copied = false; }
    area.remove();
    return copied;
  }

  function copyRemark(btn) {
    var text = REMARK;
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        markCopied(btn);
      }).catch(function () {
        if (fallbackCopy(text)) markCopied(btn);
        else {
          var live = document.querySelector("[data-wx-copy-live]");
          if (live) live.textContent = "请长按上方备注「" + REMARK + "」手动复制。";
        }
      });
      return;
    }
    if (fallbackCopy(text)) markCopied(btn);
    else {
      var live = document.querySelector("[data-wx-copy-live]");
      if (live) live.textContent = "请长按上方备注「" + REMARK + "」手动复制。";
    }
  }

  function markNickCopied(btn) {
    btn.classList.add("is-copied");
    btn.textContent = "已复制";
    btn.setAttribute("data-wx-copied", groupNick);
    var live = document.querySelector("[data-wx-nick-live]");
    if (live) live.textContent = "已复制群昵称：" + groupNick;
  }

  function copyGroupNick(btn) {
    if (!btn || btn.disabled) return;
    var text = groupNick;
    if (!text || text === "读取中") return;
    function fail() {
      var live = document.querySelector("[data-wx-nick-live]");
      if (live) live.textContent = "请长按上方群昵称手动复制。";
    }
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        markNickCopied(btn);
      }).catch(function () {
        if (fallbackCopy(text, "[data-wx-group-nick]")) markNickCopied(btn);
        else fail();
      });
      return;
    }
    if (fallbackCopy(text, "[data-wx-group-nick]")) markNickCopied(btn);
    else fail();
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("[data-wx-center-open]")) {
      e.preventDefault();
      openSheet();
      return;
    }
    if (t.closest("[data-wx-zoom]")) {
      e.preventDefault();
      openZoom();
      return;
    }
    if (t.closest("[data-wx-zoom-close]") || (t.matches && t.matches("[data-wx-zoom-layer]"))) {
      e.preventDefault();
      closeZoom();
      return;
    }
    if (t.closest("[data-wx-nick-copy]")) {
      e.preventDefault();
      copyGroupNick(t.closest("[data-wx-nick-copy]"));
      return;
    }
    if (t.closest("[data-wx-copy]")) {
      e.preventDefault();
      copyRemark(t.closest("[data-wx-copy]"));
      return;
    }
    if (t.closest("[data-wx-close]") || (t.matches && t.matches("[data-wx-sheet]"))) {
      e.preventDefault();
      closeSheet();
      return;
    }
    if (t.closest("[data-route]") && document.querySelector("[data-wx-sheet]")) closeSheet();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (document.querySelector("[data-wx-zoom-layer]")) {
      closeZoom();
      return;
    }
    if (document.querySelector("[data-wx-sheet]")) closeSheet();
  });

  function boot() {
    ensureCss();
    mountEntry();
    var host = document.getElementById("companionApp");
    if (!host || host.getAttribute("data-wx-watched") === "1") return;
    host.setAttribute("data-wx-watched", "1");
    var obs = new MutationObserver(function () { mountEntry(); });
    obs.observe(host, { childList: true, subtree: true });
  }

  window.MCJCompanionWechat = {
    remark: REMARK,
    groupNick: groupNick,
    nickFromPublicId: nickFromPublicId,
    qrSrc: QR_SRC,
    open: openSheet,
    close: closeSheet
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
