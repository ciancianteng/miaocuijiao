#!/usr/bin/env node
/**
 * Offline regression: companion review — showcase video optional + gallery bulk approve scope.
 */
import assert from "node:assert/strict";
import {
  isGalleryPhotoRow,
  isPendingMediaStatus,
  selectPendingGalleryPhotoIds,
  showcaseVideoCompleteness,
  videoReviewRequired,
} from "../server/api/_companion-media-review.js";
import { assertApproveCanPublish } from "../server/api/_companion-publish-gate.js";

const companionA = "comp-a";
const companionB = "comp-b";

// CASE 1 / 2 / 3: no video → optional completeness, not required, approve gate ignores video
{
  const chip = showcaseVideoCompleteness(false);
  assert.equal(chip.required, false);
  assert.equal(chip.optional, true);
  assert.equal(chip.className, "is-optional");
  assert.match(chip.display, /选填/);
  assert.equal(videoReviewRequired([]), false);
  assert.equal(videoReviewRequired([{ id: "v1", url: "https://x/v.mp4" }]), true);

  // Publish gate: no video in criticalMissing
  const row = {
    nickname: "凝梦",
    main_game: "无畏契约",
    game: "无畏契约",
    price: 30,
    application_status: "pending",
    verification_status: "pending",
  };
  const profile = { id: "u1", role: "companion", status: "pending", display_name: "凝梦" };
  // assertApproveCanPublish needs projected approved+active+price+level injection via payload
  const payload = {
    levelId: "lv1",
    level_id: "lv1",
    levelName: "Lv1",
    price: 30,
    application_status: "approved",
    verification_status: "approved",
  };
  // Should NOT throw for missing video (critical = nickname/game/price only).
  try {
    assertApproveCanPublish(
      { ...row, level_id: "lv1", level_name: "Lv1", price: 30 },
      payload,
      { ...profile, status: "active" }
    );
  } catch (err) {
    const reasons = [...(err.blockReasons || []), ...(err.criticalMissing || []), String(err.message || "")].join(
      " "
    );
    assert.equal(/视频|video/i.test(reasons), false, "video must never block approve: " + reasons);
  }
}

// CASE 4 / 5: bulk select pending only
{
  const rows = [
    { id: "p1", companion_profile_id: companionA, media_type: "gallery", status: "pending" },
    { id: "p2", companion_profile_id: companionA, media_type: "gallery", status: "pending" },
    { id: "p3", companion_profile_id: companionA, media_type: "gallery", status: "pending" },
    { id: "p4", companion_profile_id: companionA, media_type: "gallery", status: "pending" },
    { id: "p5", companion_profile_id: companionA, media_type: "gallery", status: "pending" },
    { id: "a1", companion_profile_id: companionA, media_type: "gallery", status: "approved" },
    { id: "a2", companion_profile_id: companionA, media_type: "gallery", status: "approved" },
    { id: "a3", companion_profile_id: companionA, media_type: "gallery", status: "approved" },
    { id: "r1", companion_profile_id: companionA, media_type: "gallery", status: "rejected" },
    { id: "v1", companion_profile_id: companionA, media_type: "video", status: "pending" },
    { id: "voice1", companion_profile_id: companionA, media_type: "voice", status: "pending" },
  ];
  const five = selectPendingGalleryPhotoIds(rows.slice(0, 5), companionA);
  assert.equal(five.ids.length, 5, "CASE4: 5 pending photos");
  const mixed = selectPendingGalleryPhotoIds(rows, companionA);
  assert.deepEqual(mixed.ids.sort(), ["p1", "p2", "p3", "p4", "p5"]);
  assert.equal(mixed.ids.includes("a1"), false, "CASE5: approved not selected");
  assert.equal(mixed.ids.includes("v1"), false, "video not selected as photo");
}

// CASE 6: companion B never selected when filtering A
{
  const rows = [
    { id: "a-p", companion_profile_id: companionA, media_type: "gallery", status: "pending" },
    { id: "b-p1", companion_profile_id: companionB, media_type: "gallery", status: "pending" },
    { id: "b-p2", companion_profile_id: companionB, media_type: "gallery", status: "pending" },
  ];
  const onlyA = selectPendingGalleryPhotoIds(rows, companionA);
  assert.deepEqual(onlyA.ids, ["a-p"]);
  assert.equal(onlyA.skipped, 2);
  const onlyB = selectPendingGalleryPhotoIds(rows, companionB);
  assert.deepEqual(onlyB.ids.sort(), ["b-p1", "b-p2"]);
}

// CASE 7: video rows remain reviewable (still pending / not gallery)
{
  assert.equal(isGalleryPhotoRow({ media_type: "video", status: "pending" }), false);
  assert.equal(isPendingMediaStatus("pending"), true);
  assert.equal(isPendingMediaStatus("approved"), false);
  assert.equal(videoReviewRequired([{ id: "vid" }]), true);
}

// CASE 8: one-click path — pending photos selected; missing video does not invent required video
{
  const pending = selectPendingGalleryPhotoIds(
    [
      { id: "g1", companion_profile_id: companionA, media_type: "gallery", status: "pending" },
      { id: "g2", companion_profile_id: companionA, media_type: "cover", status: "pending" },
    ],
    companionA
  );
  assert.equal(pending.ids.length, 2);
  assert.equal(videoReviewRequired([]), false);
  const chip = showcaseVideoCompleteness(false);
  assert.equal(chip.required, false);
}

console.log("verify-companion-review-video-optional-photos-bulk: PASS");
