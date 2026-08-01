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
  function footerHtml() {
    var isHome = /(^|\/)index\.html$|\/$/.test(location.pathname);
    if (!isHome) {
      return '<footer class="mcj-site-footer" data-mcj-footer>' +
        '<div class="mcj-footer-bottom"><span>© 2026 Meow Cui Jiao</span></div></footer>';
    }
    return '<footer class="mcj-site-footer" data-mcj-footer>' +
      '<div class="mcj-footer-inner compact">' +
      '<section class="mcj-footer-block mcj-footer-brand">' +
      '<h3>MEOW CUI JIAO ENTERPRISE</h3>' +
      '<p>✓ Registered Malaysian Enterprise</p>' +
      '<div class="mcj-footer-actions">' +
      '<button class="mcj-footer-link" type="button" data-open-coop>商务合作</button>' +
      '<a class="mcj-footer-link" href="companion-apply.html">申请陪玩</a>' +
      '<button class="mcj-footer-link" type="button" data-open-discord>Discord 社群</button>' +
      '</div></section>' +
      '</div><div class="mcj-footer-bottom"><span>© MEOW CUI JIAO ENTERPRISE. All rights reserved.</span></div></footer>';
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
      link.href = "src/footer-system.css?v=20260731-footer-actions";
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
