import fs from "fs";

const files = ["index.html", "companion-center.html", "profile.html"];
for (const file of files) {
  let t = fs.readFileSync(file, "utf8");
  if (t.includes("companion-media.js")) {
    console.log("already", file);
    continue;
  }
  const needle = '<script src="src/avatar-fallback.js"></script>';
  if (!t.includes(needle)) {
    console.log("missing", file);
    continue;
  }
  t = t.replace(
    needle,
    '<script src="src/avatar-fallback.js"></script>\n  <script src="src/companion-media.js?v=20260802mediaSync"></script>'
  );
  fs.writeFileSync(file, t);
  console.log("wired", file);
}
