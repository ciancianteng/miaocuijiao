# 线上「部分用户无法打开网页」排查报告

**日期：** 2026-09-08  
**对象：** `https://www.meowcuijiao.com`  
**约束：** 不假设是用户手机硬件问题；只读排查，无 Production mutation。

---

## 执行摘要

| 项 | 结论 |
|----|------|
| **此刻从公网打开首页** | **可打开**（HTTP 200，HTML 含品牌/大厅文案；浏览器冒烟 PASS） |
| **是否存在网站侧风险** | **是** — 多条会让「部分用户」体感为打不开 / 白屏 / 一直转圈 |
| **是否全站宕机** | **否** — DNS/SSL/CDN/首页当前正常 |
| **是否地区防火墙配置** | **仓库内无** IP/geo block；API 仅部署 `hkg1` |

---

## 检查项对照

### 1. Vercel deployment / 地区

| 信号 | 结果 |
|------|------|
| 静态 HTML | `200`，`server: Vercel`，HSTS 开启 |
| Edge 探测 | 本环境多次命中 `x-vercel-id: pdx1::…`（CDN 边缘，不等于宕机） |
| Serverless | `vercel.json` → `"regions": ["hkg1"]`（亚洲函数区，合理） |
| Apex | `meowcuijiao.com` **308 →** `https://www.meowcuijiao.com/` |
| 首页体积 | ~240KB HTML + ~230KB 主 JS bundle，均可 200 |

**判断：** 未见「全地区部署失败」。部分用户慢/超时更可能是 **到 Vercel/Supabase 的网络路径**（尤其跨境），而非 Vercel 全局 down。

### 2. DNS / SSL / CDN

| 信号 | 结果 |
|------|------|
| NS | Namecheap BasicDNS（`dns1/dns2.registrar-servers.com`） |
| Apex A | `76.76.21.21`（Vercel） |
| www CNAME | `cname.vercel-dns.com` |
| TLS | Let’s Encrypt，`CN=www.meowcuijiao.com`，有效至 **2026-11-11** |
| HTTP→HTTPS | 308 正常 |
| 历史风险 | 仓库文档明确记载过 **WHOIS suspension / parking NS** 会导致全站不可达（`scripts/check-meowcuijiao-dns.mjs`、`dns-meowcuijiao-recipe.mjs`） |

**判断：** **当前 DNS/SSL 健康**。若用户报告窗口与域名解锁前后重叠，需对照当时 WHOIS；**现今主因不在 DNS 全挂**。

### 3–4. Safari iOS / Chrome Android / 微信内置浏览器

| 风险 | 说明 | 易失败环境 |
|------|------|------------|
| **ES Module only** | Vite 8 无 `@vitejs/plugin-legacy` / `nomodule`；主入口 `/assets/index-*.js` 为 `type="module"` | 旧 Android WebView、旧版微信 X5、极老 Safari |
| **大量依赖模块图** | 模块加载失败 → HTML 壳可能在，但交互/部分区块空；弱网易超时 | 弱网微信、校园网 |
| **无 Service Worker** | 无离线壳；首屏必须拉到 HTML+CSS+JS | 断网/强代理 |
| **布局已有微信/Safari 适配** | `mcj-safe-area.css` 等 | 一般不导致「打不开」 |
| **X-Frame-Options: SAMEORIGIN** | 不影响顶层打开；可能影响微信分享预览 iframe | 分享卡片预览异常 ≠ 打不开 |

浏览器冒烟（Chromium）：桌面 + 窄屏均可渲染首页品牌与入口；最终控制台干净。**曾出现间歇 CSS `ERR_FAILED`**（后续重试成功）——符合弱网/并发，不完全是「路径 404」（带 hash 的 `/assets/*-*.css` 实测 200）。`/favicon.ico` **404**（次要）。

### 5. Supabase Auth cookie / session

| 事实 | 含义 |
|------|------|
| 会话主要在 **localStorage / sessionStorage JWT**，不是 Cookie Session | **无 SameSite Cookie 跨站问题** |
| 私有页 `denyUnauthed`：`visibility:hidden` + **清空 `body.innerHTML`** 再 `location.replace(login)` | 会话失效/无 token 时用户看到 **白屏一瞬或卡住**，极易报成「打不开」 |
| `portal-early-gate.js` 挂在 `mine` / companion 等 | 同上 |
| 首页 `/` **未**走 deny 门禁 | 纯首页打不开 ≠ auth gate（除非用户把「登录后页」说成网站） |
| WeChat / ITP / 无痕 | localStorage 被清或不可用 → 私有页反复踢登录 / 白屏 | 微信、Safari 无痕、清缓存后进「我的/订单」 |

**判断：** Auth **不是**首页静态打不开的主因，但是 **登录后页面「打不开」** 的高概率网站侧原因。

### 6–7. 前端 JS runtime / console

| 信号 | 结果 |
|------|------|
| 首页 HTML | 服务端已含品牌/大厅/入口文案（**非纯白 SPA 空壳**） |
| 主 bundle | 200；含 `?.` / `??` / `catch{}`（现代语法，模块浏览器通常 OK） |
| 动态 CDN | 恢复密码/聊天可回落 jsDelivr；**中国网络偶发拦 CDN** → 功能页失败 |
| 控制台 | 冒烟最终 0 error；间歇资源失败 + favicon 404 |

**判断：** 完整白屏更像 **模块/CSS 未加载完** 或 **auth gate 清 DOM**，而非单一未捕获异常（需线上 RUM 才能钉死）。

### 8. API 地区限制

| 信号 | 结果 |
|------|------|
| 仓库 | **无** Cloudflare/Vercel Firewall/geo deny 配置 |
| CORS | `FRONTEND_ORIGINS` 白名单；同源 `/api` 不依赖 CORS |
| API | `/api/auth?action=health` → `configured:true` |
| 函数区 | 仅 `hkg1` — 非「禁区」，但欧美用户 API 延迟更高 |
| 外部 | `*.supabase.co`、偶发 `cdn.jsdelivr.net` — **跨境/境内网络差异**会影响「部分用户」 |

---

## 重点环境复现结论

| 环境 | 打开首页（静态） | 高风险失败点 |
|------|------------------|--------------|
| **iPhone Safari** | 现代版本应可开 | 无痕 localStorage；私有页 auth 白屏；弱网 module 超时 |
| **微信内置浏览器** | 多数可开 | 弱网/缓存；旧 X5 对 ES module；清存储后进「我的」白屏；jsDelivr |
| **Chrome Mobile** | 应可开 | 弱网；私有页 session；偶发资源并发失败 |

本环境无法真机微信；以上为代码 + 公网探测 + Chromium 冒烟推断。

---

## A. 是否网站问题？

**是（部分场景），不是「全站挂了」。**

- **基础设施此刻正常** → 不能把所有投诉归为手机坏了。  
- **网站侧确定问题：**  
  1. 私有路由 **主动白屏清 DOM** 的 auth gate  
  2. **无 legacy / nomodule** 回退（旧 WebView）  
  3. 会话只靠 **Web Storage**（微信/无痕脆弱）  
  4. 历史 DNS 事故面仍存在（运维流程风险）  
  5. favicon 404；缺客户端错误上报，难以证明「谁失败」  
- **网站外但影响打开体验：** 用户到 Vercel/Supabase/CDN 的网络质量（尤其跨境/运营商）。

---

## B. 哪些用户环境容易失败？

1. **打开的是登录后页**（我的 / 订单 / 陪玩端 / 后台）且 token 过期或 storage 不可用 → 白屏/跳登录失败感最强  
2. **旧微信 Android WebView / 很老的系统浏览器** → ES module 加载失败  
3. **弱网 / 跨境不稳定** → HTML 到了但 JS/CSS 超时，像半残或「打不开」  
4. **微信内清缓存 / 切换账号 / 无痕 Safari** → storage 丢，私有页异常  
5. **依赖 jsDelivr 的功能路径**（恢复密码 SDK 回落等）在部分网络失败  
6. （历史）域名 WHOIS/DNS 异常窗口期的所有用户  

相对不易：仅打开首页的现代 Safari / Chrome（当前冒烟 PASS）。

---

## C. 修复 PR 方案（建议拆分）

### PR-A（P0 体验）— Auth gate 反白屏

- `denyUnauthed` / `portal-early-gate`：**禁止** `body.innerHTML = ""`；改为可见「正在跳转登录…」+ 超时兜底链接  
- 私有页 restore session 超时给出明确错误，而不是空白  
- 验收：无 token 打开 `/mine.html` 永不长时间白屏  

### PR-B（P1 兼容）— 构建目标与旧 WebView

- 增加 `@vitejs/plugin-legacy` 或明确 `build.target` + browserslist（iOS 15+ / Chrome 90+ 书面化）  
- 对不支持 module 的 UA 显示「请升级微信/浏览器」静态提示（`<script nomodule>`）  
- 验收：人为禁用 module 时有可读提示，而非空白交互  

### PR-C（P1 可观测）— 打开失败可证伪

- 接入轻量 RUM / `window.onerror` + `unhandledrejection` 打点（采样）到自有 `/api` 或第三方  
- 记录：UA、path、module load fail、首屏资源状态码  
- 补 `/favicon.ico` 避免无意义 404  

### PR-D（P2 网络韧性）

- 关键 CDN 依赖（supabase-js 优先本地 `/vendor`，已有则强化，避免微信内必打 jsDelivr）  
- 关键资源超时与重试；关键 CSS/JS `onerror` 提示「网络不佳，点重试」  
- 评估 API 多 region 或边缘缓存只读接口（非必须立刻）  

### PR-E（运维）— DNS 复发防护

- 监控 NS/A/CNAME 漂移（复用 `check-meowcuijiao-dns.mjs` cron）  
- WHOIS lock / parking IP 告警  

### 不建议

- 把问题一概推给「用户手机」  
- 为微信关掉 `X-Frame-Options` 全身（安全回退需单独评估）  
- 在未加 RUM 前认定「纯地区封锁」（仓库无 geo deny）  

---

## 证据索引

- Live：`GET /` 200；TLS OK；apex 308→www  
- DNS：`node scripts/check-meowcuijiao-dns.mjs` → BasicDNS + Vercel A/CNAME  
- `vercel.json` regions `hkg1`；无 firewall 配置  
- Auth 白屏：`src/role-gates.js` `denyUnauthed`；`public/portal-early-gate.js`  
- 构建：`vite.config.js` 无 legacy plugin  
- 冒烟：Chromium 桌面/窄屏首页可渲染  

---

## 下一步

1. 向投诉用户收集：**完整 URL**、微信/Safari/Chrome、是否登录后页、截图（白屏 vs 报错）。  
2. 优先合入 **PR-A（反白屏）** + **PR-C（RUM）**，用数据验证 B 类环境。  
3. 真机矩阵：iOS Safari、微信 iOS/Android、Chrome Android 各测首页 + `/mine.html`（未登录）。

*Investigation only · no production migration · 2026-09-08*
