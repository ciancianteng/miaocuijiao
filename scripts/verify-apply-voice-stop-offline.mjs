#!/usr/bin/env node
import { readFileSync } from "node:fs";
const t = readFileSync("src/companion-application.js", "utf8");
const checks = [
  ["refreshVoiceUi exists", t.includes("function refreshVoiceUi")],
  ["stop uses !== inactive", t.includes('rec.state !== "inactive"')],
  ["stop button label", t.includes("停止录音")],
  ["short duration tip", t.includes("至少需要录制")],
  ["abortVoiceRecording", t.includes("function abortVoiceRecording")],
  ["pagehide abort", /pagehide[\s\S]{0,120}abortVoiceRecording/.test(t)],
  ["no setRecordingUi", !t.includes("setRecordingUi")],
  ["CRITICAL re-render comment", t.includes("data-record-stop] exists")],
  ["voicePhase state machine", t.includes("VOICE_PHASE")],
  ["prev/next abort", /data-apply-prev[\s\S]{0,200}abortVoiceRecording/.test(t)],
];
let fail = 0;
for (const [n, ok] of checks) {
  console.log(ok ? "PASS" : "FAIL", n);
  if (!ok) fail++;
}
try {
  new Function(t);
  console.log("PASS syntax");
} catch (e) {
  console.log("FAIL syntax", e.message);
  fail++;
}
process.exit(fail ? 1 : 0);
