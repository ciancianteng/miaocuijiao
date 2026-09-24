#!/usr/bin/env node
/**
 * Offline checks for restored admin 声线管理 wiring.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const adminHtml = read("admin.html");
const voiceAdminJs = read("src/admin-companion-voice-types.js");
const voiceApi = read("server/api/admin/companion-voice-types.js");
const voiceStore = read("server/api/_companion-voice-types-store.js");
const migration = read("supabase/migrations/20260804_companion_voice_types.sql");
const pending = read("supabase/pending-prod/17_companion_voice_types.sql");
const workbench = read("src/companion-workbench.js");
const applyJs = read("src/companion-application.js");
const playerDetail = read("src/admin-player-detail.js");
const playersApi = read("server/api/admin/players.js");
const suite = read("src/admin-suite.js");

assert.match(adminHtml, /data-section="voice-types"/);
assert.match(adminHtml, /companionVoiceTypeManagement/);
assert.match(adminHtml, /admin-companion-voice-types\.js/);
assert.doesNotMatch(adminHtml, /id="section-voice-types"[\s\S]*id="section-voice-types"/);

assert.match(voiceAdminJs, /companionVoiceTypeManagement/);
assert.match(voiceAdminJs, /\/api\/admin\/companion-voice-types/);

assert.match(migration, /create table if not exists public\.companion_voice_types/);
assert.match(pending, /create table if not exists public\.companion_voice_types/);
assert.match(migration, /on conflict \(id\) do nothing/);

assert.match(voiceApi, /VOICE_TYPE_IN_USE|已有 .* 位陪玩使用/);
assert.match(voiceApi, /countCompanionsUsingVoiceName/);

assert.match(voiceStore, /DEFAULT_VOICE_TYPES/);
assert.match(workbench, /types=companion_tags,voice_types/);
assert.match(workbench, /activeVoiceOptionNames/);
assert.match(applyJs, /voice_types/);
assert.match(playerDetail, /voiceEditHtml|voice_type_opt/);
assert.match(playersApi, /voice_type/);
assert.match(playersApi, /voiceTypeOpts/);
assert.match(suite, /disabled:true[\s\S]*voice-types|voice-types[\s\S]*disabled:true/);

console.log("PASS verify-voice-admin-offline");
