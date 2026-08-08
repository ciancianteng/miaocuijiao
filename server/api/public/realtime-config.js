import "../_load-env.js";

function json(res, status, data) {
  return res.status(status).json(data);
}

function env(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") {
    return (
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      ""
    );
  }
  return process.env[key] || "";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "GET") return json(res, 405, { ok: false, message: "Method not allowed" });
  const url = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    return json(res, 503, { ok: false, configured: false, message: "Realtime 未配置。" });
  }
  return json(res, 200, {
    ok: true,
    configured: true,
    url,
    anonKey,
    realtime: true,
  });
}
