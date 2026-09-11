/**
 * Production test / smoke / e2e order isolation.
 * Real companion grab hall, claim, earnings, ranking, and order stats MUST hide these.
 *
 * Detection is intentional and conservative: only synthetic markers, never generic Chinese.
 * Prefer explicit is_test / is_test_order flags when present; otherwise match known
 * lifecycle / e2e / smoke fingerprints left by historic prod scripts (e.g. PR180).
 */

const TEST_BLOB_RE =
  /\b(E2E(?:[-_ ]?[A-Z0-9]+)?|PR\s*180|PR180|lifecycle\s*verify|PROD[-_ ]?SMOKE|PROD[-_ ]?REFERRAL[-_ ]?SMOKE|MCJ_TEST|synthetic\s*order|internal\s*QA|qa[-_ ]order|fixture[-_ ]order|smoke[-_ ]test)\b/i;

const TEST_GAME_ID_RE = /^(E2E(?:[-_A-Z0-9]+)?|PR180VERIFY|PROD-SMOKE-\d+)$/i;

function collectOrderBlob(order = {}) {
  return [
    order.order_no,
    order.orderNo,
    order.title,
    order.game,
    order.game_id,
    order.gameId,
    order.description,
    order.note,
    order.remark,
    order.notes,
    order.service_content,
    order.serviceContent,
    order.service_name,
    order.idempotency_key,
    order.idempotencyKey,
  ]
    .map((v) => String(v || ""))
    .join("\n");
}

function extractGameId(order = {}) {
  const direct = String(order.game_id || order.gameId || "").trim();
  if (direct) return direct;
  const blob = collectOrderBlob(order);
  const m = blob.match(/游戏ID[：:]\s*([^\n\r]+)/i);
  return String(m?.[1] || "").trim();
}

export function isTestOrderRecord(order = {}) {
  if (!order || typeof order !== "object") return false;
  if (order.is_test === true || order.is_test_order === true || order.isTest === true || order.isTestOrder === true) {
    return true;
  }
  if (order.meta?.is_test === true || order.meta?.is_test_order === true) return true;

  const gameId = extractGameId(order);
  if (gameId && TEST_GAME_ID_RE.test(gameId)) return true;

  const blob = collectOrderBlob(order);
  if (TEST_BLOB_RE.test(blob)) return true;

  // Historic PR180 public hall leftover fingerprint.
  if (/lifecycle\s*verify/i.test(blob) && /E2E/i.test(blob)) return true;

  return false;
}

export function rejectTestOrderMessage() {
  return "该订单为内部测试单，不对真实陪玩开放。";
}

export function filterOutTestOrders(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !isTestOrderRecord(row));
}
