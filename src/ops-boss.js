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
      return;
    }
    var service = currentService();
    root.innerHTML = '<section class="ops-hero"><div><span class="ops-kicker">BOSS ORDER</span><h2>选择服务并下单</h2><p>服务名称、说明、价格范围和订单要求都从数据库实时读取。关闭的服务不会出现在这里。</p></div></section><div class="stepper"><span class="' + (step === "service" ? "on" : "") + '">1 选择服务</span><span class="' + (step === "companion" ? "on" : "") + '">2 选择陪玩</span><span class="' + (step === "form" ? "on" : "") + '">3 填写要求</span></div>' + (step === "service" ? serviceStep() : step === "companion" ? companionStep(service) : formStep(service));
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
      '<div class="wide ops-card"><span class="ops-label">订单总价</span><strong id="orderTotal" class="ops-price"></strong></div><div class="wide ops-actions"><button class="ops-btn" type="button" data-step="companion">返回</button><button class="ops-btn primary" type="submit">提交订单</button></div></form>';
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
    return '<section class="ops-card"><h2>订单已保存</h2><p>订单号 ' + esc(result.id) + "</p><p>单价快照 " + esc(ops.formatMoney(result.unitPrice)) + " / " + esc(result.unit) + "</p><p>总价 " + esc(ops.formatMoney(result.totalPrice)) + "</p><p class='ops-note'>之后如果后台调整价格，这张订单仍使用上面的快照。</p>" + lines + '<button class="ops-btn" type="button" data-step="service">继续下单</button></section>';
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
      toast("success", "订单已创建");
      render();
    }).catch(function (error) {
      toast("error", error.message || "下单失败");
      button.disabled = false;
    });
  });

  document.addEventListener("DOMContentLoaded", function () {
    var params = new URLSearchParams(location.search);
    ops.boss("/boss/catalog").then(function (data) {
      catalog = data;
      if (params.get("service")) serviceId = params.get("service");
      if (params.get("companion")) companionId = params.get("companion");
      if (serviceId && companionId && currentCompanion(currentService())) step = "form";
      else if (serviceId && currentService()) step = "companion";
      render();
      updateTotal();
    }).catch(function (error) {
      document.getElementById("bossMain").innerHTML = '<div class="ops-card"><h2>加载失败</h2><p>' + esc(error.message) + "</p></div>";
    });
  });
})();
