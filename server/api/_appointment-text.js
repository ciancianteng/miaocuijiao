/** Existing companion_appointments.requirements column stores both texts. No extra column. */

const REQUIREMENTS_MARK = "服务需求：";
const NOTE_MARK = "\n备注：";
const MAX_LEN = 500;

export function packAppointmentText(requirements, note) {
  const req = String(requirements || "").trim();
  const memo = String(note || "").trim();
  if (!memo) return req.slice(0, MAX_LEN);
  const budget = MAX_LEN - REQUIREMENTS_MARK.length - NOTE_MARK.length;
  const reqPart = req.slice(0, Math.min(req.length, 320));
  const notePart = memo.slice(0, Math.max(0, budget - reqPart.length));
  return `${REQUIREMENTS_MARK}${reqPart}${NOTE_MARK}${notePart}`.slice(0, MAX_LEN);
}

export function unpackAppointmentText(raw) {
  const text = String(raw || "");
  const match = text.match(/^服务需求：([\s\S]*?)\n备注：([\s\S]*)$/);
  if (!match) return { requirements: text, note: "" };
  return { requirements: match[1].trim(), note: match[2].trim() };
}
