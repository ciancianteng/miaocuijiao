/**
 * Companion order commission SoT.
 *
 * Semantics (single definition for the whole product):
 *   companionShareRate = % of the order (or child allocation) amount the companion earns.
 *   platformRate       = 100 - companionShareRate
 *
 * Example: order RM100, companionShareRate 80 → companion RM80, platform RM20.
 *
 * Priority for effective companion share:
 *   1) companion_profiles.commission_rate_override  (nullable companion share %)
 *   2) club / org companion share (when configured)
 *   3) system default from profile.commission_rate / level (platform % → share)
 *
 * Historical settled orders keep platform_fee_rate + companion_income snapshots;
 * changing override must never rewrite settled income.
 */

export function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(value) {
  return Math.round(money(value) * 100) / 100;
}

/**
 * companion_profiles.commission_rate = 平台抽成 %（与后台「平台抽成」表单一致）.
 * Legacy rows sometimes stored companion share (70–90); treat those as share.
 * @returns {{ platformRate: number, companionShareRate: number }}
 */
export function resolvePlatformCommission(storedRate, fallbackPlatform = 20) {
  const raw = money(storedRate);
  let platformRate;
  if (!(raw > 0 && raw <= 100)) {
    platformRate = money(fallbackPlatform) || 20;
  } else if (raw >= 50) {
    // Legacy companion-share values (e.g. 80) → platform 20
    platformRate = roundMoney(100 - raw);
  } else {
    platformRate = raw;
  }
  platformRate = Math.min(100, Math.max(0, platformRate));
  return {
    platformRate,
    companionShareRate: roundMoney(100 - platformRate),
  };
}

/** Normalize a companion-share % input (0–100). Returns null if empty/invalid. */
export function parseCompanionShareOverride(raw) {
  if (raw == null || raw === "") return null;
  const n = money(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return roundMoney(n);
}

/**
 * Resolve club companion share when available.
 * Soft hook: no club rate table today → returns null (inherit system).
 */
export function resolveClubCompanionShare(companionProfile = {}, clubMeta = null) {
  const fromClub =
    clubMeta?.companionShareRate ??
    clubMeta?.companion_share_rate ??
    clubMeta?.commissionShareRate ??
    null;
  const parsedClub = parseCompanionShareOverride(fromClub);
  if (parsedClub != null) return { rate: parsedClub, source: "club", label: clubMeta?.name || "俱乐部设置" };

  const fromProfile =
    companionProfile.club_companion_share_rate ??
    companionProfile.clubCompanionShareRate ??
    null;
  const parsedProfile = parseCompanionShareOverride(fromProfile);
  if (parsedProfile != null) {
    return {
      rate: parsedProfile,
      source: "club",
      label: companionProfile.club_name || companionProfile.clubName || "俱乐部设置",
    };
  }
  return null;
}

/**
 * Effective companion SHARE rate with source label for admin UI / settlement.
 *
 * @param {object} opts
 * @param {object} [opts.companionProfile]
 * @param {number|string|null} [opts.levelPlatformRate] level.commissionRate (platform %)
 * @param {object|null} [opts.clubMeta]
 * @param {number} [opts.fallbackPlatform=20]
 */
export function resolveEffectiveCompanionCommission({
  companionProfile = {},
  levelPlatformRate = null,
  clubMeta = null,
  fallbackPlatform = 20,
} = {}) {
  const override = parseCompanionShareOverride(
    companionProfile.commission_rate_override ?? companionProfile.commissionRateOverride
  );
  if (override != null) {
    return {
      companionShareRate: override,
      platformRate: roundMoney(100 - override),
      source: "override",
      sourceLabel: "个人自定义",
      overrideRate: override,
      inheritedShareRate: null,
    };
  }

  const club = resolveClubCompanionShare(companionProfile, clubMeta);
  if (club) {
    return {
      companionShareRate: club.rate,
      platformRate: roundMoney(100 - club.rate),
      source: "club",
      sourceLabel: club.label || "俱乐部设置",
      overrideRate: null,
      inheritedShareRate: club.rate,
    };
  }

  const inherited = resolvePlatformCommission(
    companionProfile.commission_rate ?? companionProfile.commissionRate,
    levelPlatformRate != null ? levelPlatformRate : fallbackPlatform
  );
  return {
    companionShareRate: inherited.companionShareRate,
    platformRate: inherited.platformRate,
    source: "system",
    sourceLabel: "平台默认",
    overrideRate: null,
    inheritedShareRate: inherited.companionShareRate,
  };
}

/** Split an amount by companion share %. */
export function splitByCompanionShare(amount, companionShareRate) {
  const total = money(amount);
  const share = Math.min(100, Math.max(0, money(companionShareRate)));
  const companionNet = roundMoney((total * share) / 100);
  const platformFee = roundMoney(total - companionNet);
  return {
    amount: total,
    companionShareRate: roundMoney(share),
    platformRate: roundMoney(100 - share),
    companionNet,
    platformFee,
  };
}
