/**
 * Boss / Companion novice tutorial — config only.
 * v2: aligned with Production multi-companion, per-service pricing,
 * unpaid cancel (#264), and multi confirmation / soft-exit UX.
 * Reservation (立即预约) stays hidden until Production deploy.
 *
 * Tutorial never creates orders, debits wallet, or mutates live data.
 */
(function (global) {
  "use strict";

  var ROUTES = {
    hall: "/companion-center.html",
    profileExample: "/profile.html",
    orders: "/orders.html",
    paymentConfirm: "/payment-confirm.html",
    companionApply: "/companion-apply.html",
    companionDashboard: "/companion/dashboard",
    companionHall: "/companion/order-hall",
    companionEarnings: "/companion/earnings",
    companionRules: "/companion/rules",
    home: "/index.html",
    mine: "/mine.html",
    guide: "/guide.html",
  };

  /** Soft visual mocks (~70% UI) when PNG screenshots are not yet uploaded. */
  var MOCK = {
    hall:
      '<div class="gm-screen">' +
      '<div class="gm-top">陪玩大厅</div>' +
      '<div class="gm-card gm-hl"><div class="gm-av">晴</div><div class="gm-meta"><b>晴子</b><small>在线 · 金牌 · 已认证</small><em>王者荣耀起 35 猫粮</em></div></div>' +
      '<div class="gm-card"><div class="gm-av">灰</div><div class="gm-meta"><b>小灰灰</b><small>在线 · 银牌</small><em>三角洲起 30 猫粮</em></div></div>' +
      '<p class="gm-tip">点卡片进入陪玩详情</p></div>',
    profile:
      '<div class="gm-screen">' +
      '<div class="gm-hero">晴子</div>' +
      '<div class="gm-chips"><span class="gm-hl">在线</span><span>金牌</span><span>已认证</span></div>' +
      '<ul class="gm-list"><li>王者荣耀</li><li>三角洲手游国服</li><li>陪聊</li></ul>' +
      '<p class="gm-tip">先看在线 / 等级 / 认证 / 可接服务</p></div>',
    pricing:
      '<div class="gm-screen">' +
      '<div class="gm-top">选择服务</div>' +
      '<button class="gm-svc gm-hl" type="button">王者荣耀 · <b>35</b> 猫粮/时</button>' +
      '<button class="gm-svc" type="button">三角洲手游国服 · <b>30</b> 猫粮/时</button>' +
      '<button class="gm-svc" type="button">其他服务 · <b>40</b> 猫粮/时</button>' +
      '<div class="gm-sum">单价 <b>35</b> · 小计 <b>35</b> · 总价 <b>35</b></div>' +
      '<p class="gm-tip">同一陪玩，不同服务单价不同；切换服务后金额会变</p></div>',
    singleOrder:
      '<div class="gm-screen">' +
      '<div class="gm-top">立即下单</div>' +
      '<div class="gm-field">服务：王者荣耀</div>' +
      '<div class="gm-field gm-hl">游戏 ID：______</div>' +
      '<div class="gm-field">时长：1 小时</div>' +
      '<div class="gm-sum">单价 35 · 小计 35 · 总价 <b>35</b></div>' +
      '<button class="gm-cta" type="button">确认订单</button></div>',
    multiAdd:
      '<div class="gm-screen">' +
      '<div class="gm-top">下单中</div>' +
      '<div class="gm-line">已选：晴子 · 35</div>' +
      '<button class="gm-cta gm-hl" type="button">+ 再加一位陪玩</button>' +
      '<p class="gm-tip">继续选陪玩 B，合成一个联合订单</p></div>',
    multiTeam:
      '<div class="gm-screen">' +
      '<div class="gm-top">联合订单</div>' +
      '<div class="gm-line gm-hl">陪玩 A 晴子 · 35</div>' +
      '<div class="gm-line gm-hl">陪玩 B 瑞秋 · 50</div>' +
      '<div class="gm-sum">总价 <b>85</b> 猫粮</div>' +
      '<p class="gm-tip">一次联合下单，不是分开下两次</p></div>',
    confirmStatus:
      '<div class="gm-screen">' +
      '<div class="gm-top">陪玩确认状态</div>' +
      '<div class="gm-row"><span class="gm-av sm">灰</span><b>小灰灰</b><i class="gm-ico">🕐</i></div>' +
      '<div class="gm-row gm-hl"><span class="gm-av sm">晴</span><b>晴子</b><i class="gm-ico">✅</i></div>' +
      '<div class="gm-row"><span class="gm-av sm">瑞</span><b>瑞秋</b><i class="gm-ico">🕐</i></div>' +
      '<p class="gm-tip">逐个看谁已确认，不用猜整单</p></div>',
    unavailable:
      '<div class="gm-screen gm-dim">' +
      '<div class="gm-modal gm-hl"><strong>当前陪玩无法接单</strong><p>当前陪玩无法接单，请重新选择陪玩。</p>' +
      '<button type="button">重新选择陪玩</button><button type="button" class="ghost">稍后处理</button></div>' +
      '<p class="gm-tip">其他陪玩继续保留，整单不会自动取消</p></div>',
    replaceSlot:
      '<div class="gm-screen">' +
      '<div class="gm-top">陪玩确认状态</div>' +
      '<div class="gm-row"><span class="gm-av sm">晴</span><b>晴子</b><i class="gm-ico">✅</i></div>' +
      '<div class="gm-row"><span class="gm-av sm">瑞</span><b>瑞秋</b><i class="gm-ico">🕐</i></div>' +
      '<button class="gm-slot gm-hl" type="button">+ 重新选择陪玩</button>' +
      '<p class="gm-tip">退出位置变成补位入口</p></div>',
    afterReplace:
      '<div class="gm-screen">' +
      '<div class="gm-top">补位后</div>' +
      '<div class="gm-row"><span class="gm-av sm">晴</span><b>晴子</b><i class="gm-ico">✅</i></div>' +
      '<div class="gm-row"><span class="gm-av sm">瑞</span><b>瑞秋</b><i class="gm-ico">✅</i></div>' +
      '<div class="gm-row gm-hl"><span class="gm-av sm">D</span><b>新陪玩 D</b><i class="gm-ico">🕐</i></div>' +
      '<p class="gm-tip">仍属原联合订单；已确认的不用再确认</p></div>',
    keepRemaining:
      '<div class="gm-screen">' +
      '<div class="gm-top">补位区域</div>' +
      '<button class="gm-slot" type="button">+ 重新选择陪玩</button>' +
      '<button class="gm-cta gm-hl" type="button">只保留剩余陪玩继续</button>' +
      '<p class="gm-tip">也可以不补人，只用剩下的陪玩继续</p></div>',
    payment:
      '<div class="gm-screen">' +
      '<div class="gm-top">确认付款</div>' +
      '<div class="gm-line">有效陪玩合计</div>' +
      '<div class="gm-sum gm-hl">应付总价 <b>85</b> 猫粮</div>' +
      '<p class="gm-tip">平台自动算总价，并分别记录每位陪玩的服务</p>' +
      '<button class="gm-cta" type="button">确认支付</button></div>',
    orderDetail:
      '<div class="gm-screen">' +
      '<div class="gm-top">订单详情</div>' +
      '<div class="gm-field">订单编号 · 付款状态</div>' +
      '<div class="gm-row"><span class="gm-av sm">晴</span><b>晴子</b><i class="gm-ico">✅</i></div>' +
      '<div class="gm-row"><span class="gm-av sm">瑞</span><b>瑞秋</b><i class="gm-ico">🕐</i></div>' +
      '<p class="gm-tip gm-hl">多人订单：每位陪玩状态都看得清</p></div>',
    cancelUnpaid:
      '<div class="gm-screen">' +
      '<div class="gm-top">我的订单</div>' +
      '<div class="gm-card"><b>待付款订单</b><small>尚未扣款</small>' +
      '<button class="gm-cta gm-hl" type="button">取消订单</button></div>' +
      '<p class="gm-tip">未付款可取消。已付款请走售后/客服，不可随意取消。多人里仅一位无法服务时，只处理该陪玩。</p></div>',
  };

  var bossSteps = [
    {
      id: "boss-hall",
      module: 1,
      title: "进入大厅选陪玩",
      caption: "从首页进陪玩大厅，点陪玩卡片进入详情。",
      highlight: "陪玩卡片",
      visualSlot: "boss-01-hall",
      visualLabel: "陪玩大厅",
      visualMock: MOCK.hall,
    },
    {
      id: "boss-profile",
      module: 1,
      title: "查看陪玩详情",
      caption: "看清在线状态、等级、认证，以及支持的游戏/服务。",
      highlight: "在线 / 等级 / 认证",
      visualSlot: "boss-02-profile",
      visualLabel: "陪玩详情",
      visualMock: MOCK.profile,
    },
    {
      id: "boss-pricing",
      module: 2,
      title: "不同服务不同价格",
      caption: "同一陪玩可有多种单价。切换服务后，单价、小计、总价都会跟着变。",
      highlight: "服务单价",
      visualSlot: "boss-03-pricing",
      visualLabel: "按服务计价",
      visualMock: MOCK.pricing,
    },
    {
      id: "boss-single",
      module: 3,
      title: "单人立即下单",
      caption: "在线陪玩点「立即下单」→ 选服务 → 填游戏 ID → 选开始时间（结束时间自动算）→ 选 Discord/游戏麦 → 确认金额。",
      highlight: "立即下单",
      visualSlot: "boss-04-single-order",
      visualLabel: "单人下单",
      visualMock: MOCK.singleOrder,
    },
    {
      id: "boss-game-id-time",
      module: 3,
      title: "游戏 ID 与服务时间",
      caption: "只需填写游戏 ID，并用滚轮选开始时间。时长选定后自动显示结束时间，不用自己算。",
      highlight: "游戏 ID",
      visualSlot: "boss-04b-game-time",
      visualLabel: "游戏ID + 时间",
      visualMock: MOCK.singleOrder,
    },
    {
      id: "boss-voice",
      module: 3,
      title: "Discord 或游戏麦",
      caption: "下单时明确选择语音方式。选 Discord 后，老板与陪玩订单里都能点进同一语音房链接。",
      highlight: "本单语音方式",
      visualSlot: "boss-04c-voice",
      visualLabel: "语音方式",
      visualMock: MOCK.singleOrder,
    },
    {
      id: "boss-multi-add",
      module: 4,
      title: "再加一位陪玩",
      caption: "下单流程里点「再加一位陪玩」或「继续选陪玩」，会回大厅；已选陪玩草稿不会丢。",
      highlight: "再加一位陪玩",
      visualSlot: "boss-05-multi-add",
      visualLabel: "多人加陪玩",
      visualMock: MOCK.multiAdd,
    },
    {
      id: "boss-multi-team",
      module: 4,
      title: "一个联合订单",
      caption: "A + B 合成一单，各自可有不同价格（例如 35 + 50 = 85）。不用分开下两次。",
      highlight: "联合订单总价",
      visualSlot: "boss-06-multi-team",
      visualLabel: "联合订单 A+B",
      visualMock: MOCK.multiTeam,
    },
    {
      id: "boss-confirm",
      module: 5,
      title: "等待陪玩确认",
      caption: "下单后逐个显示陪玩：🕐 等待确认，✅ 已确认。",
      highlight: "确认状态",
      visualSlot: "boss-07-confirm-status",
      visualLabel: "🕐 / ✅ 状态",
      visualMock: MOCK.confirmStatus,
    },
    {
      id: "boss-unavailable",
      module: 6,
      title: "有人无法接单",
      caption: "某位陪玩拒绝/取消时，其他陪玩继续保留。你会看到「当前陪玩无法接单，请重新选择陪玩。」",
      highlight: "无法接单提示",
      visualSlot: "boss-08-unavailable",
      visualLabel: "无法接单弹窗",
      visualMock: MOCK.unavailable,
    },
    {
      id: "boss-replace-slot",
      module: 6,
      title: "重新选择入口",
      caption: "原位置出现「+ 重新选择陪玩」。也可稍后处理，随时回来补人。",
      highlight: "+ 重新选择陪玩",
      visualSlot: "boss-09-replace-slot",
      visualLabel: "补位入口",
      visualMock: MOCK.replaceSlot,
    },
    {
      id: "boss-replace",
      module: 7,
      title: "补位加入原订单",
      caption: "选新陪玩 D 后仍属原联合订单。已确认的陪玩保持 ✅，不用重新确认。",
      highlight: "补位后状态",
      visualSlot: "boss-10-after-replace",
      visualLabel: "补位后 A✅ C✅ D🕐",
      visualMock: MOCK.afterReplace,
    },
    {
      id: "boss-keep",
      module: 7,
      title: "只保留剩余陪玩",
      caption: "也可以点「只保留剩余陪玩继续」，不补人。",
      highlight: "只保留剩余陪玩继续",
      visualSlot: "boss-11-keep-remaining",
      visualLabel: "只保留其余",
      visualMock: MOCK.keepRemaining,
    },
    {
      id: "boss-pay",
      module: 8,
      title: "付款",
      caption: "确认有效陪玩后支付总金额。平台自动合计，并分别记录每位陪玩的服务。",
      highlight: "应付总价",
      visualSlot: "boss-12-payment",
      visualLabel: "付款确认",
      visualMock: MOCK.payment,
    },
    {
      id: "boss-orders",
      module: 9,
      title: "我的订单 / 详情",
      caption: "个人中心 → 我的订单 → 查看详情。多人订单可看清每位陪玩状态。",
      highlight: "订单详情",
      visualSlot: "boss-13-order-detail",
      visualLabel: "订单详情",
      visualMock: MOCK.orderDetail,
    },
    {
      id: "boss-cancel",
      module: 10,
      title: "取消订单",
      caption: "未付款可直接取消。已付款请走售后/客服。多人里仅一位无法服务时，只处理该陪玩。",
      highlight: "取消订单",
      visualSlot: "boss-14-cancel-unpaid",
      visualLabel: "未付款取消",
      visualMock: MOCK.cancelUnpaid,
      requiresProduction: "boss-order-cancel-264",
    },
    // Module 11 reservation — code reserved, default hidden until Production.
    {
      id: "boss-reservation",
      module: 11,
      title: "离线立即预约",
      caption: "离线陪玩可预约档期；当前未正式上线，教学暂不展示。",
      highlight: "立即预约",
      visualSlot: "boss-15-reservation",
      visualLabel: "立即预约（未上线）",
      visualMock: "",
      enabled: false,
      hiddenReason: "NOT_PRODUCTION",
    },
  ];

  var companionSteps = [
    {
      id: "pw-1",
      title: "申请成为陪玩",
      caption: "从首页「申请陪玩」或「我的 → 申请成为陪玩」进入申请页。",
      highlight: "申请入口",
      visualSlot: "pw-01-apply-entry",
      visualLabel: "申请入口",
    },
    {
      id: "pw-2",
      title: "阅读陪玩制度",
      caption: "第一步必须阅读并勾选同意平台陪玩制度，才能继续。",
      highlight: "我已阅读并同意",
      visualSlot: "pw-02-rules",
      visualLabel: "陪玩制度",
    },
    {
      id: "pw-3",
      title: "填写基本与游戏资料",
      caption: "填写昵称、联系方式，以及可接游戏、服务、段位等真实字段。",
      highlight: "基本资料 / 游戏资料",
      visualSlot: "pw-03-profile-fields",
      visualLabel: "资料表单",
    },
    {
      id: "pw-4",
      title: "上传头像与展示内容",
      caption: "头像与试音为必填；相册、战绩图按页面说明选填。",
      highlight: "头像 / 试音",
      visualSlot: "pw-04-media",
      visualLabel: "媒体上传",
    },
    {
      id: "pw-5",
      title: "身份验证（二选一）",
      caption: "身份证认证或押金认证二选一。另需填写结款资料。",
      highlight: "身份证 或 押金",
      visualSlot: "pw-05-credential",
      visualLabel: "认证方式",
    },
    {
      id: "pw-6",
      title: "提交审核",
      caption: "提交后等待管理员审核。提交申请 ≠ 自动成为陪玩。",
      highlight: "提交申请",
      visualSlot: "pw-06-submit",
      visualLabel: "审核状态",
    },
    {
      id: "pw-7",
      title: "审核通过 · 进入工作台",
      caption: "审核通过后进入陪玩工作台。",
      highlight: "工作台",
      visualSlot: "pw-07-dashboard",
      visualLabel: "陪玩工作台",
    },
    {
      id: "pw-8",
      title: "抢单、完成与收入",
      caption: "在抢单大厅接单；完成后到收益中心查看收入并申请提现。",
      highlight: "抢单大厅 / 收益中心",
      visualSlot: "pw-08-earn",
      visualLabel: "抢单与收益",
    },
  ];

  function enabledSteps(list) {
    return (list || []).filter(function (s) {
      return s && s.enabled !== false;
    });
  }

  global.MCJGuideTutorialConfig = {
    version: "20260920-boss-v2",
    routes: ROUTES,
    flags: {
      // Flip to true only after offline reservation is Production-deployed.
      reservationTutorialEnabled: false,
      unpaidCancelTutorialEnabled: true, // #264 merged
      perServicePricingEnabled: true, // #265 merged
      multiCompanionEnabled: true, // #262 merged
    },
    roles: {
      boss: {
        id: "boss",
        cardTitle: "我是老板",
        cardEmoji: "🐱",
        cardDesc: "大厅 / 计价 / 单人·多人下单 / 确认与补位",
        flowTitle: "老板使用教学",
        doneTitle: "完成 🎉",
        doneBody: "可随时在「我的 → 老板使用教学」重看。现在去大厅找陪玩吧。",
        doneCta: "前往陪玩大厅",
        doneHref: ROUTES.hall,
        steps: enabledSteps(bossSteps),
        allSteps: bossSteps,
      },
      companion: {
        id: "companion",
        cardTitle: "我是陪玩",
        cardEmoji: "🎮",
        cardDesc: "申请入职 / 抢单 / 完成订单 / 收入",
        flowTitle: "如何成为陪玩并开始接单",
        doneTitle: "完成 🎉",
        doneBody: "准备开始你的陪玩之旅",
        doneCta: "前往陪玩工作台",
        doneHref: ROUTES.companionDashboard,
        steps: companionSteps,
        allSteps: companionSteps,
      },
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
