#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const t = await fetch(`${STG}/admin.html`).then((r) => r.text());
writeFileSync(
  "artifacts/voice-admin/admin-html-probe.json",
  JSON.stringify(
    {
      hasNav: t.includes('data-section="voice-types"'),
      hasScript: t.includes("admin-companion-voice-types"),
      hasMount: t.includes("companionVoiceTypeManagement"),
      len: t.length,
    },
    null,
    2
  )
);
console.log("ok");
