/**
 * Launch-gate: Staging full order path + settlement + review.
 * Wraps accept-p0-four-end-checklist.mjs and adds env/banner gate checks.
 *
 * Usage:
 *   node scripts/accept-launch-order-path.mjs
 *   node scripts/accept-launch-order-path.mjs --base=https://meow-cuijiao-homepage-staging.vercel.app
 *
 * Refuses Production domains unless ALLOW_PROD_MUTATION + CONFIRM_PROD_MUTATION.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import { assertSafeDbTarget, loadEnvFiles } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);

const BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice(7) ||
  "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");

process.env.TARGET_URL = BASE;
assertSafeDbTarget({ script: "accept-launch-order-path.mjs" });

const OUT = path.join(root, "scripts/accept-launch-order-path-results.json");
const report = {
  meta: {
    base: BASE,
    startedAt: new Date().toISOString(),
    stagingFixed: "https://meow-cuijiao-homepage-staging.vercel.app/",
  },
  gates: {},
  orderPath: null,
  launch: "NO",
};

function gate(id, ok, note) {
  report.gates[id] = { status: ok ? "PASS" : "FAIL", note: String(note || "").slice(0, 600) };
  console.log(`${ok ? "PASS" : "FAIL"}`.padEnd(7), id, note || "");
}

async function checkHealth() {
  const r = await fetch(`${BASE}/api/auth?action=health`);
  const j = await r.json().catch(() => ({}));
  gate("G_health", r.ok && j.configured === true && !(j.missing || []).length, JSON.stringify(j).slice(0, 200));
}

async function checkEnvSeparationSignal() {
  // Compare Staging vs default Production host companion storage host.
  // If identical supabase project ref → env not separated (P0).
  let stagingHost = "";
  let prodHost = "";
  try {
    const s = await fetch(`${BASE}/api/public/companions?limit=1`).then((r) => r.json());
    const avatar = s.companions?.[0]?.avatar || "";
    stagingHost = avatar.includes("supabase.co") ? new URL(avatar).hostname : "";
  } catch (e) {
    stagingHost = `err:${e.message}`;
  }
  try {
    const p = await fetch(`https://meow-cuijiao-homepage.vercel.app/api/public/companions?limit=1`).then((r) =>
      r.json()
    );
    const avatar = p.companions?.[0]?.avatar || "";
    prodHost = avatar.includes("supabase.co") ? new URL(avatar).hostname : "";
  } catch (e) {
    prodHost = `err:${e.message}`;
  }
  const separated = stagingHost && prodHost && stagingHost !== prodHost;
  gate(
    "G_env_separated",
    separated,
    `stagingStorage=${stagingHost || "(none)"} prodVercelStorage=${prodHost || "(none)"} separated=${separated}`
  );
  report.meta.supabaseHosts = { staging: stagingHost, prodVercel: prodHost };
}

async function checkBannerLayout() {
  const html = await fetch(`${BASE}/`).then((r) => r.text());
  const cssHref =
    (html.match(/href="([^"]*home-banner[^"]*\.css)"/) || [])[1] ||
    (html.match(/href="(\/assets\/[^"]+\.css)"/) || [])[1] ||
    "";
  let css = "";
  if (cssHref) {
    const abs = cssHref.startsWith("http") ? cssHref : `${BASE}${cssHref}`;
    css = await fetch(abs).then((r) => r.text()).catch(() => "");
  }
  const hasHero = /mcj-home-hero/.test(html) || /mcj-home-hero/.test(css);
  const coverFill =
    /object-fit:\s*cover/i.test(css) ||
    /object-fit:cover/i.test(css) ||
    /COVER-fills/i.test(css) ||
    /data-crop-ready/.test(css);
  const shortClampBroken = /clamp\(\s*168px/i.test(css);
  const ok = hasHero && coverFill && !shortClampBroken;
  gate(
    "G_banner_layout",
    ok,
    `hasHero=${hasHero} coverFill=${coverFill} shortClamp168=${shortClampBroken} css=${cssHref || "(inline/unknown)"}`
  );
}

function runChecklist() {
  const script = path.join(root, "scripts/accept-p0-four-end-checklist.mjs");
  const r = spawnSync(process.execPath, [script, `--base=${BASE}`], {
    encoding: "utf8",
    cwd: root,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  console.log(r.stdout || "");
  if (r.stderr) console.error(r.stderr);
  const resultsPath = path.join(root, "scripts/accept-p0-four-end-checklist-results.json");
  let checklist = null;
  if (fs.existsSync(resultsPath)) {
    checklist = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  }
  report.orderPath = {
    exitCode: r.status,
    summary: checklist?.summary || null,
    orderId: checklist?.meta?.orderId || null,
    orderNo: checklist?.meta?.orderNo || null,
    results: checklist?.results || null,
  };
  const pass =
    r.status === 0 &&
    checklist?.summary?.fail === 0 &&
    checklist?.results?.C12_full_path?.status === "PASS" &&
    checklist?.results?.C09_settle_once?.status === "PASS";
  gate(
    "G_order_path",
    pass,
    `order=${checklist?.meta?.orderNo || checklist?.meta?.orderId || "n/a"} exit=${r.status} checklistFail=${checklist?.summary?.fail}`
  );
  return pass;
}

async function main() {
  console.log("LAUNCH ORDER PATH BASE", BASE);
  await checkHealth();
  await checkEnvSeparationSignal();
  await checkBannerLayout();

  const orderOk = runChecklist();
  const gateFails = Object.values(report.gates).filter((g) => g.status === "FAIL").length;
  report.meta.finishedAt = new Date().toISOString();
  // Production deploy requires ALL gates including env separation + banner.
  report.launch = gateFails === 0 && orderOk ? "YES" : "NO";
  report.productionDeployAllowed = report.launch === "YES";
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("\n=== LAUNCH GATE ===");
  console.log(`launch=${report.launch} productionDeployAllowed=${report.productionDeployAllowed}`);
  console.log(`orderId=${report.orderPath?.orderId} orderNo=${report.orderPath?.orderNo}`);
  console.log(`wrote ${OUT}`);
  process.exit(report.launch === "YES" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  report.meta.error = e.message;
  report.launch = "NO";
  report.productionDeployAllowed = false;
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  process.exit(1);
});
