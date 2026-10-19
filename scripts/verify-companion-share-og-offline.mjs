/**
 * Two companions must get different titles, URLs, and image queries.
 * A second inject must not leave the first companion's name in the HTML.
 */
import assert from "node:assert/strict";
import {
  applyCompanionShareHtml,
  buildCompanionShareMeta,
  companionShareDescription,
  companionShareTitle,
} from "../server/api/_companion-share-meta.js";

const html = `<!doctype html><html><head><title>陪玩资料 | MEOW CUI JIAO</title></head><body></body></html>`;

const a = buildCompanionShareMeta({
  origin: "https://www.meowcuijiao.com",
  publicId: "pw00021",
  nickname: "1717",
});
const b = buildCompanionShareMeta({
  origin: "https://www.meowcuijiao.com",
  publicId: "PW00029",
  nickname: "小花",
});

assert.equal(a.title, "1717｜陪玩资料 · MEOW CUI JIAO");
assert.equal(b.title, "小花｜陪玩资料 · MEOW CUI JIAO");
assert.equal(companionShareTitle("Fish"), "Fish｜陪玩资料 · MEOW CUI JIAO");
assert.match(companionShareDescription("小花"), /小花/);
assert.equal(a.url, "https://www.meowcuijiao.com/companion/PW00021");
assert.equal(b.url, "https://www.meowcuijiao.com/companion/PW00029");
assert.notEqual(a.url, b.url);
assert.match(a.image, /code=PW00021$/);
assert.match(b.image, /code=PW00029$/);
assert.doesNotMatch(a.image, /PW00029/);
assert.doesNotMatch(b.image, /PW00021/);

const pageA = applyCompanionShareHtml(html, a);
const pageB = applyCompanionShareHtml(pageA, b);
assert.match(pageB, /<title>小花｜陪玩资料 · MEOW CUI JIAO<\/title>/);
assert.match(pageB, /property="og:title" content="小花｜陪玩资料 · MEOW CUI JIAO"/);
assert.match(pageB, /property="og:description" content="查看小花的陪玩资料，声线、照片与服务。"/);
assert.match(pageB, /property="og:image" content="https:\/\/www\.meowcuijiao\.com\/api\/public\/companion-og-image\?code=PW00029"/);
assert.match(pageB, /property="og:url" content="https:\/\/www\.meowcuijiao\.com\/companion\/PW00029"/);
assert.doesNotMatch(pageB, /1717/);
assert.doesNotMatch(pageB, /PW00021/);
assert.equal((pageB.match(/mcj-companion-og:begin/g) || []).length, 1);

const quoted = buildCompanionShareMeta({
  origin: "https://www.meowcuijiao.com",
  publicId: "PW00001",
  nickname: `A"B<C`,
});
const quotedPage = applyCompanionShareHtml(html, quoted);
assert.match(quotedPage, /content="A&quot;B&lt;C｜陪玩资料 · MEOW CUI JIAO"/);
assert.doesNotMatch(quotedPage, /content="A"B/);

const missing = buildCompanionShareMeta({
  origin: "https://evil.example",
  publicId: "not-a-code",
  nickname: "",
});
assert.equal(missing.url, "https://www.meowcuijiao.com/profile.html");
assert.match(missing.image, /share-card-square-v2\.jpg$/);
assert.equal(missing.title, "陪玩｜陪玩资料 · MEOW CUI JIAO");

console.log("verify-companion-share-og-offline: ALL PASS");
