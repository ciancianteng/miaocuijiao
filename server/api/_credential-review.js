/**
 * Identity / deposit review phases.
 * Business rule: one approved credential (identity OR deposit) satisfies the gate.
 * Uploaded or pending is not approved. A profile flag without a file is not an upload.
 */

export function hasIdentityFile(row) {
  if (!row) return false;
  return !!(
    String(row.id_front_path || "").trim() ||
    String(row.id_back_path || "").trim() ||
    String(row.id_handheld_path || "").trim()
  );
}

export function hasDepositProof(row) {
  if (!row) return false;
  return !!String(row.proof_path || "").trim();
}

function isApprovedStatus(raw) {
  return /^(approved|verified|passed|paid|received)$/.test(raw) || /已通过|已缴纳|已到账|已认证/.test(raw);
}

function isRejectedStatus(raw) {
  return /reject|驳回|拒绝/.test(raw);
}

function isPendingStatus(raw) {
  return /pending|review|submit|uploaded|待审|审核中/.test(raw);
}

function isRefundedStatus(raw) {
  return /refund|退回|退还/.test(raw);
}

/**
 * @returns {"missing"|"uploaded"|"pending"|"approved"|"rejected"|"refunded"}
 */
export function credentialPhase({ status = "", hasFile = false, kind = "identity" } = {}) {
  const raw = String(status || "").trim().toLowerCase();
  if (kind === "deposit" && isRefundedStatus(raw)) return "refunded";
  if (isApprovedStatus(raw)) return "approved";
  if (isRejectedStatus(raw)) return "rejected";
  if (hasFile && isPendingStatus(raw)) return "pending";
  if (hasFile) return "uploaded";
  return "missing";
}

function shortLabel(kind, phase) {
  if (phase === "approved") return kind === "deposit" ? "已缴纳" : "已通过";
  if (phase === "rejected") return "已拒绝";
  if (phase === "pending") return "待审核";
  if (phase === "uploaded") return "已上传";
  if (phase === "refunded") return "已退回";
  return kind === "deposit" ? "未缴纳" : "未认证";
}

function detailLabel(kind, phase, otherApproved) {
  if (phase === "approved") return "已通过";
  if (phase === "rejected") return "已拒绝";
  if (phase === "pending") return "已上传，待审核";
  if (phase === "uploaded") return "已上传";
  if (phase === "refunded") return "已退回";
  if (kind === "identity") {
    return otherApproved ? "尚未上传身份证（押金已通过，非必填）" : "尚未上传身份证（必填）";
  }
  return otherApproved ? "尚未上传押金（身份证已通过，非必填）" : "尚未上传押金（必填）";
}

export function reviewCredential({ identityStatus = "", identityFile = false, depositStatus = "", depositFile = false } = {}) {
  const identityPhase = credentialPhase({ status: identityStatus, hasFile: identityFile, kind: "identity" });
  const depositPhase = credentialPhase({ status: depositStatus, hasFile: depositFile, kind: "deposit" });
  const identityApproved = identityPhase === "approved";
  const depositApproved = depositPhase === "approved";
  const satisfied = identityApproved || depositApproved;
  const identity = {
    phase: identityPhase,
    hasFile: !!identityFile,
    required: !satisfied,
    shortLabel: shortLabel("identity", identityPhase),
    label: detailLabel("identity", identityPhase, depositApproved && !identityApproved),
  };
  const deposit = {
    phase: depositPhase,
    hasFile: !!depositFile,
    required: !satisfied,
    shortLabel: shortLabel("deposit", depositPhase),
    label: detailLabel("deposit", depositPhase, identityApproved && !depositApproved),
  };
  let summary = "认证方式为身份证或押金二选一。已上传不等于已通过。";
  if (satisfied) {
    summary = identityApproved && depositApproved
      ? "身份证与押金均已通过。"
      : identityApproved
        ? "身份证已通过，押金不是必填项。"
        : "押金已通过，身份证不是必填项。";
  } else if (identity.phase === "pending" || deposit.phase === "pending" || identity.phase === "uploaded" || deposit.phase === "uploaded") {
    summary = "已有资料上传。待审核通过其中一项后，另一项不再作为必填缺口。";
  } else {
    summary = "身份证与押金都尚未上传。完成其中一项并审核通过即可。";
  }
  return { identity, deposit, satisfied, summary };
}

export function applicationPhase(row = {}) {
  const raw = String(row.application_status || row.applicationStatus || "").trim().toLowerCase();
  const submitted = !!(row.application_submitted_at || row.applicationSubmittedAt);
  if (/^(approved|verified|passed)$/.test(raw) || /已通过/.test(raw)) return "approved";
  if (/reject|已拒绝|已驳回/.test(raw)) return "rejected";
  if (/resubmit|need_more|补资料/.test(raw)) return "resubmit";
  if (/^(draft|archived|deleted)$/.test(raw)) return "draft";
  if (/pending|review|submit|待审核|审核中|未审核/.test(raw)) return "pending";
  if (!submitted) return "draft";
  return "pending";
}

const AUDIT_PENDING = new Set(["未审核", "待审核", "审核中"]);

export function matchesPlayerAuditFilter(filter, phase) {
  const value = String(filter || "").trim();
  if (!value) return true;
  if (AUDIT_PENDING.has(value)) return phase === "pending";
  if (value === "已通过") return phase === "approved";
  if (value === "已拒绝") return phase === "rejected";
  return false;
}

export function matchesPlayerIdentityFilter(filter, phase) {
  const value = String(filter || "").trim();
  if (!value) return true;
  if (value === "已认证") return phase === "approved";
  if (value === "已上传") return phase === "uploaded";
  if (value === "审核中") return phase === "pending";
  if (value === "未认证") return phase === "missing";
  if (value === "待补充") return phase === "rejected";
  return false;
}

export function matchesPlayerDepositFilter(filter, phase) {
  const value = String(filter || "").trim();
  if (!value) return true;
  if (value === "已缴纳" || value === "已到账") return phase === "approved";
  if (value === "待审核") return phase === "pending" || phase === "uploaded";
  if (value === "未缴纳") return phase === "missing";
  if (value === "已退回") return phase === "refunded";
  return false;
}

export function isApplicationQueueRow(row = {}) {
  if (!row || !row.id) return false;
  const phase = applicationPhase(row);
  if (phase === "draft") return false;
  return phase === "pending" || phase === "resubmit" || phase === "rejected" || phase === "approved";
}
