(function () {
  var DB_KEY = "mcjRealDB.v1";
  var legalDocs = [];

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function readDB() {
    try { return JSON.parse(localStorage.getItem(DB_KEY) || "{}"); } catch (e) { return {}; }
  }
  function writeDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db || {}));
    window.dispatchEvent(new CustomEvent("mcj:data-updated"));
  }
  function createId() {
    return "COOP-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(16).slice(2, 7).toUpperCase();
  }
  function fileToDataURL(input, cb) {
    var file = input && input.files && input.files[0];
    if (!file) return cb("");
    var reader = new FileReader();
    reader.onload = function () { cb(String(reader.result || "")); };
    reader.readAsDataURL(file);
  }
  function removeBrokenText() {
    var bad = /<\/?[a-z][^>]*>|\uFFFD/i;
    Array.prototype.slice.call(document.body.childNodes).forEach(function (node) {
      if (node.nodeType === 3 && bad.test(node.textContent || "")) node.remove();
    });
    Array.prototype.slice.call(document.querySelectorAll("body > div, body > p, body > span")).forEach(function (el) {
      var text = (el.textContent || "").trim();
      if (text.length < 180 && bad.test(text) && !el.closest(".staff-login-gate,.app,.container,.dashboard,.super-admin-root")) el.remove();
    });
  }

  function homeDiscordCtaHtml() {
    return (
      '<button type="button" class="mcj-home-discord-cta" data-open-discord aria-label="加入 MEOW CUI JIAO Discord 社区">' +
      '<span class="mcj-home-discord-cta-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" focusable="false"><path fill="currentColor" d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>' +
      "</span>" +
      '<span class="mcj-home-discord-cta-copy"><strong>MEOW CUI JIAO COMMUNITY</strong><span>加入 Discord 玩家社区</span></span>' +
      "</button>"
    );
  }
  function footerHtml() {
    var isHome = /(^|\/)index\.html$|\/$/.test(location.pathname);
    var ssm = '<div class="mcj-footer-ssm">SSM Registration No. 202603181917</div>';
    if (!isHome) {
      return '<footer class="mcj-site-footer" data-mcj-footer>' +
        '<div class="mcj-footer-bottom"><span>© 2026 Meow Cui Jiao</span>' + ssm + '</div></footer>';
    }
    return '<footer class="mcj-site-footer" data-mcj-footer>' +
      '<div class="mcj-footer-inner compact">' +
      '<section class="mcj-footer-block mcj-footer-brand">' +
      '<h3>MEOW CUI JIAO ENTERPRISE</h3>' +
      '<p>✓ Registered Malaysian Enterprise</p>' +
      homeDiscordCtaHtml() +
      '<div class="mcj-footer-actions mcj-footer-actions--single">' +
      '<button class="mcj-footer-link" type="button" data-open-coop>商务合作</button>' +
      '</div></section>' +
      '</div><div class="mcj-footer-bottom"><span>© MEOW CUI JIAO ENTERPRISE. All rights reserved.</span>' + ssm + '</div></footer>';
  }
  function modalHtml() {
    return '<div class="mcj-modal" id="mcjCoopModal" aria-hidden="true"><div class="mcj-modal-box"><div class="mcj-modal-head"><div><h3>商务合作申请</h3><p>欢迎与 Meow Cui Jiao 建立合作关系。</p></div><button class="mcj-close" style="width:36px;height:36px;min-width:36px;min-height:36px;max-width:36px;max-height:36px;padding:0" type="button" data-close-coop>×</button></div>' +
      '<form id="mcjCoopForm" class="mcj-form-grid">' +
      '<label>公司/俱乐部名称（必填）<input name="companyName" required></label>' +
      '<label>联系人姓名（必填）<input name="contactName" required></label>' +
      '<label>联系电话（必填）<input name="phone" required></label>' +
      '<label>邮箱（选填）<input name="email" type="email"></label>' +
      '<label>合作类型<select name="type"><option>广告投放</option><option>战队合作</option><option>赛事合作</option><option>商业合作</option><option>资源互换</option><option>其他</option></select></label>' +
      '<label>预算（选填）<input name="budget" placeholder="例如 RM 500 - RM 3000"></label>' +
      '<label class="wide">合作内容（必填）<textarea name="message" required></textarea></label>' +
      '<label class="wide">上传附件（可选）<input name="attachment" type="file" accept="image/*,.pdf,.doc,.docx"></label>' +
      '<div class="mcj-form-state" id="mcjCoopState"></div><div class="mcj-form-actions"><button class="mcj-cancel" type="button" data-close-coop>取消</button><button class="mcj-submit" type="submit">提交合作申请</button></div>' +
      '</form></div></div>';
  }
  function field(form, name) {
    return (form.elements[name] && form.elements[name].value || "").trim();
  }
  function saveInquiry(form, attachmentUrl) {
    var db = readDB();
    db.cooperationInquiries = Array.isArray(db.cooperationInquiries) ? db.cooperationInquiries : [];
    var item = {
      id: createId(),
      companyName: field(form, "companyName"),
      contactName: field(form, "contactName"),
      phone: field(form, "phone"),
      email: field(form, "email"),
      type: field(form, "type"),
      budget: field(form, "budget"),
      message: field(form, "message"),
      attachmentUrl: attachmentUrl || "",
      status: "pending",
      createdAt: new Date().toLocaleString("zh-CN"),
      handledBy: "",
      assignedTo: "",
      adminReply: "",
      adminNote: "",
      followUps: []
    };
    db.cooperationInquiries.unshift(item);
    writeDB(db);
    return item;
  }
  function ensureModal() {
    var modal = document.getElementById("mcjCoopModal");
    if (!modal) {
      document.body.insertAdjacentHTML("beforeend", modalHtml());
      modal = document.getElementById("mcjCoopModal");
      bindForm();
    }
    return modal;
  }
  function destroyModal() {
    var modal = document.getElementById("mcjCoopModal");
    if (modal) modal.remove();
    document.body.style.overflow = "";
  }
  function bindForm() {
    var form = document.getElementById("mcjCoopForm");
    if (!form || form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var state = document.getElementById("mcjCoopState");
      state.textContent = "正在提交...";
      fileToDataURL(form.elements.attachment, function (url) {
        var item = saveInquiry(form, url);
        state.textContent = "已提交合作申请，编号：" + item.id;
        form.reset();
        if (window.MCJNotify) window.MCJNotify.push("system", "商务合作申请", item.companyName + " 已进入后台工单", item.id);
      });
    });
  }
  function getDiscordInviteUrl() {
    if (window.MCJDiscordCommunity && typeof window.MCJDiscordCommunity.getDiscordInviteUrl === "function") {
      var shared = String(window.MCJDiscordCommunity.getDiscordInviteUrl() || "").trim();
      if (shared) return shared;
    }
    var direct = (localStorage.getItem("discordInviteUrl") || "").trim();
    if (direct) return direct;
    try {
      var platform = JSON.parse(localStorage.getItem("mcjPlatformSettings") || "{}");
      var fromPlatform = String(platform.discordInviteUrl || "").trim();
      if (fromPlatform) return fromPlatform;
    } catch (e) {}
    try {
      var site = JSON.parse(localStorage.getItem("mcj_siteSettings") || "{}");
      return String(site.discordInviteUrl || "").trim();
    } catch (e2) {
      return "";
    }
  }
  function openDiscordInvite() {
    if (window.MCJDiscordCommunity && typeof window.MCJDiscordCommunity.openDiscordInvite === "function") {
      var result = window.MCJDiscordCommunity.openDiscordInvite();
      if (!result || !result.ok) alert("Discord 社群链接暂未配置，请稍后再试或联系客服。");
      return;
    }
    var url = getDiscordInviteUrl();
    if (!url) {
      alert("Discord 社群链接暂未配置，请稍后再试或联系客服。");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }
  function bind() {
    function openModal() {
      var modal = ensureModal();
      modal.classList.add("show");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      var first = modal.querySelector("input,select,textarea,button");
      if (first) first.focus();
    }
    function closeModal() {
      destroyModal();
    }
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-open-coop]")) { e.preventDefault(); openModal(); }
      if (e.target.closest("[data-open-discord]")) { e.preventDefault(); openDiscordInvite(); }
      var modal = document.getElementById("mcjCoopModal");
      if (modal && (e.target.closest("[data-close-coop]") || e.target === modal)) { e.preventDefault(); closeModal(); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.getElementById("mcjCoopModal")) closeModal();
    });
  }
  function init() {
    removeBrokenText();
    if (!document.querySelector('link[href*="footer-system.css"]')) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "src/footer-system.css?v=20260911footerSlim2";
      document.head.appendChild(link);
    }
    document.querySelectorAll("[data-mcj-footer], .site-footer, #mcjCoopModal").forEach(function (el) { el.remove(); });
    var isHome = /(^|\/)index\.html$|\/$/.test(location.pathname);
    document.body.insertAdjacentHTML("beforeend", footerHtml());
    if (isHome) bind();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
