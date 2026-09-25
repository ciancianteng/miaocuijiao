#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const html = await (await fetch("https://www.meowcuijiao.com/admin.html")).text();
const voices = await (await fetch("https://www.meowcuijiao.com/api/platform/content?types=voice_types")).json();
const out = {
  hasNav: /data-section="voice-types"/.test(html),
  hasScript: /admin-companion-voice-types/.test(html),
  hasMount: /companionVoiceTypeManagement/.test(html),
  publicVoiceCount: (voices.byType?.voice_types || []).length,
  sample: (voices.byType?.voice_types || []).slice(0, 8).map((x) => x.name),
};
writeFileSync("artifacts/voice-admin/PROD_PROBE.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
