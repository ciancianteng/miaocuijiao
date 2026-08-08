import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);
const U = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const K = env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };

async function main() {
  const t = await fetch(`${U}/rest/v1/gameplay_products?select=id,name,status,price,cover_url&limit=20`, { headers: h });
  console.log("gameplay_products", t.status, (await t.text()).slice(0, 1000));
  const a = await fetch(
    `${U}/rest/v1/announcements?select=id,title,is_active,content,updated_at&order=updated_at.desc&limit=40`,
    { headers: h }
  );
  const rows = await a.json();
  const gp = (Array.isArray(rows) ? rows : []).filter(
    (r) =>
      String(r.title || "").includes("[MCJ_GP]") ||
      String(r.title || "").includes("TEST") ||
      String(r.content || "").includes("p03-test") ||
      String(r.content || "").includes("[TEST]")
  );
  console.log(
    "announcements gp/test",
    gp.map((r) => ({ id: r.id, title: r.title, active: r.is_active, content: String(r.content || "").slice(0, 180) }))
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
