import { installFlow } from "./ops-flow.mjs";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export class OpsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const SECRET_FIELDS = ["wechat", "whatsapp", "qq", "telegram"];
const FIELD_TYPES = ["text", "textarea", "radio", "checkbox", "select", "number"];
const REVIEW_ACTIONS = ["approve", "reject", "need_more", "exam_pass", "exam_fail", "revoke_badge"];
const LOCK_KEYS = [
  ["showOnCard", "allowShowOnCard", "show_on_card", "展示在我的个人卡片"],
  ["showPrice", "allowShowPrice", "show_price", "展示服务价格"],
  ["showIntro", "allowShowIntro", "show_intro", "展示服务介绍"],
  ["showBadge", "allowShowBadge", "show_badge", "展示技术认证徽章"],
  ["acceptOrders", "allowAcceptOrders", "accept_orders", "开启接单"]
];

function uid(prefix) {
  return prefix + "_" + randomUUID().slice(0, 8);
}

function now() {
  return new Date().toISOString();
}

function moneyNumber(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new OpsError(label + "必须是大于或等于 0 的数字");
  return Math.round(n * 100) / 100;
}

export function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return "";
  return "RM" + n.toFixed(2);
}

function bool(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function flag(value) {
  return bool(value) ? 1 : 0;
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text || "");
  } catch (e) {
    return fallback;
  }
}

export function openOpsDb(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return new OpsStore(db);
}

function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare("PRAGMA table_info(" + table + ")").all();
  if (!cols.some((col) => col.name === column)) db.exec("ALTER TABLE " + table + " ADD COLUMN " + column + " " + ddl);
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      price_min REAL,
      price_max REAL,
      unit TEXT NOT NULL DEFAULT '每小时',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requirement_fields (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      label TEXT NOT NULL,
      field_type TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      required INTEGER NOT NULL DEFAULT 0,
      show_boss INTEGER NOT NULL DEFAULT 1,
      show_companion INTEGER NOT NULL DEFAULT 1,
      show_order_detail INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS companions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      game TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offerings (
      companion_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      quote_price REAL,
      intro TEXT NOT NULL DEFAULT '',
      show_on_card INTEGER NOT NULL DEFAULT 0,
      show_price INTEGER NOT NULL DEFAULT 0,
      show_intro INTEGER NOT NULL DEFAULT 0,
      show_badge INTEGER NOT NULL DEFAULT 0,
      accept_orders INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (companion_id, service_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      boss_id TEXT NOT NULL,
      boss_name TEXT NOT NULL,
      companion_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total_price REAL NOT NULL,
      unit TEXT NOT NULL,
      service_snapshot_json TEXT NOT NULL,
      requirements_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_payment',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cert_applications (
      id TEXT PRIMARY KEY,
      companion_id TEXT NOT NULL,
      game TEXT NOT NULL,
      cert_item TEXT NOT NULL,
      tech_level TEXT NOT NULL,
      exam_note TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      proof TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cert_reviews (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      companion_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      game TEXT NOT NULL,
      cert_item TEXT NOT NULL,
      tech_level TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      issued_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS examiners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      wechat TEXT NOT NULL DEFAULT '',
      whatsapp TEXT NOT NULL DEFAULT '',
      qq TEXT NOT NULL DEFAULT '',
      telegram TEXT NOT NULL DEFAULT '',
      game TEXT NOT NULL,
      exam_note TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);
  const defaults = {
    allow_show_on_card: "1",
    allow_show_price: "1",
    allow_show_intro: "1",
    allow_show_badge: "1",
    allow_accept_orders: "1",
    units: JSON.stringify(["每小时", "每局", "每单"]),
    accept_timeout_minutes: "30",
    pay_timeout_minutes: "30",
    deposit_myr: "100",
    deposit_cny: "180",
    status_reminder_enabled: "1"
  };
  ensureColumn(db, "services", "voice_mode", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "discord_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "discord_status", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "companions", "last_seen_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "companions", "quiet_start", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "companions", "quiet_end", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "companions", "reminder_opt_in", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "companions", "last_reminder_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "services", "category", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "slot_start", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "slot_end", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "pay_channel_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "pay_currency", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "pay_amount", "REAL");
  ensureColumn(db, "orders", "pay_proof", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "pay_snapshot_json", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "review_note", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "updated_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "accept_deadline", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "pay_deadline", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "log_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "orders", "idempotency_key", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      payee TEXT NOT NULL DEFAULT '',
      bank TEXT NOT NULL DEFAULT '',
      account TEXT NOT NULL DEFAULT '',
      qr_url TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      audience TEXT NOT NULL DEFAULT 'home',
      pinned INTEGER NOT NULL DEFAULT 0,
      scrolling INTEGER NOT NULL DEFAULT 0,
      force_popup INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT NOT NULL DEFAULT '',
      ends_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deposit_submissions (
      id TEXT PRIMARY KEY,
      companion_id TEXT NOT NULL DEFAULT '',
      applicant_name TEXT NOT NULL DEFAULT '',
      channel_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      proof TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT NOT NULL DEFAULT '',
      channel_snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY,
      boss_id TEXT NOT NULL,
      boss_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      assignee_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      client_id TEXT,
      sender_role TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inbox_notifications (
      id TEXT PRIMARY KEY,
      audience TEXT NOT NULL,
      actor_id TEXT NOT NULL DEFAULT '',
      dedupe_key TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      href TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS inbox_dedupe ON inbox_notifications(dedupe_key);
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS grab_posts (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      duration TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL,
      requirements TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      claimed_by TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS service_gifts (
      id TEXT PRIMARY KEY,
      boss_id TEXT NOT NULL,
      boss_name TEXT NOT NULL,
      gift_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      proof TEXT NOT NULL DEFAULT '',
      pay_snapshot_json TEXT NOT NULL,
      review_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency ON orders(idempotency_key);
    CREATE UNIQUE INDEX IF NOT EXISTS chat_client_id ON chat_messages(client_id);
    CREATE INDEX IF NOT EXISTS chat_thread_time ON chat_messages(thread_id, created_at);
  `);
  ensureColumn(db, "chat_threads", "target_role", "TEXT NOT NULL DEFAULT 'boss'");
  ensureColumn(db, "chat_threads", "target_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "chat_messages", "kind", "TEXT NOT NULL DEFAULT 'text'");
  ensureColumn(db, "chat_messages", "payload_json", "TEXT NOT NULL DEFAULT ''");
  const insert = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  Object.keys(defaults).forEach(function (key) {
    insert.run(key, defaults[key]);
  });
}

class OpsStore {
  constructor(db) {
    this.db = db;
  }

  reset() {
    this.db.exec("BEGIN");
    try {
      ["service_gifts", "grab_posts", "push_subscriptions", "inbox_notifications", "chat_messages", "chat_threads", "deposit_submissions", "announcements", "payment_channels", "orders", "offerings", "requirement_fields", "badges", "cert_reviews", "cert_applications", "examiners", "services", "companions", "settings"].forEach((table) => {
        this.db.exec("DELETE FROM " + table);
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    migrate(this.db);
  }

  setting(key) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? row.value : "";
  }

  setSetting(key, value) {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  getSettings() {
    const units = parseJson(this.setting("units"), ["每小时", "每局", "每单"]);
    return {
      allowShowOnCard: this.setting("allow_show_on_card") !== "0",
      allowShowPrice: this.setting("allow_show_price") !== "0",
      allowShowIntro: this.setting("allow_show_intro") !== "0",
      allowShowBadge: this.setting("allow_show_badge") !== "0",
      allowAcceptOrders: this.setting("allow_accept_orders") !== "0",
      units: Array.isArray(units) ? units : ["每小时", "每局", "每单"],
      acceptTimeoutMinutes: Number(this.setting("accept_timeout_minutes") || 30),
      payTimeoutMinutes: Number(this.setting("pay_timeout_minutes") || 30),
      depositMyr: Number(this.setting("deposit_myr") || 100),
      depositCny: Number(this.setting("deposit_cny") || 180),
      statusReminderEnabled: this.setting("status_reminder_enabled") !== "0"
    };
  }

  updateSettings(input) {
    const current = this.getSettings();
    const next = Object.assign({}, current, input || {});
    if (Array.isArray(input.units)) {
      const units = input.units.map((item) => String(item || "").trim()).filter(Boolean);
      if (!units.length) throw new OpsError("至少保留一个计费单位");
      const used = this.db.prepare("SELECT DISTINCT unit FROM services").all().map((row) => row.unit);
      used.forEach((unit) => {
        if (units.indexOf(unit) < 0) throw new OpsError("单位「" + unit + "」仍被服务使用，不能删除");
      });
      next.units = units;
    }
    this.setSetting("allow_show_on_card", next.allowShowOnCard ? "1" : "0");
    this.setSetting("allow_show_price", next.allowShowPrice ? "1" : "0");
    this.setSetting("allow_show_intro", next.allowShowIntro ? "1" : "0");
    this.setSetting("allow_show_badge", next.allowShowBadge ? "1" : "0");
    this.setSetting("allow_accept_orders", next.allowAcceptOrders ? "1" : "0");
    this.setSetting("units", JSON.stringify(next.units));
    this.setSetting("accept_timeout_minutes", String(this.minuteSetting(next.acceptTimeoutMinutes, 30)));
    this.setSetting("pay_timeout_minutes", String(this.minuteSetting(next.payTimeoutMinutes, 30)));
    this.setSetting("deposit_myr", String(this.positiveMoney(next.depositMyr, 100, "MYR 押金")));
    this.setSetting("deposit_cny", String(this.positiveMoney(next.depositCny, 180, "CNY 押金")));
    return this.getSettings();
  }

  minuteSetting(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 10080) throw new OpsError("超时时间需要在 0 到 10080 分钟之间");
    return Math.round(Number.isFinite(n) ? n : fallback);
  }

  positiveMoney(value, fallback, label) {
    const n = Number(value === undefined ? fallback : value);
    if (!Number.isFinite(n) || n <= 0) throw new OpsError(label + "必须是大于 0 的数字");
    return Math.round(n * 100) / 100;
  }

  ensureUnit(unit) {
    const clean = String(unit || "").trim();
    if (!clean) throw new OpsError("请选择计费单位");
    const settings = this.getSettings();
    if (settings.units.indexOf(clean) < 0) {
      settings.units.push(clean);
      this.setSetting("units", JSON.stringify(settings.units));
    }
    return clean;
  }

  mapService(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      category: row.category || "",
      description: row.description || "",
      enabled: !!row.enabled,
      sort: Number(row.sort_order || 0),
      priceMin: row.price_min === null || row.price_min === undefined ? null : Number(row.price_min),
      priceMax: row.price_max === null || row.price_max === undefined ? null : Number(row.price_max),
      unit: row.unit || "",
      voiceMode: row.voice_mode || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapField(row) {
    return {
      id: row.id,
      serviceId: row.service_id,
      label: row.label,
      type: row.field_type,
      options: parseJson(row.options_json, []),
      required: !!row.required,
      showBoss: !!row.show_boss,
      showCompanion: !!row.show_companion,
      showOrderDetail: !!row.show_order_detail,
      sort: Number(row.sort_order || 0)
    };
  }

  mapCompanion(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      bio: row.bio || "",
      avatar: row.avatar || "",
      game: row.game || "",
      status: row.status || "active",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapOffering(row) {
    return {
      companionId: row.companion_id,
      serviceId: row.service_id,
      quotePrice: row.quote_price === null || row.quote_price === undefined ? null : Number(row.quote_price),
      intro: row.intro || "",
      showOnCard: !!row.show_on_card,
      showPrice: !!row.show_price,
      showIntro: !!row.show_intro,
      showBadge: !!row.show_badge,
      acceptOrders: !!row.accept_orders,
      updatedAt: row.updated_at
    };
  }

  mapOrder(row) {
    return {
      id: row.id,
      bossId: row.boss_id,
      bossName: row.boss_name,
      companionId: row.companion_id,
      serviceId: row.service_id,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
      totalPrice: Number(row.total_price),
      unit: row.unit,
      serviceSnapshot: parseJson(row.service_snapshot_json, {}),
      requirements: parseJson(row.requirements_json, []),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
      slotStart: row.slot_start || "",
      slotEnd: row.slot_end || "",
      acceptDeadline: row.accept_deadline || "",
      payDeadline: row.pay_deadline || "",
      payChannelId: row.pay_channel_id || "",
      payCurrency: row.pay_currency || "",
      payAmount: row.pay_amount === null || row.pay_amount === undefined ? null : Number(row.pay_amount),
      payProof: row.pay_proof || "",
      paySnapshot: parseJson(row.pay_snapshot_json, null),
      reviewNote: row.review_note || "",
      discordId: row.discord_id || "",
      discordStatus: row.discord_status || "",
      log: parseJson(row.log_json, [])
    };
  }

  mapApplication(row) {
    return {
      id: row.id,
      companionId: row.companion_id,
      game: row.game,
      certItem: row.cert_item,
      techLevel: row.tech_level,
      examNote: row.exam_note,
      description: row.description || "",
      proof: row.proof || "",
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapReview(row) {
    return {
      id: row.id,
      applicationId: row.application_id,
      action: row.action,
      reason: row.reason || "",
      actor: row.actor || "admin",
      createdAt: row.created_at
    };
  }

  mapBadge(row) {
    return {
      id: row.id,
      companionId: row.companion_id,
      applicationId: row.application_id,
      game: row.game,
      certItem: row.cert_item,
      techLevel: row.tech_level,
      active: !!row.active,
      issuedAt: row.issued_at,
      revokedAt: row.revoked_at || ""
    };
  }

  mapExaminer(row, includeSecrets) {
    const item = {
      id: row.id,
      name: row.name,
      game: row.game,
      examNote: row.exam_note || "",
      enabled: !!row.enabled,
      updatedAt: row.updated_at
    };
    if (includeSecrets) {
      item.wechat = row.wechat || "";
      item.whatsapp = row.whatsapp || "";
      item.qq = row.qq || "";
      item.telegram = row.telegram || "";
    }
    return item;
  }

  listServices() {
    return this.db.prepare("SELECT * FROM services ORDER BY sort_order ASC, created_at ASC").all().map((row) => this.mapService(row));
  }

  getService(id) {
    return this.mapService(this.db.prepare("SELECT * FROM services WHERE id = ?").get(id));
  }

  listFields(serviceId) {
    const sql = serviceId
      ? "SELECT * FROM requirement_fields WHERE service_id = ? ORDER BY sort_order ASC, label ASC"
      : "SELECT * FROM requirement_fields ORDER BY sort_order ASC, label ASC";
    const rows = serviceId ? this.db.prepare(sql).all(serviceId) : this.db.prepare(sql).all();
    return rows.map((row) => this.mapField(row));
  }

  saveService(input, id) {
    const name = String(input.name || "").trim();
    if (!name) throw new OpsError("请填写服务名称");
    const description = String(input.description || "").trim();
    const priceMin = moneyNumber(input.priceMin, "最低价格");
    const priceMax = moneyNumber(input.priceMax, "最高价格");
    if (priceMin === null || priceMax === null) throw new OpsError("最低价格和最高价格都要填写");
    if (priceMin > priceMax) throw new OpsError("最低价格不能高于最高价格");
    const unit = this.ensureUnit(input.unit || "每小时");
    const category = String(input.category || "").trim();
    const voiceMode = ["", "game", "discord"].indexOf(String(input.voiceMode || "")) >= 0 ? String(input.voiceMode || "") : "";
    const enabled = input.enabled === undefined ? 1 : flag(input.enabled);
    const sort = Number.isFinite(Number(input.sort)) ? Number(input.sort) : 0;
    const ts = now();
    if (!id) {
      id = uid("svc");
      this.db.prepare(`INSERT INTO services
        (id, name, description, enabled, sort_order, price_min, price_max, unit, category, voice_mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, description, enabled, sort, priceMin, priceMax, unit, category, voiceMode, ts, ts);
    } else {
      const current = this.getService(id);
      if (!current) throw new OpsError("服务不存在", 404);
      this.db.prepare(`UPDATE services
        SET name = ?, description = ?, enabled = ?, sort_order = ?, price_min = ?, price_max = ?, unit = ?, category = ?, voice_mode = ?, updated_at = ?
        WHERE id = ?`).run(name, description, enabled, sort, priceMin, priceMax, unit, category, voiceMode, ts, id);
    }
    return this.getService(id);
  }

  replaceFields(serviceId, fields) {
    if (!this.getService(serviceId)) throw new OpsError("服务不存在", 404);
    const clean = (Array.isArray(fields) ? fields : []).map((field, index) => this.normalizeField(field, index));
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM requirement_fields WHERE service_id = ?").run(serviceId);
      const insert = this.db.prepare(`INSERT INTO requirement_fields
        (id, service_id, label, field_type, options_json, required, show_boss, show_companion, show_order_detail, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      clean.forEach((field) => {
        insert.run(field.id, serviceId, field.label, field.type, JSON.stringify(field.options), flag(field.required), flag(field.showBoss), flag(field.showCompanion), flag(field.showOrderDetail), field.sort);
      });
      this.db.prepare("UPDATE services SET updated_at = ? WHERE id = ?").run(now(), serviceId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listFields(serviceId);
  }

  normalizeField(field, index) {
    const label = String(field.label || "").trim();
    const type = String(field.type || "").trim();
    if (!label) throw new OpsError("字段名称不能为空");
    if (FIELD_TYPES.indexOf(type) < 0) throw new OpsError("不支持的字段类型：" + type);
    let options = Array.isArray(field.options) ? field.options.map((item) => String(item || "").trim()).filter(Boolean) : [];
    if (["radio", "checkbox", "select"].indexOf(type) >= 0 && options.length < 1) {
      throw new OpsError("「" + label + "」至少需要一个选项");
    }
    if (["radio", "checkbox", "select"].indexOf(type) < 0) options = [];
    const id = field.id && String(field.id).indexOf("new_") !== 0 ? String(field.id) : uid("fld");
    return {
      id: id,
      label: label,
      type: type,
      options: options,
      required: !!field.required,
      showBoss: field.showBoss !== false,
      showCompanion: field.showCompanion !== false,
      showOrderDetail: field.showOrderDetail !== false,
      sort: Number.isFinite(Number(field.sort)) ? Number(field.sort) : index
    };
  }

  listCompanions() {
    return this.db.prepare("SELECT * FROM companions ORDER BY created_at DESC").all().map((row) => this.mapCompanion(row));
  }

  getCompanion(id) {
    return this.mapCompanion(this.db.prepare("SELECT * FROM companions WHERE id = ?").get(id));
  }

  saveCompanion(input, id) {
    const name = String(input.name || "").trim();
    if (!name) throw new OpsError("请填写陪玩名称");
    const bio = String(input.bio || "").trim();
    const avatar = String(input.avatar || "").trim();
    const game = String(input.game || "").trim();
    const status = input.status === "suspended" ? "suspended" : "active";
    const ts = now();
    if (!id) {
      id = uid("cmp");
      this.db.prepare(`INSERT INTO companions (id, name, bio, avatar, game, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, bio, avatar, game, status, ts, ts);
    } else {
      if (!this.getCompanion(id)) throw new OpsError("陪玩不存在", 404);
      this.db.prepare(`UPDATE companions SET name = ?, bio = ?, avatar = ?, game = ?, status = ?, updated_at = ? WHERE id = ?`)
        .run(name, bio, avatar, game, status, ts, id);
    }
    return this.getCompanion(id);
  }

  listOfferings(companionId) {
    const sql = companionId
      ? "SELECT * FROM offerings WHERE companion_id = ?"
      : "SELECT * FROM offerings";
    const rows = companionId ? this.db.prepare(sql).all(companionId) : this.db.prepare(sql).all();
    return rows.map((row) => this.mapOffering(row));
  }

  getOffering(companionId, serviceId) {
    const row = this.db.prepare("SELECT * FROM offerings WHERE companion_id = ? AND service_id = ?").get(companionId, serviceId);
    return row ? this.mapOffering(row) : null;
  }

  quoteIsValid(service, quote) {
    if (!service || service.priceMin === null || service.priceMax === null) return false;
    if (!Number.isFinite(quote)) return false;
    return quote >= service.priceMin && quote <= service.priceMax;
  }

  saveOffering(input, mode) {
    const companion = this.getCompanion(input.companionId);
    if (!companion) throw new OpsError("陪玩不存在", 404);
    const service = this.getService(input.serviceId);
    if (!service) throw new OpsError("服务不存在", 404);
    const existing = this.getOffering(companion.id, service.id);
    const settings = this.getSettings();
    const next = {
      quotePrice: input.quotePrice === "" || input.quotePrice === null || input.quotePrice === undefined ? null : moneyNumber(input.quotePrice, "陪玩报价"),
      intro: String(input.intro || "").trim(),
      showOnCard: !!input.showOnCard,
      showPrice: !!input.showPrice,
      showIntro: !!input.showIntro,
      showBadge: !!input.showBadge,
      acceptOrders: !!input.acceptOrders
    };
    if (mode !== "admin") {
      LOCK_KEYS.forEach((item) => {
        const key = item[0];
        const allowed = settings[item[1]];
        const previous = existing ? !!existing[key] : false;
        if (!allowed && next[key] !== previous) throw new OpsError("管理员已锁定「" + item[3] + "」，陪玩不能修改", 403);
      });
    }
    if (next.quotePrice !== null && !this.quoteIsValid(service, next.quotePrice)) {
      throw new OpsError("报价需要在 " + formatMoney(service.priceMin) + " 到 " + formatMoney(service.priceMax) + " 之间");
    }
    if ((next.acceptOrders || next.showPrice) && !this.quoteIsValid(service, next.quotePrice)) {
      throw new OpsError("开启接单或展示价格前，请先填写范围内的报价");
    }
    if (!service.enabled && next.acceptOrders && !(existing && existing.acceptOrders)) {
      throw new OpsError("该服务已关闭，不能开启新的接单");
    }
    const ts = now();
    this.db.prepare(`INSERT INTO offerings
      (companion_id, service_id, quote_price, intro, show_on_card, show_price, show_intro, show_badge, accept_orders, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(companion_id, service_id) DO UPDATE SET
        quote_price = excluded.quote_price,
        intro = excluded.intro,
        show_on_card = excluded.show_on_card,
        show_price = excluded.show_price,
        show_intro = excluded.show_intro,
        show_badge = excluded.show_badge,
        accept_orders = excluded.accept_orders,
        updated_at = excluded.updated_at`)
      .run(companion.id, service.id, next.quotePrice, next.intro, flag(next.showOnCard), flag(next.showPrice), flag(next.showIntro), flag(next.showBadge), flag(next.acceptOrders), ts);
    return this.getOffering(companion.id, service.id);
  }

  listOrders() {
    if (typeof this.expireOrders === "function") this.expireOrders();
    return this.db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all().map((row) => this.mapOrder(row));
  }

  createOrder(input) {
    const bossName = String(input.bossName || "").trim();
    const bossId = String(input.bossId || "").trim() || uid("boss");
    if (!bossName) throw new OpsError("请填写老板昵称");
    const service = this.getService(input.serviceId);
    if (!service || !service.enabled) throw new OpsError("该服务已关闭或不存在，不能创建新订单");
    const companion = this.getCompanion(input.companionId);
    if (!companion || companion.status !== "active") throw new OpsError("陪玩当前不可接单");
    const offering = this.getOffering(companion.id, service.id);
    if (!offering || !offering.acceptOrders) throw new OpsError("这位陪玩没有开启该服务的接单");
    if (!this.quoteIsValid(service, offering.quotePrice)) throw new OpsError("陪玩报价不在当前允许范围内，暂时不能下单");
    const quantity = moneyNumber(input.quantity, "数量");
    if (!quantity || quantity <= 0) throw new OpsError("请填写大于 0 的数量");
    const fields = this.listFields(service.id).filter((field) => field.showBoss);
    const answers = input.answers || {};
    const requirements = fields.map((field) => {
      const value = this.normalizeAnswer(field, answers[field.id]);
      if (field.required && !hasAnswer(value)) throw new OpsError("请填写必填项：「" + field.label + "」");
      return {
        fieldId: field.id,
        label: field.label,
        type: field.type,
        value: value,
        showBoss: field.showBoss,
        showCompanion: field.showCompanion,
        showOrderDetail: field.showOrderDetail
      };
    }).filter((item) => hasAnswer(item.value) || item.showOrderDetail);
    const slotStart = String(input.slotStart || "").trim();
    const slotEnd = String(input.slotEnd || "").trim();
    if ((slotStart && !slotEnd) || (!slotStart && slotEnd)) throw new OpsError("预约开始和结束时间需要一起填写");
    if (slotStart && slotEnd && slotStart >= slotEnd) throw new OpsError("预约结束时间必须晚于开始时间");
    const idempotencyKey = String(input.idempotencyKey || "").trim();
    if (idempotencyKey) {
      const existing = this.db.prepare("SELECT * FROM orders WHERE idempotency_key = ?").get(idempotencyKey);
      if (existing) return this.mapOrder(existing);
    }
    if (slotStart) this.assertSlotFree(companion.id, slotStart, slotEnd, "");
    const unitPrice = offering.quotePrice;
    const totalPrice = Math.round(unitPrice * quantity * 100) / 100;
    const snapshot = {
      serviceId: service.id,
      name: service.name,
      description: service.description,
      priceMin: service.priceMin,
      priceMax: service.priceMax,
      unit: service.unit,
      quotePrice: unitPrice,
      voiceMode: service.voiceMode || ""
    };
    const id = uid("ord");
    const ts = now();
    const acceptDeadline = new Date(Date.now() + this.getSettings().acceptTimeoutMinutes * 60000).toISOString();
    this.db.prepare(`INSERT INTO orders
      (id, boss_id, boss_name, companion_id, service_id, quantity, unit_price, total_price, unit, service_snapshot_json, requirements_json, status, created_at, updated_at, slot_start, slot_end, accept_deadline, idempotency_key, log_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_accept', ?, ?, ?, ?, ?, ?, ?)`).run(
      id, bossId, bossName, companion.id, service.id, quantity, unitPrice, totalPrice, service.unit,
      JSON.stringify(snapshot), JSON.stringify(requirements), ts, ts, slotStart, slotEnd, acceptDeadline,
      idempotencyKey || null, JSON.stringify([{ action: "reserve", at: ts, actor: "boss" }])
    );
    return this.mapOrder(this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id));
  }

  normalizeAnswer(field, raw) {
    if (field.type === "checkbox") {
      const list = Array.isArray(raw) ? raw : String(raw || "").split(",").map((item) => item.trim()).filter(Boolean);
      const unknown = list.filter((item) => field.options.indexOf(item) < 0);
      if (unknown.length) throw new OpsError("「" + field.label + "」包含无效选项");
      return list;
    }
    if (field.type === "number") {
      if (raw === null || raw === undefined || raw === "") return "";
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new OpsError("「" + field.label + "」需要填写数字");
      return n;
    }
    const text = String(raw || "").trim();
    if ((field.type === "radio" || field.type === "select") && text && field.options.indexOf(text) < 0) {
      throw new OpsError("「" + field.label + "」包含无效选项");
    }
    return text;
  }

  listApplications() {
    return this.db.prepare("SELECT * FROM cert_applications ORDER BY created_at DESC").all().map((row) => this.mapApplication(row));
  }

  getApplication(id) {
    const row = this.db.prepare("SELECT * FROM cert_applications WHERE id = ?").get(id);
    return row ? this.mapApplication(row) : null;
  }

  createApplication(input) {
    const companion = this.getCompanion(input.companionId);
    if (!companion) throw new OpsError("陪玩不存在", 404);
    const game = String(input.game || "").trim();
    const certItem = String(input.certItem || "").trim();
    const techLevel = String(input.techLevel || "").trim();
    const examNote = String(input.examNote || "").trim();
    const description = String(input.description || "").trim();
    const proof = String(input.proof || "").trim();
    if (!game) throw new OpsError("请填写申请游戏");
    if (!certItem) throw new OpsError("请填写申请认证项目");
    if (!techLevel) throw new OpsError("请填写技术等级");
    if (!examNote) throw new OpsError("考核内容备注为必填");
    if (proof.length > 500000) throw new OpsError("证明资料过大，请换成较短的说明或链接");
    const id = uid("cert");
    const ts = now();
    this.db.prepare(`INSERT INTO cert_applications
      (id, companion_id, game, cert_item, tech_level, exam_note, description, proof, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(id, companion.id, game, certItem, techLevel, examNote, description, proof, ts, ts);
    this.addReview(id, "submit", "陪玩提交技术认证申请", companion.name);
    return this.getApplication(id);
  }

  addReview(applicationId, action, reason, actor) {
    this.db.prepare(`INSERT INTO cert_reviews (id, application_id, action, reason, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(uid("rev"), applicationId, action, reason || "", actor || "admin", now());
  }

  listReviews(applicationId) {
    const sql = applicationId
      ? "SELECT * FROM cert_reviews WHERE application_id = ? ORDER BY created_at ASC"
      : "SELECT * FROM cert_reviews ORDER BY created_at ASC";
    const rows = applicationId ? this.db.prepare(sql).all(applicationId) : this.db.prepare(sql).all();
    return rows.map((row) => this.mapReview(row));
  }

  reviewApplication(id, input) {
    const app = this.getApplication(id);
    if (!app) throw new OpsError("申请不存在", 404);
    const action = String(input.action || "");
    const reason = String(input.reason || "").trim();
    if (REVIEW_ACTIONS.indexOf(action) < 0) throw new OpsError("不支持的审核动作");
    if ((action === "reject" || action === "need_more" || action === "exam_fail" || action === "revoke_badge") && !reason) {
      throw new OpsError("请填写原因");
    }
    const ts = now();
    if (action === "approve") {
      if (["pending", "need_more"].indexOf(app.status) < 0) throw new OpsError("当前状态不能审核通过");
      this.db.prepare("UPDATE cert_applications SET status = 'approved', updated_at = ? WHERE id = ?").run(ts, id);
    } else if (action === "reject") {
      if (["pending", "need_more"].indexOf(app.status) < 0) throw new OpsError("当前状态不能拒绝");
      this.db.prepare("UPDATE cert_applications SET status = 'rejected', updated_at = ? WHERE id = ?").run(ts, id);
    } else if (action === "need_more") {
      if (app.status !== "pending" && app.status !== "need_more") throw new OpsError("当前状态不能要求补充资料");
      this.db.prepare("UPDATE cert_applications SET status = 'need_more', updated_at = ? WHERE id = ?").run(ts, id);
    } else if (action === "exam_pass") {
      if (app.status !== "approved") throw new OpsError("只有已通过申请审核的陪玩才能确认考核通过");
      this.db.prepare("UPDATE cert_applications SET status = 'exam_passed', updated_at = ? WHERE id = ?").run(ts, id);
      const existing = this.db.prepare("SELECT id FROM badges WHERE application_id = ? AND active = 1").get(id);
      if (!existing) {
        this.db.prepare(`INSERT INTO badges
          (id, companion_id, application_id, game, cert_item, tech_level, active, issued_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL)`).run(uid("bdg"), app.companionId, id, app.game, app.certItem, app.techLevel, ts);
      }
    } else if (action === "exam_fail") {
      if (app.status !== "approved") throw new OpsError("只有已通过申请审核的陪玩才能确认考核不通过");
      this.db.prepare("UPDATE cert_applications SET status = 'exam_failed', updated_at = ? WHERE id = ?").run(ts, id);
    } else if (action === "revoke_badge") {
      const badge = this.db.prepare("SELECT * FROM badges WHERE application_id = ? AND active = 1").get(id);
      if (!badge) throw new OpsError("没有可撤销的认证徽章");
      this.db.prepare("UPDATE badges SET active = 0, revoked_at = ? WHERE id = ?").run(ts, badge.id);
    }
    this.addReview(id, action, reason, "admin");
    return {
      application: this.getApplication(id),
      reviews: this.listReviews(id),
      badges: this.listBadges()
    };
  }

  listBadges(companionId) {
    const sql = companionId ? "SELECT * FROM badges WHERE companion_id = ? ORDER BY issued_at DESC" : "SELECT * FROM badges ORDER BY issued_at DESC";
    const rows = companionId ? this.db.prepare(sql).all(companionId) : this.db.prepare(sql).all();
    return rows.map((row) => this.mapBadge(row));
  }

  activeBadges(companionId) {
    return this.listBadges(companionId).filter((badge) => badge.active);
  }

  listExaminers() {
    return this.db.prepare("SELECT * FROM examiners ORDER BY game ASC, name ASC").all().map((row) => this.mapExaminer(row, true));
  }

  saveExaminer(input, id) {
    const name = String(input.name || "").trim();
    const game = String(input.game || "").trim();
    if (!name) throw new OpsError("请填写考官名称");
    if (!game) throw new OpsError("请填写对应游戏");
    const ts = now();
    const record = {
      name: name,
      wechat: String(input.wechat || "").trim(),
      whatsapp: String(input.whatsapp || "").trim(),
      qq: String(input.qq || "").trim(),
      telegram: String(input.telegram || "").trim(),
      game: game,
      examNote: String(input.examNote || "").trim(),
      enabled: input.enabled === undefined ? 1 : flag(input.enabled)
    };
    if (!id) {
      id = uid("exm");
      this.db.prepare(`INSERT INTO examiners
        (id, name, wechat, whatsapp, qq, telegram, game, exam_note, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, record.name, record.wechat, record.whatsapp, record.qq, record.telegram, record.game, record.examNote, record.enabled, ts);
    } else {
      const current = this.db.prepare("SELECT id FROM examiners WHERE id = ?").get(id);
      if (!current) throw new OpsError("考官不存在", 404);
      this.db.prepare(`UPDATE examiners SET name = ?, wechat = ?, whatsapp = ?, qq = ?, telegram = ?, game = ?, exam_note = ?, enabled = ?, updated_at = ? WHERE id = ?`)
        .run(record.name, record.wechat, record.whatsapp, record.qq, record.telegram, record.game, record.examNote, record.enabled, ts, id);
    }
    const row = this.db.prepare("SELECT * FROM examiners WHERE id = ?").get(id);
    return this.mapExaminer(row, true);
  }

  approvedGames(companionId) {
    return this.listApplications()
      .filter((item) => item.companionId === companionId && ["approved", "exam_passed", "exam_failed"].indexOf(item.status) >= 0)
      .map((item) => item.game);
  }

  visibleExaminers(companionId) {
    const games = this.approvedGames(companionId);
    if (!games.length) return [];
    return this.db.prepare("SELECT * FROM examiners WHERE enabled = 1 ORDER BY game ASC, name ASC").all()
      .filter((row) => games.indexOf(row.game) >= 0)
      .map((row) => this.mapExaminer(row, true));
  }

  orderForCompanion(order) {
    const copy = Object.assign({}, order, {
      requirements: (order.requirements || []).filter((item) => item.showCompanion !== false)
    });
    delete copy.discordId;
    return copy;
  }

  orderForBoss(order) {
    return Object.assign({}, order, {
      requirements: (order.requirements || []).filter((item) => item.showOrderDetail !== false || item.showBoss !== false)
    });
  }

  adminSnapshot() {
    const orders = this.listOrders();
    return {
      settings: this.getSettings(),
      services: this.listServices(),
      fields: this.listFields(),
      companions: this.listCompanions(),
      offerings: this.listOfferings(),
      orders: orders,
      channels: this.listChannels(),
      announcements: this.listAnnouncements(),
      deposits: this.listDeposits(),
      applications: this.listApplications(),
      reviews: this.listReviews(),
      examiners: this.listExaminers(),
      badges: this.listBadges(),
      stats: {
        services: this.listServices().filter((item) => item.enabled).length,
        companions: this.listCompanions().filter((item) => item.status === "active").length,
        pendingCerts: this.listApplications().filter((item) => item.status === "pending" || item.status === "need_more").length,
        orders: orders.length,
        activeBadges: this.listBadges().filter((item) => item.active).length
      }
    };
  }

  companionSnapshot(companionId) {
    const companion = this.getCompanion(companionId);
    if (!companion) throw new OpsError("陪玩不存在", 404);
    this.db.prepare("UPDATE companions SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), companionId);
    const settings = this.getSettings();
    if (typeof this.expireOrders === "function") this.expireOrders();
    const orders = this.db.prepare("SELECT * FROM orders WHERE companion_id = ? ORDER BY created_at DESC LIMIT 40").all(companionId).map((row) => this.orderForCompanion(this.mapOrder(row)));
    return {
      companion: companion,
      settings: {
        allowShowOnCard: settings.allowShowOnCard,
        allowShowPrice: settings.allowShowPrice,
        allowShowIntro: settings.allowShowIntro,
        allowShowBadge: settings.allowShowBadge,
        allowAcceptOrders: settings.allowAcceptOrders,
        units: settings.units
      },
      services: this.listServices(),
      fields: this.listFields(),
      offerings: this.listOfferings(companionId),
      orders: orders,
      applications: this.listApplications().filter((item) => item.companionId === companionId),
      reviews: this.listReviews().filter((review) => {
        const app = this.getApplication(review.applicationId);
        return app && app.companionId === companionId;
      }),
      examiners: this.visibleExaminers(companionId),
      badges: this.listBadges(companionId)
    };
  }

  bossCatalog() {
    const settings = this.getSettings();
    const services = this.listServices().filter((service) => service.enabled).map((service) => {
      return Object.assign({}, service, {
        fields: this.listFields(service.id).filter((field) => field.showBoss),
        companions: this.orderableCompanions(service)
      });
    });
    return { settings: { units: settings.units }, services: services };
  }

  orderableCompanions(service) {
    return this.listCompanions().filter((companion) => companion.status === "active").map((companion) => {
      const offering = this.getOffering(companion.id, service.id);
      if (!offering || !offering.acceptOrders || !this.quoteIsValid(service, offering.quotePrice)) return null;
      const badges = this.publicBadges(companion.id, offering);
      return {
        id: companion.id,
        name: companion.name,
        bio: companion.bio,
        avatar: companion.avatar,
        game: companion.game,
        quotePrice: offering.quotePrice,
        unit: service.unit,
        priceText: formatMoney(offering.quotePrice) + " / " + service.unit,
        intro: offering.intro || service.description,
        badges: badges
      };
    }).filter(Boolean);
  }

  publicBadges(companionId, offering) {
    const settings = this.getSettings();
    if (!settings.allowShowBadge || !offering || !offering.showBadge) return [];
    return this.activeBadges(companionId).map((badge) => ({
      id: badge.id,
      game: badge.game,
      certItem: badge.certItem,
      techLevel: badge.techLevel,
      label: badge.game + " · " + badge.certItem + " · " + badge.techLevel
    }));
  }

  publicCard(companionId) {
    const companion = this.getCompanion(companionId);
    if (!companion || companion.status !== "active") return null;
    const settings = this.getSettings();
    const services = this.listServices().map((service) => {
      const offering = this.getOffering(companion.id, service.id);
      if (!service.enabled || !offering || !settings.allowShowOnCard || !offering.showOnCard) return null;
      const quoteOk = this.quoteIsValid(service, offering.quotePrice);
      const showPrice = settings.allowShowPrice && offering.showPrice && quoteOk;
      const showIntro = settings.allowShowIntro && offering.showIntro;
      return {
        serviceId: service.id,
        name: service.name,
        unit: service.unit,
        quotePrice: showPrice ? offering.quotePrice : null,
        priceText: showPrice ? formatMoney(offering.quotePrice) + " / " + service.unit : "",
        intro: showIntro ? (offering.intro || service.description) : "",
        acceptOrders: !!(offering.acceptOrders && quoteOk),
        badges: this.publicBadges(companion.id, offering)
      };
    }).filter(Boolean);
    const profileBadges = [];
    services.forEach((service) => {
      service.badges.forEach((badge) => {
        if (!profileBadges.some((item) => item.id === badge.id)) profileBadges.push(badge);
      });
    });
    return {
      companion: {
        id: companion.id,
        name: companion.name,
        bio: companion.bio,
        avatar: companion.avatar,
        game: companion.game
      },
      services: services,
      badges: profileBadges
    };
  }

  publicCards() {
    return this.listCompanions().map((companion) => this.publicCard(companion.id)).filter((card) => card && card.services.length);
  }
}

function hasAnswer(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

installFlow(OpsStore, OpsError);

export function assertNoSecrets(payload, secrets) {
  const text = JSON.stringify(payload);
  (secrets || []).forEach((secret) => {
    if (secret && text.indexOf(secret) >= 0) {
      throw new Error("响应泄露了考官联系方式");
    }
  });
  SECRET_FIELDS.forEach((key) => {
    if (text.indexOf('"' + key + '"') >= 0 && text.indexOf(key) >= 0) {
      const blob = JSON.stringify(payload);
      if (/"wechat"|"whatsapp"|"qq"|"telegram"/.test(blob)) {
        throw new Error("响应包含考官联系方式字段");
      }
    }
  });
}
