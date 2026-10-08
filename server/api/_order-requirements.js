/**
 * Per-service order requirement fields.
 * Config lives in platform_settings.data.serviceOrderFields so it works before
 * services.order_fields exists. Answers are copied into orders.service_snapshot
 * once and never rewritten.
 */
import { companionDb } from "./_companion-media-store.js";

const KINDS = new Set(["text", "number", "select", "multiselect", "textarea"]);

export function normalizeOrderFields(input) {
  const list = Array.isArray(input) ? input : [];
  const used = new Set();
  const fields = list
    .map((raw, index) => {
      const kind = KINDS.has(String(raw?.kind || raw?.type || "")) ? String(raw.kind || raw.type) : "text";
      let id = String(raw?.id || `f${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
      if (!id) id = `f${index + 1}`;
      while (used.has(id)) id = `${id.slice(0, 36)}_${used.size}`;
      used.add(id);
      const options =
        kind === "select" || kind === "multiselect"
          ? (Array.isArray(raw?.options) ? raw.options : String(raw?.options || "").split(/[,，\n]/))
              .map((item) => String(item || "").trim())
              .filter(Boolean)
              .slice(0, 40)
          : [];
      return {
        id,
        name: String(raw?.name || raw?.label || "").trim().slice(0, 40),
        kind,
        required: raw?.required !== false && raw?.required !== "false" && raw?.required !== 0,
        placeholder: String(raw?.placeholder || "").trim().slice(0, 80),
        options,
        sort: Number.isFinite(Number(raw?.sort)) ? Number(raw.sort) : index,
        enabled: raw?.enabled !== false && raw?.enabled !== "false" && raw?.enabled !== 0,
      };
    })
    .filter((field) => field.name)
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 30);
  return fields.map((field, index) => ({ ...field, sort: index }));
}

async function readSettingsData() {
  const rows = await companionDb("platform_settings", "?id=eq.global&select=data&limit=1").catch(() => []);
  const data = rows?.[0]?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

export async function loadAllOrderFieldConfigs() {
  const data = await readSettingsData();
  const map = data.serviceOrderFields;
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

export async function loadOrderFieldsForService(serviceId) {
  const id = String(serviceId || "").trim();
  if (!id) return [];
  const map = await loadAllOrderFieldConfigs();
  return normalizeOrderFields(map[id] || []).filter((field) => field.enabled);
}

export async function saveOrderFieldsForService(serviceId, fields) {
  const id = String(serviceId || "").trim();
  if (!id) throw Object.assign(new Error("缺少服务 ID"), { status: 400 });
  const prev = await readSettingsData();
  const nextFields = normalizeOrderFields(fields);
  const next = {
    ...prev,
    serviceOrderFields: { ...(prev.serviceOrderFields || {}), [id]: nextFields },
  };
  await companionDb("platform_settings", "?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: "global", data: next, updated_at: new Date().toISOString() }),
  });
  return nextFields;
}

export function captureRequirementAnswers(fields, answers) {
  const list = normalizeOrderFields(fields).filter((field) => field.enabled);
  const given = new Map(
    (Array.isArray(answers) ? answers : []).map((item) => [String(item?.fieldId || item?.id || ""), item?.value])
  );
  const filled = [];
  for (const field of list) {
    let value = given.get(field.id);
    if (field.kind === "multiselect") {
      value = Array.isArray(value)
        ? value.map((item) => String(item || "").trim())
        : String(value || "")
            .split(/[,，]/)
            .map((item) => item.trim())
            .filter(Boolean);
      if (field.options.length) value = value.filter((item) => field.options.includes(item));
      value = value.slice(0, 20);
    } else {
      value = String(value ?? "").trim().slice(0, field.kind === "textarea" ? 500 : 80);
      if (field.kind === "number") value = value.replace(/[^\d.]/g, "").slice(0, 20);
      if (field.kind === "select" && value && field.options.length && !field.options.includes(value)) {
        throw Object.assign(new Error(`「${field.name}」请选择有效选项`), { status: 400 });
      }
    }
    const empty = field.kind === "multiselect" ? value.length === 0 : !value;
    if (field.required && empty) {
      throw Object.assign(new Error(`请填写${field.name}`), { status: 400 });
    }
    filled.push({ id: field.id, name: field.name, kind: field.kind, value });
  }
  return { fields: filled, capturedAt: new Date().toISOString() };
}
