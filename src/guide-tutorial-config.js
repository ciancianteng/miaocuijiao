/**
 * Novice tutorial steps — config only.
 * Align with Production flows; do not invent fields or payment paths.
 * Screenshots: put real phone captures in /assets/guide/ when ready.
 * Until then, visualSlot renders a labeled phone-frame placeholder (not a fake UI screenshot).
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
  };

  var bossSteps = [
    {
      id: "boss-1",
      title: "进入陪玩大厅",
      caption: "先在大厅找到你喜欢的陪玩。",
      highlight: "陪玩卡片",
      visualSlot: "boss-01-hall",
      visualLabel: "陪玩大厅 · 卡片列表",
    },
    {
      id: "boss-2",
      title: "查看陪玩资料",
      caption: "点击陪玩卡片，查看资料、认证标签、评价等信息。",
      highlight: "资料 / 标签 / 评价",
      visualSlot: "boss-02-profile",
      visualLabel: "陪玩详情页 profile.html",
    },
    {
      id: "boss-3",
      title: "开始下单",
      caption: "确认陪玩后，点「立即下单」选择服务并提交。",
      highlight: "立即下单",
      visualSlot: "boss-03-open-order",
      visualLabel: "详情页 · 立即下单按钮",
    },
    {
      id: "boss-4",
      title: "确认订单资料",
      caption: "确认服务、时长、备注与合计猫粮后再提交。",
      highlight: "下单弹窗",
      visualSlot: "boss-04-order-modal",
      visualLabel: "立即下单弹窗（真实字段）",
    },
    {
      id: "boss-5",
      title: "付款",
      caption:
        "按平台当前方式付款：猫粮钱包可即时扣款；外部支付需扫码并上传付款截图。",
      highlight: "支付方式 / 上传截图",
      visualSlot: "boss-05-payment",
      visualLabel: "钱包支付 或 payment-confirm 上传凭证",
    },
    {
      id: "boss-6",
      title: "等待确认",
      caption:
        "上传付款截图后进入「待人工审核」。付款提交 ≠ 订单自动完成，需客服确认收款后才会进入后续匹配。",
      highlight: "待人工审核",
      visualSlot: "boss-06-cs-review",
      visualLabel: "订单状态 · 待人工审核 / 待客服处理",
    },
    {
      id: "boss-7",
      title: "查看订单",
      caption: "在「我的订单」查看进度；公开抢单时可用「我要她」选择陪玩。",
      highlight: "订单页 Tab",
      visualSlot: "boss-07-orders",
      visualLabel: "orders.html 订单列表",
    },
    {
      id: "boss-8",
      title: "完成与评价",
      caption:
        "陪玩申请完成后，你确认完成订单；随后可在订单页给陪玩评分与文字评价。",
      highlight: "确认完成 / 评价陪玩",
      visualSlot: "boss-08-review",
      visualLabel: "确认完成 + 评价弹窗",
    },
  ];

  /** Companion apply Production order: 须知 → 基本 → 游戏 → 上传 → 认证二选一 */
  var companionSteps = [
    {
      id: "pw-1",
      title: "申请成为陪玩",
      caption: "从首页「申请陪玩」或「我的 → 申请成为陪玩」进入申请页。",
      highlight: "申请入口",
      visualSlot: "pw-01-apply-entry",
      visualLabel: "companion-apply.html 入口",
    },
    {
      id: "pw-2",
      title: "阅读陪玩制度",
      caption: "第一步必须阅读并勾选同意平台陪玩制度，才能继续。",
      highlight: "我已阅读并同意",
      visualSlot: "pw-02-rules",
      visualLabel: "申请 Step1 · 陪玩制度",
    },
    {
      id: "pw-3",
      title: "填写基本与游戏资料",
      caption:
        "填写昵称、年龄、地区、联系方式，以及可接游戏、服务、段位、接单价格（RM/小时）等真实字段。",
      highlight: "基本资料 / 游戏资料",
      visualSlot: "pw-03-profile-fields",
      visualLabel: "申请 Step2–3 · 资料表单",
    },
    {
      id: "pw-4",
      title: "上传头像与展示内容",
      caption: "头像与试音（约 10–60 秒）为必填；相册、战绩图、展示视频按页面说明选填。",
      highlight: "头像 / 试音",
      visualSlot: "pw-04-media",
      visualLabel: "申请 Step4 · 媒体上传",
    },
    {
      id: "pw-5",
      title: "身份验证（二选一）",
      caption:
        "身份证认证或押金认证二选一（不可同时要求两项）。另需填写结款资料（银行卡 / DuitNow / TNG / 支付宝）。",
      highlight: "身份证 或 押金",
      visualSlot: "pw-05-credential",
      visualLabel: "申请 Step5 · 认证方式",
    },
    {
      id: "pw-6",
      title: "提交审核",
      caption: "提交后等待管理员审核。提交申请 ≠ 自动成为陪玩。",
      highlight: "提交申请",
      visualSlot: "pw-06-submit",
      visualLabel: "审核状态页",
    },
    {
      id: "pw-7",
      title: "审核通过 · 进入工作台",
      caption: "审核通过后进入陪玩工作台；公开资料页会显示你的陪玩 ID（以系统分配为准）。",
      highlight: "工作台",
      visualSlot: "pw-07-dashboard",
      visualLabel: "/companion/dashboard",
    },
    {
      id: "pw-8",
      title: "抢单、完成与收入",
      caption:
        "在抢单大厅接单；订单完成后到收益中心查看收入并申请提现（按平台现有规则，不做额外计算）。",
      highlight: "抢单大厅 / 收益中心",
      visualSlot: "pw-08-earn",
      visualLabel: "order-hall + earnings",
    },
  ];

  global.MCJGuideTutorialConfig = {
    version: "20260916-v1",
    routes: ROUTES,
    roles: {
      boss: {
        id: "boss",
        cardTitle: "我是老板",
        cardEmoji: "🐱",
        cardDesc: "第一次下单 / 付款 / 查看订单",
        flowTitle: "老板第一次下单",
        doneTitle: "完成 🎉",
        doneBody: "现在去找你的陪玩吧",
        doneCta: "前往陪玩大厅",
        doneHref: ROUTES.hall,
        steps: bossSteps,
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
      },
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
