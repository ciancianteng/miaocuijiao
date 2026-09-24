#!/usr/bin/env node
import { readFileSync } from "node:fs";
const t = readFileSync("src/companion-application.js", "utf8");
const checks = [
  ["confirm label 确认录音", t.includes("确认录音")],
  ["saving label 保存中", t.includes("保存中...")],
  ["done status 已录制", t.includes("已录制 ✓")],
  ["pending status 待确认", t.includes("待确认")],
  ["play 播放试听", t.includes("播放试听")],
  ["no listened gate on confirm", !/请先播放完整试听/.test(t)],
  ["canConfirm without listened", /canConfirm[\s\S]{0,200}hasLiveLocal[\s\S]{0,120}durationOk/.test(t)],
  ["stop button", t.includes("停止录音")],
  ["min 10 tip", t.includes("至少需要录制")],
  ["upload_media", t.includes("upload_media")],
  ["uploadBusy guard", /if \(uploadBusy\.voice\)/.test(t)],
  ["keep blob on fail", t.includes("录音仍在")],
  ["validation confirmed+durable", t.includes("语音介绍（需确认录音并上传成功）")],
  ["abortVoiceRecording", t.includes("function abortVoiceRecording")],
  ["pagehide abort", /pagehide[\s\S]{0,120}abortVoiceRecording/.test(t)],
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
