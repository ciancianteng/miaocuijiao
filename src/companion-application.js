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
  var stepLabels = [
    "阅读陪玩制度",
    "填写基本资料",
    "填写游戏资料",
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
    modes: { "可接模式": [] },
    mainGames: { "主打服务": [] }
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
    if (remoteRuleCache && remoteRuleCache.body) return remoteRuleCache;
    return null;
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
    // 陪玩制度仅以后台 / 数据库为准，不再写入本地写死文案
    if (Array.isArray(db.companionRules) && db.companionRules.some(function (rule) { return String(rule.id || "").indexOf("RULE-DEFAULT") === 0 || rule.updatedBy === "system-default"; })) {
      db.companionRules = (db.companionRules || []).filter(function (rule) {
        return String(rule.id || "").indexOf("RULE-DEFAULT") !== 0 && rule.updatedBy !== "system-default";
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

  function hasText(obj, key) {
    return !!(obj && String(obj[key] == null ? "" : obj[key]).trim());
  }
  function hasArray(obj, key) {
    return !!(obj && Array.isArray(obj[key]) && obj[key].length);
  }
  function missingForStep(index, draft) {
    draft = draft || readDraft();
    var data = draft.data || {};
    var uploads = draft.uploads || {};
    var voice = draft.voice || {};
    var identity = draft.identity || {};
    var missing = [];
    if (index === 0) {
      if (!publishedRule()) missing.push("后台暂未发布陪玩制度");
      if (!((draft.rulesAgreement || {}).accepted)) missing.push("阅读并同意陪玩制度");
      return missing;
    }
    if (index === 1) {
      [["nickname", "昵称"], ["age", "年龄"], ["gender", "性别"], ["region", "地区"], ["phone", "联系电话"], ["email", "邮箱"]].forEach(function (item) {
        if (!hasText(data, item[0])) missing.push(item[1]);
      });
      if (!hasArray(data, "personalTags")) missing.push("个人标签");
      return missing;
    }
    if (index === 2) {
      if (!hasText(data, "gameNickname")) missing.push("游戏昵称");
      if (!hasArray(data, "mainGames")) missing.push("主玩游戏");
      if (!hasArray(data, "positions")) missing.push("擅长位置");
      if (!hasArray(data, "modes")) missing.push("可接模式");
      [["rank", "游戏段位"], ["voiceType", "声音类型"], ["onlineStart", "常在线开始时间"], ["onlineEnd", "常在线结束时间"], ["intro", "自我介绍"]].forEach(function (item) {
        if (!hasText(data, item[0])) missing.push(item[1]);
      });
      if (!hasText(data, "hourlyPrice") && !(data.gamePriceMap && Object.keys(data.gamePriceMap).length)) missing.push("游戏报价");
      return missing;
    }
    if (index === 3) {
      if (!uploads.avatar) missing.push("头像");
      if (!uploads.cover) missing.push("卡面封面");
      if (!voice.confirmed) missing.push("试音并确认使用");
      return missing;
    }
    if (index === 4) {
      if (!identity.idFront) missing.push("证件正面");
      if (!identity.idBack) missing.push("证件背面");
      if (!identity.depositProof) missing.push("押金付款凭证");
      [["settlementMethod", "结款方式"], ["settlementName", "结款户名"], ["settlementAccount", "结款账号"]].forEach(function (item) {
        if (!hasText(identity, item[0])) missing.push(item[1]);
      });
      return missing;
    }
    return missing;
  }
  function showMissing(missing) {
    missing = missing && missing.length ? missing : ["请按顺序完成前面的步骤"];
    alert("请先补充以下内容：\n" + missing.map(function (item) { return "- " + item; }).join("\n"));
  }
  function stepComplete(index, draft) {
    return missingForStep(index, draft).length === 0;
  }

  function maxReachableStep(draft) {
    draft = draft || readDraft();
    var max = 0;
    for (var i = 0; i < steps.length; i++) {
      if (stepComplete(i, draft)) max = Math.min(i + 1, steps.length - 1);
      else break;
    }
    return max;
  }

  function stepNav(index, draft) {
    draft = draft || readDraft();
    var doneCount = steps.filter(function (_, i) { return stepComplete(i, draft); }).length;
    var reachable = maxReachableStep(draft);
    var percent = Math.round((doneCount / steps.length) * 100);
    var lockIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2"/><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M12 14v2"/></svg>';
    return '<div class="apply-mobile-step"><span>第 ' + (index + 1) + ' 步，共 ' + steps.length + ' 步</span><strong>' + esc(stepLabels[index] || steps[index]) + '</strong><small>已完成 ' + doneCount + ' / ' + steps.length + '</small></div>' +
      '<aside class="apply-steps" aria-label="申请流程导航"><div class="apply-progress-head"><strong>申请进度</strong><span>' + doneCount + ' / ' + steps.length + ' · ' + percent + '%</span></div><div class="apply-progress-bar" aria-hidden="true"><i style="width:' + percent + '%"></i></div><div class="apply-step-list">' + steps.map(function (s, i) {
        var done = stepComplete(i, draft);
        var locked = i > reachable;
        var stateText = i === index ? "当前步骤" : done ? "已完成" : locked ? "完成上一步后解锁" : "未完成";
        var stateIcon = done ? "查看" : locked ? lockIcon : "›";
        var numberText = String(i + 1).padStart(2, "0");
        return '<button class="apply-step ' + (i === index ? "active" : "") + (done ? " done" : "") + (locked ? " locked" : "") + '" data-apply-step="' + i + '" type="button" ' + (locked ? 'aria-disabled="true" tabindex="-1"' : "") + '><span class="apply-step-index">' + esc(done ? "✓" : numberText) + '</span><span class="apply-step-copy"><strong>' + esc(stepLabels[i] || s) + '</strong><small>' + esc(stateText) + '</small></span><span class="apply-step-state" aria-hidden="true">' + (locked ? stateIcon : esc(stateIcon)) + '</span></button>';
      }).join("") + '</div></aside>';
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
    if (!remoteConfigLoaded && !rule) {
      return '<section class="apply-panel apply-rules-card"><h2>阅读陪玩制度</h2><div class="rules-reader"><h3>正在加载制度…</h3><p>正在从后台读取最新陪玩制度，请稍候。</p></div><label class="agree-row"><input type="checkbox" disabled> 我已阅读并同意陪玩制度</label></section>';
    }
    if (!rule) return '<section class="apply-panel apply-rules-card"><h2>阅读陪玩制度</h2><div class="rules-reader"><h3>后台暂未发布陪玩制度</h3><p>请等待超级管理员在「后台中心 → 制度管理」发布陪玩申请制度后再继续申请。</p></div><label class="agree-row"><input type="checkbox" disabled> 我已阅读并同意陪玩制度</label></section>';
    var updated = rule.updatedAt ? ('<p class="rules-updated">更新时间：' + esc(rule.updatedAt) + (rule.version ? ' · 版本 ' + esc(rule.version) : '') + '</p>') : (rule.version ? '<p class="rules-updated">版本 ' + esc(rule.version) + '</p>' : '');
    var extras = '';
    if (rule.notes) extras += '<b>注意事项</b><pre>' + esc(rule.notes) + '</pre>';
    if (rule.penaltyRules) extras += '<b>处罚规则</b><pre>' + esc(rule.penaltyRules) + '</pre>';
    if (rule.depositRules) extras += '<b>退款与押金规则</b><pre>' + esc(rule.depositRules) + '</pre>';
    return '<section class="apply-panel apply-rules-card"><h2>阅读陪玩制度</h2><div class="rules-reader"><h3>' + esc(rule.title) + '</h3><p>' + esc(rule.subtitle || "") + '</p>' + updated + '<pre>' + esc(rule.body || "") + '</pre>' + (extras ? '<div class="rules-extra">' + extras + '</div>' : '') + '</div><label class="agree-row"><input type="checkbox" data-rule-agree ' + (agreed ? "checked" : "") + '> 我已阅读并同意陪玩制度</label></section>';
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
    var games = Array.isArray(data.mainGames) ? data.mainGames : [];
    var priceMap = data.gamePriceMap && typeof data.gamePriceMap === "object" ? data.gamePriceMap : {};
    var priceFields = games.length
      ? games.map(function (g) {
          return field("gamePrice__" + g, esc(g) + " 报价（猫粮/小时）", "number", priceMap[g] || data.hourlyPrice || "", 'min="1" step="1" data-game-price="' + esc(g) + '"');
        }).join("")
      : field("hourlyPrice", "默认报价（猫粮/小时）", "number", data.hourlyPrice || "", 'min="1" step="1"');
    return '<section class="apply-panel"><h2>填写游戏资料</h2><form class="apply-grid">' +
      '<label class="form-field">游戏昵称<div class="copy-field"><input name="gameNickname" data-apply-field type="text" value="' + esc(data.gameNickname || "") + '"><button class="apply-btn small" type="button" data-copy-nickname>复制</button></div></label>' +
      tagPicker("mainGames", "可接游戏（多选）", data.mainGames, tagGroups.mainGames, 8) +
      tagPicker("positions", "擅长位置（多选）", data.positions, tagGroups.positions, 8) +
      tagPicker("modes", "可提供服务（多选）", data.modes, tagGroups.modes, 2) +
      selectField("rank", "游戏段位", data.rank, rankOptions) +
      selectField("voiceType", "声音类型", data.voiceType, voiceTypeOptions()) +
      field("onlineStart", "常在线开始时间", "time", data.onlineStart) +
      field("onlineEnd", "常在线结束时间", "time", data.onlineEnd) +
      priceFields +
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
    var code = remoteStatus && remoteStatus.applicationStatus;
    var reason = remoteStatus && remoteStatus.rejectReason;
    var local = existingApplication();
    if (!code && local) code = local.status === "review" ? "pending" : local.status;
    if (!code) return "";
    var tip = "";
    if (/resubmit|need_more/.test(String(code))) tip = "请按审核意见修改后重新提交。";
    else if (/pending|review|submitted/.test(String(code))) tip = "请耐心等待后台审核，可刷新本页查看最新状态。";
    else if (/approved|verified|passed/.test(String(code))) tip = "可前往陪玩端登录；完成身份认证与押金后即可接单。";
    else if (/rejected/.test(String(code))) tip = "如有疑问请联系平台客服。";
    return '<div class="apply-status-note">当前申请状态：<b>' + esc(statusLabelOf(code)) + '</b>' +
      (reason ? ' · 原因：' + esc(reason) : "") +
      (tip ? '。<span>' + esc(tip) + "</span>" : "。") +
      (/approved|verified|passed/.test(String(code)) ? ' <a class="apply-btn small" href="companion/index.html">进入陪玩端</a>' : "") +
      "</div>";
  }
  function authGateHtml() {
    if (companionToken()) return "";
    return '<section class="apply-panel apply-auth-gate"><h2>先创建 / 登录陪玩账号</h2><p>申请资料会写入平台数据库，审核通过后可直接用此账号登录陪玩端。</p><form class="apply-grid" data-apply-auth-form>' +
      field("authEmail", "邮箱", "email", "", 'required autocomplete="username"') +
      field("authPassword", "密码（至少 8 位）", "password", "", 'required minlength="8" autocomplete="new-password"') +
      field("authNickname", "昵称（注册时必填）", "text", "", 'autocomplete="nickname"') +
      field("authPhone", "手机号（选填）", "tel", "") +
      '</form><div class="apply-actions"><button class="apply-btn" type="button" data-apply-login>登录已有账号</button><button class="apply-btn primary" type="button" data-apply-register>注册并继续申请</button></div><p class="apply-note">已有陪玩账号请直接登录；新用户请注册后继续五步申请。</p></section>';
  }
  function render(index) {
    var root = document.getElementById("companionApplyRoot");
    if (!root) return;
    var draft = readDraft();
    var rawIndex = index == null ? draft.step : index;
    var requestedIndex = Math.max(0, Math.min(steps.length - 1, Number(rawIndex || 0)));
    var reachable = maxReachableStep(draft);
    var activeIndex = Math.min(requestedIndex, reachable);
    saveDraft({ step: activeIndex });
    root.dataset.step = String(activeIndex);
    draft = readDraft();
    root.innerHTML = statusNotice() + authGateHtml() + '<div class="apply-layout"' + (!companionToken() ? ' hidden' : '') + '>' + stepNav(activeIndex, draft) + '<div>' + stepHtml(activeIndex, draft) + '<div class="step-complete-mark">' + (stepComplete(activeIndex, draft) ? "已完成 ✔" : "未完成 ○") + '</div><div class="apply-actions"><button class="apply-btn" data-apply-prev type="button" ' + (activeIndex === 0 ? "disabled" : "") + '>上一步</button><button class="apply-btn" data-apply-save type="button">保存草稿</button><button class="apply-btn primary" data-apply-next type="button">' + (activeIndex === steps.length - 1 ? "提交审核" : "下一步") + '</button></div><p class="apply-note">每填写一个输入框都会自动保存草稿，刷新网页或返回修改后会自动恢复。</p></div></div>';
    setTimeout(function () {
      var current = root.querySelector(".apply-step.active");
      if (current && current.scrollIntoView) current.scrollIntoView({ block: "nearest", inline: "center" });
    }, 0);
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
    var priceMap = {};
    Array.prototype.slice.call(root.querySelectorAll("[data-game-price]")).forEach(function (el) {
      var g = el.getAttribute("data-game-price");
      var v = String(el.value || "").trim();
      if (g && v) priceMap[g] = v;
    });
    if (Object.keys(priceMap).length) {
      data.gamePriceMap = priceMap;
      if (!data.hourlyPrice) data.hourlyPrice = priceMap[Object.keys(priceMap)[0]] || "";
    }
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
    var missing = [];
    for (var i = 0; i < steps.length; i++) {
      missingForStep(i, readDraft()).forEach(function (item) {
        missing.push(stepLabels[i] + "：" + item);
      });
    }
    return missing;
  }
  var remoteRuleCache = null;
  var remoteStatus = null;
  var remoteConfigLoaded = false;

  function statusLabelOf(code) {
    var map = {
      pending: "待审核",
      review: "待审核",
      submitted: "待审核",
      resubmit: "需要补资料",
      need_more: "需要补资料",
      approved: "已通过",
      verified: "已通过",
      passed: "已通过",
      rejected: "已拒绝",
    };
    return map[String(code || "").toLowerCase()] || code || "草稿";
  }
  function saveCompanionSession(session) {
    if (!session) return;
    var raw = JSON.stringify(session);
    try { localStorage.setItem("mcjCompanionSession", raw); } catch (e) {}
    try { sessionStorage.setItem("mcjCompanionSession", raw); } catch (e) {}
  }
  function companionToken() {
    try {
      var session = JSON.parse(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "null");
      return session && session.token ? session.token : "";
    } catch (e) {
      return "";
    }
  }
  function postCompanion(action, payload) {
    var token = companionToken();
    if (!token) return Promise.reject(new Error("请先登录或注册陪玩账号后再提交，以便资料同步到后台。"));
    return fetch("/api/companion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-mcj-companion-token": token },
      body: JSON.stringify(Object.assign({ action: action }, payload || {})),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "提交失败");
        return body;
      });
    });
  }
  function fetchCompanionBootstrap() {
    var token = companionToken();
    if (!token) return Promise.resolve(null);
    return fetch("/api/companion?action=bootstrap", {
      headers: { Accept: "application/json", "x-mcj-companion-token": token },
      cache: "no-store",
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) return null;
        return body.data || body;
      });
    }).catch(function () { return null; });
  }
  function loadRemoteApplyConfig() {
    return fetch("/api/platform/content?types=player_rules,voice_types,player_deposit_settings", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (result) {
        var byType = (result && result.byType) || {};
        var rules = byType.player_rules || [];
        var published = rules
          .map(function (item) {
            var d = Object.assign({}, item.published || {}, item.draft || {}, item);
            return {
              id: item.id || d.id || "RULE-REMOTE",
              title: d.title || item.title || "陪玩制度",
              subtitle: d.subtitle || d.versionNote || "",
              body: d.body || d.content || "",
              notes: d.notes || "",
              penaltyRules: d.penaltyRules || "",
              depositRules: d.depositRules || "",
              version: d.version || d.versionNote || "1.0",
              status: item.status === "published" || item.enabled !== false || d.enabled !== false ? "published" : "draft",
              enabled: item.enabled !== false,
              sort: Number(d.sort || item.sort || 0),
              updatedAt: item.updated_at || "",
            };
          })
          .filter(function (r) { return r.status === "published" && r.body; })
          .sort(function (a, b) { return Number(b.sort || 0) - Number(a.sort || 0); });
        if (published[0]) {
          remoteRuleCache = published[0];
          var agr = (readDraft().rulesAgreement || {});
          if (agr.accepted && (String(agr.ruleId || "") !== String(published[0].id) || String(agr.version || "") !== String(published[0].version || ""))) {
            saveDraft({
              rulesAgreement: {
                accepted: false,
                version: published[0].version,
                ruleId: published[0].id,
                agreedAt: "",
                applicantId: applicantId(),
                device: navigator.userAgent,
              },
            });
          }
        } else {
          remoteRuleCache = null;
        }
        var voices = byType.voice_types || [];
        if (voices.length) {
          var db = readDB();
          db.voiceTypes = voices.map(function (item, index) {
            var d = Object.assign({}, item.published || {}, item.draft || {}, item);
            return { id: item.id || "VOICE-" + index, name: d.name || d.title || item.title, sort: Number(d.sort || index + 1), enabled: item.enabled !== false };
          }).filter(function (v) { return v.name; });
          writeDB(db);
        }
        var deposits = byType.player_deposit_settings || [];
        if (deposits[0]) {
          var dep = Object.assign({}, deposits[0].published || {}, deposits[0].draft || {}, deposits[0]);
          var db2 = readDB();
          db2.depositSettings = Object.assign(defaultDeposit(), {
            amount: Number(dep.amount || 100),
            currency: dep.currency || "MYR",
            description: dep.paymentDescription || dep.description || defaultDeposit().description,
            refundRule: dep.refundDescription || dep.refundTerms || defaultDeposit().refundRule,
            methods: Array.isArray(dep.paymentMethod) ? dep.paymentMethod : String(dep.paymentMethod || "TNG,DuitNow,Alipay").split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
          });
          writeDB(db2);
          syncPlatform(db2);
        }
        remoteConfigLoaded = true;
      })
      .catch(function () { remoteConfigLoaded = true; });
  }
  function submitApplication() {
    var missing = validateBeforeSubmit();
    if (missing.length) { alert("还有以下资料没有完成：\n" + missing.join("\n")); return; }
    var draft = readDraft();
    var user = currentUser();
    var identity = draft.identity || {};
    var uploads = draft.uploads || {};
    var voice = draft.voice || {};
    var mainGames = draft.data.mainGames || [];
    var modes = draft.data.modes || [];
    var chain = Promise.resolve();
    chain = chain.then(function () {
      return postCompanion("submit_application", {
        main_service: (mainGames[0] || ""),
        main_game: mainGames.join("、"),
        service_type: modes.join(","),
        rank: draft.data.rank || "",
        position: (draft.data.positions || [])[0] || "",
        voice_type: draft.data.voiceType || "",
        schedule: [draft.data.onlineStart, draft.data.onlineEnd].filter(Boolean).join(" - "),
        note: draft.data.bio || draft.data.remark || draft.data.intro || "",
        tags: (draft.data.personalTags || []).join(","),
        price: draft.data.hourlyPrice || (draft.data.gamePriceMap && draft.data.gamePriceMap[mainGames[0]]) || "",
        game_prices: draft.data.gamePriceMap || {},
        nickname: draft.data.nickname || "",
        age: draft.data.age || "",
        gender: draft.data.gender || "",
        region: draft.data.region || "",
        phone: draft.data.phone || "",
        email: draft.data.email || "",
        contact_public: draft.data.contactPublic || "",
      });
    });
    chain = chain.then(function () {
      return postCompanion("submit_verification", {
        real_name: identity.realName || identity.name || draft.data.realName || user.name || "",
        identity_no: identity.idNumber || identity.identityNo || "",
        id_front: identity.idFront || "",
        id_back: identity.idBack || "",
        id_handheld: identity.idHandheld || "",
        bank_name: identity.settlementBank || identity.bankName || "",
        account_name: identity.settlementName || "",
        bank_account: identity.settlementAccount || "",
        tng_account: identity.tngAccount || "",
        method: identity.settlementMethod || "bank",
        phone: draft.data.phone || "",
      });
    });
    if (uploads.avatar) {
      chain = chain.then(function () {
        return postCompanion("upload_media", { media_type: "avatar", data_url: uploads.avatar, filename: "avatar.jpg" });
      });
    }
    var photoList = [];
    if (Array.isArray(uploads.photos)) photoList = uploads.photos;
    else if (uploads.photos) photoList = [uploads.photos];
    else if (Array.isArray(uploads.album)) photoList = uploads.album;
    photoList.slice(0, 9).forEach(function (img) {
      if (!img) return;
      chain = chain.then(function () {
        return postCompanion("upload_media", { media_type: "gallery", data_url: img.url || img, filename: "gallery.jpg" });
      });
    });
    if (uploads.cover) {
      chain = chain.then(function () {
        return postCompanion("upload_media", { media_type: "gallery", data_url: uploads.cover, filename: "cover.jpg" });
      });
    }
    if (voice.url) {
      chain = chain.then(function () {
        return postCompanion("upload_media", {
          media_type: "voice",
          data_url: voice.url,
          filename: "voice.webm",
          duration_seconds: voice.seconds || voice.duration || null,
        });
      });
    }
    if (identity.depositProof) {
      chain = chain.then(function () {
        return postCompanion("submit_deposit_proof", {
          paid_amount: (depositSettings().amount || 100),
          payment_method: identity.depositMethod || "",
          proof_url: identity.depositProof,
          remark: "陪玩申请一并提交",
        });
      });
    }
    chain
      .then(function () {
        // keep local mirror for progress pages that still read localStorage
        var db = readDB();
        var id = "APP-" + Date.now();
        var app = {
          id: id,
          applicantId: applicantId(),
          accountName: user.name,
          data: draft.data,
          status: "review",
          createdAt: now(),
          synced: true,
        };
        db.companionApplications = (db.companionApplications || []).filter(function (x) { return x.applicantId !== app.applicantId; });
        db.companionApplications.unshift(app);
        writeDB(db);
        syncPlatform(db);
        remoteStatus = { applicationStatus: "pending", rejectReason: "" };
        showSuccess();
      })
      .catch(function (err) {
        alert(err.message || "提交失败。请先注册/登录陪玩端后再提交申请，以便写入数据库。");
      });
  }
  function showSuccess() {
    var modal = document.createElement("div");
    modal.className = "apply-submit-modal";
    modal.innerHTML = '<div><h2>申请已提交，等待后台审核。</h2><p>当前状态：待审核。你可随时回到本页查看审核进度。</p><div class="apply-actions"><a class="apply-btn" href="companion-apply.html">查看审核进度</a><a class="apply-btn primary" href="index.html">返回首页</a></div></div>';
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
      if (e.target.closest("[data-apply-login]") || e.target.closest("[data-apply-register]")) {
        e.preventDefault();
        var form = document.querySelector("[data-apply-auth-form]");
        if (!form) return;
        var email = (form.querySelector('[name="authEmail"]') || {}).value || "";
        var password = (form.querySelector('[name="authPassword"]') || {}).value || "";
        var nickname = (form.querySelector('[name="authNickname"]') || {}).value || "";
        var phone = (form.querySelector('[name="authPhone"]') || {}).value || "";
        var isRegister = !!e.target.closest("[data-apply-register]");
        if (!email || !password) { alert("请填写邮箱和密码"); return; }
        if (isRegister && !nickname) { alert("注册请填写昵称"); return; }
        try {
          var res = await fetch("/api/companion", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              action: isRegister ? "register" : "login",
              email: email,
              account: email,
              password: password,
              nickname: nickname,
              phone: phone,
              remember: true,
            }),
          });
          var body = await res.json().catch(function () { return {}; });
          if (!res.ok || body.ok === false) throw new Error(body.message || "登录失败");
          saveCompanionSession(body.session);
          if (nickname) saveDraft({ data: { nickname: nickname, email: email, phone: phone } });
          var boot = await fetchCompanionBootstrap();
          if (boot && boot.player) {
            remoteStatus = {
              applicationStatus: boot.player.auditStatus || boot.player.applicationStatus || "",
              rejectReason: boot.player.applicationRejectReason || "",
            };
          }
          render(Number(document.getElementById("companionApplyRoot").dataset.step || 0));
        } catch (err) {
          alert(err.message || "操作失败");
        }
        return;
      }
      var stepBtn = e.target.closest("[data-apply-step]");
      if (stepBtn) {
        e.preventDefault();
        var targetStep = Number(stepBtn.dataset.applyStep);
        await collect(root);
        var draftAfterClick = readDraft();
        if (targetStep > maxReachableStep(draftAfterClick)) { showMissing(missingForStep(Number(root.dataset.step || 0), draftAfterClick)); return; }
        render(targetStep);
        return;
      }
      if (e.target.closest("[data-apply-next]")) { e.preventDefault(); await collect(root); var idx = Number(root.dataset.step || 0); var missing = missingForStep(idx, readDraft()); if (missing.length) { showMissing(missing); return; } if (idx === steps.length - 1) submitApplication(); else render(idx + 1); return; }
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
  function applyRemoteTaxonomy() {
    var taxonomy = window.MCJTaxonomy;
    if (!taxonomy || !taxonomy.items) return;
    var applyServices = (taxonomy.items("games") || []).slice();
    if (!applyServices.length) applyServices = (taxonomy.items("services") || []).filter(function (item) {
      var positions = item.displayPositions || [];
      return item.allowApply !== false && positions.indexOf("companion_apply") >= 0;
    });
    var games = applyServices.map(function (item) {
      return taxonomy.label(item);
    }).filter(Boolean);
    var orderServices = ["陪玩服务", "陪聊服务"];
    var tags = taxonomy.items("companion_tags");
    tagGroups.mainGames = { "可接游戏": games };
    tagGroups.modes = { "可提供服务": orderServices };
    if (tags.length) {
      var grouped = {};
      tags.forEach(function (item) {
        var group = item.group || "平台标签";
        var name = taxonomy.label(item);
        if (!name) return;
        grouped[group] = grouped[group] || [];
        if (grouped[group].indexOf(name) < 0) grouped[group].push(name);
      });
      if (Object.keys(grouped).length) tagGroups.personalTags = grouped;
    }
  }
  function init() {
    ensureDefaultApplicationConfig();
    initHomeEntry();
    var start = function () {
      if (!document.getElementById("companionApplyRoot")) return;
      var finish = function () {
        render(readDraft().step || 0);
        bind();
      };
      loadRemoteApplyConfig().then(function () {
        return fetchCompanionBootstrap();
      }).then(function (boot) {
        if (boot && boot.player) {
          remoteStatus = {
            applicationStatus: boot.player.auditStatus || boot.player.applicationStatus || "",
            rejectReason: boot.player.applicationRejectReason || "",
          };
        }
        finish();
      }).catch(finish);
    };
    if (window.MCJTaxonomy && window.MCJTaxonomy.load) {
      window.MCJTaxonomy.load().then(function () { applyRemoteTaxonomy(); start(); }).catch(start);
    } else {
      start();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();





