/**
 * Read one public companion card for share metadata.
 * The returned card is accepted only when its public code matches the request.
 */

import companionsHandler from "./public/companions.js";
import { normalizeShareCode } from "./_companion-share-meta.js";

function invokePublicCompanion(code) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(n) {
        this.statusCode = n;
        return this;
      },
      json(data) {
        finish(data);
      },
      end() {
        finish(null);
      },
    };
    const req = {
      method: "GET",
      query: { id: code },
      url: `/api/public/companions?id=${encodeURIComponent(code)}`,
      headers: {},
    };
    Promise.resolve(companionsHandler(req, res))
      .then(() => {
        if (!done) finish(null);
      })
      .catch(reject);
  });
}

export async function lookupPublicCompanion(rawCode) {
  const code = normalizeShareCode(rawCode);
  if (!code) return null;
  const data = await invokePublicCompanion(code);
  const list = Array.isArray(data?.companions) ? data.companions : [];
  const card = list[0];
  if (!card) return null;
  const got = normalizeShareCode(card.publicId || card.companionCode || card.companion_code);
  if (got && got !== code) return null;
  const name = String(card.nickname || card.name || "").trim();
  return {
    publicId: got || code,
    name,
    avatar: String(card.avatar || "").trim(),
  };
}
