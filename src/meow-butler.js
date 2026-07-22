(function () {
  var PLATFORM_KEY = "mcjPlatformData.v1";
  var DB_KEY = "mcjRealDB.v1";
  var ROOT_ID = "floatingCustomerService";
  var STYLE_ID = "floatingCustomerServiceStyle";
  var POS_KEY = "mcjFloatingCustomerServicePosition.v1";
  var CHAT_INTENT_KEY = "mcjButlerAfterLogin.v1";

  function pagePath() {
    try { return decodeURIComponent(location.pathname || "").toLowerCase(); } catch (e) { return String(location.pathname || "").toLowerCase(); }
  }

  function shouldHide() {
    var path = pagePath();
    return /\/admin\/|\/companion\/|customer-service|admin-center|后台|04-|陪玩端/.test(path);
  }

  function readDB() {
    try { return JSON.parse(localStorage.getItem(DB_KEY) || "{}") || {}; } catch (e) { return {}; }
  }

  function readPlatform() {
    try { return JSON.parse(localStorage.getItem(PLATFORM_KEY) || "{}") || {}; } catch (e) { return {}; }
  }

  function readUnifiedDB() {
    var legacy = readDB();
    var platform = readPlatform();
    return Object.assign({}, legacy, platform, {
      butlerIssueContents: Array.isArray(platform.butlerIssueContents) ? platform.butlerIssueContents : (Array.isArray(legacy.butlerIssueContents) ? legacy.butlerIssueContents : []),
      butlerCooperationTypes: Array.isArray(platform.butlerCooperationTypes) ? platform.butlerCooperationTypes : (Array.isArray(legacy.butlerCooperationTypes) ? legacy.butlerCooperationTypes : []),
      cooperationInquiries: Array.isArray(platform.cooperationInquiries) ? platform.cooperationInquiries : (Array.isArray(legacy.cooperationInquiries) ? legacy.cooperationInquiries : []),
      butlerCooperation: platform.butlerCooperation || legacy.butlerCooperation || {}
    });
  }

  function writeDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db || {}));
    window.dispatchEvent(new CustomEvent("mcj:data-updated"));
  }

  function writeUnifiedDB(db) {
    var platform = readPlatform();
    platform.butlerIssueContents = Array.isArray(db.butlerIssueContents) ? db.butlerIssueContents : [];
    platform.butlerCooperationTypes = Array.isArray(db.butlerCooperationTypes) ? db.butlerCooperationTypes : [];
    platform.cooperationInquiries = Array.isArray(db.cooperationInquiries) ? db.cooperationInquiries : [];
    platform.butlerCooperation = db.butlerCooperation || {};
    localStorage.setItem(PLATFORM_KEY, JSON.stringify(platform));

    var legacy = readDB();
    legacy.butlerIssueContents = platform.butlerIssueContents;
    legacy.butlerCooperationTypes = platform.butlerCooperationTypes;
    legacy.cooperationInquiries = platform.cooperationInquiries;
    legacy.butlerCooperation = platform.butlerCooperation;
    writeDB(legacy);
    window.dispatchEvent(new CustomEvent("mcj:platform-data-updated"));
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function createId(prefix) {
    return prefix + "-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(16).slice(2, 7).toUpperCase();
  }

  function nowText() {
    return new Date().toLocaleString("zh-CN");
  }

  function currentCustomer() {
    if (window.MCJRoleGate && window.MCJRoleGate.isLogged && window.MCJRoleGate.isLogged("customer")) {
      return window.MCJRoleGate.user("customer") || {};
    }
    if (!localStorage.getItem("customerAuthToken")) return null;
    try { return JSON.parse(localStorage.getItem("customerUser") || "{}") || {}; } catch (e) { return {}; }
  }

  function isCustomerLoggedIn() {
    return Boolean(currentCustomer());
  }

  function requestLogin(root) {
    sessionStorage.setItem(CHAT_INTENT_KEY, "chat");
    root.classList.remove("open");
    window.dispatchEvent(new CustomEvent("mcj:open-login", { detail: { source: "meow-butler" } }));
    var trigger = document.querySelector('.top-actions .login[data-modal="login"],[data-customer-login],[data-modal="login"],[data-login]');
    if (trigger) {
      trigger.click();
      return;
    }
    if (!/index\.html$|\/$/.test(location.pathname)) location.href = "/index.html#login";
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#floatingService,.floating-service,.service-float,.online-service,#mcjButler,#mcjButlerModal,#mcjFloatingAssistant,#mcjFloatingAssistantBackdrop{display:none!important}",
      "#" + ROOT_ID + "{position:fixed!important;right:24px;bottom:24px;z-index:99999!important;width:72px!important;height:72px!important;margin:0!important;padding:0!important;pointer-events:none!important;font-family:\"Microsoft YaHei\",\"PingFang SC\",Arial,sans-serif!important;touch-action:none!important}",
      "#" + ROOT_ID + ",#" + ROOT_ID + " *{box-sizing:border-box!important}",
      "#" + ROOT_ID + ".dragging .floating-cs-button{animation:none!important;cursor:grabbing!important;transform:scale(1.03)!important}",
      ".floating-cs-button{position:absolute!important;inset:0!important;z-index:2!important;width:72px!important;height:72px!important;border-radius:50%!important;border:1px solid rgba(255,194,226,.52)!important;background:radial-gradient(circle at 42% 34%,rgba(255,255,255,.18),rgba(255,120,190,.13) 42%,rgba(8,5,10,.96) 76%),url(\"assets/floating-service-cat-logo.png\") center/cover no-repeat!important;box-shadow:0 18px 38px rgba(0,0,0,.52),0 0 26px rgba(255,120,190,.36),inset 0 1px 0 rgba(255,255,255,.18)!important;color:#fff4fa!important;display:grid!important;place-items:end center!important;padding:0 0 7px!important;font-size:11px!important;font-weight:1000!important;line-height:1!important;cursor:grab!important;pointer-events:auto!important;animation:floatingCsBreath 3.2s ease-in-out infinite!important;transition:transform .22s ease,box-shadow .22s ease!important;overflow:hidden!important;user-select:none!important;-webkit-user-select:none!important}",
      ".floating-cs-button:hover{transform:scale(1.06)!important;box-shadow:0 22px 44px rgba(0,0,0,.58),0 0 34px rgba(255,132,203,.50),inset 0 1px 0 rgba(255,255,255,.2)!important}",
      ".floating-cs-button::before{content:\"\";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(180deg,transparent 46%,rgba(4,3,6,.72) 100%);pointer-events:none!important}",
      ".floating-cs-button span{position:relative;z-index:1;text-shadow:0 0 8px rgba(255,130,200,.45)}",
      ".floating-cs-panel{position:absolute!important;right:0!important;bottom:84px!important;z-index:1!important;width:350px!important;max-width:calc(100vw - 48px)!important;max-height:calc(100vh - 118px)!important;overflow:auto!important;border:1px solid rgba(255,190,224,.36)!important;border-radius:22px!important;background:linear-gradient(145deg,rgba(22,11,21,.94),rgba(7,6,11,.96))!important;box-shadow:0 26px 64px rgba(0,0,0,.62),0 0 28px rgba(255,105,180,.22),inset 0 1px 0 rgba(255,255,255,.08)!important;backdrop-filter:blur(18px)!important;padding:14px!important;opacity:0;transform:translateY(14px) scale(.96);pointer-events:none!important;transition:opacity .2s ease,transform .2s ease!important}",
      "#" + ROOT_ID + ".open .floating-cs-panel{opacity:1;transform:translateY(0) scale(1);pointer-events:auto!important}",
      ".floating-cs-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}.floating-cs-head h3{margin:0;color:#fff5fb;font-size:18px}.floating-cs-head p{margin:4px 0 0;color:rgba(255,226,239,.68);font-size:12px;line-height:1.45}.floating-cs-close{width:32px;height:32px;border-radius:12px;border:1px solid rgba(255,190,224,.24);background:rgba(255,255,255,.055);color:#ffe1ef;font-size:18px;cursor:pointer}",
      ".floating-cs-options{display:grid;gap:9px}.floating-cs-option{min-height:48px;border-radius:16px;border:1px solid rgba(255,190,224,.20);background:rgba(255,255,255,.045);color:#fff7fb;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 14px;font-size:14px;font-weight:900;cursor:pointer;text-align:left}.floating-cs-option:hover{border-color:rgba(255,190,224,.55);background:rgba(255,120,190,.12);box-shadow:0 0 18px rgba(255,105,180,.16)}",
      ".floating-cs-content{display:grid;gap:10px;margin-top:10px;border-top:1px solid rgba(255,190,224,.12);padding-top:10px}.floating-cs-empty,.floating-cs-success{border:1px dashed rgba(255,190,224,.26);border-radius:16px;padding:16px;color:#ffdceb;text-align:center;font-weight:900;background:rgba(255,255,255,.035);line-height:1.55}.floating-cs-success{border-style:solid;color:#c9ffd9;background:rgba(63,220,122,.08)}.floating-cs-error{color:#ffd0df;border-color:rgba(255,83,126,.35);background:rgba(255,83,126,.08)}.floating-cs-back{min-height:34px;border-radius:999px;border:1px solid rgba(255,190,224,.22);background:rgba(255,255,255,.045);color:#ffe1ef;font-weight:900;cursor:pointer;padding:0 14px;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.floating-cs-card{border:1px solid rgba(255,190,224,.18);border-radius:16px;background:rgba(255,255,255,.045);padding:12px;display:grid;gap:8px}.floating-cs-card h4{margin:0;color:#fff5fb;font-size:15px}.floating-cs-card p{margin:0;color:rgba(255,226,239,.76);font-size:13px;line-height:1.55;white-space:pre-wrap}.floating-cs-card img{width:100%;max-height:160px;object-fit:cover;border-radius:13px;border:1px solid rgba(255,190,224,.18)}.floating-cs-contact{font-size:12px;color:#ffdceb;font-weight:900;white-space:pre-wrap}",
      ".floating-coop-form{display:grid;gap:10px}.floating-coop-form label{display:grid;gap:6px;color:#ffe4f1;font-size:12px;font-weight:900}.floating-coop-form input,.floating-coop-form select,.floating-coop-form textarea{width:100%;min-width:0;border:1px solid rgba(255,190,224,.20);border-radius:14px;background:rgba(255,255,255,.055);color:#fff;padding:0 12px;outline:0;font:inherit}.floating-coop-form input,.floating-coop-form select{height:42px}.floating-coop-form textarea{min-height:94px;padding-top:10px;resize:vertical}.floating-coop-form input:focus,.floating-coop-form select:focus,.floating-coop-form textarea:focus{border-color:rgba(255,190,224,.7);box-shadow:0 0 0 3px rgba(255,120,190,.12)}.floating-coop-form input[type=file]{padding:10px;height:auto}.floating-coop-submit{height:42px;border:0;border-radius:999px;background:linear-gradient(135deg,#ffd6e7,#ff7fbd);color:#17070f;font-weight:1000;cursor:pointer}",
      "@keyframes floatingCsBreath{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}",
      "@media(max-width:640px){#" + ROOT_ID + "{right:16px;bottom:16px;width:66px!important;height:66px!important}.floating-cs-button{width:66px!important;height:66px!important;font-size:10px!important}.floating-cs-panel{right:0!important;bottom:78px!important;max-width:calc(100vw - 32px)!important;width:310px!important}.floating-cs-option{min-height:50px;font-size:14px}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function readPosition() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch (e) { return null; }
  }

  function savePosition(left, top) {
    localStorage.setItem(POS_KEY, JSON.stringify({ left: Math.round(left), top: Math.round(top) }));
  }

  function clampPosition(left, top, root) {
    var margin = window.innerWidth <= 640 ? 16 : 24;
    var width = root.offsetWidth || 72;
    var height = root.offsetHeight || 72;
    return {
      left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
      top: Math.max(margin, Math.min(window.innerHeight - height - margin, top))
    };
  }

  function applyPosition(root, pos) {
    if (!pos) return;
    var next = clampPosition(Number(pos.left || 0), Number(pos.top || 0), root);
    root.style.left = next.left + "px";
    root.style.top = next.top + "px";
    root.style.right = "auto";
    root.style.bottom = "auto";
  }

  function removeDuplicates() {
    document.querySelectorAll("#floatingService,.floating-service,.service-float,.online-service,#mcjButler,#mcjButlerModal,#mcjFloatingAssistant,#mcjFloatingAssistantBackdrop,#" + ROOT_ID).forEach(function (el) {
      el.remove();
    });
  }

  function contentHost(root) {
    return root.querySelector("[data-floating-cs-content]");
  }

  function renderHome(root) {
    contentHost(root).innerHTML = "";
  }

  async function renderChat(root) {
    if (!isCustomerLoggedIn()) {
      requestLogin(root);
      return;
    }
    var host = contentHost(root);
    host.innerHTML = '<button class="floating-cs-back" type="button" data-floating-cs-back>返回</button><div class="floating-cs-empty">正在进入在线客服...</div>';
    if (!window.MCJChatAPI || !window.MCJChatAPI.createCustomerServiceConversation) {
      host.innerHTML = '<button class="floating-cs-back" type="button" data-floating-cs-back>返回</button><div class="floating-cs-empty floating-cs-error">聊天接口尚未连接</div>';
      return;
    }
    var user = currentCustomer() || {};
    var res = await window.MCJChatAPI.createCustomerServiceConversation("customer", {
      source: "meow_manager",
      customer_id: user.user_id || user.id || user.customer_id || "",
      customer_name: user.nickname || user.name || ""
    });
    if (!res.ok) {
      host.innerHTML = '<button class="floating-cs-back" type="button" data-floating-cs-back>返回</button><div class="floating-cs-empty floating-cs-error">' + esc(res.error || "暂时无法进入在线客服") + '</div>';
      return;
    }
    var data = res.data || {};
    var conversation = data.conversation || {};
    var id = data.conversation_id || conversation.id || data.id || "";
    location.href = "messages.html" + (id ? "?conversation=" + encodeURIComponent(id) : "");
  }

  function renderIssue(root, type) {
    var db = readUnifiedDB();
    var list = (db.butlerIssueContents || []).filter(function (item) {
      return item.type === type && item.enabled !== false;
    }).sort(function (a, b) { return Number(a.sort || 0) - Number(b.sort || 0); });
    var emptyText = type === "order" ? "订单问题内容暂未开放" : "退款问题内容暂未开放";
    var host = contentHost(root);
    host.innerHTML = '<button class="floating-cs-back" type="button" data-floating-cs-back>返回</button>' + (list.length ? list.map(function (item) {
      return '<article class="floating-cs-card">' +
        (item.image ? '<img src="' + esc(item.image) + '" alt="">' : "") +
        '<h4>' + esc(item.title || (type === "order" ? "订单问题" : "退款问题")) + '</h4>' +
        '<p>' + esc(item.content || "") + '</p>' +
        (item.contact ? '<div class="floating-cs-contact">' + esc(item.contact) + '</div>' : "") +
        (item.buttonText && item.link ? '<a class="floating-cs-back" href="' + esc(item.link) + '">' + esc(item.buttonText) + '</a>' : "") +
        '</article>';
    }).join("") : '<div class="floating-cs-empty">' + emptyText + '</div>');
  }

  function renderCooperation(root) {
    var db = readUnifiedDB();
    var types = (db.butlerCooperationTypes || []).filter(function (x) { return x.enabled !== false; }).sort(function (a, b) { return Number(a.sort || 0) - Number(b.sort || 0); });
    var typeOptions = types.length ? types.map(function (x) { return '<option value="' + esc(x.name || "") + '">' + esc(x.name || "") + '</option>'; }).join("") : '<option value="商务合作">商务合作</option>';
    contentHost(root).innerHTML = [
      '<button class="floating-cs-back" type="button" data-floating-cs-back>返回</button>',
      '<form class="floating-coop-form" data-floating-coop-form>',
      '<label>姓名<input name="name" required autocomplete="name"></label>',
      '<label>联系方式<input name="contact" required autocomplete="tel"></label>',
      '<label>合作类型<select name="type" required>' + typeOptions + '</select></label>',
      '<label>公司或团队名称（可选）<input name="company"></label>',
      '<label>合作主题<input name="subject" required></label>',
      '<label>合作内容<textarea name="message" required></textarea></label>',
      '<label>附件上传（可选）<input name="attachment" type="file" accept="image/*,.pdf,.doc,.docx"></label>',
      '<button class="floating-coop-submit" type="submit">提交</button>',
      '</form>'
    ].join("");
  }

  function fileToDataURL(file, callback) {
    if (!file) return callback("");
    var reader = new FileReader();
    reader.onload = function () { callback(String(reader.result || "")); };
    reader.readAsDataURL(file);
  }

  function saveCooperation(form, attachmentUrl) {
    var db = readUnifiedDB();
    var user = currentCustomer() || {};
    db.cooperationInquiries = Array.isArray(db.cooperationInquiries) ? db.cooperationInquiries : [];
    db.cooperationInquiries.unshift({
      id: createId("COOP"),
      name: form.elements.name.value.trim(),
      contact: form.elements.contact.value.trim(),
      type: form.elements.type.value,
      company: form.elements.company.value.trim(),
      subject: form.elements.subject.value.trim(),
      message: form.elements.message.value.trim(),
      attachmentUrl: attachmentUrl || "",
      status: "unread",
      userId: user.user_id || user.id || "",
      userName: user.nickname || user.name || "",
      createdAt: nowText(),
      updatedAt: nowText(),
      assignedTo: "",
      adminNote: ""
    });
    writeUnifiedDB(db);
  }

  function init() {
    if (shouldHide()) {
      removeDuplicates();
      return;
    }
    addStyle();
    removeDuplicates();

    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = [
      '<button class="floating-cs-button" type="button" aria-label="喵管家"><span>喵管家</span></button>',
      '<section class="floating-cs-panel" aria-label="喵管家客服面板">',
      '<div class="floating-cs-head"><div><h3>喵管家</h3><p>有问题可以直接找喵管家。</p></div><button class="floating-cs-close" type="button" data-floating-cs-close>×</button></div>',
      '<div class="floating-cs-options">',
      '<button class="floating-cs-option" type="button" data-floating-cs-action="chat">在线客服 <span>›</span></button>',
      '<button class="floating-cs-option" type="button" data-floating-cs-action="order">订单问题 <span>›</span></button>',
      '<button class="floating-cs-option" type="button" data-floating-cs-action="refund">退款问题 <span>›</span></button>',
      '<button class="floating-cs-option" type="button" data-floating-cs-action="cooperation">合作留言 <span>›</span></button>',
      '</div>',
      '<div class="floating-cs-content" data-floating-cs-content></div>',
      '</section>'
    ].join("");
    document.body.appendChild(root);
    applyPosition(root, readPosition());
    if (sessionStorage.getItem(CHAT_INTENT_KEY) === "chat" && isCustomerLoggedIn()) {
      sessionStorage.removeItem(CHAT_INTENT_KEY);
      root.classList.add("open");
      renderChat(root);
    }

    var button = root.querySelector(".floating-cs-button");
    var drag = { active: false, moved: false, pointerId: null, startX: 0, startY: 0, startLeft: 0, startTop: 0, nextLeft: 0, nextTop: 0, raf: 0, suppressClick: false };
    function paintDrag() {
      drag.raf = 0;
      root.style.left = drag.nextLeft + "px";
      root.style.top = drag.nextTop + "px";
      root.style.right = "auto";
      root.style.bottom = "auto";
    }

    button.addEventListener("pointerdown", function (event) {
      if (event.button != null && event.button !== 0) return;
      var rect = root.getBoundingClientRect();
      drag.active = true;
      drag.moved = false;
      drag.pointerId = event.pointerId;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      drag.startLeft = rect.left;
      drag.startTop = rect.top;
      drag.nextLeft = rect.left;
      drag.nextTop = rect.top;
      root.classList.add("dragging");
      try { button.setPointerCapture(event.pointerId); } catch (e) {}
      event.preventDefault();
    }, { passive: false });

    button.addEventListener("pointermove", function (event) {
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      var dx = event.clientX - drag.startX;
      var dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 8) drag.moved = true;
      if (!drag.moved) return;
      event.preventDefault();
      root.classList.remove("open");
      var next = clampPosition(drag.startLeft + dx, drag.startTop + dy, root);
      drag.nextLeft = next.left;
      drag.nextTop = next.top;
      if (!drag.raf) drag.raf = requestAnimationFrame(paintDrag);
    }, { passive: false });

    button.addEventListener("pointerup", function (event) {
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      drag.active = false;
      root.classList.remove("dragging");
      try { button.releasePointerCapture(event.pointerId); } catch (e) {}
      if (drag.raf) {
        cancelAnimationFrame(drag.raf);
        paintDrag();
      }
      if (drag.moved) {
        var rect = root.getBoundingClientRect();
        savePosition(rect.left, rect.top);
        drag.suppressClick = true;
        setTimeout(function () {
          drag.moved = false;
          drag.suppressClick = false;
        }, 180);
      }
    });

    button.addEventListener("pointercancel", function () {
      drag.active = false;
      root.classList.remove("dragging");
      if (drag.raf) cancelAnimationFrame(drag.raf);
    });

    button.addEventListener("click", function (event) {
      event.stopPropagation();
      if (drag.moved || drag.suppressClick) return;
      root.classList.toggle("open");
    });

    root.addEventListener("click", function (event) {
      var close = event.target.closest("[data-floating-cs-close]");
      if (close) {
        root.classList.remove("open");
        return;
      }
      var back = event.target.closest("[data-floating-cs-back]");
      if (back && back.tagName !== "A") {
        renderHome(root);
        return;
      }
      var option = event.target.closest("[data-floating-cs-action]");
      if (option) {
        var action = option.getAttribute("data-floating-cs-action");
        if (action === "chat") renderChat(root);
        if (action === "order") renderIssue(root, "order");
        if (action === "refund") renderIssue(root, "refund");
        if (action === "cooperation") renderCooperation(root);
      }
    });

    root.addEventListener("submit", function (event) {
      var form = event.target.closest("[data-floating-coop-form]");
      if (!form) return;
      event.preventDefault();
      fileToDataURL(form.elements.attachment.files[0], function (url) {
        saveCooperation(form, url);
        contentHost(root).innerHTML = '<button class="floating-cs-back" type="button" data-floating-cs-back>返回</button><div class="floating-cs-success">合作留言已提交</div>';
      });
    });

    document.addEventListener("click", function (event) {
      if (!root.contains(event.target)) root.classList.remove("open");
      if (event.target.closest && event.target.closest("[data-login-confirm]")) {
        setTimeout(function () {
          if (sessionStorage.getItem(CHAT_INTENT_KEY) === "chat" && isCustomerLoggedIn()) {
            sessionStorage.removeItem(CHAT_INTENT_KEY);
            root.classList.add("open");
            renderChat(root);
          }
        }, 120);
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") root.classList.remove("open");
    });
    window.addEventListener("resize", function () {
      var rect = root.getBoundingClientRect();
      applyPosition(root, { left: rect.left, top: rect.top });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
