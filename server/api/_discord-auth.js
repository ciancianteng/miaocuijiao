/** Shared auth helper for Discord routes (any logged-in Meow user). */
function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") {
    return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  }
  return process.env[key] || "";
}

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      body?.message || body?.error_description || (typeof body === "string" ? body : "") || "Auth failed";
    const err = new Error(message);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function requireAuthProfile(req) {
  const token = tokenFrom(req);
  if (!token) {
    const err = new Error("请先登录");
    err.status = 401;
    throw err;
  }
  const authUser = await supabaseJson(`${envValue("SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      apikey: envValue("SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const rows = await supabaseJson(
    `${envValue("SUPABASE_URL")}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    }
  );
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) {
    const err = new Error("账号资料不存在");
    err.status = 403;
    throw err;
  }
  if (String(profile.status || "").toLowerCase() === "disabled") {
    const err = new Error("账号已停用");
    err.status = 403;
    throw err;
  }
  return { ...profile, _authUser: authUser };
}
