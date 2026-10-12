(function () {
  var ops = window.MCJOps;
  var state = null;
  var ui = { requirementId: "", certId: "", fieldDraft: [] };

  function $(id) { return document.getElementById(id); }
  function esc(value) { return ops.esc(value); }
  function money(value) { return ops.formatMoney(value) || "未设置"; }

  function toast(kind, text) {
    var node = $("opsToast");
    if (!node) {
      node = document.createElement("div");
      node.id = "opsToast";
      document.body.appendChild(node);
    }
    node.className = "ops-toast " + kind;
    node.textContent = text;
    clearTimeout(toast.timer);
    if (kind !== "loading") toast.timer = setTimeout(function () { node.remove(); }, 2600);
  }

  function chip(text, kind) {
    return '<span class="ops-chip ' + kind + '">' + esc(text) + "</span>";
  }

  function actionLabel(action) {
    var map = { submit: "提交申请", approve: "审核通过", reject: "已拒绝", need_more: "要求补充资料", exam_pass: "考核通过", exam_fail: "考核不通过", revoke_badge: "撤销徽章" };
    return map[action] || action;
  }

  function statusMeta(status) {
    var map = {
      pending: ["待审核", "wait"],
      approved: ["申请已通过，待考核", "info"],
      rejected: ["已拒绝", "bad"],
      need_more: ["待补充资料", "wait"],
      exam_passed: ["考核通过", "ok"],
      exam_failed: ["考核未通过", "bad"],
      pending_payment: ["待付款", "wait"]
    };
    return map[status] || [status || "未知", "wait"];
  }

  function field(label, html, wide) {
    return '<label class="ops-field' + (wide ? " wide" : "") + '"><span class="ops-label">' + label + "</span>" + html + "</label>";
  }

  function openModal(html, drawer) {
    var modal = $("opsModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "opsModal";
      modal.innerHTML = '<div class="ops-modal-card" role="dialog"><div id="opsModalBody"></div></div>';
      document.body.appendChild(modal);
      modal.addEventListener("click", function (event) {
        if (event.target === modal) closeModal();
      });
    }
    modal.className = drawer ? "ops-modal drawer" : "ops-modal";
    $("opsModalBody").innerHTML = html;
    modal.hidden = false;
  }

  function closeModal() {
    var modal = $("opsModal");
    if (modal) modal.hidden = true;
  }

  async function reload() {
    toast("loading", "正在读取数据库…");
    state = await ops.admin("/admin/snapshot");
    if (ui.requirementId && !state.services.some(function (item) { return item.id === ui.requirementId; })) ui.requirementId = "";
    if (!ui.requirementId && state.services[0]) ui.requirementId = state.services[0].id;
    syncFieldDraft();
    renderAll();
    var node = $("opsToast");
    if (node && node.classList.contains("loading")) node.remove();
  }

  function syncFieldDraft() {
    ui.fieldDraft = state.fields.filter(function (item) { return item.serviceId === ui.requirementId; })
      .map(function (item) { return Object.assign({}, item, { optionsText: (item.options || []).join("，") }); });
  }

  function renderAll() {
    renderDashboard();
    renderServices();
    renderPrices();
    renderRequirements();
    renderCompanions();
    renderCerts();
    renderExaminers();
    renderBadges();
    renderSettings();
    renderOrdersBoard();
    renderChannels();
    renderAnnouncements();
    renderDeposits();
    renderSettlement();
    var legacy = $("table-price_table");
    if (legacy) {
      legacy.innerHTML = state.services.length ? '<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>服务</th><th>价格范围</th><th>单位</th><th>状态</th></tr></thead><tbody>' + state.services.map(function (service) {
        return "<tr><td>" + esc(service.name) + "</td><td>" + esc(ops.formatRange(service.priceMin, service.priceMax, service.unit) || "未设置") + "</td><td>" + esc(service.unit) + "</td><td>" + (service.enabled ? chip("启用", "ok") : chip("已关闭", "bad")) + "</td></tr>";
      }).join("") + "</tbody></table></div><p class='ops-note'>价格与服务内容以运营中台数据库为准，老板端和陪玩端读取同一接口。</p>" : '<div class="ops-empty">还没有服务。请到「服务管理」新增。</div>';
    }
  }

  function renderDashboard() {
    var root = $("opsDashboard");
    if (!root || !state) return;
    var stats = state.stats || {};
    root.innerHTML = '<div class="ops-home"><section class="ops-hero"><div><span class="ops-kicker">MEOW CUI JIAO</span><h2>运营总览</h2><p>服务、价格、订单要求和认证都来自同一套 SQLite 数据库。老板端和陪玩端不会再使用另一份缓存。</p></div><div class="ops-actions"><a class="ops-btn" href="boss-order.html" target="_blank">打开老板端</a><a class="ops-btn" href="companion-studio.html" target="_blank">打开陪玩端</a><button class="ops-btn primary" type="button" data-ops="reload">刷新数据</button></div></section><section class="ops-card" id="opsDaily"><h3>今日数据</h3><div data-daily>正在读取…</div></section><section class="ops-metrics"><article class="ops-metric"><span>启用服务</span><strong>' + stats.services + '</strong></article><article class="ops-metric"><span>在册陪玩</span><strong>' + stats.companions + '</strong></article><article class="ops-metric"><span>待处理认证</span><strong>' + stats.pendingCerts + '</strong></article><article class="ops-metric"><span>订单快照</span><strong>' + stats.orders + '</strong></article><article class="ops-metric"><span>有效徽章</span><strong>' + stats.activeBadges + '</strong></article></section><section class="ops-grid-2"><article class="ops-card"><h3>最近订单</h3>' + orderTable(state.orders.slice(0, 6)) + '</article><article class="ops-card"><h3>价格检查</h3>' + priceWarnings() + '</article></section></div>';
    ops.admin("/admin/daily").then(function (daily) {
      var box = root.querySelector("[data-daily]");
      if (!box || !daily) return;
      box.innerHTML = "今日订单 " + esc(daily.orders) + " · 成交额 " + esc(ops.formatMoney(daily.turnover) || "RM0.00") + " · 待审核付款 " + esc(daily.pendingPayments) + " · 新陪玩申请 " + esc(daily.applications) + " · 在线陪玩 " + esc(daily.onlineCompanions) + " · 待处理客服 " + esc(daily.pendingChats) + '<div class="ops-actions"><button class="ops-btn" type="button" data-ops="reminder" data-enabled="1">开启三小时提醒</button><button class="ops-btn" type="button" data-ops="reminder" data-enabled="0">关闭三小时提醒</button></div>';
    }).catch(function () {
      var box = root.querySelector("[data-daily]");
      if (box) box.textContent = "今日数据暂时读不到";
    });
  }

  function orderTable(orders) {
    if (!orders.length) return '<div class="ops-empty">还没有订单。老板下单后，这里会显示单价快照。</div>';
    return '<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>订单</th><th>服务快照</th><th>单价</th><th>总价</th></tr></thead><tbody>' + orders.map(function (order) {
      var meta = statusMeta(order.status);
      return "<tr><td data-label='订单'><b>" + esc(order.id) + "</b><br><span class='ops-muted'>" + esc(order.bossName) + " → " + esc(companionName(order.companionId)) + "</span><br>" + chip(meta[0], meta[1]) + "</td><td data-label='服务'>" + esc((order.serviceSnapshot || {}).name || "") + "</td><td data-label='单价' class='ops-price'>" + esc(ops.formatMoney(order.unitPrice)) + " / " + esc(order.unit) + "</td><td data-label='总价' class='ops-price'>" + esc(ops.formatMoney(order.totalPrice)) + "</td></tr>";
    }).join("") + "</tbody></table></div>";
  }

  function priceWarnings() {
    var bad = state.services.filter(function (service) { return !ops.formatRange(service.priceMin, service.priceMax, service.unit); });
    if (!bad.length) return "<p>已启用和停用的服务都有独立的最低价、最高价和计费单位。页面不会显示 RM-。</p>";
    return "<p>以下服务价格不完整，老板端不会把它当成可下单单价：</p><ul>" + bad.map(function (service) { return "<li>" + esc(service.name) + "</li>"; }).join("") + "</ul>";
  }

  function companionName(id) {
    var found = (state.companions || []).find(function (item) { return item.id === id; });
    return found ? found.name : id;
  }

  function renderServices() {
    var root = $("opsServices");
    if (!root) return;
    root.innerHTML = '<div class="ops-page"><div class="ops-toolbar"><div><h2>服务管理</h2><p class="ops-note">新增或修改后，老板端和陪玩端刷新即可看到同一条服务。</p></div><button class="ops-btn primary" type="button" data-ops="new-service">新增服务</button></div>' + serviceTable(state.services) + "</div>";
  }

  function serviceTable(services) {
    if (!services.length) return '<div class="ops-card ops-empty">还没有服务。点击「新增服务」写入数据库。</div>';
    return '<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>服务</th><th>说明</th><th>价格范围</th><th>状态</th><th></th></tr></thead><tbody>' + services.map(function (service) {
      var range = ops.formatRange(service.priceMin, service.priceMax, service.unit);
      return "<tr><td data-label='服务'><b>" + esc(service.name) + "</b><br><span class='ops-muted'>" + esc(service.category || "未分类") + "</span></td><td data-label='说明'>" + esc(service.description || "未填写") + "</td><td data-label='价格'>" + esc(range || "未设置") + "</td><td data-label='状态'>" + (service.enabled ? chip("启用", "ok") : chip("已关闭", "bad")) + "</td><td data-label='操作'><button class='ops-btn' type='button' data-ops='edit-service' data-id='" + esc(service.id) + "'>编辑</button> <button class='ops-btn danger' type='button' data-ops='delete-service' data-id='" + esc(service.id) + "'>删除</button></td></tr>";
    }).join("") + "</tbody></table></div>";
  }

  function renderPrices() {
    var root = $("opsPrices");
    if (!root) return;
    var units = (state.settings.units || []).map(function (unit) { return '<option value="' + esc(unit) + '">' + esc(unit) + "</option>"; }).join("");
    root.innerHTML = '<div class="ops-page"><div class="ops-toolbar"><div><h2>价格管理</h2><p class="ops-note">最低价、最高价和计费单位分开保存。陪玩报价必须落在这个范围内。</p></div></div>' + (state.services.length ? state.services.map(function (service) {
      return '<form class="ops-card ops-form" data-price-form="' + esc(service.id) + '"><div class="wide ops-split"><h3>' + esc(service.name) + "</h3>" + (service.enabled ? chip("启用", "ok") : chip("已关闭", "bad")) + "</div>" + field("最低价格", '<input name="priceMin" type="number" min="0" step="0.01" required value="' + esc(service.priceMin) + '">') + field("最高价格", '<input name="priceMax" type="number" min="0" step="0.01" required value="' + esc(service.priceMax) + '">') + field("计费单位", '<select name="unit">' + units + "</select>") + '<div class="wide ops-actions"><button class="ops-btn primary" type="submit">保存价格</button></div></form>';
    }).join("") : '<div class="ops-empty">请先创建服务。</div>') + "</div>";
    root.querySelectorAll("[data-price-form]").forEach(function (form) {
      var service = state.services.find(function (item) { return item.id === form.dataset.priceForm; });
      if (service && form.elements.unit) form.elements.unit.value = service.unit;
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        savePrice(form);
      });
    });
  }

  async function savePrice(form) {
    var service = state.services.find(function (item) { return item.id === form.dataset.priceForm; });
    var button = form.querySelector("button");
    button.disabled = true;
    toast("loading", "正在保存价格…");
    try {
      await ops.admin("/admin/services/" + encodeURIComponent(service.id), {
        method: "PATCH",
        body: Object.assign({}, service, {
          priceMin: form.elements.priceMin.value,
          priceMax: form.elements.priceMax.value,
          unit: form.elements.unit.value
        })
      });
      toast("success", "价格已保存，两端会读取新范围");
      await reload();
    } catch (error) {
      toast("error", error.message || "保存失败");
      button.disabled = false;
    }
  }

  function serviceForm(service) {
    var units = (state.settings.units || []).map(function (unit) {
      return '<option value="' + esc(unit) + '"' + (service && service.unit === unit ? " selected" : "") + ">" + esc(unit) + "</option>";
    }).join("");
    openModal('<form id="serviceForm" class="ops-form"><div class="wide"><h2>' + (service ? "编辑服务与价格" : "新增服务") + '</h2><p class="ops-note">保存后立即写入数据库。</p></div>' +
      field("服务名称", '<input name="name" required value="' + esc(service ? service.name : "") + '">', true) +
      field("分类", '<input name="category" value="' + esc(service ? service.category : "") + '">') +
      field("服务说明", '<textarea name="description">' + esc(service ? service.description : "") + "</textarea>", true) +
      field("最低价格", '<input name="priceMin" type="number" min="0" step="0.01" required value="' + esc(service && service.priceMin != null ? service.priceMin : "") + '">') +
      field("最高价格", '<input name="priceMax" type="number" min="0" step="0.01" required value="' + esc(service && service.priceMax != null ? service.priceMax : "") + '">') +
      field("计费单位", '<select name="unit">' + units + "</select>") +
      field("排序", '<input name="sort" type="number" value="' + esc(service ? service.sort : state.services.length + 1) + '">') +
      field("语音方式", '<select name="voiceMode"><option value="">不使用语音房</option><option value="game"' + (service && service.voiceMode === "game" ? " selected" : "") + '>游戏麦</option><option value="discord"' + (service && service.voiceMode === "discord" ? " selected" : "") + ">Discord 语音房</option></select>") +
      '<label class="ops-switch wide"><span>启用服务。关闭后新订单不能再选。</span><input name="enabled" type="checkbox"' + (!service || service.enabled ? " checked" : "") + "></label>" +
      '<div class="wide ops-actions"><button class="ops-btn" type="button" data-ops="close-modal">取消</button><button class="ops-btn primary" type="submit">' + (service ? "保存修改" : "创建服务") + "</button></div></form>");
    var form = $("serviceForm");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submitService(form, service && service.id);
    });
  }

  async function deleteService(id) {
    var service = state.services.find(function (item) { return item.id === id; });
    if (!service || !window.confirm("删除「" + service.name + "」后，新订单不能再选。已有订单仍保留原快照。")) return;
    toast("loading", "正在删除服务…");
    try {
      await ops.admin("/admin/services/" + encodeURIComponent(id), { method: "DELETE" });
      toast("success", "服务已删除");
      await reload();
    } catch (error) {
      toast("error", error.message || "删除失败");
    }
  }

  async function submitService(form, id) {
    var button = form.querySelector("button[type=submit]");
    button.disabled = true;
    toast("loading", "正在保存服务…");
    var body = {
      name: form.elements.name.value,
      category: form.elements.category.value,
      description: form.elements.description.value,
      priceMin: form.elements.priceMin.value,
      priceMax: form.elements.priceMax.value,
      unit: form.elements.unit.value,
      voiceMode: form.elements.voiceMode.value,
      sort: form.elements.sort.value,
      enabled: form.elements.enabled.checked
    };
    try {
      await ops.admin(id ? "/admin/services/" + encodeURIComponent(id) : "/admin/services", { method: id ? "PATCH" : "POST", body: body });
      closeModal();
      toast("success", id ? "服务已更新" : "服务已创建");
      await reload();
    } catch (error) {
      toast("error", error.message || "保存失败");
      button.disabled = false;
    }
  }

  function renderRequirements() {
    var root = $("opsRequirements");
    if (!root) return;
    var current = state.services.find(function (item) { return item.id === ui.requirementId; });
    root.innerHTML = '<div class="ops-page"><div class="ops-toolbar"><div><h2>订单要求配置</h2><p class="ops-note">每个服务有自己的字段。老板填写的内容会随订单快照保存，之后改字段不会改写旧订单。</p></div></div><div class="ops-card"><h3>选择服务</h3><div class="ops-actions">' + (state.services.map(function (service) {
      return '<button class="ops-btn' + (service.id === ui.requirementId ? " primary" : "") + '" type="button" data-ops="pick-requirement" data-id="' + esc(service.id) + '">' + esc(service.name) + "</button>";
    }).join("") || "还没有服务") + '</div></div><div class="ops-card"><h3>' + esc(current ? current.name : "字段") + '</h3><div id="fieldEditor"></div></div></div>';
    renderFieldEditor();
  }

  function renderFieldEditor() {
    var root = $("fieldEditor");
    if (!root) return;
    if (!ui.requirementId) {
      root.innerHTML = '<div class="ops-empty">请先创建服务。</div>';
      return;
    }
    root.innerHTML = ui.fieldDraft.map(function (fieldItem, index) {
      return '<div class="ops-group" data-field-index="' + index + '"><div class="ops-split"><strong>字段 ' + (index + 1) + '</strong><div class="ops-actions"><button class="ops-btn" type="button" data-ops="move-field" data-index="' + index + '" data-dir="-1">上移</button><button class="ops-btn" type="button" data-ops="move-field" data-index="' + index + '" data-dir="1">下移</button><button class="ops-btn danger" type="button" data-ops="remove-field" data-index="' + index + '">删除</button></div></div><div class="ops-form">' +
        field("名称", '<input data-field-key="label" value="' + esc(fieldItem.label) + '">') +
        field("类型", '<select data-field-key="type">' + ["text:文本", "textarea:多行备注", "radio:单选", "checkbox:多选", "select:下拉", "number:数字"].map(function (item) {
          var pair = item.split(":");
          return '<option value="' + pair[0] + '"' + (fieldItem.type === pair[0] ? " selected" : "") + ">" + pair[1] + "</option>";
        }).join("") + "</select>") +
        field("选项（用逗号分隔）", '<input data-field-key="optionsText" value="' + esc(fieldItem.optionsText || "") + '">', true) +
        '<div class="ops-checks wide">' +
        check("必填", "required", fieldItem.required) +
        check("老板端显示", "showBoss", fieldItem.showBoss) +
        check("陪玩端显示", "showCompanion", fieldItem.showCompanion) +
        check("订单详情显示", "showOrderDetail", fieldItem.showOrderDetail) +
        "</div></div></div>";
    }).join("") + '<div class="ops-actions"><button class="ops-btn" type="button" data-ops="add-field">新增字段</button><button class="ops-btn primary" type="button" data-ops="save-fields">保存字段配置</button></div>';
  }

  function check(label, key, checked) {
    return '<label class="ops-check"><span>' + label + '</span><input data-field-key="' + key + '" type="checkbox"' + (checked ? " checked" : "") + "></label>";
  }

  function readFieldDraftFromDom() {
    return Array.prototype.map.call(document.querySelectorAll("[data-field-index]"), function (node, index) {
      function value(key) {
        var el = node.querySelector('[data-field-key="' + key + '"]');
        if (!el) return "";
        if (el.type === "checkbox") return el.checked;
        return el.value;
      }
      var previous = ui.fieldDraft[index] || {};
      return {
        id: previous.id || ("new_" + index),
        label: value("label"),
        type: value("type"),
        optionsText: value("optionsText"),
        options: String(value("optionsText") || "").split(/[，,]/).map(function (item) { return item.trim(); }).filter(Boolean),
        required: !!value("required"),
        showBoss: !!value("showBoss"),
        showCompanion: !!value("showCompanion"),
        showOrderDetail: !!value("showOrderDetail"),
        sort: index
      };
    });
  }

  function renderCompanions() {
    var root = $("opsCompanions");
    if (!root) return;
    root.innerHTML = '<div class="ops-page"><div class="ops-toolbar"><div><h2>陪玩资料管理</h2><p class="ops-note">资料、报价和展示开关都保存在数据库。管理员可以改资料，展示开关的自助权限在系统设置里。</p></div></div>' + (state.companions.length ? '<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>陪玩</th><th>游戏</th><th>状态</th><th>服务报价</th><th></th></tr></thead><tbody>' + state.companions.map(function (companion) {
      var offers = state.offerings.filter(function (item) { return item.companionId === companion.id; });
      return "<tr><td data-label='陪玩'><b>" + esc(companion.name) + "</b><br><span class='ops-muted'>" + esc(companion.bio || "未填写简介") + "</span></td><td data-label='游戏'>" + esc(companion.game || "-") + "</td><td data-label='状态'>" + (companion.status === "active" ? chip("正常", "ok") : chip("停用", "bad")) + "</td><td data-label='报价'>" + (offers.map(function (offer) {
        var service = state.services.find(function (item) { return item.id === offer.serviceId; });
        return esc((service && service.name) || offer.serviceId) + " " + esc(ops.formatMoney(offer.quotePrice) || "未报价");
      }).join("<br>") || "未配置") + "</td><td data-label='操作'><button class='ops-btn' type='button' data-ops='edit-companion' data-id='" + esc(companion.id) + "'>编辑资料</button></td></tr>";
    }).join("") + "</tbody></table></div>" : '<div class="ops-empty">陪玩还没有在工作台建立资料。</div>') + "</div>";
  }

  function companionForm(companion) {
    openModal('<form id="companionForm" class="ops-form"><div class="wide"><h2>编辑陪玩资料</h2></div>' +
      field("名称", '<input name="name" required value="' + esc(companion.name) + '">') +
      field("游戏", '<input name="game" value="' + esc(companion.game) + '">') +
      field("头像地址", '<input name="avatar" value="' + esc(companion.avatar) + '">', true) +
      field("简介", '<textarea name="bio">' + esc(companion.bio) + "</textarea>", true) +
      field("状态", '<select name="status"><option value="active"' + (companion.status === "active" ? " selected" : "") + '>正常</option><option value="suspended"' + (companion.status !== "active" ? " selected" : "") + ">停用</option></select>") +
      '<div class="wide ops-actions"><button class="ops-btn" type="button" data-ops="close-modal">取消</button><button class="ops-btn primary" type="submit">保存资料</button></div></form>');
    $("companionForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var button = form.querySelector("button[type=submit]");
      button.disabled = true;
      toast("loading", "正在保存陪玩资料…");
      try {
        await ops.admin("/admin/companions/" + encodeURIComponent(companion.id), {
          method: "PATCH",
          body: { name: form.elements.name.value, game: form.elements.game.value, avatar: form.elements.avatar.value, bio: form.elements.bio.value, status: form.elements.status.value }
        });
        closeModal();
        toast("success", "陪玩资料已保存");
        await reload();
      } catch (error) {
        toast("error", error.message || "保存失败");
        button.disabled = false;
      }
    });
  }

  function renderCerts() {
    var root = $("opsCerts");
    if (!root) return;
    root.innerHTML = '<div class="ops-page"><div><h2>技术认证申请审核</h2><p class="ops-note">通过申请只代表可以参加考核。考核通过后才会发放徽章。</p></div>' + (state.applications.length ? '<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>陪玩</th><th>申请</th><th>状态</th><th></th></tr></thead><tbody>' + state.applications.map(function (item) {
      var meta = statusMeta(item.status);
      return "<tr><td data-label='陪玩'>" + esc(companionName(item.companionId)) + "</td><td data-label='申请'><b>" + esc(item.game) + " · " + esc(item.certItem) + "</b><br><span class='ops-muted'>" + esc(item.techLevel) + "</span></td><td data-label='状态'>" + chip(meta[0], meta[1]) + "</td><td data-label='操作'><button class='ops-btn' type='button' data-ops='open-cert' data-id='" + esc(item.id) + "'>查看详情</button></td></tr>";
    }).join("") + "</tbody></table></div>" : '<div class="ops-empty">还没有认证申请。</div>') + "</div>";
  }

  function certDetail(id) {
    var item = state.applications.find(function (entry) { return entry.id === id; });
    if (!item) return;
    var reviews = state.reviews.filter(function (entry) { return entry.applicationId === id; });
    var badge = state.badges.find(function (entry) { return entry.applicationId === id && entry.active; });
    var meta = statusMeta(item.status);
    openModal('<div class="ops-page"><div class="ops-split"><h2>认证申请详情</h2><div class="ops-actions">' + chip(meta[0], meta[1]) + '<button class="ops-btn" type="button" data-ops="close-modal">关闭</button></div></div><div class="ops-grid-2"><article class="ops-card"><h3>' + esc(companionName(item.companionId)) + "</h3><p>游戏：" + esc(item.game) + "</p><p>项目：" + esc(item.certItem) + "</p><p>技术等级：" + esc(item.techLevel) + "</p><p>考核备注：" + esc(item.examNote) + "</p><p>申请说明：" + esc(item.description || "无") + "</p><p>证明资料：" + esc(item.proof || "未上传") + "</p></article><article class='ops-card'><h3>审核记录</h3>" + (reviews.length ? reviews.map(function (review) {
      return "<p><b>" + esc(actionLabel(review.action)) + "</b> · " + esc(review.createdAt) + "<br>" + esc(review.reason || "无备注") + "</p>";
    }).join("") : "<p>还没有审核记录。</p>") + "</article></div><label class='ops-field'><span class='ops-label'>原因（拒绝、补充、考核不通过、撤销时必填）</span><textarea id='reviewReason'></textarea></label><div class='ops-actions'><button class='ops-btn primary' type='button' data-ops='review' data-action='approve' data-id='" + esc(item.id) + "'>审核通过</button><button class='ops-btn danger' type='button' data-ops='review' data-action='reject' data-id='" + esc(item.id) + "'>拒绝</button><button class='ops-btn' type='button' data-ops='review' data-action='need_more' data-id='" + esc(item.id) + "'>要求补充资料</button><button class='ops-btn primary' type='button' data-ops='review' data-action='exam_pass' data-id='" + esc(item.id) + "'>考核通过并发放徽章</button><button class='ops-btn danger' type='button' data-ops='review' data-action='exam_fail' data-id='" + esc(item.id) + "'>考核不通过</button>" + (badge ? "<button class='ops-btn danger' type='button' data-ops='review' data-action='revoke_badge' data-id='" + esc(item.id) + "'>撤销徽章</button>" : "") + "</div></div>");
  }

  async function review(id, action) {
    var reason = ($("reviewReason") && $("reviewReason").value) || "";
    toast("loading", "正在提交审核…");
    try {
      await ops.admin("/admin/cert/" + encodeURIComponent(id) + "/review", { method: "POST", body: { action: action, reason: reason } });
      closeModal();
      toast("success", "审核结果已保存");
      await reload();
      certDetail(id);
    } catch (error) {
      toast("error", error.message || "审核失败");
    }
  }

  function renderExaminers() {
    var root = $("opsExaminers");
    if (!root) return;
    root.innerHTML = '<div class="ops-page"><div><h2>考官联系方式</h2><p class="ops-note">联系方式只在申请审核通过后，通过陪玩接口返回。公开卡片和老板目录不会读取这张表。</p></div><form id="examinerForm" class="ops-card ops-form"><h3 class="wide">新增考官</h3>' +
      field("名称", '<input name="name" required>') + field("对应游戏", '<input name="game" required>') +
      field("微信", '<input name="wechat">') + field("WhatsApp", '<input name="whatsapp">') +
      field("QQ", '<input name="qq">') + field("Telegram", '<input name="telegram">') +
      field("考核说明", '<textarea name="examNote"></textarea>', true) +
      '<label class="ops-switch wide"><span>启用</span><input name="enabled" type="checkbox" checked></label><div class="wide"><button class="ops-btn primary" type="submit">保存考官</button></div></form><div class="ops-grid-2">' + state.examiners.map(function (item) {
        return '<article class="ops-card"><div class="ops-split"><h3>' + esc(item.name) + "</h3>" + (item.enabled ? chip("启用", "ok") : chip("关闭", "bad")) + "</div><p>" + esc(item.game) + "</p><p>微信 " + esc(item.wechat || "-") + " · WhatsApp " + esc(item.whatsapp || "-") + "</p><p>QQ " + esc(item.qq || "-") + " · Telegram " + esc(item.telegram || "-") + "</p><p>" + esc(item.examNote || "未填写考核说明") + '</p><div class="ops-actions"><button class="ops-btn" type="button" data-ops="toggle-examiner" data-id="' + esc(item.id) + '" data-enabled="' + (item.enabled ? "0" : "1") + '">' + (item.enabled ? "停用" : "启用") + "</button></div></article>";
      }).join("") + "</div></div>";
    $("examinerForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      toast("loading", "正在保存考官…");
      try {
        await ops.admin("/admin/examiners", { method: "POST", body: formValues(form) });
        toast("success", "考官已保存");
        await reload();
      } catch (error) {
        toast("error", error.message || "保存失败");
      }
    });
  }

  function formValues(form) {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      data[el.name] = el.type === "checkbox" ? el.checked : el.value;
    });
    return data;
  }

  function renderBadges() {
    var root = $("opsBadges");
    if (!root) return;
    root.innerHTML = '<div class="ops-page"><div><h2>技术认证徽章</h2><p class="ops-note">徽章只在管理员确认考核通过后生成。撤销后，个人卡片立刻不再展示。</p></div><div class="ops-grid-3">' + (state.badges.length ? state.badges.map(function (badge) {
      return '<article class="ops-card"><div class="ops-badge">' + esc(badge.game) + " · " + esc(badge.certItem) + "</div><h3>" + esc(companionName(badge.companionId)) + "</h3><p>" + esc(badge.techLevel) + "</p><p>" + (badge.active ? chip("展示中", "ok") : chip("已撤销", "bad")) + "</p>" + (badge.active ? '<button class="ops-btn danger" type="button" data-ops="revoke" data-id="' + esc(badge.applicationId) + '">撤销认证</button>' : "<p class='ops-muted'>撤销时间 " + esc(badge.revokedAt) + "</p>") + "</article>";
    }).join("") : '<div class="ops-empty">还没有徽章。</div>') + "</div></div>";
  }

  function renderSettings() {
    var root = $("opsSettings");
    if (!root) return;
    var settings = state.settings;
    root.innerHTML = '<div class="ops-page"><div><h2>系统设置</h2><p class="ops-note">这里控制陪玩可以自己修改哪些展示开关，以及统一的计费单位。</p></div><form id="settingsForm" class="ops-grid-2"><section class="ops-group"><h3>陪玩可自行修改</h3>' +
      switchRow("allowShowOnCard", "展示在个人卡片", settings.allowShowOnCard) +
      switchRow("allowShowPrice", "展示服务价格", settings.allowShowPrice) +
      switchRow("allowShowIntro", "展示服务介绍", settings.allowShowIntro) +
      switchRow("allowShowBadge", "展示技术认证徽章", settings.allowShowBadge) +
      switchRow("allowAcceptOrders", "开启接单", settings.allowAcceptOrders) +
      '</section><section class="ops-group"><h3>时间与押金</h3>' +
      field("接单超时（分钟）", '<input name="acceptTimeoutMinutes" type="number" min="0" step="1" value="' + esc(settings.acceptTimeoutMinutes) + '">') +
      field("付款超时（分钟）", '<input name="payTimeoutMinutes" type="number" min="0" step="1" value="' + esc(settings.payTimeoutMinutes) + '">') +
      field("押金 MYR", '<input name="depositMyr" type="number" min="0.01" step="0.01" value="' + esc(settings.depositMyr) + '">') +
      field("押金 CNY", '<input name="depositCny" type="number" min="0.01" step="0.01" value="' + esc(settings.depositCny) + '">') +
      '<button class="ops-btn" type="button" data-ops="help-rules">规则说明</button></section><section class="ops-group"><h3>计费单位</h3><div id="unitList">' + settings.units.map(function (unit, index) {
        return '<div class="ops-split"><input data-unit value="' + esc(unit) + '"><button class="ops-btn danger" type="button" data-ops="remove-unit" data-index="' + index + '">删除</button></div>';
      }).join("") + '</div><div class="ops-actions"><input id="newUnit" placeholder="例如：每小时"><button class="ops-btn" type="button" data-ops="add-unit">添加单位</button></div><button class="ops-btn primary" type="submit">保存设置</button></section></form></div>';
    $("settingsForm").addEventListener("submit", saveSettings);
  }

  function switchRow(name, label, checked) {
    return '<label class="ops-switch"><span>' + label + '</span><input name="' + name + '" type="checkbox"' + (checked ? " checked" : "") + "></label>";
  }

  async function saveSettings(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var units = Array.prototype.map.call(document.querySelectorAll("[data-unit]"), function (input) { return input.value.trim(); }).filter(Boolean);
    toast("loading", "正在保存设置…");
    try {
      await ops.admin("/admin/settings", {
        method: "PUT",
        body: {
          allowShowOnCard: form.elements.allowShowOnCard.checked,
          allowShowPrice: form.elements.allowShowPrice.checked,
          allowShowIntro: form.elements.allowShowIntro.checked,
          allowShowBadge: form.elements.allowShowBadge.checked,
          allowAcceptOrders: form.elements.allowAcceptOrders.checked,
          acceptTimeoutMinutes: form.elements.acceptTimeoutMinutes.value,
          payTimeoutMinutes: form.elements.payTimeoutMinutes.value,
          depositMyr: form.elements.depositMyr.value,
          depositCny: form.elements.depositCny.value,
          units: units
        }
      });
      toast("success", "系统设置已保存");
      await reload();
    } catch (error) {
      toast("error", error.message || "保存失败");
    }
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-section]") && window.innerWidth < 960) {
      var side = $("adminSidebar");
      if (side) side.classList.remove("open");
    }
    var menu = event.target.closest("[data-ops-menu]");
    if (menu) {
      var sidebar = $("adminSidebar");
      if (sidebar) sidebar.classList.toggle("open");
      return;
    }
    var action = event.target.closest("[data-ops]");
    if (!action) return;
    var type = action.dataset.ops;
    if (type === "reload") reload().catch(function (error) { toast("error", error.message); });
    if (type === "new-channel") channelForm(null);
    if (type === "edit-channel") channelForm((state.channels || []).find(function (item) { return item.id === action.dataset.id; }));
    if (type === "delete-channel") ops.admin("/admin/channels/" + encodeURIComponent(action.dataset.id), { method: "DELETE" }).then(function () { toast("success", "渠道已删除"); return reload(); }).catch(function (error) { toast("error", error.message); });
    if (type === "new-announcement") announcementForm(null);
    if (type === "edit-announcement") announcementForm((state.announcements || []).find(function (item) { return item.id === action.dataset.id; }));
    if (type === "delete-announcement") ops.admin("/admin/announcements/" + encodeURIComponent(action.dataset.id), { method: "DELETE" }).then(function () { toast("success", "公告已删除"); return reload(); }).catch(function (error) { toast("error", error.message); });
    if (type === "order-review") reviewOrder(action.dataset.id, action.dataset.result);
    if (type === "order-step") ops.admin("/orders/" + encodeURIComponent(action.dataset.id) + "/" + action.dataset.step, { method: "POST", body: {} }).then(function () { toast("success", "订单状态已更新"); return reload(); }).catch(function (error) { toast("error", error.message); });
    if (type === "copy-discord" && navigator.clipboard) navigator.clipboard.writeText(action.dataset.discord || "").then(function () { toast("success", "Discord ID 已复制"); });
    if (type === "discord-arranged") ops.admin("/orders/" + encodeURIComponent(action.dataset.id) + "/discord-status", { method: "POST", body: { status: "arranged" } }).then(function () { toast("success", "已标记语音房"); return reload(); }).catch(function (error) { toast("error", error.message); });
    if (type === "reminder") ops.admin("/admin/reminder", { method: "POST", body: { enabled: action.dataset.enabled !== "0" } }).then(function () { toast("success", action.dataset.enabled === "0" ? "三小时提醒已关闭" : "三小时提醒已开启"); }).catch(function (error) { toast("error", error.message); });
    if (type === "deposit-review") {
      var reason = action.dataset.status === "rejected" ? (window.prompt("拒绝原因") || "") : "";
      if (action.dataset.status === "rejected" && !reason.trim()) return;
      ops.admin("/admin/deposits/" + encodeURIComponent(action.dataset.id) + "/review", { method: "POST", body: { status: action.dataset.status, reason: reason } }).then(function () { toast("success", "押金审核已记录"); return reload(); }).catch(function (error) { toast("error", error.message); });
    }
    if (type === "help-rules") openModal('<div class="ops-page"><h2>规则说明</h2><p>接单超时和付款超时只影响还没完成的预约。已创建订单的价格快照不会被改价影响。押金 MYR 与 CNY 独立配置，不自动换汇。</p><button class="ops-btn" type="button" data-ops="close-modal">关闭</button></div>');
    if (type === "help-flow") openModal('<div class="ops-page"><h2>订单流程</h2><p>预约 → 陪玩接单或拒单 → 老板付款 → 客服核对到账 → 确认 → 开始服务 → 完成。截图不会自动确认到账。</p><button class="ops-btn" type="button" data-ops="close-modal">关闭</button></div>');
    if (type === "help-finance") openModal('<div class="ops-page"><h2>结算说明</h2><p>这里只汇总已完成订单的快照金额。退款、工资和抽成仍按原有财务规则计算，这个面板不改金额。</p><button class="ops-btn" type="button" data-ops="close-modal">关闭</button></div>');
    if (type === "new-service") serviceForm(null);
    if (type === "edit-service") serviceForm(state.services.find(function (item) { return item.id === action.dataset.id; }));
    if (type === "delete-service") deleteService(action.dataset.id);
    if (type === "close-modal") closeModal();
    if (type === "pick-requirement") {
      ui.fieldDraft = readFieldDraftFromDom();
      ui.requirementId = action.dataset.id;
      syncFieldDraft();
      renderRequirements();
    }
    if (type === "add-field") {
      ui.fieldDraft = readFieldDraftFromDom();
      ui.fieldDraft.push({ id: "new_" + Date.now(), label: "", type: "text", optionsText: "", options: [], required: false, showBoss: true, showCompanion: true, showOrderDetail: true });
      renderFieldEditor();
    }
    if (type === "remove-field") {
      ui.fieldDraft = readFieldDraftFromDom();
      ui.fieldDraft.splice(Number(action.dataset.index), 1);
      renderFieldEditor();
    }
    if (type === "move-field") {
      ui.fieldDraft = readFieldDraftFromDom();
      var index = Number(action.dataset.index);
      var next = index + Number(action.dataset.dir);
      if (next >= 0 && next < ui.fieldDraft.length) {
        var copy = ui.fieldDraft[index];
        ui.fieldDraft[index] = ui.fieldDraft[next];
        ui.fieldDraft[next] = copy;
        renderFieldEditor();
      }
    }
    if (type === "save-fields") saveFields();
    if (type === "edit-companion") companionForm(state.companions.find(function (item) { return item.id === action.dataset.id; }));
    if (type === "open-cert") certDetail(action.dataset.id);
    if (type === "review") review(action.dataset.id, action.dataset.action);
    if (type === "revoke") {
      openModal('<div class="ops-page"><h2>撤销认证</h2><label class="ops-field"><span class="ops-label">撤销原因</span><textarea id="reviewReason"></textarea></label><button class="ops-btn danger" type="button" data-ops="review" data-action="revoke_badge" data-id="' + esc(action.dataset.id) + '">确认撤销</button></div>');
    }
    if (type === "toggle-examiner") toggleExaminer(action.dataset.id, action.dataset.enabled === "1");
    if (type === "add-unit") {
      var input = $("newUnit");
      if (!input || !input.value.trim()) return;
      var list = $("unitList");
      list.insertAdjacentHTML("beforeend", '<div class="ops-split"><input data-unit value="' + esc(input.value.trim()) + '"><button class="ops-btn danger" type="button" data-ops="remove-unit">删除</button></div>');
      input.value = "";
    }
    if (type === "remove-unit") action.parentElement.remove();
  });

  async function saveFields() {
    ui.fieldDraft = readFieldDraftFromDom();
    toast("loading", "正在保存字段…");
    try {
      await ops.admin("/admin/services/" + encodeURIComponent(ui.requirementId) + "/fields", { method: "PUT", body: { fields: ui.fieldDraft } });
      toast("success", "订单要求已保存");
      await reload();
    } catch (error) {
      toast("error", error.message || "保存失败");
    }
  }

  async function toggleExaminer(id, enabled) {
    var item = state.examiners.find(function (entry) { return entry.id === id; });
    toast("loading", "正在更新考官状态…");
    try {
      await ops.admin("/admin/examiners/" + encodeURIComponent(id), { method: "PATCH", body: Object.assign({}, item, { enabled: enabled }) });
      toast("success", enabled ? "考官已启用" : "考官已关闭");
      await reload();
    } catch (error) {
      toast("error", error.message || "更新失败");
    }
  }

  function orderStatus(status) {
    var map = {
      pending_accept: ["待接单", "wait"], rejected: ["已拒单", "bad"], accept_timeout: ["接单超时", "bad"],
      pending_payment: ["待付款", "wait"], payment_timeout: ["付款超时", "bad"], pending_review: ["待核实", "info"],
      review_failed: ["审核未通过", "bad"], payment_exception: ["异常付款", "wait"], confirmed: ["已确认", "ok"],
      in_service: ["服务中", "ok"], completed: ["已完成", "ok"], cancelled: ["已取消", "bad"], pending_payment_legacy: ["待付款", "wait"]
    };
    return map[status] || [status, "info"];
  }

  function fill(ids, html) {
    ids.forEach(function (id) {
      var node = $(id);
      if (node) node.innerHTML = html;
    });
  }

  function renderOrdersBoard() {
    var rows = (state.orders || []).map(function (order) {
      var meta = orderStatus(order.status);
      var actions = "";
      if (order.status === "pending_review" || order.status === "payment_exception") {
        actions = "<button class='ops-btn primary' type='button' data-ops='order-review' data-id='" + esc(order.id) + "' data-result='confirmed'>确认到账</button> <button class='ops-btn danger' type='button' data-ops='order-review' data-id='" + esc(order.id) + "' data-result='review_failed'>审核失败</button> <button class='ops-btn' type='button' data-ops='order-review' data-id='" + esc(order.id) + "' data-result='payment_exception'>异常核对</button>";
      }
      if (order.status === "confirmed") actions = "<button class='ops-btn primary' type='button' data-ops='order-step' data-id='" + esc(order.id) + "' data-step='start'>开始服务</button>";
      if (order.status === "in_service") actions = "<button class='ops-btn primary' type='button' data-ops='order-step' data-id='" + esc(order.id) + "' data-step='complete'>完成结算</button>";
      var voice = (order.serviceSnapshot || {}).voiceMode === "discord" && ["confirmed", "in_service", "completed"].indexOf(order.status) >= 0;
      var discordLabel = "";
      if (voice) discordLabel = order.discordId ? (order.discordStatus === "arranged" ? "已安排语音房" : "等待客服邀请") : "待填写 Discord ID";
      if (order.discordId) actions += " <button class='ops-btn' type='button' data-ops='copy-discord' data-discord='" + esc(order.discordId) + "'>复制 Discord ID</button>";
      if (order.discordId && order.discordStatus !== "arranged") actions += " <button class='ops-btn primary' type='button' data-ops='discord-arranged' data-id='" + esc(order.id) + "'>标记已安排</button>";
      return "<tr><td data-label='订单'>" + esc(order.id) + "<br>" + esc(order.bossName) + (order.discordId ? "<br>Discord " + esc(order.discordId) : "") + "</td><td data-label='服务'>" + esc((order.serviceSnapshot || {}).name || "") + "</td><td data-label='金额'>" + esc(ops.formatMoney(order.totalPrice)) + "</td><td data-label='状态'>" + chip(meta[0], meta[1]) + (discordLabel ? "<br>" + esc(discordLabel) : "") + "</td><td data-label='操作'>" + actions + "</td></tr>";
    }).join("");
    fill(["opsOrders"], '<div class="ops-page"><div class="ops-toolbar"><div><h2>预约订单</h2></div><button class="ops-btn" type="button" data-ops="help-flow">流程说明</button></div>' + (rows ? '<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>订单</th><th>服务</th><th>金额</th><th>状态</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : '<div class="ops-empty">还没有预约。</div>') + "</div>");
  }

  function channelForm(item) {
    openModal('<form id="channelForm" class="ops-form"><div class="wide"><h2>' + (item ? "编辑渠道" : "新增渠道") + "</h2></div>" +
      field("名称", '<input name="name" required value="' + esc(item ? item.name : "") + '">') +
      field("币种", '<select name="currency"><option value="MYR">MYR</option><option value="CNY">CNY</option></select>') +
      field("收款人", '<input name="payee" value="' + esc(item ? item.payee : "") + '">') +
      field("银行", '<input name="bank" value="' + esc(item ? item.bank : "") + '">') +
      field("账号", '<input name="account" value="' + esc(item ? item.account : "") + '">', true) +
      field("二维码地址", '<input name="qrUrl" value="' + esc(item ? item.qrUrl : "") + '">', true) +
      field("付款说明", '<textarea name="instructions">' + esc(item ? item.instructions : "") + "</textarea>", true) +
      '<label class="ops-switch wide"><span>启用</span><input name="enabled" type="checkbox"' + (!item || item.enabled ? " checked" : "") + "></label>" +
      '<div class="wide"><button class="ops-btn primary" type="submit">保存渠道</button></div></form>', true);
    var form = $("channelForm");
    if (item) form.elements.currency.value = item.currency;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      toast("loading", "正在保存渠道…");
      try {
        await ops.admin(item ? "/admin/channels/" + encodeURIComponent(item.id) : "/admin/channels", {
          method: item ? "PATCH" : "POST",
          body: { name: form.elements.name.value, currency: form.elements.currency.value, payee: form.elements.payee.value, bank: form.elements.bank.value, account: form.elements.account.value, qrUrl: form.elements.qrUrl.value, instructions: form.elements.instructions.value, enabled: form.elements.enabled.checked }
        });
        closeModal();
        toast("success", "渠道已保存");
        await reload();
      } catch (error) { toast("error", error.message || "保存失败"); }
    });
  }

  function renderChannels() {
    var cards = (state.channels || []).map(function (item) {
      return '<article class="ops-card"><div class="ops-split"><h3>' + esc(item.name) + "</h3>" + (item.enabled ? chip(item.currency, "ok") : chip("已关闭", "bad")) + "</div><p>" + esc(item.payee || "未填收款人") + " · " + esc(item.bank || "未填银行") + "</p><p>" + esc(item.account || "未填账号") + "</p>" + (item.qrUrl ? '<img alt="收款码" src="' + esc(item.qrUrl) + '" style="width:96px;height:96px;object-fit:cover;border-radius:12px">' : "") + '<div class="ops-actions"><button class="ops-btn" type="button" data-ops="edit-channel" data-id="' + esc(item.id) + '">编辑</button><button class="ops-btn danger" type="button" data-ops="delete-channel" data-id="' + esc(item.id) + '">删除</button></div></article>';
    }).join("");
    var html = '<div class="ops-page"><div class="ops-toolbar"><div><h2>支付渠道</h2></div><button class="ops-btn primary" type="button" data-ops="new-channel">新增渠道</button></div><p class="ops-note">充值和订单付款只显示这里启用的渠道。猫粮余额单独保留。</p><div class="ops-grid-2">' + (cards || '<div class="ops-empty">还没有外部渠道。老板端不会显示 DuitNow 或支付宝。</div>') + "</div></div>";
    fill(["opsPayments", "paymentSettings"], html);
  }

  function announcementForm(item) {
    openModal('<form id="announcementForm" class="ops-form"><div class="wide"><h2>' + (item ? "编辑公告" : "新增公告") + "</h2></div>" +
      field("标题", '<input name="title" required value="' + esc(item ? item.title : "") + '">', true) +
      field("内容", '<textarea name="body">' + esc(item ? item.body : "") + "</textarea>", true) +
      field("分类", '<select name="audience"><option value="home">首页</option><option value="companion">陪玩端</option><option value="service">客服端</option><option value="all">全部</option></select>') +
      field("排序", '<input name="sort" type="number" value="' + esc(item ? item.sort : 0) + '">') +
      '<label class="ops-switch"><span>置顶</span><input name="pinned" type="checkbox"' + (item && item.pinned ? " checked" : "") + "></label>" +
      '<label class="ops-switch"><span>滚动</span><input name="scrolling" type="checkbox"' + (item && item.scrolling ? " checked" : "") + "></label>" +
      '<label class="ops-switch"><span>强制弹出</span><input name="forcePopup" type="checkbox"' + (item && item.forcePopup ? " checked" : "") + "></label>" +
      '<label class="ops-switch"><span>启用</span><input name="enabled" type="checkbox"' + (!item || item.enabled ? " checked" : "") + "></label>" +
      '<div class="wide"><button class="ops-btn primary" type="submit">发布</button></div></form>', true);
    var form = $("announcementForm");
    if (item) form.elements.audience.value = item.audience;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      toast("loading", "正在发布公告…");
      try {
        await ops.admin(item ? "/admin/announcements/" + encodeURIComponent(item.id) : "/admin/announcements", {
          method: item ? "PATCH" : "POST",
          body: { title: form.elements.title.value, body: form.elements.body.value, audience: form.elements.audience.value, sort: form.elements.sort.value, pinned: form.elements.pinned.checked, scrolling: form.elements.scrolling.checked, forcePopup: form.elements.forcePopup.checked, enabled: form.elements.enabled.checked }
        });
        closeModal();
        toast("success", "公告已更新");
        await reload();
      } catch (error) { toast("error", error.message || "保存失败"); }
    });
  }

  function renderAnnouncements() {
    var rows = (state.announcements || []).map(function (item) {
      return "<tr><td data-label='标题'><b>" + esc(item.title) + "</b><br><span class='ops-muted'>" + esc(item.audience) + "</span></td><td data-label='状态'>" + (item.enabled ? chip(item.pinned ? "置顶" : "启用", "ok") : chip("关闭", "bad")) + (item.forcePopup ? " " + chip("强制", "info") : "") + "</td><td data-label='操作'><button class='ops-btn' type='button' data-ops='edit-announcement' data-id='" + esc(item.id) + "'>编辑</button> <button class='ops-btn danger' type='button' data-ops='delete-announcement' data-id='" + esc(item.id) + "'>删除</button></td></tr>";
    }).join("");
    fill(["opsAnnouncements", "table-announcements"], '<div class="ops-page"><div class="ops-toolbar"><div><h2>公告</h2></div><button class="ops-btn primary" type="button" data-ops="new-announcement">新增公告</button></div>' + (rows ? '<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>标题</th><th>状态</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : '<div class="ops-empty">还没有公告。</div>') + "</div>");
  }

  function renderDeposits() {
    var rows = (state.deposits || []).map(function (item) {
      var actions = item.status === "pending" ? "<button class='ops-btn primary' type='button' data-ops='deposit-review' data-id='" + esc(item.id) + "' data-status='approved'>通过</button> <button class='ops-btn danger' type='button' data-ops='deposit-review' data-id='" + esc(item.id) + "' data-status='rejected'>拒绝</button>" : esc(item.reviewNote || "");
      return "<tr><td>" + esc(item.applicantName || item.companionId) + "</td><td>" + esc(item.currency) + " " + esc(item.amount) + "</td><td>" + esc(item.status) + "</td><td>" + actions + "</td></tr>";
    }).join("");
    fill(["opsDeposits", "table-companion_deposit"], '<div class="ops-page"><h2>押金审核</h2><p class="ops-note">MYR ' + esc(state.settings.depositMyr) + " · CNY " + esc(state.settings.depositCny) + "，两个金额独立，不换算。</p>" + (rows ? '<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>申请人</th><th>金额</th><th>状态</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : '<div class="ops-empty">还没有押金提交。</div>') + "</div>");
  }

  function renderSettlement() {
    var done = (state.orders || []).filter(function (order) { return order.status === "completed"; });
    var total = done.reduce(function (sum, order) { return sum + Number(order.totalPrice || 0); }, 0);
    var html = '<div class="ops-page"><div class="ops-toolbar"><div><h2>周五结算</h2></div><button class="ops-btn" type="button" data-ops="help-finance">说明</button></div><section class="ops-metrics"><article class="ops-metric"><span>已完成订单</span><strong>' + done.length + '</strong></article><article class="ops-metric"><span>快照总额</span><strong>' + esc(ops.formatMoney(total) || "RM0.00") + "</strong></article></section></div>";
    fill(["opsSettlement"], html);
  }

  async function reviewOrder(id, result) {
    var reason = result === "confirmed" ? "" : window.prompt("请填写原因") || "";
    if (result !== "confirmed" && !reason.trim()) return;
    toast("loading", "正在提交审核…");
    try {
      await ops.admin("/orders/" + encodeURIComponent(id) + "/review", { method: "POST", body: { result: result, reason: reason } });
      toast("success", "审核已记录");
      await reload();
    } catch (error) { toast("error", error.message || "审核失败"); }
  }

  document.addEventListener("DOMContentLoaded", function () {
    ["opsDashboard", "opsServices", "opsPrices", "opsRequirements", "opsCompanions", "opsCerts", "opsExaminers", "opsBadges", "opsSettings", "opsOrders", "opsPayments", "opsAnnouncements", "opsDeposits", "opsSettlement"].forEach(function (id) {
      var node = $(id);
      if (node) node.innerHTML = '<div class="ops-empty">正在加载数据库…</div>';
    });
    reload().catch(function (error) {
      toast("error", error.message || "加载失败");
      var root = $("opsDashboard");
      if (root) root.innerHTML = '<div class="ops-card"><h2>数据加载失败</h2><p>' + esc(error.message || "请确认本地接口已启动") + '</p><button class="ops-btn primary" type="button" data-ops="reload">重试</button></div>';
    });
  });
})();
