(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "popularityManagement";
  var state = { loading: true, data: null, error: "", message: "" };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function role() {
    try {
      return JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}").adminRole || "admin";
    } catch (e) {
      return "admin";
    }
  }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Accept: "application/json", "x-mcj-admin-role": role() }, opts.headers || {});
    return (Auth && Auth.fetch ? Auth.fetch(path, opts) : fetch(path, opts)).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "请求失败");
        return body;
      });
    });
  }
  function sw(name, checked, label) {
    return (
      '<label class="admin-switch-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)"><span>' +
      esc(label) +
      '</span><input type="checkbox" name="' +
      esc(name) +
      '" ' +
      (checked ? "checked" : "") +
      "></label>"
    );
  }
  function num(name, value, label) {
    return (
      '<label style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px"><span>' +
      esc(label) +
      '</span><input type="number" step="0.01" name="' +
      esc(name) +
      '" value="' +
      esc(value) +
      '"></label>'
    );
  }
  function paint() {
    var box = document.getElementById(TARGET);
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取人气榜设置...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="admin-sync-note">' + esc(state.error) + ' <button class="mini-btn" data-pop-reload>重试</button></div>';
      return;
    }
    var r = (state.data && state.data.rules) || {};
    var anomalies = (state.data && state.data.anomalies) || [];
    var adjustments = (state.data && state.data.adjustments) || [];
    var rewards = (state.data && state.data.rewards) || [];
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>人气榜设置</h3><p>规则可调，分数来自真实订单/评价/礼物/在线。禁止无日志直接改分。</p></div>' +
      '<button class="mini-btn primary-lite" type="button" data-pop-recompute>立即重算</button> <button class="mini-btn" type="button" data-pop-reload>刷新</button></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<form data-pop-rules class="admin-form" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:960px">' +
      '<div>' +
      num("completedOrderPoints", r.completedOrderPoints, "每单完成加分") +
      num("fiveStarPoints", r.fiveStarPoints, "五星评价加分") +
      num("fourStarPoints", r.fourStarPoints, "四星评价加分") +
      num("giftPointsPer10CatFood", r.giftPointsPer10CatFood, "每 10 猫粮礼物加分") +
      num("onlineHourPoints", r.onlineHourPoints, "在线时长每小时加分") +
      num("streakDayPoints", r.streakDayPoints, "连续接单每天奖励") +
      num("favoritePoints", r.favoritePoints, "收藏加分") +
      "</div><div>" +
      num("cancelPenalty", r.cancelPenalty, "取消订单扣分") +
      num("complaintPenalty", r.complaintPenalty, "投诉扣分") +
      num("rejectPenalty", r.rejectPenalty, "拒单扣分") +
      num("timeoutPenalty", r.timeoutPenalty, "超时扣分") +
      num("giftDailyCapPoints", r.giftDailyCapPoints, "礼物分每日上限") +
      num("displayCount", r.displayCount, "榜单显示人数") +
      num("rewardTop1", r.rewardTop1, "第1名奖励猫粮") +
      num("rewardTop2", r.rewardTop2, "第2名奖励猫粮") +
      num("rewardTop3", r.rewardTop3, "第3名奖励猫粮") +
      "</div><div style=\"grid-column:1/-1\">" +
      sw("enabled", r.enabled !== false, "启用人气榜") +
      sw("enableWeekly", r.enableWeekly !== false, "启用本周榜") +
      sw("enableMonthly", r.enableMonthly !== false, "启用本月榜") +
      sw("enableTotal", r.enableTotal !== false, "启用总榜") +
      sw("enableDaily", !!r.enableDaily, "启用日榜") +
      sw("showScore", r.showScore !== false, "显示完整分数") +
      sw("showOrders", r.showOrders !== false, "显示订单数") +
      sw("showGifts", r.showGifts !== false, "显示礼物数") +
      sw("showOnline", !!r.showOnline, "显示在线时长") +
      sw("rewardsEnabled", !!r.rewardsEnabled, "启用榜单奖励（默认关闭，需审核发放）") +
      '<div style="margin-top:14px"><button class="mini-btn primary-lite" type="submit">保存规则</button></div></div></form>' +
      '<div style="margin-top:22px" class="admin-section-head compact"><div><h3>人工调分</h3><p>必须填写原因，写入管理员日志并重算。</p></div></div>' +
      '<form data-pop-adjust style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:18px">' +
      '<label>陪玩 UUID<input name="companionId" required placeholder="profiles.id"></label>' +
      '<label>分数（可负）<input name="points" type="number" step="0.01" required></label>' +
      '<label style="flex:1;min-width:200px">原因<input name="reason" required></label>' +
      '<button class="mini-btn" type="submit">提交调分</button></form>' +
      '<div class="admin-section-head compact"><div><h3>异常人气记录</h3></div>' +
      (r.rewardsEnabled
        ? '<button class="mini-btn" type="button" data-pop-rewards>生成周榜待审奖励</button>'
        : "") +
      "</div>" +
      '<div class="table-wrap"><table><thead><tr><th>时间</th><th>陪玩</th><th>说明</th></tr></thead><tbody>' +
      (anomalies.length
        ? anomalies
            .map(function (a) {
              return (
                "<tr><td>" +
                esc(a.created_at) +
                "</td><td>" +
                esc(a.companion_id) +
                "</td><td>" +
                esc(a.note) +
                "</td></tr>"
              );
            })
            .join("")
        : '<tr><td colspan="3">暂无异常</td></tr>') +
      "</tbody></table></div>" +
      '<div class="admin-section-head compact" style="margin-top:18px"><div><h3>调分记录</h3></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>时间</th><th>陪玩</th><th>分数</th><th>原因</th></tr></thead><tbody>' +
      (adjustments.length
        ? adjustments
            .map(function (a) {
              return (
                "<tr><td>" +
                esc(a.created_at) +
                "</td><td>" +
                esc(a.companion_id) +
                "</td><td>" +
                esc(a.points) +
                "</td><td>" +
                esc(a.reason) +
                "</td></tr>"
              );
            })
            .join("")
        : '<tr><td colspan="4">暂无调分</td></tr>') +
      "</tbody></table></div>" +
      '<div class="admin-section-head compact" style="margin-top:18px"><div><h3>奖励记录</h3></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>周期</th><th>排名</th><th>猫粮</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      (rewards.length
        ? rewards
            .map(function (a) {
              return (
                "<tr><td>" +
                esc(a.period_type) +
                " " +
                esc(a.period_start) +
                "</td><td>" +
                esc(a.rank) +
                "</td><td>" +
                esc(a.reward_cat_food) +
                "</td><td>" +
                esc(a.status) +
                "</td><td>" +
                (a.status === "pending"
                  ? '<button class="mini-btn" type="button" data-pop-approve="' + esc(a.id) + '">审核发放</button>'
                  : "-") +
                "</td></tr>"
              );
            })
            .join("")
        : '<tr><td colspan="5">暂无奖励</td></tr>') +
      "</tbody></table></div>";
  }
  function load() {
    state.loading = true;
    paint();
    api("/api/admin/popularity?action=bootstrap")
      .then(function (res) {
        state.data = res;
        state.error = "";
      })
      .catch(function (err) {
        state.error = err.message || "读取失败";
      })
      .finally(function () {
        state.loading = false;
        paint();
      });
  }
  function formBool(form, name) {
    var el = form.elements[name];
    return !!(el && el.checked);
  }
  function formNum(form, name) {
    var raw = form.elements[name] && form.elements[name].value;
    var n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-pop-reload]")) {
      load();
      return;
    }
    if (e.target.closest("[data-pop-recompute]")) {
      api("/api/admin/popularity", { method: "POST", body: JSON.stringify({ action: "recompute" }) })
        .then(function (res) {
          state.message = res.message || "已重算";
          return load();
        })
        .catch(function (err) {
          state.message = err.message;
          paint();
        });
      return;
    }
    if (e.target.closest("[data-pop-rewards]")) {
      api("/api/admin/popularity", { method: "POST", body: JSON.stringify({ action: "create_period_rewards", period: "weekly" }) })
        .then(function (res) {
          state.message = res.message || "已生成";
          return load();
        })
        .catch(function (err) {
          state.message = err.message;
          paint();
        });
      return;
    }
    var approve = e.target.closest("[data-pop-approve]");
    if (approve) {
      api("/api/admin/popularity", {
        method: "POST",
        body: JSON.stringify({ action: "approve_reward", id: approve.getAttribute("data-pop-approve"), reason: "后台审核发放" }),
      })
        .then(function (res) {
          state.message = res.message || "已发放";
          return load();
        })
        .catch(function (err) {
          state.message = err.message;
          paint();
        });
    }
  });
  document.addEventListener("submit", function (e) {
    var rules = e.target.closest("[data-pop-rules]");
    if (rules) {
      e.preventDefault();
      var payload = {
        action: "save_rules",
        completedOrderPoints: formNum(rules, "completedOrderPoints"),
        fiveStarPoints: formNum(rules, "fiveStarPoints"),
        fourStarPoints: formNum(rules, "fourStarPoints"),
        giftPointsPer10CatFood: formNum(rules, "giftPointsPer10CatFood"),
        onlineHourPoints: formNum(rules, "onlineHourPoints"),
        streakDayPoints: formNum(rules, "streakDayPoints"),
        favoritePoints: formNum(rules, "favoritePoints"),
        cancelPenalty: formNum(rules, "cancelPenalty"),
        complaintPenalty: formNum(rules, "complaintPenalty"),
        rejectPenalty: formNum(rules, "rejectPenalty"),
        timeoutPenalty: formNum(rules, "timeoutPenalty"),
        giftDailyCapPoints: formNum(rules, "giftDailyCapPoints"),
        displayCount: formNum(rules, "displayCount"),
        rewardTop1: formNum(rules, "rewardTop1"),
        rewardTop2: formNum(rules, "rewardTop2"),
        rewardTop3: formNum(rules, "rewardTop3"),
        enabled: formBool(rules, "enabled"),
        enableWeekly: formBool(rules, "enableWeekly"),
        enableMonthly: formBool(rules, "enableMonthly"),
        enableTotal: formBool(rules, "enableTotal"),
        enableDaily: formBool(rules, "enableDaily"),
        showScore: formBool(rules, "showScore"),
        showOrders: formBool(rules, "showOrders"),
        showGifts: formBool(rules, "showGifts"),
        showOnline: formBool(rules, "showOnline"),
        rewardsEnabled: formBool(rules, "rewardsEnabled"),
      };
      api("/api/admin/popularity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        .then(function (res) {
          state.message = res.message || "已保存";
          return load();
        })
        .catch(function (err) {
          state.message = err.message;
          paint();
        });
      return;
    }
    var adj = e.target.closest("[data-pop-adjust]");
    if (adj) {
      e.preventDefault();
      api("/api/admin/popularity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust",
          companionId: adj.companionId.value,
          points: adj.points.value,
          reason: adj.reason.value,
        }),
      })
        .then(function (res) {
          state.message = res.message || "调分成功";
          adj.reset();
          return load();
        })
        .catch(function (err) {
          state.message = err.message;
          paint();
        });
    }
  });
  load();
})();
