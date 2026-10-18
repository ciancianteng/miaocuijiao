(function () {
  "use strict";

  if (window.__MCJCompanionWechatLoaded) return;
  window.__MCJCompanionWechatLoaded = true;

  var REMARK = "陪玩嘻嘻";
  var GROUP_NICK = "陪玩嘻嘻｜你的陪玩昵称（或陪玩ID）";
  var QR_SRC = "/companion-wechat-admin-qr.jpg";
  var PAGE_TITLES = { "工作台": 1, "审核状态": 1 };

  function ensureCss() {
    if (document.querySelector("link[data-pw-wx-css]")) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/src/companion-wechat-center.css?v=20261018wx1";
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
      '<span class="pw-wx-mark" aria-hidden="true">微</span>' +
      '<span class="pw-wx-entry-copy"><strong>微信对接中心</strong><small>加入官方陪玩对接群</small></span>' +
      '<em class="pw-wx-entry-go">查看</em>';
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
      "<p>成功入群后，请将群昵称修改为：</p>" +
      '<p class="pw-wx-nickline" data-wx-group-nick>' + GROUP_NICK + "</p>" +
      "<p>加好友时只填写备注「" + REMARK + "」。入群之后，再单独把群昵称改成上面这一行。</p>" +
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
  }

  function markCopied(btn) {
    btn.classList.add("is-copied");
    btn.textContent = "已复制备注";
    btn.setAttribute("data-wx-copied", REMARK);
    var live = document.querySelector("[data-wx-copy-live]");
    if (live) live.textContent = "已复制备注：" + REMARK;
  }

  function fallbackCopy(text) {
    var node = document.querySelector("[data-wx-remark]");
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
    groupNick: GROUP_NICK,
    qrSrc: QR_SRC,
    open: openSheet,
    close: closeSheet
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
