/**
 * Companion credential eligibility: identity OR deposit (never both required).
 * Used by accept-order gates and public homepage / hall listing.
 */

function statusText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

export function isIdentityVerified(row = {}, identityRow = null) {
  const raw = statusText(
    identityRow?.status,
    identityRow?.verification_status,
    row.identity_status,
    row.identityStatus
  ).toLowerCase();
  return /approved|verified|passed/.test(raw);
}

export function isDepositVerified(row = {}, depositRow = null) {
  const raw = statusText(
    depositRow?.status,
    row.deposit_status,
    row.depositStatus
  ).toLowerCase();
  if (!raw) return false;
  // unpaid / draft must not match "paid"
  if (/unpaid|draft|none|not_submitted|missing|未缴|rejected|驳回|拒绝|refund/.test(raw)) {
    return false;
  }
  return /^(approved|verified|passed|paid|received)$|已通过|已缴纳|已到账/.test(raw);
}

/** True when identity_verified OR deposit_verified. */
export function isCredentialOrOk(row = {}, identityRow = null, depositRow = null) {
  return isIdentityVerified(row, identityRow) || isDepositVerified(row, depositRow);
}

/**
 * Accept-order / work eligibility (credential portion).
 * Profile/application approval and account status are checked separately.
 */
export function canAcceptByCredential(row = {}, identityRow = null, depositRow = null) {
  return isCredentialOrOk(row, identityRow, depositRow);
}

/**
 * Homepage / hall visibility credential portion.
 * Same OR rule as accept-order: either credential is enough; neither hides the companion.
 */
export function canAppearOnHomepageByCredential(row = {}, identityRow = null, depositRow = null) {
  return isCredentialOrOk(row, identityRow, depositRow);
}

/**
 * Pure matrix helper for tests / diagnostics.
 * @returns {{ identityVerified: boolean, depositVerified: boolean, credentialOrOk: boolean, canAccept: boolean, homepageVisible: boolean }}
 */
export function evaluateCredentialMatrix(row = {}, identityRow = null, depositRow = null) {
  const identityVerified = isIdentityVerified(row, identityRow);
  const depositVerified = isDepositVerified(row, depositRow);
  const credentialOrOk = identityVerified || depositVerified;
  return {
    identityVerified,
    depositVerified,
    credentialOrOk,
    canAccept: credentialOrOk,
    homepageVisible: credentialOrOk,
  };
}
