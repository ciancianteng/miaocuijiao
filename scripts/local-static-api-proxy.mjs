import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STAGING = (process.env.MCJ_API_ORIGIN || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PORT = Number(process.env.PORT || 4177);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function resolveLocal(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0] || "/");
  if (p === "/companion" || p === "/companion/" || /^\/companion\/(?!.*\.).+/.test(p)) {
    const dirIndex = path.join(ROOT, p.replace(/\/$/, ""), "index.html");
    if (fs.existsSync(dirIndex)) return dirIndex;
    const spa = path.join(ROOT, "companion/index.html");
    if (fs.existsSync(spa)) return spa;
  }
  if (p.endsWith("/")) p += "index.html";
  let filePath = path.join(ROOT, p.replace(/^\//, ""));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  return filePath;
}

function normalizePortal(raw) {
  const p = String(raw || "").trim().toLowerCase();
  if (!p || p === "public" || p === "unified" || p === "auto" || p === "any") return "";
  if (p === "cs" || p === "service" || p === "customer-service") return "customer_service";
  if (p === "player" || p === "pw") return "companion";
  if (p === "customer" || p === "owner" || p === "user") return "boss";
  if (p === "super_admin" || p === "superadmin") return "admin";
  if (["boss", "companion", "customer_service", "admin"].includes(p)) return p;
  return "";
}

function denyMsg(portal) {
  if (portal === "boss") return "该账号暂无老板端权限";
  if (portal === "companion") return "该账号暂无陪玩端权限";
  if (portal === "customer_service") return "该账号暂无客服权限";
  if (portal === "admin") return "该账号暂无管理员权限";
  return "账号角色与当前入口不匹配。";
}

function redirectFor(role) {
  return (
    {
      boss: "/index.html",
      companion: "/companion/dashboard/",
      customer_service: "/customer-service/dashboard/",
      admin: "/admin/",
      super_admin: "/admin/",
    }[role] || "/index.html"
  );
}

/** Apply the fixed portal contract on top of staging auth payloads (local E2E). */
function applyPortalContract(reqBody, upstreamJson) {
  if (!upstreamJson || upstreamJson.ok === false) return { status: 401, json: upstreamJson };
  const portal = normalizePortal(reqBody.loginPortal || reqBody.portal || reqBody.role || "");
  let user = { ...(upstreamJson.session?.user || {}) };
  const primary = String(user.role || "").toLowerCase();
  let roles = Array.isArray(user.roles) ? [...user.roles] : [];

  // Heal phantom boss on companion-primary (mirrors enrichProfileRoles).
  if (primary === "companion" && roles.includes("boss")) {
    roles = roles.filter((r) => r !== "boss");
  }
  // Do not auto-grant boss to companion.
  const staff = primary === "admin" || primary === "super_admin" || primary === "customer_service";
  let hasCompanion = !!user.hasCompanion || roles.includes("companion") || primary === "companion";
  let hasBoss = staff ? false : !!user.hasBoss || roles.includes("boss") || primary === "boss";
  if (primary === "companion") hasBoss = roles.includes("boss"); // after heal => false
  if (primary === "boss" || primary === "customer") hasBoss = true;
  if (hasCompanion && !roles.includes("companion")) roles.push("companion");
  if (hasBoss && !roles.includes("boss") && !staff) roles.push("boss");

  user = { ...user, roles, hasBoss, hasCompanion };

  function hasAccess(p) {
    if (p === "boss") return !!hasBoss;
    if (p === "companion") return !!hasCompanion;
    if (p === "customer_service") return primary === "customer_service";
    if (p === "admin") return primary === "admin" || primary === "super_admin";
    return false;
  }

  if (portal && !hasAccess(portal)) {
    return { status: 403, json: { ok: false, message: denyMsg(portal), code: "PORTAL_DENIED" } };
  }

  if (portal === "boss") user = { ...user, role: "boss" };
  else if (portal === "companion") user = { ...user, role: "companion" };
  else if (portal === "customer_service") user = { ...user, role: "customer_service" };
  else if (portal === "admin") user = { ...user, role: primary === "super_admin" ? "super_admin" : "admin" };

  const needRolePick =
    !portal &&
    !staff &&
    !!user.hasBoss &&
    !!user.hasCompanion;

  const redirect = portal
    ? redirectFor(portal === "admin" ? user.role : portal)
    : user.hasBoss
      ? redirectFor("boss")
      : user.hasCompanion
        ? redirectFor("companion")
        : redirectFor(user.role);

  return {
    status: 200,
    json: {
      ...upstreamJson,
      ok: true,
      needRolePick,
      redirect,
      portals: {
        boss: user.hasBoss ? redirectFor("boss") : "",
        companion: user.hasCompanion ? redirectFor("companion") : "",
      },
      session: {
        ...(upstreamJson.session || {}),
        user,
      },
    },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    if (u.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const rawBody = Buffer.concat(chunks);
      let reqJson = null;
      try {
        reqJson = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : null;
      } catch {
        reqJson = null;
      }

      // Auth login/otp: hit staging without portal so credentials work, then apply local contract.
      const isAuthLogin =
        u.pathname === "/api/auth" &&
        req.method === "POST" &&
        reqJson &&
        ["login", "login_with_otp", "login_otp", "verify_login_otp"].includes(String(reqJson.action || ""));

      let targetPath = u.pathname + u.search;
      let forwardBody = rawBody;
      if (isAuthLogin) {
        const stripped = { ...reqJson };
        // Keep credentials; strip portal so staging accepts, then we enforce locally.
        delete stripped.loginPortal;
        delete stripped.portal;
        if (stripped.action === "login") delete stripped.role;
        forwardBody = Buffer.from(JSON.stringify(stripped));
      }

      const target = STAGING + targetPath;
      const headers = { ...req.headers, host: new URL(STAGING).host };
      delete headers["content-length"];
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : forwardBody,
        redirect: "manual",
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (isAuthLogin) {
        let upJson = {};
        try {
          upJson = JSON.parse(buf.toString("utf8"));
        } catch {
          upJson = {};
        }
        const applied = applyPortalContract(reqJson || {}, upJson);
        const out = Buffer.from(JSON.stringify(applied.json));
        res.writeHead(applied.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(out);
        return;
      }
      const outHeaders = {};
      upstream.headers.forEach((v, k) => {
        if (["content-encoding", "transfer-encoding", "content-length"].includes(k)) return;
        outHeaders[k] = v;
      });
      res.writeHead(upstream.status, outHeaders);
      res.end(buf);
      return;
    }
    const filePath = resolveLocal(u.pathname);
    if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found: " + u.pathname);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(err?.stack || err));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`local proxy http://127.0.0.1:${PORT} api→${STAGING} (auth portal contract local)`);
});
