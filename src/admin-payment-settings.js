/**
 * Admin Payment Settings — loads/saves/tests real DB config via /api/admin/payment-settings.
 * Mounts into #paymentSettings. Does not restyle admin shell.
 */
(function () {
  "use strict";
  if (window.MCJAdminPaymentSettings) return;

  var BANK_PROVIDERS = ["Maybank", "CIMB", "Public Bank", "OCBC", "RHB", "Touch 'n Go", "支付宝", "微信支付", "USDT", "其他"];

  var state = {
    loading: false,
    error: "",
    channels: [],
    banks: [],
    bankProviders: BANK_PROVIDERS,
    tablesReady: true,
    message: "",
    editId: "",
    bankEditId: "",
    bankFormOpen: false,
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
        ["banks", "银行 / 收款方式"],
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
        : state.tab === "banks"
          ? renderBanks()
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
      '<label class="wide"><span>收款二维码图片链接（仅支付页显示）</span><input name="qrUrl" value="' +
      esc(manual.qrUrl || data.qrUrl || "") +
      '" placeholder="https://.../duitnow-qr.png"></label>' +
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

  function bankById(id) {
    return (state.banks || []).find(function (b) {
      return b.id === id;
    });
  }

  function renderBanks() {
    var cards = (state.banks || [])
      .map(function (item) {
        var enabledText = item.enabled !== false ? "已启用" : "已停用";
        return (
          '<article class="payment-channel-card">' +
          '<div class="payment-channel-icon">' +
          esc((item.bank_name || "?").slice(0, 3).toUpperCase()) +
          "</div>" +
          '<div class="payment-channel-main"><h3>' +
          esc(item.bank_name || "未命名渠道") +
          "</h3><p>" +
          esc(item.account_name || "-") +
          " · " +
          esc(item.account_number_mask || "未填写账号") +
          "</p></div>" +
          '<div class="payment-card-meta">' +
          chip(enabledText) +
          (item.is_default ? chip("默认") : "") +
          "<small>" +
          esc(item.currency || "MYR") +
          " · " +
          esc(item.usage || "充值收款") +
          "</small></div>" +
          '<div class="payment-card-actions">' +
          '<button class="mini-btn" type="button" data-bank-edit="' +
          esc(item.id) +
          '">编辑</button>' +
          '<button class="mini-btn" type="button" data-bank-toggle="' +
          esc(item.id) +
          '" data-bank-enabled="' +
          (item.enabled !== false ? "0" : "1") +
          '">' +
          (item.enabled !== false ? "停用" : "启用") +
          "</button>" +
          '<button class="mini-btn danger" type="button" data-bank-delete="' +
          esc(item.id) +
          '">删除</button>' +
          "</div></article>"
        );
      })
      .join("");

    var editor = state.bankFormOpen ? renderBankEditor(bankById(state.bankEditId)) : "";
    return (
      '<div class="payment-module-head" style="margin:0 0 12px"><p class="muted">管理多个银行账户 / 电子钱包收款渠道：Maybank、CIMB、Public Bank、Touch \'n Go、支付宝、微信支付、USDT 等。启用后老板端充值页可读取。</p>' +
      '<button class="primary-btn" type="button" data-bank-new style="margin-top:8px">新增收款渠道</button></div>' +
      '<div class="payment-channel-grid">' +
      (cards || '<div class="empty">暂无收款渠道，点击「新增收款渠道」创建。</div>') +
      "</div>" +
      editor
    );
  }

  function renderBankEditor(item) {
    item = item || { bank_name: BANK_PROVIDERS[0], currency: "MYR", usage: "充值收款", enabled: true };
    var providerOptions = (state.bankProviders && state.bankProviders.length ? state.bankProviders : BANK_PROVIDERS)
      .map(function (p) {
        return '<option value="' + esc(p) + '"' + (item.bank_name === p ? " selected" : "") + ">" + esc(p) + "</option>";
      })
      .join("");
    var hasCustom = (state.bankProviders && state.bankProviders.length ? state.bankProviders : BANK_PROVIDERS).indexOf(item.bank_name) === -1;
    return (
      '<form class="payment-editor" data-bank-form="' +
      esc(item.id || "") +
      '">' +
      '<section class="panel"><h2>' +
      (item.id ? "编辑收款渠道" : "新增收款渠道") +
      '</h2><div class="payment-field-grid">' +
      '<label><span>渠道类型</span><select name="provider">' +
      providerOptions +
      "</select></label>" +
      '<label><span>自定义渠道名称（选择「其他」时使用）</span><input name="providerCustom" value="' +
      (hasCustom ? esc(item.bank_name || "") : "") +
      '" placeholder="例如：Boost / GrabPay"></label>' +
      '<label><span>收款人 / 户名</span><input name="accountName" value="' +
      esc(item.account_name || "") +
      '"></label>' +
      '<label><span>企业名称（可选）</span><input name="enterpriseName" value="' +
      esc(item.enterprise_name || "") +
      '"></label>' +
      '<label><span>账号 / 钱包地址' +
      (item.account_number_mask ? "（当前：" + esc(item.account_number_mask) + "，留空表示不修改）" : "") +
      "</span><input name=\"accountNumber\" placeholder=\"" +
      (item.account_number_mask ? "留空表示不修改" : "请输入账号 / 钱包地址") +
      '"></label>' +
      '<label><span>币种</span><input name="currency" value="' +
      esc(item.currency || "MYR") +
      '"></label>' +
      '<label><span>用途</span><input name="usage" value="' +
      esc(item.usage || "充值收款") +
      '"></label>' +
      '<label><span>设为默认</span><select name="isDefault"><option value="false"' +
      (!item.is_default ? " selected" : "") +
      '>否</option><option value="true"' +
      (item.is_default ? " selected" : "") +
      ">是</option></select></label>" +
      '<label><span>启用</span><select name="enabled"><option value="true"' +
      (item.enabled !== false ? " selected" : "") +
      '>启用</option><option value="false"' +
      (item.enabled === false ? " selected" : "") +
      ">停用</option></select></label>" +
      "</div></section>" +
      '<div class="form-actions">' +
      '<button class="primary-btn" type="submit">保存</button>' +
      '<button class="ghost-btn" type="button" data-bank-cancel>取消</button>' +
      "</div></form>"
    );
  }

  function collectBankForm(form) {
    var id = form.getAttribute("data-bank-form") || "";
    var fd = new FormData(form);
    var provider = String(fd.get("provider") || "").trim();
    var custom = String(fd.get("providerCustom") || "").trim();
    return {
      bank: {
        id: id,
        bankName: provider === "其他" && custom ? custom : provider,
        accountName: String(fd.get("accountName") || "").trim(),
        enterpriseName: String(fd.get("enterpriseName") || "").trim(),
        accountNumber: String(fd.get("accountNumber") || "").trim(),
        currency: String(fd.get("currency") || "MYR").trim() || "MYR",
        usage: String(fd.get("usage") || "充值收款").trim(),
        isDefault: String(fd.get("isDefault")) === "true",
        enabled: String(fd.get("enabled")) === "true",
      },
    };
  }

  function saveBank(form) {
    var payload = collectBankForm(form);
    if (!payload.bank.bankName) {
      alert("请选择渠道类型或填写自定义渠道名称");
      return;
    }
    var btn = form.querySelector('[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "保存中…";
    }
    fetchApi({
      method: "POST",
      body: JSON.stringify({ action: "save_bank", bank: payload.bank }),
    })
      .then(function (result) {
        alert(result.message || "已保存");
        state.bankFormOpen = false;
        state.bankEditId = "";
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

  function deleteBank(id) {
    if (!confirm("确认删除该收款渠道？删除后老板端将不再显示。")) return;
    fetchApi({
      method: "POST",
      body: JSON.stringify({ action: "delete_bank", id: id }),
    })
      .then(function (result) {
        state.message = result.message || "已删除";
        return load();
      })
      .catch(function (err) {
        alert("删除失败：" + (err.message || "未知错误"));
      });
  }

  function toggleBank(id, enabled) {
    fetchApi({
      method: "POST",
      body: JSON.stringify({ action: "toggle_bank", id: id, enabled: enabled }),
    })
      .then(function (result) {
        state.message = result.message || "已更新";
        return load();
      })
      .catch(function (err) {
        alert(err.message || "操作失败");
      });
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
      qrUrl: String(fd.get("qrUrl") || "").trim(),
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
        state.banks = result.banks || [];
        state.bankProviders = result.bankProviders && result.bankProviders.length ? result.bankProviders : BANK_PROVIDERS;
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
        return;
      }
      var bankNew = e.target.closest("[data-bank-new]");
      if (bankNew) {
        state.bankEditId = "";
        state.bankFormOpen = true;
        render();
        return;
      }
      var bankEdit = e.target.closest("[data-bank-edit]");
      if (bankEdit) {
        state.bankEditId = bankEdit.getAttribute("data-bank-edit") || "";
        state.bankFormOpen = true;
        render();
        return;
      }
      var bankCancel = e.target.closest("[data-bank-cancel]");
      if (bankCancel) {
        state.bankFormOpen = false;
        state.bankEditId = "";
        render();
        return;
      }
      var bankDelete = e.target.closest("[data-bank-delete]");
      if (bankDelete) {
        deleteBank(bankDelete.getAttribute("data-bank-delete") || "");
        return;
      }
      var bankToggle = e.target.closest("[data-bank-toggle]");
      if (bankToggle) {
        toggleBank(bankToggle.getAttribute("data-bank-toggle") || "", bankToggle.getAttribute("data-bank-enabled") === "1");
      }
    });
    document.addEventListener("submit", function (e) {
      var bankForm = e.target.closest("[data-bank-form]");
      if (bankForm) {
        e.preventDefault();
        saveBank(bankForm);
        return;
      }
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
