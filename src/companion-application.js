(function () {
  var DB_KEY = "mcjRealDB.v1";
  var PLATFORM_KEY = "mcjPlatformData.v1";
  var DRAFT_KEY = "mcjCompanionApplicationDraft.v1";
  var APPLICANT_KEY = "mcjCompanionApplicantId.v1";
  var MIN_VOICE_SECONDS = 10;
  var MAX_VOICE_SECONDS = 60;
  var recorder = null;
  var chunks = [];
  var recordTimer = null;
  var recordStartedAt = 0;
  var suppressVoiceSave = false;

  var steps = [
    "阅读陪玩制度",
    "基本资料",
    "游戏资料",
    "上传头像与资料",
    "身份认证与押金"
  ];

  var tagGroups = {
    personalTags: {
      "性格": ["甜妹", "御姐", "萌妹", "高冷", "温柔", "活泼", "幽默", "社恐", "社牛", "粘人", "高情商", "氛围感"],
      "声音": ["萝莉音", "少女音", "御姐音", "温柔音", "性感音", "治愈音", "烟嗓", "正太音", "青叔音"],
      "陪玩风格": ["娱乐", "上分", "护航", "指挥", "教学", "长期搭子", "深夜档", "全天在线"]
    },
    positions: { "擅长位置": ["指挥", "输出", "辅助", "打野", "中路", "射手", "坦克", "自由位", "狙击位", "突破位"] },
    modes: { "可接模式": ["排位", "娱乐", "护航", "代肝", "跑刀", "教学"] },
    mainGames: { "主玩游戏": ["王者荣耀", "和平精英", "英雄联盟", "Valorant", "APEX", "PUBG", "永劫无间", "CS2", "原神", "崩铁"] }
  };

  var rankOptions = ["青铜", "白银", "黄金", "铂金", "钻石", "星耀", "王者", "荣耀王者", "大师", "宗师", "超凡", "无畏战神", "其他"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function now() { return new Date().toLocaleString("zh-CN"); }
  function uid(prefix) { return prefix + "-" + Date.now().toString(36).toUpperCase() + Math.random().toString(16).slice(2, 6).toUpperCase(); }
  function readRaw(key) { try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) { return {}; } }
  function writeRaw(key, data) { localStorage.setItem(key, JSON.stringify(data || {})); }
  function defaultDeposit() {
    return {
      amount: 100,
      currency: "MYR",
      enabled: true,
      methods: ["TNG", "DuitNow", "Alipay"],
      chinaRateSource: "支付页面实时汇率",
      manualCnyRate: 1.55,
      description: "认证押金用于保障平台服务秩序，最终支付金额以支付页面显示为准。",
      refundRule: "退出俱乐部并完成全部订单结算后，可按平台规则申请退还押金。",
      allowAdminWaive: false
    };
  }
  function baseDB() {
    return { companionRules: [], voiceTypes: [], companionApplications: [], companionApplicationPayments: [], notifications: [], companions: [], logs: [], depositSettings: defaultDeposit() };
  }
  function readDB() { return Object.assign(baseDB(), readRaw(DB_KEY)); }
  function writeDB(db) { writeRaw(DB_KEY, db); window.dispatchEvent(new CustomEvent("mcj:data-updated")); }
  function readPlatform() { return Object.assign(baseDB(), readRaw(PLATFORM_KEY)); }
  function syncPlatform(db) {
    var p = readPlatform();
    ["companionRules", "voiceTypes", "companionApplications", "companionApplicationPayments", "depositSettings", "notifications", "companions"].forEach(function (key) {
      p[key] = db[key] || p[key];
    });
    writeRaw(PLATFORM_KEY, p);
    window.dispatchEvent(new CustomEvent("mcj:platform-data-updated"));
  }
  function applicantId() {
    var id = localStorage.getItem(APPLICANT_KEY);
    if (!id) { id = "boss_" + Date.now(); localStorage.setItem(APPLICANT_KEY, id); }
    return id;
  }
  function currentUser() {
    try {
      var u = JSON.parse(localStorage.getItem("customerUser") || localStorage.getItem("mcjCurrentUser") || "null");
      if (u) return { id: u.id || u.user_id || applicantId(), name: u.name || u.nickname || "当前账号" };
    } catch (e) {}
    return { id: applicantId(), name: "当前账号" };
  }
  function readDraft() {
    return Object.assign({ step: 0, data: {}, uploads: {}, gameCards: [], voice: {}, rulesAgreement: {} }, readRaw(DRAFT_KEY));
  }
  function saveDraft(patch) {
    var draft = readDraft();
    Object.keys(patch || {}).forEach(function (key) {
      if (typeof patch[key] === "object" && !Array.isArray(patch[key]) && patch[key] !== null) draft[key] = Object.assign(draft[key] || {}, patch[key]);
      else draft[key] = patch[key];
    });
    writeRaw(DRAFT_KEY, draft);
  }
  function publishedRule() {
    var db = readDB();
    var rows = (db.companionRules || []).filter(function (r) { return r.status === "published" && r.enabled !== false; });
    if (!rows.length) return null;
    return rows.sort(function (a, b) { return Number(b.sort || 0) - Number(a.sort || 0) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")); })[0];
  }
  function depositSettings() {
    return Object.assign(defaultDeposit(), readDB().depositSettings || readPlatform().depositSettings || {});
  }
  function voiceTypeOptions() {
    var db = readDB();
    var rows = (db.voiceTypes || readPlatform().voiceTypes || []).filter(function (item) { return item.enabled !== false; });
    var names = rows.sort(function (a, b) { return Number(a.sort || 0) - Number(b.sort || 0); }).map(function (item) { return item.name || item.title; }).filter(Boolean);
    return names.length ? names : ["少女音", "御姐音", "温柔音", "治愈音", "萝莉音", "烟嗓", "正太音", "青叔音", "其他"];
  }
  function existingApplication() {
    var id = applicantId();
    return (readDB().companionApplications || []).find(function (a) { return a.applicantId === id; }) || null;
  }
  function ensureDefaultApplicationConfig() {
    var db = readDB();
    var changed = false;
    if (!Array.isArray(db.companionRules)) db.companionRules = [];
    if (!db.companionRules.some(function (rule) { return rule.status === "published" && rule.enabled !== false; })) {
      db.companionRules.unshift({
        id: "RULE-DEFAULT-COMPANION",
        title: "Meow Cui Jiao 陪玩制度",
        subtitle: "申请前请阅读并遵守平台服务规范。",
        body: "1. 礼貌服务，尊重老板和客服。\n2. 准时上线，按订单时间完成服务。\n3. 禁止私下交易、诱导转账或索取额外财物。\n4. 禁止泄露老板、陪玩、客服和平台隐私。\n5. 服务中如遇争议，请第一时间联系平台客服处理。",
        notes: "申请资料必须真实、清楚、可审核。头像、卡面、试音和游戏资料通过后才会展示到前台。",
        penaltyRules: "违规会根据情节进行警告、暂停接单、扣除保证金、封禁账号或移交进一步处理。",
        depositRules: "身份认证、押金 RM100 和结款资料会在最终提交时一并进入后台审核。",
        version: "2026.07",
        status: "published",
        enabled: true,
        sort: 1,
        updatedAt: now(),
        updatedBy: "system-default"
      });
      changed = true;
    }
    if (!Array.isArray(db.voiceTypes) || !db.voiceTypes.length) {
      db.voiceTypes = ["少女音", "御姐音", "温柔音", "治愈音", "萝莉音", "烟嗓", "正太音", "青叔音", "其他"].map(function (name, index) {
        return { id: "VOICE-" + (index + 1), name: name, sort: index + 1, enabled: true };
      });
      changed = true;
    }
    if (changed) {
      writeDB(db);
      syncPlatform(db);
    }
  }

  function stepComplete(index, draft) {
    draft = draft || readDraft();
    var data = draft.data || {};
    if (index === 0) return !!((draft.rulesAgreement || {}).accepted);
    if (index === 1) return !!(data.nickname && data.age && data.gender && data.region && data.phone && data.email && (data.personalTags || []).length);
    if (index === 2) return !!((data.mainGames || []).length && (data.positions || []).length && (data.modes || []).length && data.rank && data.voiceType && data.onlineStart && data.onlineEnd);
    if (index === 3) return !!((draft.uploads || {}).avatar && (draft.uploads || {}).cover && (draft.voice || {}).confirmed);
    return !!((draft.identity || {}).idFront && (draft.identity || {}).idBack && (draft.identity || {}).depositProof && (draft.identity || {}).settlementName && (draft.identity || {}).settlementMethod && (draft.identity || {}).settlementAccount);
  }

  function stepNav(index, draft) {
    draft = draft || readDraft();
    var prev = steps[index - 1] || "";
    var next = steps[index + 1] || "";
    return '<div class="apply-mobile-step"><span>第 ' + (index + 1) + ' 步，共 ' + steps.length + ' 步</span><strong>' + esc(steps[index]) + '</strong><small>' + esc(prev ? prev + " ｜ " : "") + esc(steps[index]) + esc(next ? " ｜ " + next : "") + '</small></div>' +
      '<aside class="apply-steps">' + steps.map(function (s, i) {
        var done = stepComplete(i, draft);
        return '<button class="apply-step ' + (i === index ? "active" : "") + (done ? " done" : "") + '" data-apply-step="' + i + '" type="button"><span>' + (done ? "✓" : (i + 1)) + '</span>' + esc(s) + '</button>';
      }).join("") + '</aside>';
  }
  function field(name, label, type, value, attrs) {
    type = type || "text";
    attrs = attrs || "";
    if (type === "textarea") return '<label class="form-field full">' + esc(label) + '<textarea name="' + esc(name) + '" data-apply-field ' + attrs + '>' + esc(value || "") + '</textarea></label>';
    return '<label class="form-field">' + esc(label) + '<input name="' + esc(name) + '" data-apply-field type="' + esc(type) + '" value="' + esc(value || "") + '" ' + attrs + '></label>';
  }
  function selectField(name, label, value, options) {
    return '<label class="form-field">' + esc(label) + '<select name="' + esc(name) + '" data-apply-field>' + options.map(function (o) {
      return '<option value="' + esc(o) + '"' + (o === value ? " selected" : "") + '>' + esc(o) + '</option>';
    }).join("") + '</select></label>';
  }
  function fileField(name, label, accept, preview) {
    return '<label class="form-field upload-field">' + esc(label) + '<input name="' + esc(name) + '" data-file-field type="file" accept="' + esc(accept || "image/*") + '"><span class="upload-card ' + (preview ? "has-preview" : "") + '">' + (preview ? '<img class="apply-preview" src="' + esc(preview) + '" alt=""><span class="upload-state">已上传</span><button class="upload-remove" type="button" data-clear-upload="' + esc(name) + '" aria-label="删除">×</button>' : '<span class="upload-plus">＋</span><span class="upload-text">' + esc(label) + '</span>') + '</span></label>';
  }
  function tagPicker(fieldName, label, selected, groups, limit) {
    selected = Array.isArray(selected) ? selected : [];
    var body = Object.keys(groups || {}).map(function (group) {
      return '<div class="tag-group"><b>' + esc(group) + '</b><div class="tag-list">' + groups[group].map(function (tag) {
        return '<label class="tag-pill ' + (selected.indexOf(tag) >= 0 ? "checked" : "") + '"><input type="checkbox" data-tag-field="' + esc(fieldName) + '" value="' + esc(tag) + '" ' + (selected.indexOf(tag) >= 0 ? "checked" : "") + '> ' + esc(tag) + '</label>';
      }).join("") + '</div></div>';
    }).join("");
    return '<div class="form-field full tag-picker" data-tag-picker="' + esc(fieldName) + '" data-tag-limit="' + (limit || 99) + '"><span>' + esc(label) + '</span>' + body + '<div class="custom-tag-row"><input data-custom-tag-input="' + esc(fieldName) + '" placeholder="新增自定义标签"><button class="apply-btn small" type="button" data-add-custom-tag="' + esc(fieldName) + '">添加</button></div><small>已选择 <em data-tag-count="' + esc(fieldName) + '">' + selected.length + '</em> / ' + (limit || 99) + '</small></div>';
  }

  function rulesHtml(draft) {
    var rule = publishedRule();
    var agreed = draft.rulesAgreement && draft.rulesAgreement.accepted;
    if (!rule) return '<section class="apply-panel apply-rules-card"><h2>阅读陪玩制度</h2><div class="rules-reader"><h3>后台暂未发布陪玩制度</h3><p>请等待超级管理员在后台发布陪玩制度后再继续申请。</p></div><label class="agree-row"><input type="checkbox" disabled> 我已完整阅读并同意《陪玩制度》及《平台规范》</label></section>';
    return '<section class="apply-panel apply-rules-card"><h2>阅读陪玩制度</h2><div class="rules-reader"><h3>' + esc(rule.title) + '</h3><p>' + esc(rule.subtitle || "") + '</p><pre>' + esc(rule.body || "") + '</pre><div class="rules-extra"><b>注意事项</b><pre>' + esc(rule.notes || "") + '</pre><b>处罚规则</b><pre>' + esc(rule.penaltyRules || "") + '</pre><b>退款与押金规则</b><pre>' + esc(rule.depositRules || "") + '</pre></div></div><label class="agree-row"><input type="checkbox" data-rule-agree ' + (agreed ? "checked" : "") + '> 我已完整阅读并同意《陪玩制度》及《平台规范》</label></section>';
  }
  function basicHtml(data) {
    return '<section class="apply-panel"><h2>填写基本资料</h2><form class="apply-grid">' +
      field("nickname", "昵称", "text", data.nickname) +
      field("age", "年龄", "number", data.age, 'min="16" max="60"') +
      selectField("gender", "性别", data.gender, ["女", "男", "保密"]) +
      field("region", "地区", "text", data.region, 'placeholder="例如：Kuala Lumpur"') +
      field("phone", "联系电话", "tel", data.phone) +
      field("email", "邮箱", "email", data.email) +
      selectField("contactPublic", "联系方式是否公开", data.contactPublic, ["不公开，仅平台可见", "审核通过后公开给已下单老板"]) +
      tagPicker("personalTags", "个人标签（必填，最多 10 个）", data.personalTags, tagGroups.personalTags, 10) +
      '</form></section>';
  }
  function gameHtml(data) {
    return '<section class="apply-panel"><h2>填写游戏资料</h2><form class="apply-grid">' +
      '<label class="form-field">游戏昵称<div class="copy-field"><input name="gameNickname" data-apply-field type="text" value="' + esc(data.gameNickname || "") + '"><button class="apply-btn small" type="button" data-copy-nickname>复制</button></div></label>' +
      tagPicker("mainGames", "主玩游戏（多选）", data.mainGames, tagGroups.mainGames, 8) +
      tagPicker("positions", "擅长位置（多选）", data.positions, tagGroups.positions, 8) +
      tagPicker("modes", "可接模式（多选）", data.modes, tagGroups.modes, 8) +
      selectField("rank", "游戏段位", data.rank, rankOptions) +
      selectField("voiceType", "声音类型", data.voiceType, voiceTypeOptions()) +
      field("onlineStart", "常在线开始时间", "time", data.onlineStart) +
      field("onlineEnd", "常在线结束时间", "time", data.onlineEnd) +
      field("intro", "自我介绍", "textarea", data.intro) +
      '</form></section>';
  }
  function uploadHtml(draft) {
    var u = draft.uploads || {};
    return '<section class="apply-panel"><h2>上传头像与资料</h2><form class="apply-grid">' +
      fileField("avatar", "头像", "image/*", u.avatar) +
      fileField("cover", "卡面封面", "image/*", u.cover) +
      fileField("photos", "相册照片", "image/*", u.photos) +
      fileField("records", "游戏战绩图", "image/*", u.records) +
      '<p class="apply-note full">图片和试音用于后台审核，通过后会按后台配置展示到陪玩详情。</p></form></section>' +
      voiceHtml(draft);
  }
  function voiceHtml(draft) {
    var v = draft.voice || {};
    var q = v.quality || {};
    var hasVoice = !!v.url;
    var canConfirm = hasVoice && v.listened && q.volumeOk && q.durationOk && q.notBlank;
    var waveform = Array.isArray(q.waveform) && q.waveform.length ? q.waveform : [18, 30, 44, 24, 38, 28, 48];
    var reasons = Array.isArray(q.reasons) ? q.reasons : [];
    var template = "大家好，我是" + (draft.data.nickname || "你的昵称") + "，主玩" + ((draft.data.mainGames || [draft.data.mainGame || "你的游戏"]).join("、")) + "，风格偏" + ((draft.data.personalTags || ["温柔", "娱乐"]).slice(0, 3).join("、")) + "。我可以陪你上分、娱乐或者聊天，希望能给你带来轻松开心的游戏体验。";
    return '<section class="apply-panel"><h2>录制试音</h2><div class="voice-recorder" data-voice-status="' + esc(v.status || "尚未录制") + '"><div class="voice-stage"><span class="' + (hasVoice ? "done" : "active") + '">1 录制</span><span class="' + (v.listened ? "done" : hasVoice ? "active" : "") + '">2 试听</span><span class="' + (v.confirmed ? "done" : canConfirm ? "active" : "") + '">3 确认</span></div><div class="voice-status"><strong id="voiceState">' + esc(v.status || "尚未录制") + '</strong><span id="voiceTimer">' + esc(v.duration ? v.duration + " 秒" : "00:00") + '</span></div><div class="voice-wave" id="voiceWave">' + waveform.map(function (h) { return '<i style="height:' + Math.max(12, Math.min(56, Number(h || 18))) + 'px"></i>'; }).join("") + '</div><div class="voice-actions"><button class="apply-btn primary" type="button" data-record-start>🎤 开始录音</button><button class="apply-btn" type="button" data-record-stop disabled>⏹ 停止录音</button><button class="apply-btn" type="button" data-record-play ' + (!hasVoice ? "disabled" : "") + '>▶ 播放试听</button><button class="apply-btn" type="button" data-record-reset ' + (!hasVoice ? "disabled" : "") + '>🔄 重新录制</button><button class="apply-btn" type="button" data-record-delete ' + (!hasVoice ? "disabled" : "") + '>删除录音</button><button class="apply-btn primary" type="button" data-record-confirm ' + (!canConfirm ? "disabled" : "") + '>✅ 确认使用</button></div>' + (v.url ? '<audio id="voicePreview" controls preload="metadata" src="' + esc(v.url) + '"></audio>' : '<audio id="voicePreview" controls hidden></audio>') + '<div class="voice-quality"><span class="' + (q.durationOk ? "ok" : "bad") + '">✔ 时长' + (q.durationOk ? "符合" : "需 10~60 秒") + '</span><span class="' + (q.humanVoice ? "ok" : "bad") + '">✔ ' + (q.humanVoice ? "检测到人声" : "人声不足") + '</span><span class="' + (q.volumeOk ? "ok" : "bad") + '">✔ 音量' + (q.volumeOk ? "正常" : "过低") + '</span><span class="' + (q.notBlank ? "ok" : "bad") + '">✔ ' + (q.notBlank ? "无空白录音" : "静音过多") + '</span></div>' + (reasons.length ? '<div class="voice-errors">' + reasons.map(function (r) { return '<p>' + esc(r) + '</p>'; }).join("") + '</div>' : '') + '<div class="voice-tip">' + (hasVoice ? (canConfirm ? "试听完成，可以确认使用。确认后会自动上传并标记本步骤完成。" : "请播放完整试听，确认音量和内容正常后再提交。") : "建议录制 10 到 60 秒，简单介绍声音特点、游戏风格和接单优势。") + '</div></div><div class="voice-template-card"><div><h3>不知道说什么？可以参考下面模板。</h3><p id="voiceTemplateText">' + esc(template) + '</p></div><button class="apply-btn small" type="button" data-copy-voice-template>一键复制模板</button></div><form class="apply-grid">' + field("voiceNote", "试音说明", "textarea", (draft.data || {}).voiceNote, 'placeholder="可以简单介绍自己的声音特点、擅长的聊天风格或游戏。"') + '</form></section>';
  }
  function identityHtml(draft) {
    var id = draft.identity || {};
    var dep = Object.assign({ status: "未支付" }, draft.deposit || {});
    var set = depositSettings();
    return '<section class="apply-panel"><h2>身份认证、押金与结款资料</h2><div class="apply-split"><div class="apply-subcard"><h3>身份认证</h3><p>资料仅用于平台审核，不会在老板端公开。</p><form class="apply-grid">' +
      selectField("documentType", "证件类型", id.documentType, ["马来西亚身份证", "中国大陆身份证"]) +
      fileField("idFront", "身份证 / 证件正面", "image/*", id.idFront) +
      fileField("idBack", "身份证 / 证件背面", "image/*", id.idBack) +
      '</form></div><div class="apply-subcard"><h3>认证押金：RM' + Number(set.amount || 100).toFixed(0) + '</h3><ul><li>提交押金付款凭证后进入后台人工审核</li><li>中国大陆用户根据支付页面实时汇率换算</li><li>审核通过后才可正式使用陪玩端</li></ul><p>' + esc(set.description || "") + '</p><form class="apply-grid">' +
      selectField("depositMethod", "押金支付方式", id.depositMethod, set.methods || ["TNG", "DuitNow", "Alipay"]) +
      fileField("depositProof", "押金付款凭证", "image/*", id.depositProof) +
      selectField("settlementMethod", "结款方式", id.settlementMethod, ["银行卡", "DuitNow", "TNG Wallet", "支付宝"]) +
      field("settlementName", "结款户名", "text", id.settlementName) +
      field("settlementAccount", "结款账号", "text", id.settlementAccount) +
      '</form><div class="deposit-status"><strong>' + esc(dep.status || "待后台审核") + '</strong><p>提交后由超级管理员审核身份资料、押金凭证与结款资料。</p></div></div></div></section>';
  }
  function stepHtml(index, draft) {
    if (index === 0) return rulesHtml(draft);
    if (index === 1) return basicHtml(draft.data || {});
    if (index === 2) return gameHtml(draft.data || {});
    if (index === 3) return uploadHtml(draft);
    return identityHtml(draft);
  }
  function statusNotice() {
    var app = existingApplication();
    if (!app) return "";
    var label = app.status === "review" ? "审核中" : app.status === "approved" ? "已通过" : app.status === "rejected" ? "已退回/拒绝" : app.status;
    return '<div class="apply-status-note">当前申请状态：<b>' + esc(label || "草稿") + '</b>。你仍可打开制度页查看内容，也可以继续补充草稿。</div>';
  }
  function render(index) {
    var root = document.getElementById("companionApplyRoot");
    if (!root) return;
    index = Math.max(0, Math.min(steps.length - 1, Number(index || readDraft().step || 0)));
    saveDraft({ step: index });
    root.dataset.step = String(index);
    var draft = readDraft();
    var agreed = draft.rulesAgreement && draft.rulesAgreement.accepted;
    if (!agreed) {
      root.innerHTML = statusNotice() + rulesHtml(draft) + '<div class="apply-status-note">请先阅读并同意陪玩制度</div><div class="apply-actions"><button class="apply-btn primary" data-apply-next type="button" disabled>保存并下一步</button></div>';
      return;
    }
    var nextDisabled = index === 0 && !((draft.rulesAgreement || {}).accepted);
    root.innerHTML = statusNotice() + '<div class="apply-layout">' + stepNav(index, draft) + '<div>' + stepHtml(index, draft) + '<div class="step-complete-mark">' + (stepComplete(index, draft) ? "已完成 ✔" : "未完成 ○") + '</div><div class="apply-actions"><button class="apply-btn" data-apply-prev type="button" ' + (index === 0 ? "disabled" : "") + '>上一步</button><button class="apply-btn" data-apply-save type="button">保存草稿</button><button class="apply-btn primary" data-apply-next type="button" ' + (nextDisabled ? "disabled" : "") + '>' + (index === steps.length - 1 ? "提交审核" : "下一步") + '</button></div><p class="apply-note">每填写一个输入框都会自动保存草稿，刷新网页后会自动恢复。</p></div></div>';
  }
  function fileToDataURL(file) {
    return new Promise(function (resolve) {
      if (!file) return resolve("");
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.readAsDataURL(file);
    });
  }
  async function collect(root) {
    var draft = readDraft();
    var data = draft.data || {};
    var identity = draft.identity || {};
    var uploads = draft.uploads || {};
    var step = Number(root.dataset.step || 0);
    Array.prototype.slice.call(root.querySelectorAll("[data-apply-field]")).forEach(function (el) { data[el.name] = el.value.trim(); });
    Array.prototype.slice.call(root.querySelectorAll("[data-tag-picker]")).forEach(function (picker) {
      var key = picker.dataset.tagPicker;
      data[key] = Array.prototype.slice.call(picker.querySelectorAll("[data-tag-field]:checked")).map(function (el) { return el.value; });
    });
    var fileFields = Array.prototype.slice.call(root.querySelectorAll("[data-file-field]"));
    for (var i = 0; i < fileFields.length; i++) {
      var input = fileFields[i];
      if (input.files && input.files[0]) {
        var url = await fileToDataURL(input.files[0]);
        if (step === 4 || input.name === "idFront" || input.name === "idBack") identity[input.name] = url;
        else uploads[input.name] = url;
      }
    }
    Array.prototype.slice.call(root.querySelectorAll("select[name],input[name]:not([type=file]),textarea[name]")).forEach(function (el) {
      if (step === 4) identity[el.name] = el.value.trim ? el.value.trim() : el.value;
    });
    saveDraft({ data: data, identity: identity, uploads: uploads });
  }
  function validateBeforeSubmit() {
    var d = readDraft();
    var missing = [];
    if (!d.rulesAgreement.accepted) missing.push("请先阅读并同意陪玩制度");
    ["nickname", "age", "gender", "region", "phone", "email"].forEach(function (k) { if (!(d.data || {})[k]) missing.push("基本资料：" + k); });
    if (!((d.data || {}).personalTags || []).length) missing.push("个人标签未选择");
    ["rank", "voiceType", "onlineStart", "onlineEnd", "intro"].forEach(function (k) { if (!(d.data || {})[k]) missing.push("游戏资料：" + k); });
    if (!((d.data || {}).mainGames || []).length) missing.push("主玩游戏未选择");
    if (!((d.data || {}).positions || []).length) missing.push("擅长位置未选择");
    if (!((d.data || {}).modes || []).length) missing.push("可接模式未选择");
    if (!(d.uploads || {}).avatar) missing.push("头像未上传");
    if (!(d.uploads || {}).cover) missing.push("卡面封面未上传");
    if (!(d.voice || {}).confirmed) missing.push("试音未试听并确认");
    if (!(d.identity || {}).idFront) missing.push("证件正面未上传");
    if (!(d.identity || {}).idBack) missing.push("证件背面未上传");
    if (!(d.identity || {}).depositProof) missing.push("押金付款凭证未上传");
    if (!(d.identity || {}).settlementName || !(d.identity || {}).settlementMethod || !(d.identity || {}).settlementAccount) missing.push("结款资料未填写完整");
    return missing;
  }
  function submitApplication() {
    var missing = validateBeforeSubmit();
    if (missing.length) { alert("还有以下资料没有完成：\n" + missing.join("\n")); return; }
    var draft = readDraft();
    var user = currentUser();
    var db = readDB();
    var id = "APP-" + Date.now();
    var app = {
      id: id,
      applicantId: applicantId(),
      accountName: user.name,
      data: draft.data,
      tags: draft.data.personalTags || [],
      gameProfile: {
        mainGames: draft.data.mainGames || [],
        positions: draft.data.positions || [],
        modes: draft.data.modes || [],
        rank: draft.data.rank || "",
        onlineStart: draft.data.onlineStart || "",
        onlineEnd: draft.data.onlineEnd || "",
        nickname: draft.data.nickname || "",
        gameNickname: draft.data.gameNickname || ""
      },
      uploads: draft.uploads,
      voice: draft.voice,
      identity: draft.identity || {},
      deposit: { status: "pending_review", method: (draft.identity || {}).depositMethod || "", proof: (draft.identity || {}).depositProof || "", amount: depositSettings().amount || 100 },
      settlement: {
        method: (draft.identity || {}).settlementMethod || "",
        name: (draft.identity || {}).settlementName || "",
        account: (draft.identity || {}).settlementAccount || ""
      },
      rulesAgreement: draft.rulesAgreement,
      readAgreement: { accepted: !!draft.rulesAgreement.accepted, agreedAt: draft.rulesAgreement.agreedAt || "", ruleId: draft.rulesAgreement.ruleId || "", version: draft.rulesAgreement.version || "" },
      status: "review",
      createdAt: now(),
      reviewer: "",
      reason: ""
    };
    db.companionApplications = (db.companionApplications || []).filter(function (x) { return x.applicantId !== app.applicantId; });
    db.companionApplications.unshift(app);
    db.notifications = db.notifications || [];
    db.notifications.unshift({ id: uid("NT"), type: "companion_application", title: "新的陪玩申请待审核", body: app.accountName + " 提交了陪玩申请", createdAt: now(), targetRole: "super_admin" });
    db.logs = db.logs || [];
    db.logs.unshift({ id: uid("LOG"), action: "提交陪玩申请", targetId: id, createdAt: now(), ip: "local-preview" });
    writeDB(db);
    syncPlatform(db);
    showSuccess();
  }
  function showSuccess() {
    var modal = document.createElement("div");
    modal.className = "apply-submit-modal";
    modal.innerHTML = '<div><h2>申请提交成功</h2><p>感谢你的加入，我们会尽快完成审核。</p><p>审核结果会通过站内消息通知你，请耐心等待。</p><div class="apply-actions"><a class="apply-btn" href="companion-apply.html">查看审核进度</a><a class="apply-btn primary" href="index.html">返回首页</a></div></div>';
    document.body.appendChild(modal);
  }
  function setVoiceState(text, seconds) {
    var state = document.getElementById("voiceState");
    var timer = document.getElementById("voiceTimer");
    if (state) state.textContent = text;
    if (timer) timer.textContent = seconds == null ? timer.textContent : String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }
  function setRecordingUi(isRecording) {
    var start = document.querySelector("[data-record-start]");
    var stop = document.querySelector("[data-record-stop]");
    var play = document.querySelector("[data-record-play]");
    var reset = document.querySelector("[data-record-reset]");
    var confirm = document.querySelector("[data-record-confirm]");
    if (start) start.disabled = !!isRecording;
    if (stop) stop.disabled = !isRecording;
    if (play) play.disabled = !!isRecording || !readDraft().voice.url;
    if (reset) reset.disabled = !!isRecording || !readDraft().voice.url;
    if (confirm) confirm.disabled = true;
  }
  function blobToDataURL(blob) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.readAsDataURL(blob);
    });
  }
  async function analyzeVoiceBlob(blob, fallbackDuration) {
    var result = {
      duration: fallbackDuration,
      durationOk: fallbackDuration >= MIN_VOICE_SECONDS && fallbackDuration <= MAX_VOICE_SECONDS,
      volumeOk: false,
      humanVoice: false,
      notBlank: false,
      rms: 0,
      peak: 0,
      silenceRatio: 1,
      waveform: [],
      reasons: []
    };
    try {
      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var buffer = await blob.arrayBuffer();
      var decoded = await audioCtx.decodeAudioData(buffer.slice(0));
      var channel = decoded.getChannelData(0);
      var total = channel.length || 1;
      var sum = 0;
      var peak = 0;
      var silent = 0;
      var bars = 24;
      var step = Math.max(1, Math.floor(total / bars));
      for (var i = 0; i < total; i++) {
        var abs = Math.abs(channel[i]);
        sum += abs * abs;
        if (abs > peak) peak = abs;
        if (abs < 0.012) silent++;
      }
      for (var b = 0; b < bars; b++) {
        var local = 0;
        var count = 0;
        for (var j = b * step; j < Math.min(total, (b + 1) * step); j++) {
          local += Math.abs(channel[j]);
          count++;
        }
        result.waveform.push(Math.round(Math.max(12, Math.min(56, (local / Math.max(1, count)) * 420))));
      }
      result.duration = Math.round(decoded.duration || fallbackDuration);
      result.durationOk = result.duration >= MIN_VOICE_SECONDS && result.duration <= MAX_VOICE_SECONDS;
      result.rms = Math.sqrt(sum / total);
      result.peak = peak;
      result.silenceRatio = silent / total;
      result.volumeOk = result.rms >= 0.018 && peak >= 0.08;
      result.notBlank = result.silenceRatio < 0.82;
      result.humanVoice = result.volumeOk && result.notBlank && blob.size > 8000;
      if (audioCtx.close) audioCtx.close();
    } catch (e) {
      result.volumeOk = blob.size > 12000;
      result.notBlank = blob.size > 12000;
      result.humanVoice = blob.size > 12000;
      result.waveform = [18, 30, 44, 24, 38, 28, 48, 34, 42, 24, 36, 44];
    }
    if (!result.durationOk) result.reasons.push("录音时长需要保持在 10 到 60 秒之间。");
    if (!result.humanVoice) result.reasons.push("没有检测到足够清晰的人声，请靠近麦克风重新录制。");
    if (!result.volumeOk) result.reasons.push("音量偏低，请提高说话音量或检查麦克风。");
    if (!result.notBlank) result.reasons.push("录音中静音比例过高，请重新录制完整自我介绍。");
    result.passed = result.durationOk && result.humanVoice && result.volumeOk && result.notBlank;
    return result;
  }
  async function startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) { alert("当前浏览器不支持网页录音，请更换手机 Chrome 或 Safari。"); return; }
    if (recorder && recorder.state === "recording") return;
    chunks = [];
    suppressVoiceSave = false;
    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alert("无法开启麦克风，请检查浏览器麦克风权限。");
      return;
    }
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = async function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      if (suppressVoiceSave) {
        suppressVoiceSave = false;
        chunks = [];
        return;
      }
      var duration = Math.round((Date.now() - recordStartedAt) / 1000);
      var blob = new Blob(chunks, { type: "audio/webm" });
      var quality = await analyzeVoiceBlob(blob, duration);
      var url = await blobToDataURL(blob);
      var audio = document.getElementById("voicePreview");
      if (audio) { audio.hidden = false; audio.src = url; }
      saveDraft({ voice: { status: quality.passed ? "已录制，请先试听" : "检测未通过，请重新录制", url: url, duration: quality.duration, confirmed: false, listened: false, uploaded: false, uploadedAt: "", mimeType: blob.type, size: blob.size, quality: quality } });
      setVoiceState(quality.passed ? "已录制，待确认" : "检测未通过", quality.duration);
      document.body.classList.remove("voice-recording-active");
      render(3);
    };
    recordStartedAt = Date.now();
    recorder.start();
    document.body.classList.add("voice-recording-active");
    setRecordingUi(true);
    setVoiceState("正在录音", 0);
    clearInterval(recordTimer);
    recordTimer = setInterval(function () {
      var sec = Math.round((Date.now() - recordStartedAt) / 1000);
      setVoiceState("正在录音", sec);
      if (sec >= MAX_VOICE_SECONDS && recorder && recorder.state === "recording") stopRecording();
    }, 500);
  }
  function stopRecording() {
    clearInterval(recordTimer);
    document.body.classList.remove("voice-recording-active");
    if (recorder && recorder.state === "recording") recorder.stop();
    else setRecordingUi(false);
  }
  function clearVoiceRecording() {
    clearInterval(recordTimer);
    document.body.classList.remove("voice-recording-active");
    if (recorder && recorder.state === "recording") {
      suppressVoiceSave = true;
      recorder.stop();
    }
    chunks = [];
    var draft = readDraft();
    draft.voice = { status: "尚未录制" };
    writeRaw(DRAFT_KEY, draft);
    var db = readDB();
    var app = (db.companionApplications || []).find(function (a) { return a.applicantId === applicantId(); });
    if (app && app.status !== "approved") {
      app.voice = { status: "尚未录制" };
      writeDB(db);
      syncPlatform(db);
    }
    recorder = null;
    render(3);
  }
  function confirmVoice() {
    var d = readDraft();
    var duration = Number((d.voice || {}).duration || 0);
    if (duration < MIN_VOICE_SECONDS) { alert("试音不能少于 10 秒，请重新录制。"); return; }
    if (!((d.voice || {}).listened)) { alert("请先播放完整试听，再确认使用。"); return; }
    var q = (d.voice || {}).quality || {};
    if (!q.volumeOk || !q.durationOk || !q.notBlank) { alert("录音质量检测未通过，请重新录制。"); return; }
    d.voice.status = "已确认";
    d.voice.confirmed = true;
    d.voice.confirmedAt = now();
    d.voice.uploaded = true;
    d.voice.uploadedAt = now();
    writeRaw(DRAFT_KEY, d);
    var db = readDB();
    var app = (db.companionApplications || []).find(function (a) { return a.applicantId === applicantId(); });
    if (app && app.status !== "approved") {
      app.voice = d.voice;
      writeDB(db);
      syncPlatform(db);
    }
    setVoiceState("已确认", duration);
    render(3);
  }
  function clearUpload(key) {
    var draft = readDraft();
    draft.uploads = draft.uploads || {};
    draft.identity = draft.identity || {};
    delete draft.uploads[key];
    delete draft.identity[key];
    writeRaw(DRAFT_KEY, draft);
    render(Number(document.getElementById("companionApplyRoot").dataset.step || 0));
  }
  function bind() {
    var root = document.getElementById("companionApplyRoot");
    if (!root) return;
    document.addEventListener("click", async function (e) {
      var stepBtn = e.target.closest("[data-apply-step]");
      if (stepBtn) {
        e.preventDefault();
        var targetStep = Number(stepBtn.dataset.applyStep);
        if (targetStep > 0 && !(readDraft().rulesAgreement || {}).accepted) { alert("请先阅读并同意陪玩制度"); return; }
        await collect(root);
        render(targetStep);
        return;
      }
      if (e.target.closest("[data-apply-next]")) { e.preventDefault(); if (Number(root.dataset.step || 0) === 0 && !(readDraft().rulesAgreement || {}).accepted) { alert("请先阅读并同意陪玩制度"); return; } await collect(root); var idx = Number(root.dataset.step || 0); if (idx === steps.length - 1) submitApplication(); else render(idx + 1); return; }
      if (e.target.closest("[data-apply-prev]")) { e.preventDefault(); await collect(root); render(Math.max(0, Number(root.dataset.step || 0) - 1)); return; }
      if (e.target.closest("[data-rule-agree]")) {
        var rule = publishedRule();
        if (!rule) return;
        saveDraft({ rulesAgreement: { accepted: e.target.checked, version: rule.version, ruleId: rule.id, agreedAt: e.target.checked ? now() : "", applicantId: applicantId(), device: navigator.userAgent } });
        render(Number(root.dataset.step || 0));
      }
      if (e.target.closest("[data-record-start]")) startRecording();
      if (e.target.closest("[data-record-stop]")) stopRecording();
      if (e.target.closest("[data-record-play]")) {
        var audio = document.getElementById("voicePreview");
        if (audio && audio.src) audio.play();
        else alert("请先完成录音。");
      }
      if (e.target.closest("[data-copy-voice-template]")) {
        var text = document.getElementById("voiceTemplateText");
        if (text && navigator.clipboard) navigator.clipboard.writeText(text.textContent || "");
        alert("试音模板已复制");
      }
      if (e.target.closest("[data-record-reset]")) clearVoiceRecording();
      if (e.target.closest("[data-record-delete]")) clearVoiceRecording();
      if (e.target.closest("[data-record-confirm]")) confirmVoice();
      if (e.target.closest("[data-apply-save]")) { e.preventDefault(); await collect(root); alert("草稿已保存"); return; }
      var addTag = e.target.closest("[data-add-custom-tag]");
      if (addTag) {
        var key = addTag.dataset.addCustomTag;
        var input = document.querySelector('[data-custom-tag-input="' + key + '"]');
        var value = input ? input.value.trim() : "";
        if (!value) return;
        var d = readDraft();
        d.data = d.data || {};
        d.data[key] = Array.isArray(d.data[key]) ? d.data[key] : [];
        var limit = Number((document.querySelector('[data-tag-picker="' + key + '"]') || {}).dataset && document.querySelector('[data-tag-picker="' + key + '"]').dataset.tagLimit || 99);
        if (d.data[key].length >= limit) { alert("最多只能选择 " + limit + " 个标签"); return; }
        if (d.data[key].indexOf(value) < 0) d.data[key].push(value);
        writeRaw(DRAFT_KEY, d);
        render(Number(root.dataset.step || 0));
      }
      if (e.target.closest("[data-copy-nickname]")) {
        var nick = document.querySelector('input[name="gameNickname"]');
        if (nick) navigator.clipboard && navigator.clipboard.writeText(nick.value || "");
      }
      var clear = e.target.closest("[data-clear-upload]");
      if (clear) { e.preventDefault(); e.stopPropagation(); clearUpload(clear.dataset.clearUpload); }
    });
    document.addEventListener("change", async function (e) {
      if (e.target.matches("[data-file-field]")) { await collect(root); render(Number(root.dataset.step || 0)); }
      if (e.target.matches("[data-tag-field]")) {
        var picker = e.target.closest("[data-tag-picker]");
        var limit = Number(picker.dataset.tagLimit || 99);
        var checked = picker.querySelectorAll("[data-tag-field]:checked");
        if (checked.length > limit) {
          e.target.checked = false;
          alert("最多只能选择 " + limit + " 个标签");
          return;
        }
        await collect(root);
        render(Number(root.dataset.step || 0));
      }
    });
    document.addEventListener("input", function () { collect(root); });
    document.addEventListener("ended", function (e) {
      if (e.target && e.target.id === "voicePreview") {
        var draft = readDraft();
        draft.voice = draft.voice || {};
        draft.voice.listened = true;
        draft.voice.status = "已试听，可确认";
        writeRaw(DRAFT_KEY, draft);
        render(3);
      }
    }, true);
  }
  function initHomeEntry() {
    var entry = document.querySelector("[data-companion-entry]");
    if (!entry) return;
    var app = existingApplication();
    if (app && app.status === "approved") {
      entry.href = "companion/index.html";
      entry.innerHTML = '<i>🐱</i><div><strong>陪玩中心</strong><span>进入工作台，开始接单</span></div>';
    }
  }
  function init() {
    ensureDefaultApplicationConfig();
    initHomeEntry();
    if (document.getElementById("companionApplyRoot")) { render(readDraft().step || 0); bind(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
