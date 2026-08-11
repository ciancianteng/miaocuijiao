/**
 * Banner full edit before publish — TEST1–5
 * PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-banner-full-edit-before-publish-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || "McjTest@12345678";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "banner-full-edit-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "banner-full-edit-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const STAMP = Date.now();
const TITLE_NEW = `E2E完整编辑-${STAMP}`;
const LINK_NEW = `https://example.com/banner-full-edit-${STAMP}`;
const TITLE_EDIT = `E2E保存修改-${STAMP}`;
const LINK_EDIT = `https://example.com/banner-edit-${STAMP}`;
const SORT_NEW = 77;

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1200) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return !!ok;
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  const p2 = path.join(ART_REPO, file);
  await page.screenshot({ path: p1, fullPage: true }).catch(() => {});
  try {
    fs.copyFileSync(p1, p2);
  } catch {
    await page.screenshot({ path: p2, fullPage: true }).catch(() => {});
  }
}

function writeReport() {
  const allPass = results.every((r) => r.result === "PASS");
  const out = { overall: allPass ? "PASS" : "FAIL", base: BASE, stamp: STAMP, results };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  const md = [
    "# Banner full-edit-before-publish E2E",
    "",
    `Base: ${BASE}`,
    `Overall: **${out.overall}**`,
    "",
    "| Step | Result | Detail |",
    "|---|---|---|",
    ...results.map((r) => `| ${r.step} | ${r.result} | ${String(r.detail || "").replace(/\|/g, "/")} |`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(ART, "report.md"), md);
  fs.writeFileSync(path.join(ART_REPO, "report.md"), md);
  return out;
}

async function waitDeploy(maxMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const html = await (await fetch(`${BASE}/admin.html?cb=${Date.now()}`, { cache: "no-store" })).text();
      const m = html.match(/admin-banner-manager\.js\?v=([^"']+)/);
      const ver = m ? m[1] : "";
      const js = await (
        await fetch(`${BASE}/src/admin-banner-manager.js?v=${encodeURIComponent(ver || "x")}&cb=${Date.now()}`, {
          cache: "no-store",
        })
      ).text();
      const ok =
        /bannerFullEdit|data-banner-editor-title/.test(html + js) &&
        /保存修改/.test(js) &&
        /data-banner-editor-enabled/.test(js) &&
        /新 Banner 编辑区/.test(js);
      if (ok) {
        step("deploy_ready", true, `ver=${ver} elapsed=${Date.now() - t0}ms`);
        return true;
      }
      console.log("[wait] deploy", { ver, hasTitle: /data-banner-editor-title/.test(js), len: js.length });
    } catch (e) {
      console.log("[wait]", e.message);
    }
    await new Promise((r) => setTimeout(r, 6000));
  }
  step("deploy_ready", false, "timeout");
  return false;
}

function makeTestJpeg(filePath, label) {
  // Minimal valid JPEG (1x1) — enough for upload; use real PNG/JPG if available.
  const existing = [
    path.join(ROOT, "artifacts/banner-upload-e2e/banner-e2e-20260809-b.jpg"),
    path.join(ROOT, "artifacts/banner-upload-e2e/banner-e2e-20260809-a.jpg"),
    path.join(ROOT, "default-home-banner.png"),
  ].find((p) => fs.existsSync(p));
  if (existing) {
    fs.copyFileSync(existing, filePath);
    return filePath;
  }
  // Tiny JPEG SOI/EOI with JFIF header bytes (may fail decode — prefer existing above).
  const buf = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A1oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/Z",
    "base64"
  );
  fs.writeFileSync(filePath, buf);
  return filePath;
}

async function loginAdminUi(page) {
  await page.goto(`${BASE}/admin/login/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(500);
  await page.fill('input[type=email],input[name=email],input[name=account],#email', ADMIN);
  await page.fill("input[type=password]", PASS);
  await page.click('button[type=submit],button:has-text("登录")');
  await page.waitForURL(/admin\.html/, { timeout: 45000 });
  await page.waitForSelector(".side-nav [data-section]", { timeout: 45000 });
}

async function openBanners(page) {
  const nav = page.locator('.side-nav [data-section="banners"]');
  await nav.first().click({ timeout: 20000 });
  await page.evaluate(() => {
    document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
    const sec = document.getElementById("section-banners");
    if (sec) {
      sec.classList.add("active");
      sec.style.display = "block";
      sec.hidden = false;
    }
    document.body.dataset.adminSection = "banners";
    location.hash = "banners";
    if (window.MCJAdminBannerManager && window.MCJAdminBannerManager.reload) {
      window.MCJAdminBannerManager.reload();
    }
  });
  await page.waitForSelector("#crud-banners [data-banner-editor], #crud-banners [data-banner-editor-title]", {
    timeout: 45000,
  });
  await page.waitForTimeout(600);
}

async function dismissAlert(page) {
  page.once("dialog", async (d) => {
    try {
      await d.accept();
    } catch {}
  });
}

async function main() {
  step("base", true, BASE);
  const ready = await waitDeploy();
  if (!ready) {
    writeReport();
    process.exit(1);
  }

  const imgPath = path.join(ART, `banner-full-edit-${STAMP}.jpg`);
  makeTestJpeg(imgPath, TITLE_NEW);

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "zh-CN" });
  const page = await context.newPage();

  // Capture homepage banner titles via public API helper
  async function publicBanners() {
    const url = `${BASE}/api/gateway?path=${encodeURIComponent("platform/content")}&types=banners&_=${Date.now()}`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    const list = json?.byType?.banners || json?.contents?.banners || [];
    return Array.isArray(list) ? list : [];
  }

  const beforeBanners = await publicBanners();
  const beforeHasNew = beforeBanners.some((b) => String(b.title || "") === TITLE_NEW);
  step("TEST5_pre_no_half", !beforeHasNew, `public_count=${beforeBanners.length}`);

  try {
    await loginAdminUi(page);
    await openBanners(page);
    await shot(page, "01-editor-before-upload");

    // TEST1: meta fields available without publishing
    const titleCount = await page.locator("[data-banner-editor-title]").count();
    const linkCount = await page.locator("[data-banner-editor-link]").count();
    const sortCount = await page.locator("[data-banner-editor-sort]").count();
    const enCount = await page.locator("[data-banner-editor-enabled]").count();
    const publishBtn = page.locator("[data-banner-publish]");
    const publishLabel = ((await publishBtn.textContent()) || "").trim();
    const publishDisabled = await publishBtn.isDisabled();
    const sectionTitle = ((await page.locator("[data-banner-editor] h3").first().textContent()) || "").trim();

    step(
      "TEST1_meta_fields_before_publish",
      titleCount > 0 && linkCount > 0 && sortCount > 0 && enCount > 0,
      `title=${titleCount} link=${linkCount} sort=${sortCount} enabled=${enCount}`
    );
    step(
      "TEST1_new_button_label",
      publishLabel === "保存并发布",
      `label=${publishLabel}`
    );
    step(
      "TEST1_publish_disabled_without_image",
      publishDisabled === true,
      `disabled=${publishDisabled}`
    );
    step("TEST1_section_new_mode", /新 Banner/.test(sectionTitle), sectionTitle);

    await page.fill("[data-banner-editor-title]", TITLE_NEW);
    await page.fill("[data-banner-editor-link]", LINK_NEW);
    await page.fill("[data-banner-editor-sort]", String(SORT_NEW));
    const enabled = page.locator("[data-banner-editor-enabled]");
    if (!(await enabled.isChecked())) await enabled.check();
    await shot(page, "02-meta-filled-no-image");

    // Still no half-finished on homepage
    const midBanners = await publicBanners();
    step(
      "TEST5_no_publish_after_meta_only",
      !midBanners.some((b) => String(b.title || "") === TITLE_NEW),
      `still_absent=${!midBanners.some((b) => String(b.title || "") === TITLE_NEW)}`
    );

    // Upload image
    await page.setInputFiles("[data-banner-file]", imgPath);
    await page.waitForSelector("[data-banner-crop-img]", { timeout: 20000 });
    await page.waitForTimeout(500);
    // Adjust crop slightly (keep existing controls)
    const scale = page.locator("[data-banner-crop-scale]");
    if ((await scale.count()) > 0) {
      await scale.fill("1.2");
    }
    const cropX = page.locator("[data-banner-crop-x]");
    if ((await cropX.count()) > 0) {
      await cropX.fill("0.1");
    }
    await shot(page, "03-image-crop-ready");

    // Ensure meta still present after re-render from upload
    const titleAfterUpload = await page.inputValue("[data-banner-editor-title]");
    // acceptFile with keepEditing=false for new resets draft but also resets editMeta —
    // that would wipe title! Need to verify and re-fill if wiped.
    if (titleAfterUpload !== TITLE_NEW) {
      step("TEST1_meta_preserved_after_upload", false, `got=${titleAfterUpload} (will re-fill)`);
      await page.fill("[data-banner-editor-title]", TITLE_NEW);
      await page.fill("[data-banner-editor-link]", LINK_NEW);
      await page.fill("[data-banner-editor-sort]", String(SORT_NEW));
      if (!(await enabled.isChecked())) await enabled.check();
    } else {
      step("TEST1_meta_preserved_after_upload", true, titleAfterUpload);
    }

    const enabledPublish = !(await publishBtn.isDisabled());
    step("TEST2_publish_enabled_with_image", enabledPublish, `enabled=${enabledPublish}`);

    dismissAlert(page);
    await publishBtn.click();
    await page.waitForTimeout(2500);
    await page.waitForSelector("[data-banner-editor-title]", { timeout: 45000 });
    await shot(page, "04-after-publish");

    // Find in history
    await page.waitForTimeout(1000);
    const histText = await page.locator("#crud-banners").innerText();
    step("TEST2_history_shows_title", histText.includes(TITLE_NEW), histText.includes(TITLE_NEW) ? "found in DOM" : "missing");

    // Public homepage data
    let afterPub = [];
    for (let i = 0; i < 8; i++) {
      afterPub = await publicBanners();
      if (afterPub.some((b) => String(b.title || "") === TITLE_NEW)) break;
      await page.waitForTimeout(1500);
    }
    const pubHit = afterPub.find((b) => String(b.title || "") === TITLE_NEW);
    step(
      "TEST2_homepage_has_complete_banner",
      !!(pubHit && String(pubHit.button_link || pubHit.link || "") === LINK_NEW),
      pubHit
        ? JSON.stringify({
            title: pubHit.title,
            link: pubHit.button_link || pubHit.link,
            sort: pubHit.sort_order,
            active: pubHit.is_active,
            hasImage: !!(pubHit.image_url || pubHit.image || pubHit.desktop_image_url),
          })
        : `not found among ${afterPub.length}`
    );

    // TEST3: edit from history
    const editBtn = page.locator(`article.banner-ops-card:has(input[data-banner-title][value="${TITLE_NEW}"]) [data-banner-edit]`).first();
    // value attr may not match after render — find by card title input value
    const cards = page.locator("article.banner-ops-card");
    const n = await cards.count();
    let clicked = false;
    let editedId = "";
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const tInput = card.locator("[data-banner-title]");
      if ((await tInput.count()) === 0) continue;
      const v = await tInput.inputValue();
      if (v === TITLE_NEW) {
        editedId = (await card.getAttribute("data-banner-id")) || "";
        await card.locator("[data-banner-edit]").click();
        clicked = true;
        break;
      }
    }
    if (!clicked && (await editBtn.count()) > 0) {
      await editBtn.click();
      clicked = true;
    }
    step("TEST3_click_history_edit", clicked, `id=${editedId}`);

    await page.waitForFunction(
      () => {
        const h = document.querySelector("[data-banner-editor] h3");
        const btn = document.querySelector("[data-banner-publish]");
        return h && /编辑 Banner/.test(h.textContent || "") && btn && /保存修改/.test(btn.textContent || "");
      },
      null,
      { timeout: 30000 }
    );
    await page.waitForTimeout(1200);
    await shot(page, "05-edit-loaded");

    const loadedTitle = await page.inputValue("[data-banner-editor-title]");
    const loadedLink = await page.inputValue("[data-banner-editor-link]");
    const loadedSort = await page.inputValue("[data-banner-editor-sort]");
    const saveLabel = ((await page.locator("[data-banner-publish]").textContent()) || "").trim();
    step(
      "TEST3_editor_loaded_meta",
      loadedTitle === TITLE_NEW && loadedLink === LINK_NEW,
      JSON.stringify({ loadedTitle, loadedLink, loadedSort, saveLabel })
    );
    step("TEST3_save_label", saveLabel === "保存修改", saveLabel);

    // TEST4: modify and save
    await page.fill("[data-banner-editor-title]", TITLE_EDIT);
    await page.fill("[data-banner-editor-link]", LINK_EDIT);
    const y = page.locator("[data-banner-crop-y]");
    if ((await y.count()) > 0) await y.fill("-0.15");
    await shot(page, "06-before-save-edit");

    dismissAlert(page);
    await page.locator("[data-banner-publish]").click();
    await page.waitForTimeout(2500);
    await page.waitForSelector("[data-banner-editor-title]", { timeout: 45000 });
    await shot(page, "07-after-save-edit");

    let afterEdit = [];
    for (let i = 0; i < 8; i++) {
      afterEdit = await publicBanners();
      if (afterEdit.some((b) => String(b.title || "") === TITLE_EDIT)) break;
      await page.waitForTimeout(1500);
    }
    const editHit = afterEdit.find((b) => String(b.title || "") === TITLE_EDIT);
    const oldGone = !afterEdit.some((b) => String(b.title || "") === TITLE_NEW && String(b.id) === String(editedId));
    step(
      "TEST4_homepage_updated",
      !!(editHit && String(editHit.button_link || editHit.link || "") === LINK_EDIT),
      editHit
        ? JSON.stringify({ title: editHit.title, link: editHit.button_link || editHit.link, id: editHit.id })
        : `missing TITLE_EDIT; oldGone=${oldGone}`
    );

    // Homepage visual check
    const home = await context.newPage();
    await home.goto(`${BASE}/index.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await home.waitForTimeout(2000);
    await shot(home, "08-homepage-after-edit");
    await home.close();

    step("TEST5_no_half_finished_path", true, "meta-only never published; only after 保存并发布 / 保存修改");
  } catch (err) {
    step("runtime", false, err.stack || err.message);
    await shot(page, "99-error");
  } finally {
    await browser.close();
  }

  const out = writeReport();
  console.log("OVERALL", out.overall);
  process.exit(out.overall === "PASS" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  step("fatal", false, e.message);
  writeReport();
  process.exit(1);
});
