#!/usr/bin/env node
/**
 * Offline check: official Instagram menu card (@meowcuijiao only).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync("src/boss-header.js", "utf8");
const css = readFileSync("src/boss-header.css", "utf8");

assert.match(js, /instagram\.com\/meowcuijiao/);
assert.match(js, /@meowcuijiao/);
assert.match(js, /官方 Instagram/);
assert.match(js, /instagramEntryCardHtml/);
assert.match(js, /target="_blank"/);
assert.match(js, /rel="noopener noreferrer"/);
assert.match(js, /mobileDrawerLinksHtml[\s\S]*instagramEntryCardHtml[\s\S]*companionEntryCardHtml/);
assert.doesNotMatch(js, /lianmiaoclub/i);

assert.match(css, /mcj-mnav-instagram-card/);
assert.match(css, /mcj-mnav-ig-logo/);

console.log("PASS official Instagram menu card (@meowcuijiao)");
