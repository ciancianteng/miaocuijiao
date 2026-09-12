# PR #238 Hardcoded Strings Audit

Generated: 2026-09-12T18:25:18.389Z

| Surface file | Hardcoded ZH hits (approx) |
|---|---:|
| `src/companion-workbench.js` | 829 |
| `src/companion-application.js` | 398 |
| `src/support-chat.js` | 152 |
| `orders.html` | 151 |
| `src/profile-detail.js` | 106 |
| `src/place-order-modal.js` | 95 |
| `mine.html` | 69 |
| `index.html` | 50 |
| `src/boss-header.js` | 37 |
| `companion-center.html` | 19 |
| `src/companion-hall.js` | 17 |
| `src/forgot-password.js` | 15 |
| `src/home-banner.js` | 15 |
| `src/site-data.js` | 12 |
| `src/home-popularity.js` | 11 |
| `src/home-announcements.js` | 3 |
| `login.html` | 1 |
| `src/home-daily-stats.js` | 0 |

## Top samples

### src/companion-workbench.js

- L43: `['dashboard',navLabel('companion.nav.dashboard','工作台'),'/companion/dashboard'],`
- L44: `['hall',navLabel('companion.nav.hall','抢单大厅'),'/companion/order-hall'],`
- L45: `['orders',navLabel('companion.nav.orders','我的订单'),'/companion/orders'],`
- L46: `['earnings',navLabel('companion.nav.earnings','收益中心'),'/companion/earnings'],`
- L47: `['profile',navLabel('companion.nav.profile','我的资料（公开）'),'/companion/profile'],`
- L48: `['account',navLabel('companion.nav.account','账号中心（隐私）'),'/companion/account'],`
- L49: `['messages',navLabel('companion.nav.messages','消息中心'),'/companion/messages'],`
- L50: `['settings',navLabel('companion.nav.settings','设置'),'/companion/settings']`
- L55: `['dashboard',navLabel('companion.bottom.dashboard','工作台'),'/companion/dashboard'],`
- L56: `['hall',navLabel('companion.bottom.hall','抢单'),'/companion/order-hall'],`
- L57: `['orders',navLabel('companion.bottom.orders','订单'),'/companion/orders'],`
- L58: `['earnings',navLabel('companion.bottom.earnings','收益'),'/companion/earnings'],`

### src/companion-application.js

- L66: `"性格": ["随和", "高冷", "活泼", "幽默", "社恐", "社牛", "粘人", "高情商", "氛围感", "耐心", "话多"],`
- L67: `"陪玩风格": ["娱乐", "上分", "护航", "指挥", "教学", "技术流", "长期搭子", "深夜档", "全天在线"]`
- L69: `positions: { "擅长位置": ["指挥", "输出", "辅助", "打野", "中路", "射手", "坦克", "自由位", "狙击位", "突破位"] },`
- L70: `modes: { "可接模式": [] },`
- L71: `mainGames: { "主打服务": [] }`
- L74: `var rankOptions = ["青铜", "白银", "黄金", "铂金", "钻石", "星耀", "王者", "荣耀王者", "大师", "宗师", "超凡", "无畏战神", "其他"];`
- L272: `"浏览器本地草稿空间已满（不是云端 Storage 配额）。已改为仅保存图片云端地址；请刷新后重新上传头像/相册。"`
- L301: `"浏览器本地草稿空间已满（不是云端 Storage 配额）。已改为仅保存图片云端地址；请刷新后重新上传头像/相册。"`
- L323: `chinaRateSource: "支付页面实时汇率",`
- L325: `description: "认证押金用于保障平台服务秩序，最终支付金额以支付页面显示为准。",`
- L326: `refundRule: "退出俱乐部并完成全部订单结算后，可按平台规则申请退还押金。",`
- L372: `name: (u && (u.name || u.nickname || u.email)) || "当前账号",`

### src/support-chat.js

- L47: `serviceStatus: "等待客服接待", // i18n via statusLabel helpers`
- L69: `{ key: "other", labelKey: "support.type_other", label: "普通咨询（无需下单）", needsOrder: false },`
- L70: `{ key: "new_order", labelKey: "support.type_new_order", label: "新订单咨询", needsOrder: false },`
- L71: `{ key: "current_order", labelKey: "support.type_current_order", label: "当前订单问题", needsOrder: true },`
- L72: `{ key: "recharge", labelKey: "support.type_recharge", label: "充值问题", needsOrder: false },`
- L73: `{ key: "refund", labelKey: "support.type_refund", label: "退款售后", needsOrder: true },`
- L264: `state.authError = "请先登录后使用在线客服";`
- L269: `var ready = auth && auth.ensureSession ? withTimeout(auth.ensureSession(), 4000, "登录校验").catch(function () { return null; }) : Promise.resolve();`
- L292: `state.authError = "当前登录的是陪玩账号，请使用老板账号打开在线客服。";`
- L294: `state.authError = "当前登录的是客服账号，请使用老板账号打开在线客服。";`
- L296: `state.authError = "当前账号不是老板客户身份，无法使用老板端在线客服。";`
- L316: `var msg = (err && err.message) || "账号资料加载失败，请重试";`

### orders.html

- L121: `<header class="topbar"><a class="brand" href="index.html"><img src="/assets/meow-cuijiao-brand-96.webp" alt="MEOW CUI JIAO" width="32" height="32" decoding="asy`
- L128: `<div class="modal-head"><h2>订单详情</h2><button class="close" type="button" data-close aria-label="关闭">×</button></div>`
- L135: `<div class="modal-head"><h2>评价陪玩</h2><button class="close" type="button" data-review-close aria-label="关闭">×</button></div>`
- L139: `<div class="review-stars" id="reviewStars" role="radiogroup" aria-label="星级评分"></div>`
- L142: `<label>评价内容<textarea name="content" id="reviewContent" rows="4" maxlength="500" placeholder="写下你的评价（选填）"></textarea></label>`
- L144: `<button class="order-btn primary" type="submit" id="reviewSubmitBtn">提交评价</button>`
- L145: `<button class="order-btn" type="button" data-review-close>取消</button>`
- L185: `var statusText=(window.MCJOrderStatus&&window.MCJOrderStatus.LABELS)||{awaiting_payment:'待付款',payment_review:'待人工审核',pending:'待客服处理',claimed:'等待陪玩确认',waiting_bo`
- L188: `function money(v){if(window.MCJCurrency)return window.MCJCurrency.formatPlain(v);var n=Number(v||0);return (Number.isFinite(n)?n:0).toFixed(2).replace(/\.00$/,'`
- L191: `function isPaymentReview(o){return !!(o&&(o.paymentReview||o.paymentStatus==='待审核'||o.paymentStatus==='待人工审核'||/待审核|待人工审核/.test(String(o.statusText||o.paymentSt`
- L193: `if(o.reviewed||o.status==='reviewed')return '已评价';`
- L194: `if(o.status==='in_progress'&&o.completionPending)return o.autoConfirmPaused?'等待处理订单问题':'等待您确认完成';`

### src/profile-detail.js

- L28: `return (Number.isFinite(n) ? n : 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";`
- L31: `if (window.MCJCurrency) return window.MCJCurrency.formatRate(v, unit || "小时");`
- L32: `return money(v).replace(/\s*猫粮$/, "") + " 猫粮/" + (unit || "小时");`
- L72: `var text = (c && (c.availabilityText || c.status || c.onlineStatus)) || "离线";`
- L74: `code === "online" || /在线/.test(text)`
- L76: `: code === "busy" || /忙碌/.test(text)`
- L78: `: code === "paused" || /暂停/.test(text)`
- L99: `if (!Number.isFinite(v) || v <= 0) return "暂无数据";`
- L119: `friendly = "该陪玩资料不存在";`
- L121: `friendly = "该陪玩资料不存在或已下架";`
- L130: `'<section class="detail-card"><h1>暂无资料</h1><p>' +`
- L134: `'<a class="order-now" href="companion-center.html" style="opacity:.9">返回陪玩大厅</a></div></section>';`

### src/place-order-modal.js

- L14: `var LEGACY_SERVICE_NAMES = { "陪玩": 1, "护航": 1, "跑刀": 1, "代肝": 1, "自定义": 1, "陪玩服务": 1, "陪聊服务": 1 };`
- L16: `{ id: "1", label: "1 小时", value: 1 },`
- L17: `{ id: "2", label: "2 小时", value: 2 },`
- L18: `{ id: "3", label: "3 小时", value: 3 },`
- L19: `{ id: "custom", label: "自定义", value: 0, custom: true },`
- L77: `return "🐱 " + money(v).toFixed(2).replace(/\.00$/, "") + " 猫粮";`
- L186: `btn.textContent = "提交中…";`
- L198: `btn.textContent = "提交中…";`
- L204: `btn.textContent = "支付方式加载中…";`
- L209: `btn.textContent = "暂无可用支付方式";`
- L214: `btn.textContent = "请选择支付方式";`
- L218: `btn.textContent = "确认订单并付款";`

### mine.html

- L261: `<header class="topbar"><a class="brand" href="index.html"><img src="assets/meow-cuijiao-brand-96.webp" alt="MEOW CUI JIAO" width="24" height="24" decoding="asyn`
- L265: `<div class="modal-head"><h2 id="featureModalTitle">设置</h2><button class="close" type="button" data-close-feature aria-label="关闭">×</button></div>`
- L271: `<div class="modal-head"><h2>编辑资料</h2><button class="close" type="button" data-close>×</button></div>`
- L274: `<div class="avatar-edit-preview" id="avatarPreview" aria-label="当前头像">B</div>`
- L276: `<button class="boss-btn" type="button" id="avatarPickBtn">更换头像</button>`
- L279: `<p class="avatar-edit-hint">支持 JPG / PNG / WEBP，最大 4MB</p>`
- L284: `<button class="boss-btn" type="submit">保存资料</button>`
- L343: `function avatarHtml(user){var src=user&&user.avatarUrl;if(src)return '<img src="'+esc(src)+'" alt="头像">';var name=(user&&user.displayName)||'老板';return esc(name`
- L344: `function statusText(s){return {active:'正常',disabled:'停用',pending:'待审核'}[s]||s||'-'}`
- L349: `if(src){avatarPreview.innerHTML='<img src="'+esc(src)+'" alt="当前头像">';return}`
- L350: `var name=String(displayName||(state.user&&state.user.displayName)||'老板');`
- L357: `reader.onerror=function(){reject(new Error('读取图片失败'))};`

### index.html

- L22: `<meta property="og:title" content="妙脆角 MEOW CUI JIAO｜专业游戏陪玩">`
- L23: `<meta property="og:description" content="专业陪玩，每一场游戏认真对待每一位热爱电竞的你。">`
- L29: `<meta property="og:image:alt" content="妙脆角 MEOW CUI JIAO 品牌形象">`
- L35: `<meta property="og:image:alt" content="妙脆角 MEOW CUI JIAO｜专业游戏陪玩">`
- L3525: `<header class="site-header mcj-boss-header" data-mcj-boss-header="1" aria-label="顶部导航">`
- L3527: `<a class="mcj-header-brand" href="/" aria-label="MEOW CUI JIAO 妙脆角 首页">`
- L3534: `<nav class="mcj-desk-nav" aria-label="桌面主导航">`
- L3535: `<a href="index.html" class="active">首页</a>`
- L3536: `<a href="companion-center.html">大厅</a>`
- L3537: `<a href="orders.html">订单</a>`
- L3538: `<a href="support.html?start=1">客服</a>`
- L3539: `<a href="login.html" data-mcj-boss-login>登录</a>`
