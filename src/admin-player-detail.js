(function () {
  "use strict";

  function authApi() {
    return window.MCJAdminAuthFetch || null;
  }

  var saving = false;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
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

  function thumb(url, title, meta) {
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
      (meta ? '<span class="player-name-meta">' + esc(meta) + "</span>" : "") +
      "</button>"
    );
  }

  function reviewBox(kind, currentStatus) {
    return (
      '<div class="player-edit-grid" data-player-review="' +
      esc(kind) +
      '">' +
      '<label><span>审核状态</span><select name="reviewStatus">' +
      statusOptions(currentStatus || "pending") +
      "</select></label>" +
      '<label><span>驳回原因</span><input name="rejectReason" placeholder="驳回时必填"></label>' +
      '<div class="form-actions"><button class="mini-btn primary-lite" type="button" data-player-review-save="' +
      esc(kind) +
      '">保存审核</button></div></div>'
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

    var basic = rows([
      { 0: "头像", 1: media.avatarUrl ? thumb(media.avatarUrl, "头像") : "", 2: "尚未上传头像", html: true },
      {
        0: "卡面展示",
        1: media.coverUrl
          ? thumb(media.coverUrl, "卡面")
          : media.avatarUrl
            ? thumb(media.avatarUrl, "卡面(=头像)")
            : "",
        2: "使用头像/相册（已取消单独卡面上传）",
        html: true,
      },
      ["昵称", d.name || d.nickname],
      ["陪玩 ID", d.playerId || d.id],
      ["邮箱", d.email || "尚未填写邮箱"],
      ["手机号 / 联系方式", d.phone || d.contact_phone || "尚未填写联系方式"],
      ["年龄", d.age || "尚未填写"],
      ["性别", d.gender || "尚未填写"],
      ["地区", d.region || "尚未填写"],
      ["声线", d.voiceType || d.voice_type || (d.application && d.application.voiceType) || "尚未填写"],
      ["注册时间", d.registered_at || d.created_at || "—"],
      ["最近登录", d.lastLogin || d.last_login || "暂无登录记录"],
      ["是否已设置密码", d.hasPassword || d.has_password ? "是" : "否"],
      ["最近密码重置", d.passwordSetAt || d.password_set_at || "—"],
      ["最近登录 IP", d.lastLoginIp || d.last_login_ip || "—"],
    ]);
    if (edit) {
      basic +=
        '<div class="player-edit-grid">' +
        field("昵称", "nickname", d.name || d.nickname) +
        field("联系方式", "contact_phone", d.phone || d.contact_phone) +
        field("主接服务", "mainService", d.mainService || app.mainService) +
        field("主接游戏", "mainGame", d.mainGame || d.game) +
        field("陪玩标签", "tags", d.tags) +
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
        "</div>";
    }

    var applicationHtml = app.empty
      ? emptyText("尚未提交陪玩申请资料")
      : rows([
          ["申请时间", app.submittedAt || "—"],
          ["主接服务", app.mainService || "尚未填写"],
          ["主接游戏", app.mainGame || "尚未填写"],
          ["游戏段位", app.gameRank || "尚未填写"],
          ["擅长位置", app.position || "尚未填写"],
          ["声音类型", app.voiceType || "尚未填写"],
          ["可接单时间", app.schedule || "尚未填写"],
          ["申请备注", app.note || "无"],
          ["当前申请状态", app.statusLabel || app.status],
          ["驳回原因", app.rejectReason || "无"],
        ]);
    if (edit) applicationHtml += reviewBox("application", app.status);

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
          ["银行户名", payment.accountName || "—"],
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
            '<div style="display:inline-block;margin:4px 8px 4px 0;text-align:center">' +
            thumb(item.url, "相册", item.statusLabel) +
            (edit
              ? '<div><button class="mini-btn" type="button" data-player-media-review="' +
                esc(item.id) +
                '" data-status="approved">通过</button> <button class="mini-btn" type="button" data-player-media-review="' +
                esc(item.id) +
                '" data-status="rejected">不通过</button></div>'
              : "") +
            "</div>"
          );
        })
        .join("") || emptyText("尚未上传相册");
    var voiceHtml =
      (media.voices || [])
        .map(function (item) {
          return (
            '<div class="admin-sync-note">' +
            (item.url
              ? '<audio controls src="' + esc(item.url) + '" style="width:100%;max-width:360px"></audio>'
              : "语音文件暂不可播放") +
            "<div>时长：" +
            esc(item.durationSeconds != null ? item.durationSeconds + " 秒" : "未知") +
            " · 上传：" +
            esc(item.uploadedAt || "—") +
            " · " +
            esc(item.statusLabel || "") +
            "</div>" +
            (edit
              ? '<button class="mini-btn" type="button" data-player-media-review="' +
                esc(item.id) +
                '" data-status="approved">通过</button> <button class="mini-btn" type="button" data-player-media-review="' +
                esc(item.id) +
                '" data-status="rejected">不通过</button>'
              : "") +
            "</div>"
          );
        })
        .join("") || emptyText("尚未上传语音");
    var videoHtml =
      (media.videos || [])
        .map(function (item) {
          return (
            '<div class="admin-sync-note">' +
            (item.url
              ? '<video controls playsinline src="' +
                esc(item.url) +
                '" style="width:100%;max-width:420px;border-radius:12px;background:#000"></video>'
              : "展示视频暂不可播放") +
            "<div>时长：" +
            esc(item.durationSeconds != null ? item.durationSeconds + " 秒" : "未知") +
            " · 上传：" +
            esc(item.uploadedAt || "—") +
            " · " +
            esc(item.statusLabel || "") +
            "</div>" +
            (edit
              ? '<button class="mini-btn" type="button" data-player-media-review="' +
                esc(item.id) +
                '" data-status="approved">通过</button> <button class="mini-btn" type="button" data-player-media-review="' +
                esc(item.id) +
                '" data-status="rejected">不通过</button>'
              : "") +
            "</div>"
          );
        })
        .join("") || emptyText("尚未上传展示视频");
    var mediaHtml =
      rows([
      {
        0: "当前头像",
        1: media.avatarUrl ? thumb(media.avatarUrl, "头像") : "",
        2: "尚未上传头像",
        html: true,
      },
      {
        0: "卡面展示",
        1: media.coverUrl
          ? thumb(media.coverUrl, "卡面")
          : media.avatarUrl
            ? thumb(media.avatarUrl, "卡面(=头像)")
            : "",
        2: "使用头像/相册（已取消单独卡面上传）",
        html: true,
      },
        ["媒体总状态", media.statusLabel || "—"],
        ["驳回原因", media.rejectReason || "无"],
      ]) +
      "<h4 style=\"margin:12px 0 8px;color:#fff;font-size:13px\">相册</h4>" +
      galleryHtml +
      "<h4 style=\"margin:12px 0 8px;color:#fff;font-size:13px\">语音</h4>" +
      voiceHtml +
      "<h4 style=\"margin:12px 0 8px;color:#fff;font-size:13px\">展示视频</h4>" +
      videoHtml;
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

    var depositHistory = Array.isArray(d.deposits)
      ? d.deposits
      : Array.isArray(d.depositHistory)
        ? d.depositHistory
        : deposit && !deposit.empty
          ? [deposit]
          : [];
    var depositHtml = deposit.empty && !depositHistory.length
      ? emptyText("尚未缴纳押金")
      : rows([
          ["记录编号", deposit.recordNo || "—"],
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
          ["审核时间", deposit.reviewedAt || "—"],
          ["审核管理员", deposit.reviewedByName || deposit.reviewedBy || "—"],
          ["退款状态", deposit.refundStatusLabel || deposit.refundStatus || "无"],
          ["退还时间", deposit.refundedAt || "—"],
          ["驳回原因", deposit.rejectReason || "无"],
        ]);
    if (depositHistory.length) {
      depositHtml +=
        '<div class="player-deposit-history" style="margin-top:14px"><h4 style="margin:0 0 8px">押金记录（永久账目）</h4>' +
        depositHistory
          .map(function (row) {
            return (
              '<article class="panel" style="margin:0 0 10px;padding:12px">' +
              rows([
                ["记录编号", row.recordNo || row.id || "—"],
                ["金额", "RM" + (row.requiredAmount != null ? row.requiredAmount : row.paidAmount != null ? row.paidAmount : 100)],
                ["状态", row.statusLabel || row.status || "—"],
                ["付款方式", row.paymentMethod || "—"],
                ["缴纳时间", row.paidAt || "—"],
                ["审核时间", row.reviewedAt || "—"],
                ["审核管理员", row.reviewedByName || row.reviewedBy || "—"],
                ["退还时间", row.refundedAt || "—"],
                {
                  0: "付款凭证",
                  1: row.hasProof ? thumb(row.proofUrl, "押金凭证") : "",
                  2: "无凭证",
                  html: true,
                },
              ]) +
              "</article>"
            );
          })
          .join("") +
        "</div>";
    }
    if (edit) depositHtml += reviewBox("deposit", deposit.status === "paid" ? "approved" : deposit.status);

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
        ["首页推荐", d.featured ? "是" : "否"],
      ]) +
      '<div class="admin-sync-note">在线状态由陪玩端维护；后台可停用账号与禁止接单。</div>';

    return (
      '<div class="player-drawer-head"><div><h2>' +
      esc(edit ? "编辑陪玩" : "陪玩详情") +
      "</h2><p>" +
      esc(d.name || d.nickname || "-") +
      " · " +
      esc(d.playerId || d.id) +
      '</p></div><button class="mini-btn" type="button" data-player-drawer-close>关闭</button></div>' +
      '<form data-player-detail-form data-player-id="' +
      esc(d.id) +
      '" data-player-mode="' +
      esc(mode || "view") +
      '">' +
      '<div class="player-detail-hero"><img src="' +
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
      section("deposit", "押金记录", depositHtml) +
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

  function apiGetDetail(id) {
    var Auth = authApi();
    var headers = { "x-mcj-admin-role": (window.MCJAdminRole || localStorage.getItem("mcjAdminRole") || "admin") };
    // Prefer POST detail — same auth path as list mutations; avoids GET query rewrite quirks.
    if (Auth && Auth.post) {
      return Auth.post("/api/admin/players", { action: "detail", id: id }, headers).catch(function (err) {
        var url = "/api/admin/players?id=" + encodeURIComponent(id);
        if (Auth.get) return Auth.get(url, headers);
        throw err;
      });
    }
    var url = "/api/admin/players?id=" + encodeURIComponent(id);
    if (Auth && Auth.get) return Auth.get(url, headers);
    return fetch(url, { headers: Object.assign({ Accept: "application/json" }, headers) }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.message || "资料加载失败，请重试");
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
    var reviewSave = e.target.closest("[data-player-review-save]");
    if (reviewSave) {
      var form3 = reviewSave.closest("[data-player-detail-form]");
      var wrap = reviewSave.closest("[data-player-review]");
      if (!form3 || !wrap) return;
      var kind2 = reviewSave.getAttribute("data-player-review-save");
      var status = (wrap.querySelector('[name="reviewStatus"]') || {}).value || "pending";
      var reason = (wrap.querySelector('[name="rejectReason"]') || {}).value || "";
      if ((status === "rejected" || status === "resubmit") && !String(reason).trim()) {
        alert("驳回时必须填写原因");
        return;
      }
      var action =
        kind2 === "identity"
          ? "review_identity"
          : kind2 === "payment"
            ? "review_payment"
            : kind2 === "media"
              ? "review_media"
              : kind2 === "deposit"
                ? "review_deposit"
                : "review_application";
      apiPost({
        action: action,
        id: form3.getAttribute("data-player-id"),
        payload: { status: status, rejectReason: reason },
      })
        .then(function (res) {
          alert(res.message || "审核已保存");
          if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadDetail) {
            window.MCJAdminPlayerBridge.reloadDetail(form3.getAttribute("data-player-id"), form3.getAttribute("data-player-mode") || "edit");
          }
        })
        .catch(function (err) {
          alert(err.message || "审核失败");
        });
      return;
    }
    var mediaReview = e.target.closest("[data-player-media-review]");
    if (mediaReview) {
      var form4 = mediaReview.closest("[data-player-detail-form]");
      if (!form4) return;
      var st = mediaReview.getAttribute("data-status") || "approved";
      var reason2 = st === "rejected" ? prompt("请填写不通过原因：") || "" : "";
      if (st === "rejected" && !reason2.trim()) return;
      apiPost({
        action: "review_media",
        id: form4.getAttribute("data-player-id"),
        payload: { mediaId: mediaReview.getAttribute("data-player-media-review"), status: st, rejectReason: reason2 },
      })
        .then(function (res) {
          alert(res.message || "已更新");
          if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadDetail) {
            window.MCJAdminPlayerBridge.reloadDetail(form4.getAttribute("data-player-id"), "edit");
          }
        })
        .catch(function (err) {
          alert(err.message || "操作失败");
        });
    }
  });
})();
