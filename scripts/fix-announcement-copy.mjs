import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TITLE = "欢迎来到 MEOW CUI JIAO";
const BODY = "平台支持在线选陪玩、下单、客服接待与售后。充值猫粮后即可下单体验完整流程。";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const sample = await c.query(
  `select id, type, title, status, enabled, draft, published from public.platform_content_items where type='announcements' limit 5`
);
console.log(JSON.stringify(sample.rows, null, 2));

const actions = [];
for (const row of sample.rows) {
  const pub = row.published && typeof row.published === "object" ? { ...row.published } : {};
  const draft = row.draft && typeof row.draft === "object" ? { ...row.draft } : {};
  const looksChildish =
    row.title === "可爱" ||
    String(pub.content || pub.text || "").includes("我很可爱") ||
    String(draft.content || draft.text || "").includes("我很可爱");
  if (!looksChildish) continue;
  pub.title = TITLE;
  pub.content = BODY;
  pub.text = BODY;
  pub.category = pub.category || "home";
  pub.audience = pub.audience || "home";
  pub.enabled = true;
  pub.published = true;
  draft.title = TITLE;
  draft.content = BODY;
  draft.text = BODY;
  await c.query(
    `update public.platform_content_items
     set title=$2, draft=$3::jsonb, published=$4::jsonb, status='published', enabled=true, updated_at=now()
     where id=$1`,
    [row.id, TITLE, JSON.stringify(draft), JSON.stringify(pub)]
  );
  actions.push(row.id);
}

// announcements table
const annCols = (
  await c.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name='announcements'`
  )
).rows.map((r) => r.column_name);
if (annCols.includes("title") && annCols.includes("content")) {
  const r = await c.query(
    `update public.announcements
     set title=$1, content=$2, updated_at=now()
     where title='可爱' or content ilike '%我很可爱%'
     returning id, title`,
    [TITLE, BODY]
  );
  actions.push(...r.rows.map((x) => "ann:" + x.id));
}

fs.writeFileSync(path.join(ROOT, "scripts/fix-announcement-copy-results.json"), JSON.stringify({ actions }, null, 2));
console.log(JSON.stringify({ actions }, null, 2));
await c.end();
