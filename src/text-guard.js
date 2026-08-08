(function () {
  function cleanText(text) {
    return String(text || "")
      .replace(/<\/?(h1|h2|h3|p|span|div|button|a|section|article)[^>]*>/gi, "")
      .replace(/\uFFFD/g, "")
      .replace(/\?\/(h1|h2|h3|p|span|div|button|a|section|article)>/gi, "")
      .replace(/\u951F\u65A4\u62F7/g, "")
      .trim();
  }

  function shouldClean(text) {
    return /<\/?[a-z][^>]*>|\u951F\u65A4\u62F7|\uFFFD|\?\/(h1|h2|h3|p|span)/i.test(text || "");
  }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function fixHomePageText() {
    if (!/\/index\.html$|\/$/.test(location.pathname)) return;
    var bannerImg = document.querySelector(".banner img");
    if (bannerImg) {
      bannerImg.alt = "妙脆角电竞 Hero Banner";
    }

    setText(document.querySelector(".brand small"), "Meow Cui Jiao");
    setText(document.querySelector(".top-actions .login"), "登录");
    setText(document.querySelector("[data-message-link]"), "消息");
    setText(document.querySelector(".user-chip.auth-only span:last-child"), "我的");
    /* 首页公告由 home-announcements.js 读取后台真实数据，这里不再覆盖或隐藏。 */

    // Tonight MVP: keep text aligned with freeze whitelist; do not revive frozen routes.
    var entries = document.querySelectorAll(".quick-entry-grid .quick-entry-card");
    var configs = [
      ["陪", "陪玩大厅", "浏览已上架陪玩，立即下单", "companion-center.html"],
      ["玩", "更多玩法", "护航、跑刀、代肝、趣味单", "more-gameplays.html"],
      ["订", "自定义订单", "填写需求，客服匹配陪玩", "custom-order.html"],
      ["队", "组队大厅", "进入组队社区找队友", "team-lobby.html"]
    ];
    Array.prototype.forEach.call(entries, function (card) {
      var slug = card.getAttribute("data-home-entry") || "";
      if (slug === "my-orders" || slug === "support") {
        card.remove();
        return;
      }
      var href = card.getAttribute("href") || "";
      if (/orders\.html/i.test(href) || /support\.html/i.test(href)) {
        card.remove();
        return;
      }
    });
    entries = document.querySelectorAll(".quick-entry-grid .quick-entry-card");
    Array.prototype.forEach.call(entries, function (card, index) {
      var item = configs[index];
      if (!item) return;
      var icon = card.querySelector("i");
      if (icon && !icon.querySelector("img,svg")) setText(icon, item[0]);
      setText(card.querySelector("strong"), item[1]);
      setText(card.querySelector("span"), item[2]);
      card.setAttribute("href", item[3]);
    });
    var slot = document.querySelector("[data-home-config-slot]");
    if (slot) {
      try {
        var db = JSON.parse(localStorage.getItem("mcjRealDB.v1") || "{}");
        var buttons = Array.isArray(db.homepageButtons) ? db.homepageButtons : [];
        var custom = buttons
          .filter(function (item) { return item && item.enabled !== false && item.enabled !== "false"; })
          .sort(function (a, b) { return Number(a.sort || 999) - Number(b.sort || 999); })[0];
        if (custom) {
          setText(slot.querySelector("i"), custom.icon || "✨");
          setText(slot.querySelector("strong"), custom.name || custom.title || "更多玩法");
          setText(slot.querySelector("span"), custom.subtitle || "后台配置入口");
          slot.onclick = function () {
            if (custom.href) location.href = custom.href;
          };
        }
      } catch (e) {}
    }
  }

  function walk(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent || /SCRIPT|STYLE|TEXTAREA|INPUT/.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return shouldClean(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      node.nodeValue = cleanText(node.nodeValue);
    });
  }

  function init() {
    function restoreBodyDisplay() {
      if (document.body && document.body.style.display === "none") document.body.style.display = "";
    }
    restoreBodyDisplay();
    walk(document.body);
    fixHomePageText();
    setTimeout(restoreBodyDisplay, 0);
    setTimeout(restoreBodyDisplay, 120);
    setTimeout(restoreBodyDisplay, 600);
    new MutationObserver(restoreBodyDisplay).observe(document.body, { attributes: true, attributeFilter: ["style"] });
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType === 3 && shouldClean(node.nodeValue)) node.nodeValue = cleanText(node.nodeValue);
          if (node.nodeType === 1) {
            walk(node);
            fixHomePageText();
          }
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

