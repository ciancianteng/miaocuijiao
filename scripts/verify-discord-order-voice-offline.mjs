#!/usr/bin/env node
/**
 * Offline verification: Discord private order voice rooms (Phase 1).
 * No network / no Discord API / no Production writes.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeVoiceMode,
  voiceModeLabel,
  orderVoiceView,
} from "../server/api/_discord-voice-orders.js";
import { safeChannelName, recommendedRedirectUri, discordConfig } from "../server/api/_discord.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message || e) });
    console.error(`FAIL  ${name}: ${e?.message || e}`);
  }
}

test("migration exists and is non-destructive", () => {
  const sql = read("supabase/migrations/20260920_discord_order_voice.sql");
  assert.match(sql, /add column if not exists voice_mode/i);
  assert.match(sql, /user_discord_links/);
  assert.match(sql, /game_mic/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /drop column/i);
});

test("normalizeVoiceMode defaults to game_mic", () => {
  assert.equal(normalizeVoiceMode(""), "game_mic");
  assert.equal(normalizeVoiceMode("discord"), "discord");
  assert.equal(normalizeVoiceMode("none"), "none");
  assert.equal(normalizeVoiceMode("no_voice"), "none");
});

test("voice labels", () => {
  assert.match(voiceModeLabel("game_mic"), /游戏麦/);
  assert.match(voiceModeLabel("discord"), /Discord/);
  assert.match(voiceModeLabel("none"), /平台.*聊天|文字/);
});

test("safe channel name strips PII-like chars", () => {
  assert.equal(safeChannelName("MCJ-5821"), "MCJ-5821");
  assert.equal(safeChannelName("MCJ-5821 老板张三"), "MCJ-5821");
  assert.doesNotMatch(safeChannelName("order@boss.com"), /@/);
});

test("recommended redirect URI uses api/discord/oauth-callback", () => {
  const uri = recommendedRedirectUri();
  assert.match(uri, /\/api\/discord\/oauth-callback$/);
});

test("discordConfig never exposes secrets in frontend sources", () => {
  const cfg = discordConfig();
  assert.ok("clientSecret" in cfg);
  const feFiles = [
    "src/payment-confirm.js",
    "src/place-order-modal.js",
    "src/companion-workbench.js",
    "src/multi-companion-team.js",
    "orders.html",
  ];
  for (const f of feFiles) {
    const src = read(f);
    assert.doesNotMatch(src, /DISCORD_BOT_TOKEN\s*=\s*['"][^'"]+/);
    assert.doesNotMatch(src, /DISCORD_CLIENT_SECRET\s*=\s*['"][^'"]+/);
    assert.doesNotMatch(src, /process\.env\.DISCORD_BOT_TOKEN/);
    assert.doesNotMatch(src, /process\.env\.DISCORD_CLIENT_SECRET/);
  }
});

test("orderVoiceView pending / ready / bind flags", () => {
  const pending = orderVoiceView(
    { voice_mode: "discord", discord_channel_id: null, discord_channel_status: "pending" },
    { discordLink: null }
  );
  assert.equal(pending.discordRequiresBind, true);
  assert.equal(pending.discordRoomPending, true);
  const ready = orderVoiceView(
    {
      voice_mode: "discord",
      discord_channel_id: "ch123",
      discord_channel_status: "ready",
    },
    { discordLink: { discord_user_id: "u1", discord_username: "Boss" } }
  );
  assert.equal(ready.discordRequiresBind, false);
  assert.equal(ready.discordBound, true);
  assert.ok(ready.discordChannelId === "ch123");
});

test("API routes exist", () => {
  for (const f of [
    "server/api/discord/oauth-start.js",
    "server/api/discord/oauth-callback.js",
    "server/api/discord/status.js",
    "server/api/discord/retry-channel.js",
    "server/api/cron/discord-channel-cleanup.js",
    "server/api/_discord.js",
    "server/api/_discord-voice-orders.js",
  ]) {
    assert.ok(existsSync(path.join(root, f)), missing(f));
  }
  function missing(f) {
    return `missing ${f}`;
  }
});

test("vercel cron registers discord cleanup", () => {
  const v = JSON.parse(read("vercel.json"));
  assert.ok(Array.isArray(v.crons));
  assert.ok(v.crons.some((c) => c.path === "/api/cron/discord-channel-cleanup"));
});

test("env examples list Discord vars without values", () => {
  for (const f of [".env.example", ".env.preview.example", ".env.production.example"]) {
    const src = read(f);
    assert.match(src, /DISCORD_CLIENT_ID=/);
    assert.match(src, /DISCORD_CLIENT_SECRET=/);
    assert.match(src, /DISCORD_BOT_TOKEN=/);
    assert.match(src, /DISCORD_GUILD_ID=/);
    assert.match(src, /DISCORD_ORDER_CATEGORY_ID=/);
    assert.match(src, /DISCORD_REDIRECT_URI=/);
    assert.doesNotMatch(src, /DISCORD_BOT_TOKEN=.+/);
    assert.doesNotMatch(src, /DISCORD_CLIENT_SECRET=.+/);
  }
});

test("Boss checkout UI is Discord / 游戏麦 only (default game_mic)", () => {
  const js = read("src/place-order-modal.js");
  assert.match(js, /voiceMode:\s*"game_mic"/);
  assert.match(js, /data-po-voice="game_mic"/);
  assert.match(js, /data-po-voice="discord"/);
  assert.doesNotMatch(js, /data-po-voice="none"/);
  assert.match(js, /本单语音方式|Discord语音房/);
  const team = read("src/multi-companion-team.js");
  assert.match(team, /data-mcj-team-voice="discord"/);
  assert.match(team, /data-mcj-team-voice="game_mic"/);
  assert.doesNotMatch(team, /data-mcj-team-voice="none"/);
});

test("payment-confirm post-pay Discord bind UI (no pay-time gate)", () => {
  const js = read("src/payment-confirm.js");
  assert.match(js, /连接 Discord/);
  assert.match(js, /data-discord-connect/);
  assert.match(js, /oauth-start\?format=json/);
  assert.match(js, /支付成功后可连接 Discord|私人语音房/);
  // Pay path must not hard-block on Discord bind.
  assert.doesNotMatch(js, /DISCORD_BIND_REQUIRED/);
  const orders = read("server/api/orders.js");
  assert.doesNotMatch(orders, /DISCORD_BIND_REQUIRED/);
});

test("orders GET select includes voice_mode columns", () => {
  const orders = read("server/api/orders.js");
  assert.match(orders, /selectVoice[\s\S]*voice_mode,discord_channel_id/);
  assert.match(orders, /selectCore\s*=\s*[\s\S]*selectVoice/);
});

test("discord cleanup uses created_at (orders has no updated_at)", () => {
  const sql = read("supabase/migrations/20260920_discord_order_voice.sql");
  assert.match(sql, /orders_discord_cleanup_idx[\s\S]{0,200}created_at/);
  assert.doesNotMatch(sql, /orders_discord_cleanup_idx[\s\S]{0,200}updated_at/);
  const cleanup = read("server/api/_discord-voice-orders.js");
  assert.match(cleanup, /created_at=lte\./);
  assert.doesNotMatch(cleanup, /&updated_at=lte\./);
});

test("companion accept gate + soft-exit revoke wired", () => {
  const companion = read("server/api/companion.js");
  assert.match(companion, /DISCORD_BIND_REQUIRED/);
  assert.match(companion, /ensureOrderVoiceChannel/);
  const partial = read("server/api/_multi-order-partial.js");
  assert.match(partial, /revokeCompanionVoiceAccess/);
  const wb = read("src/companion-workbench.js");
  assert.match(wb, /DISCORD_BIND_REQUIRED/);
  assert.match(wb, /startDiscordOAuth/);
  assert.match(wb, /err\.code=body&&body\.code/);
});

test("channel create uses @everyone deny overwrites", () => {
  const d = read("server/api/_discord.js");
  assert.match(d, /everyoneDenyOverwrite/);
  assert.match(d, /VIEW_CHANNEL/);
  assert.match(d, /CONNECT/);
  assert.match(d, /SPEAK/);
  assert.match(d, /parent_id:\s*c\.categoryId/);
  assert.match(d, /type:\s*2/);
});

test("idempotent ensureOrderVoiceChannel reuses discord_channel_id", () => {
  const src = read("server/api/_discord-voice-orders.js");
  assert.match(src, /already have channel|reused:\s*true|if \(owner\.discord_channel_id\)/);
  assert.match(src, /resolveVoiceOwnerOrder/);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
