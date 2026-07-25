import crypto from "node:crypto";

const PLAYER_ROLES = new Set(["player", "companion", "super_admin"]);
const ORDER_STATUSES = ["待支付", "待接单", "待老板确认", "待开始", "进行中", "待确认完成", "已完成", "已取消", "售后处理中", "退款处理中", "已退款", "异常订单"];
const PAYMENT_STATUSES = ["未支付", "支付中", "已支付", "支付失败", "部分退款", "已退款"];
const CLOSED_STATUSES = new Set(["已完成", "已取消", "已退款", "异常订单"]);
const DISABLED_PATTERN = /停用|禁用|冻结|封禁|黑名单|disabled|blocked|suspended/i;
const PASS_PATTERN = /通过|已通过|启用|已启用|已缴|已缴纳|完成|已完成|approved|active|paid|verified/i;

function dbUrl(){return process.env.SUPABASE_URL || process.env.ADMIN_DATABASE_URL || ""}
function dbKey(){return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_DATABASE_SERVICE_KEY || ""}
function hasDb(){return Boolean(dbUrl() && dbKey())}
function json(res,status,data){return res.status(status).json(data)}
function endpoint(table,query=""){return `${dbUrl()}/rest/v1/${table}${query}`}
function headers(extra={}){return {apikey:dbKey(),Authorization:`Bearer ${dbKey()}`,"Content-Type":"application/json",Prefer:"return=representation",...extra}}
async function db(table,query="",init={}){
  const response=await fetch(endpoint(table,query),{...init,headers:{...headers(),...(init.headers||{})}});
  const text=await response.text();
  let body=null;
  try{body=text?JSON.parse(text):null}catch{body=text}
  if(!response.ok)throw new Error(body?.message||body?.hint||body?.details||`数据库请求失败：${table}`);
  return body;
}
async function safeRows(table,query=""){try{const rows=await db(table,query);return Array.isArray(rows)?rows:[]}catch{return []}}
function tokenSecret(){return process.env.COMPANION_SESSION_SECRET||dbKey()||"mcj-companion-dev-secret"}
function signPayload(payload){return crypto.createHmac("sha256",tokenSecret()).update(payload).digest("base64url")}
function makeToken(player){
  const payload=Buffer.from(JSON.stringify({id:player.id||player.uid,uid:player.uid||player.id,role:player.role||"companion",at:Date.now()})).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}
function readToken(token){
  try{
    const [payload,sig]=String(token||"").split(".");
    if(!payload||!sig||sig!==signPayload(payload))return null;
    return JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
  }catch{return null}
}
function hashPassword(password){return crypto.createHash("sha256").update(String(password)).digest("hex")}
function tokenFrom(req){return String(req.headers["x-mcj-companion-token"]||"")}
function money(v){const n=Number(String(v??"").replace(/[^\d.-]/g,""));return Number.isFinite(n)?n:0}
function today(){return new Date().toISOString().slice(0,10)}
function month(){return new Date().toISOString().slice(0,7)}
function isToday(v){return String(v||"").slice(0,10)===today()}
function isMonth(v){return String(v||"").slice(0,7)===month()}
function passed(v){return PASS_PATTERN.test(String(v||""))}
function accountEnabled(row){return !DISABLED_PATTERN.test(String(row.status||row.account_status||"启用"))}
function hasRole(row){return PLAYER_ROLES.has(String(row.role||"").trim()) || row.companion_enabled===true || row.can_access_companion===true}
function arrayish(value){if(Array.isArray(value))return value.map(String);return String(value||"").split(/[,，/、\s]+/).map(s=>s.trim()).filter(Boolean)}
function boolish(value){return value===true||value===1||String(value).toLowerCase()==="true"||String(value)==="是"}
function levelRank(value){const text=String(value||"");const match=text.match(/(?:Lv\.?|LV\.?|lv\.?)\s*([1-5])|([1-5])/);return match?Number(match[1]||match[2]):0}
function minutesOf(value){const n=Number(String(value||"").replace(/[^\d.]/g,""));return Number.isFinite(n)&&n>0?n:60}
function mineIds(player){return [player.id,player.uid].filter(Boolean).map(String)}
function isMine(row,player){const ids=mineIds(player);return ids.some(id=>String(row.player_id||row.player_uid||row.companion_id||row.companion_uid||"")===id)}
function assigned(row){return row.player_id||row.player_uid||row.companion_id||row.companion_uid}
function canTake(row){return ["待接单","待抢单"].includes(row.order_status||row.status)}
function allowMultiple(order){return boolish(order.allow_multiple_candidates)||Number(order.max_candidates||0)>1}
function orderStartTime(order){return Date.parse(order.actual_start_at||order.service_start_at||order.appointment_at||order.created_at||"")}
function orderPlanStartTime(order){return Date.parse(order.appointment_at||order.service_start_at||order.created_at||"")}
function orderEndTime(order){const start=Date.parse(order.actual_start_at||order.service_start_at||order.appointment_at||order.created_at||"");if(!Number.isFinite(start))return 0;return start+minutesOf(order.duration||order.service_duration)*60*1000}
function hasTimeConflict(order,myOrders=[]){
  const start=Date.parse(order.appointment_at||order.service_start_at||"");
  const end=orderEndTime(order);
  if(!Number.isFinite(start)||!end)return false;
  return myOrders.some(row=>{
    if(CLOSED_STATUSES.has(row.order_status||row.status))return false;
    const otherStart=Date.parse(row.appointment_at||row.service_start_at||"");
    const otherEnd=orderEndTime(row);
    if(!Number.isFinite(otherStart)||!otherEnd)return false;
    return start<otherEnd&&end>otherStart;
  });
}
function hasGrabbed(orderId,player,grabs=[]){
  const ids=mineIds(player);
  return grabs.some(g=>String(g.order_id)===String(orderId)&&ids.includes(String(g.player_id||g.player_uid||g.companion_id||g.companion_uid||"")));
}
function grabCount(orderId,grabs=[]){return grabs.filter(g=>String(g.order_id)===String(orderId)).length}

function safePlayer(row={}){
  const uid=row.uid||row.player_uid||row.id||"";
  const price=money(row.current_price??row.price??row.default_price);
  return {
    id:row.id||uid,
    uid,
    name:row.nickname||row.name||"陪玩",
    role:row.role||"companion",
    avatar:row.avatar_url||row.avatar||"/assets/meow-cuijiao-brand.jpg",
    level:row.level_name||row.level||row.level_id||"",
    rawPrice:price||0,
    price:price?`RM${price}/小时`:"",
    mainGame:row.main_game||row.game||"",
    tags:Array.isArray(row.tags)?row.tags.join(" / "):(row.tags||""),
    qualifications:Array.isArray(row.qualifications)?row.qualifications.join(" / "):(row.qualifications||row.gameplay_qualifications||""),
    bio:row.bio||row.introduction||"",
    age:row.age||"",
    gender:row.gender||"",
    region:row.region||row.area||"",
    email:row.email||"",
    contactPublic:boolish(row.contact_public||row.is_contact_public),
    schedule:row.schedule||row.available_time||"",
    lastLoginAt:row.last_login_at||"",
    workStatus:row.work_status||"离线",
    onlineStatus:row.online_status||"离线",
    accountStatus:row.status||row.account_status||"启用",
    auditStatus:row.audit_status||row.approval_status||"未审核",
    identityStatus:row.identity_status||"",
    contactStatus:row.contact_status||"",
    bankStatus:row.bank_status||"",
    depositStatus:row.deposit_status||""
  };
}
function verificationFrom(player={},rows=[]){
  const latest=rows[0]||{};
  const mask=(v)=>String(v||"").replace(/^(.{2}).+(.{2})$/,"$1****$2");
  return {
    realName:latest.real_name||player.real_name||"",
    identityNoMasked:mask(latest.identity_no||player.identity_no),
    phone:latest.phone||player.contact_phone||player.phone||"",
    bankName:latest.bank_name||player.bank_name||"",
    bankAccountMasked:mask(latest.bank_account||player.bank_account),
    identityStatus:latest.identity_status||player.identity_status||"",
    contactStatus:latest.contact_status||player.contact_status||"",
    bankStatus:latest.bank_status||player.bank_status||"",
    depositStatus:latest.deposit_status||player.deposit_status||"",
    auditStatus:latest.audit_status||player.audit_status||player.approval_status||""
  };
}
function permissionsFor(rawPlayer={},verification={},orders=[]){
  const player=safePlayer(rawPlayer);
  const enabled=accountEnabled(rawPlayer);
  const roleOk=hasRole(rawPlayer);
  const auditOk=passed(player.auditStatus);
  const identityOk=passed(verification.identityStatus||player.identityStatus);
  const contactOk=passed(verification.contactStatus||player.contactStatus);
  const bankOk=passed(verification.bankStatus||player.bankStatus);
  const depositOk=passed(verification.depositStatus||player.depositStatus);
  const certified=auditOk&&identityOk&&contactOk&&bankOk;
  const running=orders.some(row=>isMine(row,player)&&(row.order_status||row.status)==="进行中");
  const reasons=[];
  if(!roleOk)reasons.push("无权访问陪玩端");
  if(!enabled)reasons.push("账号已被冻结或停用");
  if(!certified)reasons.push("资料认证未完成");
  if(!depositOk)reasons.push("押金未完成");
  return {
    roleOk,enabled,auditOk,identityOk,contactOk,bankOk,depositOk,certified,
    hasRunningOrder:running,
    canLogin:roleOk&&enabled,
    canWork:roleOk&&enabled&&certified&&depositOk,
    canSetAvailable:roleOk&&enabled&&certified&&depositOk&&!running,
    canAcceptOrder:roleOk&&enabled&&certified&&depositOk&&!running&&player.workStatus==="可接单",
    canStartOrder:roleOk&&enabled&&certified&&depositOk,
    canWithdraw:roleOk&&enabled&&certified&&depositOk,
    canEditProfile:roleOk&&enabled,
    canSubmitVerification:roleOk&&enabled,
    messagesMode:roleOk&&enabled&&certified&&depositOk?"all":"system_only",
    lockReason:reasons[0]||""
  };
}
function qualificationForOrder(order,player,permissions,myOrders=[],grabs=[]){
  const reasons=[];
  if(!permissions.canLogin)reasons.push("请先登录陪玩端。");
  if(!permissions.identityOk)reasons.push("你的身份认证尚未完成。");
  if(!permissions.contactOk)reasons.push("你的联系方式认证尚未完成。");
  if(!permissions.bankOk)reasons.push("你的收款账户认证尚未完成。");
  if(!permissions.depositOk)reasons.push("你的押金尚未完成。");
  if(player.workStatus!=="可接单")reasons.push("你当前未处于可接单状态。");
  if(!canTake(order))reasons.push("该订单当前状态不可抢。");
  if(assigned(order)&&!allowMultiple(order))reasons.push("该订单已经被其他陪玩抢走。");
  if(hasGrabbed(order.id||order.order_no,player,grabs))reasons.push("你已经抢过该订单。");
  const requiredLevel=order.required_level||order.required_level_name||order.min_level||"";
  if(requiredLevel&&levelRank(player.level)<levelRank(requiredLevel))reasons.push("你的等级不符合该订单要求。");
  const game=String(order.game||order.required_game||"").trim();
  if(game){
    const playerGames=arrayish(`${player.mainGame||""} ${player.tags||""}`);
    if(playerGames.length&&!playerGames.some(g=>game.includes(g)||g.includes(game)))reasons.push("你的游戏资料不符合该订单要求。");
  }
  const requiredTags=arrayish(order.required_tags||order.tags_required);
  if(requiredTags.length){
    const tags=arrayish(player.tags);
    if(!requiredTags.every(tag=>tags.some(t=>t===tag||t.includes(tag)||tag.includes(t))))reasons.push("你的标签不符合该订单要求。");
  }
  const qualification=String(order.required_qualification||order.gameplay_qualification||"").trim();
  if(qualification){
    const own=arrayish(player.qualifications||player.tags);
    if(own.length&&!own.some(x=>x===qualification||x.includes(qualification)||qualification.includes(x)))reasons.push("你的玩法资格不符合该订单要求。");
  }
  const minPrice=money(order.min_price||order.min_player_price);
  const maxPrice=money(order.max_price||order.max_player_price);
  if(minPrice&&player.rawPrice<minPrice)reasons.push("你的单价低于该订单要求范围。");
  if(maxPrice&&player.rawPrice>maxPrice)reasons.push("你的单价高于该订单要求范围。");
  if(hasTimeConflict(order,myOrders))reasons.push("你已有同时间段订单，存在时间冲突。");
  return {eligible:reasons.length===0,reasons};
}
function normalizeOrder(row={},serverNow=Date.now()){
  const amount=money(row.amount??row.paid_amount??row.actual_paid_amount);
  const rate=Number(row.player_commission_rate??row.order_commission_rate??80);
  const playerIncome=money(row.player_income??row.companion_income) || amount*(Number.isFinite(rate)?rate:80)/100;
  const publishedAt=row.published_at||row.dispatch_published_at||row.created_at||"";
  const deadline=row.grab_deadline_at||row.accept_deadline_at||"";
  const remainingMs=deadline?Math.max(0,Date.parse(deadline)-Date.now()):0;
  const planStartMs=orderPlanStartTime(row);
  const actualStartMs=Date.parse(row.actual_start_at||"");
  const planEndMs=Number.isFinite(planStartMs)?planStartMs+minutesOf(row.duration||row.service_duration)*60*1000:0;
  const actualEndMs=Number.isFinite(actualStartMs)?actualStartMs+minutesOf(row.duration||row.service_duration)*60*1000:0;
  const timerBase=Number.isFinite(actualStartMs)?actualStartMs:planStartMs;
  const elapsedSeconds=(row.order_status||row.status)==="进行中"&&Number.isFinite(timerBase)?Math.max(0,Math.floor((serverNow-timerBase)/1000)):0;
  const serviceSeconds=minutesOf(row.duration||row.service_duration)*60;
  return {
    id:row.id||row.order_no,
    orderType:row.order_type||row.type||"普通陪玩订单",
    bossName:row.boss_name||row.customer_name||"",
    bossUid:row.boss_uid||row.customer_uid||"",
    playerName:row.player_name||row.companion_name||"",
    playerUid:row.player_uid||row.player_id||row.companion_uid||"",
    game:row.game||"",
    server:row.server||row.game_server||row.region||"",
    gameId:row.game_id||row.boss_game_id||row.customer_game_id||"",
    serviceContent:row.service_content||row.service||"",
    duration:row.duration||row.service_duration||"",
    serviceMinutes:minutesOf(row.duration||row.service_duration),
    plannedStartAt:row.appointment_at||row.service_start_at||"",
    actualStartAt:row.actual_start_at||"",
    plannedEndAt:Number.isFinite(planEndMs)&&planEndMs?new Date(planEndMs).toISOString():"",
    actualEndAt:row.actual_end_at||"",
    timerElapsedSeconds:elapsedSeconds,
    timerRemainingSeconds:(row.order_status||row.status)==="进行中"?Math.max(0,serviceSeconds-elapsedSeconds):0,
    amount,
    playerIncome,
    budget:money(row.budget||row.boss_budget)||amount,
    requiredLevel:row.required_level||row.required_level_name||row.min_level||"不限",
    requiredTags:arrayish(row.required_tags||row.tags_required).join(" / ")||"不限",
    genderRequirement:row.gender_requirement||row.required_gender||"不限",
    urgent:boolish(row.is_urgent||row.urgent),
    publishedAt,
    remainingSeconds:Math.ceil(remainingMs/1000),
    grabberCount:Number(row.grabber_count||0),
    allowMultiple:allowMultiple(row),
    reviewTitle:row.review_title||row.boss_review_title||"",
    reviewContent:row.review_content||row.boss_review||row.review||"",
    orderStatus:row.order_status||row.status||"待支付",
    paymentStatus:row.payment_status||"未支付",
    serviceStaff:row.service_staff_name||row.customer_service_name||"",
    createdAt:row.created_at||"",
    appointmentAt:row.appointment_at||"",
    raw:row
  };
}
function normalizeConversation(row={}){
  return {
    id:row.id,
    type:row.type||row.category||"订单",
    category:row.category||row.type||"订单",
    name:row.name||row.boss_name||row.customer_name||row.service_staff_name||"会话",
    uid:row.uid||row.boss_uid||row.customer_uid||"",
    avatar:row.avatar||row.avatar_url||"/assets/meow-cuijiao-brand.jpg",
    lastMessage:row.last_message||"",
    lastTime:row.last_time||row.updated_at||"",
    unread:Number(row.player_unread_count||row.unread_count||0),
    onlineStatus:row.online_status||"离线",
    profile:row.profile||{orderId:row.order_id||"",bossUid:row.boss_uid||row.customer_uid||"",vipLevel:row.vip_level||"",game:row.game||"",gameId:row.game_id||row.boss_game_id||"",serviceContent:row.service_content||row.service||"",orderStatus:row.order_status||"",serviceTime:row.service_time||row.appointment_at||"",timerText:row.timer_text||"",serviceStaff:row.service_staff_name||row.assigned_service_name||"",remark:row.remark||row.service_remark||""}
  };
}
function normalizeMessage(row={}){return {id:row.id,conversationId:row.conversation_id,senderRole:row.sender_role,type:row.type||"text",content:row.recalled_at?"消息已撤回":row.content||"",createdAt:row.created_at,readAt:row.read_at,replyTo:row.reply_to_content||"",quoteId:row.quote_message_id||"",recalled:Boolean(row.recalled_at)}}
function normalizeWithdrawal(row={}){return {id:row.id,amount:money(row.amount),status:row.status||"待审核",account:row.account||row.bank_account||"",createdAt:row.created_at,reviewedAt:row.reviewed_at}}
async function findPlayer(account){
  const value=encodeURIComponent(account);
  const queries=[
    `?or=(id.eq.${value},uid.eq.${value},player_uid.eq.${value},email.eq.${value},phone.eq.${value},contact_phone.eq.${value})&limit=1`,
    `?id=eq.${value}&limit=1`,
    `?uid=eq.${value}&limit=1`,
    `?phone=eq.${value}&limit=1`,
    `?email=eq.${value}&limit=1`
  ];
  for(const query of queries){const rows=await safeRows("players",query);if(rows[0])return rows[0]}
  return null;
}
async function requirePlayer(req){
  const token=readToken(tokenFrom(req));
  if(!token)throw Object.assign(new Error("未登录陪玩端"),{status:401});
  if(!PLAYER_ROLES.has(token.role))throw Object.assign(new Error("无权访问陪玩端"),{status:403});
  return token;
}
async function playerByToken(token){
  const id=encodeURIComponent(token.id||token.uid||"");
  const rows=await safeRows("players",`?or=(id.eq.${id},uid.eq.${id},player_uid.eq.${id})&limit=1`);
  return rows[0]||{id:token.id,uid:token.uid,role:token.role};
}
async function loadPlayerData(token){
  const serverNow=Date.now();
  const rawPlayer=await playerByToken(token);
  const player=safePlayer(rawPlayer);
  const [ordersRaw,conversationsRaw,withdrawalsRaw,verificationRows,reviewsRaw,grabRows,gameRows,mediaRows,depositRows,earningRows,inviteRows,rebateRows,levelRows]=await Promise.all([
    safeRows("orders","?order=created_at.desc&limit=200"),
    safeRows("conversations","?order=updated_at.desc&limit=100"),
    safeRows("withdrawal_requests",`?player_id=eq.${encodeURIComponent(player.id)}&order=created_at.desc&limit=50`),
    safeRows("player_verifications",`?player_id=eq.${encodeURIComponent(player.id)}&order=created_at.desc&limit=1`),
    safeRows("reviews",`?player_id=eq.${encodeURIComponent(player.id)}&order=created_at.desc&limit=100`),
    safeRows("order_grabs","?order=created_at.desc&limit=500"),
    safeRows("player_games",`?player_id=eq.${encodeURIComponent(player.id)}&order=sort.asc,created_at.desc&limit=100`),
    safeRows("player_media",`?player_id=eq.${encodeURIComponent(player.id)}&order=sort.asc,created_at.desc&limit=100`),
    safeRows("player_deposits",`?player_id=eq.${encodeURIComponent(player.id)}&order=created_at.desc&limit=1`),
    safeRows("player_earnings",`?player_id=eq.${encodeURIComponent(player.id)}&order=created_at.desc&limit=100`),
    safeRows("invitation_relations",`?inviter_id=eq.${encodeURIComponent(player.id)}&order=created_at.desc&limit=200`),
    safeRows("rebate_records",`?player_id=eq.${encodeURIComponent(player.id)}&order=created_at.desc&limit=100`),
    safeRows("companion_levels","?order=sort.asc,level.asc&limit=20")
  ]);
  await autoAdvanceRunningOrders(player,ordersRaw,serverNow);
  const verification=verificationFrom(rawPlayer,verificationRows);
  const permissions=permissionsFor(rawPlayer,verification,ordersRaw);
  const myOrderRows=ordersRaw.filter(row=>isMine(row,player));
  const myOrders=myOrderRows.map(row=>normalizeOrder({...row,grabber_count:grabCount(row.id||row.order_no,grabRows)},serverNow));
  const openOrders=permissions.canLogin?ordersRaw
    .filter(row=>canTake(row))
    .filter(row=>qualificationForOrder(row,player,permissions,myOrderRows,grabRows).eligible)
    .map(row=>normalizeOrder({...row,grabber_count:grabCount(row.id||row.order_no,grabRows)},serverNow)):[];
  let conversationRows=conversationsRaw.filter(row=>isMine(row,player)||String(row.player_uid||row.player_id||"")===String(player.uid||player.id));
  if(permissions.messagesMode==="system_only")conversationRows=conversationRows.filter(row=>["系统通知","系统"].includes(row.type)||["系统通知","系统"].includes(row.category));
  const conversationIds=conversationRows.map(row=>row.id).filter(Boolean);
  let messages=[];
  if(conversationIds.length){
    const filter=conversationIds.map(id=>`conversation_id.eq.${encodeURIComponent(id)}`).join(",");
    messages=await safeRows("messages",`?or=(${filter})&order=created_at.asc&limit=300`);
  }
  const allReviewRows=reviewsRaw.length?reviewsRaw:await safeRows("player_reviews",`?player_id=eq.${encodeURIComponent(player.id)}&order=created_at.desc&limit=100`);
  const completed=myOrders.filter(o=>o.orderStatus==="已完成");
  const approvedWithdrawals=withdrawalsRaw.filter(w=>["已通过","已打款"].includes(w.status));
  const earnings={
    todayIncome:completed.filter(o=>isToday(o.raw.updated_at||o.raw.completed_at||o.createdAt)).reduce((n,o)=>n+o.playerIncome,0),
    weekIncome:completed.reduce((n,o)=>n+o.playerIncome,0),
    monthIncome:completed.filter(o=>isMonth(o.raw.updated_at||o.raw.completed_at||o.createdAt)).reduce((n,o)=>n+o.playerIncome,0),
    totalIncome:completed.reduce((n,o)=>n+o.playerIncome,0),
    totalWithdraw:approvedWithdrawals.reduce((n,w)=>n+money(w.amount),0),
    pendingSettlement:myOrders.filter(o=>o.orderStatus==="待确认完成").reduce((n,o)=>n+o.playerIncome,0),
    withdrawable:Math.max(0,money(rawPlayer.withdrawable_amount)||completed.reduce((n,o)=>n+o.playerIncome,0)-approvedWithdrawals.reduce((n,w)=>n+money(w.amount),0)),
    platformCommission:myOrders.reduce((n,o)=>n+Math.max(0,o.amount-o.playerIncome),0)
  };
  const monthWithdrawals=withdrawalsRaw.filter(w=>isMonth(w.created_at));
  const monthlyLimit=Number(rawPlayer.monthly_withdraw_limit||4);
  const withdrawalRules={
    currentAccount:verification.bankName&&verification.bankAccountMasked?`${verification.bankName} ${verification.bankAccountMasked}`:"",
    monthlyLimit,
    usedThisMonth:monthWithdrawals.length,
    remainingThisMonth:Math.max(0,monthlyLimit-monthWithdrawals.length),
    minAmount:money(rawPlayer.min_withdraw_amount||50),
    description:rawPlayer.withdraw_description||"提现申请提交后进入后台审核，审核通过后打款。"
  };
  const inviteBosses=inviteRows.filter(x=>String(x.invitee_role||x.type||"").includes("老板")).length;
  const invitePlayers=inviteRows.filter(x=>String(x.invitee_role||x.type||"").includes("陪玩")).length;
  const invitation={
    inviteLink:rawPlayer.invite_link||`${process.env.PUBLIC_SITE_URL||""}/invite.html?ref=${encodeURIComponent(player.uid||player.id)}`,
    qrCodeUrl:rawPlayer.invite_qr_url||"",
    bossCount:inviteBosses,
    playerCount:invitePlayers,
    bossRebateRate:rawPlayer.invite_boss_rebate_rate||rawPlayer.direct_boss_rebate_rate||"0%",
    playerRebateRate:rawPlayer.direct_player_rebate_rate||"0%",
    totalRebate:rebateRows.reduce((n,x)=>n+money(x.amount),0),
    monthRebate:rebateRows.filter(x=>isMonth(x.created_at)).reduce((n,x)=>n+money(x.amount),0),
    records:rebateRows.map(x=>({id:x.id,orderId:x.order_id,amount:money(x.amount),rate:x.rate||"",source:x.source||x.type||"",createdAt:x.created_at}))
  };
  const levelConfig=levelRows.find(x=>String(x.level||x.id||x.name)===String(rawPlayer.level||rawPlayer.level_id||rawPlayer.level_name))||{};
  const levelInfo={
    currentLevel:player.level,
    name:levelConfig.name||rawPlayer.level_name||player.level||"",
    badge:levelConfig.badge||levelConfig.icon||"",
    priceRange:levelConfig.price_range||(levelConfig.min_price?`RM${levelConfig.min_price}–RM${levelConfig.max_price}${levelConfig.max_price_open?"+":""}`:""),
    minPrice:money(levelConfig.min_price),
    maxPrice:money(levelConfig.max_price),
    defaultPrice:player.price,
    playerShareRate:rawPlayer.order_commission_rate||levelConfig.player_share_rate||"",
    platformRate:rawPlayer.platform_share_rate||levelConfig.platform_share_rate||"",
    directRebateRate:rawPlayer.direct_rebate_rate||levelConfig.direct_rebate_rate||"",
    upgradeConditions:levelConfig.upgrade_conditions||"",
    upgradeProgress:rawPlayer.upgrade_progress||"",
    exposureWeight:levelConfig.exposure_weight_desc||levelConfig.exposure_weight||""
  };
  const summary={
    todayOrders:myOrders.filter(o=>isToday(o.createdAt)).length,
    runningOrders:myOrders.filter(o=>o.orderStatus==="进行中").length,
    waitingStart:myOrders.filter(o=>o.orderStatus==="待开始").length,
    waitingConfirm:myOrders.filter(o=>o.orderStatus==="待老板确认").length,
    waitingComplete:myOrders.filter(o=>o.orderStatus==="待确认完成").length,
    afterSales:myOrders.filter(o=>o.orderStatus==="售后处理中").length,
    pendingWithdrawals:withdrawalsRaw.filter(w=>["待审核","审核中"].includes(w.status)).length,
    todayIncome:earnings.todayIncome,
    monthIncome:earnings.monthIncome,
    withdrawable:earnings.withdrawable,
    unreadMessages:conversationRows.reduce((n,row)=>n+Number(row.player_unread_count||row.unread_count||0),0),
    monthReviews:allReviewRows.filter(r=>isMonth(r.created_at)).length
  };
  const playerGames=gameRows.map(x=>({id:x.id,game:x.game||x.game_name,server:x.server||x.region,gameId:x.game_id,nickname:x.game_nickname||x.nickname,rank:x.rank,position:x.position,kd:x.kd||x.custom_stats,isMain:boolish(x.is_main),price:money(x.price||x.current_price),schedule:x.schedule,enabled:x.enabled!==false}));
  const media=mediaRows.map(x=>({id:x.id,type:x.type,url:x.url||x.file_url,game:x.game,gameId:x.game_id,rank:x.rank,kd:x.kd,map:x.map,playstyle:x.playstyle,text:x.text,status:x.status||"待审核"}));
  const deposit=depositRows[0]||{};
  const depositInfo={requiredAmount:money(deposit.required_amount||rawPlayer.deposit_required_amount),paidAmount:money(deposit.paid_amount),status:deposit.status||player.depositStatus||"未缴纳",paymentMethod:deposit.payment_method||"",reviewedAt:deposit.reviewed_at||"",refundRules:deposit.refund_rules||rawPlayer.deposit_refund_rules||"",rejectReason:deposit.reject_reason||""};
  const earningDetails=(earningRows.length?earningRows:myOrders.filter(o=>o.orderStatus==="已完成").map(o=>({id:`E-${o.id}`,order_id:o.id,boss_name:o.bossName,order_amount:o.amount,player_rate:rawPlayer.order_commission_rate,player_income:o.playerIncome,platform_commission:o.amount-o.playerIncome,direct_rebate:0,status:o.raw.settlement_status||"待结算",completed_at:o.raw.completed_at||o.raw.updated_at}))).map(x=>({id:x.id,orderId:x.order_id,bossName:x.boss_name,orderAmount:money(x.order_amount),playerRate:x.player_rate||"",playerIncome:money(x.player_income),platformCommission:money(x.platform_commission),directRebate:money(x.direct_rebate),status:x.status||"待结算",completedAt:x.completed_at||x.created_at}));
  const reviews=allReviewRows.map(x=>({id:x.id,bossName:x.boss_name||x.customer_name||"",orderId:x.order_id,rating:x.rating||x.score,content:x.content||x.review,tags:Array.isArray(x.tags)?x.tags.join(" / "):(x.tags||""),createdAt:x.created_at,anonymous:boolish(x.anonymous),appealed:boolish(x.appealed)}));
  return {serverTime:new Date(serverNow).toISOString(),rawPlayer,player,permissions,summary,openOrders,myOrders,conversations:conversationRows.map(normalizeConversation),messages:messages.map(normalizeMessage),earnings,earningDetails,withdrawalRules,withdrawals:withdrawalsRaw.map(normalizeWithdrawal),verification,deposit:depositInfo,playerGames,media,levelInfo,invitation,reviews,orderStatuses:ORDER_STATUSES,paymentStatuses:PAYMENT_STATUSES};
}
async function getOrder(id){const value=encodeURIComponent(id);const rows=await safeRows("orders",`?or=(id.eq.${value},order_no.eq.${value})&limit=1`);return rows[0]||null}
async function patchOrder(id,patch){const value=encodeURIComponent(id);return db("orders",`?or=(id.eq.${value},order_no.eq.${value})`,{method:"PATCH",body:JSON.stringify({...patch,updated_at:new Date().toISOString()})})}
async function logAction(module,action,player,target,beforeValue,afterValue,reason=""){
  try{await db("operation_logs","",{method:"POST",body:JSON.stringify({module,action,target_type:module,target_id:target,operator_role:"companion",operator_id:player.id||player.uid,before_value:beforeValue||null,after_value:afterValue||null,reason,created_at:new Date().toISOString()})})}catch{}
}
function assertCan(condition,message){if(!condition)throw Object.assign(new Error(message),{status:403})}
async function autoAdvanceRunningOrders(player,ordersRaw,serverNow){
  const changed=[];
  for(const row of ordersRaw){
    if(!isMine(row,player))continue;
    if((row.order_status||row.status)!=="进行中")continue;
    const end=orderEndTime(row);
    if(!end||end>serverNow)continue;
    const patch={order_status:"待确认完成",actual_end_at:row.actual_end_at||new Date(end).toISOString(),timer_auto_completed_at:new Date(serverNow).toISOString()};
    try{
      const rows=await patchOrder(row.id||row.order_no,patch);
      Object.assign(row,rows?.[0]||patch);
      changed.push(row.id||row.order_no);
      await logAction("orders","auto_waiting_complete",player,row.id||row.order_no,row,patch,"服务时间到达计划结束时间");
    }catch{}
  }
  return changed;
}
async function recordOrderAction(action,id,player,payload={}){
  const order=await getOrder(id);
  if(!order)throw Object.assign(new Error("订单不存在"),{status:404});
  if(!isMine(order,player))throw Object.assign(new Error("不能操作不属于你的订单"),{status:403});
  const current=order.order_status||order.status;
  const requireStatus=(allowed,message)=>{if(!allowed.includes(current))throw Object.assign(new Error(message),{status:409})};
  const patch={};
  if(action==="accept_assigned_order"){requireStatus(["待老板确认","待确认"],"当前订单不是待确认状态，不能接受");Object.assign(patch,{order_status:"待开始",player_confirmed_at:new Date().toISOString()});}
  if(action==="reject_order"){requireStatus(["待老板确认","待确认"],"当前订单不是待确认状态，不能拒绝");Object.assign(patch,{order_status:"待接单",player_id:null,player_uid:null,player_name:null,rejected_at:new Date().toISOString()});}
  if(action==="start_order"){requireStatus(["待开始"],"当前订单不是待开始状态，不能确认开始");Object.assign(patch,{order_status:"进行中",actual_start_at:new Date().toISOString()});}
  if(action==="complete_order"||action==="confirm_complete"){requireStatus(["进行中","待确认完成","待完成"],"当前订单不能提交完成确认");Object.assign(patch,{order_status:"待确认完成",actual_end_at:new Date().toISOString(),completion_note:payload.note||payload.reason||""});}
  if(action==="request_after_sale"||action==="request_after_sale_review"){if(CLOSED_STATUSES.has(current)&&current!=="已完成")throw Object.assign(new Error("当前订单不能发起售后"),{status:409});Object.assign(patch,{order_status:"售后处理中"});}
  const rows=Object.keys(patch).length?await patchOrder(id,patch):[];
  if(action==="start_order"){
    try{await db("players",`?id=eq.${encodeURIComponent(player.id)}`,{method:"PATCH",body:JSON.stringify({work_status:"忙碌",online_status:"在线",updated_at:new Date().toISOString()})})}catch{}
  }
  if(action==="complete_order"||action==="confirm_complete"){
    try{await db("players",`?id=eq.${encodeURIComponent(player.id)}`,{method:"PATCH",body:JSON.stringify({work_status:"暂停接单",online_status:"在线",updated_at:new Date().toISOString()})})}catch{}
  }
  await logAction("orders",action,player,id,order,{patch,payload,result:rows?.[0]||null},payload.reason||payload.note||"");
  return rows?.[0]||patch;
}

export default async function handler(req,res){
  try{
    const action=String(req.method==="GET"?req.query.action:req.body?.action||"");
    if(!hasDb()){
      return json(res,req.method==="GET"?200:503,{ok:req.method==="GET",data:{serverTime:new Date().toISOString(),player:{},permissions:{canWork:false,canSetAvailable:false,canAcceptOrder:false,canStartOrder:false,canWithdraw:false,messagesMode:"system_only",lockReason:"真实数据库未配置"},summary:{todayOrders:0,runningOrders:0,waitingStart:0,waitingConfirm:0,waitingComplete:0,afterSales:0,pendingWithdrawals:0,todayIncome:0,monthIncome:0,withdrawable:0,unreadMessages:0,monthReviews:0},openOrders:[],myOrders:[],conversations:[],messages:[],earnings:{},earningDetails:[],withdrawalRules:{monthlyLimit:0,usedThisMonth:0,remainingThisMonth:0,minAmount:0,currentAccount:""},withdrawals:[],verification:{},deposit:{},playerGames:[],media:[],levelInfo:{},invitation:{records:[]},reviews:[],orderStatuses:ORDER_STATUSES,paymentStatuses:PAYMENT_STATUSES},message:"未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，陪玩端不返回模拟业务数据，操作不会写入本地。",requiredTables:["players","player_profiles","player_games","player_media","player_verifications","player_deposits","orders","order_grabs","order_assignments","conversations","conversation_members","messages","player_earnings","withdrawal_requests","player_reviews","invitation_relations","rebate_records","operation_logs","password_reset_requests"]});
    }
    if(action==="login"){
      const account=String(req.body?.account||"").trim();
      const password=String(req.body?.password||"");
      if(!account||!password)return json(res,400,{ok:false,message:"请输入陪玩账号和密码"});
      const player=await findPlayer(account);
      if(!player)return json(res,401,{ok:false,message:"陪玩账号不存在"});
      if(!hasRole(player))return json(res,403,{ok:false,message:"无权访问陪玩端"});
      if(!accountEnabled(player))return json(res,403,{ok:false,message:"陪玩账号已被冻结或停用"});
      if(!player.password_hash)return json(res,403,{ok:false,message:"陪玩账号未配置密码，请联系管理员"});
      const passwordHash=hashPassword(password);
      if(player.password_hash!==password&&player.password_hash!==passwordHash)return json(res,401,{ok:false,message:"密码错误"});
      await db("players",`?id=eq.${encodeURIComponent(player.id)}`,{method:"PATCH",body:JSON.stringify({last_login_at:new Date().toISOString(),online_status:"在线"})});
      return json(res,200,{ok:true,session:{token:makeToken(player),user:safePlayer(player),remember:!!req.body?.remember}});
    }
    if(action==="forgot_password"){
      const account=String(req.body?.account||"").trim();
      if(!account)return json(res,400,{ok:false,message:"请输入陪玩 ID / 邮箱 / 手机号"});
      await db("password_reset_requests","",{method:"POST",body:JSON.stringify({id:`PR-${Date.now()}`,account,role:"companion",status:"待处理",created_at:new Date().toISOString()})});
      return json(res,200,{ok:true,message:"找回密码申请已提交，请等待客服或管理员处理"});
    }
    const token=await requirePlayer(req);
    const loaded=await loadPlayerData(token);
    const {rawPlayer,player,permissions}=loaded;
    if(!permissions.roleOk)return json(res,403,{ok:false,message:"无权访问陪玩端"});
    if(!permissions.enabled){
      try{await db("players",`?id=eq.${encodeURIComponent(player.id)}`,{method:"PATCH",body:JSON.stringify({work_status:"离线",online_status:"离线",updated_at:new Date().toISOString()})})}catch{}
      return json(res,403,{ok:false,message:"陪玩账号已被冻结或停用"});
    }
    if(req.method==="GET"&&action==="bootstrap")return json(res,200,{ok:true,data:{serverTime:loaded.serverTime,player:loaded.player,permissions:loaded.permissions,summary:loaded.summary,openOrders:loaded.openOrders,myOrders:loaded.myOrders,conversations:loaded.conversations,messages:loaded.messages,earnings:loaded.earnings,earningDetails:loaded.earningDetails,withdrawalRules:loaded.withdrawalRules,withdrawals:loaded.withdrawals,verification:loaded.verification,deposit:loaded.deposit,playerGames:loaded.playerGames,media:loaded.media,levelInfo:loaded.levelInfo,invitation:loaded.invitation,reviews:loaded.reviews,orderStatuses:ORDER_STATUSES,paymentStatuses:PAYMENT_STATUSES}});
    if(req.method!=="POST")return json(res,405,{ok:false,message:"Method Not Allowed"});
    if(action==="send_message"){
      const conversationId=String(req.body?.conversationId||"");
      const content=String(req.body?.content||"").trim();
      if(!conversationId||!content)return json(res,400,{ok:false,message:"缺少会话或消息内容"});
      if(permissions.messagesMode==="system_only")return json(res,403,{ok:false,message:"认证未完成，只能查看系统通知"});
      if(!loaded.conversations.some(c=>String(c.id)===conversationId))return json(res,403,{ok:false,message:"不能向不属于你的会话发送消息"});
      await db("messages","",{method:"POST",body:JSON.stringify({conversation_id:conversationId,sender_id:player.id,sender_role:"player",type:String(req.body?.type||"text"),content,quote_message_id:req.body?.quoteMessageId||null,reply_to_content:req.body?.replyToContent||null,created_at:new Date().toISOString()})});
      await db("conversations",`?id=eq.${encodeURIComponent(conversationId)}`,{method:"PATCH",body:JSON.stringify({last_message:content,last_time:new Date().toISOString(),updated_at:new Date().toISOString()})});
      return json(res,200,{ok:true,message:"消息已发送"});
    }
    if(action==="recall_message"){
      const id=String(req.body?.id||"");
      const rows=await safeRows("messages",`?id=eq.${encodeURIComponent(id)}&limit=1`);
      const msg=rows[0];
      if(!msg)return json(res,404,{ok:false,message:"消息不存在"});
      if(String(msg.sender_id)!==String(player.id)&&String(msg.sender_id)!==String(player.uid))return json(res,403,{ok:false,message:"只能撤回自己发送的消息"});
      if(!loaded.conversations.some(c=>String(c.id)===String(msg.conversation_id)))return json(res,403,{ok:false,message:"不能操作不属于你的会话"});
      const created=Date.parse(msg.created_at||"");
      if(Number.isFinite(created)&&Date.now()-created>2*60*1000)return json(res,409,{ok:false,message:"超过 2 分钟的消息不能撤回"});
      await db("messages",`?id=eq.${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({recalled_at:new Date().toISOString(),content:"消息已撤回"})});
      await logAction("messages","recall_message",player,id,{content:msg.content},{recalled_at:new Date().toISOString()});
      return json(res,200,{ok:true,message:"消息已撤回"});
    }
    if(action==="accept_order"){
      assertCan(permissions.canAcceptOrder,permissions.lockReason||"当前账号不能抢单");
      const id=String(req.body?.id||"");
      const order=await getOrder(id);
      if(!order)return json(res,404,{ok:false,message:"订单不存在"});
      const grabs=await safeRows("order_grabs",`?order_id=eq.${encodeURIComponent(id)}&limit=500`);
      const allOrders=await safeRows("orders","?order=created_at.desc&limit=200");
      const myOrders=allOrders.filter(row=>isMine(row,player));
      const check=qualificationForOrder(order,player,permissions,myOrders,grabs);
      if(!check.eligible)return json(res,409,{ok:false,message:check.reasons[0]||"当前不符合抢单条件",reasons:check.reasons});
      const multi=allowMultiple(order);
      const grab={id:`GRAB-${Date.now()}`,order_id:id,player_id:player.id,player_uid:player.uid,player_name:player.name,status:"待老板确认",created_at:new Date().toISOString()};
      try{await db("order_grabs","",{method:"POST",body:JSON.stringify(grab)})}
      catch(error){return json(res,409,{ok:false,message:error.message.includes("duplicate")?"你已经抢过该订单。":"抢单记录写入失败，请检查 order_grabs 表。"})}
      const patch=multi
        ? {order_status:"待老板确认",grabber_count:grabs.length+1,last_grabbed_at:new Date().toISOString()}
        : {player_id:player.id,player_uid:player.uid,player_name:player.name,order_status:"待老板确认",grabber_count:grabs.length+1,accepted_at:new Date().toISOString()};
      const orderQuery=multi
        ? `?id=eq.${encodeURIComponent(id)}`
        : `?id=eq.${encodeURIComponent(id)}&order_status=in.(${encodeURIComponent("待接单")},${encodeURIComponent("待抢单")})`;
      const rows=await db("orders",orderQuery,{method:"PATCH",body:JSON.stringify({...patch,updated_at:new Date().toISOString()})});
      if(!multi&&(!rows||!rows.length)){
        try{await db("order_grabs",`?id=eq.${encodeURIComponent(grab.id)}`,{method:"PATCH",body:JSON.stringify({status:"失败",fail_reason:"订单已被其他陪玩抢走"})})}catch{}
        return json(res,409,{ok:false,message:"该订单已经被其他陪玩抢走。"});
      }
      await logAction("orders","accept_order",player,id,order,{grab,order:rows?.[0]||patch});
      return json(res,200,{ok:true,message:multi?"抢单成功，已进入候选列表，等待老板确认":"抢单成功，订单已锁定并等待老板确认",order:rows?.[0]||patch});
    }
    const orderActions=new Set(["accept_assigned_order","reject_order","start_order","complete_order","confirm_complete","request_after_sale","request_after_sale_review","contact_service","contact_boss","request_delay_start","request_extend_service","request_early_end","upload_service_proof","submit_completion_note","upload_completion_evidence","upload_after_sale_evidence"]);
    if(orderActions.has(action)){
      assertCan(permissions.canStartOrder||["contact_service","contact_boss"].includes(action),permissions.lockReason||"当前账号不能操作订单");
      const result=await recordOrderAction(action,String(req.body?.id||""),player,req.body?.payload||{});
      const messages={
        accept_assigned_order:"已接受订单，等待开始服务",
        reject_order:"已拒绝订单，并记录操作",
        start_order:"服务已开始",
        complete_order:"已提交完成确认",
        confirm_complete:"完成确认已提交",
        request_after_sale:"售后申请已提交客服处理",
        request_after_sale_review:"售后复核申请已记录",
        contact_service:"已记录联系客户请求",
        contact_boss:"已记录联系老板请求",
        request_delay_start:"延迟开始申请已记录",
        request_extend_service:"延长服务申请已记录",
        request_early_end:"提前结束申请已记录",
        upload_service_proof:"服务证明已记录",
        submit_completion_note:"完成说明已提交",
        upload_completion_evidence:"完成证据已记录",
        upload_after_sale_evidence:"售后证据已记录"
      };
      return json(res,200,{ok:true,message:messages[action]||"操作已记录",order:result});
    }
    if(action==="set_work_status"){
      let value=String(req.body?.value||"");
      if(!["可接单","忙碌","暂停接单","离线"].includes(value))return json(res,400,{ok:false,message:"接单状态不正确"});
      if(value==="可接单")assertCan(permissions.canSetAvailable,permissions.hasRunningOrder?"有进行中订单时不能设为可接单":"认证或押金未完成，不能设为可接单");
      if(permissions.hasRunningOrder&&value==="可接单")value="忙碌";
      const online=value==="离线"?"离线":"在线";
      const rows=await db("players",`?id=eq.${encodeURIComponent(player.id)}`,{method:"PATCH",body:JSON.stringify({work_status:value,online_status:online,updated_at:new Date().toISOString()})});
      await logAction("players","set_work_status",player,player.id,rawPlayer,rows?.[0]||{work_status:value});
      return json(res,200,{ok:true,message:"接单状态已同步"});
    }
    if(action==="request_withdrawal"){
      assertCan(permissions.canWithdraw,permissions.lockReason||"认证或押金未完成，不能提现");
      const amount=money(req.body?.amount);
      if(amount<=0)return json(res,400,{ok:false,message:"提现金额必须大于 0"});
      if(amount>loaded.earnings.withdrawable)return json(res,400,{ok:false,message:"提现金额不能超过可提现金额"});
      if(!permissions.bankOk)return json(res,403,{ok:false,message:"收款账户未认证，不能提现"});
      if(loaded.earningDetails.some(x=>["售后处理中","已冻结"].includes(x.status)))return json(res,409,{ok:false,message:"存在售后冻结款，暂不能提现"});
      if(loaded.withdrawalRules.remainingThisMonth<=0)return json(res,409,{ok:false,message:"本月提现次数已用完"});
      if(amount<loaded.withdrawalRules.minAmount)return json(res,400,{ok:false,message:`最低提现金额为 RM${loaded.withdrawalRules.minAmount}`});
      const row={id:`WD-${Date.now()}`,player_id:player.id,player_uid:player.uid,amount,account:String(req.body?.account||""),remark:String(req.body?.remark||""),status:"待审核",created_at:new Date().toISOString()};
      await db("withdrawal_requests","",{method:"POST",body:JSON.stringify(row)});
      await logAction("withdrawal_requests","request_withdrawal",player,row.id,null,row);
      return json(res,200,{ok:true,message:"提现申请已提交后台审核"});
    }
    if(action==="update_profile"){
      assertCan(permissions.canEditProfile,"账号状态异常，不能编辑资料");
      const newPrice=money(req.body?.price);
      const minPrice=money(loaded.levelInfo.minPrice);
      const maxPrice=money(loaded.levelInfo.maxPrice);
      if(newPrice&&minPrice&&newPrice<minPrice)return json(res,400,{ok:false,message:`当前等级可设置的价格范围为 RM${minPrice}–RM${maxPrice||"100+"}。`});
      if(newPrice&&maxPrice&&newPrice>maxPrice)return json(res,400,{ok:false,message:`当前等级可设置的价格范围为 RM${minPrice}–RM${maxPrice}。`});
      const patch={nickname:String(req.body?.nickname||player.name),main_game:String(req.body?.main_game||""),current_price:newPrice,tags:String(req.body?.tags||""),bio:String(req.body?.bio||""),profile_audit_status:"待审核",updated_at:new Date().toISOString()};
      const rows=await db("players",`?id=eq.${encodeURIComponent(player.id)}`,{method:"PATCH",body:JSON.stringify(patch)});
      await logAction("players","update_profile",player,player.id,rawPlayer,rows?.[0]||patch);
      return json(res,200,{ok:true,message:"资料已保存，并提交后台审核"});
    }
    if(action==="submit_verification"){
      assertCan(permissions.canSubmitVerification,"账号状态异常，不能提交认证");
      const row={id:`PV-${Date.now()}`,player_id:player.id,player_uid:player.uid,real_name:String(req.body?.real_name||""),identity_no:String(req.body?.identity_no||""),phone:String(req.body?.phone||""),bank_name:String(req.body?.bank_name||""),bank_account:String(req.body?.bank_account||""),remark:String(req.body?.remark||""),identity_status:"审核中",bank_status:"审核中",contact_status:"审核中",audit_status:"待审核",created_at:new Date().toISOString()};
      await db("player_verifications","",{method:"POST",body:JSON.stringify(row)});
      await db("players",`?id=eq.${encodeURIComponent(player.id)}`,{method:"PATCH",body:JSON.stringify({identity_status:"审核中",bank_status:"审核中",contact_status:"审核中",updated_at:new Date().toISOString()})});
      await logAction("player_verifications","submit_verification",player,row.id,null,{...row,identity_no:"***",bank_account:"***"});
      return json(res,200,{ok:true,message:"认证资料已提交后台审核"});
    }
    if(action==="submit_deposit_proof"){
      assertCan(permissions.canSubmitVerification,"账号状态异常，不能提交押金凭证");
      const paidAmount=money(req.body?.paid_amount);
      const proofUrl=String(req.body?.proof_url||"").trim();
      if(paidAmount<=0)return json(res,400,{ok:false,message:"已缴金额必须大于 0"});
      if(!proofUrl)return json(res,400,{ok:false,message:"请填写付款凭证链接"});
      const row={id:`PD-${Date.now()}`,player_id:player.id,player_uid:player.uid,required_amount:loaded.deposit.requiredAmount||money(rawPlayer.deposit_required_amount),paid_amount:paidAmount,payment_method:String(req.body?.payment_method||""),proof_url:proofUrl,remark:String(req.body?.remark||""),status:"待审核",created_at:new Date().toISOString()};
      await db("player_deposits","",{method:"POST",body:JSON.stringify(row)});
      await db("players",`?id=eq.${encodeURIComponent(player.id)}`,{method:"PATCH",body:JSON.stringify({deposit_status:"待审核",updated_at:new Date().toISOString()})});
      await logAction("player_deposits","submit_deposit_proof",player,row.id,null,row);
      return json(res,200,{ok:true,message:"押金凭证已提交后台审核"});
    }
    if(action==="appeal_review"){
      const id=String(req.body?.id||"");
      if(!id)return json(res,400,{ok:false,message:"缺少评价 ID"});
      const review=loaded.reviews.find(x=>String(x.id)===id);
      if(!review)return json(res,404,{ok:false,message:"评价不存在或不属于当前陪玩"});
      const row={id:`RA-${Date.now()}`,review_id:id,player_id:player.id,player_uid:player.uid,order_id:review.orderId,reason:String(req.body?.reason||"陪玩端提交评价申诉"),status:"待审核",created_at:new Date().toISOString()};
      await db("review_appeals","",{method:"POST",body:JSON.stringify(row)});
      try{await db("reviews",`?id=eq.${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({appealed:true,updated_at:new Date().toISOString()})})}catch{}
      await logAction("review_appeals","appeal_review",player,row.id,null,row);
      return json(res,200,{ok:true,message:"评价申诉已提交后台审核"});
    }
    return json(res,400,{ok:false,message:"未知陪玩端操作"});
  }catch(error){
    return json(res,error.status||500,{ok:false,message:error.message||"陪玩端接口异常"});
  }
}
