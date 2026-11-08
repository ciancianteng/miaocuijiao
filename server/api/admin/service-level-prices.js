import { requireAdmin as requireAdminJwt } from "../_admin-auth.js";
import { readLocalServices } from "../_services-store.js";
import { readLocalLevels } from "../_companion-levels-store.js";
import {
  LOCKED_MATRIX_LEVEL_IDS,
  readServiceLevelPrices,
  writeServiceLevelPrices,
  clearServiceMatrix,
  validateMatrixRow,
  resolveServiceLevelBand,
} from "../_service-level-prices.js";

const ADMIN_ROLES = new Set(["admin", "super_admin"]);

function json(res, status, data) {
  res.status(status).json(data);
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

async function requireAdmin(req, res) {
  try {
    await requireAdminJwt(req, { allowRoles: ADMIN_ROLES });
    return true;
  } catch (err) {
    json(res, err.status || 401, { ok: false, message: err.message || "请先登录管理员账号。" });
    return false;
  }
}

function matrixGrid(services, levels, rows) {
  const byKey = new Map(rows.map((r) => [`${r.serviceId}::${r.levelId}`, r]));
  return (services || []).map((svc) => {
    const serviceId = String(svc.id || "");
    const serviceName = String(svc.name || svc.title || serviceId);
    const levelsOut = (levels || [])
      .filter((lv) => LOCKED_MATRIX_LEVEL_IDS.includes(String(lv.id).toLowerCase()))
      .map((lv) => {
        const levelId = String(lv.id).toLowerCase();
        const hit = byKey.get(`${serviceId}::${levelId}`);
        if (hit) return { ...hit, serviceName, configured: true };
        return {
          serviceId,
          serviceName,
          levelId,
          basePrice: Number(lv.basePrice) || 0,
          minPrice: Number(lv.min) || 0,
          maxPrice: Number(lv.max) || 0,
          markupAllowance: Number(lv.markupAllowance) || 0,
          maxPlus: !!lv.maxPlus,
          sellMax: Math.min(Number(lv.max) || 0, (Number(lv.basePrice) || 0) + (Number(lv.markupAllowance) || 0)),
          configured: false,
          source: "companion_levels_fallback",
        };
      });
    return { serviceId, serviceName, levels: levelsOut };
  });
}

export default async function handler(req, res) {
  try {
    if (!(await requireAdmin(req, res))) return;

    if (req.method === "GET") {
      const [services, levels, rows] = await Promise.all([
        readLocalServices(),
        readLocalLevels(),
        readServiceLevelPrices(),
      ]);
      const enabledServices = (services || []).filter((s) => s && s.enabled !== false);
      return json(res, 200, {
        ok: true,
        lockedLevelIds: LOCKED_MATRIX_LEVEL_IDS,
        rows,
        grid: matrixGrid(enabledServices, levels, rows),
        services: enabledServices.map((s) => ({ id: s.id, name: s.name || s.title || s.id })),
        levels: (levels || [])
          .filter((lv) => LOCKED_MATRIX_LEVEL_IDS.includes(String(lv.id).toLowerCase()))
          .map((lv) => ({
            id: lv.id,
            code: lv.code,
            name: lv.name,
            basePrice: lv.basePrice,
            min: lv.min,
            max: lv.max,
            markupAllowance: lv.markupAllowance,
          })),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "save").trim();

    if (action === "resolve") {
      const band = await resolveServiceLevelBand({
        serviceId: body.serviceId || body.service_id,
        levelId: body.levelId || body.level_id,
      });
      return json(res, 200, { ok: true, band });
    }

    if (action === "clear_service" || action === "clear") {
      const confirmToken = String(body.confirm || "").trim();
      if (confirmToken !== "CLEAR_SERVICE_MATRIX") {
        return json(res, 400, {
          ok: false,
          message: "清零需二次确认：confirm=CLEAR_SERVICE_MATRIX。仅清除该服务的矩阵行，不删 LV1–LV5、不改订单财务。",
        });
      }
      const result = await clearServiceMatrix(body.serviceId || body.service_id || body.id);
      return json(res, 200, {
        ok: true,
        message: "已清零该服务的等级价格矩阵（等级结构保留）。",
        ...result,
      });
    }

    if (action === "save" || action === "save_rows" || action === "save_service") {
      const rowsIn = Array.isArray(body.rows) ? body.rows : Array.isArray(body.levels) ? body.levels : [];
      if (!rowsIn.length && body.row) rowsIn.push(body.row);
      if (!rowsIn.length) return json(res, 400, { ok: false, message: "请提交矩阵行。" });
      const normalized = [];
      for (const raw of rowsIn) {
        const checked = validateMatrixRow(raw);
        if (!checked.ok) {
          return json(res, 400, { ok: false, message: checked.message, errors: checked.errors });
        }
        normalized.push(checked.row);
      }
      const serviceIds = [...new Set(normalized.map((r) => r.serviceId))];
      const saved = await writeServiceLevelPrices(normalized, {
        replaceServiceIds: action === "save_service" ? serviceIds : null,
      });
      return json(res, 200, {
        ok: true,
        message: "服务等级价格矩阵已保存。仅对新报价/新订单生效。",
        ...saved,
      });
    }

    return json(res, 400, { ok: false, message: "未知操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "服务等级价格接口异常" });
  }
}
