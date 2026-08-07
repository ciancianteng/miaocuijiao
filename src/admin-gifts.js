(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "giftManagement";
  var state = {
    loading: true,
    saving: false,
    gifts: [],
    transactions: [],
    commissionRate: 20,
    error: "",
    message: "",
    tab: "catalog",
    editing: null,
    iconPreview: "",
    iconDataUrl: "",
  };

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
  function post(payload) {
    return api("/api/admin/gifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  }
  function target() {
    return document.getElementById(TARGET);
  }
  function toast(message, isError) {
    var existing = document.getElementById("adminGiftToast");
    if (existing) existing.remove();
    var el = document.createElement("div");
    el.id = "adminGiftToast";
    el.setAttribute("role", "status");
    el.style.cssText =
      "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:12000;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:700;color:#ffe6f1;background:rgba(20,12,18,.94);border:1px solid " +
      (isError ? "rgba(255,120,120,.55)" : "rgba(255,160,200,.45)") +
      ";box-shadow:0 12px 32px rgba(0,0,0,.45);max-width:min(90vw,420px);text-align:center";
    el.textContent = message || "";
    document.body.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.remove();
    }, 3200);
  }
  function closeOverlay() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
    }
  }
  function blankGift() {
    return {
      id: "",
      name: "",
      iconUrl: "",
      catFoodPrice: 10,
      enabled: true,
      featured: true,
      sortOrder: 100,
      commissionRate: state.commissionRate || 20,
    };
  }
  function formHtml(gift) {
    gift = gift || blankGift();
    var preview = state.iconPreview || gift.iconUrl || "";
    return (
      '<form class="gift-form" data-gift-form style="display:grid;gap:12px;color:#fff">' +
      '<label style="display:grid;gap:6px;font-size:13px;color:#d1d5db">礼物名称' +
      '<input name="name" required maxlength="40" value="' +
      esc(gift.name || "") +
      '" placeholder="例如：猫爪" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,143,197,.35);background:rgba(0,0,0,.35);color:#fff"></label>' +
      '<div style="display:grid;gap:8px">' +
      '<div style="font-size:13px;color:#d1d5db">礼物图标 / 图片</div>' +
      '<div data-gift-icon-drop style="border:1px dashed rgba(255,143,197,.45);border-radius:12px;padding:14px;text-align:center;cursor:pointer;background:rgba(255,143,197,.05)">' +
      (preview
        ? '<img src="' + esc(preview) + '" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:12px;display:block;margin:0 auto 8px">'
        : '<div style="font-size:28px;margin-bottom:6px">🎁</div>') +
      '<div style="font-size:13px;color:#ffd6e8">点击或拖拽上传 JPG / PNG / WEBP</div></div>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp" data-gift-icon-file hidden>' +
      "</div>" +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<label style="display:grid;gap:6px;font-size:13px;color:#d1d5db">价格（猫粮）' +
      '<input name="catFoodPrice" type="number" min="1" step="1" required value="' +
      esc(gift.catFoodPrice != null ? gift.catFoodPrice : 10) +
      '" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,143,197,.35);background:rgba(0,0,0,.35);color:#fff"></label>' +
      '<label style="display:grid;gap:6px;font-size:13px;color:#d1d5db">排序' +
      '<input name="sortOrder" type="number" min="0" step="1" value="' +
      esc(gift.sortOrder != null ? gift.sortOrder : 100) +
      '" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,143,197,.35);background:rgba(0,0,0,.35);color:#fff"></label>' +
      "</div>" +
      '<label style="display:grid;gap:6px;font-size:13px;color:#d1d5db">礼物抽成 %' +
      '<input name="commissionRate" type="number" min="0" max="100" step="0.1" value="' +
      esc(gift.commissionRate != null ? gift.commissionRate : state.commissionRate || 20) +
      '" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,143,197,.35);background:rgba(0,0,0,.35);color:#fff"></label>' +
      '<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;color:#d1d5db;font-size:13px">' +
      '<label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" name="enabled" ' +
      (gift.enabled !== false ? "checked" : "") +
      "> 启用</label>" +
      '<label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" name="featured" ' +
      (gift.featured ? "checked" : "") +
      "> 推荐</label>" +
      "</div>" +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">' +
      '<button type="button" class="mini-btn" data-gift-cancel>取消</button>' +
      '<button type="submit" class="mini-btn primary-lite" data-gift-submit>' +
      (state.saving ? "保存中…" : "保存") +
      "</button></div></form>"
    );
  }
  function bindForm(gift) {
    var root =
      (window.MCJAdminOverlay && window.MCJAdminOverlay.getBody && window.MCJAdminOverlay.getBody()) ||
      document;
    var form = root.querySelector("[data-gift-form]");
    if (!form) return;
    var drop = form.querySelector("[data-gift-icon-drop]");
    var fileInput = form.querySelector("[data-gift-icon-file]");
    function acceptIcon(file) {
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
        toast("仅支持 JPG / PNG / WEBP", true);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        state.iconDataUrl = String(reader.result || "");
        state.iconPreview = state.iconDataUrl;
        openEditor(gift, true);
      };
      reader.readAsDataURL(file);
    }
    if (drop && fileInput) {
      drop.addEventListener("click", function () {
        fileInput.click();
      });
      fileInput.addEventListener("change", function () {
        acceptIcon(fileInput.files && fileInput.files[0]);
        fileInput.value = "";
      });
      ["dragenter", "dragover"].forEach(function (name) {
        drop.addEventListener(name, function (e) {
          e.preventDefault();
          drop.style.borderColor = "#ff8fc5";
        });
      });
      drop.addEventListener("dragleave", function (e) {
        e.preventDefault();
        drop.style.borderColor = "";
      });
      drop.addEventListener("drop", function (e) {
        e.preventDefault();
        drop.style.borderColor = "";
        acceptIcon(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
      });
    }
    var cancel = form.querySelector("[data-gift-cancel]");
    if (cancel) {
      cancel.addEventListener("click", function () {
        state.editing = null;
        state.iconPreview = "";
        state.iconDataUrl = "";
        closeOverlay();
      });
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (state.saving) return;
      var fd = new FormData(form);
      var payload = {
        action: "save",
        id: gift && gift.id ? gift.id : "",
        name: String(fd.get("name") || "").trim(),
        catFoodPrice: Number(fd.get("catFoodPrice") || 0),
        sortOrder: Number(fd.get("sortOrder") || 100),
        commissionRate: Number(fd.get("commissionRate") || 0),
        enabled: !!form.querySelector('[name="enabled"]').checked,
        featured: !!form.querySelector('[name="featured"]').checked,
        iconUrl: (gift && gift.iconUrl) || "",
      };
      if (!payload.name || payload.catFoodPrice <= 0) {
        toast("请填写礼物名称和有效价格", true);
        return;
      }
      state.saving = true;
      openEditor(gift, true);
      var chain = Promise.resolve(payload);
      if (state.iconDataUrl) {
        chain = post({
          action: "upload_icon",
          imageDataUrl: state.iconDataUrl,
          filename: payload.name || "gift",
        }).then(function (res) {
          payload.iconUrl = res.iconUrl || payload.iconUrl;
          return payload;
        });
      }
      chain
        .then(function (body) {
          return post(body);
        })
        .then(function (res) {
          toast(res.message || "礼物已保存", false);
          state.saving = false;
          state.editing = null;
          state.iconPreview = "";
          state.iconDataUrl = "";
          closeOverlay();
          return load();
        })
        .catch(function (err) {
          state.saving = false;
          openEditor(gift, true);
          toast(err.message || "保存失败", true);
        });
    });
  }
  function openEditor(gift, keepPreview) {
    state.editing = gift || blankGift();
    if (!keepPreview) {
      state.iconPreview = state.editing.iconUrl || "";
      state.iconDataUrl = "";
    }
    var title = state.editing.id ? "编辑礼物" : "新增礼物";
    var html = formHtml(state.editing);
    if (window.MCJAdminOverlay) {
      if (window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
        window.MCJAdminOverlay.setTitle(title);
        window.MCJAdminOverlay.setBody(html);
      } else {
        window.MCJAdminOverlay.open({
          title: title,
          html: html,
          onClose: function () {
            state.editing = null;
            state.iconPreview = "";
            state.iconDataUrl = "";
          },
        });
      }
      setTimeout(function () {
        bindForm(state.editing);
      }, 0);
      return;
    }
    // Fallback lightbox (same black-pink style) if overlay script missing.
    var existing = document.getElementById("adminGiftLightbox");
    if (existing) existing.remove();
    var overlay = document.createElement("div");
    overlay.id = "adminGiftLightbox";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;overflow:auto";
    overlay.innerHTML =
      '<div style="width:min(520px,100%);background:#141218;border:1px solid rgba(255,143,197,.28);border-radius:16px;padding:18px;color:#fff">' +
      '<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px"><h3 style="margin:0">' +
      esc(title) +
      "</h3></div>" +
      html +
      "</div>";
    document.body.appendChild(overlay);
    bindForm(state.editing);
  }
  function confirmBox(message, onYes) {
    var existing = document.getElementById("adminGiftConfirm");
    if (existing) existing.remove();
    var overlay = document.createElement("div");
    overlay.id = "adminGiftConfirm";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px";
    overlay.innerHTML =
      '<div style="width:min(400px,100%);background:#141218;border:1px solid rgba(255,143,197,.28);border-radius:16px;padding:18px;color:#fff">' +
      '<p style="margin:0 0 16px;line-height:1.6">' +
      esc(message) +
      "</p>" +
      '<div style="display:flex;gap:10px;justify-content:flex-end">' +
      '<button type="button" class="mini-btn" data-gift-confirm-no>取消</button>' +
      '<button type="button" class="mini-btn primary-lite" data-gift-confirm-yes>确认</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector("[data-gift-confirm-no]").onclick = function () {
      overlay.remove();
    };
    overlay.querySelector("[data-gift-confirm-yes]").onclick = function () {
      overlay.remove();
      onYes();
    };
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });
  }
  function openCommissionEditor() {
    var html =
      '<form data-gift-commission-form style="display:grid;gap:12px;color:#fff">' +
      '<label style="display:grid;gap:6px;font-size:13px;color:#d1d5db">默认礼物抽成 %' +
      '<input name="rate" type="number" min="0" max="100" step="0.1" value="' +
      esc(state.commissionRate || 20) +
      '" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,143,197,.35);background:rgba(0,0,0,.35);color:#fff"></label>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end">' +
      '<button type="button" class="mini-btn" data-gift-cancel>取消</button>' +
      '<button type="submit" class="mini-btn primary-lite">保存</button></div></form>';
    function bind() {
      var root =
        (window.MCJAdminOverlay && window.MCJAdminOverlay.getBody && window.MCJAdminOverlay.getBody()) ||
        document;
      var form = root.querySelector("[data-gift-commission-form]");
      if (!form) return;
      var cancel = form.querySelector("[data-gift-cancel]");
      if (cancel) cancel.onclick = closeOverlay;
      form.onsubmit = function (e) {
        e.preventDefault();
        var rate = Number(new FormData(form).get("rate") || 20);
        post({ action: "save_commission", commissionRate: rate })
          .then(function (res) {
            state.commissionRate = res.rate != null ? res.rate : rate;
            toast(res.message || "抽成已保存", false);
            closeOverlay();
            paint();
          })
          .catch(function (err) {
            toast(err.message || "保存失败", true);
          });
      };
    }
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({ title: "默认礼物抽成", html: html });
      setTimeout(bind, 0);
    }
  }
  function formatTime(value) {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleString("zh-CN", { hour12: false });
    } catch (e) {
      return String(value);
    }
  }
  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取礼物...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="admin-sync-note">' +
        esc(state.error) +
        ' <button class="mini-btn" data-gift-reload>重试</button></div>';
      return;
    }
    var rows = (state.gifts || [])
      .map(function (g) {
        return (
          "<tr><td style=\"display:flex;gap:8px;align-items:center\">" +
          (g.iconUrl
            ? '<img src="' + esc(g.iconUrl) + '" alt="" style="width:36px;height:36px;border-radius:8px;object-fit:cover">'
            : '<span style="width:36px;height:36px;border-radius:8px;background:rgba(255,143,197,.12);display:grid;place-items:center">🎁</span>') +
          "<span>" +
          esc(g.name) +
          "</span></td><td>" +
          esc(g.catFoodPrice) +
          "</td><td>" +
          (g.enabled ? "启用" : "停用") +
          "</td><td>" +
          (g.featured ? "是" : "否") +
          "</td><td>" +
          esc(g.sortOrder) +
          "</td><td>" +
          esc(g.commissionRate != null ? g.commissionRate : state.commissionRate) +
          "%</td><td>" +
          '<button class="mini-btn" type="button" data-gift-edit="' +
          esc(g.id) +
          '">编辑</button> ' +
          '<button class="mini-btn" type="button" data-gift-del="' +
          esc(g.id) +
          '">' +
          (g.enabled ? "停用" : "下架") +
          "</button></td></tr>"
        );
      })
      .join("");
    var txRows = (state.transactions || [])
      .map(function (t) {
        return (
          "<tr><td>" +
          esc(t.txNo || t.id) +
          "</td><td>" +
          esc(t.giftName) +
          " x" +
          esc(t.quantity || 1) +
          "</td><td>" +
          esc(t.grossCatFood) +
          "</td><td>" +
          esc(t.commissionRate) +
          "% / " +
          esc(t.commissionAmount) +
          "</td><td>" +
          esc(t.companionIncome) +
          "</td><td>" +
          esc(formatTime(t.createdAt)) +
          "</td></tr>"
        );
      })
      .join("");
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>礼物管理</h3><p>配置老板端礼物商城。修改后全站同步。抽成变更不影响历史流水。</p></div>' +
      '<button class="mini-btn primary-lite" type="button" data-gift-new>新增礼物</button> <button class="mini-btn" type="button" data-gift-reload>刷新</button></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="admin-final-tabs" style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">' +
      '<button type="button" class="mini-btn' +
      (state.tab === "catalog" ? " primary-lite" : "") +
      '" data-gift-tab="catalog">礼物目录</button>' +
      '<button type="button" class="mini-btn' +
      (state.tab === "ledger" ? " primary-lite" : "") +
      '" data-gift-tab="ledger">礼物流水</button></div>' +
      (state.tab === "catalog"
        ? '<div class="table-wrap"><table><thead><tr><th>名称</th><th>猫粮价格</th><th>状态</th><th>推荐</th><th>排序</th><th>抽成</th><th>操作</th></tr></thead><tbody>' +
          (rows || '<tr><td colspan="7">暂无礼物，点击「新增礼物」创建</td></tr>') +
          "</tbody></table></div>" +
          '<div style="margin-top:12px"><button class="mini-btn" type="button" data-gift-commission>设置默认礼物抽成 %（当前 ' +
          esc(state.commissionRate) +
          "）</button></div>"
        : '<div class="table-wrap"><table><thead><tr><th>流水号</th><th>礼物</th><th>金额</th><th>抽成</th><th>陪玩所得</th><th>时间</th></tr></thead><tbody>' +
          (txRows || '<tr><td colspan="6">暂无礼物流水</td></tr>') +
          "</tbody></table></div>");
  }
  function load() {
    state.loading = true;
    paint();
    return Promise.all([
      api("/api/admin/gifts"),
      api("/api/admin/gifts?action=transactions").catch(function () {
        return { transactions: [] };
      }),
    ])
      .then(function (pair) {
        var res = pair[0] || {};
        state.gifts = res.gifts || [];
        state.commissionRate = res.commissionRate != null ? res.commissionRate : 20;
        state.transactions = (pair[1] && pair[1].transactions) || [];
        state.message = res.message || "";
        state.error = "";
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "礼物读取失败";
        paint();
      });
  }
  document.addEventListener("click", function (e) {
    if (!target() || !target().contains(e.target)) return;
    if (e.target.closest("[data-gift-reload]")) return load();
    if (e.target.closest("[data-gift-new]")) return openEditor(blankGift());
    var tab = e.target.closest("[data-gift-tab]");
    if (tab) {
      state.tab = tab.getAttribute("data-gift-tab") || "catalog";
      paint();
      return;
    }
    var edit = e.target.closest("[data-gift-edit]");
    if (edit) {
      var id = edit.getAttribute("data-gift-edit");
      var gift = (state.gifts || []).find(function (g) {
        return String(g.id) === String(id);
      });
      if (!gift) {
        toast("找不到该礼物", true);
        return;
      }
      openEditor(gift);
      return;
    }
    var del = e.target.closest("[data-gift-del]");
    if (del) {
      var delId = del.getAttribute("data-gift-del");
      confirmBox("确认停用/下架该礼物？老板端将不再显示。", function () {
        post({ action: "soft_delete", id: delId })
          .then(function (res) {
            toast(res.message || "已停用", false);
            return load();
          })
          .catch(function (err) {
            toast(err.message || "操作失败", true);
          });
      });
      return;
    }
    if (e.target.closest("[data-gift-commission]")) openCommissionEditor();
  });
  document.addEventListener("DOMContentLoaded", function () {
    if (target()) {
      post({ action: "ensure_schema" }).catch(function () {});
      load();
    }
  });
})();
