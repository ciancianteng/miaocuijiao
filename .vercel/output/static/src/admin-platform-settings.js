(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  if (!Auth) return;

  var TARGET = "systemSettings";
  var state = {
    loading: true,
    error: "",
    message: "",
    tab: "info",
    data: null,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function role() {
    try {
      var u = JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}");
      return u.adminRole || u.role || "admin";
    } catch (e) {
      return "admin";
    }
  }
  function mount() {
    return document.getElementById(TARGET);
  }
  function s() {
    return (state.data && state.data.settings) || {};
  }
  function boolSelect(name, label, on) {
    return (
      '<label class="admin-switch-field"><span class="admin-field-label">' +
      esc(label) +
      '</span><select name="' +
      esc(name) +
      '" data-admin-control="switch">' +
      '<option value="true"' +
      (on ? " selected" : "") +
      ">开启</option>" +
      '<option value="false"' +
      (on ? "" : " selected") +
      ">关闭</option></select></label>"
    );
  }
  function field(name, label, value, type) {
    type = type || "text";
    return (
      '<label>' +
      esc(label) +
      '<input name="' +
      esc(name) +
      '" type="' +
      esc(type) +
      '" value="' +
      esc(value == null ? "" : value) +
      '"></label>'
    );
  }
  function area(name, label, value) {
    return (
      "<label>" +
      esc(label) +
      '<textarea name="' +
      esc(name) +
      '" rows="3">' +
      esc(value || "") +
      "</textarea></label>"
    );
  }
  function tabsHtml() {
    var tabs = [
      ["info", "平台信息"],
      ["features", "功能开关"],
      ["database", "数据库与存储"],
      ["payment", "支付接入"],
      ["mail", "邮件与通知"],
      ["third", "第三方服务"],
      ["security", "安全设置"],
      ["diagnostics", "接入检测"],
    ];
    return (
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">' +
      tabs
        .map(function (t) {
          return (
            '<button type="button" class="mini-btn' +
            (state.tab === t[0] ? " primary-lite" : "") +
            '" data-ps-tab="' +
            t[0] +
            '">' +
            t[1] +
            "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }
  function statusChip(text) {
    var t = String(text || "");
    var ok = /正常|已连接|已配置|ok/i.test(t);
    var bad = /异常|失败|error/i.test(t);
    var color = ok ? "#1a7f37" : bad ? "#b42318" : "#667085";
    return '<strong style="color:' + color + '">' + esc(t || "-") + "</strong>";
  }

  function infoHtml() {
    var x = s();
    return (
      '<form class="admin-final-form" data-ps-form="save_platform_info">' +
      "<h3>平台信息</h3><p>普通配置，保存到 platform_settings，全站共用。</p>" +
      field("siteName", "平台中文名称", x.siteName) +
      field("siteNameEn", "平台英文名称", x.siteNameEn) +
      field("companyName", "公司名称", x.companyName) +
      field("contactEmail", "联系邮箱", x.contactEmail, "email") +
      field("supportContact", "客服联系方式", x.supportContact) +
      field("timezone", "时区", x.timezone || "Asia/Kuala_Lumpur") +
      field("defaultCurrency", "默认货币", x.defaultCurrency || "RM") +
      field("catFoodDisplayName", "猫粮显示名称", x.catFoodDisplayName || "猫粮") +
      area("maintenanceMessage", "网站维护说明", x.maintenanceMessage) +
      field("termsUrl", "用户协议链接", x.termsUrl) +
      field("privacyUrl", "隐私政策链接", x.privacyUrl) +
      '<button class="primary-btn" type="submit">保存平台信息</button></form>'
    );
  }

  function featuresHtml() {
    var x = s();
    return (
      '<form class="admin-final-form" data-ps-form="save_features">' +
      "<h3>功能开关</h3><p>后台修改后全站读取同一份配置。</p>" +
      boolSelect("registerOpen", "开放老板注册", x.registerOpen !== false) +
      boolSelect("allowBossOrder", "允许老板下单", x.allowBossOrder !== false) +
      boolSelect("allowCompanionApply", "允许陪玩申请", x.allowCompanionApply !== false) +
      boolSelect("allowCustomerServiceLogin", "允许客服登录", x.allowCustomerServiceLogin !== false) +
      boolSelect("allowCompanionGrab", "允许陪玩抢单", x.allowCompanionGrab !== false) +
      boolSelect("allowWithdraw", "允许提现", x.allowWithdraw !== false) +
      boolSelect("allowRecharge", "允许充值", x.allowRecharge !== false) +
      boolSelect("maintenanceMode", "维护模式", x.maintenanceMode === true) +
      boolSelect("showAnnouncements", "公告显示", x.showAnnouncements !== false) +
      boolSelect("gameplayMallOpen", "更多玩法商城开放", x.gameplayMallOpen !== false) +
      '<button class="primary-btn" type="submit">保存功能开关</button></form>'
    );
  }

  function databaseHtml() {
    var d = (state.data && state.data.diagnostics) || {};
    var checks = d.checks || [];
    var map = {};
    checks.forEach(function (c) {
      map[c.id] = c;
    });
    var policy = (state.data && state.data.keyPolicy) || {};
    var secrets = (state.data && state.data.secrets) || [];
    var rows = [
      ["Supabase 项目", map.supabase_project],
      ["数据库", map.database],
      ["Auth", map.auth],
      ["Storage", map.storage],
      ["Realtime", map.realtime],
    ]
      .map(function (pair) {
        var c = pair[1] || {};
        return (
          "<tr><td>" +
          esc(pair[0]) +
          "</td><td>" +
          statusChip(c.statusText || "未检测") +
          "</td><td>" +
          esc(c.detail || "-") +
          "</td><td>" +
          esc(c.checkedAt || d.checkedAt || "-") +
          "</td></tr>"
        );
      })
      .join("");
    var secretRows = secrets
      .map(function (sec) {
        return (
          "<tr><td>" +
          esc(sec.label) +
          "</td><td>" +
          statusChip(sec.status) +
          "</td><td>" +
          esc(sec.updatedAt || "-") +
          "</td><td>" +
          esc(sec.note || (sec.envOnly ? "环境变量" : "密钥库")) +
          "</td><td>" +
          (sec.updatable
            ? '<button class="mini-btn" type="button" data-ps-replace-secret="' +
              esc(sec.vaultKey) +
              '" data-label="' +
              esc(sec.label) +
              '">替换密钥</button>'
            : '<span class="admin-sync-note" style="display:inline">请在服务器 / Vercel Secrets 更新</span>') +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="admin-sync-note">前端仅允许 Publishable/Anon Key。service_role 只能放在服务器环境变量，禁止 VITE_ 前缀与页面回显。</div>' +
      (policy.viteLeakDetected
        ? '<div class="admin-sync-note error">检测到禁止的 VITE_ 密钥变量存在于进程环境，请立即移除。</div>'
        : "") +
      '<div class="table-wrap"><table><thead><tr><th>项目</th><th>状态</th><th>说明</th><th>最近检测</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      '<p style="margin-top:12px">Project URL：' +
      esc(d.projectUrl || "-") +
      " · Publishable Key：" +
      statusChip(d.publishableKeyStatus) +
      " · Service Role：" +
      statusChip(d.serviceRoleStatus) +
      " · 前端密钥类型：" +
      esc(policy.frontendKeyType || "-") +
      "</p>" +
      "<h3 style=\"margin-top:16px\">敏感密钥</h3>" +
      '<div class="table-wrap"><table><thead><tr><th>密钥</th><th>状态</th><th>最后更新</th><th>说明</th><th>操作</th></tr></thead><tbody>' +
      (secretRows || '<tr><td colspan="5">无密钥元数据</td></tr>') +
      "</tbody></table></div>" +
      '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08)">' +
      '<h3 style="margin:0 0 8px">危险操作</h3>' +
      '<p class="admin-sync-note" style="margin:0 0 10px">清理所有非 admin/super_admin 测试账号及其订单、聊天、陪玩资料等关联数据。此操作不可撤销。</p>' +
      '<button class="mini-btn" type="button" data-ps-purge-test>PURGE 测试数据</button></div>'
    );
  }

  function paymentHtml() {
    var list = (state.data && state.data.payments) || [];
    var x = s();
    var rows = list
      .map(function (p) {
        return (
          "<tr><td>" +
          esc(p.name) +
          "</td><td>" +
          (p.enabled ? "启用" : "停用") +
          "</td><td>" +
          esc(p.merchantName || "-") +
          "</td><td>" +
          esc(p.merchantNo || "-") +
          "</td><td>" +
          esc(p.callbackUrl || "/api/payment-callback") +
          "</td><td>" +
          esc(p.mode || "test") +
          "</td><td>" +
          statusChip(p.connectionStatus) +
          "</td><td>" +
          statusChip(p.secretStatus) +
          "</td><td>" +
          esc(p.lastCheckedAt || "-") +
          "</td></tr>"
        );
      })
      .join("");
    var bank = list.find(function (p) {
      return p.id === "bank-my";
    }) || {};
    return (
      '<div class="admin-sync-note">支付 Client Secret / API Secret / Webhook Secret 仅存服务端。完整银行账号按权限脱敏。详细渠道编辑也可使用左侧「支付设置」模块。</div>' +
      '<div style="margin:10px 0;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="mini-btn primary-lite" type="button" data-ps-config="payment">配置 / 编辑支付网关</button>' +
      '<button class="mini-btn" type="button" data-ps-test-service="payment">测试连接</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>渠道</th><th>启用</th><th>商户名称</th><th>商户编号</th><th>回调地址</th><th>环境</th><th>连接</th><th>密钥</th><th>最近检测</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9">暂无渠道</td></tr>') +
      "</tbody></table></div>" +
      '<form class="admin-final-form" data-ps-form="save_payments_public" style="margin-top:14px">' +
      "<h3>银行转账公开信息</h3>" +
      field("bankName", "银行名称", bank.bankName || "") +
      field("accountName", "公司账户名称", bank.accountName || "") +
      field("accountLast4", "账号后四位", bank.accountLast4 || "") +
      field("duitnowId", "DuitNow ID", bank.duitnowId || "") +
      field("qrUrl", "QR 图片链接", bank.qrUrl || "") +
      boolSelect("bankEnabled", "启用银行转账", bank.enabled === true) +
      '<input type="hidden" name="channelId" value="bank-my">' +
      '<button class="primary-btn" type="submit">保存银行公开信息</button></form>'
    );
  }

  function mailHtml() {
    var x = s();
    var cfg = serviceCfg("mail");
    var smtp = ((cfg && cfg.secretFields) || []).find(function (f) {
      return f.vaultKey === "smtp_pass";
    });
    return (
      '<div class="admin-sync-note">公开参数保存在 platform_settings；SMTP 密码加密写入 platform_secret_vault，刷新后仅显示脱敏。</div>' +
      '<div style="margin:10px 0;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="mini-btn primary-lite" type="button" data-ps-config="mail">配置 / 编辑邮件</button>' +
      '<button class="mini-btn" type="button" data-ps-test-service="mail">测试连接</button></div>' +
      '<form class="admin-final-form" data-ps-form="save_mail_public">' +
      "<h3>邮件与通知（快捷公开字段）</h3>" +
      field("mailFromName", "发件人名称", x.mailFromName) +
      field("mailFromEmail", "发件邮箱", x.mailFromEmail, "email") +
      field("smtpHost", "SMTP Host", x.smtpHost) +
      field("smtpPort", "SMTP Port", x.smtpPort || 587, "number") +
      field("smtpUsername", "Username", x.smtpUsername || "") +
      boolSelect("smtpTls", "启用 TLS", x.smtpTls !== false) +
      "<p>SMTP 密码：" +
      statusChip((smtp && smtp.status) || "未配置") +
      (smtp && smtp.masked ? " <code>" + esc(smtp.masked) + "</code>" : "") +
      "</p>" +
      '<button class="primary-btn" type="submit">保存邮件公开配置</button></form>' +
      '<div class="admin-final-form" style="margin-top:12px"><h3>发送测试邮件</h3>' +
      '<label>测试邮箱<input type="email" data-ps-test-email placeholder="you@example.com"></label>' +
      '<button class="mini-btn primary-lite" type="button" data-ps-send-test-mail>发送测试邮件</button></div>'
    );
  }

  function serviceCfg(id) {
    var list = (state.data && state.data.serviceConfigs) || [];
    return (
      list.find(function (c) {
        return c.id === id;
      }) || null
    );
  }

  function thirdHtml() {
    var cards = (state.data && state.data.thirdParties) || [];
    var x = s();
    var grid = cards
      .map(function (c) {
        var cfg = serviceCfg(c.id);
        var masks = ((cfg && cfg.secretFields) || [])
          .filter(function (f) {
            return f.configured;
          })
          .map(function (f) {
            return f.label + " " + (f.masked || "••••");
          })
          .join(" · ");
        return (
          '<article class="admin-final-stat" style="text-align:left" data-ps-service-card="' +
          esc(c.id) +
          '">' +
          "<span>" +
          esc(c.name) +
          "</span><strong>" +
          esc(c.status) +
          "</strong>" +
          '<p style="margin:8px 0 0;font-size:12px;opacity:.8">' +
          esc(c.purpose) +
          "<br>环境：" +
          esc(c.mode || "-") +
          "<br>最近检测：" +
          esc(c.lastCheckedAt || "-") +
          "<br>" +
          esc(c.detail || masks || "") +
          "</p>" +
          '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' +
          (c.configurable
            ? '<button class="mini-btn primary-lite" type="button" data-ps-config="' +
              esc(c.id) +
              '">配置 / 编辑</button>'
            : "") +
          (c.configurable
            ? '<button class="mini-btn" type="button" data-ps-test-service="' +
              esc(c.id) +
              '">测试连接</button>'
            : '<button class="mini-btn" type="button" data-ps-run-diag>测试连接</button>') +
          "</div></article>"
        );
      })
      .join("");
    return (
      '<div class="admin-sync-note">每个第三方服务均可「配置 / 编辑 → 保存」；密钥写入服务端加密库，刷新后仅显示 ••••末四位。测试连接使用已保存配置。</div>' +
      '<div class="admin-final-grid">' +
      grid +
      "</div>" +
      '<form class="admin-final-form" data-ps-form="save_ai_public" style="margin-top:16px">' +
      "<h3>AI 喵管家（快捷公开参数）</h3><p>完整密钥请用上方卡片「配置 / 编辑」。API Key 永不回显明文。</p>" +
      boolSelect("aiEnabled", "AI 功能启用", x.aiEnabled === true) +
      field("aiModel", "模型名称", x.aiModel) +
      field("aiBaseUrl", "Base URL（可选）", x.aiBaseUrl || "") +
      area("aiSystemPrompt", "系统提示词", x.aiSystemPrompt) +
      field("aiDailyLimit", "每日使用上限", x.aiDailyLimit || 100, "number") +
      area("aiHandoffRule", "客服转人工规则", x.aiHandoffRule) +
      "<p>AI API Key：" +
      statusChip(
        (
          ((serviceCfg("ai") || {}).secretFields || []).find(function (f) {
            return f.vaultKey === "ai_api_key";
          }) || {}
        ).status || "未配置"
      ) +
      (((serviceCfg("ai") || {}).secretFields || []).find(function (f) {
        return f.vaultKey === "ai_api_key" && f.masked;
      })
        ? " <code>" +
          esc(
            ((serviceCfg("ai") || {}).secretFields || []).find(function (f) {
              return f.vaultKey === "ai_api_key";
            }).masked
          ) +
          "</code>"
        : "") +
      "</p>" +
      '<button class="primary-btn" type="submit">保存 AI 公开配置</button></form>'
    );
  }

  function configFormHtml(serviceId) {
    var cfg = serviceCfg(serviceId);
    if (!cfg) {
      return '<div class="admin-sync-note">该服务暂不支持网页配置（请使用环境变量）。</div>';
    }
    var publicFields = cfg.publicFields || [];
    var secrets = cfg.secretFields || [];
    var values = cfg.publicValues || {};
    var publicHtml = publicFields
      .map(function (f) {
        if (f.type === "boolean") {
          return boolSelect(f.key, f.label, values[f.key] === true);
        }
        return (
          "<label>" +
          esc(f.label) +
          '<input name="' +
          esc(f.key) +
          '" type="' +
          esc(f.type === "number" ? "number" : f.type === "email" ? "email" : "text") +
          '" value="' +
          esc(values[f.key] != null ? values[f.key] : "") +
          '" placeholder="' +
          esc(f.placeholder || "") +
          '"></label>'
        );
      })
      .join("");
    var secretHtml = secrets
      .map(function (f) {
        return (
          "<label>" +
          esc(f.label) +
          '<input name="secret__' +
          esc(f.formKey) +
          '" type="password" autocomplete="new-password" placeholder="' +
          (f.configured ? "已保存 " + (f.masked || "••••") + "，留空表示不修改" : "请输入") +
          '"><small>当前：' +
          esc(f.status || "未配置") +
          (f.masked ? " · " + f.masked : "") +
          "</small></label>"
        );
      })
      .join("");
    return (
      '<form class="admin-final-form payment-editor" data-ps-service-form="' +
      esc(serviceId) +
      '">' +
      "<p class=\"admin-sync-note\">公开参数写入 platform_settings；密钥 AES-GCM 加密写入 platform_secret_vault，保存后永不回显明文。</p>" +
      "<h3>公开参数</h3>" +
      (publicHtml || "<p>无公开字段</p>") +
      "<h3 style=\"margin-top:12px\">密钥（加密）</h3>" +
      (secretHtml || "<p>无密钥字段</p>") +
      '<label style="margin-top:8px">修改原因（可选）<input name="reason" type="text" placeholder="轮换密钥 / 首次接入"></label>' +
      '<div class="form-actions" style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="primary-btn" type="submit">保存配置</button>' +
      '<button class="mini-btn" type="button" data-ps-test-service="' +
      esc(serviceId) +
      '">测试连接</button>' +
      '<button class="ghost-btn" type="button" data-ps-config-close>取消</button></div></form>'
    );
  }

  function openServiceConfig(serviceId) {
    var cfg = serviceCfg(serviceId);
    var title = "配置 · " + ((cfg && cfg.name) || serviceId);
    var html = configFormHtml(serviceId);
    if (window.MCJAdminOverlay && typeof window.MCJAdminOverlay.open === "function") {
      window.MCJAdminOverlay.open({ title: title, html: html });
      return;
    }
    state.tab = "third";
    state.message = "请使用侧栏覆盖层编辑；若未加载 overlay，将在下方展示表单。";
    paint();
    var box = mount();
    if (box) {
      var host = document.createElement("div");
      host.className = "panel";
      host.style.marginTop = "12px";
      host.innerHTML = "<h3>" + esc(title) + "</h3>" + html;
      box.appendChild(host);
    }
  }

  function securityHtml() {
    var x = s();
    var logs = (state.data && state.data.logs) || [];
    var can = !!(state.data && state.data.canEditSecrets);
    var logRows = logs
      .map(function (l) {
        return (
          "<tr><td>" +
          esc(l.createdAt) +
          "</td><td>" +
          esc(l.adminRole) +
          "</td><td>" +
          esc(l.configType) +
          "</td><td>" +
          esc(l.action) +
          "</td><td>" +
          esc(l.beforeStatus) +
          " → " +
          esc(l.afterStatus) +
          "</td><td>" +
          esc(l.reason) +
          "</td><td>" +
          esc(l.ip) +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<form class="admin-final-form" data-ps-form="save_security">' +
      "<h3>安全设置</h3>" +
      (can ? "" : '<div class="admin-sync-note">当前角色只能查看状态；保存密钥需管理员权限。</div>') +
      field("sessionHours", "管理员 Session 有效期（小时）", x.sessionHours || 168, "number") +
      field("loginFailLockCount", "登录失败锁定次数", x.loginFailLockCount || 5, "number") +
      boolSelect("adminTwoFactorRequired", "管理员两步验证（策略开关）", x.adminTwoFactorRequired === true) +
      boolSelect("sensitiveChangeReverify", "敏感设置修改二次验证", x.sensitiveChangeReverify !== false) +
      '<button class="primary-btn" type="submit">保存安全策略</button></form>' +
      '<h3 style="margin-top:16px">密钥更新 / 接入操作日志</h3>' +
      '<div class="admin-sync-note">日志只记录「未配置→已配置 / 已配置→已替换」，不记录完整 Secret。</div>' +
      '<div class="table-wrap"><table><thead><tr><th>时间</th><th>角色</th><th>类型</th><th>动作</th><th>状态变化</th><th>原因</th><th>IP</th></tr></thead><tbody>' +
      (logRows || '<tr><td colspan="7">暂无日志</td></tr>') +
      "</tbody></table></div>"
    );
  }

  function diagnosticsHtml() {
    var d = (state.data && state.data.diagnostics) || {};
    var checks = d.checks || [];
    var rows = checks
      .map(function (c) {
        return (
          "<tr><td>" +
          esc(c.id) +
          "</td><td>" +
          statusChip(c.statusText) +
          "</td><td>" +
          esc(c.detail || "-") +
          "</td><td>" +
          esc(c.checkedAt || "-") +
          "</td><td>" +
          esc(c.ms != null ? c.ms + "ms" : "-") +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="admin-section-head compact"><div><h3>接入检测</h3><p>一键真实请求检测，不写死绿色状态。</p></div>' +
      '<button class="mini-btn primary-lite" type="button" data-ps-run-diag>一键检测全部服务</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>检测项</th><th>状态</th><th>错误/说明摘要</th><th>时间</th><th>耗时</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5">尚未检测</td></tr>') +
      "</tbody></table></div>"
    );
  }

  function bodyHtml() {
    if (state.tab === "features") return featuresHtml();
    if (state.tab === "database") return databaseHtml();
    if (state.tab === "payment") return paymentHtml();
    if (state.tab === "mail") return mailHtml();
    if (state.tab === "third") return thirdHtml();
    if (state.tab === "security") return securityHtml();
    if (state.tab === "diagnostics") return diagnosticsHtml();
    return infoHtml();
  }

  function paint() {
    var box = mount();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="content-loading">正在读取平台配置与接入状态...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="admin-sync-note">' +
        esc(state.error) +
        '</div><button class="mini-btn" type="button" data-ps-reload>重试</button>';
      return;
    }
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>平台配置与接入中心</h3><p>普通配置可网页编辑；敏感密钥只存服务器 Secrets / 加密密钥库，永不回显。</p></div>' +
      '<button class="mini-btn" type="button" data-ps-reload>刷新</button></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      tabsHtml() +
      bodyHtml();

    if (window.MCJAdminForms && typeof window.MCJAdminForms.enhance === "function") {
      window.MCJAdminForms.enhance(box);
    }
  }

  function collectForm(form) {
    var fd = new FormData(form);
    var out = {};
    fd.forEach(function (v, k) {
      out[k] = String(v);
    });
    ["registerOpen", "allowBossOrder", "allowCompanionApply", "allowCustomerServiceLogin", "allowCompanionGrab", "allowWithdraw", "allowRecharge", "maintenanceMode", "showAnnouncements", "gameplayMallOpen", "smtpTls", "aiEnabled", "adminTwoFactorRequired", "sensitiveChangeReverify", "bankEnabled"].forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(out, k)) out[k] = out[k] === "true";
    });
    ["smtpPort", "sessionHours", "loginFailLockCount", "aiDailyLimit", "defaultCommissionRate", "defaultRebateRate", "defaultDeposit"].forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(out, k)) out[k] = Number(out[k]);
    });
    return out;
  }

  function post(action, payload) {
    return Auth.post("/api/admin/platform-settings", Object.assign({ action: action }, payload || {}), {
      "x-mcj-admin-role": role(),
    });
  }
  function postPurge(payload) {
    return Auth.post("/api/admin/purge-test-data", payload || {}, {
      "x-mcj-admin-role": role(),
    });
  }

  function load(opts) {
    var keepMsg = !!(opts && opts.keepMessage);
    var prevMsg = keepMsg ? state.message : "";
    state.loading = true;
    state.error = "";
    paint();
    Auth.get("/api/admin/platform-settings", { "x-mcj-admin-role": role() })
      .then(function (res) {
        state.data = res;
        state.loading = false;
        state.message = keepMsg && prevMsg ? prevMsg : res.message || "";
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        paint();
      });
  }

  function replaceSecret(vaultKey, label) {
    if (!(state.data && state.data.canEditSecrets)) {
      alert("当前角色无权替换敏感密钥");
      return;
    }
    var value = prompt("替换「" + label + "」\n输入新密钥（不会回显已保存内容）");
    if (value == null || !String(value).trim()) return;
    var reason = prompt("修改原因（必填）", "轮换密钥");
    if (!reason) return;
    post("update_secret", { vaultKey: vaultKey, value: String(value).trim(), reason: reason })
      .then(function (res) {
        state.message = res.message || "密钥已更新";
        load({ keepMessage: true });
      })
      .catch(function (err) {
        alert(err.message || "更新失败");
      });
  }

  function testService(serviceId) {
    post("test_service", { serviceId: serviceId })
      .then(function (res) {
        alert(res.message || "测试完成");
        state.message = res.message || "测试完成";
        load({ keepMessage: true });
      })
      .catch(function (err) {
        alert(err.message || "测试失败（请先保存配置）");
      });
  }

  function saveServiceForm(form) {
    var serviceId = form.getAttribute("data-ps-service-form");
    var fd = new FormData(form);
    var publicVals = {};
    var secrets = {};
    fd.forEach(function (v, k) {
      var val = String(v);
      if (k.indexOf("secret__") === 0) {
        var fk = k.slice("secret__".length);
        if (val.trim()) secrets[fk] = val.trim();
      } else if (k === "reason") {
        /* handled below */
      } else {
        publicVals[k] = val;
      }
    });
    if (Object.prototype.hasOwnProperty.call(publicVals, "aiEnabled")) {
      publicVals.aiEnabled = publicVals.aiEnabled === "true";
    }
    if (Object.prototype.hasOwnProperty.call(publicVals, "smtpPort")) {
      publicVals.smtpPort = Number(publicVals.smtpPort);
    }
    var reason = String(fd.get("reason") || "").trim() || "保存服务配置";
    var btn = form.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "保存中…";
    }
    return post("save_service_config", {
      serviceId: serviceId,
      public: publicVals,
      secrets: secrets,
      reason: reason,
    })
      .then(function (res) {
        state.message = res.message || "已保存";
        if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
          window.MCJAdminOverlay.close();
        }
        load({ keepMessage: true });
      })
      .catch(function (err) {
        alert(err.message || "保存失败");
        if (btn) {
          btn.disabled = false;
          btn.textContent = "保存配置";
        }
      });
  }

  document.addEventListener("click", function (e) {
    var box = mount();
    var overlayBody =
      window.MCJAdminOverlay && typeof window.MCJAdminOverlay.getBody === "function"
        ? window.MCJAdminOverlay.getBody()
        : null;
    var inScope = function (el) {
      if (!el) return false;
      if (box && box.contains(el)) return true;
      if (overlayBody && overlayBody.contains(el)) return true;
      return false;
    };
    if (!box && !overlayBody) return;

    if (e.target.closest("[data-ps-reload]") && box && box.contains(e.target.closest("[data-ps-reload]"))) {
      load();
      return;
    }
    var tab = e.target.closest("[data-ps-tab]");
    if (tab && box && box.contains(tab)) {
      state.tab = tab.dataset.psTab;
      paint();
      return;
    }
    var jump = e.target.closest("[data-ps-tab-jump]");
    if (jump && box && box.contains(jump)) {
      state.tab = jump.dataset.psTabJump;
      paint();
      return;
    }
    var cfgBtn = e.target.closest("[data-ps-config]");
    if (cfgBtn && inScope(cfgBtn)) {
      openServiceConfig(cfgBtn.getAttribute("data-ps-config"));
      return;
    }
    if (e.target.closest("[data-ps-config-close]")) {
      if (window.MCJAdminOverlay && window.MCJAdminOverlay.close) window.MCJAdminOverlay.close();
      return;
    }
    var testBtn = e.target.closest("[data-ps-test-service]");
    if (testBtn && inScope(testBtn)) {
      testService(testBtn.getAttribute("data-ps-test-service"));
      return;
    }
    var rep = e.target.closest("[data-ps-replace-secret]");
    if (rep && box && box.contains(rep)) {
      replaceSecret(rep.dataset.psReplaceSecret, rep.dataset.label || rep.dataset.psReplaceSecret);
      return;
    }
    if (e.target.closest("[data-ps-purge-test]") && box && box.contains(e.target.closest("[data-ps-purge-test]"))) {
      if (role() !== "super_admin") {
        alert("仅超级管理员可执行测试数据清理");
        return;
      }
      var typed = prompt("此操作将删除所有非 admin/super_admin 账号及相关数据，不可撤销。\n请输入 PURGE_TEST_DATA 确认：");
      if (typed !== "PURGE_TEST_DATA") return;
      if (!confirm("最后确认：立即清理全部测试数据？")) return;
      postPurge({ action: "purge_test_data", confirm: "PURGE_TEST_DATA" })
        .then(function (res) {
          alert((res.message || "清理完成") + "\n\n" + JSON.stringify(res.counts || {}, null, 2));
          load();
        })
        .catch(function (err) {
          alert(err.message || "清理失败");
        });
      return;
    }
    if (e.target.closest("[data-ps-run-diag]") && box && box.contains(e.target.closest("[data-ps-run-diag]"))) {
      post("run_diagnostics", {})
        .then(function (res) {
          if (!state.data) state.data = {};
          state.data.diagnostics = res.diagnostics;
          state.message = res.message || "检测完成";
          state.tab = "diagnostics";
          paint();
        })
        .catch(function (err) {
          alert(err.message || "检测失败");
        });
      return;
    }
    if (e.target.closest("[data-ps-send-test-mail]") && box && box.contains(e.target.closest("[data-ps-send-test-mail]"))) {
      var emailInput = box.querySelector("[data-ps-test-email]");
      var to = emailInput ? emailInput.value.trim() : "";
      if (!to) {
        alert("请输入测试邮箱");
        return;
      }
      post("send_test_email", { to: to })
        .then(function (res) {
          alert(res.message || "已发送");
        })
        .catch(function (err) {
          alert(err.message || "发送失败");
        });
    }
  });

  document.addEventListener("submit", function (e) {
    var serviceForm = e.target.closest("[data-ps-service-form]");
    if (serviceForm) {
      e.preventDefault();
      saveServiceForm(serviceForm);
      return;
    }
    var form = e.target.closest("[data-ps-form]");
    var box = mount();
    if (!form || !box || !box.contains(form)) return;
    e.preventDefault();
    var action = form.getAttribute("data-ps-form");
    var payload = collectForm(form);
    var settings = Object.assign({}, s(), payload);
    if (action === "save_payments_public") {
      var channels = Object.assign({}, settings.paymentChannelsPublic || {});
      channels["bank-my"] = Object.assign({}, channels["bank-my"] || {}, {
        enabled: payload.bankEnabled === true,
        bankName: payload.bankName || "",
        accountName: payload.accountName || "",
        accountNumber: payload.accountLast4 || "",
        duitnowId: payload.duitnowId || "",
        qrUrl: payload.qrUrl || "",
        mode: "live",
      });
      settings.paymentChannelsPublic = channels;
    }
    var btn = form.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "保存中…";
    }
    post(action, { settings: settings })
      .then(function (res) {
        state.message = res.message || "已保存";
        if (res.settings && state.data) state.data.settings = res.settings;
        load({ keepMessage: true });
      })
      .catch(function (err) {
        alert(err.message || "保存失败");
        if (btn) {
          btn.disabled = false;
          btn.textContent = "保存";
        }
      });
  });

  function boot() {
    if (!mount()) return;
    Auth.ensureValidToken()
      .then(load)
      .catch(function () {});
  }
  window.MCJAdminPlatformSettings = { reload: load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
