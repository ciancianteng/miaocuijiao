import { readFileSync, writeFileSync } from "node:fs";
const f = "companion-apply.html";
let t = readFileSync(f, "utf8");
t = t.replace(/companion-application\.js\?v=[^"']+/, "companion-application.js?v=20260924voiceStop1");
t = t.replace(/companion-application\.css\?v=[^"']+/, "companion-application.css?v=20260924voiceStop1");
writeFileSync(f, t);
console.log(t.match(/companion-application\.(js|css)\?v=[^"']+/g));
