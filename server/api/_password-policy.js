/**
 * Shared password rules for boss / companion / admin.
 * Never log or return the raw password from these helpers.
 */
export function validatePassword(password, confirmPassword) {
  const pwd = String(password == null ? "" : password);
  if (!pwd) return { ok: false, message: "请填写密码。" };
  if (pwd.length < 8) return { ok: false, message: "密码至少 8 位。" };
  if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) {
    return { ok: false, message: "密码必须同时包含字母和数字。" };
  }
  if (confirmPassword != null && String(confirmPassword) !== "" && String(confirmPassword) !== pwd) {
    return { ok: false, message: "两次输入的新密码不一致。" };
  }
  return { ok: true };
}

export const PASSWORD_RULE_HINT = "至少 8 位，须同时包含字母和数字";
