/**
 * Scheduler tick for 更多玩法 no-taker timeouts (designated → 抢单大厅 → auto refund).
 * Calls GET /api/cron/gameplay-no-taker; it never reads or writes the database itself.
 *
 * Usage:
 *   node scripts/cron-gameplay-no-taker-tick.mjs --base=https://www.meowcuijiao.com \
 *     [--optional-base=https://meow-cuijiao-homepage-staging.vercel.app] [--ticks=4] [--interval=60]
 *
 * --base failures exit 1; --optional-base failures are only logged.
 * CRON_SECRET (env) is sent as a Bearer token when set.
 */

function argList(name) {
  return process.argv
    .filter((a) => a.startsWith(`--${name}=`))
    .flatMap((a) => a.slice(name.length + 3).split(","))
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function argNumber(name, fallback) {
  const raw = argList(name)[0];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const required = argList("base");
const optional = argList("optional-base");
const ticks = Math.max(1, Math.floor(argNumber("ticks", 1)));
const intervalMs = argNumber("interval", 60) * 1000;
const secret = String(process.env.CRON_SECRET || "").trim();

if (!required.length && !optional.length) {
  console.error("usage: --base=<url> [--optional-base=<url>] [--ticks=N] [--interval=SECONDS]");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tick(base) {
  const started = Date.now();
  const headers = { Accept: "application/json" };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  try {
    const res = await fetch(`${base}/api/cron/gameplay-no-taker`, {
      headers,
      signal: AbortSignal.timeout(50_000),
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    const ok = res.ok && body?.ok === true;
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        base,
        status: res.status,
        ok,
        ms: Date.now() - started,
        reopened: body?.reopened ?? null,
        refunded: body?.refunded ?? null,
        actions: body?.actions ?? null,
        error: ok ? undefined : body?.error || body?.message || body?.raw,
      }),
    );
    return ok;
  } catch (err) {
    console.log(JSON.stringify({ at: new Date().toISOString(), base, ok: false, error: String(err?.message || err) }));
    return false;
  }
}

let requiredFailures = 0;
for (let i = 0; i < ticks; i += 1) {
  if (i > 0) await sleep(intervalMs);
  for (const base of required) {
    if (!(await tick(base))) requiredFailures += 1;
  }
  for (const base of optional) await tick(base);
}

if (requiredFailures) {
  console.error(`FAIL: ${requiredFailures} required tick(s) failed`);
  process.exit(1);
}
