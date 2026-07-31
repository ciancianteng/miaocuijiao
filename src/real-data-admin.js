(function () {
  var REAL_KEY = "mcjRealDB.v1";
  var PLATFORM_KEY = "mcjPlatformData.v1";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uid(prefix) { return prefix + "-" + Date.now().toString(36).toUpperCase() + Math.random().toString(16).slice(2, 6).toUpperCase(); }
  function money(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatPlain(v);
    return Number(v || 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function now() { return new Date().toLocaleString("zh-CN"); }
  function db() { return window.MCJRealData && window.MCJRealData.readDB ? window.MCJRealData.readDB() : readRaw(REAL_KEY); }
  function readRaw(key) { try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) { return {}; } }
  function writeRaw(key, value) { localStorage.setItem(key, JSON.stringify(value || {})); }
  function ensureArrays(data) {
    ["ads", "companions", "serviceRanges", "orders", "dispatches", "profileAudits", "priceServices", "serviceDemands", "chatThreads", "dispatchOrders", "dispatchCandidates", "fixedGameplays", "gameplayOrders", "gameplayQualifications", "orderChats", "logs"].forEach(function (key) {
      data[key] = Array.isArray(data[key]) ? data[key] : [];
    });
    data.siteSettings = data.siteSettings || {};
    return data;
  }
  function save(next) {
    next = ensureArrays(next || {});
    if (window.MCJRealData && window.MCJRealData.writeDB) window.MCJRealData.writeDB(next);
    else writeRaw(REAL_KEY, next);
    syncPlatform(next);
    renderTables();
    if (window.MCJNotify) window.MCJNotify.push("system", "后台数据已保存", "前台页面会读取同一份真实数据", "本地真实数据模式");
  }
  function platform() { return ensureArrays(readRaw(PLATFORM_KEY)); }
  function syncPlatform(real) {
    var p = platform();
    ["priceServices", "serviceDemands", "chatThreads", "dispatchOrders", "dispatchCandidates", "fixedGameplays", "gameplayOrders", "gameplayQualifications", "orderChats"].forEach(function (key) { p[key] = real[key] || p[key] || []; });
    writeRaw(PLATFORM_KEY, p);
    window.dispatchEvent(new CustomEvent("mcj:platform-data-updated"));
    window.dispatchEvent(new CustomEvent("mcj:data-updated"));
  }
  function saveBoth(mutator) {
    var real = ensureArrays(db());
    var result = mutator(real);
    save(real);
    return result;
  }
  function fileToDataUrl(input) {
    return new Promise(function (resolve) {
      var f = input.files && input.files[0];
      if (!f) return resolve("");
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.readAsDataURL(f);
    });
  }

  function insertPanel() {
    if (!document.body.classList.contains("admin-page") || document.getElementById("mcjRealAdmin")) return;
    var main = document.querySelector(".admin-main") || document.body;
    main.insertAdjacentHTML("afterbegin", '<section class="mcj-real-admin" id="mcjRealAdmin"><div class="mcj-real-admin-head"><div><h2>真实数据中心</h2><p>后台是唯一数据来源。前台只显示这里创建、上架、审核通过的数据。</p></div><button class="mcj-real-btn" data-clear-db type="button">清空本地真实数据</button></div><div class="mcj-real-tabs"><button class="active" data-real-tab="ads">广告位</button><button data-real-tab="companions">陪玩卡面</button><button data-real-tab="ranges">价格范围</button><button data-real-tab="orders">订单 / 派单</button><button data-real-tab="priceServices">俱乐部价格表</button></div><div class="mcj-real-pane active" data-real-pane="ads"><form class="mcj-real-form" id="realAdForm"><label>广告标题<input name="title" required></label><label>副标题<input name="description"></label><label>按钮文字<input name="button" value="立即查看"></label><label>跳转链接<input name="link" placeholder="activities.html / https://"></label><label>排序<input name="sort" type="number" value="1"></label><label>是否显示<select name="enabled"><option value="true">显示</option><option value="false">隐藏</option></select></label><label>开始时间<input name="startAt" type="datetime-local"></label><label>结束时间<input name="endAt" type="datetime-local"></label><label>广告图<input name="imageFile" type="file" accept="image/*"></label><label class="full">右下角小卡片文案<textarea name="cardText"></textarea></label></form><div class="mcj-real-actions"><button class="mcj-real-btn primary" data-save-ad type="button">保存广告位</button></div><table class="mcj-real-table"><thead><tr><th>图</th><th>标题</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody id="realAdRows"></tbody></table></div><div class="mcj-real-pane" data-real-pane="companions"><form class="mcj-real-form" id="realCompanionForm"><label>昵称<input name="name" required></label><label>主接游戏<input name="game"></label><label>等级<select name="level" id="realCompanionLevel"></select></label><label>评分<input name="rating" value=""></label><label>服务单价<input name="price" type="number" min="0" step="1" placeholder="例如 25"></label><label>排序<input name="sort" type="number" value="1"></label><label>审核状态<select name="auditStatus"><option value="pending">审核中</option><option value="approved">审核通过</option><option value="rejected">已拒绝</option></select></label><label>是否上架<select name="visible"><option value="true">上架</option><option value="false">下架</option></select></label><label>按钮样式<select name="buttonStyle"><option value="pink">黑粉霓虹</option><option value="blue">蓝色霓虹</option><option value="gold">金色霓虹</option></select></label><label>头像<input name="avatarFile" type="file" accept="image/*"></label><label>卡面封面<input name="coverFile" type="file" accept="image/*"></label><label class="full">服务标签<input name="tags" placeholder="技术流,甜妹,温柔"></label><label class="full">语音介绍 / 个人介绍<textarea name="bio"></textarea></label></form><div class="mcj-real-actions"><button class="mcj-real-btn primary" data-save-companion type="button">保存陪玩资料</button></div><table class="mcj-real-table"><thead><tr><th>封面</th><th>昵称</th><th>等级</th><th>游戏</th><th>价格</th><th>审核</th><th>操作</th></tr></thead><tbody id="realCompanionRows"></tbody></table></div><div class="mcj-real-pane" data-real-pane="ranges"><form class="mcj-real-form" id="realRangeForm"><label>服务名称<input name="service" placeholder="上分陪玩"></label><label>最低价<input name="min" type="number" value="20"></label><label>最高价<input name="max" type="number" value="30"></label><label>默认价<input name="defaultPrice" type="number" value="20"></label></form><div class="mcj-real-actions"><button class="mcj-real-btn primary" data-save-range type="button">保存价格范围</button></div><table class="mcj-real-table"><thead><tr><th>服务</th><th>最低</th><th>最高</th><th>默认</th><th>操作</th></tr></thead><tbody id="realRangeRows"></tbody></table></div><div class="mcj-real-pane" data-real-pane="orders"><table class="mcj-real-table"><thead><tr><th>编号</th><th>类型</th><th>内容</th><th>状态</th></tr></thead><tbody id="realOrderRows"></tbody></table></div><div class="mcj-real-pane" data-real-pane="priceServices"><table class="mcj-real-table"><thead><tr><th>分类</th><th>服务</th><th>价格</th><th>游戏</th><th>状态</th></tr></thead><tbody id="realPriceRows"></tbody></table></div></section>');
    hydrateLevelSelect();
  }

  function hydrateLevelSelect() {
    var select = document.getElementById("realCompanionLevel");
    if (select && window.MCJCompanionLevels) {
      select.innerHTML = window.MCJCompanionLevels.read().filter(function (level) {
        return level.enabled;
      }).map(function (level) {
        return '<option value="' + esc(level.id) + '">' + esc(window.MCJCompanionLevels.label(level.id)) + "</option>";
      }).join("");
    }
  }

  async function saveAd() {
    var f = document.getElementById("realAdForm");
    var data = Object.fromEntries(new FormData(f).entries());
    var image = await fileToDataUrl(f.imageFile);
    var next = db();
    next.ads.unshift({ id: "ad_" + Date.now(), title: data.title, description: data.description || data.cardText, button: data.button, link: data.link, sort: Number(data.sort) || 1, enabled: data.enabled === "true", startAt: data.startAt, endAt: data.endAt, image: image, tag: "OFFICIAL" });
    save(next); f.reset();
  }
  async function saveCompanion() {
    var f = document.getElementById("realCompanionForm");
    var data = Object.fromEntries(new FormData(f).entries());
    var avatar = await fileToDataUrl(f.avatarFile);
    var cover = await fileToDataUrl(f.coverFile);
    var next = db();
    var companionLevelApi = window.MCJCompanionLevels;
    var levelCheck = companionLevelApi ? companionLevelApi.validatePrice(data.level, data.price) : null;
    if (levelCheck && !levelCheck.valid) { alert(levelCheck.message); return; }
    var priceCheck = window.MCJRealData && window.MCJRealData.validatePrice ? window.MCJRealData.validatePrice(data.game, parseFloat(String(data.price).replace(/[^0-9.]/g, ""))) : null;
    if (priceCheck && !priceCheck.ok) { alert(priceCheck.message); return; }
    next.companions.unshift({ id: "player_" + Date.now(), name: data.name, game: data.game, levelId: data.level, level: companionLevelApi ? companionLevelApi.label(data.level) : data.level, rating: data.rating, price: companionLevelApi ? companionLevelApi.formatHourlyPrice(data.price) : data.price, hourlyPrice: Number(data.price) || 0, sort: Number(data.sort) || 1, auditStatus: data.auditStatus, visible: data.visible === "true", buttonStyle: data.buttonStyle, avatar: avatar, cover: cover, tags: data.tags, bio: data.bio });
    save(next); f.reset();
  }
  function saveRange() {
    var f = document.getElementById("realRangeForm");
    var data = Object.fromEntries(new FormData(f).entries());
    var next = db();
    next.serviceRanges.unshift({ id: "range_" + Date.now(), service: data.service, min: Number(data.min) || 0, max: Number(data.max) || 0, defaultPrice: Number(data.defaultPrice) || 0 });
    save(next); f.reset();
  }

  function renderTables() {
    var d = ensureArrays(db());
    var adRows = document.getElementById("realAdRows");
    if (adRows) adRows.innerHTML = (d.ads || []).map(function (a) { return '<tr><td>' + (a.image ? '<img src="' + a.image + '">' : "-") + '</td><td>' + esc(a.title) + '</td><td>' + esc(a.sort) + '</td><td>' + (a.enabled ? "显示" : "隐藏") + '</td><td><button class="mcj-real-btn" data-del="ads" data-id="' + esc(a.id) + '">删除</button></td></tr>'; }).join("") || '<tr><td colspan="5">暂无广告，请创建。</td></tr>';
    var cr = document.getElementById("realCompanionRows");
    if (cr) cr.innerHTML = (d.companions || []).map(function (p) { var normalized = window.MCJCompanionLevels ? window.MCJCompanionLevels.normalizeCompanion(p) : p; return '<tr><td>' + (p.cover ? '<img src="' + p.cover + '">' : "-") + '</td><td>' + esc(p.name) + '</td><td>' + esc(normalized.levelLabel || p.level) + '</td><td>' + esc(p.game) + '</td><td>' + esc(normalized.priceDisplay || p.price) + '</td><td>' + esc(p.auditStatus) + '</td><td><button class="mcj-real-btn" data-del="companions" data-id="' + esc(p.id) + '">删除</button></td></tr>'; }).join("") || '<tr><td colspan="7">暂无陪玩资料，请创建并审核通过。</td></tr>';
    var rr = document.getElementById("realRangeRows");
    if (rr) rr.innerHTML = (d.serviceRanges || []).map(function (r) { return '<tr><td>' + esc(r.service) + '</td><td>' + r.min + '</td><td>' + r.max + '</td><td>' + r.defaultPrice + '</td><td><button class="mcj-real-btn" data-del="serviceRanges" data-id="' + esc(r.id) + '">删除</button></td></tr>'; }).join("") || '<tr><td colspan="5">暂无价格范围。</td></tr>';
    var or = document.getElementById("realOrderRows");
    if (or) or.innerHTML = [].concat(d.orders || [], d.dispatches || [], d.serviceDemands || [], d.dispatchOrders || []).map(function (o) { return '<tr><td>' + esc(o.id || o.orderId || o.demandId) + '</td><td>' + esc(o.type || o.source || o.category || "订单") + '</td><td>' + esc(o.service || o.game || o.note || o.serviceType) + '</td><td>' + esc(o.status) + '</td></tr>'; }).join("") || '<tr><td colspan="4">暂无真实订单/派单。</td></tr>';
    var pr = document.getElementById("realPriceRows");
    if (pr) pr.innerHTML = (d.priceServices || []).map(function (s) { return '<tr><td>' + esc(s.category) + '</td><td>' + esc(s.name) + '</td><td>' + money(s.priceMin) + ' - ' + money(s.priceMax) + ' ' + esc(s.unit) + '</td><td>' + esc((s.games || []).join("，")) + '</td><td>' + (s.enabled ? "启用" : "停用") + '</td></tr>'; }).join("") || '<tr><td colspan="5">暂无价格表服务。请到 /admin/index.html#priceTable 创建。</td></tr>';
  }

  function priceServices() {
    var p = platform();
    var real = db();
    return (p.priceServices && p.priceServices.length ? p.priceServices : real.priceServices || []).filter(function (s) { return s.enabled; }).sort(function (a, b) { return Number(a.sort || 0) - Number(b.sort || 0); });
  }
  function modalShell(inner) {
    var old = document.getElementById("clubPriceModal");
    if (old) old.remove();
    document.body.insertAdjacentHTML("beforeend", '<div class="club-price-modal" id="clubPriceModal"><div class="club-price-card"><button class="club-price-close" data-close-price-modal type="button">×</button>' + inner + '</div></div>');
  }
  function serviceCard(s) {
    return '<article class="club-price-service"><div><span class="club-price-tag">' + esc(s.category) + '</span><h3>' + esc(s.name) + '</h3><p>' + esc(s.description || "后台暂未填写服务说明") + '</p></div><div class="club-price-meta"><b>' + money(s.priceMin) + " - " + money(s.priceMax) + " " + esc(s.unit || "") + '</b><span>' + esc((s.games || []).join(" / ") || "游戏由客服确认") + '</span></div><div class="club-price-actions"><button type="button" data-price-detail="' + esc(s.id) + '">查看详情</button><button type="button" data-price-submit="' + esc(s.id) + '">提交需求</button></div></article>';
  }
  function openPriceTable() {
    var rows = priceServices();
    modalShell('<div class="club-price-head"><div><h2>俱乐部价格表</h2><p>查看游戏、陪聊、护航、代打、代肝服务价格。价格由后台启用的服务配置实时读取。</p></div></div>' + (rows.length ? '<div class="club-price-grid">' + rows.map(serviceCard).join("") + '</div>' : '<div class="club-price-empty">后台暂未启用价格表服务，请管理员先到「俱乐部价格表管理」创建服务。</div>'));
  }
  function serviceById(id) { return priceServices().find(function (s) { return s.id === id; }); }
  function openPriceDetail(id) {
    var s = serviceById(id); if (!s) return;
    modalShell('<div class="club-price-head"><div><span class="club-price-tag">' + esc(s.category) + '</span><h2>' + esc(s.name) + '</h2><p>' + esc(s.description || "") + '</p></div></div><div class="club-price-detail"><div><span>参考价格</span><strong>' + money(s.priceMin) + ' - ' + money(s.priceMax) + ' ' + esc(s.unit || "") + '</strong></div><div><span>计价方式</span><strong>' + esc(s.billingType || "") + '</strong></div><div><span>可选游戏</span><strong>' + esc((s.games || []).join("，") || "客服确认") + '</strong></div><div><span>需求字段</span><strong>' + esc((s.demandFields || []).join("，") || "通用需求") + '</strong></div></div><div class="club-price-actions single"><button type="button" data-price-submit="' + esc(s.id) + '">提交需求</button><button type="button" data-back-price-table>返回价格表</button></div>');
  }
  function openDemandForm(id) {
    var s = serviceById(id); if (!s) return;
    var gameOptions = (s.games || []).map(function (g) { return '<option>' + esc(g) + '</option>'; }).join("") || '<option>客服确认</option>';
    var extra = "";
    if (/代打/.test(s.category)) extra = '<label>当前段位<input name="currentRank"></label><label>目标段位<input name="targetRank"></label><label>预计完成时间<input name="deadline" type="datetime-local"></label><label>是否允许多位陪玩协作<select name="multiCompanion"><option>允许</option><option>不允许</option></select></label>';
    if (/代肝/.test(s.category)) extra = '<label>需要完成的任务<input name="task"></label><label>当前进度<input name="currentProgress"></label><label>目标进度<input name="targetProgress"></label><label>截止时间<input name="deadline" type="datetime-local"></label><label>账号登录方式<input name="loginMethod"></label>';
    modalShell('<div class="club-price-head"><div><h2>提交需求</h2><p>' + esc(s.name) + ' · 提交后会自动进入喵管家客服会话。</p></div></div><form class="club-demand-form" data-demand-form="' + esc(s.id) + '"><label>服务类型<input name="serviceType" value="' + esc(s.category) + '" readonly></label><label>游戏名称<select name="game">' + gameOptions + '</select></label><label>预算范围<select name="budgetMode"><option>参考区间 ' + money(s.priceMin) + ' - ' + money(s.priceMax) + '</option><option>自定义预算</option><option>接受客服报价</option></select></label><label>自定义预算<input name="budgetCustom" placeholder="例如 RM50-RM120"></label><label>希望陪玩性别<select name="gender"><option>不限</option><option>女</option><option>男</option></select></label><label>希望陪玩等级<input name="level" value="' + esc(s.levelRequirement || "不限") + '"></label><label>服务时间<input name="startTime" type="datetime-local"></label><label>服务时长<input name="duration" placeholder="例如 2小时 / 5局 / 3天"></label><label>区服<input name="server"></label><label>游戏段位<input name="rank"></label><label>是否需要立即开始<select name="immediate"><option>否</option><option>是</option></select></label><label>是否接受客服推荐相近价位<select name="acceptNearby"><option>接受</option><option>不接受</option></select></label>' + extra + '<label class="wide">特殊要求<textarea name="requirements" placeholder="声音要求、性格要求、技术要求、是否话多、是否主动带气氛、是否接受新陪玩、其他备注"></textarea></label><button class="club-demand-submit" type="submit">确认需求，联系客服派单</button></form>');
  }
  function submitDemand(form) {
    var service = serviceById(form.dataset.demandForm); if (!service) return;
    var fd = Object.fromEntries(new FormData(form).entries());
    var ids = {};
    ids.demandId = uid("REQ");
    ids.threadId = uid("CHAT");
    ids.dispatchId = uid("DSP");
    var demand = Object.assign({}, fd, {
      id: ids.demandId,
      demandId: ids.demandId,
      threadId: ids.threadId,
      dispatchId: ids.dispatchId,
      serviceId: service.id,
      serviceName: service.name,
      category: service.category,
      status: "待客服接待",
      createdAt: now(),
      priceSnapshot: { priceMin: service.priceMin, priceMax: service.priceMax, unit: service.unit, billingType: service.billingType }
    });
    var welcome = service.welcomeText || "您好，我是本次为您服务的喵管家客服。已经收到您的需求，我会根据您的预算和要求为您匹配合适的陪玩，请稍等一下。";
    saveBoth(function (real) {
      real.serviceDemands.unshift(demand);
      real.chatThreads.unshift({ id: ids.threadId, demandId: ids.demandId, bossId: "customer_local", supportId: "", status: "待客服接待", createdAt: now(), messages: [
        { id: uid("MSG"), type: "demand-card", from: "system", text: "需求卡片", demand: demand, createdAt: now() },
        { id: uid("MSG"), type: "text", from: "support", text: welcome, createdAt: now() }
      ] });
      real.dispatchOrders.unshift({ id: ids.dispatchId, demandId: ids.demandId, threadId: ids.threadId, serviceId: service.id, serviceType: service.category, serviceName: service.name, game: fd.game, budget: fd.budgetCustom || fd.budgetMode, expectedIncome: 0, commissionRate: 0, duration: fd.duration, gender: fd.gender, level: fd.level, startTime: fd.startTime, requirements: fd.requirements, status: "待客服接待", candidateLimit: 5, candidates: [], createdAt: now() });
      real.logs.unshift({ id: uid("LOG"), action: "老板提交俱乐部价格表需求", target: ids.demandId, createdAt: now() });
      return demand;
    });
    openBossChat(ids.threadId);
  }
  function openBossChat(threadId) {
    var real = ensureArrays(db());
    var t = (real.chatThreads || []).find(function (x) { return x.id === threadId; });
    if (!t) return openPriceTable();
    var demand = (real.serviceDemands || []).find(function (x) { return x.id === t.demandId; }) || {};
    var candidates = (real.dispatchCandidates || []).filter(function (x) { return x.demandId === t.demandId; });
    var msgs = (t.messages || []).map(function (m) {
      if (m.type === "demand-card") return '<div class="club-chat-line system"><b>需求卡片 ' + esc(demand.id) + '</b><p>' + esc(demand.category) + ' / ' + esc(demand.game) + ' / ' + esc(demand.budgetCustom || demand.budgetMode) + '</p><small>' + esc(demand.status) + ' · ' + esc(demand.createdAt) + '</small></div>';
      if (m.type === "candidate-card") return '<div class="club-chat-line system"><b>候选陪玩</b><p>' + esc(m.playerName || "") + ' 已进入候选名单。</p></div>';
      return '<div class="club-chat-line ' + (m.from === "boss" ? "me" : "") + '"><p>' + esc(m.text) + '</p><small>' + esc(m.createdAt) + '</small></div>';
    }).join("");
    var candidateHtml = candidates.length ? '<h3>候选陪玩</h3><div class="club-candidate-list">' + candidates.map(function (c) { return '<div class="club-candidate"><strong>' + esc(c.playerName) + '</strong><span>' + esc(c.status) + '</span><button type="button" data-select-candidate="' + esc(c.id) + '">我要他</button></div>'; }).join("") + '</div>' : "";
    modalShell('<div class="club-price-head"><div><h2>喵管家客服会话</h2><p>需求编号：' + esc(demand.id) + ' · 当前状态：' + esc(demand.status) + '</p></div></div><div class="club-chat-box">' + msgs + '</div>' + candidateHtml + '<form class="club-chat-form" data-chat-form="' + esc(t.id) + '"><input name="text" placeholder="输入要补充给客服的信息"><button type="submit">发送</button></form>');
  }
  function chooseCandidate(id) {
    if (!confirm("确认选择这位陪玩完成本次订单吗？")) return;
    saveBoth(function (real) {
      var c = (real.dispatchCandidates || []).find(function (x) { return x.id === id; });
      if (!c || c.status === "已选中") return;
      (real.dispatchCandidates || []).filter(function (x) { return x.demandId === c.demandId; }).forEach(function (x) { x.status = x.id === c.id ? "已选中" : "未选中"; });
      var demand = (real.serviceDemands || []).find(function (x) { return x.id === c.demandId; });
      var order = (real.dispatchOrders || []).find(function (x) { return x.demandId === c.demandId; });
      if (demand) demand.status = "待陪玩确认";
      if (order) { order.status = "待陪玩确认"; order.selectedPlayerId = c.playerId; order.selectedPlayerName = c.playerName; order.bossSelectedAt = now(); }
      var thread = (real.chatThreads || []).find(function (x) { return x.demandId === c.demandId; });
      if (thread) thread.messages.push({ id: uid("MSG"), type: "formal-order", from: "system", text: "老板已选择陪玩 " + c.playerName + "，订单进入待陪玩确认。", createdAt: now() });
    });
    var real = db();
    var c2 = (real.dispatchCandidates || []).find(function (x) { return x.id === id; });
    openBossChat(c2 ? c2.threadId : "");
  }

  function gameplays() {
    var p = platform();
    var real = db();
    return (p.fixedGameplays && p.fixedGameplays.length ? p.fixedGameplays : real.fixedGameplays || []).filter(function (x) { return x.enabled; }).sort(function (a, b) { return Number(a.sort || 0) - Number(b.sort || 0); });
  }
  function gameplayById(id) { return gameplays().find(function (x) { return x.id === id; }); }
  function gameplayCard(g) {
    return '<article class="club-price-service gameplay-card"><div>' + (g.cover ? '<img class="gameplay-cover" src="' + esc(g.cover) + '" alt="">' : '') + '<span class="club-price-tag">' + esc(g.category || "更多玩法") + '</span><h3>' + esc(g.name) + '</h3><p>' + esc(g.intro || "后台暂未填写玩法简介") + '</p></div><div class="club-price-meta"><b>' + money(g.fixedPrice) + ' ' + esc(g.unit || "/ 单") + '</b><span>' + esc(g.game || "游戏由后台设置") + ' · ' + esc(g.serviceDuration || "时长待确认") + '</span><span>陪玩到账 ' + money(g.playerIncome) + ' / 抽成 ' + esc(g.commissionRate || 0) + '%</span></div><div class="club-price-actions"><button type="button" data-gameplay-detail="' + esc(g.id) + '">查看详情</button><button type="button" data-gameplay-publish="' + esc(g.id) + '">立即发布</button></div></article>';
  }
  function openGameplayHall() {
    var rows = gameplays();
    modalShell('<div class="club-price-head"><div><h2>更多玩法大厅</h2><p>趣味单、护航、跑刀、代肝等固定玩法。价格和规则全部读取后台启用数据。</p></div></div>' + (rows.length ? '<div class="club-price-grid">' + rows.map(gameplayCard).join("") + '</div>' : '<div class="club-price-empty">后台暂未启用更多玩法，请管理员先到「更多玩法管理」创建玩法。</div>'));
  }
  function openCombinedOrderHub() {
    openPriceTable();
  }
  function openGameplayDetail(id) {
    var g = gameplayById(id); if (!g) return;
    modalShell('<div class="club-price-head"><div><span class="club-price-tag">' + esc(g.category) + '</span><h2>' + esc(g.name) + '</h2><p>' + esc(g.intro || "") + '</p></div></div><div class="club-price-detail"><div><span>固定售价</span><strong>' + money(g.fixedPrice) + ' ' + esc(g.unit || "") + '</strong></div><div><span>平台抽成</span><strong>' + esc(g.commissionRate || 0) + '% · 扣除 ' + money(g.platformCut) + '</strong></div><div><span>陪玩到账</span><strong>' + money(g.playerIncome) + '</strong></div><div><span>服务时长</span><strong>' + esc(g.serviceDuration || "") + '</strong></div><div><span>开始条件</span><strong>' + esc(g.startCondition || "后台未填写") + '</strong></div><div><span>完成条件</span><strong>' + esc(g.completeCondition || "后台未填写") + '</strong></div><div><span>退款规则</span><strong>' + esc(g.refundRule || "后台未填写") + '</strong></div><div><span>可接陪玩条件</span><strong>' + esc(g.requiredQualification || g.name) + '</strong></div></div><div class="club-price-actions single"><button type="button" data-gameplay-publish="' + esc(g.id) + '">立即发布</button><button type="button" data-back-gameplay-hall>返回玩法大厅</button></div>');
  }
  function openGameplayForm(id) {
    var g = gameplayById(id); if (!g) return;
    var fields = (g.bossFields && g.bossFields.length ? g.bossFields : ["游戏区服", "开始时间", "游戏 ID", "是否需要语音", "其他备注"]);
    var custom = fields.map(function (field, idx) {
      var type = /时间|截止/.test(field) ? ' type="datetime-local"' : "";
      return '<label>' + esc(field) + '<input name="field_' + idx + '"' + type + ' data-field-label="' + esc(field) + '"></label>';
    }).join("");
    modalShell('<div class="club-price-head"><div><h2>发布固定玩法订单</h2><p>' + esc(g.name) + ' · 价格固定，发布后符合资格的陪玩可直接抢单成交。</p></div></div><form class="club-demand-form" data-gameplay-order-form="' + esc(g.id) + '"><div class="club-price-detail wide"><div><span>订单价格</span><strong>' + money(g.fixedPrice) + '</strong></div><div><span>平台抽成</span><strong>' + money(g.platformCut) + '</strong></div><div><span>陪玩到账</span><strong>' + money(g.playerIncome) + '</strong></div></div>' + custom + '<label class="wide">老板备注<textarea name="bossNote"></textarea></label><label>发布模式<select name="orderMode"><option value="fixed_gameplay_public">发布到玩法大厅抢单</option><option value="fixed_gameplay_designated">指定陪玩订单</option></select></label><label>付款状态<select name="paymentStatus"><option value="paid">已付款 / 猫粮已冻结</option><option value="unpaid">未付款</option></select></label><button class="club-demand-submit" type="submit">确认发布订单</button></form>');
  }
  function submitGameplayOrder(form) {
    var g = gameplayById(form.dataset.gameplayOrderForm); if (!g) return;
    if (form.elements.paymentStatus.value !== "paid") { alert("未付款订单不能进入玩法订单大厅，请先完成付款或冻结猫粮。"); return; }
    var fd = new FormData(form);
    var extra = {};
    form.querySelectorAll("[data-field-label]").forEach(function (input) { extra[input.dataset.fieldLabel] = input.value; });
    var orderId = uid("PLAY-ORDER");
    var chatId = uid("ORDER-CHAT");
    var order = {
      id: orderId,
      orderId: orderId,
      chatId: chatId,
      gameplayId: g.id,
      gameplayName: g.name,
      category: g.category,
      game: g.game,
      order_source: fd.get("orderMode") || "fixed_gameplay_public",
      status: fd.get("orderMode") === "fixed_gameplay_designated" ? "待指定陪玩确认" : "待抢单",
      paymentStatus: "paid",
      fixedPrice: Number(g.fixedPrice || 0),
      commissionRate: Number(g.commissionRate || 0),
      platformCut: Number(g.platformCut || 0),
      playerIncome: Number(g.playerIncome || 0),
      unit: g.unit,
      serviceDuration: g.serviceDuration,
      requiredQualification: g.requiredQualification || g.name,
      bossNote: fd.get("bossNote") || "",
      fields: extra,
      createdAt: now(),
      grabDeadline: new Date(Date.now() + Number(g.grabTimeoutMinutes || 30) * 60000).toLocaleString("zh-CN")
    };
    saveBoth(function (real) {
      real.gameplayOrders.unshift(order);
      real.orderChats.unshift({ id: chatId, orderId: orderId, members: ["boss"], sendable: false, status: "抢单前不可聊天", createdAt: now(), messages: [{ id: uid("MSG"), type: "order-card", from: "system", text: "固定玩法订单已发布，等待陪玩抢单。", orderId: orderId, createdAt: now() }] });
      real.logs.unshift({ id: uid("LOG"), action: "老板发布固定玩法订单", target: orderId, createdAt: now() });
    });
    modalShell('<div class="club-price-head"><div><h2>订单已发布</h2><p>订单编号：' + esc(orderId) + '</p></div></div><div class="club-price-detail"><div><span>当前状态</span><strong>' + esc(order.status) + '</strong></div><div><span>玩法</span><strong>' + esc(order.gameplayName) + '</strong></div><div><span>订单价格</span><strong>' + money(order.fixedPrice) + '</strong></div><div><span>陪玩到账</span><strong>' + money(order.playerIncome) + '</strong></div></div><p class="club-price-empty">符合资格的陪玩抢单成功后，会立即生成正式订单并开放订单聊天。</p>');
  }

  function bind() {
    document.addEventListener("click", function (e) {
      var combinedEntry = e.target.closest("[data-combined-order]");
      if (combinedEntry) { e.preventDefault(); e.stopImmediatePropagation(); openPriceTable(); return; }
      var priceEntry = e.target.closest('[data-modal="order"],[data-price-table]');
      if (priceEntry) { e.preventDefault(); e.stopImmediatePropagation(); openPriceTable(); return; }
      var gameplayEntry = e.target.closest("[data-more-gameplays]");
      if (gameplayEntry) { e.preventDefault(); e.stopImmediatePropagation(); openGameplayHall(); return; }
      if (e.target.closest("[data-open-price-table]")) { openPriceTable(); return; }
      if (e.target.closest("[data-open-gameplay-hall]")) { openGameplayHall(); return; }
      if (e.target.closest("[data-close-price-modal]")) { var m = document.getElementById("clubPriceModal"); if (m) m.remove(); }
      if (e.target.id === "clubPriceModal") e.target.remove();
      var detail = e.target.closest("[data-price-detail]"); if (detail) openPriceDetail(detail.dataset.priceDetail);
      var submit = e.target.closest("[data-price-submit]"); if (submit) openDemandForm(submit.dataset.priceSubmit);
      if (e.target.closest("[data-back-price-table]")) openPriceTable();
      var gDetail = e.target.closest("[data-gameplay-detail]"); if (gDetail) openGameplayDetail(gDetail.dataset.gameplayDetail);
      var gPublish = e.target.closest("[data-gameplay-publish]"); if (gPublish) openGameplayForm(gPublish.dataset.gameplayPublish);
      if (e.target.closest("[data-back-gameplay-hall]")) openGameplayHall();
      var choose = e.target.closest("[data-select-candidate]"); if (choose) chooseCandidate(choose.dataset.selectCandidate);
      var tab = e.target.closest("[data-real-tab]");
      if (tab) {
        document.querySelectorAll("[data-real-tab]").forEach(function (b) { b.classList.toggle("active", b === tab); });
        document.querySelectorAll("[data-real-pane]").forEach(function (p) { p.classList.toggle("active", p.dataset.realPane === tab.dataset.realTab); });
      }
      if (e.target.closest("[data-save-ad]")) saveAd();
      if (e.target.closest("[data-save-companion]")) saveCompanion();
      if (e.target.closest("[data-save-range]")) saveRange();
      var del = e.target.closest("[data-del]");
      if (del) { var next = db(); next[del.dataset.del] = (next[del.dataset.del] || []).filter(function (x) { return x.id !== del.dataset.id; }); save(next); }
      if (e.target.closest("[data-clear-db]") && confirm("确定清空本地真实数据？前台会显示空状态。")) { localStorage.removeItem(REAL_KEY); localStorage.removeItem(PLATFORM_KEY); renderTables(); window.dispatchEvent(new CustomEvent("mcj:data-updated")); }
    }, true);
    document.addEventListener("submit", function (e) {
      if (e.target.matches("[data-demand-form]")) { e.preventDefault(); submitDemand(e.target); }
      if (e.target.matches("[data-gameplay-order-form]")) { e.preventDefault(); submitGameplayOrder(e.target); }
      if (e.target.matches("[data-chat-form]")) {
        e.preventDefault();
        var text = e.target.elements.text.value.trim();
        if (!text) return;
        var threadId = e.target.dataset.chatForm;
        saveBoth(function (real) {
          var t = (real.chatThreads || []).find(function (x) { return x.id === threadId; });
          if (t) t.messages.push({ id: uid("MSG"), type: "text", from: "boss", text: text, createdAt: now() });
        });
        openBossChat(threadId);
      }
    });
  }

  function updateHomepageEntry() {
    document.querySelectorAll('[data-modal="order"],[data-price-table]').forEach(function (btn) {
      btn.removeAttribute("data-modal");
      btn.setAttribute("data-price-table", "true");
      btn.removeAttribute("data-combined-order");
      btn.classList.add("custom-order-unified");
      var strong = btn.querySelector("strong"), span = btn.querySelector("span");
      if (strong) strong.textContent = "自定义订单";
      if (span) span.textContent = "填写需求，客服匹配陪玩";
    });
  }  function init() { insertPanel(); bind(); renderTables(); updateHomepageEntry(); syncPlatform(db()); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();


