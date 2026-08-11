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
  var uploadBusy = {};
  var uploadErrors = {};
  /** In-memory only: blob/data previews must NEVER be written to localStorage (QuotaExceeded). */
  var livePreviews = {};
  var liveVoiceBlob = null;
  var liveVoiceObjectUrl = "";

  var steps = [
    "阅读陪玩制度",
    "基本资料",
    "游戏资料",
    "上传头像与资料",
    "认证说明"
  ];
  var stepLabels = [
    "阅读陪玩制度",
    "填写基本资料",
    "填写游戏资料",
    "上传头像与资料",
    "阅读认证说明"
  ];

  var tagGroups = {
    personalTags: {
      "性格": ["随和", "高冷", "活泼", "幽默", "社恐", "社牛", "粘人", "高情商", "氛围感", "耐心", "话多"],
      "陪玩风格": ["娱乐", "上分", "护航", "指挥", "教学", "技术流", "长期搭子", "深夜档", "全天在线"]
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
  function isEphemeralMediaUrl(v) {
    return /^(data:|blob:|filesystem:|file:)/i.test(String(v || "").trim());
  }
  function scrubAssetForStorage(asset) {
    if (!asset) return asset;
    if (typeof asset === "string") {
      return isEphemeralMediaUrl(asset) ? "" : asset;
    }
    if (Array.isArray(asset)) {
      return asset.map(scrubAssetForStorage).filter(function (item) {
        if (!item) return false;
        if (typeof item === "string") return !!item;
        return !!(item.url || item.path || item.id);
      });
    }
    var out = Object.assign({}, asset);
    if (isEphemeralMediaUrl(out.url)) out.url = "";
    if (isEphemeralMediaUrl(out.path)) out.path = "";
    if (isEphemeralMediaUrl(out.preview)) out.preview = "";
    // Keep durable path/url/status only — never persist base64 payloads.
    if (!out.url && !out.path && out.status === "uploading") {
      return { status: "uploading" };
    }
    return out;
  }
  function scrubDraftForStorage(draft) {
    draft = draft && typeof draft === "object" ? draft : {};
    var next = Object.assign({}, draft);
    next.uploads = Object.assign({}, draft.uploads || {});
    // Deprecated card-cover upload removed from step 3/5 — drop from local draft.
    delete next.uploads.cover;
    delete next.uploads.cardCover;
    delete next.uploads.card_cover;
    delete next.uploads.profile_cover;
    Object.keys(next.uploads).forEach(function (key) {
      next.uploads[key] = scrubAssetForStorage(next.uploads[key]);
    });
    next.identity = Object.assign({}, draft.identity || {});
    ["idFront", "idBack", "depositProof", "idHandheld"].forEach(function (key) {
      if (next.identity[key]) next.identity[key] = scrubAssetForStorage(next.identity[key]);
    });
    next.voice = Object.assign({}, draft.voice || {});
    if (isEphemeralMediaUrl(next.voice.url)) {
      next.voice = Object.assign({}, next.voice, { url: "", hasLocal: true });
    }
    if (next.voice.fileUpload) next.voice.fileUpload = scrubAssetForStorage(next.voice.fileUpload);
    return next;
  }
  function writeRaw(key, data) {
    var payload = data || {};
    if (key === DRAFT_KEY) payload = scrubDraftForStorage(payload);
    var text = JSON.stringify(payload);
    try {
      localStorage.setItem(key, text);
    } catch (err) {
      var msg = String((err && err.name) || "") + " " + String((err && err.message) || err || "");
      if (/quota|QuotaExceeded|NS_ERROR_DOM_QUOTA/i.test(msg)) {
        // Last resort: drop ephemeral media leftovers and retry once.
        if (key === DRAFT_KEY) {
          try {
            var lean = scrubDraftForStorage(payload);
            localStorage.setItem(key, JSON.stringify(lean));
            return;
          } catch (e2) {}
        }
        throw new Error(
          "浏览器本地草稿空间已满（不是云端 Storage 配额）。已改为仅保存图片云端地址；请刷新后重新上传头像/相册。"
        );
      }
      throw err;
    }
  }
  function setLivePreview(key, url) {
    if (livePreviews[key] && livePreviews[key] !== url && /^blob:/i.test(livePreviews[key])) {
      try { URL.revokeObjectURL(livePreviews[key]); } catch (e) {}
    }
    if (url) livePreviews[key] = url;
    else delete livePreviews[key];
  }
  function clearLivePreview(key) {
    setLivePreview(key, "");
  }
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
    var draft = Object.assign(
      { step: 0, data: {}, uploads: {}, gameCards: [], voice: {}, rulesAgreement: {} },
      readRaw(DRAFT_KEY)
    );
    // One-time cleanup of legacy base64 drafts that caused QuotaExceededError.
    if (draft.uploads) {
      delete draft.uploads.cover;
      delete draft.uploads.cardCover;
      delete draft.uploads.card_cover;
      delete draft.uploads.profile_cover;
    }
    draft = scrubDraftForStorage(draft);
    // Drop stale hasLocal markers when in-memory blob is gone (refresh / bfcache).
    if (
      draft.voice &&
      draft.voice.hasLocal &&
      !liveVoiceBlob &&
      !liveVoiceObjectUrl &&
      !hasDurableUpload(draft.voice) &&
      !hasDurableUpload(draft.voice.url) &&
      !hasDurableUpload(draft.voice.fileUpload)
    ) {
      draft.voice = Object.assign({}, draft.voice, {
        hasLocal: false,
        listened: false,
        confirmed: false,
        uploaded: false,
        status: draft.voice.status && /失效|尚未/.test(String(draft.voice.status))
          ? draft.voice.status
          : "本地录音已失效，请重新录制",
      });
    }
    return draft;
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
    return names.length ? names : ["甜妹", "御姐", "萝莉音", "少年音", "磁性", "温柔"];
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
      db.voiceTypes = ["甜妹", "御姐", "萝莉音", "少年音", "磁性", "温柔"].map(function (name, index) {
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
  function U() {
    return window.MCJUpload || null;
  }
  function normalizeUploadAsset(value) {
    return U() ? U().normalizeAsset(value) : { url: String(value || ""), path: "", id: "", status: value ? "ok" : "" };
  }
  function assetPreview(value, liveKey) {
    if (liveKey && livePreviews[liveKey]) return livePreviews[liveKey];
    if (value && value.__liveKey && livePreviews[value.__liveKey]) return livePreviews[value.__liveKey];
    return U() ? U().previewSrc(value) : String((value && value.url) || value || "");
  }
  function hasDurableUpload(value) {
    if (U()) return U().hasDurableAsset(value);
    var s = String((value && value.url) || (value && value.path) || value || "").trim();
    return !!s && !/^data:/i.test(s) && !/^blob:/i.test(s);
  }
  function photoListOf(uploads) {
    uploads = uploads || {};
    if (Array.isArray(uploads.photos)) return uploads.photos.filter(Boolean);
    if (Array.isArray(uploads.album)) return uploads.album.filter(Boolean);
    if (uploads.photos) return [uploads.photos];
    return [];
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
      [["rank", "游戏段位"], ["voiceType", "声线"], ["onlineStart", "常在线开始时间"], ["onlineEnd", "常在线结束时间"], ["intro", "自我介绍"]].forEach(function (item) {
        if (!hasText(data, item[0])) missing.push(item[1]);
      });
      return missing;
    }
    if (index === 3) {
      if (!hasDurableUpload(uploads.avatar)) missing.push("头像");
      if (!(voice.confirmed && (hasDurableUpload(voice) || hasDurableUpload(voice.url) || voice.storagePath || voice.path))) {
        missing.push("试音并确认使用");
      }
      return missing;
    }
    if (index === 4) {
      // 申请阶段仅阅读认证说明，不上传身份证/押金，不收集结款资料。
      if (!(draft.authNotice && draft.authNotice.acknowledged)) {
        missing.push("确认已阅读后续认证说明");
      }
      return missing;
    }
    return missing;
  }
  function showMissing(missing) {
    missing = missing && missing.length ? missing : ["请按顺序完成前面的步骤"];
    showApplyTip("请先补充以下内容：\n" + missing.map(function (item) { return "- " + item; }).join("\n"));
  }
  var applyTipTimer = null;
  function showApplyTip(message, tone) {
    tone = tone || "error";
    var text = String(message || "").trim();
    if (!text) return;
    var host = document.getElementById("companionApplyRoot");
    if (!host) {
      try { console.warn("[apply]", text); } catch (e) {}
      return;
    }
    var el = host.querySelector("[data-apply-tip]");
    if (!el) {
      el = document.createElement("div");
      el.className = "apply-tip-banner";
      el.setAttribute("data-apply-tip", "1");
      host.insertBefore(el, host.firstChild);
    }
    el.className = "apply-tip-banner " + (tone === "ok" ? "is-ok" : "is-error");
    el.textContent = text;
    el.hidden = false;
    try { el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e2) {}
    if (applyTipTimer) clearTimeout(applyTipTimer);
    applyTipTimer = setTimeout(function () {
      try { el.hidden = true; } catch (e3) {}
    }, tone === "ok" ? 3200 : 8000);
  }

  var authUi = {
    mode: "register", // register | login
    loginMethod: "password", // password | otp
    emailVerified: false,
    verifiedEmail: "",
    draftEmail: "",
    loginEmail: "",
    registerToken: "",
    cooldownUntil: 0,
    loginCooldownUntil: 0,
    busy: false,
    message: "",
    messageTone: "error",
  };

  function setAuthMessage(msg, tone) {
    authUi.message = String(msg || "");
    authUi.messageTone = tone === "ok" ? "ok" : "error";
  }

  function authCooldownLeft(until) {
    return Math.max(0, Math.ceil((Number(until || 0) - Date.now()) / 1000));
  }

  function authMessageHtml() {
    if (!authUi.message) return '<p class="apply-auth-msg" data-apply-auth-msg hidden></p>';
    return '<p class="apply-auth-msg ' + (authUi.messageTone === "ok" ? "is-ok" : "is-error") + '" data-apply-auth-msg>' + esc(authUi.message) + "</p>";
  }

  function bossAccessToken() {
    try {
      return (
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("mcjAuthAccessToken") ||
        ""
      );
    } catch (e) {
      return "";
    }
  }

  function storageGet(key) {
    try {
      return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
    } catch (e) {
      return "";
    }
  }

  function storageSetBoth(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
    try {
      sessionStorage.setItem(key, value);
    } catch (e2) {}
  }

  function readCompanionSession() {
    try {
      return (
        JSON.parse(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "null") ||
        null
      );
    } catch (e) {
      return null;
    }
  }

  function readAnyRefreshToken(session) {
    var s = session || readCompanionSession() || {};
    var fromSession = String(s.refreshToken || s.refresh_token || "").trim();
    if (fromSession) return fromSession;
    var mirrored = String(storageGet("mcjAuthRefreshToken") || "").trim();
    if (mirrored) return mirrored;
    try {
      var boss = JSON.parse(localStorage.getItem("mcjBossSession") || sessionStorage.getItem("mcjBossSession") || "null") || {};
      var fromBoss = String(boss.refreshToken || boss.refresh_token || "").trim();
      if (fromBoss) return fromBoss;
    } catch (e) {}
    return "";
  }

  function readAnyExpiresAt(session) {
    var s = session || readCompanionSession() || {};
    var fromSession = s.expiresAt != null && s.expiresAt !== "" ? s.expiresAt : s.expires_at;
    if (fromSession != null && fromSession !== "") return fromSession;
    return storageGet("mcjAuthExpiresAt") || "";
  }

  function jwtExpSec(token) {
    try {
      var part = String(token || "").split(".")[1];
      if (!part) return 0;
      var b64 = part.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var payload = JSON.parse(atob(b64));
      return Number(payload && payload.exp) || 0;
    } catch (e) {
      return 0;
    }
  }

  function saveCompanionSession(session) {
    if (!session) return;
    var token = session.token || session.accessToken || session.access_token || "";
    var refreshToken = String(session.refreshToken || session.refresh_token || readAnyRefreshToken(session) || "").trim();
    var expiresAt = session.expiresAt || session.expires_at || readAnyExpiresAt(session) || "";
    if (!expiresAt && token) {
      var exp = jwtExpSec(token);
      if (exp) expiresAt = exp;
    }
    var normalized = {
      token: token,
      accessToken: token,
      refreshToken: refreshToken,
      expiresAt: expiresAt,
      user: session.user || null,
      remember: session.remember !== false,
    };
    var raw = JSON.stringify(normalized);
    try {
      localStorage.setItem("mcjCompanionSession", raw);
    } catch (e) {}
    try {
      sessionStorage.setItem("mcjCompanionSession", raw);
    } catch (e2) {}
    // Mirror shared auth keys so refresh + long apply sessions stay coherent (do not wipe boss).
    try {
      if (normalized.token) storageSetBoth("mcjAuthAccessToken", normalized.token);
      if (normalized.refreshToken) storageSetBoth("mcjAuthRefreshToken", normalized.refreshToken);
      if (normalized.expiresAt !== "" && normalized.expiresAt != null) {
        storageSetBoth("mcjAuthExpiresAt", String(normalized.expiresAt));
      }
    } catch (e3) {}
  }

  function companionToken() {
    var session = readCompanionSession();
    if (!session) return "";
    return String(session.token || session.accessToken || "").trim();
  }

  function clearCompanionAccessOnly() {
    // Drop expired access so auth gate can show; keep draft + refresh attempt already failed.
    try {
      var session = readCompanionSession() || {};
      session.token = "";
      session.accessToken = "";
      var raw = JSON.stringify(session);
      localStorage.setItem("mcjCompanionSession", raw);
      sessionStorage.setItem("mcjCompanionSession", raw);
    } catch (e) {}
  }

  var applyRefreshPromise = null;
  function refreshApplySession() {
    if (applyRefreshPromise) return applyRefreshPromise;
    var session = readCompanionSession() || {};
    var refreshToken = readAnyRefreshToken(session);
    if (!refreshToken) {
      return Promise.reject(new Error("登录状态已过期，请重新登录后继续。"));
    }
    applyRefreshPromise = fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "refresh", refreshToken: refreshToken }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) {
            throw new Error(body.message || "登录状态已过期，请重新登录后继续。");
          }
          var sess = body.session || {};
          saveCompanionSession({
            token: sess.accessToken || sess.token || "",
            accessToken: sess.accessToken || sess.token || "",
            refreshToken: sess.refreshToken || refreshToken,
            expiresAt: sess.expiresAt || sess.expires_at || "",
            user: sess.user || session.user || {},
            remember: session.remember !== false,
          });
          return true;
        });
      })
      .finally(function () {
        applyRefreshPromise = null;
      });
    return applyRefreshPromise;
  }

  function ensureFreshApplySession() {
    var session = readCompanionSession() || {};
    var token = String(session.token || session.accessToken || "").trim();
    if (!token) {
      return Promise.reject(new Error("请先登录或注册陪玩账号后再提交，以便资料同步到后台。"));
    }
    var expRaw = readAnyExpiresAt(session);
    var exp = Number(expRaw) || 0;
    if (exp > 1e12) exp = Math.floor(exp / 1000);
    if (!exp) exp = jwtExpSec(token);
    var nowSec = Math.floor(Date.now() / 1000);
    // Refresh when expired or within 90s of expiry (same policy as companion workbench).
    if (exp && exp <= nowSec + 90) {
      return refreshApplySession().then(function () {
        return readCompanionSession();
      });
    }
    // No expiry metadata but we have a refresh token: still OK to proceed; reactive refresh covers 401.
    return Promise.resolve(session);
  }

  function postCompanion(action, payload, retried) {
    function humanize(msg) {
      var text = String(msg || "").trim();
      if (/invalid JWT|token is expired|unable to parse or verify|jwt|登录态无效|请先登录|登录已过期|refreshToken 已失效/i.test(text)) {
        return "登录状态已过期，请重新登录后继续。";
      }
      if (/invalid input syntax for type uuid|22P02/i.test(text)) {
        return "媒体数据异常，请刷新后重试。";
      }
      if (/HTTP\s*403|HTTP\s*401/i.test(text)) {
        return "登录状态已过期，请重新登录后继续。";
      }
      return text || "提交失败";
    }
    function sendOnce() {
      var token = companionToken();
      if (!token) return Promise.reject(new Error("请先登录或注册陪玩账号后再提交，以便资料同步到后台。"));
      return fetch("/api/companion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-mcj-companion-token": token,
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(Object.assign({ action: action }, payload || {})),
      }).then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) {
            var errMsg = humanize(body.message || "提交失败");
            var err = new Error(errMsg);
            err.status = res.status;
            throw err;
          }
          return body;
        });
      });
    }
    return ensureFreshApplySession()
      .catch(function (freshErr) {
        // If proactive refresh failed, still try once with current token then reactive path.
        if (companionToken()) return null;
        throw freshErr;
      })
      .then(function () {
        return sendOnce().catch(function (err) {
          var errMsg = humanize((err && err.message) || "");
          if (!retried && /登录状态已过期/.test(errMsg)) {
            return refreshApplySession()
              .then(function () {
                return postCompanion(action, payload, true);
              })
              .catch(function (refreshErr) {
                clearCompanionAccessOnly();
                throw new Error(humanize((refreshErr && refreshErr.message) || errMsg));
              });
          }
          throw new Error(errMsg);
        });
      });
  }

  function fetchCompanionBootstrap() {
    function loadOnce() {
      var token = companionToken();
      if (!token) return Promise.resolve(null);
      return fetch("/api/companion?action=bootstrap", {
        headers: {
          Accept: "application/json",
          "x-mcj-companion-token": token,
          Authorization: "Bearer " + token,
        },
        cache: "no-store",
      }).then(function (res) {
        return res.json().then(function (body) {
          if (res.status === 401 || (body && /登录状态已过期|invalid JWT|token is expired/i.test(String(body.message || "")))) {
            var err = new Error(body.message || "登录状态已过期，请重新登录后继续。");
            err.status = 401;
            throw err;
          }
          if (!res.ok || body.ok === false) return null;
          return body.data || body;
        });
      });
    }
    return ensureFreshApplySession()
      .catch(function () {
        return null;
      })
      .then(function () {
        return loadOnce().catch(function (err) {
          if (err && (err.status === 401 || /登录状态已过期|jwt|token is expired/i.test(String(err.message || "")))) {
            return refreshApplySession()
              .then(function () {
                return loadOnce();
              })
              .catch(function () {
                clearCompanionAccessOnly();
                return null;
              });
          }
          return null;
        });
      });
  }

  function authGateHtml() {
    if (companionToken()) return "";
    var bossTok = bossAccessToken();
    var mode = authUi.mode === "login" ? "login" : "register";
    if (bossTok && mode !== "login") {
      // Prefer upgrading the logged-in boss account instead of creating a second Auth user.
      return (
        '<section class="apply-panel apply-auth-gate">' +
        "<h2>使用当前老板账号申请陪玩</h2>" +
        "<p class=\"apply-note\">检测到你已登录老板端。将在<strong>同一 User ID</strong>下开通陪玩资料，不会新建账号，也不会丢失老板订单/充值/聊天。</p>" +
        '<div class="apply-actions apply-auth-actions">' +
        '<button class="apply-btn primary" type="button" data-apply-from-boss' + (authUi.busy ? " disabled" : "") + ">使用当前账号申请陪玩</button>" +
        '<button class="apply-btn" type="button" data-apply-auth-mode="login">改用其他陪玩账号登录</button>' +
        "</div>" +
        authMessageHtml() +
        "</section>"
      );
    }
    var loginMethod = authUi.loginMethod === "otp" ? "otp" : "password";
    var regCooldown = authCooldownLeft(authUi.cooldownUntil);
    var loginCooldown = authCooldownLeft(authUi.loginCooldownUntil);
    var verified = !!authUi.emailVerified && !!authUi.registerToken;
    var tabs =
      '<div class="apply-auth-tabs" role="tablist">' +
      '<button type="button" class="apply-auth-tab' + (mode === "register" ? " active" : "") + '" data-apply-auth-mode="register">注册新陪玩</button>' +
      '<button type="button" class="apply-auth-tab' + (mode === "login" ? " active" : "") + '" data-apply-auth-mode="login">已有账号登录</button>' +
      "</div>";

    var registerPanel =
      '<form class="apply-auth-form" data-apply-auth-form="register" data-apply-auth-panel="register"' + (mode === "register" ? "" : " hidden") + ' autocomplete="on">' +
      '<label class="form-field">昵称<input name="authNickname" type="text" autocomplete="nickname" maxlength="40" placeholder="陪玩昵称" required></label>' +
      '<div class="apply-auth-email-row form-field full">' +
      "<label>邮箱" +
      '<div class="apply-auth-inline">' +
      '<input name="authEmail" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" required value="' + esc(authUi.verifiedEmail || authUi.draftEmail || "") + '"' + (verified ? " readonly" : "") + ">" +
      '<button class="apply-btn apply-auth-send" type="button" data-apply-send-register-otp' + (regCooldown > 0 || verified || authUi.busy ? " disabled" : "") + ">" +
      (verified ? "已验证" : regCooldown > 0 ? regCooldown + "s" : "获取验证码") +
      "</button>" +
      "</div></label></div>" +
      '<label class="form-field full">邮箱验证码' +
      '<div class="apply-auth-inline">' +
      '<input name="authRegisterCode" type="text" inputmode="numeric" autocomplete="one-time-code" data-auth-code="1" data-auth-sensitive="1" maxlength="6" placeholder="6 位验证码" value=""' + (verified ? " disabled" : "") + ">" +
      '<button class="apply-btn" type="button" data-apply-verify-register-otp' + (verified || authUi.busy ? " disabled" : "") + ">验证邮箱</button>" +
      "</div></label>" +
      (verified
        ? '<p class="apply-auth-verified" data-apply-email-verified>邮箱已验证 · ' + esc(authUi.verifiedEmail) + "</p>"
        : '<p class="apply-note full">请先验证邮箱，验证成功后才能设置密码并注册。</p>') +
      '<label class="form-field">密码（至少 8 位）<input name="authPassword" type="password" autocomplete="new-password" minlength="8" required' + (verified ? "" : " disabled") + "></label>" +
      '<label class="form-field">确认密码<input name="authPasswordConfirm" type="password" autocomplete="new-password" minlength="8" required' + (verified ? "" : " disabled") + "></label>" +
      '<div class="apply-actions apply-auth-actions full">' +
      '<button class="apply-btn primary" type="button" data-apply-register' + (!verified || authUi.busy ? " disabled" : "") + ">注册并继续申请</button>" +
      "</div>" +
      authMessageHtml() +
      "</form>";

    var loginTabs =
      '<div class="apply-auth-tabs apply-auth-subtabs" role="tablist">' +
      '<button type="button" class="apply-auth-tab' + (loginMethod === "password" ? " active" : "") + '" data-apply-login-method="password">密码登录</button>' +
      '<button type="button" class="apply-auth-tab' + (loginMethod === "otp" ? " active" : "") + '" data-apply-login-method="otp">验证码登录</button>' +
      "</div>";

    var loginPwd =
      '<form class="apply-auth-form" data-apply-auth-form="login-password" data-apply-auth-panel="login-password"' + (mode === "login" && loginMethod === "password" ? "" : " hidden") + ' autocomplete="on">' +
      '<label class="form-field full">邮箱<input name="authEmail" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" required value="' + esc(authUi.loginEmail || "") + '"></label>' +
      '<label class="form-field full">密码<input name="authPassword" type="password" autocomplete="current-password" data-auth-sensitive="1" required value=""></label>' +
      '<div class="apply-actions apply-auth-actions full"><button class="apply-btn primary" type="button" data-apply-login-password' + (authUi.busy ? " disabled" : "") + ">登录并继续申请</button></div>" +
      "</form>";

    var loginOtp =
      '<form class="apply-auth-form" data-apply-auth-form="login-otp" data-apply-auth-panel="login-otp"' + (mode === "login" && loginMethod === "otp" ? "" : " hidden") + ' autocomplete="on">' +
      '<div class="apply-auth-email-row form-field full">' +
      "<label>邮箱" +
      '<div class="apply-auth-inline">' +
      '<input name="authEmail" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" required value="' + esc(authUi.loginEmail || "") + '">' +
      '<button class="apply-btn apply-auth-send" type="button" data-apply-send-login-otp' + (loginCooldown > 0 || authUi.busy ? " disabled" : "") + ">" +
      (loginCooldown > 0 ? loginCooldown + "s" : "发送验证码") +
      "</button>" +
      "</div></label></div>" +
      '<label class="form-field full">邮箱验证码<input name="authLoginCode" type="text" inputmode="numeric" autocomplete="one-time-code" data-auth-code="1" data-auth-sensitive="1" maxlength="6" placeholder="6 位验证码" required value=""></label>' +
      '<div class="apply-actions apply-auth-actions full"><button class="apply-btn primary" type="button" data-apply-login-otp' + (authUi.busy ? " disabled" : "") + ">验证码登录</button></div>" +
      "</form>";

    return (
      '<section class="apply-panel apply-auth-gate">' +
      "<h2>先创建 / 登录陪玩账号</h2>" +
      "<p>申请资料会写入平台数据库，审核通过后可直接用此邮箱登录陪玩端。MVP 仅支持邮箱验证码，不再使用手机号。</p>" +
      tabs +
      (mode === "register" ? registerPanel : loginTabs + loginPwd + loginOtp + authMessageHtml()) +
      '<p class="apply-note">新用户：邮箱 → 发送验证码 → 验证成功 → 设置密码与昵称 → 注册并进入 1/5 申请流程。</p>' +
      "</section>"
    );
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
    var lockIcon = "🔒";
    return '<div class="apply-mobile-step"><span>第 ' + (index + 1) + ' 步，共 ' + steps.length + ' 步</span><strong>' + esc(stepLabels[index] || steps[index]) + '</strong><small>已完成 ' + doneCount + ' / ' + steps.length + '</small></div>' +
      '<aside class="apply-steps" aria-label="申请流程导航"><div class="apply-progress-head"><strong>申请进度</strong><span>' + doneCount + ' / ' + steps.length + ' · ' + percent + '%</span></div><div class="apply-progress-bar" aria-hidden="true"><i style="width:' + percent + '%"></i></div><div class="apply-step-list">' + steps.map(function (s, i) {
        var done = stepComplete(i, draft);
        var locked = i > reachable;
        var stateText = i === index ? "当前步骤" : done ? "已完成" : locked ? "完成上一步后解锁" : "未完成";
        var stateIcon = done ? "查看" : locked ? lockIcon : "›";
        var numberText = String(i + 1).padStart(2, "0");
        return '<button class="apply-step ' + (i === index ? "active" : "") + (done ? " done" : "") + (locked ? " locked" : "") + '" data-apply-step="' + i + '" type="button" ' + (locked ? 'aria-disabled="true" tabindex="-1"' : "") + '><span class="apply-step-index">' + esc(done ? "✓" : numberText) + '</span><span class="apply-step-copy"><strong>' + esc(stepLabels[i] || s) + '</strong><small>' + esc(stateText) + '</small></span><span class="apply-step-state" aria-hidden="true">' + esc(stateIcon) + '</span></button>';
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
  function fileField(name, label, opts) {
    opts = opts || {};
    var kind = opts.kind || "image";
    var value = opts.value;
    var status = uploadBusy[name] ? "uploading" : uploadErrors[name] ? "error" : "";
    if (!status && hasDurableUpload(value)) status = "ok";
    else if (!status && livePreviews[name]) status = uploadBusy[name] ? "uploading" : "ok";
    var previewValue = livePreviews[name]
      ? { url: livePreviews[name], status: status || "uploading" }
      : value;
    if (!U() || !U().renderCard) {
      return '<label class="form-field upload-field">' + esc(label) + '<input name="' + esc(name) + '" data-file-field type="file" accept="' + esc(opts.accept || "image/jpeg,image/png,image/webp") + '"><span class="upload-card">' + (assetPreview(previewValue, name) ? '<img class="apply-preview" src="' + esc(assetPreview(previewValue, name)) + '" alt="">' : '<span class="upload-plus">＋</span>') + '</span></label>';
    }
    return U().renderCard({
      key: name,
      label: label,
      kind: kind,
      accept: opts.accept || (kind === "audio" ? undefined : "image/jpeg,image/png,image/webp"),
      // 默认不强制相机；仅当 opts.capture === true 时才带 capture
      capture: opts.capture === true,
      multiple: !!opts.multiple,
      value: previewValue,
      status: status,
      error: uploadErrors[name] || "",
      busy: !!uploadBusy[name],
      hint: opts.hint,
    });
  }
  function galleryUploadHtml(uploads) {
    var list = photoListOf(uploads);
    var cards = list.map(function (item, idx) {
      var liveKey = "photos:" + ((item && item.id) || idx);
      var preview = assetPreview(item, liveKey) || assetPreview(item);
      var id = (item && item.id) || idx;
      return '<div class="mcj-upload-preview-wrap apply-gallery-item" data-gallery-item="' + esc(String(id)) + '">' +
        (preview ? '<img class="mcj-upload-preview" src="' + esc(preview) + '" alt="相册">' : "") +
        '<span class="mcj-upload-badge">' + (hasDurableUpload(item) ? "上传成功" : "上传中") + '</span>' +
        '<button type="button" class="mcj-upload-remove" data-clear-gallery="' + esc(String(idx)) + '" aria-label="删除">×</button>' +
        "</div>";
    }).join("");
    var addCard = list.length >= 6
      ? '<p class="apply-note full">相册已达 6 张上限</p>'
      :       fileField("photos", "相册照片（可多张）", {
          multiple: true,
          accept: "image/*",
          hint: "支持 jpg / png / webp，最多 6 张；点击从相册选择或拍照",
          value: null,
        });
    return '<div class="form-field full apply-gallery-block"><span class="mcj-upload-label">相册</span><div class="apply-gallery-grid">' + cards + "</div>" + addCard + "</div>";
  }
  function tagPicker(fieldName, label, selected, groups, limit) {
    selected = Array.isArray(selected) ? selected : [];
    // 全部标签仅可选平台后台预设，禁止申请端自定义新增。
    var body = Object.keys(groups || {}).map(function (group) {
      return '<div class="tag-group"><b>' + esc(group) + '</b><div class="tag-list">' + groups[group].map(function (tag) {
        return '<label class="tag-pill ' + (selected.indexOf(tag) >= 0 ? "checked" : "") + '"><input type="checkbox" data-tag-field="' + esc(fieldName) + '" value="' + esc(tag) + '" ' + (selected.indexOf(tag) >= 0 ? "checked" : "") + '> ' + esc(tag) + '</label>';
      }).join("") + '</div></div>';
    }).join("");
    return '<div class="form-field full tag-picker" data-tag-picker="' + esc(fieldName) + '" data-tag-limit="' + (limit || 99) + '"><span>' + esc(label) + '</span>' + body + '<small>已选择 <em data-tag-count="' + esc(fieldName) + '">' + selected.length + '</em> / ' + (limit || 99) + '（仅可选平台预设标签）</small></div>';
  }

  function rulesHtml(draft) {
    var rule = publishedRule();
    var agreed = draft.rulesAgreement && draft.rulesAgreement.accepted;
    if (!remoteConfigLoaded && !rule) {
      return '<section class="apply-panel apply-rules-card"><h2>阅读陪玩制度</h2><div class="rules-reader"><h3>正在加载制度…</h3><p>正在从后台读取最新陪玩制度，请稍候。</p></div><div class="agree-bar"><label class="agree-row"><input type="checkbox" disabled><span>我已阅读并同意陪玩制度</span></label></div></section>';
    }
    if (!rule) return '<section class="apply-panel apply-rules-card"><h2>阅读陪玩制度</h2><div class="rules-reader"><h3>后台暂未发布陪玩制度</h3><p>请等待超级管理员在「后台中心 → 制度管理」发布陪玩申请制度后再继续申请。</p></div><div class="agree-bar"><label class="agree-row"><input type="checkbox" disabled><span>我已阅读并同意陪玩制度</span></label></div></section>';
    var updated = rule.updatedAt
      ? ('<p class="rules-updated">最后更新：' + esc(formatRulesUpdatedAt(rule.updatedAt)) + (rule.version ? ' · 版本 ' + esc(rule.version) : '') + '</p>')
      : (rule.version ? '<p class="rules-updated">版本 ' + esc(rule.version) + '</p>' : '');
    var extras = '';
    if (rule.notes) extras += '<b>注意事项</b><pre>' + esc(rule.notes) + '</pre>';
    if (rule.penaltyRules) extras += '<b>处罚规则</b><pre>' + esc(rule.penaltyRules) + '</pre>';
    if (rule.depositRules) extras += '<b>退款与押金规则</b><pre>' + esc(rule.depositRules) + '</pre>';
    return '<section class="apply-panel apply-rules-card"><h2>阅读陪玩制度</h2><div class="rules-reader"><h3>' + esc(rule.title) + '</h3><p>' + esc(rule.subtitle || "") + '</p>' + updated + '<pre>' + esc(rule.body || "") + '</pre>' + (extras ? '<div class="rules-extra">' + extras + '</div>' : '') + '</div><div class="agree-bar"><label class="agree-row"><input type="checkbox" data-rule-agree ' + (agreed ? "checked" : "") + '><span>我已阅读并同意陪玩制度</span></label></div></section>';
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
      tagPicker("mainGames", "可接游戏（多选）", data.mainGames, tagGroups.mainGames, 8) +
      tagPicker("positions", "擅长位置（多选）", data.positions, tagGroups.positions, 8) +
      tagPicker("modes", "可提供服务（多选）", data.modes, tagGroups.modes, 2) +
      selectField("rank", "游戏段位", data.rank, rankOptions) +
      selectField("voiceType", "声线", data.voiceType, voiceTypeOptions()) +
      field("onlineStart", "常在线开始时间", "time", data.onlineStart) +
      field("onlineEnd", "常在线结束时间", "time", data.onlineEnd) +
      '<p class="apply-note full">申请阶段无需填写报价。审核通过后，请到陪玩工作台按等级价格区间设置接单价格。</p>' +
      field("intro", "自我介绍", "textarea", data.intro) +
      '</form></section>';
  }
  function uploadHtml(draft) {
    var u = draft.uploads || {};
    return (
      '<section class="apply-panel"><h2>上传头像与资料</h2><form class="apply-grid">' +
      fileField("avatar", "头像", { value: u.avatar, accept: "image/*", hint: "支持 jpg / jpeg / png / webp；可从相册选择或拍照；上传成功后可替换" }) +
      galleryUploadHtml(u) +
      fileField("records", "游戏战绩图", { value: u.records, accept: "image/*", hint: "选填；支持 jpg / png / webp" }) +
      fileField("showcaseVideo", "个人展示视频（可选）", {
        kind: "video",
        value: u.showcaseVideo || null,
        accept: U() && U().VIDEO_ACCEPT ? U().VIDEO_ACCEPT : "video/mp4,video/quicktime,.mp4,.mov",
        capture: false,
        hint: "支持 mp4 / mov，最长约 30 秒；选填",
      }) +
      '<p class="apply-note full">头像、相册与试音会上传到云端 Storage。老板大厅卡面统一使用头像/相册。刷新后仍可恢复。</p>' +
      '<p class="apply-note full"><a href="#applyVoicePanel" style="color:#ffd6e8;font-weight:1000">↓ 试音（必填）</a>：支持【现场录音】或【上传已有音频】，请完成其中一种。</p></form></section>' +
      voiceHtml(draft)
    );
  }
  function voiceHtml(draft) {
    var v = draft.voice || {};
    var q = v.quality || {};
    // Local blob lives only in memory — never treat draft.hasLocal alone as playable/uploadable.
    var hasLiveLocal = !!(liveVoiceBlob || liveVoiceObjectUrl);
    var voiceSrc = liveVoiceObjectUrl || (!isEphemeralMediaUrl(v.url) ? v.url : "") || "";
    var hasLocalVoice = hasLiveLocal;
    var staleLocal = !!(v.hasLocal && !hasLiveLocal && !hasDurableUpload(v) && !hasDurableUpload(v.url) && !hasDurableUpload(v.fileUpload));
    var hasVoice = !!(voiceSrc || hasLiveLocal || hasDurableUpload(v) || hasDurableUpload(v.url) || hasDurableUpload(v.fileUpload));
    var uploadedOk = !!(v.uploaded && (hasDurableUpload(v) || hasDurableUpload(v.url) || hasDurableUpload(v.fileUpload)));
    var canConfirm =
      hasLiveLocal &&
      !uploadedOk &&
      !!v.listened &&
      !!q.volumeOk &&
      !!q.durationOk &&
      !!q.notBlank &&
      !uploadBusy.voice;
    var waveform = Array.isArray(q.waveform) && q.waveform.length ? q.waveform : [18, 30, 44, 24, 38, 28, 48];
    var reasons = Array.isArray(q.reasons) ? q.reasons : [];
    var template =
      "大家好，我是" +
      (draft.data.nickname || "你的昵称") +
      "，主玩" +
      (draft.data.mainGames || [draft.data.mainGame || "你的游戏"]).join("、") +
      "，风格偏" +
      (draft.data.personalTags || ["温柔", "娱乐"]).slice(0, 3).join("、") +
      "。我可以陪你上分、娱乐或者聊天，希望能给你带来轻松开心的游戏体验。";
    var statusText = v.status || "尚未录制";
    if (uploadBusy.voice) statusText = "正在上传试音…";
    else if (uploadedOk) statusText = "上传成功 / 已保存";
    else if (staleLocal) statusText = "本地录音已失效，请重新录制";
    else if (uploadErrors.voice) statusText = "上传失败，请重试";

    var fileUploadCard = fileField("voiceFile", "上传已有音频（备用）", {
      kind: "audio",
      value: (draft.voice && draft.voice.fileUpload) || null,
      accept: U() ? U().AUDIO_ACCEPT : "audio/mpeg,audio/mp4,audio/aac,audio/wav,.mp3,.m4a,.aac,.wav",
      capture: false,
      hint: "支持 mp3 / m4a / aac / wav；浏览器不支持录音时可用此方式",
    });

    return (
      '<section class="apply-panel apply-voice-panel" id="applyVoicePanel"><h2>试音（必填）</h2>' +
      '<p class="apply-note">必须完成现场录音或上传已有音频之一。推荐使用现场录音。</p>' +
      '<div class="voice-recorder" data-voice-status="' +
      esc(statusText) +
      '">' +
      '<div class="voice-method-title">方式 A：现场录音</div>' +
      '<div class="voice-stage"><span class="' +
      (hasVoice ? "done" : "active") +
      '">1 录制</span><span class="' +
      (v.listened || uploadedOk ? "done" : hasVoice ? "active" : "") +
      '">2 试听</span><span class="' +
      (uploadedOk || v.confirmed ? "done" : canConfirm ? "active" : "") +
      '">3 确认上传</span></div>' +
      '<div class="voice-status"><strong id="voiceState">' +
      esc(statusText) +
      '</strong><span id="voiceTimer">' +
      esc(v.duration ? v.duration + " 秒" : "00:00") +
      "</span></div>" +
      '<div class="voice-recording-badge" aria-live="polite">● 正在录音</div>' +
      '<div class="voice-wave" id="voiceWave">' +
      waveform
        .map(function (h) {
          return '<i style="height:' + Math.max(12, Math.min(56, Number(h || 18))) + 'px"></i>';
        })
        .join("") +
      "</div>" +
      '<div class="voice-actions">' +
      '<button class="apply-btn primary" type="button" data-record-start>🎤 开始录音</button>' +
      '<button class="apply-btn" type="button" data-record-stop disabled>⏹ 停止录音</button>' +
      '<button class="apply-btn" type="button" data-record-play ' +
      (!hasVoice ? "disabled" : "") +
      ">▶ 播放 / 暂停</button>" +
      '<button class="apply-btn" type="button" data-record-reset ' +
      (!hasVoice ? "disabled" : "") +
      ">🔄 重录</button>" +
      '<button class="apply-btn" type="button" data-record-delete ' +
      (!hasVoice ? "disabled" : "") +
      ">删除</button>" +
      '<button class="apply-btn primary" type="button" data-record-confirm ' +
      (!canConfirm ? "disabled" : "") +
      ' aria-busy="' +
      (uploadBusy.voice ? "true" : "false") +
      '">' +
      (uploadBusy.voice ? "上传中…" : uploadedOk ? "上传成功 / 已保存" : "✅ 确认上传") +
      "</button>" +
      "</div>" +
      (voiceSrc
        ? '<audio id="voicePreview" controls preload="metadata" src="' + esc(voiceSrc) + '"></audio>'
        : '<audio id="voicePreview" controls hidden></audio>') +
      (uploadedOk ? '<p class="pay-success apply-voice-uploaded" role="status">上传成功 / 已保存。可播放；可重录或改用下方上传文件替换。</p>' : "") +
      (uploadErrors.voice
        ? '<p class="voice-errors apply-voice-upload-error" role="alert">上传失败，请重试：' + esc(uploadErrors.voice) + "</p>"
        : "") +
      '<div class="voice-quality"><span class="' +
      (q.durationOk ? "ok" : "bad") +
      '">✔ 时长' +
      (q.durationOk ? "符合" : "需 10~60 秒") +
      '</span><span class="' +
      (q.humanVoice ? "ok" : "bad") +
      '">✔ ' +
      (q.humanVoice ? "检测到人声" : "人声不足") +
      '</span><span class="' +
      (q.volumeOk ? "ok" : "bad") +
      '">✔ 音量' +
      (q.volumeOk ? "正常" : "过低") +
      '</span><span class="' +
      (q.notBlank ? "ok" : "bad") +
      '">✔ ' +
      (q.notBlank ? "无空白录音" : "静音过多") +
      "</span></div>" +
      (reasons.length
        ? '<div class="voice-errors">' +
          reasons
            .map(function (r) {
              return "<p>" + esc(r) + "</p>";
            })
            .join("") +
          "</div>"
        : "") +
      '<div class="voice-tip" data-voice-tip>' +
      (uploadBusy.voice
        ? "试音上传中，请稍候…"
        : uploadedOk
          ? "上传成功 / 已保存到云端。如需更换，请重录并再次确认上传，或使用下方上传已有音频。"
          : staleLocal
            ? "录音仅保存在当前页面。刷新或离开后需重新录制，再点击「确认上传」。"
            : hasVoice
              ? canConfirm
                ? "试听完成，请点击「确认上传」保存到云端。"
                : "请播放完整试听，确认音量和内容正常后再上传。"
              : "点击「开始录音」后允许麦克风权限，录制 10～60 秒自我介绍。") +
      "</div></div>" +
      '<div class="voice-alt-upload"><div class="voice-method-title">方式 B：上传已有音频</div>' +
      '<p class="apply-note">若浏览器不支持录音，或你已有音频文件，可在此上传。</p>' +
      '<div class="apply-grid">' +
      fileUploadCard +
      "</div></div>" +
      '<div class="voice-template-card"><div><h3>不知道说什么？可以参考下面模板。</h3><p id="voiceTemplateText">' +
      esc(template) +
      '</p></div><button class="apply-btn small" type="button" data-copy-voice-template>一键复制模板</button></div>' +
      '<form class="apply-grid">' +
      field("voiceNote", "试音说明", "textarea", (draft.data || {}).voiceNote, 'placeholder="可以简单介绍自己的声音特点、擅长的聊天风格或游戏。"') +
      "</form></section>"
    );
  }
  function depositPayeeHtml(set) {
    var lines = [];
    var payee = set.payeeName || set.accountName || set.receiverName || set.收款户名 || "";
    var account = set.payeeAccount || set.accountNumber || set.receiverAccount || set.收款账号 || "";
    var bank = set.payeeBank || set.bankName || set.收款银行 || "";
    if (payee) lines.push("<li>收款户名：" + esc(payee) + "</li>");
    if (account) lines.push("<li>收款账号：" + esc(account) + "</li>");
    if (bank) lines.push("<li>收款银行 / 渠道：" + esc(bank) + "</li>");
    if (set.payeeNote || set.paymentNote) lines.push("<li>" + esc(set.payeeNote || set.paymentNote) + "</li>");
    return lines.length ? "<ul>" + lines.join("") + "</ul>" : "";
  }
  /** 申请第 5 步：仅认证说明，不收集身份证/押金/结款。 */
  function authNoticeHtml(draft) {
    var ack = !!(draft.authNotice && draft.authNotice.acknowledged);
    return (
      '<section class="apply-panel" id="applyAuthNoticePanel"><h2>认证说明 / 后续认证</h2>' +
      '<div class="apply-subcard">' +
      '<h3>资料审核通过后须完成认证</h3>' +
      '<p class="apply-note full">资料审核通过后，成为陪玩前必须完成以下认证之一：</p>' +
      "<ul>" +
      "<li>① 身份证认证</li>" +
      "<li>② RM100 押金认证</li>" +
      "</ul>" +
      '<p class="apply-note full">二选一完成并经后台审核通过后，方可正式接单。申请阶段无需上传身份证、无需支付押金、无需填写结款账户。</p>' +
      '<p class="apply-note full">审核通过后请登录陪玩端，在「账号中心」完成认证；结款资料请到陪玩端「隐私设置 / 结款资料」自行填写（仅本人与后台可见）。</p>' +
      "</div>" +
      '<div class="agree-bar" style="margin-top:16px">' +
      '<label class="agree-row"><input type="checkbox" data-auth-notice-ack ' +
      (ack ? "checked" : "") +
      "><span>我已阅读并了解：审核通过后需完成身份证或押金认证（二选一）才能接单</span></label>" +
      "</div></section>"
    );
  }
  function stepHtml(index, draft) {
    if (index === 0) return rulesHtml(draft);
    if (index === 1) return basicHtml(draft.data || {});
    if (index === 2) return gameHtml(draft.data || {});
    if (index === 3) return uploadHtml(draft);
    return authNoticeHtml(draft);
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
    else if (/approved|verified|passed/.test(String(code))) tip = "资料已通过。请登录陪玩端完成身份证或押金认证（二选一）后再接单。";
    else if (/rejected/.test(String(code))) tip = "如有疑问请联系平台客服。";
    return '<div class="apply-status-note">当前申请状态：<b>' + esc(statusLabelOf(code)) + '</b>' +
      (reason ? ' · 原因：' + esc(reason) : "") +
      (tip ? '。<span>' + esc(tip) + "</span>" : "。") +
      (/approved|verified|passed/.test(String(code)) ? ' <a class="apply-btn small" href="companion/index.html">进入陪玩端</a>' : "") +
      "</div>";
  }
  function formatRulesUpdatedAt(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) {
      return String(v).replace("T", " ").replace(/\.\d+Z?$/, "").replace(/([+-]\d{2}:\d{2}|Z)$/, "").trim().slice(0, 16);
    }
    function pad(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function preservePageScroll(fn) {
    var y = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    var x = window.scrollX || window.pageXOffset || 0;
    try { fn(); } finally {
      requestAnimationFrame(function () {
        try { window.scrollTo(x, y); } catch (e) {}
        setTimeout(function () {
          try { window.scrollTo(x, y); } catch (e2) {}
        }, 0);
      });
    }
  }
  function syncStepNavOnly(root) {
    if (!root) return;
    var current = root.querySelector(".apply-step.active");
    var list = root.querySelector(".apply-step-list") || root.querySelector(".apply-steps");
    if (!current || !list) return;
    try {
      var left = current.offsetLeft - Math.max(0, (list.clientWidth - current.clientWidth) / 2);
      list.scrollLeft = Math.max(0, left);
    } catch (e) {}
  }
  function render(index, opts) {
    opts = opts || {};
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
    preservePageScroll(function () {
      root.innerHTML = loadingBannerHtml() + statusNotice() + authGateHtml() + '<div class="apply-layout"' + (!companionToken() ? ' hidden' : '') + '>' + stepNav(activeIndex, draft) + '<div>' + stepHtml(activeIndex, draft) + '<div class="step-complete-mark">' + (stepComplete(activeIndex, draft) ? "已完成 ✔" : "未完成 ○") + '</div><div class="apply-actions"><button class="apply-btn" data-apply-prev type="button" ' + (activeIndex === 0 ? "disabled" : "") + '>上一步</button><button class="apply-btn" data-apply-save type="button">保存草稿</button><button class="apply-btn primary" data-apply-next type="button">' + (activeIndex === steps.length - 1 ? "提交审核" : "下一步") + '</button></div><p class="apply-note">每填写一个输入框都会自动保存草稿，刷新网页或返回修改后会自动恢复。</p></div></div>';
      if (opts.alignStepNav) syncStepNavOnly(root);
    });
  }
  function fileToDataURL(file) {
    if (U() && U().readAsDataUrl) return U().readAsDataUrl(file);
    return new Promise(function (resolve, reject) {
      if (!file) return resolve("");
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("读取文件失败")); };
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
    // File uploads are handled immediately by MCJUpload → Storage; do not stash data URLs here.
    Array.prototype.slice.call(root.querySelectorAll("select[name],input[name]:not([type=file]),textarea[name]")).forEach(function (el) {
      if (step === 4) identity[el.name] = el.value.trim ? el.value.trim() : el.value;
    });
    saveDraft({ data: data, identity: identity, uploads: uploads });
  }
  function storagePayloadForSubmit(asset) {
    var a = normalizeUploadAsset(asset);
    function stripStoragePrefix(s) {
      var t = String(s || "").trim();
      if (/^storage:\/\//i.test(t)) return t.replace(/^storage:\/\/[^/]+\//i, "");
      return t;
    }
    if (a.path && !/^https?:\/\//i.test(a.path) && !/^data:/i.test(a.path) && !/^blob:/i.test(a.path)) {
      return stripStoragePrefix(a.path);
    }
    if (a.url && /^storage:\/\//i.test(a.url)) return stripStoragePrefix(a.url);
    if (a.url && /^data:/i.test(a.url)) return a.url;
    // Prefer durable path over ephemeral signed http URL (never submit signed URL alone).
    return stripStoragePrefix(a.path) || "";
  }
  function needsMediaUpload(asset) {
    var a = normalizeUploadAsset(asset);
    return !!(a.url && /^data:/i.test(a.url));
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
  var initLoading = true;
  var initLoadError = "";
  var initStarted = false;
  var SCROLL_KEY = "mcjCompanionApplyScroll.v1";

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
  function saveApplyScroll() {
    try {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY || window.pageYOffset || 0));
    } catch (e) {}
  }
  function restoreApplyScroll() {
    var y = 0;
    try { y = Number(sessionStorage.getItem(SCROLL_KEY) || 0) || 0; } catch (e) { y = 0; }
    if (y <= 0) return;
    requestAnimationFrame(function () {
      try { window.scrollTo(0, y); } catch (e) {}
      setTimeout(function () {
        try { window.scrollTo(0, y); } catch (e2) {}
      }, 40);
    });
  }
  function loadingBannerHtml() {
    if (initLoadError) {
      return '<div class="apply-status-note apply-load-error" role="alert">资料加载失败，请重试 <button type="button" class="apply-btn small" data-apply-retry>重试</button></div>';
    }
    if (initLoading) {
      return '<div class="apply-status-note apply-load-pending" aria-live="polite">正在加载申请资料…</div>';
    }
    return "";
  }
  function loadRemoteApplyConfig() {
    return fetch("/api/platform/content?types=player_rules,voice_types,player_deposit_settings", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        if (!res.ok) throw new Error("制度内容请求失败");
        return res.json().catch(function () { throw new Error("制度内容解析失败"); });
      })
      .then(function (result) {
        var byType = (result && result.byType) || {};
        var rules = byType.player_rules || [];
        var published = rules
          .map(function (item) {
            var d = Object.assign({}, item.published || {}, item.draft || {}, item);
            var body = String(d.body || d.content || "").trim();
            return {
              id: item.id || d.id || "",
              slug: item.slug || d.slug || "",
              title: d.title || item.title || "陪玩制度",
              subtitle: d.subtitle || d.versionNote || "",
              body: body,
              notes: d.notes || "",
              penaltyRules: d.penaltyRules || "",
              depositRules: d.depositRules || "",
              version: d.version || d.versionNote || "1.0",
              status: item.status === "published" || item.enabled !== false || d.enabled !== false ? "published" : "draft",
              enabled: item.enabled !== false,
              sort: Number(d.sort || item.sort || 0),
              forceConfirm: d.forceConfirm === true || d.requiresAck === true,
              updatedAt: item.updated_at || "",
            };
          })
          .filter(function (r) { return r.status === "published" && r.enabled !== false && r.body; });
        function preferApplyRule(list) {
          if (!list.length) return null;
          var bySlug = list.find(function (r) {
            var slug = String(r.slug || "").toLowerCase();
            var id = String(r.id || "");
            return id === "pc-player-rules-default" || slug === "apply-step1" || slug === "apply" || /apply|申请/.test(slug);
          });
          if (bySlug) return bySlug;
          var byTitle = list.find(function (r) {
            var t = String(r.title || "");
            return /陪玩制度|陪玩规则|申请/.test(t) && !/俱乐部等级|平台使用/.test(t);
          });
          if (byTitle) return byTitle;
          var nonBoss = list.filter(function (r) {
            return !r.forceConfirm && !/俱乐部等级|平台使用/.test(String(r.title || ""));
          });
          var pool = nonBoss.length ? nonBoss : list;
          return pool.slice().sort(function (a, b) { return Number(b.sort || 0) - Number(a.sort || 0); })[0] || null;
        }
        var selected = preferApplyRule(published);
        if (selected) {
          remoteRuleCache = selected;
          var agr = (readDraft().rulesAgreement || {});
          if (agr.accepted && (String(agr.ruleId || "") !== String(selected.id) || String(agr.version || "") !== String(selected.version || ""))) {
            saveDraft({
              rulesAgreement: {
                accepted: false,
                version: selected.version,
                ruleId: selected.id,
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
            payeeName: dep.payeeName || dep.accountName || dep.receiverName || "",
            payeeAccount: dep.payeeAccount || dep.accountNumber || dep.receiverAccount || "",
            payeeBank: dep.payeeBank || dep.bankName || "",
            payeeNote: dep.payeeNote || dep.paymentNote || "",
          });
          writeDB(db2);
          syncPlatform(db2);
        }
        remoteConfigLoaded = true;
      });
  }
  function submitApplication() {
    var missing = validateBeforeSubmit();
    if (missing.length) { showApplyTip("还有以下资料没有完成：\n" + missing.join("\n")); return; }
    var draft = readDraft();
    var user = currentUser();
    var uploads = draft.uploads || {};
    var voice = draft.voice || {};
    var mainGames = draft.data.mainGames || [];
    var modes = draft.data.modes || [];
    var chain = Promise.resolve();
    // 申请阶段不再提交身份证/押金/结款；认证在陪玩端完成。
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
    if (needsMediaUpload(uploads.avatar)) {
      chain = chain.then(function () {
        return postCompanion("upload_media", { media_type: "avatar", data_url: normalizeUploadAsset(uploads.avatar).url, filename: "avatar.jpg" });
      });
    }
    var photoList = photoListOf(uploads);
    photoList.slice(0, 6).forEach(function (img) {
      if (!needsMediaUpload(img)) return;
      chain = chain.then(function () {
        return postCompanion("upload_media", { media_type: "gallery", data_url: normalizeUploadAsset(img).url, filename: "gallery.jpg" });
      });
    });
    if (needsMediaUpload(uploads.records)) {
      chain = chain.then(function () {
        return postCompanion("upload_media", { media_type: "gallery", data_url: normalizeUploadAsset(uploads.records).url, filename: "records.jpg" });
      });
    }
    if (needsMediaUpload(voice.url) || (voice.url && /^data:/i.test(String(voice.url)))) {
      chain = chain.then(function () {
        return postCompanion("upload_media", {
          media_type: "voice",
          data_url: voice.url,
          filename: "voice.webm",
          duration_seconds: voice.seconds || voice.duration || null,
        });
      });
    }
    if (needsMediaUpload(uploads.showcaseVideo) || (uploads.showcaseVideo && uploads.showcaseVideo.url && /^data:/i.test(String(uploads.showcaseVideo.url || "")))) {
      chain = chain.then(function () {
        return postCompanion("upload_media", {
          media_type: "video",
          data_url: normalizeUploadAsset(uploads.showcaseVideo).url,
          filename: "showcase.mp4",
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
        // Formal submit: clear editable local draft so it won't look like a parallel draft.
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch (e) { /* ignore */ }
        remoteStatus = { applicationStatus: "pending", rejectReason: "" };
        showSuccess();
      })
      .catch(function (err) {
        showApplyTip(err.message || "提交失败。请先注册/登录陪玩端后再提交申请，以便写入数据库。");
      });
  }
  function showSuccess() {
    var modal = document.createElement("div");
    modal.className = "apply-submit-modal";
    modal.innerHTML = '<div><h2>申请已提交，等待后台审核。</h2><p>当前状态：待审核。你可随时回到本页查看审核进度。</p><div class="apply-actions"><a class="apply-btn" href="companion-apply.html">查看审核进度</a><a class="apply-btn primary" href="index.html">返回首页</a></div></div>';
    document.body.appendChild(modal);
  }
  function hasPlayableVoiceDraft() {
    var v = readDraft().voice || {};
    return !!(liveVoiceObjectUrl || liveVoiceBlob || hasDurableUpload(v) || hasDurableUpload(v.url) || hasDurableUpload(v.fileUpload));
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
    var del = document.querySelector("[data-record-delete]");
    var hasVoice = hasPlayableVoiceDraft();
    if (start) start.disabled = !!isRecording;
    if (stop) stop.disabled = !isRecording;
    if (play) play.disabled = !!isRecording || !hasVoice;
    if (reset) reset.disabled = !!isRecording || !hasVoice;
    if (del) del.disabled = !!isRecording || !hasVoice;
    if (confirm && isRecording) confirm.disabled = true;
    document.body.classList.toggle("voice-recording-active", !!isRecording);
  }
  async function startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      showApplyTip("当前浏览器不支持网页录音。请改用下方「上传已有音频」，或更换手机 Chrome / Safari 后重试。");
      try {
        document.getElementById("applyVoicePanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {}
      return;
    }
    if (recorder && recorder.state === "recording") return;
    chunks = [];
    suppressVoiceSave = false;
    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      var name = String((e && e.name) || "");
      if (/NotAllowed|PermissionDenied/i.test(name) || /permission|denied|NotAllowed/i.test(String(e && e.message || ""))) {
        showApplyTip("请允许麦克风权限后再录音。可在系统设置 → Safari/Chrome → 麦克风中开启，然后返回本页重试。");
      } else if (/NotFound|DevicesNotFound/i.test(name)) {
        showApplyTip("未检测到麦克风设备。请检查手机麦克风，或改用下方「上传已有音频」。");
      } else {
        showApplyTip("无法开启麦克风：" + (e.message || "请允许麦克风权限后再录音"));
      }
      return;
    }
    recorder = new MediaRecorder(stream, (function () {
      var candidates = ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      for (var i = 0; i < candidates.length; i += 1) {
        try {
          if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])) {
            return { mimeType: candidates[i] };
          }
        } catch (err) {}
      }
      return undefined;
    })());
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = async function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      if (suppressVoiceSave) {
        suppressVoiceSave = false;
        chunks = [];
        return;
      }
      var duration = Math.round((Date.now() - recordStartedAt) / 1000);
      var mime = (recorder && recorder.mimeType) || (chunks[0] && chunks[0].type) || "audio/webm";
      var blob = new Blob(chunks, { type: mime });
      if (!blob.size) {
        saveDraft({ voice: { status: "录音失败（无声音数据），请重录", url: "", duration: duration, confirmed: false, listened: false, uploaded: false, hasLocal: false } });
        setVoiceState("录音失败，请重录", duration);
        document.body.classList.remove("voice-recording-active");
        render(3);
        return;
      }
      var quality = await analyzeVoiceBlob(blob, duration);
      if (liveVoiceObjectUrl) {
        try { URL.revokeObjectURL(liveVoiceObjectUrl); } catch (e) {}
      }
      liveVoiceBlob = blob;
      liveVoiceObjectUrl = URL.createObjectURL(blob);
      // Never persist base64 voice into localStorage (QuotaExceeded on mobile).
      // Replace voice object entirely so stale path/url/bucket from a prior upload cannot
      // short-circuit「确认上传」into a fake local-only success.
      var draftAfterRec = readDraft();
      draftAfterRec.voice = {
        status: quality.passed ? "已录制，请先试听" : "检测未通过，请重新录制",
        url: "",
        path: "",
        bucket: "",
        hasLocal: true,
        duration: quality.duration,
        confirmed: false,
        listened: false,
        uploaded: false,
        uploadedAt: "",
        mimeType: blob.type,
        size: blob.size,
        quality: quality,
      };
      writeRaw(DRAFT_KEY, draftAfterRec);
      setVoiceState(quality.passed ? "已录制，待试听确认" : "检测未通过", quality.duration);
      document.body.classList.remove("voice-recording-active");
      render(3);
      try {
        document.getElementById("applyVoicePanel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (e2) {}
    };
    recordStartedAt = Date.now();
    try { recorder.start(250); } catch (eStart) { recorder.start(); }
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
    liveVoiceBlob = null;
    if (liveVoiceObjectUrl) {
      try { URL.revokeObjectURL(liveVoiceObjectUrl); } catch (e) {}
      liveVoiceObjectUrl = "";
    }
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
    try {
      if (uploadBusy.voice || uploadBusy.voiceFile) {
        showApplyTip("试音正在上传中，请稍候…", "ok");
        return;
      }
      var d = readDraft();
      d.voice = d.voice || {};
      var duration = Number((d.voice || {}).duration || 0);
      if (duration < MIN_VOICE_SECONDS) {
        showApplyTip("试音不能少于 10 秒，请重新录制。");
        return;
      }
      if (!((d.voice || {}).listened)) {
        showApplyTip("请先播放完整试听，再确认使用。");
        return;
      }
      var q = (d.voice || {}).quality || {};
      if (!q.volumeOk || !q.durationOk || !q.notBlank) {
        showApplyTip("录音质量检测未通过，请重新录制。");
        return;
      }
      if (!companionToken()) {
        showApplyTip("请先登录陪玩账号后再上传试音。");
        return;
      }

      var hasLive = !!(liveVoiceBlob || liveVoiceObjectUrl);
      var alreadyDurable = !!(hasDurableUpload(d.voice) || hasDurableUpload(d.voice.url) || hasDurableUpload(d.voice.fileUpload));
      if (alreadyDurable && !hasLive) {
        d.voice.status = "上传成功 / 已保存";
        d.voice.confirmed = true;
        d.voice.confirmedAt = now();
        d.voice.uploaded = true;
        d.voice.uploadedAt = now();
        d.voice.hasLocal = false;
        writeRaw(DRAFT_KEY, d);
        delete uploadErrors.voice;
        showApplyTip("上传成功 / 已保存", "ok");
        render(3);
        return;
      }
      if (!hasLive) {
        d.voice = Object.assign({}, d.voice, {
          hasLocal: false,
          listened: false,
          confirmed: false,
          uploaded: false,
          status: "本地录音已失效，请重新录制",
        });
        writeRaw(DRAFT_KEY, d);
        showApplyTip("本地录音已失效（刷新后需重录）。请重新录制后再点「确认上传」。");
        render(3);
        return;
      }

      function buildVoiceFile(blob) {
        if (!blob || !blob.size) throw new Error("录音文件为空，请重新录制");
        var mime = String((d.voice && d.voice.mimeType) || blob.type || "audio/webm");
        var ext = /mp4|aac|m4a/i.test(mime) ? "m4a" : /ogg/i.test(mime) ? "ogg" : /wav/i.test(mime) ? "wav" : "webm";
        try {
          return new File([blob], "voice-record." + ext, { type: mime });
        } catch (eFile) {
          var fallback = blob;
          try {
            fallback = new Blob([blob], { type: mime });
            fallback.name = "voice-record." + ext;
          } catch (e2) {}
          return fallback;
        }
      }

      uploadBusy.voice = true;
      delete uploadErrors.voice;
      render(3);

      var blobPromise = liveVoiceBlob
        ? Promise.resolve(liveVoiceBlob)
        : fetch(liveVoiceObjectUrl).then(function (r) {
            if (!r.ok) throw new Error("读取本地录音失败");
            return r.blob();
          });

      blobPromise
        .then(function (blob) {
          liveVoiceBlob = blob;
          var file = buildVoiceFile(blob);
          // 与「上传已有音频」共用同一套 handleUploadPick → upload_media 链路。
          return handleUploadPick({
            key: "voiceFile",
            files: [file],
            kind: "audio",
            _fromLiveRecord: true,
            _queued: true,
          }).then(function () {
            return duration;
          });
        })
        .then(function () {
          uploadBusy.voice = false;
          delete uploadErrors.voice;
          delete uploadBusy.voiceFile;
          liveVoiceBlob = null;
          if (liveVoiceObjectUrl) {
            try {
              URL.revokeObjectURL(liveVoiceObjectUrl);
            } catch (e) {}
            liveVoiceObjectUrl = "";
          }
          var next = readDraft();
          var durable =
            hasDurableUpload(next.voice) ||
            hasDurableUpload(next.voice && next.voice.url) ||
            hasDurableUpload(next.voice && next.voice.fileUpload);
          if (!durable) {
            throw new Error("上传未写入云端地址，请重试");
          }
          next.voice = Object.assign({}, next.voice || {}, {
            status: "上传成功 / 已保存",
            confirmed: true,
            confirmedAt: now(),
            uploaded: true,
            uploadedAt: now(),
            hasLocal: false,
            fromFile: false,
            duration: duration,
          });
          writeRaw(DRAFT_KEY, next);
          showApplyTip("上传成功 / 已保存", "ok");
          render(3);
        })
        .catch(function (err) {
          uploadBusy.voice = false;
          delete uploadBusy.voiceFile;
          var msg = (err && err.message) || "上传失败，请重试";
          uploadErrors.voice = msg;
          try {
            console.error("[apply-voice] upload failed", err);
          } catch (e2) {}
          var next = readDraft();
          next.voice = Object.assign({}, next.voice || {}, {
            status: "上传失败，请重试",
            confirmed: false,
            uploaded: false,
          });
          writeRaw(DRAFT_KEY, next);
          showApplyTip("上传失败，请重试：" + msg);
          render(3);
        });
    } catch (err) {
      uploadBusy.voice = false;
      var failMsg = (err && err.message) || "上传失败，请重试";
      uploadErrors.voice = failMsg;
      try {
        console.error("[apply-voice] confirmVoice threw", err);
      } catch (e3) {}
      showApplyTip("上传失败，请重试：" + failMsg);
      try {
        render(3);
      } catch (e4) {}
    }
  }
  function clearUpload(key) {
    var draft = readDraft();
    draft.uploads = draft.uploads || {};
    draft.identity = draft.identity || {};
    draft.voice = draft.voice || {};
    delete uploadErrors[key];
    delete uploadBusy[key];
    clearLivePreview(key);
    var existing = null;
    if (key === "voiceFile") {
      existing = draft.voice.fileUpload;
      delete draft.voice.fileUpload;
      if (draft.voice.fromFile) {
        draft.voice = { status: "尚未录制" };
      }
    } else if (key === "idFront" || key === "idBack" || key === "depositProof" || key === "idHandheld") {
      existing = draft.identity[key];
      delete draft.identity[key];
    } else {
      existing = draft.uploads[key];
      delete draft.uploads[key];
    }
    writeRaw(DRAFT_KEY, draft);
    if (existing && (existing.id || key === "avatar") && companionToken()) {
      var mt =
        key === "avatar"
          ? "avatar"
          : key === "showcaseVideo"
            ? "video"
            : key === "voiceFile"
              ? "voice"
              : "gallery";
      postCompanion("delete_media", {
        media_id: existing.id || "",
        media_type: mt,
        id: existing.id || "",
      }).catch(function () {});
    }
    render(Number(document.getElementById("companionApplyRoot").dataset.step || 0));
  }
  function setUploadAsset(key, asset) {
    var draft = readDraft();
    draft.uploads = draft.uploads || {};
    draft.identity = draft.identity || {};
    draft.voice = draft.voice || {};
    var safe = scrubAssetForStorage(asset);
    if (key === "idFront" || key === "idBack" || key === "depositProof" || key === "idHandheld") {
      draft.identity[key] = safe;
    } else if (key === "voiceFile") {
      draft.voice.fileUpload = safe;
      draft.voice.url = safe.url || draft.voice.url;
      draft.voice.path = safe.path || draft.voice.path;
      draft.voice.confirmed = true;
      draft.voice.listened = true;
      draft.voice.uploaded = true;
      draft.voice.fromFile = true;
      draft.voice.hasLocal = false;
      draft.voice.status = "已确认";
      draft.voice.quality = Object.assign({}, draft.voice.quality || {}, {
        passed: true,
        volumeOk: true,
        durationOk: true,
        notBlank: true,
        humanVoice: true,
        duration: draft.voice.duration || 15,
        reasons: [],
      });
      draft.voice.duration = draft.voice.duration || 15;
    } else if (key === "photos") {
      var list = photoListOf(draft.uploads);
      var dup = list.some(function (p) {
        return (
          (safe.id && p && p.id && String(p.id) === String(safe.id)) ||
          (safe.path && p && p.path && String(p.path) === String(safe.path)) ||
          (safe.url && p && p.url && String(p.url) === String(safe.url) && !/^data:/i.test(String(safe.url)))
        );
      });
      if (dup) return;
      list.push(safe);
      draft.uploads.photos = list.slice(0, 6);
    } else if (key === "cover" || key === "cardCover" || key === "card_cover" || key === "profile_cover") {
      // Cover upload removed — ignore.
      return;
    } else {
      draft.uploads[key] = safe;
    }
    writeRaw(DRAFT_KEY, draft);
  }
  function uploadKeyConfig(key) {
    var map = {
      avatar: { api: "upload_media", mediaType: "avatar", kind: "image" },
      photos: { api: "upload_media", mediaType: "gallery", kind: "image" },
      records: { api: "upload_media", mediaType: "gallery", kind: "image" },
      voiceFile: { api: "upload_media", mediaType: "voice", kind: "audio" },
      showcaseVideo: { api: "upload_media", mediaType: "video", kind: "video" },
      idFront: { api: "upload_private_doc", docType: "id_front", kind: "image" },
      idBack: { api: "upload_private_doc", docType: "id_back", kind: "image" },
      depositProof: { api: "upload_private_doc", docType: "deposit_proof", kind: "image" },
    };
    return map[key] || null;
  }
  function handleUploadPick(payload) {
    var key = payload.key;
    var files = payload.files || [];
    var cfg = uploadKeyConfig(key);
    if (!cfg) {
      if (key === "cover" || key === "cardCover") {
        showApplyTip("卡面封面已取消，请上传头像与相册即可。");
      }
      return Promise.resolve();
    }
    if (!companionToken()) {
      showApplyTip("请先登录或注册陪玩账号后再上传，以便同步到云端存储。");
      return Promise.resolve();
    }
    if (!payload._queued && Object.keys(uploadBusy).some(function (k) { return uploadBusy[k]; })) {
      showApplyTip("请等待当前上传完成");
      return Promise.resolve();
    }
    var file = files[0];
    if (!file) return Promise.resolve();
    var kind = cfg.kind || payload.kind || "image";
    var check = U() ? U().validateFile(file, kind) : { ok: true };
    if (!check.ok) {
      uploadErrors[key] = check.error || "文件格式不支持";
      showApplyTip(uploadErrors[key]);
      render(Number(document.getElementById("companionApplyRoot").dataset.step || 0));
      return Promise.resolve();
    }
    function continueUpload(durationSeconds) {
    if (key === "photos" && photoListOf(readDraft().uploads).length >= 6) {
      showApplyTip("相册最多上传 6 张");
      return Promise.resolve();
    }
    uploadBusy[key] = true;
    delete uploadErrors[key];
    var step = Number(document.getElementById("companionApplyRoot").dataset.step || 0);
    var localPreview = "";
    try {
      localPreview = URL.createObjectURL(file);
      if (key !== "photos") setLivePreview(key, localPreview);
    } catch (e) {
      localPreview = "";
    }
    render(step);
    var prepare =
      kind === "image" && U() && U().compressImageFile
        ? U().compressImageFile(file)
        : fileToDataURL(file);
    return prepare
      .then(function (dataUrl) {
        if (!dataUrl || !/^data:/i.test(String(dataUrl))) {
          throw new Error(kind === "audio" || kind === "video" ? "读取文件失败，请重选后重试" : "读取图片失败，请重选后重试");
        }
        // Do NOT write dataUrl into localStorage — that caused QuotaExceededError on mobile.
        if (key !== "photos") {
          setUploadAsset(key, { url: "", path: "", status: "uploading" });
          render(step);
        }
        var body =
          cfg.api === "upload_private_doc"
            ? { doc_type: cfg.docType, data_url: dataUrl, filename: file.name || cfg.docType + ".jpg" }
            : {
                media_type: cfg.mediaType,
                data_url: dataUrl,
                filename: file.name || (cfg.mediaType === "voice" ? "voice.webm" : cfg.mediaType === "video" ? "showcase.mp4" : cfg.mediaType + ".jpg"),
                content_type: file.type || "",
                duration_seconds:
                  durationSeconds != null
                    ? durationSeconds
                    : cfg.mediaType === "voice"
                      ? Number((readDraft().voice || {}).duration || 0) || undefined
                      : undefined,
              };
        return postCompanion(cfg.api, body);
      })
      .then(function (res) {
        uploadBusy[key] = false;
        delete uploadErrors[key];
        var asset = {
          url: (res && res.url) || (res && res.media && res.media.url) || "",
          path: (res && res.path) || (res && res.media && res.media.path) || "",
          bucket: (res && res.bucket) || (res && res.media && res.media.bucket) || "",
          id: (res && res.media && res.media.id) || "",
          status: "ok",
        };
        if (!asset.url && !asset.path) throw new Error("上传成功但未返回地址，请重新上传");
        if (asset.url && isEphemeralMediaUrl(asset.url) && !asset.path) {
          throw new Error("云端未返回可访问地址，请重新上传");
        }
        // Prefer durable cloud URL for preview; drop temporary blob.
        if (asset.url && !isEphemeralMediaUrl(asset.url)) {
          clearLivePreview(key);
        }
        setUploadAsset(key, asset);
        if (key === "avatar") showApplyTip("头像上传成功");
        render(Number(document.getElementById("companionApplyRoot").dataset.step || 0));
      })
      .catch(function (err) {
        uploadBusy[key] = false;
        var friendly = String(err && err.message || "上传失败");
        if (/quota has been exceeded|QuotaExceeded/i.test(friendly)) {
          friendly =
            "浏览器本地草稿空间已满（不是云端 Storage）。请刷新后重试；图片只会上传到云端，不再写入本地大图。";
        }
        uploadErrors[key] = friendly;
        clearLivePreview(key);
        if (key === "idFront" || key === "idBack" || key === "depositProof") {
          var d = readDraft();
          d.identity = d.identity || {};
          delete d.identity[key];
          writeRaw(DRAFT_KEY, d);
        } else if (key === "voiceFile") {
          var dv = readDraft();
          dv.voice = dv.voice || {};
          delete dv.voice.fileUpload;
          writeRaw(DRAFT_KEY, dv);
        } else if (key !== "photos") {
          var du = readDraft();
          du.uploads = du.uploads || {};
          delete du.uploads[key];
          writeRaw(DRAFT_KEY, du);
        }
        showApplyTip("上传失败：" + friendly);
        render(Number(document.getElementById("companionApplyRoot").dataset.step || 0));
        return Promise.reject(err);
      });
    }
    if (kind === "video") {
      return new Promise(function (resolve) {
        var url = URL.createObjectURL(file);
        var vid = document.createElement("video");
        vid.preload = "metadata";
        vid.onloadedmetadata = function () {
          var dur = Number(vid.duration || 0);
          try { URL.revokeObjectURL(url); } catch (e) {}
          if (dur && dur > 30.5) {
            uploadErrors[key] = "视频最长 30 秒";
            showApplyTip("视频最长 30 秒，请裁剪后再上传");
            resolve(Promise.resolve());
            return;
          }
          resolve(continueUpload(dur || null));
        };
        vid.onerror = function () {
          try { URL.revokeObjectURL(url); } catch (e) {}
          resolve(continueUpload(null));
        };
        vid.src = url;
      });
    }
    return continueUpload(null);
  }
  function handleUploadPickQueue(payload) {
    var files = (payload.files || []).slice();
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain
        .then(function () {
          if (payload.key === "photos" && photoListOf(readDraft().uploads).length >= 6) return null;
          return handleUploadPick({ key: payload.key, files: [file], kind: payload.kind, input: null, _queued: true });
        })
        .catch(function () {
          return null;
        });
    });
    return chain;
  }
  function postAuthJson(action, payload) {
    return fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(Object.assign({ action: action }, payload || {})),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) {
          var err = new Error((body && body.message) || "请求失败");
          err.body = body;
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  function startAuthCooldown(kind, seconds) {
    var until = Date.now() + Math.max(1, Number(seconds) || 60) * 1000;
    if (kind === "login") authUi.loginCooldownUntil = until;
    else authUi.cooldownUntil = until;
    if (authUi._cooldownTimer) {
      try { clearInterval(authUi._cooldownTimer); } catch (e) {}
      authUi._cooldownTimer = null;
    }
    authUi._cooldownTimer = setInterval(function () {
      if (companionToken()) {
        try { clearInterval(authUi._cooldownTimer); } catch (e2) {}
        authUi._cooldownTimer = null;
        return;
      }
      var left = authCooldownLeft(kind === "login" ? authUi.loginCooldownUntil : authUi.cooldownUntil);
      var sel = kind === "login" ? "[data-apply-send-login-otp]" : "[data-apply-send-register-otp]";
      var btn = document.querySelector(sel);
      if (left <= 0) {
        try { clearInterval(authUi._cooldownTimer); } catch (e3) {}
        authUi._cooldownTimer = null;
        if (btn && !authUi.emailVerified) {
          btn.disabled = false;
          btn.textContent = "发送验证码";
        }
        return;
      }
      if (btn && !authUi.emailVerified) {
        btn.disabled = true;
        btn.textContent = left + "s";
      }
    }, 1000);
  }

  async function afterCompanionAuthSuccess(session, email, nickname) {
    // Merge any existing boss/shared refresh token so long apply sessions can auto-refresh.
    var merged = Object.assign({}, session || {});
    if (!merged.refreshToken && !merged.refresh_token) {
      merged.refreshToken = readAnyRefreshToken(merged);
    }
    if (merged.expiresAt == null || merged.expiresAt === "") {
      merged.expiresAt = readAnyExpiresAt(merged);
    }
    saveCompanionSession(merged);
    if (nickname || email) {
      try { saveDraft({ data: { nickname: nickname || "", email: email || "" } }); } catch (e) {}
    }
    setAuthMessage("", "ok");
    authUi.busy = false;
    authUi.emailVerified = false;
    authUi.registerToken = "";
    authUi.cooldownUntil = 0;
    authUi.loginCooldownUntil = 0;
    if (authUi._cooldownTimer) {
      try { clearInterval(authUi._cooldownTimer); } catch (e4) {}
      authUi._cooldownTimer = null;
    }
    // Resume draft progress — never force restart at step 1 after re-login.
    var resumeStep = 0;
    try {
      resumeStep = Math.max(0, Math.min(steps.length - 1, Number(readDraft().step || 0) || 0));
    } catch (eStep) {
      resumeStep = 0;
    }
    var hadProgress = false;
    try {
      var d0 = readDraft();
      hadProgress =
        resumeStep > 0 ||
        !!(d0.rulesAgreement && d0.rulesAgreement.accepted) ||
        !!(d0.data && (d0.data.nickname || d0.data.gender || d0.data.mainGames)) ||
        !!(d0.uploads && (d0.uploads.avatar || (d0.uploads.photos && d0.uploads.photos.length)));
    } catch (eProg) {}
    try {
      render(resumeStep, { alignStepNav: true });
      showApplyTip(
        hadProgress ? "登录成功，已恢复申请草稿进度。" : "登录成功，请继续填写陪玩申请。",
        "ok"
      );
    } catch (renderErr) {
      showApplyTip(renderErr.message || "登录成功，但页面刷新失败，请手动刷新。");
    }
    try {
      var boot = await fetchCompanionBootstrap();
      if (boot && boot.player) {
        remoteStatus = {
          applicationStatus: boot.player.auditStatus || boot.player.applicationStatus || "",
          rejectReason: boot.player.applicationRejectReason || "",
        };
      }
      hydrateUploadsFromBootstrap(boot);
      try {
        resumeStep = Math.max(0, Math.min(steps.length - 1, Number(readDraft().step || resumeStep) || 0));
      } catch (eStep2) {}
      render(resumeStep, { alignStepNav: true });
    } catch (bootErr) {
      try { console.warn("[apply-auth] bootstrap", bootErr); } catch (e5) {}
    }
  }

  function activeAuthForm() {
    if (authUi.mode === "register") return document.querySelector('[data-apply-auth-form="register"]');
    if (authUi.loginMethod === "otp") return document.querySelector('[data-apply-auth-form="login-otp"]');
    return document.querySelector('[data-apply-auth-form="login-password"]');
  }

  function authFormValue(form, name) {
    if (!form) return "";
    var el = form.querySelector('[name="' + name + '"]');
    return el ? String(el.value || "").trim() : "";
  }

  function bind() {
    var root = document.getElementById("companionApplyRoot");
    if (!root) return;
    if (U() && U().bind) {
      U().bind(root, {
        onPick: function (payload) {
          if (payload.key === "photos" && payload.files && payload.files.length > 1) {
            handleUploadPickQueue(payload);
          } else {
            handleUploadPick(payload);
          }
        },
        onClear: function (payload) {
          clearUpload(payload.key);
        },
      });
    }
    if (root.__mcjApplyBound) return;
    root.__mcjApplyBound = true;
    document.addEventListener("click", async function (e) {
      if (!document.getElementById("companionApplyRoot")) return;
      if (e.target.closest("[data-apply-retry]")) {
        e.preventDefault();
        initStarted = false;
        runApplyBootstrap(true);
        return;
      }

      var authModeBtn = e.target.closest("[data-apply-auth-mode]");
      if (authModeBtn) {
        e.preventDefault();
        authUi.mode = authModeBtn.getAttribute("data-apply-auth-mode") === "login" ? "login" : "register";
        setAuthMessage("");
        render(Number(root.dataset.step || 0));
        if (window.MCJAuthShell && window.MCJAuthShell.clearAuthFields) {
          window.MCJAuthShell.clearAuthFields(root, { clearCode: true, clearPassword: true, clearAccount: false });
        }
        return;
      }

      if (e.target.closest("[data-apply-from-boss]")) {
        e.preventDefault();
        var bossTok = bossAccessToken();
        if (!bossTok) {
          setAuthMessage("请先登录老板账号。", "error");
          render(Number(root.dataset.step || 0));
          return;
        }
        authUi.busy = true;
        setAuthMessage("正在当前账号下开通陪玩资料…", "ok");
        render(Number(root.dataset.step || 0));
        var bossRefresh = readAnyRefreshToken();
        var bossExpires = readAnyExpiresAt();
        fetch("/api/companion", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: "Bearer " + bossTok,
            "x-mcj-companion-token": bossTok,
          },
          body: JSON.stringify({
            action: "apply_companion_role",
            refreshToken: bossRefresh,
            expiresAt: bossExpires,
          }),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              if (!res.ok || body.ok === false) throw new Error((body && body.message) || "申请失败");
              return body;
            });
          })
          .then(function (body) {
            var sess = body.session || {
              token: bossTok,
              accessToken: bossTok,
              user: (body.session && body.session.user) || {},
            };
            if (!sess.refreshToken) sess.refreshToken = bossRefresh;
            if (sess.expiresAt == null || sess.expiresAt === "") sess.expiresAt = bossExpires;
            return afterCompanionAuthSuccess(sess, "", "");
          })
          .catch(function (err) {
            authUi.busy = false;
            setAuthMessage(err.message || "申请失败", "error");
            render(Number(root.dataset.step || 0));
          });
        return;
      }
      var loginMethodBtn = e.target.closest("[data-apply-login-method]");
      if (loginMethodBtn) {
        e.preventDefault();
        authUi.loginMethod = loginMethodBtn.getAttribute("data-apply-login-method") === "otp" ? "otp" : "password";
        setAuthMessage("");
        render(Number(root.dataset.step || 0));
        if (window.MCJAuthShell && window.MCJAuthShell.clearAuthFields) {
          window.MCJAuthShell.clearAuthFields(root, { clearCode: true, clearPassword: true, clearAccount: false });
        }
        return;
      }

      if (e.target.closest("[data-apply-send-register-otp]")) {
        e.preventDefault();
        var regForm = document.querySelector('[data-apply-auth-form="register"]');
        var regEmail = authFormValue(regForm, "authEmail").toLowerCase();
        authUi.draftEmail = regEmail;
        if (!regEmail || !/^\S+@\S+\.\S+$/.test(regEmail)) {
          setAuthMessage("请输入有效邮箱。");
          render(Number(root.dataset.step || 0));
          return;
        }
        if (authCooldownLeft(authUi.cooldownUntil) > 0) return;
        authUi.busy = true;
        setAuthMessage("正在发送验证码…", "ok");
        render(Number(root.dataset.step || 0));
        try {
          var sent = await postAuthJson("send_register_otp", { email: regEmail, role: "companion" });
          authUi.busy = false;
          var tip = sent.message || "验证码已发送";
          if (sent.devCode) tip += "（测试 " + sent.devCode + "）";
          setAuthMessage(tip, "ok");
          startAuthCooldown("register", 60);
          render(Number(root.dataset.step || 0));
        } catch (err) {
          authUi.busy = false;
          setAuthMessage(err.message || "发送失败");
          render(Number(root.dataset.step || 0));
        }
        return;
      }

      if (e.target.closest("[data-apply-verify-register-otp]")) {
        e.preventDefault();
        var vForm = document.querySelector('[data-apply-auth-form="register"]');
        var vEmail = authFormValue(vForm, "authEmail").toLowerCase();
        authUi.draftEmail = vEmail;
        var vCode = authFormValue(vForm, "authRegisterCode");
        if (!vEmail || !/^\S+@\S+\.\S+$/.test(vEmail)) {
          setAuthMessage("请输入有效邮箱。");
          render(Number(root.dataset.step || 0));
          return;
        }
        if (!/^\d{6}$/.test(vCode)) {
          setAuthMessage("请输入 6 位邮箱验证码。");
          render(Number(root.dataset.step || 0));
          return;
        }
        authUi.busy = true;
        setAuthMessage("正在验证…", "ok");
        render(Number(root.dataset.step || 0));
        try {
          var verified = await postAuthJson("verify_register_otp", {
            email: vEmail,
            code: vCode,
            role: "companion",
          });
          authUi.busy = false;
          authUi.emailVerified = true;
          authUi.verifiedEmail = vEmail;
          authUi.registerToken = verified.registerToken || "";
          setAuthMessage("邮箱已验证，请设置密码并填写昵称。", "ok");
          render(Number(root.dataset.step || 0));
        } catch (err) {
          authUi.busy = false;
          authUi.emailVerified = false;
          authUi.registerToken = "";
          setAuthMessage(err.message || "验证码错误或已过期");
          render(Number(root.dataset.step || 0));
        }
        return;
      }

      if (e.target.closest("[data-apply-send-login-otp]")) {
        e.preventDefault();
        var loForm = document.querySelector('[data-apply-auth-form="login-otp"]');
        var loEmail = authFormValue(loForm, "authEmail").toLowerCase();
        authUi.loginEmail = loEmail;
        if (!loEmail || !/^\S+@\S+\.\S+$/.test(loEmail)) {
          setAuthMessage("请输入有效邮箱。");
          render(Number(root.dataset.step || 0));
          return;
        }
        if (authCooldownLeft(authUi.loginCooldownUntil) > 0) return;
        authUi.busy = true;
        setAuthMessage("正在发送登录验证码…", "ok");
        render(Number(root.dataset.step || 0));
        try {
          var loginSent = await postAuthJson("send_login_otp", { email: loEmail, role: "companion" });
          authUi.busy = false;
          var loginTip = loginSent.message || "验证码已发送";
          if (loginSent.devCode) loginTip += "（测试 " + loginSent.devCode + "）";
          setAuthMessage(loginTip, "ok");
          startAuthCooldown("login", 60);
          render(Number(root.dataset.step || 0));
        } catch (err) {
          authUi.busy = false;
          setAuthMessage(err.message || "发送失败");
          render(Number(root.dataset.step || 0));
        }
        return;
      }

      if (e.target.closest("[data-apply-register]")) {
        e.preventDefault();
        var rForm = document.querySelector('[data-apply-auth-form="register"]');
        if (!rForm) return;
        var rEmail = (authUi.verifiedEmail || authFormValue(rForm, "authEmail")).toLowerCase();
        var rPassword = authFormValue(rForm, "authPassword");
        var rConfirm = authFormValue(rForm, "authPasswordConfirm");
        var rNickname = authFormValue(rForm, "authNickname");
        if (!authUi.emailVerified || !authUi.registerToken) {
          setAuthMessage("请先完成邮箱验证。");
          render(Number(root.dataset.step || 0));
          return;
        }
        if (!rEmail || !/^\S+@\S+\.\S+$/.test(rEmail)) {
          setAuthMessage("请输入有效邮箱。");
          render(Number(root.dataset.step || 0));
          return;
        }
        if (!rPassword || rPassword.length < 8 || !/[A-Za-z]/.test(rPassword) || !/\d/.test(rPassword)) {
          setAuthMessage("密码至少 8 位，且需同时包含字母和数字。");
          render(Number(root.dataset.step || 0));
          return;
        }
        if (rPassword !== rConfirm) {
          setAuthMessage("两次输入的密码不一致。");
          render(Number(root.dataset.step || 0));
          return;
        }
        if (!rNickname) {
          setAuthMessage("请填写昵称。");
          render(Number(root.dataset.step || 0));
          return;
        }
        authUi.busy = true;
        setAuthMessage("正在注册…", "ok");
        render(Number(root.dataset.step || 0));
        try {
          var regRes = await fetch("/api/companion", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              action: "register",
              email: rEmail,
              account: rEmail,
              password: rPassword,
              confirmPassword: rConfirm,
              nickname: rNickname,
              registerToken: authUi.registerToken,
              remember: true,
            }),
          });
          var regBody = await regRes.json().catch(function () { return {}; });
          if (!regRes.ok || regBody.ok === false) throw new Error(regBody.message || "注册失败");
          await afterCompanionAuthSuccess(regBody.session, rEmail, rNickname);
        } catch (err) {
          authUi.busy = false;
          setAuthMessage(err.message || "注册失败");
          render(Number(root.dataset.step || 0));
        }
        return;
      }

      if (e.target.closest("[data-apply-login-password]")) {
        e.preventDefault();
        var pForm = document.querySelector('[data-apply-auth-form="login-password"]');
        var pEmail = authFormValue(pForm, "authEmail").toLowerCase();
        authUi.loginEmail = pEmail;
        var pPassword = authFormValue(pForm, "authPassword");
        if (!pEmail || !/^\S+@\S+\.\S+$/.test(pEmail)) {
          setAuthMessage("请输入有效邮箱。");
          render(Number(root.dataset.step || 0));
          return;
        }
        if (!pPassword) {
          setAuthMessage("请填写密码。");
          render(Number(root.dataset.step || 0));
          return;
        }
        authUi.busy = true;
        setAuthMessage("正在登录…", "ok");
        render(Number(root.dataset.step || 0));
        try {
          var pwdRes = await fetch("/api/companion", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              action: "login",
              email: pEmail,
              account: pEmail,
              password: pPassword,
              remember: true,
            }),
          });
          var pwdBody = await pwdRes.json().catch(function () { return {}; });
          if (!pwdRes.ok || pwdBody.ok === false) throw new Error(pwdBody.message || "登录失败");
          await afterCompanionAuthSuccess(pwdBody.session, pEmail, "");
        } catch (err) {
          authUi.busy = false;
          setAuthMessage(err.message || "登录失败");
          render(Number(root.dataset.step || 0));
        }
        return;
      }

      if (e.target.closest("[data-apply-login-otp]")) {
        e.preventDefault();
        var oForm = document.querySelector('[data-apply-auth-form="login-otp"]');
        var oEmail = authFormValue(oForm, "authEmail").toLowerCase();
        authUi.loginEmail = oEmail;
        var oCode = authFormValue(oForm, "authLoginCode");
        if (!oEmail || !/^\S+@\S+\.\S+$/.test(oEmail)) {
          setAuthMessage("请输入有效邮箱。");
          render(Number(root.dataset.step || 0));
          return;
        }
        if (!/^\d{6}$/.test(oCode)) {
          setAuthMessage("请输入 6 位邮箱验证码。");
          render(Number(root.dataset.step || 0));
          return;
        }
        authUi.busy = true;
        setAuthMessage("正在登录…", "ok");
        render(Number(root.dataset.step || 0));
        try {
          var otpBody = await postAuthJson("login_with_otp", {
            email: oEmail,
            code: oCode,
            role: "companion",
          });
          var session = otpBody.session || {};
          await afterCompanionAuthSuccess(
            {
              token: session.accessToken || session.token || "",
              accessToken: session.accessToken || session.token || "",
              refreshToken: session.refreshToken || "",
              expiresAt: session.expiresAt || "",
              user: session.user || null,
              remember: true,
            },
            oEmail,
            ""
          );
        } catch (err) {
          authUi.busy = false;
          setAuthMessage(err.message || "验证码无效或已过期");
          render(Number(root.dataset.step || 0));
        }
        return;
      }

      // legacy hooks removed — use dedicated password/otp buttons above
      if (e.target.closest("[data-apply-login]") || e.target.closest("[data-apply-register]")) {
        e.preventDefault();
        return;
      }
      var stepBtn = e.target.closest("[data-apply-step]");
      if (stepBtn) {
        e.preventDefault();
        var targetStep = Number(stepBtn.dataset.applyStep);
        await collect(root);
        var draftAfterClick = readDraft();
        if (targetStep > maxReachableStep(draftAfterClick)) { showMissing(missingForStep(Number(root.dataset.step || 0), draftAfterClick)); return; }
        render(targetStep, { alignStepNav: true });
        return;
      }
      if (e.target.closest("[data-apply-next]")) { e.preventDefault(); await collect(root); var idx = Number(root.dataset.step || 0); var missing = missingForStep(idx, readDraft()); if (missing.length) { showMissing(missing); return; } if (idx === steps.length - 1) submitApplication(); else render(idx + 1, { alignStepNav: true }); return; }
      if (e.target.closest("[data-apply-prev]")) { e.preventDefault(); await collect(root); render(Math.max(0, Number(root.dataset.step || 0) - 1), { alignStepNav: true }); return; }
      if (e.target.closest("[data-rule-agree]")) {
        var rule = publishedRule();
        if (!rule) return;
        saveDraft({ rulesAgreement: { accepted: e.target.checked, version: rule.version, ruleId: rule.id, agreedAt: e.target.checked ? now() : "", applicantId: applicantId(), device: navigator.userAgent } });
        var mark = root.querySelector(".step-complete-mark");
        if (mark) mark.textContent = stepComplete(Number(root.dataset.step || 0), readDraft()) ? "已完成 ✔" : "未完成 ○";
        return;
      }
      if (e.target.closest("[data-record-start]")) startRecording();
      if (e.target.closest("[data-record-stop]")) stopRecording();
      if (e.target.closest("[data-record-play]")) {
        var audio = document.getElementById("voicePreview");
        var playSrc = (audio && audio.src) || liveVoiceObjectUrl || ((readDraft().voice || {}).url || "");
        if (!audio || !playSrc) {
          showApplyTip("请先完成录音。");
          return;
        }
        if (!audio.src || audio.src !== playSrc) {
          audio.hidden = false;
          audio.src = playSrc;
        }
        if (audio.paused) {
          audio.play().catch(function (err) {
            showApplyTip("播放失败：" + ((err && err.message) || "请重试或改用上传已有音频"));
          });
        } else {
          audio.pause();
        }
      }
      if (e.target.closest("[data-copy-voice-template]")) {
        var text = document.getElementById("voiceTemplateText");
        if (text && navigator.clipboard) navigator.clipboard.writeText(text.textContent || "");
        showApplyTip("试音模板已复制", "ok");
      }
      if (e.target.closest("[data-record-reset]")) clearVoiceRecording();
      if (e.target.closest("[data-record-delete]")) clearVoiceRecording();
      if (e.target.closest("[data-record-confirm]")) {
        e.preventDefault();
        var confirmBtn = e.target.closest("[data-record-confirm]");
        if (confirmBtn && confirmBtn.disabled) {
          if (uploadBusy.voice) showApplyTip("试音正在上传中，请稍候…", "ok");
          else showApplyTip("请先完成录音并试听后，再确认上传。");
          return;
        }
        confirmVoice();
        return;
      }
      if (e.target.closest("[data-apply-save]")) { e.preventDefault(); await collect(root); showApplyTip("草稿已保存", "ok"); return; }
      if (e.target.closest("[data-copy-nickname]")) {
        var nick = document.querySelector('input[name="gameNickname"]');
        if (nick) navigator.clipboard && navigator.clipboard.writeText(nick.value || "");
      }
      var clear = e.target.closest("[data-clear-upload]");
      if (clear) { e.preventDefault(); e.stopPropagation(); clearUpload(clear.dataset.clearUpload); }
      var clearGallery = e.target.closest("[data-clear-gallery]");
      if (clearGallery) {
        e.preventDefault();
        e.stopPropagation();
        var gIdx = Number(clearGallery.getAttribute("data-clear-gallery"));
        var gd = readDraft();
        var glist = photoListOf(gd.uploads);
        if (gIdx >= 0 && gIdx < glist.length) {
          var removed = glist[gIdx];
          glist.splice(gIdx, 1);
          gd.uploads = gd.uploads || {};
          gd.uploads.photos = glist;
          writeRaw(DRAFT_KEY, gd);
          render(Number(root.dataset.step || 0));
          if (removed && removed.id && companionToken()) {
            postCompanion("delete_media", { media_id: removed.id, media_type: "gallery" }).catch(function () {});
          }
        }
        return;
      }
    });
    document.addEventListener("change", async function (e) {
      if (e.target && e.target.matches && e.target.matches("[data-auth-notice-ack]")) {
        var curAck = readDraft();
        curAck.authNotice = { acknowledged: !!e.target.checked, acknowledgedAt: e.target.checked ? now() : "" };
        writeRaw(DRAFT_KEY, curAck);
        var markAck = root.querySelector(".step-complete-mark");
        if (markAck) markAck.textContent = stepComplete(Number(root.dataset.step || 0), readDraft()) ? "已完成 ✔" : "未完成 ○";
        return;
      }
      if (e.target.matches("[data-tag-field]")) {
        var picker = e.target.closest("[data-tag-picker]");
        if (!picker || !root.contains(picker)) return;
        var limit = Number(picker.dataset.tagLimit || 99);
        var checked = picker.querySelectorAll("[data-tag-field]:checked");
        if (checked.length > limit) {
          e.target.checked = false;
          showApplyTip("最多只能选择 " + limit + " 个标签");
          return;
        }
        var pill = e.target.closest(".tag-pill");
        if (pill) pill.classList.toggle("checked", !!e.target.checked);
        var countEl = picker.querySelector('[data-tag-count="' + (picker.dataset.tagPicker || "") + '"]');
        if (countEl) countEl.textContent = String(checked.length);
        await collect(root);
        var mark = root.querySelector(".step-complete-mark");
        if (mark) mark.textContent = stepComplete(Number(root.dataset.step || 0), readDraft()) ? "已完成 ✔" : "未完成 ○";
        // Do NOT full re-render — keeps scroll position on mobile.
      }
    });
    document.addEventListener("input", function (e) {
      if (e.target && e.target.closest && e.target.closest("#companionApplyRoot")) collect(root);
    });
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
    document.addEventListener("timeupdate", function (e) {
      if (!(e.target && e.target.id === "voicePreview")) return;
      var a = e.target;
      var dur = Number(a.duration || 0);
      var cur = Number(a.currentTime || 0);
      if (!(dur > 0 && cur / dur >= 0.85) && !(cur >= 8)) return;
      var draft = readDraft();
      if (!draft.voice || draft.voice.listened) return;
      draft.voice.listened = true;
      draft.voice.status = "已试听，可确认";
      writeRaw(DRAFT_KEY, draft);
      render(3);
    }, true);
  }
  function hydrateUploadsFromBootstrap(boot) {
    if (!boot) return;
    var draft = readDraft();
    draft.uploads = draft.uploads || {};
    draft.identity = draft.identity || {};
    draft.voice = draft.voice || {};
    var player = boot.player || {};
    var verification = boot.verification || {};
    var deposit = boot.deposit || {};
    var mediaList = Array.isArray(boot.media) ? boot.media : [];
    var mediaMap = {
      avatarUrl: "",
      coverUrl: "",
      voiceUrl: "",
      videoUrl: "",
      gallery: [],
    };
    mediaList.forEach(function (m) {
      if (!m) return;
      var mt = String(m.mediaType || m.media_type || "").toLowerCase();
      var url = m.url || "";
      if (!url) return;
      var ctype = String(m.contentType || m.content_type || "").toLowerCase();
      var isVideo = mt === "video" || (mt === "gallery" && /^video\//.test(ctype));
      if (mt === "avatar" && !mediaMap.avatarUrl) mediaMap.avatarUrl = url;
      else if (mt === "cover" && !mediaMap.coverUrl) mediaMap.coverUrl = url;
      else if (mt === "voice" && !mediaMap.voiceUrl) mediaMap.voiceUrl = url;
      else if (isVideo && !mediaMap.videoUrl) mediaMap.videoUrl = url;
      else if (mt === "gallery" && !isVideo) mediaMap.gallery.push({ id: m.id || "", url: url, status: "ok" });
    });
    if (boot.media && !Array.isArray(boot.media)) {
      mediaMap.avatarUrl = mediaMap.avatarUrl || boot.media.avatarUrl || "";
      mediaMap.coverUrl = mediaMap.coverUrl || boot.media.coverUrl || "";
      mediaMap.voiceUrl = mediaMap.voiceUrl || boot.media.voiceUrl || "";
      mediaMap.videoUrl = mediaMap.videoUrl || boot.media.videoUrl || "";
      if (Array.isArray(boot.media.gallery)) mediaMap.gallery = boot.media.gallery;
    }
    if (!hasDurableUpload(draft.uploads.avatar) && (mediaMap.avatarUrl || player.avatar)) {
      draft.uploads.avatar = { url: mediaMap.avatarUrl || player.avatar, status: "ok" };
    }
    // Card cover upload removed — do not hydrate into draft.uploads.cover.
    if (!hasDurableUpload(draft.uploads.showcaseVideo) && mediaMap.videoUrl) {
      draft.uploads.showcaseVideo = { url: mediaMap.videoUrl, status: "ok" };
    }
    if (!photoListOf(draft.uploads).length && mediaMap.gallery.length) {
      draft.uploads.photos = mediaMap.gallery;
    }
    if (!hasDurableUpload(draft.voice) && !hasDurableUpload(draft.voice.url) && (mediaMap.voiceUrl || player.voiceUrl)) {
      draft.voice.url = mediaMap.voiceUrl || player.voiceUrl;
      draft.voice.confirmed = true;
      draft.voice.listened = true;
      draft.voice.uploaded = true;
      draft.voice.status = "已确认";
    }
    if (!hasDurableUpload(draft.identity.idFront) && verification.idFrontUrl) {
      draft.identity.idFront = { url: verification.idFrontUrl, path: verification.idFrontPath || "", status: "ok" };
    }
    if (!hasDurableUpload(draft.identity.idBack) && verification.idBackUrl) {
      draft.identity.idBack = { url: verification.idBackUrl, path: verification.idBackPath || "", status: "ok" };
    }
    if (!hasDurableUpload(draft.identity.depositProof) && (deposit.proofUrl || verification.depositProofUrl)) {
      draft.identity.depositProof = {
        url: deposit.proofUrl || verification.depositProofUrl,
        path: deposit.proofPath || "",
        status: "ok",
      };
    }
    writeRaw(DRAFT_KEY, draft);
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
  function applyBootstrap(boot) {
    if (boot && boot.player) {
      remoteStatus = {
        applicationStatus: boot.player.auditStatus || boot.player.applicationStatus || "",
        rejectReason: boot.player.applicationRejectReason || "",
      };
    }
    hydrateUploadsFromBootstrap(boot);
  }
  function hydrateSessionRefreshFromMirrors() {
    // Backfill refreshToken/expiresAt for older companion sessions created via boss upgrade without refresh.
    var session = readCompanionSession();
    if (!session || !(session.token || session.accessToken)) return;
    var refresh = String(session.refreshToken || session.refresh_token || "").trim();
    var exp = session.expiresAt != null && session.expiresAt !== "" ? session.expiresAt : session.expires_at;
    var mirroredRefresh = readAnyRefreshToken(session);
    var mirroredExp = readAnyExpiresAt(session);
    if ((!refresh && mirroredRefresh) || ((exp == null || exp === "") && mirroredExp !== "")) {
      saveCompanionSession({
        token: session.token || session.accessToken || "",
        accessToken: session.token || session.accessToken || "",
        refreshToken: refresh || mirroredRefresh,
        expiresAt: exp != null && exp !== "" ? exp : mirroredExp,
        user: session.user || null,
        remember: session.remember !== false,
      });
    }
  }
  function runApplyBootstrap(force) {
    if (initStarted && !force) return;
    initStarted = true;
    initLoading = true;
    initLoadError = "";
    hydrateSessionRefreshFromMirrors();
    render(readDraft().step || 0);
    bind();
    var taxonomyReady = window.MCJTaxonomy && window.MCJTaxonomy.load
      ? window.MCJTaxonomy.load().then(function () { applyRemoteTaxonomy(); }).catch(function () {})
      : Promise.resolve();
    Promise.all([
      taxonomyReady,
      loadRemoteApplyConfig(),
      fetchCompanionBootstrap(),
    ]).then(function (results) {
      applyBootstrap(results[2]);
      initLoading = false;
      initLoadError = "";
      remoteConfigLoaded = true;
      render(readDraft().step || 0);
      restoreApplyScroll();
    }).catch(function () {
      initLoading = false;
      initLoadError = "资料加载失败，请重试";
      remoteConfigLoaded = true;
      render(readDraft().step || 0);
    });
  }
  function init() {
    if (!document.getElementById("companionApplyRoot")) return;
    ensureDefaultApplicationConfig();
    initHomeEntry();
    // Paint skeleton immediately — never wait for serial API chain.
    initLoading = true;
    initLoadError = "";
    render(readDraft().step || 0);
    bind();
    runApplyBootstrap(false);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  window.addEventListener("pagehide", saveApplyScroll);
  window.addEventListener("pageshow", function (ev) {
    if (ev.persisted) {
      restoreApplyScroll();
      return;
    }
    restoreApplyScroll();
  });
})();





