(function () {
  "use strict";

  var Auth = window.MCJAdminAuthFetch;
  var state = {
    loading: false,
    saving: false,
    error: "",
    message: "",
    grid: [],
    levels: [],
    lastSaved: null,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function target() {
    return document.getElementById("serviceLevelPriceMatrixMount");
  }

  function apiGet() {
    var req = Auth && Auth.get
      ? Auth.get("/api/admin/service-level-prices")
      : fetch("/api/admin/service-level-prices", { headers: { Accept: "application/json" }, cache: "no-store" }).then(function (r) {
          return r.json().then(function (b) {
            if (!r.ok || b.ok === false) throw new Error(b.message || "读取失败");
            return b;
          });
        });
    return req;
  }

  function apiPost(body) {
    var req = Auth && Auth.fetch
      ? Auth.fetch("/api/admin/service-level-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : fetch("/api/admin/service-level-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
    return req.then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.message || "保存失败");
        return data;
      });
    });
  }

  function levelCells(svc) {
    return (svc.levels || [])
      .map(function (lv) {
        var prefix = svc.serviceId + "__" + lv.levelId + "__";
        var configured = lv.markupConfigured || lv.configured;
        return (
          '<td style="min-width:140px;vertical-align:top;padding:8px;border:1px solid rgba(255,255,255,.08)">' +
          '<div style="font-size:11px;color:#ff9fcd;font-weight:800;margin-bottom:6px">' +
          esc(String(lv.levelId || "").toUpperCase()) +
          (configured ? " · 已配置" : " · 未配置") +
          "</div>" +
          '<label style="display:grid;gap:2px;font-size:11px;margin:0"><span>等级加价（猫粮）</span><input name="' +
          prefix +
          'markup" type="number" min="0" step="1" value="' +
          esc(lv.markupAllowance != null ? lv.markupAllowance : 0) +
          '"></label>' +
          "</td>"
        );
      })
      .join("");
  }

  function render() {
    var el = target();
    if (!el) return;
    if (state.loading) {
      el.innerHTML = '<div class="content-loading">正在读取各游戏 LV1–LV5 加价…</div>';
      return;
    }
    var head =
      '<div class="content-admin-head"><div><h3>各游戏 LV1–LV5 等级加价上限</h3><p>这里填的是陪玩可自主加价的上限（CAP），不是自动加价。未设置陪玩加价时最终价=基础价；仅陪玩明确选 +1～+CAP 才加价。每游戏每等级独立，互不继承。历史订单成交价不变。</p></div>' +
      '<div class="content-version-meta"><span>' +
      esc(state.grid.length) +
      " 个游戏</span><span>" +
      esc(state.message || state.error || "保存后会重新读取校验") +
      "</span></div></div>";
    if (!state.grid.length) {
      el.innerHTML = head + '<div class="empty">暂无启用服务。请先在服务管理启用游戏。</div>';
      return;
    }
    var verify = "";
    if (state.lastSaved && state.lastSaved.serviceId) {
      var svc = (state.grid || []).find(function (g) {
        return g.serviceId === state.lastSaved.serviceId;
      });
      var marks = (svc && svc.levels ? svc.levels : []).map(function (lv) {
        return String(lv.levelId).toUpperCase() + "=" + String(lv.markupAllowance);
      });
      verify =
        '<p class="admin-sync-note" style="margin:0 0 12px">最近保存后回读：' +
        esc(svc ? svc.serviceName : state.lastSaved.serviceId) +
        " · " +
        esc(marks.join(" / ") || "无") +
        (state.lastSaved.source ? " · source=" + esc(state.lastSaved.source) : "") +
        "</p>";
    }
    var rows = state.grid
      .map(function (svc) {
        return (
          '<tr data-matrix-service="' +
          esc(svc.serviceId) +
          '"><th style="text-align:left;padding:10px;min-width:120px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)">' +
          '<div style="font-weight:800;color:#fff">' +
          esc(svc.serviceName) +
          '</div><div class="muted" style="font-size:11px">' +
          esc(svc.serviceId) +
          '</div><div class="row" style="margin-top:8px;gap:6px">' +
          '<button class="mini-btn primary-lite" type="button" data-matrix-save="' +
          esc(svc.serviceId) +
          '">保存加价</button></div></th>' +
          levelCells(svc) +
          "</tr>"
        );
      })
      .join("");
    el.innerHTML =
      head +
      verify +
      '<form data-matrix-form class="panel" style="padding:12px;overflow:auto">' +
      '<table style="width:100%;border-collapse:collapse;color:#ddd"><thead><tr><th style="text-align:left;padding:8px">游戏</th>' +
      (state.levels || [])
        .map(function (lv) {
          return '<th style="padding:8px">' + esc((lv.code || lv.id || "").toUpperCase()) + " " + esc(lv.name || "") + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>" +
      '<p class="admin-sync-note" style="margin:12px 0 0">不同游戏互不影响。保存写入 service_level_prices.markup_allowance，并写管理员日志。</p></form>';
  }

  function collectMarkups(serviceId) {
    var form = target() && target().querySelector("[data-matrix-form]");
    if (!form) return [];
    var fd = new FormData(form);
    return ["lv1", "lv2", "lv3", "lv4", "lv5"].map(function (levelId) {
      return {
        levelId: levelId,
        markupAllowance: Number(fd.get(serviceId + "__" + levelId + "__markup") || 0),
      };
    });
  }

  function load() {
    state.loading = true;
    state.error = "";
    render();
    apiGet()
      .then(function (res) {
        if (!res || res.ok === false) throw new Error((res && res.message) || "读取失败");
        if (!res.table || res.table.present !== true) {
          throw new Error("真实加价表不存在（table.present≠true），不能用回落数据冒充成功。");
        }
        state.grid = res.grid || [];
        state.levels = res.levels || [];
        state.loading = false;
        state.message = "已加载各游戏等级加价";
        render();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        state.message = "";
        render();
      });
  }

  function saveService(serviceId) {
    var markups = collectMarkups(serviceId);
    state.saving = true;
    state.message = "保存中…";
    render();
    apiPost({ action: "save_markup", serviceId: serviceId, markups: markups })
      .then(function (res) {
        state.saving = false;
        state.message = res.message || "已保存";
        state.lastSaved = { serviceId: serviceId, source: res.source, markups: res.markups || [] };
        if (res.source !== "service_level_prices") {
          throw new Error("保存未写入 service_level_prices（source=" + (res.source || "?") + "），已停止把回落当成功。");
        }
        return apiGet();
      })
      .then(function (res) {
        state.grid = res.grid || state.grid;
        state.levels = res.levels || state.levels;
        render();
      })
      .catch(function (err) {
        state.saving = false;
        state.error = err.message || "保存失败";
        state.message = "";
        render();
        alert("保存失败：" + (err.message || ""));
      });
  }

  function bind() {
    if (document.documentElement.dataset.slpBound === "1") return;
    document.documentElement.dataset.slpBound = "1";
    document.addEventListener("click", function (e) {
      if (!target()) return;
      var save = e.target.closest("[data-matrix-save]");
      if (save) {
        saveService(save.getAttribute("data-matrix-save"));
      }
    });
  }

  window.MCJServiceLevelPricesAdmin = {
    mount: function () {
      bind();
      load();
    },
    reload: load,
  };
})();
