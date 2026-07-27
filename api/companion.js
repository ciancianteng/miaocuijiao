const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ORDER_STATUS_TEXT = {
  awaiting_payment: "待付款确认",
  pending: "待接单",
  claimed: "陪玩已申请",
  waiting_boss_confirm: "待老板确认",
  confirmed: "待开始",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  refund_requested: "退款处理中",
  refunded: "已退款"
};

function json(res, status, data) { res.status(status).json(data); }
function hasDb() { return REQUIRED_ENV.every((key) => process.env[key]); }
function anonHeaders(extra = {}) { return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra }; }
function serviceHeaders(extra = {}) { return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...extra }; }
function authUrl(path) { return `${process.env.SUPABASE_URL}/auth/v1/${path}`; }
function restUrl(table, query = "") { return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`; }
function nowIso() { return new Date().toISOString(); }
function todayKey() { return new Date().toISOString().slice(0, 10); }
function monthKey() { return new Date().toISOString().slice(0, 7); }
function money(value) { const n = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; }
async function parseBody(req) { if (req.body && typeof req.body === "object") return req.body; const chunks=[]; for await (const chunk of req) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; } }
async function supabaseJson(url, init = {}) { const response = await fetch(url, init); const text = await response.text(); let body=null; try { body=text?JSON.parse(text):null; } catch { body=text; } if(!response.ok) throw new Error(body?.error_description || body?.message || body?.hint || body?.details || "Supabase 请求失败"); return body; }
function tokenFrom(req) { return String(req.headers["x-mcj-companion-token"] || req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(); }
async function authUserFromToken(token) { return supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) }); }
async function profileById(id) { const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}&limit=1`), { headers: serviceHeaders() }); return rows?.[0] || null; }
async function companionProfile(userId) { const rows = await supabaseJson(restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`), { headers: serviceHeaders() }); return rows?.[0] || null; }
async function requireCompanion(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录陪玩端。"), { status: 401 });
  const authUser = await authUserFromToken(token);
  const profile = await profileById(authUser.id);
  if (!profile || profile.role !== "companion") throw Object.assign(new Error("无权访问陪玩端。"), { status: 403 });
  if (profile.status === "disabled") throw Object.assign(new Error("陪玩账号已停用。"), { status: 403 });
  const companion = await companionProfile(profile.id);
  return { token, authUser, profile, companion };
}
function safePlayer(profile = {}, companion = {}) {
  return {
    id: profile.id,
    uid: profile.id,
    name: companion.nickname || profile.display_name || profile.email || "陪玩",
    avatar: profile.avatar_url || companion.card_image_url || "/assets/meow-cuijiao-brand.jpg",
    mainGame: companion.game || "",
    game: companion.game || "",
    level: companion.level_name || "未设置",
    rawPrice: money(companion.price),
    price: money(companion.price),
    bio: companion.description || "",
    onlineStatus: companion.online_status || "offline",
    workStatus: companion.online_status === "online" ? "可接单" : "暂停接单",
    accountStatus: profile.status || "pending",
    auditStatus: companion.verification_status || "pending",
    depositStatus: companion.deposit_status || "pending",
    verificationStatus: companion.verification_status || "pending",
    orderCommissionRate: money(companion.commission_rate) || 80,
    raw: { ...profile, ...companion }
  };
}
function canWork(profile = {}, companion = {}) { return profile.status === "active" && companion.verification_status === "approved"; }
function canAccept(profile = {}, companion = {}) { return canWork(profile, companion) && companion.online_status === "online"; }
function viewOrder(row = {}, boss = {}) {
  const rate = money(row.commission_rate || row.player_commission_rate || row.companion_rate || 80) || 80;
  const amount = money(row.total_amount);
  return {
    id: row.id,
    orderNo: row.order_no || row.id,
    orderType: row.order_type || "custom",
    bossName: boss.display_name || boss.email || "老板",
    bossUid: row.boss_id || "",
    game: row.game || "",
    serviceContent: row.description || row.title || "",
    duration: row.hours ? `${row.hours}小时` : "",
    amount,
    playerIncome: Math.round(amount * rate) / 100,
    requiredLevel: "不限",
    requiredTags: "无特殊标签",
    orderStatus: ORDER_STATUS_TEXT[row.status] || row.status || "待付款确认",
    status: row.status,
    statusText: ORDER_STATUS_TEXT[row.status] || row.status || "待付款确认",
    appointmentAt: row.created_at || "",
    createdAt: row.created_at || "",
    raw: row
  };
}
async function bossesForOrders(orders) { const ids=[...new Set((orders||[]).map((row)=>row.boss_id).filter(Boolean))]; if(!ids.length) return {}; const rows=await supabaseJson(restUrl("profiles", `?id=in.(${ids.map(encodeURIComponent).join(",")})`), { headers: serviceHeaders() }); return Object.fromEntries((rows||[]).map((row)=>[row.id,row])); }
async function loadOrdersFor(profile, companion) {
  const myRows = await supabaseJson(restUrl("orders", `?companion_id=eq.${encodeURIComponent(profile.id)}&order=created_at.desc&limit=200`), { headers: serviceHeaders() });
  const openRows = canAccept(profile, companion) ? await supabaseJson(restUrl("orders", "?status=eq.pending&order=created_at.desc&limit=100"), { headers: serviceHeaders() }) : [];
  const bossMap = await bossesForOrders([...(myRows||[]), ...(openRows||[])]);
  return {
    myOrders: (myRows || []).map((row) => viewOrder(row, bossMap[row.boss_id] || {})),
    openOrders: (openRows || []).map((row) => viewOrder(row, bossMap[row.boss_id] || {}))
  };
}
async function transactionsFor(userId) { const rows = await supabaseJson(restUrl("transactions", `?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=200`), { headers: serviceHeaders() }); return Array.isArray(rows) ? rows : []; }
function summaryFrom(myOrders, transactions) {
  const today = todayKey();
  const month = monthKey();
  const incomeRows = (transactions || []).filter((row) => row.transaction_type === "companion_income" && row.status !== "cancelled");
  return {
    todayOrders: myOrders.filter((o) => String(o.createdAt || "").slice(0,10) === today).length,
    waitingConfirm: myOrders.filter((o) => o.status === "waiting_boss_confirm").length,
    waitingStart: myOrders.filter((o) => o.status === "confirmed").length,
    runningOrders: myOrders.filter((o) => o.status === "in_progress").length,
    completedOrders: myOrders.filter((o) => o.status === "completed").length,
    monthIncome: incomeRows.filter((row) => String(row.created_at || "").slice(0,7) === month).reduce((n,row)=>n+money(row.amount),0),
    withdrawable: incomeRows.reduce((n,row)=>n+money(row.amount),0),
    unreadMessages: 0,
    monthReviews: 0
  };
}
async function bootstrapData(profile, companion) {
  const player = safePlayer(profile, companion || {});
  const permissions = { canLogin: true, canWork: canWork(profile, companion || {}), canSetAvailable: profile.status === "active", canAcceptOrder: canAccept(profile, companion || {}), canStartOrder: canWork(profile, companion || {}), canWithdraw: canWork(profile, companion || {}), messagesMode: "system_only", lockReason: canWork(profile, companion || {}) ? "" : "账号正在审核中" };
  const { myOrders, openOrders } = await loadOrdersFor(profile, companion || {});
  const transactions = await transactionsFor(profile.id);
  const summary = summaryFrom(myOrders, transactions);
  const earningDetails = transactions.filter((row) => row.transaction_type === "companion_income").map((row) => ({ id: row.id, orderId: row.order_id, type: "陪玩收入", amount: money(row.amount), status: row.status || "completed", createdAt: row.created_at }));
  return { serverTime: nowIso(), player, permissions, summary, openOrders, myOrders, conversations: [], messages: [], earnings: { todayIncome: 0, weekIncome: summary.monthIncome, monthIncome: summary.monthIncome, withdrawable: summary.withdrawable }, earningDetails, withdrawalRules: { monthlyLimit: 0, usedThisMonth: 0, remainingThisMonth: 0, minAmount: 0, currentAccount: "" }, withdrawals: [], verification: { identityStatus: companion?.verification_status || "pending", contactStatus: companion?.verification_status || "pending", bankStatus: companion?.verification_status || "pending", depositStatus: companion?.deposit_status || "pending" }, deposit: { status: companion?.deposit_status || "pending" }, playerGames: [], media: [], levelInfo: {}, invitation: { records: [] }, reviews: [], orderStatuses: Object.values(ORDER_STATUS_TEXT), paymentStatuses: [] };
}
async function ensureConversation(order) { const existing=await supabaseJson(restUrl("conversations", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`), { headers: serviceHeaders() }); if(existing?.[0]) return existing[0]; const rows=await supabaseJson(restUrl("conversations"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ boss_id: order.boss_id, companion_id: order.companion_id || null, customer_service_id: order.customer_service_id || null, order_id: order.id, status: "open", created_at: nowIso(), updated_at: nowIso() }) }); return rows?.[0] || null; }
async function addSystemMessage(order, senderId, senderRole, content) { const conversation=await ensureConversation(order); if(!conversation) return; await supabaseJson(restUrl("messages"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ conversation_id: conversation.id, sender_id: senderId, sender_role: senderRole, message_type: "system", content, order_id: order.id, created_at: nowIso() }) }); }
async function claimOrder(profile, companion, id) {
  if (!canAccept(profile, companion)) throw Object.assign(new Error(canWork(profile, companion) ? "请先切换为上线接单。" : "账号正在审核中，不能抢单。"), { status: 403 });
  const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&status=eq.pending`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ companion_id: profile.id, status: "waiting_boss_confirm", accepted_at: nowIso() }) });
  if (!rows?.length) throw Object.assign(new Error("该订单已被其他陪玩领取。"), { status: 409 });
  const order = rows[0];
  await addSystemMessage(order, profile.id, "companion", "陪玩已申请接单，等待老板确认。");
  return order;
}
async function patchOwnOrder(profile, id, expected, patch, message) {
  const beforeRows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&companion_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
  const before = beforeRows?.[0];
  if (!before) throw Object.assign(new Error("订单不存在。"), { status: 404 });
  if (expected && before.status !== expected) throw Object.assign(new Error("当前订单状态不能执行该操作。"), { status: 409 });
  const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&companion_id=eq.${encodeURIComponent(profile.id)}`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(patch) });
  const saved = rows?.[0] || { ...before, ...patch };
  if (message) await addSystemMessage(saved, profile.id, "companion", message);
  return saved;
}

export default async function handler(req, res) {
  if (!hasDb()) return json(res, req.method === "GET" ? 200 : 503, { ok: req.method === "GET", data: { player: {}, permissions: { canAcceptOrder: false, lockReason: "真实数据库未配置" }, summary: { todayOrders: 0, waitingConfirm: 0, runningOrders: 0, completedOrders: 0, monthIncome: 0, withdrawable: 0 }, openOrders: [], myOrders: [], earnings: {}, earningDetails: [] }, message: "未配置 Supabase，陪玩端不返回假业务数据。" });
  try {
    const action = String(req.method === "GET" ? req.query.action || "bootstrap" : (req.body?.action || ""));
    if (action === "login") {
      const body = await parseBody(req); const account=String(body.account || body.email || "").trim().toLowerCase(); const password=String(body.password || "");
      if (!account || !password) return json(res,400,{ok:false,message:"请输入邮箱和密码"});
      const auth = await supabaseJson(authUrl("token?grant_type=password"), { method:"POST", headers: anonHeaders(), body: JSON.stringify({ email: account, password }) });
      const profile = await profileById(auth.user.id);
      if (!profile || profile.role !== "companion") return json(res,403,{ok:false,message:"无权访问陪玩端"});
      if (profile.status === "disabled") return json(res,403,{ok:false,message:"陪玩账号已停用"});
      const companion = await companionProfile(profile.id);
      return json(res,200,{ok:true,session:{token:auth.access_token,user:safePlayer(profile, companion || {}),remember:!!body.remember}});
    }
    if (action === "register") {
      const body = await parseBody(req); const email=String(body.email || body.account || "").trim().toLowerCase(); const password=String(body.password || ""); const nickname=String(body.nickname || body.name || "").trim();
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json(res,400,{ok:false,message:"请输入有效邮箱"});
      if (!password || password.length < 8) return json(res,400,{ok:false,message:"密码至少 8 位"});
      if (!nickname) return json(res,400,{ok:false,message:"请输入陪玩昵称"});
      const created = await supabaseJson(authUrl("admin/users"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: nickname } }) });
      await supabaseJson(restUrl("profiles"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ id: created.id, role: "companion", display_name: nickname, email, phone: String(body.phone || ""), status: "active", created_at: nowIso() }) });
      await supabaseJson(restUrl("companion_profiles"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ user_id: created.id, nickname, verification_status: "pending", deposit_status: "pending", online_status: "offline", created_at: nowIso(), updated_at: nowIso() }) });
      const auth = await supabaseJson(authUrl("token?grant_type=password"), { method:"POST", headers: anonHeaders(), body: JSON.stringify({ email, password }) });
      const profile = await profileById(created.id);
      const companion = await companionProfile(created.id);
      return json(res,200,{ok:true,message:"陪玩账号已创建，请继续提交资料审核。",session:{token:auth.access_token,user:safePlayer(profile, companion || {}),remember:!!body.remember}});
    }
    const auth = await requireCompanion(req);
    const companion = auth.companion || await companionProfile(auth.profile.id) || {};
    if (req.method === "GET" && action === "bootstrap") return json(res,200,{ok:true,data:await bootstrapData(auth.profile, companion)});
    if (req.method !== "POST") return json(res,405,{ok:false,message:"Method Not Allowed"});
    const body = await parseBody(req);
    if (action === "accept_order") { const order=await claimOrder(auth.profile, companion, String(body.id || "")); return json(res,200,{ok:true,message:"申请接单成功，等待老板确认。",order}); }
    if (action === "start_order") { const order=await patchOwnOrder(auth.profile, String(body.id || ""), "confirmed", { status:"in_progress", started_at: nowIso() }, "陪玩已开始订单。"); return json(res,200,{ok:true,message:"订单已开始。",order}); }
    if (action === "complete_order" || action === "confirm_complete") { const order=await patchOwnOrder(auth.profile, String(body.id || ""), "in_progress", { status:"completed", completed_at: nowIso() }, "陪玩已完成订单。"); const rate=money(companion.commission_rate) || 80; const income=Math.round(money(order.total_amount)*rate)/100; await supabaseJson(restUrl("transactions"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ user_id: auth.profile.id, order_id: order.id, transaction_type:"companion_income", amount: income, status:"completed", note:`订单完成收入，分成比例 ${rate}%`, created_at: nowIso() }) }); return json(res,200,{ok:true,message:"订单已完成，收入已生成。",order}); }
    if (action === "set_online_status") { const status = body.online_status === "online" ? "online" : "paused"; if (auth.profile.status !== "active") return json(res,403,{ok:false,message:"账号已停用，不能接单"}); const rows=await supabaseJson(restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(auth.profile.id)}`), { method:"PATCH", headers: serviceHeaders(), body: JSON.stringify({ online_status: status, updated_at: nowIso() }) }); return json(res,200,{ok:true,message:status==="online"?"已上线接单":"已暂停接单",profile:rows?.[0]||null}); }
    if (action === "update_profile") { const patch={ nickname:String(body.nickname || ""), game:String(body.main_game || body.game || ""), description:String(body.bio || body.description || ""), card_image_url:String(body.card_image_url || body.avatar_url || ""), voice_url:String(body.voice_url || ""), price:money(body.price), online_status:body.online_status === "online" ? "online" : (companion.online_status || "offline"), updated_at:nowIso() }; if (!companion.id) await supabaseJson(restUrl("companion_profiles"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ user_id: auth.profile.id, ...patch, verification_status:"pending", deposit_status:"pending", created_at:nowIso() }) }); else await supabaseJson(restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(auth.profile.id)}`), { method:"PATCH", headers: serviceHeaders(), body: JSON.stringify(patch) }); if (body.avatar_url) await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(auth.profile.id)}`), { method:"PATCH", headers: serviceHeaders(), body: JSON.stringify({ avatar_url:String(body.avatar_url), display_name:patch.nickname || auth.profile.display_name }) }); return json(res,200,{ok:true,message:"资料已保存，等待后台审核。"}); }
    if (action === "submit_verification") { await supabaseJson(restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(auth.profile.id)}`), { method:"PATCH", headers: serviceHeaders(), body: JSON.stringify({ verification_status:"pending", deposit_status: companion.deposit_status || "pending", updated_at: nowIso() }) }); return json(res,200,{ok:true,message:"认证资料已提交，等待后台审核。"}); }
    if (action === "submit_deposit_proof") { await supabaseJson(restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(auth.profile.id)}`), { method:"PATCH", headers: serviceHeaders(), body: JSON.stringify({ deposit_status:"pending", updated_at: nowIso() }) }); return json(res,200,{ok:true,message:"押金凭证已提交，等待后台确认。"}); }
    return json(res,400,{ok:false,message:"未知陪玩端操作"});
  } catch (error) {
    return json(res,error.status || 500,{ok:false,message:error.message || "陪玩端接口异常"});
  }
}

