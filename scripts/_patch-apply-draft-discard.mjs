#!/usr/bin/env node
/**
 * Patch companion-application.js for draft continue/discard gate.
 */
import fs from "node:fs";

const p = "src/companion-application.js";
let s = fs.readFileSync(p, "utf8");
if (s.includes("DRAFT_GATE_SESSION_PREFIX")) {
  console.log("already patched");
  process.exit(0);
}

s = s.replace(
  "var voiceReleaseBound = false;",
  `var voiceReleaseBound = false;
  /** Draft gate: prompt | editing | fresh | submitted | unknown */
  var draftGateMode = "unknown";
  var draftGeneration = 1;
  var suppressEmptyPersist = false;
  var allowServerHydrate = true;
  var lastBootstrapPayload = null;
  var DRAFT_GATE_SESSION_PREFIX = "mcjApplyDraftGate.v1.u:";
  var DRAFT_DISCARD_FLAG_PREFIX = "mcjApplyDraftDiscarded.v1.u:";`
);

const helpers = `
  function bumpDraftGeneration() {
    draftGeneration += 1;
    return draftGeneration;
  }
  function draftGateSessionKey(userId) {
    var id = String(userId || authUserId() || "").trim();
    return id ? DRAFT_GATE_SESSION_PREFIX + id : "";
  }
  function draftDiscardFlagKey(userId) {
    var id = String(userId || authUserId() || "").trim();
    return id ? DRAFT_DISCARD_FLAG_PREFIX + id : "";
  }
  function readDraftGateSession() {
    var key = draftGateSessionKey();
    if (!key) return "";
    try {
      return String(sessionStorage.getItem(key) || "").trim();
    } catch (e) {
      return "";
    }
  }
  function writeDraftGateSession(mode) {
    var key = draftGateSessionKey();
    if (!key) return;
    try {
      if (!mode) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, String(mode));
    } catch (e) {}
  }
  function markDraftDiscardedFlag() {
    var key = draftDiscardFlagKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), generation: draftGeneration }));
    } catch (e) {}
  }
  function clearDraftDiscardedFlag() {
    var key = draftDiscardFlagKey();
    if (!key) return;
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }
  function hasDraftDiscardedFlag() {
    var key = draftDiscardFlagKey();
    if (!key) return false;
    try {
      return !!localStorage.getItem(key);
    } catch (e) {
      return false;
    }
  }
  function isDraftEffectivelyEmpty(draft) {
    draft = draft || {};
    var data = draft.data || {};
    var uploads = draft.uploads || {};
    var identity = draft.identity || {};
    var voice = draft.voice || {};
    var rules = draft.rulesAgreement || {};
    if (draft.submitted || draft.status === "pending" || draft.status === "review") return false;
    if (rules.accepted) return false;
    if (String(draft.certification_method || identity.authMode || "").trim()) return false;
    if (String(data.nickname || data.gender || data.region || data.bio || data.intro || data.gameId || "").trim()) return false;
    if (Array.isArray(data.mainGames) && data.mainGames.length) return false;
    if (Array.isArray(data.modes) && data.modes.length) return false;
    if (Array.isArray(data.personalTags) && data.personalTags.length) return false;
    if (Array.isArray(draft.gameCards) && draft.gameCards.length) return false;
    if (hasDurableUpload(uploads.avatar) || hasDurableUpload(uploads.showcaseVideo) || hasDurableUpload(uploads.records)) return false;
    if (photoListOf(uploads).length) return false;
    if (hasDurableUpload(voice) || hasDurableUpload(voice.url) || hasDurableUpload(voice.fileUpload) || voice.hasLocal || liveVoiceBlob) return false;
    if (hasDurableUpload(identity.idFront) || hasDurableUpload(identity.idBack) || hasDurableUpload(identity.depositProof)) return false;
    if (String(identity.settlementAccount || identity.tngAccount || identity.alipayAccount || identity.realName || "").trim()) return false;
    return true;
  }
  function draftHasMeaningfulContent(draft) {
    return !isDraftEffectivelyEmpty(draft);
  }
  function bootstrapHasDraftContent(boot) {
    if (!boot) return false;
    var player = boot.player || {};
    var st = String(player.auditStatus || player.applicationStatus || "").toLowerCase();
    if (/pending|review|submitted|approved|verified|passed|resubmit|need_more|rejected/.test(st)) return false;
    var media = Array.isArray(boot.media) ? boot.media : [];
    if (media.length) return true;
    if (String(player.voiceUrl || player.avatar || player.bio || player.gameId || "").trim()) return true;
    var verification = boot.verification || {};
    if (verification.idFrontUrl || verification.idBackUrl) return true;
    var deposit = boot.deposit || {};
    if (deposit.proofUrl) return true;
    return false;
  }
  function noteUserEditedDraft() {
    if (!suppressEmptyPersist && draftGateMode !== "fresh") return;
    suppressEmptyPersist = false;
    allowServerHydrate = false;
    clearDraftDiscardedFlag();
    if (draftGateMode === "fresh" || draftGateMode === "prompt") {
      draftGateMode = "editing";
      writeDraftGateSession("continue");
    }
  }
`;

if (!s.includes("function isDraftEffectivelyEmpty")) {
  s = s.replace(
    "  function clearCurrentUserDraft() {\n    var uid = authUserId();\n    if (uid) {\n      try {\n        localStorage.removeItem(draftKeyForUser(uid));\n      } catch (e) {}\n    }\n    purgeUnscopedDraftKeys();\n  }",
    helpers +
      `  function clearCurrentUserDraft() {
    var uid = authUserId();
    if (uid) {
      try {
        localStorage.removeItem(draftKeyForUser(uid));
      } catch (e) {}
      try {
        sessionStorage.removeItem(draftKeyForUser(uid));
      } catch (e2) {}
      try {
        sessionStorage.removeItem(draftGateSessionKey(uid));
      } catch (e3) {}
    }
    purgeUnscopedDraftKeys();
    clearLiveApplyMedia();
    try {
      sessionStorage.removeItem(SCROLL_KEY);
    } catch (e4) {}
  }`
  );
}

s = s.replace(
  `  function writeDraftRecord(draft) {
    var uid = authUserId();
    if (!uid) {
      // Guests must never persist apply drafts into shared localStorage.
      purgeUnscopedDraftKeys();
      return;
    }
    var payload = scrubDraftForStorage(Object.assign({}, draft || {}, { ownerUserId: uid }));
    var key = draftKeyForUser(uid);
    var text = JSON.stringify(payload);`,
  `  function writeDraftRecord(draft) {
    var uid = authUserId();
    if (!uid) {
      // Guests must never persist apply drafts into shared localStorage.
      purgeUnscopedDraftKeys();
      return;
    }
    var incomingGen = Number((draft && draft._draftGeneration) || 0);
    if (incomingGen && incomingGen < draftGeneration) {
      return;
    }
    var payload = scrubDraftForStorage(Object.assign({}, draft || {}, { ownerUserId: uid, _draftGeneration: draftGeneration }));
    if (suppressEmptyPersist && isDraftEffectivelyEmpty(payload)) {
      try {
        localStorage.removeItem(draftKeyForUser(uid));
      } catch (eClear) {}
      purgeUnscopedDraftKeys();
      return;
    }
    var key = draftKeyForUser(uid);
    var text = JSON.stringify(payload);`
);

s = s.replace(
  `  function saveDraft(patch) {
    var draft = readDraft();
    Object.keys(patch || {}).forEach(function (key) {
      if (typeof patch[key] === "object" && !Array.isArray(patch[key]) && patch[key] !== null) draft[key] = Object.assign(draft[key] || {}, patch[key]);
      else draft[key] = patch[key];
    });
    writeDraftRecord(draft);
  }`,
  `  function saveDraft(patch) {
    if (draftGateMode === "prompt") return;
    var draft = readDraft();
    var patchGen = Number((patch && patch._draftGeneration) || 0);
    if (patchGen && patchGen < draftGeneration) return;
    Object.keys(patch || {}).forEach(function (key) {
      if (key === "_draftGeneration") return;
      if (typeof patch[key] === "object" && !Array.isArray(patch[key]) && patch[key] !== null) draft[key] = Object.assign(draft[key] || {}, patch[key]);
      else draft[key] = patch[key];
    });
    draft._draftGeneration = draftGeneration;
    writeDraftRecord(draft);
  }`
);

s = s.replace(
  `  function hydrateUploadsFromBootstrap(boot) {
    if (!boot) return;
    var draft = readDraft();`,
  `  function hydrateUploadsFromBootstrap(boot) {
    if (!boot) return;
    if (!allowServerHydrate || draftGateMode === "fresh" || draftGateMode === "prompt" || hasDraftDiscardedFlag()) {
      return;
    }
    var draft = readDraft();`
);

// Insert draft UI helpers before statusNotice
if (!s.includes("function draftGateHtml")) {
  s = s.replace(
    "  function statusNotice() {",
    `  function draftGateHtml() {
    if (draftGateMode !== "prompt") return "";
    return (
      '<section class="apply-draft-gate" data-apply-draft-gate role="dialog" aria-modal="true">' +
      "<h2>检测到上次未完成的申请</h2>" +
      "<p>自动保存的草稿可以继续编辑；也可以放弃后从零重新填写。放弃会清除本机与服务器上的未提交草稿，不会删除已正式提交的申请。</p>" +
      '<div class="apply-draft-gate-actions">' +
      '<button type="button" class="apply-btn primary" data-apply-draft-continue>继续编辑草稿</button>' +
      '<button type="button" class="apply-btn apply-btn-ghost" data-apply-draft-discard>放弃草稿，重新填写</button>' +
      "</div></section>"
    );
  }
  function draftToolbarHtml(draft) {
    draft = draft || readDraft();
    if (isApplicationSubmitted(draft)) return "";
    if (draftGateMode === "prompt") return "";
    if (!(draftGateMode === "editing" || draftHasMeaningfulContent(draft))) return "";
    return (
      '<div class="apply-draft-toolbar">' +
      '<span>草稿会自动保存。可随时清空后重新填写。</span>' +
      '<button type="button" class="apply-btn apply-btn-ghost-soft" data-apply-draft-clear>清空草稿</button>' +
      "</div>"
    );
  }
  async function discardApplicationDraftFull(opts) {
    opts = opts || {};
    var gen = bumpDraftGeneration();
    suppressEmptyPersist = true;
    allowServerHydrate = false;
    draftGateMode = "fresh";
    writeDraftGateSession("fresh");
    markDraftDiscardedFlag();
    clearCurrentUserDraft();
    writeDraftRecord(emptyDraft());
    clearCurrentUserDraft();
    if (companionToken()) {
      try {
        await postCompanion("discard_application_draft", { _draftGeneration: gen });
      } catch (err) {
        var msg = String((err && err.message) || "");
        if (!/FORMAL_PROFILE_PROTECTED|SUBMITTED_PROTECTED|NOT_DRAFT|正式|已提交/.test(msg)) {
          throw err;
        }
      }
    }
    lastBootstrapPayload = null;
    if (!opts.silent) showApplyTip("草稿已清空，可重新填写。", "ok");
    render(0, { alignStepNav: true });
  }
  function continueApplicationDraft() {
    clearDraftDiscardedFlag();
    suppressEmptyPersist = false;
    allowServerHydrate = true;
    draftGateMode = "editing";
    writeDraftGateSession("continue");
    if (lastBootstrapPayload) hydrateUploadsFromBootstrap(lastBootstrapPayload);
    var step = Number((readDraft().step || 0) || 0);
    render(step, { alignStepNav: true });
    showApplyTip("已恢复草稿，可继续编辑。", "ok");
  }
  function resolveDraftGateAfterBootstrap(boot) {
    lastBootstrapPayload = boot || null;
    if (boot && boot.player) {
      remoteStatus = {
        applicationStatus: boot.player.auditStatus || boot.player.applicationStatus || "",
        rejectReason: boot.player.applicationRejectReason || "",
      };
    }
    if (isApplicationSubmitted()) {
      draftGateMode = "submitted";
      allowServerHydrate = true;
      clearDraftDiscardedFlag();
      applyBootstrap(boot);
      return;
    }
    var sessionGate = readDraftGateSession();
    if (sessionGate === "fresh" || hasDraftDiscardedFlag()) {
      draftGateMode = "fresh";
      allowServerHydrate = false;
      suppressEmptyPersist = true;
      clearCurrentUserDraft();
      return;
    }
    if (sessionGate === "continue") {
      draftGateMode = "editing";
      allowServerHydrate = true;
      applyBootstrap(boot);
      return;
    }
    var localHas = draftHasMeaningfulContent(readDraft());
    var serverHas = bootstrapHasDraftContent(boot);
    if (localHas || serverHas) {
      draftGateMode = "prompt";
      allowServerHydrate = false;
      return;
    }
    draftGateMode = "fresh";
    allowServerHydrate = true;
  }
  function statusNotice() {`
  );
}

s = s.replace(
  `    var activeIndex = Math.min(requestedIndex, reachable);
    saveDraft({ step: activeIndex });
    root.dataset.step = String(activeIndex);
    draft = readDraft();
    preservePageScroll(function () {
      root.innerHTML = loadingBannerHtml() + statusNotice() + authGateHtml() + '<div class="apply-layout"' + (!companionToken() ? ' hidden' : '') + '>' + stepNav(activeIndex, draft) + '<div class="apply-main">' + wizardStackHtml(activeIndex, draft) + actionsHtml(activeIndex, draft) + '</div></div>';
      if (opts.alignStepNav) syncStepNavOnly(root);
      stripVoiceNativeControls();
    });
  }`,
  `    var activeIndex = Math.min(requestedIndex, reachable);
    root.dataset.step = String(activeIndex);
    if (draftGateMode !== "prompt") {
      var stepProbe = Object.assign({}, readDraft(), { step: activeIndex });
      if (!(suppressEmptyPersist && isDraftEffectivelyEmpty(stepProbe))) {
        saveDraft({ step: activeIndex });
      }
    }
    draft = draftGateMode === "prompt" ? emptyDraft() : readDraft();
    preservePageScroll(function () {
      var layoutHidden = !companionToken() || draftGateMode === "prompt";
      root.innerHTML =
        loadingBannerHtml() +
        statusNotice() +
        draftGateHtml() +
        authGateHtml() +
        '<div class="apply-layout"' +
        (layoutHidden ? " hidden" : "") +
        ">" +
        stepNav(activeIndex, draft) +
        '<div class="apply-main">' +
        draftToolbarHtml(draft) +
        wizardStackHtml(activeIndex, draft) +
        actionsHtml(activeIndex, draft) +
        "</div></div>";
      if (opts.alignStepNav) syncStepNavOnly(root);
      stripVoiceNativeControls();
    });
  }`
);

s = s.replace(
  `    ]).then(function (results) {
      applyBootstrap(results[2]);
      initLoading = false;
      initLoadError = "";
      remoteConfigLoaded = true;
      render(readDraft().step || 0);
      restoreApplyScroll();
      var idMode = String(((readDraft().identity || {}).authMode) || "");
      if (idMode === "deposit" || Number(readDraft().step || 0) === 2) {
        return fetchDepositPayMethods(false).then(function () {
          render(readDraft().step || 0);
        });
      }
      return null;
    })`,
  `    ]).then(function (results) {
      resolveDraftGateAfterBootstrap(results[2]);
      initLoading = false;
      initLoadError = "";
      remoteConfigLoaded = true;
      render(draftGateMode === "prompt" ? 0 : readDraft().step || 0);
      restoreApplyScroll();
      var idMode = String(((readDraft().identity || {}).authMode) || "");
      if (draftGateMode !== "prompt" && (idMode === "deposit" || Number(readDraft().step || 0) === 2)) {
        return fetchDepositPayMethods(false).then(function () {
          render(readDraft().step || 0);
        });
      }
      return null;
    })`
);

// Click handlers near data-apply-retry
if (!s.includes("data-apply-draft-continue")) {
  s = s.replace(
    `      if (e.target.closest("[data-apply-retry]")) {
        e.preventDefault();`,
    `      var draftContinueBtn = e.target.closest("[data-apply-draft-continue]");
      if (draftContinueBtn) {
        e.preventDefault();
        continueApplicationDraft();
        return;
      }
      var draftDiscardBtn = e.target.closest("[data-apply-draft-discard], [data-apply-draft-clear]");
      if (draftDiscardBtn) {
        e.preventDefault();
        if (isApplicationSubmitted()) {
          showApplyTip("已提交的申请不能清空草稿。");
          return;
        }
        var okDiscard = window.confirm("确定放弃当前草稿并重新填写吗？\\n当前未提交的内容将被清除。");
        if (!okDiscard) return;
        draftDiscardBtn.disabled = true;
        discardApplicationDraftFull()
          .catch(function (err) {
            showApplyTip((err && err.message) || "清空草稿失败，请重试。");
          })
          .finally(function () {
            draftDiscardBtn.disabled = false;
          });
        return;
      }
      if (e.target.closest("[data-apply-retry]")) {
        e.preventDefault();`
  );
}

// Mark edits on input
if (!s.includes("noteUserEditedDraft()")) {
  s = s.replace(
    `    document.addEventListener("input", function (e) {
      if (!document.getElementById("companionApplyRoot")) return;`,
    `    document.addEventListener("input", function (e) {
      if (!document.getElementById("companionApplyRoot")) return;
      if (e.target && (e.target.matches("input,textarea,select") || e.target.closest("[data-tag-picker]"))) {
        noteUserEditedDraft();
      }`
  );
}

// Collect should respect suppress + generation
s = s.replace(
  `  async function collect(root) {
    var draft = readDraft();`,
  `  async function collect(root) {
    if (draftGateMode === "prompt") return;
    noteUserEditedDraft();
    var draft = readDraft();`
);

// Export helpers
s = s.replace(
  `  window.MCJCompanionApplyDraft = {
    authUserId: authUserId,
    readDraft: readDraft,
    clearCurrentUserDraft: clearCurrentUserDraft,
    purgeUnscopedDraftKeys: purgeUnscopedDraftKeys,
    draftKeyForUser: draftKeyForUser,`,
  `  window.MCJCompanionApplyDraft = {
    authUserId: authUserId,
    readDraft: readDraft,
    clearCurrentUserDraft: clearCurrentUserDraft,
    discardApplicationDraftFull: discardApplicationDraftFull,
    continueApplicationDraft: continueApplicationDraft,
    isDraftEffectivelyEmpty: isDraftEffectivelyEmpty,
    getDraftGateMode: function () { return draftGateMode; },
    getDraftGeneration: function () { return draftGeneration; },
    purgeUnscopedDraftKeys: purgeUnscopedDraftKeys,
    draftKeyForUser: draftKeyForUser,`
);

// afterCompanionAuthSuccess: don't force restore tip; gate handles it
s = s.replace(
  `    try {
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
  }`,
  `    try {
      render(resumeStep, { alignStepNav: true });
      showApplyTip("登录成功，请继续填写陪玩申请。", "ok");
    } catch (renderErr) {
      showApplyTip(renderErr.message || "登录成功，但页面刷新失败，请手动刷新。");
    }
    try {
      var boot = await fetchCompanionBootstrap();
      resolveDraftGateAfterBootstrap(boot);
      try {
        resumeStep =
          draftGateMode === "prompt"
            ? 0
            : Math.max(0, Math.min(steps.length - 1, Number(readDraft().step || resumeStep) || 0));
      } catch (eStep2) {}
      render(resumeStep, { alignStepNav: true });
    } catch (bootErr) {
      try { console.warn("[apply-auth] bootstrap", bootErr); } catch (e5) {}
    }
  }`
);

fs.writeFileSync(p, s);
console.log("patched", p, "len", s.length);
