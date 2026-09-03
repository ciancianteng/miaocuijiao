/**
 * Admin · Boss order points settings (猫粮 spend × rate).
 * Independent from companion popularity.
 */
(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "pointsSettingsMount";
  var state = {
    loading: true,
    saving: false,
    error: "",
    message: "",
    tablesReady: true,
    enabled: true,
    pointsPerCatFood: 10,
    minOrderCatFood: 0,
    maxRewardPoints: 0,
    roundingMode: "floor",
    examples: [],
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function role() {
    try {
      return (
        JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}")
          .adminRole || "admin"
      );
    } catch (e) {
      return "admin";
    }
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign(
      { Accept: "application/json", "x-mcj-admin-role": role() },
      opts.headers || {}
    );
    return (Auth && Auth.fetch ? Auth.fetch(path, opts) : fetch(path, opts)).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "请求失败");
        return body;
      });
    });
  }

  function target() {
    return document.getElementById(TARGET);
  }

  function applySettings(s) {
    s = s || {};
    state.enabled = s.enabled !== false;
    state.pointsPerCatFood = Number(
      s.pointsPerCatFood != null ? s.pointsPerCatFood : s.pointsPerRm != null ? s.pointsPerRm : 10
    );
    state.minOrderCatFood = Number(
      s.minOrderCatFood != null ? s.minOrderCatFood : s.minOrderAmount != null ? s.minOrderAmount : 0
    );
    state.maxRewardPoints = Number(s.maxRewardPoints != null ? s.maxRewardPoints : 0);
    state.roundingMode = s.roundingMode || "floor";
    state.examples = Array.isArray(s.examples) ? s.examples : [];
    if (!Number.isFinite(state.pointsPerCatFood) || state.pointsPerCatFood < 0) state.pointsPerCatFood = 10;
    if (!Number.isFinite(state.minOrderCatFood) || state.minOrderCatFood < 0) state.minOrderCatFood = 0;
    if (!Number.isFinite(state.maxRewardPoints) || state.maxRewardPoints < 0) state.maxRewardPoints = 0;
  }

  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取积分设置...</div>';
      return;
    }

    var tip = "";
    if (state.error) tip += '<p class="admin-sync-note" style="color:#ff8aa0">' + esc(state.error) + "</p>";
    if (state.message) tip += '<p class="admin-sync-note" style="color:#86efac">' + esc(state.message) + "</p>";
    if (!state.tablesReady) {
      tip +=
        '<p class="admin-sync-note">请确认 Staging 已执行 points_settings 与 points_settings_rate migration。</p>';
    }

    var examples =
      (state.examples || [])
        .map(function (ex) {
          return "<li>" + esc(ex.label || "") + "</li>";
        })
        .join("") ||
      "<li>10猫粮 × " +
        esc(state.pointsPerCatFood) +
        " = " +
        esc(Math.floor(10 * state.pointsPerCatFood)) +
        "积分</li>";

    box.innerHTML =
      tip +
      '<form class="payment-editor" data-points-settings-form>' +
      '<section class="panel" style="margin:0;padding:0;border:0;background:transparent">' +
      '<h3 style="margin:0 0 8px;font-size:16px">Boss 订单积分</h3>' +
      '<p class="admin-sync-note" style="margin:0 0 14px">按订单<strong>猫粮</strong>实付 × 倍率计算（paid_cat_food，否则 total_amount）。订单不存银行 MYR；充值活动/赠送可能使「实付 RM ≠ 到账猫粮」。退款会完整回收积分义务（余额不足记入积分欠款，后续奖励先抵欠款）。仅影响之后新完成的订单。与陪玩人气无关。</p>' +
      '<div class="payment-field-grid" style="max-width:520px">' +
      "<label><span>启用 Boss 订单积分</span>" +
      '<select name="enabled">' +
      '<option value="true"' +
      (state.enabled ? " selected" : "") +
      ">开</option>" +
      '<option value="false"' +
      (!state.enabled ? " selected" : "") +
      ">关</option>" +
      "</select></label>" +
      "<label><span>每消费 1 猫粮获得多少积分</span>" +
      '<input name="pointsPerCatFood" type="number" inputmode="decimal" min="0" step="0.0001" required value="' +
      esc(state.pointsPerCatFood) +
      '"></label>' +
      "<label><span>每单最低消费猫粮</span>" +
      '<input name="minOrderCatFood" type="number" inputmode="decimal" min="0" step="0.01" required value="' +
      esc(state.minOrderCatFood) +
      '"></label>' +
      "<label><span>每单最高奖励积分（0=不限制）</span>" +
      '<input name="maxRewardPoints" type="number" inputmode="numeric" min="0" step="1" required value="' +
      esc(state.maxRewardPoints) +
      '"></label>' +
      "<label><span>小数积分处理方式</span>" +
      '<select name="roundingMode">' +
      '<option value="floor"' +
      (state.roundingMode === "floor" ? " selected" : "") +
      ">向下取整（默认）</option>" +
      '<option value="round"' +
      (state.roundingMode === "round" ? " selected" : "") +
      ">四舍五入</option>" +
      '<option value="ceil"' +
      (state.roundingMode === "ceil" ? " selected" : "") +
      ">向上取整</option>" +
      "</select></label>" +
      "</div>" +
      '<div class="admin-sync-note" style="margin:14px 0 0"><strong>计算示例</strong><ul style="margin:8px 0 0;padding-left:18px">' +
      examples +
      "</ul>" +
      "<p style=\"margin:8px 0 0\">公式：rewardPoints = " +
      esc(state.roundingMode) +
      "(订单猫粮实付 × points_per_cat_food)</p></div>" +
      '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<button class="mini-btn primary-lite" type="submit" data-points-save' +
      (state.saving ? " disabled" : "") +
      ">" +
      (state.saving ? "保存中…" : "保存设置") +
      "</button>" +
      '<button class="mini-btn" type="button" data-points-reload' +
      (state.saving ? " disabled" : "") +
      ">刷新</button>" +
      "</div>" +
      "</section></form>";
  }

  function load() {
    state.loading = true;
    state.error = "";
    state.message = "";
    paint();
    return api("/api/admin/points-settings")
      .then(function (body) {
        applySettings(body.settings);
        state.tablesReady = body.tablesReady !== false;
        if (body.message) state.message = body.message;
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取积分设置失败";
        paint();
      });
  }

  function save(form) {
    if (state.saving) return;
    var enabled = form.elements.enabled.value === "true";
    var pointsPerCatFood = Number(form.elements.pointsPerCatFood.value);
    var minOrderCatFood = Number(form.elements.minOrderCatFood.value);
    var maxRewardPoints = Number(form.elements.maxRewardPoints.value);
    var roundingMode = form.elements.roundingMode.value || "floor";

    if (!Number.isFinite(pointsPerCatFood) || pointsPerCatFood < 0) {
      state.error = "每消费 1 猫粮获得积分必须 ≥ 0。";
      state.message = "";
      paint();
      return;
    }
    if (!Number.isFinite(minOrderCatFood) || minOrderCatFood < 0) {
      state.error = "最低消费猫粮必须 ≥ 0。";
      state.message = "";
      paint();
      return;
    }
    if (!Number.isInteger(maxRewardPoints) || maxRewardPoints < 0) {
      state.error = "最高奖励积分必须为 ≥ 0 的整数（0=不限制）。";
      state.message = "";
      paint();
      return;
    }

    state.saving = true;
    state.error = "";
    state.message = "";
    paint();
    api("/api/admin/points-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: enabled,
        pointsPerCatFood: pointsPerCatFood,
        minOrderCatFood: minOrderCatFood,
        maxRewardPoints: maxRewardPoints,
        roundingMode: roundingMode,
      }),
    })
      .then(function (body) {
        applySettings(body.settings);
        state.tablesReady = body.tablesReady !== false;
        state.message = body.message || "积分设置已保存";
        state.saving = false;
        paint();
      })
      .catch(function (err) {
        state.saving = false;
        state.error = err.message || "保存失败";
        paint();
      });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-points-reload]")) {
      e.preventDefault();
      load();
    }
  });

  document.addEventListener("submit", function (e) {
    var form = e.target.closest("[data-points-settings-form]");
    if (!form) return;
    e.preventDefault();
    save(form);
  });

  function boot() {
    if (!target()) return;
    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-section="points-settings"]');
    if (btn) setTimeout(boot, 0);
  });
})();
