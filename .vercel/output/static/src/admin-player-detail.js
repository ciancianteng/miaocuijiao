(function () {
  "use strict";

  function authApi() {
    return window.MCJAdminAuthFetch || null;
  }
  var saving = false;
  var REJECT_PRESETS = [
    "照片不清晰",
    "身份证信息不完整",
    "相册不符合规范",
    "录音质量不符合要求",
    "资料填写不完整",
  ];
  var pendingRejectAction = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function rejectPresetChipsHtml() {
    return (
      '<div class="admin-reject-presets" data-reject-presets>' +
      REJECT_PRESETS.map(function (label) {
        return (
          '<button type="button" class="mini-btn" data-reject-preset="' +
          esc(label) +
          '">' +
          esc(label) +
          "</button>"
        );
      }).join("") +
      "</div>"
    );
  }

  function closeRejectDialog() {
    pendingRejectAction = null;
    var dlg = document.querySelector("[data-admin-reject-dialog]");
    if (dlg && dlg.parentNode) dlg.parentNode.removeChild(dlg);
  }

  function openRejectDialog(opts) {
    opts = opts || {};
    closeRejectDialog();
    pendingRejectAction = opts;
    var host =
      (window.MCJAdminOverlay && window.MCJAdminOverlay.getBody && window.MCJAdminOverlay.getBody()) ||
      document.querySelector(".admin-overlay-panel") ||
      document.body;
    var wrap = document.createElement("div");
    wrap.className = "admin-reject-dialog";
    wrap.setAttribute("data-admin-reject-dialog", "1");
    wrap.innerHTML =
      '<div class="admin-reject-dialog-card" role="dialog" aria-modal="true" aria-labelledby="adminRejectTitle">' +
      '<header class="admin-reject-dialog-head"><strong id="adminRejectTitle">' +
      esc(opts.title || "填写不通过原因") +
      "</strong>" +
      '<button type="button" class="admin-overlay-close" data-reject-cancel aria-label="关闭">×</button></header>' +
      '<p class="admin-sync-note" style="margin:0 0 10px">驳回时必须填写原因，陪玩端会看到完整说明并可修改后重新提交。</p>' +
      '<div class="admin-sync-note" style="margin:0 0 6px">常用原因（可多选累加）</div>' +
      rejectPresetChipsHtml() +
      '<label class="admin-reject-custom"><span>自定义原因</span>' +
      '<textarea data-reject-reason-input rows="3" placeholder="可补充说明，或直接填写自定义原因"></textarea></label>' +
      '<div class="form-actions" style="margin-top:12px">' +
      '<button type="button" class="mini-btn" data-reject-cancel>取消</button> ' +
      '<button type="button" class="mini-btn primary-lite" data-reject-confirm>确认不通过</button>' +
      "</div></div>";
    host.appendChild(wrap);
    var input = wrap.querySelector("[data-reject-reason-input]");
    if (input) {
      try {
        input.focus({ preventScroll: true });
      } catch (e) {}
    }
  }

  function collectRejectReason(root) {
    var scope = root || document;
    var input = scope.querySelector("[data-reject-reason-input]");
    return String((input && input.value) || "").trim();
  }

  function emptyText(msg) {
    return '<div class="admin-sync-note">' + esc(msg) + "</div>";
  }

  function rows(list) {
    return (
      '<div class="detail-list player-detail-list">' +
      list
        .map(function (row) {
          var label = Array.isArray(row) ? row[0] : row[0];
          var value = Array.isArray(row) ? row[1] : row[1];
          var emptyFallback = Array.isArray(row) ? row[2] : row[2];
          var asHtml = !!(row && row.html);
          if (value == null || value === "") value = emptyFallback || "—";
          return (
            "<div><span>" +
            esc(label) +
            "</span><strong>" +
            (asHtml ? value : esc(value)) +
            "</strong></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function section(key, title, html) {
    return (
      '<section class="player-detail-section" data-player-detail-section="' +
      esc(key) +
      '"><h3>' +
      esc(title) +
      "</h3>" +
      html +
      "</section>"
    );
  }

  function field(label, name, value, type) {
    return (
      '<label><span>' +
      esc(label) +
      '</span><input name="' +
      esc(name) +
      '" type="' +
      esc(type || "text") +
      '" value="' +
      esc(value == null ? "" : value) +
      '"></label>'
    );
  }

  function select(label, name, options, selected) {
    var html = options
      .map(function (opt) {
        var value = typeof opt === "object" ? opt.value : opt;
        var text = typeof opt === "object" ? opt.label : opt;
        return (
          '<option value="' +
          esc(value) +
          '" ' +
          (String(value) === String(selected) ? "selected" : "") +
          ">" +
          esc(text) +
          "</option>"
        );
      })
      .join("");
    return '<label><span>' + esc(label) + "</span><select name=\"" + esc(name) + '">' + html + "</select></label>";
  }

  function statusOptions(selected) {
    return [
      { value: "pending", label: "待审核" },
      { value: "approved", label: "已通过" },
      { value: "rejected", label: "已驳回" },
      { value: "resubmit", label: "需要补资料" },
    ].map(function (opt) {
      return '<option value="' + opt.value + '" ' + (String(selected) === opt.value ? "selected" : "") + ">" + opt.label + "</option>";
    }).join("");
  }

  function thumb(url, title) {
    if (!url) return "";
    return (
      '<button class="player-avatar-btn" type="button" data-player-preview-src="' +
      esc(url) +
      '" data-player-preview-title="' +
      esc(title || "预览") +
      '" title="点击放大">' +
      '<img class="avatar player-avatar" src="' +
      esc(url) +
      '" alt="' +
      esc(title || "") +
      '" onerror="this.onerror=null;this.src=\'/assets/meow-cuijiao-brand.jpg\'">' +
      "</button>"
    );
  }

  function isFinalReviewStatus(status) {
    var key = String(status || "").toLowerCase();
    return (
      key === "approved" ||
      key === "rejected" ||
      key === "resubmit" ||
      key === "need_more" ||
      key === "verified" ||
      key === "paid"
    );
  }

  function reviewStatusText(status) {
    var key = String(status || "pending").toLowerCase();
    var map = {
      pending: "待审核",
      approved: "已通过",
      verified: "已通过",
      paid: "已缴纳",
      rejected: "已驳回",
      resubmit: "需要补资料",
      need_more: "需要补资料",
    };
    return map[key] || status || "待审核";
  }

  function reviewControlsHtml(kind, currentStatus) {
    return (
      '<label><span>审核状态</span><select name="reviewStatus" data-review-status>' +
      statusOptions(currentStatus || "pending") +
      "</select></label>" +
      '<div class="admin-reject-field">' +
      "<span>驳回原因（不通过 / 需补资料时必填）</span>" +
      rejectPresetChipsHtml() +
      '<input name="rejectReason" data-reject-reason-field placeholder="选择上方常用原因，或自行填写">' +
      "</div>" +
      '<div class="form-actions player-review-actions">' +
      '<button class="mini-btn" type="button" data-player-review-pass="' +
      esc(kind) +
      '">通过</button> ' +
      '<button class="mini-btn" type="button" data-player-review-reject="' +
      esc(kind) +
      '">不通过</button> ' +
      '<button class="mini-btn primary-lite" type="button" data-player-review-save="' +
      esc(kind) +
      '">保存审核</button></div>'
    );
  }

  function reviewBox(kind, currentStatus) {
    var status = currentStatus || "pending";
    var final = isFinalReviewStatus(status);
    if (final) {
      return (
        '<div class="player-edit-grid player-review-box" data-player-review="' +
        esc(kind) +
        '" data-review-mode="done">' +
        '<div class="player-review-result">当前审核结果：<strong>' +
        esc(reviewStatusText(status)) +
        "</strong></div>" +
        '<div class="form-actions player-review-actions">' +
        '<button class="mini-btn" type="button" data-player-review-reopen="' +
        esc(kind) +
        '">重新审核</button></div>' +
        '<div class="player-review-editor" hidden>' +
        reviewControlsHtml(kind, status) +
        "</div></div>"
      );
    }
    return (
      '<div class="player-edit-grid player-review-box" data-player-review="' +
      esc(kind) +
      '" data-review-mode="edit">' +
      reviewControlsHtml(kind, status) +
      "</div>"
    );
  }

  function mediaItemActionHtml(item) {
    var status = item.status || "pending";
    var label = item.statusLabel || reviewStatusText(status);
    var id = item.id || "";
    if (isFinalReviewStatus(status)) {
      return (
        '<div class="player-media-item-status" data-media-status="' +
        esc(status) +
        '">' +
        esc(label) +
        "</div>" +
        '<div class="player-media-item-actions" data-media-actions="' +
        esc(id) +
        '">' +
        '<button class="mini-btn" type="button" data-player-media-rereview="' +
        esc(id) +
        '">重新审核</button></div>'
      );
    }
    return (
      '<div class="player-media-item-status" data-media-status="' +
      esc(status) +
      '">' +
      esc(label || "待审核") +
      "</div>" +
      '<div class="player-media-item-actions" data-media-actions="' +
      esc(id) +
      '">' +
      '<button class="mini-btn" type="button" data-player-media-review="' +
      esc(id) +
      '" data-status="approved">通过</button> ' +
      '<button class="mini-btn" type="button" data-player-media-review="' +
      esc(id) +
      '" data-status="rejected">不通过</button></div>'
    );
  }

  function mediaPassRejectHtml(id) {
    return (
      '<button class="mini-btn" type="button" data-player-media-review="' +
      esc(id) +
      '" data-status="approved">通过</button> ' +
      '<button class="mini-btn" type="button" data-player-media-review="' +
      esc(id) +
      '" data-status="rejected">不通过</button>'
    );
  }

  function levelOptions(selected, levels) {
    var html = '<option value="">未设置</option>';
    (levels || []).forEach(function (level) {
      var value = level.id || level.code || level.name;
      var label =
        (level.code ? level.code + " " : "") +
        (level.name || value) +
        (level.color ? " · " + level.color : "") +
        (level.minPrice != null ? " · RM" + level.minPrice + (level.maxPrice != null ? "-" + level.maxPrice : "") : "");
      html +=
        '<option value="' +
        esc(value) +
        '" ' +
        (String(value) === String(selected) || String(level.name) === String(selected) ? "selected" : "") +
        ">" +
        esc(label) +
        "</option>";
    });
    return html;
  }

  function getLevels() {
    if (window.MCJCompanionLevels && window.MCJCompanionLevels.read) return window.MCJCompanionLevels.read() || [];
    return [];
  }

  function render(detail, mode, focus) {
    var edit = mode === "edit";
    var d = detail || {};
    var app = d.application || {};
    var identity = d.identity || {};
    var payment = d.payment || {};
    var media = d.media || {};
    var deposit = d.deposit || {};
    var stats = d.stats || {};
    var levels = getLevels();

    var publicCode =
      d.companionCode ||
      d.companion_code ||
      d.publicId ||
      d.public_id ||
      "";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(publicCode))) publicCode = "";
    if (!publicCode && d.playerId && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(d.playerId))) publicCode = d.playerId;
    var emailLabel =
      d.email && !/\.meow\.test$/i.test(String(d.email)) && !/^(service|boss|companion)\./i.test(String(d.email))
        ? d.email
        : "未绑定邮箱";
    var basic = rows([
      { 0: "头像", 1: media.avatarUrl ? thumb(media.avatarUrl, "头像") : "", 2: "尚未上传头像", html: true },
      ["昵称", d.name || d.nickname],
      ["陪玩编号", publicCode || "未分配"],
      ["登录邮箱", emailLabel],
      ["手机号 / 联系方式", d.phone || d.contact_phone || "尚未填写联系方式"],
      ["年龄", d.age || "尚未填写"],
      ["性别", d.gender || "尚未填写"],
      ["地区", d.region || "尚未填写"],
      ["上架状态", d.publishStatus || (d.publishGate && d.publishGate.statusLabel) || "—"],
      ["审核状态", (d.listingDiag && d.listingDiag.applicationStatus) || d.applicationStatus || d.application_status || "—"],
      ["canWork", d.canWork === true || (d.listingDiag && d.listingDiag.canWork) ? "是" : "否"],
      ["公开状态", (d.listingDiag && d.listingDiag.publicStatus) || d.publishStatus || "—"],
      [
        "是否进入陪玩大厅",
        d.inCompanionHall === true || d.hallVisible === true || (d.listingDiag && d.listingDiag.inCompanionHall)
          ? "是"
          : "否",
      ],
      [
        "被拦截原因",
        d.listingBlockReason ||
          (d.listingDiag && d.listingDiag.blockReason) ||
          (d.inCompanionHall || d.hallVisible ? "无" : "—"),
      ],
      [
        "最后同步时间",
        d.listingSyncedAt || (d.listingDiag && d.listingDiag.listingSyncedAt) || d.updated_at || "—",
      ],
      [
        "资料缺口",
        Array.isArray(d.publishMissing) && d.publishMissing.length
          ? d.publishMissing.join("、")
          : d.publishReady
            ? "无"
            : "—",
      ],
      [
        "非关键缺口",
        Array.isArray(d.softMissing) && d.softMissing.length ? d.softMissing.join("、") : "无",
      ],
      ["注册时间", d.registered_at || d.created_at || "—"],
      ["最近登录", d.lastLogin || d.last_login || "暂无登录记录"],
    ]);
    var devInfo =
      '<details class="admin-dev-info"><summary>开发信息</summary><div class="admin-dev-info-body">' +
      '<div><span>Internal ID</span><code>' +
      esc(d.id || "") +
      "</code></div>" +
      '<div><span>Auth UID</span><code>' +
      esc(d.user_id || d.uid || d.authUid || "") +
      "</code></div>" +
      (d.email && (/\.meow\.test$/i.test(String(d.email)) || /^(service|boss|companion)\./i.test(String(d.email)))
        ? '<div><span>开发邮箱</span><code>' + esc(d.email) + "</code></div>"
        : "") +
      "</div></details>";
    basic = basic + devInfo;
    if (edit) {
      var certCatalog = Array.isArray(d.certTagCatalog) ? d.certTagCatalog : [];
      var selectedCert = {};
      (d.certTagIds || (d.certTags || []).map(function (t) { return t.id || t; }) || []).forEach(function (id) {
        selectedCert[String(id)] = true;
      });
      var certBoxes = certCatalog.length
        ? certCatalog
            .filter(function (t) { return t.enabled !== false; })
            .map(function (t) {
              return (
                '<label style="display:flex;align-items:center;gap:6px;margin:4px 8px 4px 0">' +
                '<input type="checkbox" name="certTagIds" value="' +
                esc(t.id) +
                '"' +
                (selectedCert[String(t.id)] ? " checked" : "") +
                "> " +
                esc((t.icon ? t.icon + " " : "") + t.name) +
                "</label>"
              );
            })
            .join("")
        : '<span class="admin-sync-note">暂无认证标签，请先在「认证标签管理」中创建。</span>';
      basic +=
        '<div class="player-edit-grid">' +
        field("昵称", "nickname", d.name || d.nickname) +
        field("联系方式", "contact_phone", d.phone || d.contact_phone) +
        field("主接服务", "mainService", d.mainService || app.mainService) +
        field("主接游戏", "mainGame", d.mainGame || d.game) +
        field("陪玩标签", "tags", d.tags) +
        field("声线", "voiceType", (d.application && d.application.voiceType) || d.voiceType || d.voice_type || "") +
        select("账号状态", "accountStatus", [
          { value: "正常", label: "正常" },
          { value: "暂停接单", label: "暂停接单" },
          { value: "冻结", label: "冻结" },
          { value: "停用", label: "停用" },
        ], d.accountStatus || d.status || "正常") +
        select("是否允许接单", "allowOrders", [
          { value: "true", label: "允许" },
          { value: "false", label: "禁止" },
        ], d.allowOrders === false ? "false" : "true") +
        select("是否推荐到首页", "featured", [
          { value: "false", label: "否" },
          { value: "true", label: "是" },
        ], d.featured ? "true" : "false") +
        field("卡面焦点 X%", "objectPositionX", d.objectPositionX != null ? d.objectPositionX : (d.object_position_x != null ? d.object_position_x : (d.focalPoint && d.focalPoint.x != null ? d.focalPoint.x : 50)), "number") +
        field("卡面焦点 Y%", "objectPositionY", d.objectPositionY != null ? d.objectPositionY : (d.object_position_y != null ? d.object_position_y : (d.focalPoint && d.focalPoint.y != null ? d.focalPoint.y : 25)), "number") +
        select("卡面适配", "coverFit", [
          { value: "cover", label: "铺满裁切 cover" },
          { value: "contain", label: "完整显示 contain" },
        ], d.coverFit || d.cover_fit || "cover") +
        "</div>" +
        '<div class="player-edit-grid" style="margin-top:10px"><div><span>认证标签（仅后台可改）</span><div data-cert-tag-boxes style="display:flex;flex-wrap:wrap">' +
        certBoxes +
        "</div></div></div>";
    } else if (Array.isArray(d.certTags) && d.certTags.length) {
      var certRow =
        window.MCJCompanionIdentity && window.MCJCompanionIdentity.renderTags
          ? window.MCJCompanionIdentity.renderTags({
              levelId: d.levelId || d.level_id || "",
              levelLabel: d.levelName || d.level_name || "",
              gender: d.gender || "",
              voiceType: (d.application && d.application.voiceType) || d.voiceType || d.voice_type || "",
              certTags: d.certTags,
              tags: d.tags || [],
              includeLevel: true,
              includeGender: true,
              serviceLimit: 6,
              className: "admin-sync-note",
            })
          : '<div class="admin-sync-note mcj-id-tags">' +
            d.certTags
              .map(function (t) {
                return (
                  '<span class="mcj-cert-badge' +
                  (/官方推荐/.test(t.name || "") ? " is-official" : "") +
                  '"><span class="mcj-cert-icon">' +
                  esc(t.icon || "🏅") +
                  "</span>" +
                  esc(t.name || "") +
                  "</span>"
                );
              })
              .join("") +
            "</div>";
      basic += certRow;
    } else if ((d.application && d.application.voiceType) || d.voiceType || d.voice_type || d.gender) {
      basic +=
        window.MCJCompanionIdentity && window.MCJCompanionIdentity.renderTags
          ? window.MCJCompanionIdentity.renderTags({
              levelId: d.levelId || d.level_id || "",
              levelLabel: d.levelName || d.level_name || "",
              gender: d.gender || "",
              voiceType: (d.application && d.application.voiceType) || d.voiceType || d.voice_type || "",
              certTags: [],
              tags: d.tags || [],
              includeLevel: true,
              includeGender: true,
              serviceLimit: 6,
              className: "admin-sync-note",
            })
          : "";
    }

    var applicationStatus =
      d.profile_review_status ||
      d.profileReviewStatus ||
      app.status ||
      "pending";
    var applicationHtml = app.empty
      ? emptyText("尚未提交陪玩申请资料")
      : rows([
          ["申请时间", app.submittedAt || "—"],
          ["主接服务", app.mainService || "尚未填写"],
          ["主接游戏", app.mainGame || "尚未填写"],
          ["游戏段位", app.gameRank || "尚未填写"],
          ["擅长位置", app.position || "尚未填写"],
          ["声线", app.voiceType || "尚未填写"],
          ["可接单时间", app.schedule || "尚未填写"],
          ["申请备注", app.note || "无"],
          ["当前申请状态", app.statusLabel || reviewStatusText(applicationStatus)],
          ["驳回原因", app.rejectReason || "无"],
        ]);
    if (edit) applicationHtml += reviewBox("application", applicationStatus);

    var identityHtml = identity.empty
      ? emptyText("尚未上传身份证")
      : rows([
          ["真实姓名", identity.realName || "—"],
          {
            0: "身份证号码",
            1:
              esc(identity.identityNoMasked || "—") +
              (identity.hasIdentityNo
                ? ' <button class="mini-btn" type="button" data-player-reveal="identity">查看完整号码</button><span data-player-identity-full></span>'
                : ""),
            html: true,
          },
          {
            0: "身份证正面",
            1: identity.hasFront ? thumb(identity.idFrontUrl, "身份证正面") : "",
            2: "尚未上传身份证正面",
            html: true,
          },
          {
            0: "身份证反面",
            1: identity.hasBack ? thumb(identity.idBackUrl, "身份证反面") : "",
            2: "尚未上传身份证反面",
            html: true,
          },
          {
            0: "手持身份证",
            1: identity.hasHandheld ? thumb(identity.idHandheldUrl, "手持身份证") : "",
            2: "尚未上传手持身份证",
            html: true,
          },
          ["提交时间", identity.submittedAt || "—"],
          ["审核状态", identity.statusLabel || identity.status],
          ["审核人", identity.reviewedBy || "—"],
          ["审核时间", identity.reviewedAt || "—"],
          ["驳回原因", identity.rejectReason || "无"],
        ]);
    if (edit && !identity.empty) identityHtml += reviewBox("identity", identity.status);

    var paymentHtml = payment.empty
      ? emptyText("尚未填写结款账户")
      : rows([
          ["收款方式", payment.method || "—"],
          ["银行名称", payment.bankName || "—"],
          ["账户姓名", payment.accountName || "—"],
          {
            0: "银行账号",
            1:
              esc(payment.bankAccountMasked || "—") +
              (payment.hasBankAccount
                ? ' <button class="mini-btn" type="button" data-player-reveal="bank">查看完整资料</button><span data-player-bank-full></span>'
                : ""),
            html: true,
          },
          ["TNG 账号", payment.tngAccount || "—"],
          ["支付宝账号", payment.alipayAccount || "—"],
          ["提交时间", payment.submittedAt || "—"],
          ["审核状态", payment.statusLabel || payment.status],
          ["驳回原因", payment.rejectReason || "无"],
        ]);
    if (edit && !payment.empty) paymentHtml += reviewBox("payment", payment.status);

    var galleryHtml =
      (media.gallery || [])
        .map(function (item) {
          return (
            '<div class="player-media-item">' +
            thumb(item.url, "相册") +
            (edit
              ? mediaItemActionHtml(item)
              : '<div class="player-media-item-status">' + esc(item.statusLabel || reviewStatusText(item.status)) + "</div>") +
            "</div>"
          );
        })
        .join("") || emptyText("尚未上传相册");
    var voiceHtml =
      (media.voices || [])
        .map(function (item) {
          return (
            '<div class="player-media-voice">' +
            (item.url
              ? '<audio controls src="' + esc(item.url) + '" style="width:100%;max-width:360px"></audio>'
              : '<div class="admin-sync-note">语音文件暂不可播放</div>') +
            '<div class="player-media-voice-meta">时长：' +
            esc(item.durationSeconds != null ? item.durationSeconds + " 秒" : "未知") +
            " · 上传：" +
            esc(item.uploadedAt || "—") +
            "</div>" +
            (edit
              ? mediaItemActionHtml(item)
              : '<div class="player-media-item-status">' + esc(item.statusLabel || reviewStatusText(item.status)) + "</div>") +
            "</div>"
          );
        })
        .join("") || emptyText("尚未上传语音");
    var voiceHistory = media.voiceHistory || [];
    if (voiceHistory.length) {
      voiceHtml +=
        '<div class="player-media-voice-history-wrap" style="margin-top:10px">' +
        '<button class="mini-btn" type="button" data-player-voice-history-toggle>历史版本（' +
        voiceHistory.length +
        "）</button>" +
        '<div class="player-media-voice-history" data-player-voice-history hidden>' +
        voiceHistory
          .map(function (item) {
            return (
              '<div class="player-media-voice" style="margin-top:8px;opacity:.85">' +
              (item.url
                ? '<audio controls src="' + esc(item.url) + '" style="width:100%;max-width:360px"></audio>'
                : '<div class="admin-sync-note">语音文件暂不可播放</div>') +
              '<div class="player-media-voice-meta">历史 · 上传：' +
              esc(item.uploadedAt || "—") +
              " · " +
              esc(item.statusLabel || reviewStatusText(item.status)) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>";
    }
    var avatarItem = media.avatar || null;
    var coverItem = media.cover || null;
    var coverUrl = media.coverUrl || (coverItem && coverItem.url) || d.card_image_url || "";
    var mediaStatusLabel = media.statusLabel || reviewStatusText(media.status);
    var mediaHtml =
      rows([
        {
          0: "当前头像",
          1: media.avatarUrl
            ? thumb(media.avatarUrl, "头像") +
              (edit && avatarItem && avatarItem.id
                ? '<div class="player-media-item" style="margin-top:6px">' + mediaItemActionHtml(avatarItem) + "</div>"
                : avatarItem
                  ? '<div class="player-media-item-status" style="margin-top:6px">' +
                    esc(avatarItem.statusLabel || reviewStatusText(avatarItem.status)) +
                    "</div>"
                  : "")
            : "",
          2: "尚未上传头像",
          html: true,
        },
        {
          0: "卡面封面",
          1: coverUrl
            ? thumb(coverUrl, "卡面") +
              (edit && coverItem && coverItem.id
                ? '<div class="player-media-item" style="margin-top:6px">' + mediaItemActionHtml(coverItem) + "</div>"
                : coverItem
                  ? '<div class="player-media-item-status" style="margin-top:6px">' +
                    esc(coverItem.statusLabel || reviewStatusText(coverItem.status)) +
                    "</div>"
                  : "")
            : "",
          2: "尚未上传卡面",
          html: true,
        },
        ["媒体总状态", mediaStatusLabel || "—"],
        ["驳回原因", media.rejectReason || "无"],
      ]) +
      '<h4 class="player-media-subtitle">相册（' +
      esc(String((media.gallery || []).length)) +
      "）</h4>" +
      '<div class="player-media-gallery">' +
      galleryHtml +
      "</div>" +
      '<h4 class="player-media-subtitle">语音</h4>' +
      '<div class="player-media-voices">' +
      voiceHtml +
      "</div>";
    if (edit) mediaHtml += reviewBox("media", media.status);

    var split =
      rows([
        ["当前等级", d.levelName || d.level_name || "未设置"],
        ["单价", d.price != null ? d.price + " 猫粮/小时" : "—"],
        ["平台抽成", (d.orderCommissionRate != null ? d.orderCommissionRate : d.commission_rate) + "%"],
        ["礼物抽成", (d.giftCommissionRate != null ? d.giftCommissionRate : d.gift_commission_rate || 0) + "%"],
        ["直属陪返点", (d.directRebateRate != null ? d.directRebateRate : d.direct_rebate_rate || 0) + "%"],
        ["等级生效时间", d.level_effective_at || "—"],
        ["抽成生效时间", d.commission_effective_at || "—"],
      ]) +
      (edit
        ? '<div class="player-edit-grid" data-player-section-split>' +
          '<label><span>当前等级</span><select name="levelId">' +
          levelOptions(d.levelId || d.level_id || d.levelName, levels) +
          "</select></label>" +
          field("单价", "price", d.price) +
          field("订单平台抽成 %", "orderCommissionRate", d.orderCommissionRate != null ? d.orderCommissionRate : d.commission_rate) +
          field("礼物抽成 %", "giftCommissionRate", d.giftCommissionRate != null ? d.giftCommissionRate : d.gift_commission_rate || 0) +
          field("直属陪返点 %", "directRebateRate", d.directRebateRate != null ? d.directRebateRate : d.direct_rebate_rate || 0) +
          field("调整原因", "reason", "") +
          "</div>"
        : "");

    var depositHtml = deposit.empty
      ? emptyText("尚未缴纳押金")
      : rows([
          ["应缴押金", "RM" + (deposit.requiredAmount != null ? deposit.requiredAmount : 100)],
          ["已缴金额", "RM" + (deposit.paidAmount != null ? deposit.paidAmount : 0)],
          ["缴纳时间", deposit.paidAt || "—"],
          ["支付方式", deposit.paymentMethod || "—"],
          {
            0: "支付凭证",
            1: deposit.hasProof ? thumb(deposit.proofUrl, "押金凭证") : "",
            2: "尚未上传凭证",
            html: true,
          },
          ["审核状态", deposit.statusLabel || deposit.status],
          ["退款状态", deposit.refundStatusLabel || deposit.refundStatus || "无"],
          ["驳回原因", deposit.rejectReason || "无"],
        ]);
    if (edit) depositHtml += reviewBox("deposit", deposit.status === "paid" || deposit.status === "approved" ? "approved" : deposit.status);

    var orderRows = (d.recentOrders || [])
      .map(function (o) {
        return (
          "<tr><td>" +
          esc(o.orderNo || o.id) +
          "</td><td>" +
          esc(o.game || "-") +
          "</td><td>RM" +
          esc(o.amount || 0) +
          "</td><td>" +
          esc(o.status || "-") +
          "</td><td>" +
          esc(o.createdAt || "-") +
          "</td></tr>"
        );
      })
      .join("");
    var reviewRows = (d.reviews || [])
      .slice(0, 20)
      .map(function (r) {
        return (
          "<tr><td>" +
          esc(r.rating || "-") +
          "★</td><td>" +
          esc(r.content || "无文字") +
          "</td><td>" +
          esc(r.orderId || "-") +
          "</td><td>" +
          esc(r.createdAt || "-") +
          "</td></tr>"
        );
      })
      .join("");
    var income =
      rows([
        ["累计订单", stats.totalOrders || 0],
        ["已完成订单", stats.completedOrders || 0],
        ["取消订单", stats.cancelledOrders || 0],
        ["退款订单", stats.refundOrders || 0],
        ["平均评分", (stats.rating != null ? stats.rating : d.rating) || 0],
        ["评价数", (stats.reviewCount != null ? stats.reviewCount : d.reviewCount) || 0],
        ["好评数", (stats.goodReviewCount != null ? stats.goodReviewCount : d.goodReviewCount) || 0],
        ["累计收入", "RM" + (stats.totalIncome || 0)],
        ["可提现余额", "RM" + (stats.withdrawable || 0)],
        ["已提现金额", "RM" + (stats.withdrawn || 0)],
      ]) +
      '<div class="table-wrap player-drawer-table"><table><thead><tr><th>订单号</th><th>服务</th><th>金额</th><th>状态</th><th>时间</th></tr></thead><tbody>' +
      (orderRows || '<tr><td colspan="5"><div class="boss-record-empty">暂无真实历史订单</div></td></tr>') +
      '</tbody></table></div><div class="table-wrap player-drawer-table" style="margin-top:12px"><table><thead><tr><th>评分</th><th>评价内容</th><th>订单</th><th>时间</th></tr></thead><tbody>' +
      (reviewRows || '<tr><td colspan="4"><div class="boss-record-empty">暂无真实评价</div></td></tr>') +
      "</tbody></table></div>";

    var account =
      rows([
        ["当前在线状态", d.onlineStatus || d.online_status || "—"],
        ["账号状态", d.accountStatus || d.status || "—"],
        ["是否允许接单", d.allowOrders === false ? "禁止" : "允许"],
        ["canWork", d.canWork === true || (d.listingDiag && d.listingDiag.canWork) ? "是" : "否"],
        [
          "是否进入陪玩大厅",
          d.inCompanionHall === true || d.hallVisible === true || (d.listingDiag && d.listingDiag.inCompanionHall)
            ? "是"
            : "否",
        ],
        [
          "被拦截原因",
          d.listingBlockReason || (d.listingDiag && d.listingDiag.blockReason) || (d.hallVisible ? "无" : "—"),
        ],
        ["最后同步时间", d.listingSyncedAt || (d.listingDiag && d.listingDiag.listingSyncedAt) || d.updated_at || "—"],
        ["首页推荐", d.featured ? "是" : "否"],
      ]) +
      '<div class="admin-sync-note">在线状态由陪玩端维护；后台可停用账号与禁止接单。审核通过后自动进入公开列表（无需再发布）。</div>';

    return (
      '<div class="player-drawer-head"><div><h2>' +
      esc(edit ? "编辑陪玩" : "陪玩详情") +
      "</h2><p>" +
      esc(d.name || d.nickname || "-") +
      " · " +
      esc(
        (function () {
          var code = d.companionCode || d.companion_code || d.publicId || "";
          if (code && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(code))) return code;
          if (d.playerId && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(d.playerId))) return d.playerId;
          return "未分配";
        })()
      ) +
      '</p></div><button class="mini-btn" type="button" data-player-drawer-close>关闭</button></div>' +
      '<form data-player-detail-form data-player-id="' +
      esc(d.id) +
      '" data-player-mode="' +
      esc(mode || "view") +
      '">' +
      '<div class="player-detail-hero" data-companion-level="' +
      esc(d.levelId || d.level_id || "") +
      '"><img src="' +
      esc(media.avatarUrl || d.avatar || "/assets/meow-cuijiao-brand.jpg") +
      '" alt="" onerror="this.onerror=null;this.src=\'/assets/meow-cuijiao-brand.jpg\'"><div><strong>' +
      esc(d.name || d.nickname || "-") +
      "</strong><span>" +
      esc(d.levelName || d.level_name || "未设置等级") +
      " · " +
      esc(d.mainGame || d.game || "未设置服务") +
      "</span></div><span class=\"status ok\">" +
      esc(d.accountStatus || d.status || "正常") +
      "</span></div>" +
      section("basic", "基础资料", basic) +
      section("application", "陪玩申请资料", applicationHtml) +
      section("identity", "身份认证", identityHtml) +
      section("payment", "结款账户", paymentHtml) +
      section("media", "头像 / 相册 / 语音", mediaHtml) +
      section("split", "等级与价格", split) +
      section("deposit", "押金", depositHtml) +
      section("income", "订单与收益", income) +
      section("account", "账号管理", account) +
      (edit
        ? '<div class="player-drawer-actions"><button class="btn primary" type="button" data-player-action="save-detail" data-player-id="' +
          esc(d.id) +
          '" ' +
          (saving ? "disabled" : "") +
          ">" +
          (saving ? "保存中…" : "保存修改") +
          '</button><button class="btn" type="button" data-player-drawer-close>取消</button></div>'
        : '<div class="player-drawer-actions"><button class="btn primary" type="button" data-player-action="edit" data-player-id="' +
          esc(d.id) +
          '">进入编辑</button><button class="btn" type="button" data-player-drawer-close>关闭</button></div>') +
      "</form>" +
      '<div class="modal" id="playerMediaPreview" aria-hidden="true" hidden><div class="modal-card" style="max-width:min(920px,92vw)"><button class="modal-close" type="button" data-player-preview-close>×</button><div id="playerMediaPreviewBody"></div></div></div>'
    );
  }

  function apiPost(body) {
    var Auth = authApi();
    var headers = { "x-mcj-admin-role": (window.MCJAdminRole || localStorage.getItem("mcjAdminRole") || "admin") };
    if (Auth && Auth.post) return Auth.post("/api/admin/players", body, headers);
    return fetch("/api/admin/players", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, headers),
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.message || "请求失败");
        return data;
      });
    });
  }

  function safeDetailLoadError(err) {
    var raw = String((err && err.message) || err || "");
    if (/登录|未登录|unauthorized|401/i.test(raw)) return "请先登录管理员账号。";
    // Never expose permission / DB / stack details in the overlay.
    return "资料暂时无法加载，请稍后再试。";
  }

  function apiGetDetail(id) {
    var Auth = authApi();
    var url = "/api/admin/players?id=" + encodeURIComponent(id);
    var headers = { "x-mcj-admin-role": (window.MCJAdminRole || localStorage.getItem("mcjAdminRole") || "admin") };
    if (Auth && Auth.get) {
      return Auth.get(url, headers).catch(function (err) {
        throw new Error(safeDetailLoadError(err));
      });
    }
    return fetch(url, { headers: Object.assign({ Accept: "application/json" }, headers) }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(safeDetailLoadError({ message: data.message }));
        return data;
      });
    });
  }

  function openPreview(src, title) {
    var modal = document.getElementById("playerMediaPreview");
    var body = document.getElementById("playerMediaPreviewBody");
    if (!modal || !body || !src) return;
    body.innerHTML =
      "<h3 style=\"margin:0 0 12px;color:#fff\">" +
      esc(title || "预览") +
      '</h3><img src="' +
      esc(src) +
      '" alt="" style="max-width:100%;max-height:70vh;display:block;margin:0 auto;border-radius:12px">';
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("open");
  }

  function closePreview() {
    var modal = document.getElementById("playerMediaPreview");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("open");
  }

  window.MCJAdminPlayerDetail = {
    render: render,
    fetchDetail: apiGetDetail,
    apiPost: apiPost,
    openPreview: openPreview,
    closePreview: closePreview,
    setSaving: function (v) {
      saving = !!v;
    },
    isSaving: function () {
      return saving;
    },
  };

  document.addEventListener("click", function (e) {
    var preview = e.target.closest("[data-player-preview-src]");
    if (preview) {
      openPreview(preview.getAttribute("data-player-preview-src"), preview.getAttribute("data-player-preview-title"));
      var form = preview.closest("[data-player-detail-form]");
      var id = form && form.getAttribute("data-player-id");
      if (id && /身份证/.test(preview.getAttribute("data-player-preview-title") || "")) {
        apiPost({ action: "view_identity_image", id: id, payload: { side: preview.getAttribute("data-player-preview-title") } }).catch(function () {});
      }
      return;
    }
    if (e.target.closest("[data-player-preview-close]")) {
      closePreview();
      return;
    }
    var reveal = e.target.closest("[data-player-reveal]");
    if (reveal) {
      var form2 = reveal.closest("[data-player-detail-form]");
      if (!form2) return;
      var pid = form2.getAttribute("data-player-id");
      var kind = reveal.getAttribute("data-player-reveal");
      apiPost({
        action: kind === "bank" ? "reveal_bank_account" : "reveal_identity_no",
        id: pid,
        payload: {},
      })
        .then(function (res) {
          if (kind === "identity") {
            var box = form2.querySelector("[data-player-identity-full]");
            if (box) box.textContent = " " + (res.identityNo || "");
          } else {
            var bank = form2.querySelector("[data-player-bank-full]");
            var p = res.payment || {};
            if (bank)
              bank.textContent =
                " 银行:" +
                (p.bankAccount || "-") +
                " / TNG:" +
                (p.tngAccount || "-") +
                " / 支付宝:" +
                (p.alipayAccount || "-");
          }
          alert(res.message || "已显示完整资料（已记入操作日志）");
        })
        .catch(function (err) {
          alert(err.message || "查看失败");
        });
      return;
    }
    var presetBtn = e.target.closest("[data-reject-preset]");
    if (presetBtn) {
      e.preventDefault();
      var label = String(presetBtn.getAttribute("data-reject-preset") || "").trim();
      if (!label) return;
      var dlgInput = document.querySelector("[data-admin-reject-dialog] [data-reject-reason-input]");
      if (dlgInput) {
        var cur = String(dlgInput.value || "").trim();
        dlgInput.value = cur ? (cur.indexOf(label) >= 0 ? cur : cur + "；" + label) : label;
        return;
      }
      var fieldHost = presetBtn.closest("[data-player-review]") || presetBtn.closest(".admin-reject-field");
      var field = fieldHost && fieldHost.querySelector('[name="rejectReason"], [data-reject-reason-field]');
      if (field) {
        var existing = String(field.value || "").trim();
        field.value = existing ? (existing.indexOf(label) >= 0 ? existing : existing + "；" + label) : label;
        var statusSel = fieldHost.querySelector('[name="reviewStatus"], [data-review-status]');
        if (statusSel && statusSel.value !== "resubmit") statusSel.value = "rejected";
      }
      return;
    }
    if (e.target.closest("[data-reject-cancel]")) {
      e.preventDefault();
      closeRejectDialog();
      return;
    }
    var rejectConfirm = e.target.closest("[data-reject-confirm]");
    if (rejectConfirm) {
      e.preventDefault();
      var reasonDlg = collectRejectReason(document.querySelector("[data-admin-reject-dialog]"));
      if (!reasonDlg) {
        alert("不通过时必须填写驳回原因");
        return;
      }
      var act = pendingRejectAction;
      if (!act || typeof act.onConfirm !== "function") {
        closeRejectDialog();
        return;
      }
      closeRejectDialog();
      act.onConfirm(reasonDlg);
      return;
    }

    function reviewActionName(kind) {
      return kind === "identity"
        ? "review_identity"
        : kind === "payment"
          ? "review_payment"
          : kind === "media"
            ? "review_media"
            : kind === "deposit"
              ? "review_deposit"
              : "review_application";
    }

    function postReview(formEl, kind, status, reason) {
      return apiPost({
        action: reviewActionName(kind),
        id: formEl.getAttribute("data-player-id"),
        payload: { status: status, rejectReason: reason || "" },
      })
        .then(function (res) {
          alert(res.message || "审核已保存");
          if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadList) {
            window.MCJAdminPlayerBridge.reloadList();
          }
          if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadDetail) {
            window.MCJAdminPlayerBridge.reloadDetail(
              formEl.getAttribute("data-player-id"),
              formEl.getAttribute("data-player-mode") || "edit"
            );
          }
        })
        .catch(function (err) {
          alert(err.message || "审核失败");
        });
    }

    var reviewPass = e.target.closest("[data-player-review-pass]");
    if (reviewPass) {
      var formPass = reviewPass.closest("[data-player-detail-form]");
      var wrapPass = reviewPass.closest("[data-player-review]");
      if (!formPass || !wrapPass) return;
      var kindPass = reviewPass.getAttribute("data-player-review-pass");
      var statusElPass = wrapPass.querySelector('[name="reviewStatus"], [data-review-status]');
      if (statusElPass) statusElPass.value = "approved";
      postReview(formPass, kindPass, "approved", "");
      return;
    }

    var reviewReject = e.target.closest("[data-player-review-reject]");
    if (reviewReject) {
      var formReject = reviewReject.closest("[data-player-detail-form]");
      var wrapReject = reviewReject.closest("[data-player-review]");
      if (!formReject || !wrapReject) return;
      var kindReject = reviewReject.getAttribute("data-player-review-reject");
      var existingReason = String((wrapReject.querySelector('[name="rejectReason"]') || {}).value || "").trim();
      openRejectDialog({
        title: "不通过原因",
        onConfirm: function (reason) {
          var statusEl = wrapReject.querySelector('[name="reviewStatus"], [data-review-status]');
          var reasonEl = wrapReject.querySelector('[name="rejectReason"]');
          if (statusEl) statusEl.value = "rejected";
          if (reasonEl) reasonEl.value = reason;
          postReview(formReject, kindReject, "rejected", reason);
        },
      });
      if (existingReason) {
        var seed = document.querySelector("[data-admin-reject-dialog] [data-reject-reason-input]");
        if (seed) seed.value = existingReason;
      }
      return;
    }

    var reviewSave = e.target.closest("[data-player-review-save]");
    if (reviewSave) {
      var form3 = reviewSave.closest("[data-player-detail-form]");
      var wrap = reviewSave.closest("[data-player-review]");
      if (!form3 || !wrap) return;
      var kind2 = reviewSave.getAttribute("data-player-review-save");
      var status = (wrap.querySelector('[name="reviewStatus"]') || {}).value || "pending";
      var reason = (wrap.querySelector('[name="rejectReason"]') || {}).value || "";
      if ((status === "rejected" || status === "resubmit") && !String(reason).trim()) {
        openRejectDialog({
          title: status === "resubmit" ? "需补资料原因" : "不通过原因",
          onConfirm: function (filled) {
            var reasonEl2 = wrap.querySelector('[name="rejectReason"]');
            if (reasonEl2) reasonEl2.value = filled;
            postReview(form3, kind2, status, filled);
          },
        });
        return;
      }
      postReview(form3, kind2, status, reason);
      return;
    }
    var reviewReopen = e.target.closest("[data-player-review-reopen]");
    if (reviewReopen) {
      e.preventDefault();
      var wrapReopen = reviewReopen.closest("[data-player-review]");
      if (!wrapReopen) return;
      wrapReopen.setAttribute("data-review-mode", "edit");
      var resultEl = wrapReopen.querySelector(".player-review-result");
      var reopenActions = reviewReopen.closest(".player-review-actions");
      var editor = wrapReopen.querySelector(".player-review-editor");
      if (resultEl) resultEl.hidden = true;
      if (reopenActions) reopenActions.hidden = true;
      if (editor) editor.hidden = false;
      return;
    }

    var mediaRereview = e.target.closest("[data-player-media-rereview]");
    if (mediaRereview) {
      e.preventDefault();
      var mediaIdRe = mediaRereview.getAttribute("data-player-media-rereview");
      var actionsHost = mediaRereview.closest("[data-media-actions]");
      if (!actionsHost) return;
      actionsHost.innerHTML = mediaPassRejectHtml(mediaIdRe);
      return;
    }

    var voiceHistoryToggle = e.target.closest("[data-player-voice-history-toggle]");
    if (voiceHistoryToggle) {
      e.preventDefault();
      var historyBox =
        voiceHistoryToggle.parentElement &&
        voiceHistoryToggle.parentElement.querySelector("[data-player-voice-history]");
      if (!historyBox) return;
      var open = historyBox.hasAttribute("hidden");
      if (open) historyBox.removeAttribute("hidden");
      else historyBox.setAttribute("hidden", "");
      voiceHistoryToggle.textContent = open
        ? "收起历史版本"
        : "历史版本（" + (historyBox.querySelectorAll(".player-media-voice").length || 0) + "）";
      return;
    }

    var mediaReview = e.target.closest("[data-player-media-review]");
    if (mediaReview) {
      var form4 = mediaReview.closest("[data-player-detail-form]");
      if (!form4) return;
      var st = mediaReview.getAttribute("data-status") || "approved";
      var mediaId = mediaReview.getAttribute("data-player-media-review");
      function postMedia(statusVal, reasonVal) {
        apiPost({
          action: "review_media",
          id: form4.getAttribute("data-player-id"),
          payload: { mediaId: mediaId, status: statusVal, rejectReason: reasonVal || "" },
        })
          .then(function (res) {
            alert(res.message || "已更新");
            if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadList) {
              window.MCJAdminPlayerBridge.reloadList();
            }
            if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadDetail) {
              window.MCJAdminPlayerBridge.reloadDetail(form4.getAttribute("data-player-id"), "edit");
            }
          })
          .catch(function (err) {
            alert(err.message || "操作失败");
          });
      }
      if (st === "rejected") {
        openRejectDialog({
          title: "媒体不通过原因",
          onConfirm: function (reasonMedia) {
            postMedia("rejected", reasonMedia);
          },
        });
        return;
      }
      postMedia(st, "");
    }
  });
})();
