(function () {
  "use strict";
  /**
   * Admin gift catalog management.
   * Root cause fix for “无法编辑”:
   * - Production used prompt()/confirm() (blocked in many PWA/WebViews)
   * - Edit button embedded full JSON in HTML attributes (breaks on quotes)
   * Now: modal form + edit by gift id lookup.
   */
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "giftManagement";
  var state = {
    loading: true,
    gifts: [],
    error: "",
    message: "",
    editing: null,
    iconPreview: "",
    iconDataUrl: "",
    saving: false,
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
  function post(body) {
    return api("/api/admin/gifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  function target() {
    return document.getElementById(TARGET);
  }
  function toast(msg, isErr) {
    state.message = String(msg || "");
    state.error = isErr ? state.message : "";
    paint();
  }
  function blankGift() {
    return {
      id: "",
      name: "",
      iconUrl: "",
      catFoodPrice: 10,
      enabled: true,
      featured: false,
      sortOrder: 100,
      animationLevel: "normal",
    };
  }
  function findGift(id) {
    return (state.gifts || []).find(function (g) {
      return String(g.id) === String(id);
    });
  }
  function closeOverlay() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
    }
    var lb = document.getElementById("adminGiftLightbox");
    if (lb) lb.remove();
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
      '<button type="submit" class="mini-btn primary-lite" data-gift-submit' +
      (state.saving ? " disabled" : "") +
      ">" +
      (state.saving ? "保存中…" : "保存") +
      "</button></div></form>"
    );
  }
  function bindForm(gift) {
    var root =
      (window.MCJAdminOverlay && window.MCJAdminOverlay.getBody && window.MCJAdminOverlay.getBody()) ||
      document.getElementById("adminGiftLightbox") ||
      document;
    var form = root.querySelector("[data-gift-form]");
    if (!form) return;
    var drop = form.querySelector("[data-gift-icon-drop]");
    var fileInput = form.querySelector("[data-gift-icon-file]");
    function acceptIcon(file) {
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
        alert("仅支持 JPG / PNG / WEBP");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert("图片不能超过 5MB");
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
        enabled: !!(form.querySelector('[name="enabled"]') || {}).checked,
        featured: !!(form.querySelector('[name="featured"]') || {}).checked,
        iconUrl: (gift && gift.iconUrl) || "",
      };
      if (!payload.name || !(payload.catFoodPrice > 0)) {
        alert("请填写礼物名称和有效价格");
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
          state.saving = false;
          state.editing = null;
          state.iconPreview = "";
          state.iconDataUrl = "";
          closeOverlay();
          state.message = res.message || "礼物已保存";
          load();
        })
        .catch(function (err) {
          state.saving = false;
          openEditor(gift, true);
          alert(err.message || "保存失败");
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
      '</h3><button type="button" class="mini-btn" data-gift-cancel>×</button></div>' +
      html +
      "</div>";
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) {
        state.editing = null;
        closeOverlay();
      }
    });
    document.body.appendChild(overlay);
    setTimeout(function () {
      bindForm(state.editing);
    }, 0);
  }
  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取礼物...</div>';
      return;
    }
    if (state.error && !state.gifts.length) {
      box.innerHTML =
        '<div class="admin-sync-note">' + esc(state.error) + ' <button class="mini-btn" data-gift-reload>重试</button></div>';
      return;
    }
    var rows = (state.gifts || [])
      .map(function (g) {
        return (
          "<tr><td>" +
          (g.iconUrl
            ? '<img src="' + esc(g.iconUrl) + '" alt="" style="width:36px;height:36px;border-radius:8px;object-fit:cover;vertical-align:middle;margin-right:8px">'
            : "") +
          esc(g.name) +
          "</td><td>" +
          esc(g.catFoodPrice) +
          "</td><td>" +
          (g.enabled ? "启用" : "停用") +
          "</td><td>" +
          (g.featured ? "是" : "否") +
          "</td><td>" +
          esc(g.sortOrder) +
          "</td><td>" +
          '<button class="mini-btn" type="button" data-gift-edit="' +
          esc(g.id) +
          '">编辑</button> ' +
          '<button class="mini-btn" type="button" data-gift-del="' +
          esc(g.id) +
          '">下架</button></td></tr>'
        );
      })
      .join("");
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>礼物管理</h3><p>配置老板端礼物商城。修改后全站同步。已产生订单的礼物请下架（soft disable），勿物理删除。</p></div>' +
      '<button class="mini-btn primary-lite" type="button" data-gift-new>新增礼物</button> <button class="mini-btn" type="button" data-gift-reload>刷新</button></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="table-wrap"><table><thead><tr><th>名称</th><th>猫粮价格</th><th>状态</th><th>推荐</th><th>排序</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">暂无礼物</td></tr>') +
      "</tbody></table></div>" +
      '<div style="margin-top:12px"><button class="mini-btn" type="button" data-gift-commission>设置默认礼物抽成 %</button></div>';
  }
  function load() {
    state.loading = true;
    paint();
    api("/api/admin/gifts")
      .then(function (res) {
        state.gifts = res.gifts || [];
        state.loading = false;
        state.error = "";
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message;
        paint();
      });
  }
  document.addEventListener("click", function (e) {
    if (!target() || !target().contains(e.target)) return;
    if (e.target.closest("[data-gift-reload]")) return load();
    if (e.target.closest("[data-gift-new]")) return openEditor(blankGift());
    var edit = e.target.closest("[data-gift-edit]");
    if (edit) {
      var id = edit.getAttribute("data-gift-edit");
      var gift = findGift(id);
      if (!gift) {
        alert("礼物不存在，请刷新后重试");
        return;
      }
      openEditor(gift);
      return;
    }
    var del = e.target.closest("[data-gift-del]");
    if (del && confirm("确认下架该礼物？（不会物理删除历史订单）")) {
      post({ action: "soft_delete", id: del.dataset.giftDel })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    if (e.target.closest("[data-gift-commission]")) {
      var rate = prompt("默认礼物抽成 %", "20");
      if (rate == null) return;
      post({ action: "save_commission", commissionRate: rate })
        .then(function (res) {
          alert(res.message || "已保存");
        })
        .catch(function (err) {
          alert(err.message);
        });
    }
  });
  document.addEventListener("DOMContentLoaded", function () {
    if (target()) load();
  });
})();
