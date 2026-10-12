(function () {
  var ops = window.MCJOps;
  var catalog = null;
  var step = "service";
  var serviceId = "";
  var companionId = "";
  var result = null;

  function esc(value) { return ops.esc(value); }
  function toast(kind, text) {
    var node = document.getElementById("opsToast");
    if (!node) {
      node = document.createElement("div");
      node.id = "opsToast";
      document.body.appendChild(node);
    }
    node.className = "ops-toast " + kind;
    node.textContent = text;
  }

  function currentService() {
    return (catalog.services || []).find(function (item) { return item.id === serviceId; }) || null;
  }

  function currentCompanion(service) {
    return ((service && service.companions) || []).find(function (item) { return item.id === companionId; }) || null;
  }

  function render() {
    var root = document.getElementById("bossMain");
    if (!catalog) {
      root.innerHTML = '<div class="ops-card">正在读取服务…</div>';
      return;
    }
    if (result) {
      root.innerHTML = successView();
      bindPay();
      return;
    }
    var service = currentService();
    root.innerHTML = '<section class="ops-hero"><div><span class="ops-kicker">BOSS ORDER</span><h2>选择服务并下单</h2><p>服务名称、说明、价格范围和订单要求都从数据库实时读取。关闭的服务不会出现在这里。</p></div></section><div class="stepper"><span class="' + (step === "service" ? "on" : "") + '">1 选择服务</span><span class="' + (step === "companion" ? "on" : "") + '">2 选择陪玩</span><span class="' + (step === "form" ? "on" : "") + '">3 填写要求</span></div>' + (step === "service" ? serviceStep() : step === "companion" ? companionStep(service) : formStep(service)) + (step === "service" ? giftForm() : "");
    if (step === "service") bindGift();
  }

  function giftForm() {
    return '<details class="ops-card" id="giftCard"><summary>给客服送礼</summary><form id="giftForm" class="ops-form"><p>确认到账后才算赠送成功。金额按现有礼物抽成入账，不会直接打给客服。</p><label class="ops-field"><span class="ops-label">礼物</span><select name="giftName"><option>玫瑰</option><option>奶茶</option><option>粉色火箭</option></select></label><label class="ops-field"><span class="ops-label">数量</span><input name="quantity" type="number" min="1" value="1"></label><div class="wide" id="giftChannels">正在读取收款渠道…</div><label class="ops-field wide"><span class="ops-label">付款凭证</span><input name="proof" required placeholder="转账参考号或凭证链接"></label><button class="ops-btn primary" type="submit">提交礼物付款</button></form></details>';
  }

  function bindGift() {
    var box = document.getElementById("giftChannels");
    var form = document.getElementById("giftForm");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";
    ops.request("/public/channels").then(function (channels) {
      var wallet = '<label class="ops-check"><span>猫粮余额</span><input type="radio" name="giftChannel" value="wallet"></label>';
      box.innerHTML = wallet + (channels || []).map(function (item) {
        return '<label class="ops-check"><span>' + esc(item.name) + " · " + esc(item.currency) + '</span><input type="radio" name="giftChannel" value="' + esc(item.id) + '"></label>';
      }).join("");
    }).catch(function () { box.textContent = "渠道读取失败"; });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var selected = form.querySelector("input[name=giftChannel]:checked");
      if (!selected) { toast("error", "请选择付款方式"); return; }
      var body = { giftName: form.elements.giftName.value, quantity: form.elements.quantity.value, proof: form.elements.proof.value, channelId: selected.value };
      if (selected.value === "wallet") body.method = "wallet";
      ops.boss("/boss/gifts", { method: "POST", body: body }).then(function (gift) {
        toast("success", "礼物已提交，等待客服确认到账");
        form.insertAdjacentHTML("beforeend", '<p>记录 ' + esc(gift.id) + " · " + esc(gift.giftName) + " × " + esc(gift.quantity) + " · " + esc(gift.status) + "</p>");
      }).catch(function (error) { toast("error", error.message || "礼物没有提交"); });
    });
  }

  function serviceStep() {
    if (!catalog.services.length) return '<div class="ops-card ops-empty">后台还没有启用的服务。</div>';
    return '<div class="service-pick">' + catalog.services.map(function (service) {
      var range = ops.formatRange(service.priceMin, service.priceMax, service.unit);
      return '<button class="pick-card' + (service.id === serviceId ? " active" : "") + '" type="button" data-service="' + esc(service.id) + '"><b>' + esc(service.name) + '</b><p>' + esc(service.description || "暂无说明") + '</p><p class="ops-price">' + esc(range || "价格未设置") + '</p><span class="ops-muted">' + service.companions.length + " 位陪玩可接单</span></button>";
    }).join("") + "</div>";
  }

  function companionStep(service) {
    if (!service) return '<div class="ops-card">请先选择服务。<button class="ops-btn" type="button" data-step="service">返回</button></div>';
    var cards = service.companions.length ? '<div class="companion-pick">' + service.companions.map(function (item) {
      return '<button class="pick-card' + (item.id === companionId ? " active" : "") + '" type="button" data-companion="' + esc(item.id) + '"><b>' + esc(item.name) + '</b><p>实际单价 <span class="ops-price">' + esc(item.priceText) + '</span></p><p class="ops-muted">允许范围 ' + esc(ops.formatRange(service.priceMin, service.priceMax, service.unit)) + "</p></button>";
    }).join("") + "</div>" : '<div class="ops-card ops-empty">还没有陪玩开启这个服务的接单，或报价不在允许范围内。</div>';
    return '<div class="ops-actions"><button class="ops-btn" type="button" data-step="service">返回服务</button></div>' + cards;
  }

  function formStep(service) {
    var companion = currentCompanion(service);
    if (!service || !companion) return '<div class="ops-card">请先选择服务和陪玩。</div>';
    var bossName = localStorage.getItem("mcjOpsBossName") || "";
    return '<form id="orderForm" class="ops-card ops-form"><div class="wide"><h2>' + esc(service.name) + "</h2><p>" + esc(service.description || "") + '</p><p>陪玩 ' + esc(companion.name) + ' · 单价 <b class="ops-price">' + esc(companion.priceText) + "</b></p></div>" +
      '<label class="ops-field"><span class="ops-label">老板昵称</span><input name="bossName" required value="' + esc(bossName) + '"></label>' +
      '<label class="ops-field"><span class="ops-label">数量（' + esc(service.unit) + '）</span><input name="quantity" type="number" min="0.5" step="0.5" value="1" required></label>' +
      service.fields.map(control).join("") +
      '<div class="wide ops-card"><span class="ops-label">订单总价</span><strong id="orderTotal" class="ops-price"></strong></div><div class="wide ops-actions"><button class="ops-btn" type="button" data-step="companion">返回</button><button class="ops-btn primary" type="submit">提交预约</button></div></form>';
  }

  function control(field) {
    var required = field.required ? " required" : "";
    var label = esc(field.label) + (field.required ? " *" : "");
    var input = '<input name="field_' + esc(field.id) + '"' + required + ">";
    if (field.type === "textarea") input = '<textarea name="field_' + esc(field.id) + '"' + required + "></textarea>";
    if (field.type === "number") input = '<input name="field_' + esc(field.id) + '" type="number" step="any"' + required + ">";
    if (field.type === "select") input = '<select name="field_' + esc(field.id) + '"' + required + '><option value="">请选择</option>' + field.options.map(function (option) { return '<option>' + esc(option) + "</option>"; }).join("") + "</select>";
    if (field.type === "radio" || field.type === "checkbox") {
      input = '<div class="ops-actions">' + field.options.map(function (option) {
        return '<label class="ops-check"><span>' + esc(option) + '</span><input type="' + (field.type === "radio" ? "radio" : "checkbox") + '" name="field_' + esc(field.id) + '" value="' + esc(option) + '"' + (field.type === "radio" ? required : "") + "></label>";
      }).join("") + "</div>";
    }
    return '<label class="ops-field wide"><span class="ops-label">' + label + "</span>" + input + "</label>";
  }

  function updateTotal() {
    var service = currentService();
    var companion = currentCompanion(service);
    var form = document.getElementById("orderForm");
    var total = document.getElementById("orderTotal");
    if (!form || !total || !companion) return;
    var quantity = Number(form.elements.quantity.value);
    total.textContent = ops.formatMoney(companion.quotePrice * quantity) || "无法计算";
  }

  function successView() {
    var lines = (result.requirements || []).filter(function (item) { return item.showOrderDetail !== false; }).map(function (item) {
      var value = Array.isArray(item.value) ? item.value.join("、") : item.value;
      return "<p><span class='ops-muted'>" + esc(item.label) + "</span><br><b>" + esc(value) + "</b></p>";
    }).join("");
    var pay = (result.status === "pending_payment" || result.status === "review_failed")
      ? '<form id="payForm" class="ops-card"><h3>付款</h3><div id="payChannels">正在读取收款渠道…</div><label class="ops-field"><span class="ops-label">付款参考</span><input name="proof" placeholder="转账参考号或凭证链接"></label><button class="ops-btn primary" type="submit">提交付款，等待客服核实</button></form>'
      : "";
    var mood = result.status === "pending_accept"
      ? '<div class="ops-card"><h2>喵～预约已经送达啦！🐱💕</h2><p>正在等待陪玩确认是否接单，请耐心等待哦～</p></div>'
      : result.status === "pending_review"
        ? '<div class="ops-card"><h2>谢谢款待喵～🐱💗</h2><p>我们已经收到您的付款资料，客服正在确认中，请稍等一下哦！上传凭证还不代表已经到账。</p></div>'
        : result.status === "rejected" || result.status === "accept_timeout"
          ? '<div class="ops-card"><h2>这张预约没有接成</h2><p>' + esc(ops.statusLabel(result.status)) + (result.reviewNote ? " · " + esc(result.reviewNote) : "") + "</p></div>"
          : "";
    var discord = (result.serviceSnapshot || {}).voiceMode === "discord" && ["confirmed", "in_service", "completed"].indexOf(result.status) >= 0
      ? '<form id="discordForm" class="ops-card"><h2>' + (result.discordId ? "正在为您安排语音房～🐱💕" : "请填写 Discord ID") + '</h2><p>' + (result.discordId ? "客服正在邀请您和陪玩加入 Discord 语音房，请耐心等待喵～" : "只有这张 Discord 语音房订单在客服确认到账后才需要填写。") + '</p><p>' + (result.discordStatus === "arranged" ? "已安排语音房" : result.discordId ? "等待客服邀请" : "待填写 Discord ID") + '</p><label class="ops-field"><span class="ops-label">Discord ID</span><input name="discordId" value="' + esc(result.discordId || "") + '"></label><button class="ops-btn primary" type="submit">发送</button></form>'
      : "";
    return mood + '<section class="ops-card"><h2>预约 ' + esc(ops.statusLabel(result.status)) + '</h2><p>订单号 ' + esc(result.id) + "</p><p>单价快照 " + esc(ops.formatMoney(result.unitPrice)) + " / " + esc(result.unit) + "</p><p>总价 " + esc(ops.formatMoney(result.totalPrice)) + "</p>" + lines + '<button class="ops-btn" type="button" data-refresh-order>刷新状态</button></section>' + pay + discord;
  }

  function answersFrom(form, service) {
    var answers = {};
    service.fields.forEach(function (field) {
      if (field.type === "checkbox") {
        answers[field.id] = Array.prototype.filter.call(form.querySelectorAll('[name="field_' + field.id + '"]'), function (input) { return input.checked; }).map(function (input) { return input.value; });
      } else if (field.type === "radio") {
        var checked = form.querySelector('[name="field_' + field.id + '"]:checked');
        answers[field.id] = checked ? checked.value : "";
      } else {
        var el = form.elements["field_" + field.id];
        answers[field.id] = el ? el.value : "";
      }
    });
    return answers;
  }

  document.addEventListener("click", function (event) {
    var serviceBtn = event.target.closest("[data-service]");
    if (serviceBtn) {
      serviceId = serviceBtn.dataset.service;
      companionId = "";
      step = "companion";
      render();
      return;
    }
    var companionBtn = event.target.closest("[data-companion]");
    if (companionBtn) {
      companionId = companionBtn.dataset.companion;
      step = "form";
      render();
      updateTotal();
      return;
    }
    var back = event.target.closest("[data-step]");
    if (back) {
      step = back.dataset.step;
      if (step === "service") result = null;
      render();
    }
  });

  document.addEventListener("input", function (event) {
    if (event.target && event.target.name === "quantity") updateTotal();
  });

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || form.id !== "orderForm") return;
    event.preventDefault();
    var service = currentService();
    var button = form.querySelector("button[type=submit]");
    button.disabled = true;
    toast("loading", "正在创建订单…");
    localStorage.setItem("mcjOpsBossName", form.elements.bossName.value.trim());
    ops.boss("/boss/orders", {
      method: "POST",
      body: {
        bossId: localStorage.getItem("mcjOpsBossId") || "",
        bossName: form.elements.bossName.value.trim(),
        serviceId: service.id,
        companionId: companionId,
        quantity: form.elements.quantity.value,
        answers: answersFrom(form, service)
      }
    }).then(function (order) {
      if (!localStorage.getItem("mcjOpsBossId")) localStorage.setItem("mcjOpsBossId", order.bossId);
      result = order;
      toast("success", "预约已提交，等待陪玩接单");
      render();
      watchOrder();
    }).catch(function (error) {
      toast("error", error.message || "下单失败");
      button.disabled = false;
    });
  });

  var watchTimer;
  function watchOrder() {
    if (watchTimer) clearInterval(watchTimer);
    if (!result || ["pending_accept", "pending_review"].indexOf(result.status) < 0) return;
    watchTimer = setInterval(function () {
      if (!result) return;
      ops.boss("/boss/orders?bossId=" + encodeURIComponent(result.bossId)).then(function (orders) {
        var found = (orders || []).find(function (item) { return item.id === result.id; });
        if (!found || found.status === result.status) return;
        result = found;
        render();
        if (["pending_accept", "pending_review"].indexOf(result.status) < 0) clearInterval(watchTimer);
      }).catch(function () {});
    }, 8000);
  }

  function bindPay() {
    var box = document.getElementById("payChannels");
    if (box) {
      ops.request("/public/channels").then(function (channels) {
        var wallet = '<label class="ops-check"><span>猫粮余额 · 内部钱包</span><input type="radio" name="channel" value="wallet"></label>';
        box.innerHTML = wallet + (channels || []).map(function (item) {
          return '<label class="ops-check"><span>' + esc(item.name) + " · " + esc(item.currency) + " · " + esc(item.payee || "") + " " + esc(item.account || "") + '</span><input type="radio" name="channel" value="' + esc(item.id) + '"></label>' + (item.qrUrl ? '<img alt="收款码" src="' + esc(item.qrUrl) + '" style="width:120px;height:120px;object-fit:cover;border-radius:12px">' : "") + "<p>" + esc(item.instructions || "") + "</p>";
        }).join("");
      }).catch(function () { box.textContent = "渠道读取失败"; });
    }
    var form = document.getElementById("payForm");
    if (form && !form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var selected = form.querySelector("input[name=channel]:checked");
        if (!selected) { toast("error", "请选择付款方式"); return; }
        ops.boss("/orders/" + encodeURIComponent(result.id) + "/pay", {
          method: "POST",
          body: { channelId: selected.value, method: selected.value === "wallet" ? "wallet" : "external", proof: form.elements.proof.value }
        }).then(function (order) {
          result = order;
          toast("success", "已提交付款，等待客服核实到账");
          render();
          watchOrder();
        }).catch(function (error) { toast("error", error.message || "付款提交失败"); });
      });
    }
    var discord = document.getElementById("discordForm");
    if (discord && !discord.dataset.bound) {
      discord.dataset.bound = "1";
      discord.addEventListener("submit", function (event) {
        event.preventDefault();
        ops.boss("/orders/" + encodeURIComponent(result.id) + "/discord", { method: "POST", body: { discordId: discord.elements.discordId.value } })
          .then(function (order) {
            result = order;
            sessionStorage.setItem("mcj-discord-sent-" + order.id, "1");
            toast("success", "正在为您安排语音房～🐱💕");
            render();
          })
          .catch(function (error) { toast("error", error.message || "没有发送"); });
      });
    }
  }

  document.addEventListener("click", function (event) {
    if (!event.target.closest("[data-refresh-order]") || !result) return;
    ops.boss("/boss/orders?bossId=" + encodeURIComponent(result.bossId)).then(function (orders) {
      var found = (orders || []).find(function (item) { return item.id === result.id; });
      if (found) result = found;
      render();
    }).catch(function (error) { toast("error", error.message || "刷新失败"); });
  });

  document.addEventListener("DOMContentLoaded", function () {
    var params = new URLSearchParams(location.search);
    if (params.get("bossId")) localStorage.setItem("mcjOpsBossId", params.get("bossId"));
    var pendingOrder = params.get("order");
    ops.boss("/boss/catalog").then(function (data) {
      catalog = data;
      if (pendingOrder) {
        return ops.boss("/boss/orders?bossId=" + encodeURIComponent(localStorage.getItem("mcjOpsBossId") || "")).then(function (orders) {
          result = (orders || []).find(function (item) { return item.id === pendingOrder; }) || null;
          render();
          watchOrder();
        });
      }
      if (params.get("service")) serviceId = params.get("service");
      if (params.get("companion")) companionId = params.get("companion");
      if (serviceId && companionId && currentCompanion(currentService())) step = "form";
      else if (serviceId && currentService()) step = "companion";
      render();
      updateTotal();
    }).catch(function (error) {
      document.getElementById("bossMain").innerHTML = '<div class="ops-card"><h2>加载失败</h2><p>' + esc(error.message) + '</p><button class="ops-btn primary" type="button" onclick="location.reload()">重试</button></div>';
    });
  });
})();
