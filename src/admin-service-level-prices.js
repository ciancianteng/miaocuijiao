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
        return (
          '<td style="min-width:168px;vertical-align:top;padding:8px;border:1px solid rgba(255,255,255,.08)">' +
          '<div style="font-size:11px;color:#ff9fcd;font-weight:800;margin-bottom:6px">' +
          esc(String(lv.levelId || "").toUpperCase()) +
          (lv.configured ? ' · 已配置' : ' · 回落等级带') +
          "</div>" +
          '<label style="display:grid;gap:2px;font-size:11px;margin:0 0 4px"><span>默认</span><input name="' +
          prefix +
          'base" type="number" min="0" step="1" value="' +
          esc(lv.basePrice) +
          '"></label>' +
          '<label style="display:grid;gap:2px;font-size:11px;margin:0 0 4px"><span>最低</span><input name="' +
          prefix +
          'min" type="number" min="0" step="1" value="' +
          esc(lv.minPrice) +
          '"></label>' +
          '<label style="display:grid;gap:2px;font-size:11px;margin:0 0 4px"><span>最高</span><input name="' +
          prefix +
          'max" type="number" min="0" step="1" value="' +
          esc(lv.maxPrice) +
          '"></label>' +
          '<label style="display:grid;gap:2px;font-size:11px;margin:0"><span>加价上限</span><input name="' +
          prefix +
          'markup" type="number" min="0" step="1" value="' +
          esc(lv.markupAllowance) +
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
      el.innerHTML = '<div class="content-loading">正在读取服务 × 等级价格矩阵…</div>';
      return;
    }
    var head =
      '<div class="content-admin-head"><div><h3>服务 × LV1–LV5 价格矩阵</h3><p>每种服务独立配置五个等级的默认售价、最低/最高允许售价与加价上限。清零只清矩阵行，不删 LV 结构、不改订单财务。未配置行回落 companion_levels。</p></div>' +
      '<div class="content-version-meta"><span>' +
      esc(state.grid.length) +
      " 个服务</span><span>" +
      esc(state.message || state.error || "可逐服务保存") +
      "</span></div></div>";
    if (!state.grid.length) {
      el.innerHTML = head + '<div class="empty">暂无启用服务。请先在服务管理启用游戏/服务。</div>';
      return;
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
          '">保存</button>' +
          '<button class="mini-btn" type="button" data-matrix-clear="' +
          esc(svc.serviceId) +
          '">清零</button></div></th>' +
          levelCells(svc) +
          "</tr>"
        );
      })
      .join("");
    el.innerHTML =
      head +
      '<form data-matrix-form class="panel" style="padding:12px;overflow:auto">' +
      '<table style="width:100%;border-collapse:collapse;color:#ddd"><thead><tr><th style="text-align:left;padding:8px">服务</th>' +
      (state.levels || [])
        .map(function (lv) {
          return '<th style="padding:8px">' + esc((lv.code || lv.id || "").toUpperCase()) + " " + esc(lv.name || "") + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>" +
      '<p class="admin-sync-note" style="margin:12px 0 0">校验：最低 ≤ 默认 ≤ 最高；默认 + 加价 ≤ 最高。仅影响新报价/新订单。</p></form>';
  }

  function collectServiceRows(serviceId) {
    var form = target() && target().querySelector("[data-matrix-form]");
    if (!form) return [];
    var fd = new FormData(form);
    var levels = ["lv1", "lv2", "lv3", "lv4", "lv5"];
    return levels.map(function (levelId) {
      var p = serviceId + "__" + levelId + "__";
      return {
        serviceId: serviceId,
        levelId: levelId,
        basePrice: Number(fd.get(p + "base") || 0),
        minPrice: Number(fd.get(p + "min") || 0),
        maxPrice: Number(fd.get(p + "max") || 0),
        markupAllowance: Number(fd.get(p + "markup") || 0),
      };
    });
  }

  function load() {
    state.loading = true;
    state.error = "";
    render();
    apiGet()
      .then(function (res) {
        state.grid = res.grid || [];
        state.levels = res.levels || [];
        state.loading = false;
        state.message = "已加载服务等级价格矩阵";
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
    var rows = collectServiceRows(serviceId);
    state.saving = true;
    state.message = "保存中…";
    render();
    apiPost({ action: "save_service", rows: rows })
      .then(function (res) {
        state.saving = false;
        state.message = res.message || "已保存";
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

  function clearService(serviceId) {
    if (!confirm("确认清零该服务的 LV1–LV5 矩阵配置？\n不会删除等级结构、用户等级、订单或财务。")) return;
    if (!confirm("二次确认：清零该服务矩阵行？")) return;
    apiPost({ action: "clear_service", serviceId: serviceId, confirm: "CLEAR_SERVICE_MATRIX" })
      .then(function (res) {
        state.message = res.message || "已清零";
        return apiGet();
      })
      .then(function (res) {
        state.grid = res.grid || [];
        state.levels = res.levels || [];
        render();
      })
      .catch(function (err) {
        alert("清零失败：" + (err.message || ""));
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
        return;
      }
      var clear = e.target.closest("[data-matrix-clear]");
      if (clear) {
        clearService(clear.getAttribute("data-matrix-clear"));
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
