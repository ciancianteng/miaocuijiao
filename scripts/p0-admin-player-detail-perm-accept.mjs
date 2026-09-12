/**
 * P0: admin players list + detail share the same auth.
 * Usage: node scripts/p0-admin-player-detail-perm-accept.mjs
 */
const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN = process.env.MCJ_ADMIN_EMAIL || "admin@meow.test";

const results = [];
function ok(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail || "") });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function api(path, token, body, method = "POST") {
  const res = await fetch(`${STAGING}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

(async () => {
  console.log("BASE", STAGING);
  const login = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, role: "admin" });
  const token = login.json?.session?.accessToken || "";
  const role = login.json?.session?.user?.role || "";
  ok("admin login", !!token && /admin|super_admin/.test(role), `role=${role}`);

  const list = await api("/api/admin/players", token, null, "GET");
  ok("players list allowed", !!list.json?.ok && Array.isArray(list.json?.players), list.json?.message || list.status);
  const id = list.json?.players?.[0]?.id;
  ok("players list has rows", !!id, `n=${(list.json?.players || []).length}`);

  const detailGet = await api(`/api/admin/players?id=${encodeURIComponent(id || "")}`, token, null, "GET");
  ok(
    "players detail GET allowed",
    !!detailGet.json?.ok && !!(detailGet.json?.player || detailGet.json?.detail),
    detailGet.json?.message || detailGet.status
  );
  ok(
    "detail not permission error",
    !/没有陪玩管理权限/.test(String(detailGet.json?.message || "")),
    detailGet.json?.message || ""
  );

  const detailPost = await api("/api/admin/players", token, { action: "detail", id });
  ok(
    "players detail POST allowed",
    !!detailPost.json?.ok && !!(detailPost.json?.player || detailPost.json?.detail),
    detailPost.json?.message || detailPost.status
  );

  const noTok = await api(`/api/admin/players?id=${encodeURIComponent(id || "x")}`, null, null, "GET");
  ok("detail without token rejected", !noTok.json?.ok, noTok.json?.message || noTok.status);

  // Frontend assets bumped
  const html = await fetch(`${STAGING}/admin.html`, { cache: "no-store" }).then((r) => r.text());
  ok("admin.html loads playerPerm assets or suite", /admin-player-detail\.js|admin-suite\.js/.test(html), "");

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
