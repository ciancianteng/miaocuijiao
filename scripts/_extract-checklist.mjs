import fs from "fs";
const p =
  "C:/Users/cianc/.cursor/projects/c-Users-cianc-Desktop-meow-cuijiao-homepage-meow-cuijiao-homepage/agent-transcripts/5b057b6c-5479-4da7-8db1-7a04cbabfa50/5b057b6c-5479-4da7-8db1-7a04cbabfa50.jsonl";
const lines = fs.readFileSync(p, "utf8").split(/\n/);
for (const line of lines) {
  if (!line.includes("A01 陪玩账号")) continue;
  const j = JSON.parse(line);
  const t = j.message?.content?.[0]?.text || "";
  const start = t.indexOf("A. 登录");
  const end = t.indexOf("最终请输出完整报告");
  fs.writeFileSync(
    "scripts/_checklist-dump.txt",
    t.slice(start, end > start ? end : start + 12000)
  );
  console.log("wrote", end - start);
  break;
}
