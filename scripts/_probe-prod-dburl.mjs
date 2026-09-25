import fs from "node:fs";
const t = fs.readFileSync("../meow-cuijiao-homepage/.env.local", "utf8");
for (const k of ["DATABASE_URL", "SUPABASE_DB_PASSWORD", "DIRECT_URL", "PROD_DATABASE_URL"]) {
  const m = t.match(new RegExp("^" + k + "=(.*)$", "m"));
  if (!m) {
    console.log(k + "_MISSING");
    continue;
  }
  const v = m[1].replace(/^["']|["']$/g, "");
  console.log(
    k +
      "_SET=" +
      (v.length > 0) +
      "_LEN=" +
      v.length +
      "_HAS_PROD_REF=" +
      /jqfak/i.test(v) +
      "_SENSITIVE=" +
      /SENSITIVE/i.test(v)
  );
}
