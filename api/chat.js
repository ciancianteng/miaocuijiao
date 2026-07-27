const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

function json(res, status, data) { res.status(status).json(data); }
function hasDb() { return REQUIRED_ENV.every((key) => process.env[key]); }
function anonHeaders(extra = {}) { return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra }; }
function serviceHeaders(extra = {}) { return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...extra }; }
function authUrl(path) { return `${process.env.SUPABASE_URL}/auth/v1/${path}`; }
function restUrl(table, query = "") { return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`; }
function nowIso() { return new Date().toISOString(); }
async function parseBody(req) { if (req.body && typeof req.body === "object") return req.body; const chunks=[]; for await (const chunk of req) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; } }
async function supabaseJson(url, init = {}) { const response=await fetch(url,init); const text=await response.text(); let body=null; try{body=text?JSON.parse(text):null}catch{body=text} if(!response.ok)throw new Error(body?.error_description||body?.message||body?.hint||body?.details||"Supabase 请求失败"); return body; }
function tokenFrom(req) { return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim(); }
async function profileFromToken(req) {
  const token=tokenFrom(req);
  if(!token) throw Object.assign(new Error("请先登录。"),{status:401});
  const user=await supabaseJson(authUrl("user"),{headers:anonHeaders({Authorization:`Bearer ${token}`})});
  const rows=await supabaseJson(restUrl("profiles",`?id=eq.${encodeURIComponent(user.id)}&limit=1`),{headers:serviceHeaders()});
  const profile=rows?.[0];
  if(!profile || profile.status!=="active") throw Object.assign(new Error("账号未启用。"),{status:403});
  return profile;
}
async function getOrCreateConversation(profile, orderId="") {
  const query = orderId
    ? `?boss_id=eq.${encodeURIComponent(profile.id)}&order_id=eq.${encodeURIComponent(orderId)}&limit=1`
    : `?boss_id=eq.${encodeURIComponent(profile.id)}&order_id=is.null&limit=1`;
  const existing=await supabaseJson(restUrl("conversations",query),{headers:serviceHeaders()});
  if(existing?.[0]) return existing[0];
  const rows=await supabaseJson(restUrl("conversations"),{method:"POST",headers:serviceHeaders(),body:JSON.stringify({boss_id:profile.id,order_id:orderId||null,status:"waiting_service",created_at:nowIso(),updated_at:nowIso()})});
  return rows?.[0];
}
async function loadMessages(conversationId) {
  const rows=await supabaseJson(restUrl("messages",`?conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.asc&limit=200`),{headers:serviceHeaders()});
  return Array.isArray(rows)?rows:[];
}

export default async function handler(req,res){
  if(!hasDb()) return json(res,503,{ok:false,configured:false,message:"未配置 Supabase，在线客服不能保存真实聊天。"});
  try{
    const profile=await profileFromToken(req);
    const orderId=String(req.method==="GET"?req.query.order_id||"":(req.body?.order_id||""));
    const conversation=await getOrCreateConversation(profile,orderId);
    if(req.method==="GET") return json(res,200,{ok:true,conversation,messages:await loadMessages(conversation.id),serviceStatus:conversation.customer_service_id?"已接入":"正在等待客服接入"});
    if(req.method!=="POST") return json(res,405,{ok:false,message:"Method Not Allowed"});
    const body=await parseBody(req);
    const content=String(body.content||"").trim();
    if(!content) return json(res,400,{ok:false,message:"请输入消息内容"});
    const rows=await supabaseJson(restUrl("messages"),{method:"POST",headers:serviceHeaders(),body:JSON.stringify({conversation_id:conversation.id,sender_id:profile.id,sender_role:profile.role,message_type:"text",content,order_id:orderId||null,created_at:nowIso()})});
    await supabaseJson(restUrl("conversations",`?id=eq.${encodeURIComponent(conversation.id)}`),{method:"PATCH",headers:serviceHeaders(),body:JSON.stringify({updated_at:nowIso()})});
    return json(res,200,{ok:true,message:"消息已发送",row:rows?.[0]||null});
  }catch(error){return json(res,error.status||500,{ok:false,message:error.message||"在线客服接口异常"});}
}
