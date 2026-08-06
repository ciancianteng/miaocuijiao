/**
 * Admin: Resend domain status + DNS recipe for meowcuijiao.com.
 * Never returns API key values.
 */
import { mailProviderStatus, sendMail } from "../_mail.js";

const ADMIN_ROLES = new Set(["super_admin", "admin"]);
const DEFAULT_DOMAIN = "meowcuijiao.com";

function json(res, status, data) {
  res.status(status).json(data);
}

function env(name, fallback = "") {
  const raw = process.env[name];
  if (raw == null) return String(fallback || "").trim();
  return String(raw).trim().replace(/^['"]|['"]$/g, "");
}

async function resend(path, { method = "GET", body } = {}) {
  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) {
    const err = new Error("未配置 RESEND_API_KEY");
    err.status = 503;
    err.code = "NO_RESEND";
    throw err;
  }
  const response = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(data?.message || data?.error || text || `Resend HTTP ${response.status}`);
    err.status = response.status;
    err.body = data;
    throw err;
  }
  return data;
}

function normalizeRecordName(name, domain) {
  const raw = String(name || "").trim();
  if (!raw || raw === "@" || raw === domain) return "";
  return raw.replace(new RegExp(`\\.${domain.replace(/\./g, "\\.")}$`), "").replace(/\.$/, "");
}

function buildDnsPlan(domainObj, domain) {
  const records = Array.isArray(domainObj?.records) ? domainObj.records : [];
  const mapped = records.map((r) => ({
    purpose: r.record || r.type,
    type: String(r.type || "").toUpperCase(),
    name: normalizeRecordName(r.name, domain),
    host: normalizeRecordName(r.name, domain) || "@",
    value: String(r.value || "").replace(/^"|"$/g, ""),
    priority: r.priority == null ? undefined : Number(r.priority),
    ttl: r.ttl || "Auto",
    status: r.status || "",
  }));
  // DMARC is not provided by Resend — add recommended starter policy.
  mapped.push({
    purpose: "DMARC",
    type: "TXT",
    name: "_dmarc",
    host: "_dmarc",
    value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
    ttl: "Auto",
    status: "manual",
  });
  return mapped;
}

async function ensureDomain(domain) {
  const listed = await resend("/domains");
  const rows = listed?.data || listed || [];
  let found = (Array.isArray(rows) ? rows : []).find((d) => d.name === domain);
  if (!found) {
    try {
      found = await resend("/domains", {
        method: "POST",
        body: { name: domain, region: env("RESEND_REGION") || "ap-northeast-1" },
      });
    } catch (err) {
      // region may be unsupported on some plans
      found = await resend("/domains", { method: "POST", body: { name: domain } });
    }
  }
  const detail = await resend(`/domains/${found.id}`);
  return detail || found;
}

export default async function handler(req, res) {
  let admin;
  try {
    admin = await (await import("../_admin-auth.js")).requireAdmin(req, { allowRoles: ADMIN_ROLES });
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权" });
  }

  const url = new URL(req.url || "/", "http://localhost");
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const action = String(body.action || url.searchParams.get("action") || "status").trim();
  const domain = String(body.domain || url.searchParams.get("domain") || DEFAULT_DOMAIN)
    .trim()
    .toLowerCase();

  try {
    if (req.method === "GET" || action === "status") {
      const provider = mailProviderStatus();
      let domainInfo = null;
      let dnsRecords = [];
      let resendError = "";
      try {
        domainInfo = await ensureDomain(domain);
        dnsRecords = buildDnsPlan(domainInfo, domain);
      } catch (err) {
        resendError = err.message || String(err);
      }
      return json(res, 200, {
        ok: true,
        provider: {
          resend: provider.resend,
          from: provider.from,
          vercelEnv: provider.vercelEnv,
          resendKeyConfigured: !!provider.resend,
        },
        domain: domainInfo
          ? {
              id: domainInfo.id,
              name: domainInfo.name,
              status: domainInfo.status,
              region: domainInfo.region,
              createdAt: domainInfo.created_at,
            }
          : { name: domain, status: "unavailable", error: resendError },
        dnsRecords,
        recommendedFrom: `Meow Cui Jiao <orders@${domain}>`,
        notes: [
          "先把 dnsRecords 全部写入 DNS（建议 Vercel DNS），再切 Nameserver。",
          "切 NS 前必须先完成 Namecheap WHOIS 验证（当前 NS 若为 verify-contact-details / failed-whois-verification 则无法生效）。",
          "DMARC 记录为建议值（p=none），可后续加强。",
        ],
        adminId: admin.id,
      });
    }

    if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });

    if (action === "ensure" || action === "create") {
      const domainInfo = await ensureDomain(domain);
      return json(res, 200, {
        ok: true,
        domain: {
          id: domainInfo.id,
          name: domainInfo.name,
          status: domainInfo.status,
          region: domainInfo.region,
        },
        dnsRecords: buildDnsPlan(domainInfo, domain),
      });
    }

    if (action === "verify") {
      const domainInfo = await ensureDomain(domain);
      const verified = await resend(`/domains/${domainInfo.id}/verify`, { method: "POST" });
      const fresh = await resend(`/domains/${domainInfo.id}`);
      return json(res, 200, {
        ok: true,
        message: "已触发 Resend 域名验证",
        verify: verified,
        domain: {
          id: fresh.id,
          name: fresh.name,
          status: fresh.status,
          region: fresh.region,
        },
        dnsRecords: buildDnsPlan(fresh, domain),
      });
    }

    if (action === "send_test") {
      const to = String(body.to || "").trim().toLowerCase();
      if (!to) return json(res, 400, { ok: false, message: "请提供 to 邮箱" });
      const from = String(body.from || env("RESEND_ORDERS_FROM") || env("RESEND_FROM") || "").trim();
      const subject = String(body.subject || "【妙脆角】邮件连通性测试").trim();
      const text =
        String(body.text || "").trim() ||
        `这是 Meow Cui Jiao 邮件测试。\n时间：${new Date().toISOString()}\nFrom 尝试：${from || "(default)"}`;
      try {
        const result = await sendMail({
          to,
          subject,
          text,
          html: `<p>${text.replace(/\n/g, "<br>")}</p>`,
          purpose: "admin_dns_test",
          from: from || undefined,
        });
        return json(res, 200, { ok: true, message: `已发送至 ${to}`, result, fromUsed: from || mailProviderStatus().from });
      } catch (err) {
        // Auto-fallback already in order-notify; here surface raw error for DNS debugging.
        return json(res, err.status || 502, {
          ok: false,
          message: err.message || "发送失败",
          code: err.code || "",
          fromTried: from || mailProviderStatus().from,
        });
      }
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (err) {
    return json(res, err.status || 500, {
      ok: false,
      message: err.message || "Resend 域名接口异常",
      detail: err.body || null,
    });
  }
}
