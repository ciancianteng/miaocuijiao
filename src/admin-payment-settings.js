/**
 * Admin Payment Settings — loads/saves/tests real DB config via /api/admin/payment-settings.
 * Mounts into #paymentSettings. Does not restyle admin shell.
 */
(function () {
  "use strict";
  if (window.MCJAdminPaymentSettings) return;

  var state = {
    loading: false,
    error: "",
    channels: [],
    tablesReady: true,
    message: "",
    editId: "",
    tab: "channels",
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function adminRole() {
    try {
      var user = JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}") || {};
      var perms = Array.isArray(user.permissions) ? user.permissions : [];
      var role = String(user.adminRole || user.role || "");
      if (role === "super_admin" || perms.indexOf("super_admin") > -1) return "super_admin";
      if (role === "finance_admin" || perms.indexOf("finance_admin") > -1) return "finance_admin";
      if (role === "admin" || perms.indexOf("admin") > -1) return "admin";
    } catch (e) {}
    return "admin";
  }

  function headers(extra) {
    var base = Object.assign(
      { Accept: "application/json", "Content-Type": "application/json", "x-mcj-admin-role": adminRole() },
      extra || {}
    );
    if (window.MCJAdminAuthFetch && window.MCJAdminAuthFetch.getAuthHeaders) {
      return window.MCJAdminAuthFetch.getAuthHeaders(base);
    }
    return base;
  }

  function fetchApi(init) {
    var req = Object.assign({ headers: headers() }, init || {});
    var runner =
      window.MCJAdminAuthFetch && window.MCJAdminAuthFetch.fetch
        ? window.MCJAdminAuthFetch.fetch("/api/admin/payment-settings", req)
        : fetch("/api/admin/payment-settings", req);
    return runner.then(function (res) {
      return res.text().then(function (text) {
        var body = {};
        try {
          body = text ? JSON.parse(text) : {};
        } catch (e) {
          throw new Error("支付设置接口返回非 JSON：HTTP " + res.status);
        }
        if (!res.ok || body.ok === false) throw new Error(body.message || "HTTP " + res.status);
        return body;
      });
    });
  }

  function chip(text) {
    var t = String(text || "");
    var cls = /成功|已启用|测试通过|已配置/.test(t)
      ? "ok"
      : /失败|异常|停用|未配置|缺少/.test(t)
        ? "bad"
        : "wait";
    return '<span class="status ' + cls + '">' + esc(t) + "</span>";
  }

  function channelById(id) {
    return (state.channels || []).find(function (c) {
      return c.id === id || c.channel_id === id;
    });
  }

  function modeLabel(mode) {
    return mode === "live" ? "Live" : "Sandbox";
  }

  function render() {
    var target = document.getElementById("paymentSettings");
    if (!target) return;
    if (state.loading) {
      target.innerHTML = '<div class="content-loading">正在读取支付设置...</div>';
      return;
    }
    var tabs =
      '<div class="payment-tabs">' +
      [
        ["channels", "支付渠道"],
        ["manual", "手动收款说明"],
      ]
        .map(function (tab) {
          return (
            '<button type="button" class="' +
            (state.tab === tab[0] ? "active" : "") +
            '" data-pay-tab="' +
            tab[0] +
            '">' +
            tab[1] +
            "</button>"
          );
        })
        .join("") +
      "</div>";

    var note = state.message
      ? '<div class="admin-sync-note">' + esc(state.message) + "</div>"
      : "";
    var err = state.error ? '<div class="admin-sync-note" style="color:#ff8aa0">' + esc(state.error) + "</div>" : "";

    var body =
      state.tab === "manual"
        ? '<section class="panel"><h2>手动收款渠道</h2><p class="muted">DuitNow / TNG / 银行转账在渠道卡片中填写收款人资料后保存即可。老板端仅展示已启用渠道。</p></section>'
        : renderChannels();

    target.innerHTML =
      '<div class="payment-module-head"><h2>支付设置</h2><p>HitPay / ToyyibPay / Stripe / DuitNow / TNG / 银行转账。密钥仅存服务端，刷新后配置仍在。</p></div>' +
      tabs +
      note +
      err +
      '<div class="payment-body">' +
      body +
      "</div>";
  }

  function renderChannels() {
    var cards = (state.channels || [])
      .map(function (item) {
        var id = item.channel_id || item.id;
        var status = item.config_status || "未配置";
        var enabledText = item.enabled ? "已启用" : "已停用";
        return (
          '<article class="payment-channel-card">' +
          '<div class="payment-channel-icon">' +
          esc(item.icon || "PAY") +
          "</div>" +
          '<div class="payment-channel-main"><h3>' +
          esc(item.name) +
          "</h3><p>" +
          esc(item.payment_type || item.category) +
          " · " +
          esc((item.currencies || []).join(", ")) +
          "</p></div>" +
          '<div class="payment-card-meta">' +
          chip(status) +
          chip(enabledText) +
          "<small>" +
          esc(modeLabel(item.mode)) +
          " · " +
          esc(item.updated_at || "-") +
          "</small></div>" +
          '<div class="payment-card-actions">' +
          '<button class="mini-btn" type="button" data-pay-edit="' +
          esc(id) +
          '">编辑</button>' +
          '<button class="mini-btn" type="button" data-pay-test="' +
          esc(id) +
          '">测试连接</button>' +
          '<button class="mini-btn" type="button" data-pay-toggle="' +
          esc(id) +
          '" data-pay-enabled="' +
          (item.enabled ? "0" : "1") +
          '">' +
          (item.enabled ? "停用" : "启用") +
          "</button>" +
          "</div></article>"
        );
      })
      .join("");

    var editor = state.editId ? renderEditor(channelById(state.editId)) : "";
    return (
      '<div class="payment-channel-grid">' +
      (cards || '<div class="empty">暂无支付渠道</div>') +
      "</div>" +
      editor
    );
  }

  function renderEditor(item) {
    if (!item) return "";
    var id = item.channel_id || item.id;
    var data = item.data || {};
    var manual = data.manual || {};
    var isApi = item.category === "api";
    var keys = item.credential_keys || [];
    var apiFields = [
      ["apiKey", "API Key"],
      ["apiSecret", "API Secret"],
      ["webhookSecret", "Webhook Secret"],
      ["merchantId", "Merchant ID（如需要）"],
    ];
    var apiHtml = isApi
      ? '<section class="panel"><h2>API 配置</h2><div class="payment-field-grid">' +
        apiFields
          .map(function (field) {
            var configured = keys.indexOf(field[0]) >= 0;
            return (
              "<label><span>" +
              esc(field[1]) +
              '</span><div class="payment-secret-row"><input type="password" autocomplete="new-password" name="' +
              esc(field[0]) +
              '" placeholder="' +
              (configured ? "已保存，留空表示不修改" : "请输入") +
              '"><button type="button" class="mini-btn" data-pay-secret-toggle>显示</button></div><small>当前：' +
              (configured ? "已配置" : "未配置") +
              "</small></label>"
            );
          })
          .join("") +
        '</div><p class="payment-safe-copy">密钥只提交到服务端加密存储，不会写入浏览器本地。</p></section>'
      : "";

    var manualHtml =
      '<section class="panel"><h2>收款资料</h2><div class="payment-field-grid">' +
      '<label><span>收款人姓名</span><input name="receiverName" value="' +
      esc(manual.receiverName || "") +
      '"></label>' +
      '<label><span>银行名称</span><input name="bankName" value="' +
      esc(manual.bankName || "") +
      '"></label>' +
      '<label><span>银行账号</span><input name="bankAccount" value="' +
      esc(manual.bankAccount || "") +
      '"></label>' +
      '<label><span>TNG 手机号</span><input name="phone" value="' +
      esc(manual.phone || "") +
      '"></label>' +
      '<label><span>DuitNow ID</span><input name="duitnowId" value="' +
      esc(manual.duitnowId || "") +
      '"></label>' +
      '<label class="wide"><span>收款说明</span><textarea name="instructions">' +
      esc(data.instructions || "") +
      "</textarea></label>" +
      "</div></section>";

    return (
      '<form class="payment-editor" data-pay-form="' +
      esc(id) +
      '">' +
      '<section class="panel"><h2>基础设置 · ' +
      esc(item.name) +
      '</h2><div class="payment-field-grid">' +
      '<label><span>前台显示名称</span><input name="publicLabel" value="' +
      esc(data.publicLabel || item.name) +
      '"></label>' +
      '<label><span>Sandbox / Live</span><select name="mode"><option value="test"' +
      (item.mode !== "live" ? " selected" : "") +
      '>Sandbox</option><option value="live"' +
      (item.mode === "live" ? " selected" : "") +
      ">Live</option></select></label>" +
      '<label><span>启用</span><select name="enabled"><option value="false"' +
      (!item.enabled ? " selected" : "") +
      '>停用</option><option value="true"' +
      (item.enabled ? " selected" : "") +
      ">启用</option></select></label>" +
      '<label><span>最低充值金额</span><input name="minAmount" inputmode="decimal" value="' +
      esc(data.minAmount != null ? data.minAmount : 10) +
      '"></label>' +
      '<label><span>最高充值金额</span><input name="maxAmount" inputmode="decimal" value="' +
      esc(data.maxAmount != null ? data.maxAmount : 5000) +
      '"></label>' +
      "</div></section>" +
      apiHtml +
      manualHtml +
      '<div class="form-actions">' +
      '<button class="primary-btn" type="submit">保存</button>' +
      '<button class="ghost-btn" type="button" data-pay-test="' +
      esc(id) +
      '">测试连接</button>' +
      '<button class="ghost-btn" type="button" data-pay-cancel>取消</button>' +
      "</div></form>"
    );
  }

  function collectForm(form) {
    var id = form.getAttribute("data-pay-form");
    var item = channelById(id) || { id: id, channel_id: id, data: {} };
    var fd = new FormData(form);
    var credentials = {};
    ["apiKey", "apiSecret", "webhookSecret", "merchantId"].forEach(function (key) {
      var v = String(fd.get(key) || "").trim();
      if (v) credentials[key] = v;
    });
    var manual = {
      receiverName: String(fd.get("receiverName") || "").trim(),
      bankName: String(fd.get("bankName") || "").trim(),
      bankAccount: String(fd.get("bankAccount") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      duitnowId: String(fd.get("duitnowId") || "").trim(),
    };
    var data = Object.assign({}, item.data || {}, {
      publicLabel: String(fd.get("publicLabel") || item.name || ""),
      adminLabel: String(fd.get("publicLabel") || item.name || ""),
      minAmount: Number(fd.get("minAmount") || 10),
      maxAmount: Number(fd.get("maxAmount") || 5000),
      instructions: String(fd.get("instructions") || ""),
      manual: manual,
    });
    return {
      channel: {
        id: id,
        channel_id: id,
        name: item.name,
        icon: item.icon,
        payment_type: item.payment_type,
        category: item.category,
        currencies: item.currencies,
        mode: String(fd.get("mode") || "test"),
        enabled: String(fd.get("enabled")) === "true",
        visible: String(fd.get("enabled")) === "true",
        sort: item.sort || 100,
        data: data,
        credentials: credentials,
      },
    };
  }

  function load() {
    state.loading = true;
    state.error = "";
    render();
    fetchApi({ method: "GET" })
      .then(function (result) {
        state.channels = result.channels || [];
        state.tablesReady = result.tablesReady !== false;
        state.message = result.message || "";
        state.loading = false;
        render();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取支付设置失败";
        state.channels = state.channels || [];
        render();
      });
  }

  function save(form) {
    var payload = collectForm(form);
    var btn = form.querySelector('[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "保存中…";
    }
    fetchApi({
      method: "POST",
      body: JSON.stringify({ action: "save_channel", channel: payload.channel }),
    })
      .then(function (result) {
        alert(result.message || "已保存");
        state.editId = "";
        return load();
      })
      .catch(function (err) {
        alert("保存失败：" + (err.message || "未知错误"));
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "保存";
        }
      });
  }

  function testChannel(id) {
    fetchApi({
      method: "POST",
      body: JSON.stringify({ action: "test_channel", channelId: id }),
    })
      .then(function (result) {
        alert(result.message || (result.ok ? "连接成功。" : "测试失败"));
        return load();
      })
      .catch(function (err) {
        alert("测试失败：" + (err.message || "未知错误"));
      });
  }

  function toggleChannel(id, enabled) {
    fetchApi({
      method: "POST",
      body: JSON.stringify({ action: "toggle_channel", channelId: id, enabled: enabled }),
    })
      .then(function (result) {
        alert(result.message || "已更新");
        return load();
      })
      .catch(function (err) {
        alert(err.message || "操作失败");
      });
  }

  function bind() {
    if (window.__MCJPaySettingsBound) return;
    window.__MCJPaySettingsBound = true;
    document.addEventListener("click", function (e) {
      var tab = e.target.closest("[data-pay-tab]");
      if (tab) {
        state.tab = tab.getAttribute("data-pay-tab") || "channels";
        state.editId = "";
        render();
        return;
      }
      var edit = e.target.closest("[data-pay-edit]");
      if (edit) {
        state.tab = "channels";
        state.editId = edit.getAttribute("data-pay-edit") || "";
        render();
        return;
      }
      var cancel = e.target.closest("[data-pay-cancel]");
      if (cancel) {
        state.editId = "";
        render();
        return;
      }
      var secret = e.target.closest("[data-pay-secret-toggle]");
      if (secret) {
        var input = secret.closest(".payment-secret-row") && secret.closest(".payment-secret-row").querySelector("input");
        if (input) {
          input.type = input.type === "password" ? "text" : "password";
          secret.textContent = input.type === "password" ? "显示" : "隐藏";
        }
        return;
      }
      var test = e.target.closest("[data-pay-test]");
      if (test) {
        testChannel(test.getAttribute("data-pay-test") || "");
        return;
      }
      var toggle = e.target.closest("[data-pay-toggle]");
      if (toggle) {
        var enable = toggle.getAttribute("data-pay-enabled") === "1";
        if (enable && !confirm("确认启用该支付渠道？启用后老板端将可读到此配置。")) return;
        toggleChannel(toggle.getAttribute("data-pay-toggle") || "", enable);
      }
    });
    document.addEventListener("submit", function (e) {
      var form = e.target.closest("[data-pay-form]");
      if (!form) return;
      e.preventDefault();
      save(form);
    });
  }

  function mount() {
    bind();
    load();
  }

  window.MCJAdminPaymentSettings = { mount: mount, reload: load, render: render };
})();
