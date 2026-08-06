(function () {
  "use strict";

  function Auth() {
    return window.MCJAdminAuthFetch || null;
  }
  var TARGET_ID = "table-gameplays";
  var CATEGORIES = ["护航", "跑刀", "上分", "代练", "陪练", "语音", "娱乐", "其他"];
  var UNITS = ["每局", "每小时", "每单", "每次", "每天", "自定义"];
  var GAME_OPTIONS = ["无特定游戏", "三角洲行动", "Apex Legends", "英雄联盟", "Valorant", "王者荣耀", "PUBG", "CS2", "永劫无间", "其他游戏"];

  var state = {
    loading: true,
    saving: false,
    error: "",
    message: "",
    products: [],
    keyword: "",
    category: "",
    status: "",
    formOpen: false,
    editing: null,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function target() {
    return document.getElementById(TARGET_ID);
  }

  function apiGet() {
    var auth = Auth();
    if (auth && auth.get) return auth.get("/api/admin/gameplay-products");
    throw new Error("管理员登录态未就绪，请重新登录后台后再管理更多玩法商品。");
  }

  function apiPost(body) {
    var auth = Auth();
    if (auth && auth.post) return auth.post("/api/admin/gameplay-products", body);
    throw new Error("管理员登录态未就绪，请重新登录后台后再管理更多玩法商品。");
  }

  function formatTime(value) {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleString("zh-CN", { hour12: false });
    } catch (e) {
      return String(value);
    }
  }

  function statusLabel(status) {
    if (status === "published") return "上架";
    if (status === "draft") return "草稿";
    return "下架";
  }

  function priceText(item) {
    if (item.fixedPrice === false) return "咨询客服报价";
    return "🐱 " + Number(item.price || 0) + " 猫粮 / " + (item.pricingUnit || "每单");
  }

  function blank() {
    return {
      id: "",
      name: "",
      category: "护航",
      gameIds: ["无特定游戏"],
      gamesText: "无特定游戏",
      coverUrl: "",
      shortDescription: "",
      description: "服务内容：\n服务流程：\n注意事项：\n预计时长：",
      price: 30,
      pricingUnit: "每单",
      fixedPrice: true,
      status: "published",
      featured: false,
      soldCount: 0,
      sortOrder: (state.products.length + 1) * 10,
      dispatchToCs: true,
    };
  }

  function coverUploader(url) {
    return (
      '<div class="gp-cover-uploader" data-gp-cover>' +
        '<input type="hidden" name="coverUrl" value="' + esc(url || "") + '">' +
        (url
          ? '<div class="gp-cover-preview"><img src="' + esc(url) + '" alt="封面预览"><div class="gp-cover-actions"><button type="button" class="mini-btn" data-gp-cover-replace>替换</button><button type="button" class="mini-btn" data-gp-cover-remove>删除</button></div></div>'
          : '<button type="button" class="gp-cover-dropzone" data-gp-cover-pick><strong>拖拽或点击上传封面</strong><span>JPG / PNG / WEBP · 建议 1:1 或 4:3 · 最大 4MB</span></button>') +
        '<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-gp-cover-file>' +
      "</div>"
    );
  }

  function formTitle() {
    return state.editing && state.editing.id ? "编辑玩法商品" : "新增玩法商品";
  }
  function openFormOverlay() {
    if (!state.formOpen || !state.editing) return false;
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({
        title: formTitle(),
        html: formHtml(state.editing),
        onClose: function () {
          state.formOpen = false;
          state.editing = null;
        },
      });
      return true;
    }
    return false;
  }
  function closeFormOverlay() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
      return;
    }
    state.formOpen = false;
    state.editing = null;
    render();
  }
  function syncFormOverlay() {
    if (!state.formOpen || !state.editing || !window.MCJAdminOverlay) return;
    var html = formHtml(state.editing);
    if (window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) window.MCJAdminOverlay.setBody(html);
    else openFormOverlay();
  }
  function formHtml(row) {
    row = row || blank();
    var Forms = window.MCJAdminForms;
    var categoryField = Forms
      ? Forms.selectHtml({ name: "category", label: "商品分类", value: row.category || "护航", options: CATEGORIES })
      : "";
    var unitField = Forms
      ? Forms.selectHtml({ name: "pricingUnit", label: "计价单位", value: row.pricingUnit || "每单", options: UNITS })
      : "";
    var fixedSwitch = Forms
      ? Forms.switchHtml({ name: "fixedPrice", label: "是否固定价格", checked: row.fixedPrice !== false, onLabel: "固定价格", offLabel: "咨询报价" })
      : "";
    var statusSwitch = Forms
      ? Forms.switchHtml({ name: "status", label: "销售状态", checked: row.status !== "unpublished" && row.status !== "draft", onLabel: "上架", offLabel: "下架" })
      : "";
    var featuredSwitch = Forms
      ? Forms.switchHtml({ name: "featured", label: "首页推荐", checked: !!row.featured, onLabel: "推荐", offLabel: "不推荐" })
      : "";
    var gameSelected = Array.isArray(row.gameIds) ? row.gameIds : String(row.gamesText || "").split(/[,，、]/).filter(Boolean);
    var gameChecks = GAME_OPTIONS.map(function (game) {
      var checked = gameSelected.indexOf(game) > -1 ? " checked" : "";
      return '<label class="gp-check"><input type="checkbox" name="gameIds" value="' + esc(game) + '"' + checked + "><span>" + esc(game) + "</span></label>";
    }).join("");

    return (
      '<div class="gp-drawer" data-gp-drawer>' +
        '<form class="platform-content-form admin-self-form" data-gp-form>' +
          '<div class="coupon-editor-head"><div><h3>' + (row.id ? "编辑玩法商品" : "新增玩法商品") + '</h3><p>保存后同步老板端更多玩法商城；立即下单进入客服派单。</p></div>' +
            '<button class="btn" type="button" data-gp-cancel>关闭</button></div>' +
          '<div class="form-grid">' +
            '<label class="wide"><span>商品名称</span><input name="name" required maxlength="40" value="' + esc(row.name || "") + '" placeholder="例如：三角洲跑刀 / APEX 上分护航"></label>' +
            categoryField +
            unitField +
            '<label><span>售价（猫粮）</span><input name="price" type="number" min="0" step="0.01" value="' + esc(row.price || 0) + '"></label>' +
            '<label><span>商品抽成 %</span><input name="commissionRate" type="number" min="0" max="100" step="0.1" value="' + esc(row.commissionRate != null ? row.commissionRate : 0) + '" placeholder="平台抽成百分比"></label>' +
            '<label><span>排序</span><input name="sortOrder" type="number" value="' + esc(row.sortOrder || 100) + '"></label>' +
            '<label class="wide"><span>适用游戏（可多选）</span><div class="gp-check-grid">' + gameChecks + "</div></label>" +
            '<label class="wide"><span>商品封面</span>' + coverUploader(row.coverUrl || "") + "</label>" +
            '<label class="wide"><span>商品简介（40 字内）</span><input name="shortDescription" required maxlength="40" value="' + esc(row.shortDescription || "") + '" placeholder="用于商城卡片展示"></label>' +
            '<label class="wide"><span>商品详情</span><textarea name="description" rows="7" placeholder="服务内容 / 服务流程 / 注意事项 / 预计时长">' + esc(row.description || "") + "</textarea></label>" +
            '<div class="admin-service-switches wide">' + fixedSwitch + statusSwitch + featuredSwitch + "</div>" +
          "</div>" +
          '<div class="form-actions">' +
            '<button class="btn primary" type="submit" data-gp-save="publish"' + (state.saving ? " disabled" : "") + ">保存并上架</button>" +
            '<button class="btn" type="button" data-gp-save-draft>保存草稿</button>' +
            '<button class="btn" type="button" data-gp-cancel>取消</button>' +
          "</div>" +
        "</form>" +
      "</div>"
    );
  }

  function filtered() {
    var keyword = (state.keyword || "").trim().toLowerCase();
    return state.products.filter(function (item) {
      if (state.category && item.category !== state.category) return false;
      if (state.status === "published" && item.status !== "published") return false;
      if (state.status === "unpublished" && item.status === "published") return false;
      if (state.status === "draft" && item.status !== "draft") return false;
      if (!keyword) return true;
      return [item.name, item.category, item.gamesText, item.shortDescription].join(" ").toLowerCase().indexOf(keyword) > -1;
    });
  }

  function rowsHtml() {
    var rows = filtered();
    if (!rows.length) {
      return '<tr><td colspan="13"><div class="empty">暂无玩法商品。点击「新增玩法商品」创建商城商品。</div></td></tr>';
    }
    return rows.map(function (item) {
      var cover = item.coverUrl
        ? '<img class="gp-thumb" src="' + esc(item.coverUrl) + '" alt="">'
        : '<div class="gp-thumb gp-thumb-empty">无图</div>';
      return (
        "<tr>" +
          "<td>" + cover + "</td>" +
          "<td><strong>" + esc(item.name) + "</strong><small>" + esc(item.shortDescription || "") + "</small></td>" +
          "<td>" + esc(item.category || "-") + "</td>" +
          "<td>" + esc(item.gamesText || "-") + "</td>" +
          "<td>" + esc(priceText(item)) + "</td>" +
          "<td>" + esc(item.commissionRate != null ? item.commissionRate + "%" : "0%") + "</td>" +
          "<td>" + esc(item.pricingUnit || "-") + "</td>" +
          '<td><span class="status ' + (item.status === "published" ? "ok" : "wait") + '">' + esc(statusLabel(item.status)) + "</span></td>" +
          "<td>" + (item.featured ? "推荐" : "否") + "</td>" +
          "<td>" + esc(item.soldCount || 0) + "</td>" +
          "<td>" + esc(item.sortOrder || 100) + "</td>" +
          "<td>" + esc(formatTime(item.updatedAt)) + "</td>" +
          '<td><div class="content-row-actions compact">' +
            '<button class="mini-btn" type="button" data-gp-edit="' + esc(item.id) + '">编辑</button>' +
            (item.status === "published"
              ? '<button class="mini-btn" type="button" data-gp-unpublish="' + esc(item.id) + '">下架</button>'
              : '<button class="mini-btn primary-lite" type="button" data-gp-publish="' + esc(item.id) + '">上架</button>') +
            '<button class="mini-btn" type="button" data-gp-copy="' + esc(item.id) + '">复制</button>' +
            '<a class="mini-btn" href="/gameplay-product.html?id=' + encodeURIComponent(item.id) + '" target="_blank" rel="noopener">预览</a>' +
            '<button class="mini-btn danger-btn" type="button" data-gp-delete="' + esc(item.id) + '">删除</button>' +
          "</div></td>" +
        "</tr>"
      );
    }).join("");
  }

  function pageHtml() {
    if (state.loading) return '<div class="content-loading">正在读取更多玩法商品...</div>';
    var Forms = window.MCJAdminForms;
    var categoryFilter = Forms
      ? Forms.selectHtml({ name: "categoryFilter", label: "", value: state.category || "", options: [{ value: "", label: "全部分类" }].concat(CATEGORIES) })
      : '<select data-gp-filter-category><option value="">全部分类</option>' + CATEGORIES.map(function (c) { return '<option value="' + c + '"' + (state.category === c ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select>";
    var statusFilter = Forms
      ? Forms.selectHtml({
          name: "statusFilter",
          label: "",
          value: state.status || "",
          options: [
            { value: "", label: "全部状态" },
            { value: "published", label: "上架" },
            { value: "unpublished", label: "下架" },
            { value: "draft", label: "草稿" },
          ],
        })
      : "";

    return (
      '<div class="platform-content-admin base-data-admin" data-gp-admin>' +
        '<div class="content-admin-head"><div><h3>更多玩法商城管理</h3><p>管理老板端“更多玩法”商城中的服务商品、价格、库存状态及客服派单规则。</p></div>' +
          '<div class="content-version-meta"><span>' + esc(state.products.length) + " 个商品</span><span>" + esc(state.message || state.error || "保存后老板端立即同步") + "</span></div></div>" +
        '<div class="content-admin-toolbar compact">' +
          '<input data-gp-search placeholder="搜索商品名称" value="' + esc(state.keyword) + '">' +
          '<div data-gp-category-filter>' + categoryFilter + "</div>" +
          '<div data-gp-status-filter>' + statusFilter + "</div>" +
          '<button class="btn primary" type="button" data-gp-new>新增玩法商品</button>' +
          '<button class="btn" type="button" data-gp-reload>刷新</button>' +
        "</div>" +
        (!window.MCJAdminOverlay && state.formOpen ? formHtml(state.editing) : "") +
        '<div class="table-wrap"><table class="data-table"><thead><tr>' +
          "<th>封面</th><th>商品名称</th><th>分类</th><th>适用游戏</th><th>售价</th><th>抽成%</th><th>计价单位</th><th>销售状态</th><th>推荐</th><th>已售</th><th>排序</th><th>更新时间</th><th>操作</th>" +
        "</tr></thead><tbody>" + rowsHtml() + "</tbody></table></div>" +
      "</div>"
    );
  }

  function render() {
    var el = target();
    if (!el) return;
    el.innerHTML = pageHtml();
    if (window.MCJAdminForms && window.MCJAdminForms.enhance) window.MCJAdminForms.enhance(el);
    bindOnce();
    syncFilterWidgets();
    syncFormOverlay();
  }

  function syncFilterWidgets() {
    var cat = target() && target().querySelector('[data-gp-category-filter] select, [name="categoryFilter"]');
    if (cat) cat.value = state.category || "";
    var st = target() && target().querySelector('[data-gp-status-filter] select, [name="statusFilter"]');
    if (st) st.value = state.status || "";
  }

  function collect(form, forceStatus) {
    var fd = new FormData(form);
    var games = [];
    form.querySelectorAll('input[name="gameIds"]:checked').forEach(function (input) {
      games.push(input.value);
    });
    if (!games.length) games = ["无特定游戏"];
    var published = String(fd.get("status")) !== "false";
    var status = forceStatus || (published ? "published" : "unpublished");
    return {
      id: state.editing && state.editing.id ? state.editing.id : "",
      name: String(fd.get("name") || "").trim(),
      category: String(fd.get("category") || "其他").trim(),
      gameIds: games,
      gamesText: games.join("、"),
      coverUrl: String(fd.get("coverUrl") || "").trim(),
      shortDescription: String(fd.get("shortDescription") || "").trim().slice(0, 40),
      description: String(fd.get("description") || "").trim(),
      price: Number(fd.get("price") || 0),
      commissionRate: Number(fd.get("commissionRate") || 0),
      pricingUnit: String(fd.get("pricingUnit") || "每单").trim(),
      fixedPrice: String(fd.get("fixedPrice")) !== "false",
      status: status,
      featured: String(fd.get("featured")) === "true",
      sortOrder: Number(fd.get("sortOrder") || 100),
      dispatchToCs: true,
      soldCount: state.editing && state.editing.soldCount ? state.editing.soldCount : 0,
    };
  }

  function uploadCover(file, form) {
    if (!file) return Promise.reject(new Error("请选择图片"));
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return Promise.reject(new Error("仅支持 JPG / PNG / WEBP"));
    if (file.size > 4 * 1024 * 1024) return Promise.reject(new Error("图片不能超过 4MB"));
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var payload = {
          type: "gameplay_products",
          fileName: file.name,
          mimeType: file.type,
          base64: reader.result,
        };
        var auth = Auth();
        var req = auth && auth.post
          ? auth.post("/api/admin/platform-content-upload", payload)
          : Promise.reject(new Error("管理员登录态未就绪，请重新登录后台后再上传封面。"));
        req.then(function (body) {
          var url = body.url || reader.result;
          var hidden = form.querySelector('[name="coverUrl"]');
          if (hidden) hidden.value = url;
          if (state.editing) state.editing.coverUrl = url;
          render();
          resolve(url);
        }).catch(function (err) {
          // fallback to local data URL so admin can still preview/save
          var hidden = form.querySelector('[name="coverUrl"]');
          if (hidden) hidden.value = reader.result;
          if (state.editing) state.editing.coverUrl = reader.result;
          render();
          resolve(reader.result);
        });
      };
      reader.onerror = function () { reject(new Error("读取图片失败")); };
      reader.readAsDataURL(file);
    });
  }

  function load() {
    state.loading = true;
    render();
    return apiGet()
      .then(function (result) {
        state.products = result.products || [];
        if (Array.isArray(result.categories) && result.categories.length) CATEGORIES.splice(0, CATEGORIES.length, ...result.categories);
        if (Array.isArray(result.pricingUnits) && result.pricingUnits.length) UNITS.splice(0, UNITS.length, ...result.pricingUnits);
        state.message = result.message || "已加载商品";
        state.error = "";
      })
      .catch(function (err) {
        state.products = [];
        state.error = err.message || "读取失败";
      })
      .finally(function () {
        state.loading = false;
        render();
      });
  }

  function save(form, status) {
    var payload = collect(form, status);
    if (!payload.name) return alert("请填写商品名称");
    if (!payload.shortDescription) return alert("请填写商品简介");
    state.saving = true;
    render();
    apiPost({ action: "save", id: payload.id, product: payload })
      .then(function () {
        state.saving = false;
        if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
          window.MCJAdminOverlay.close();
        } else {
          state.formOpen = false;
          state.editing = null;
        }
        return load();
      })
      .catch(function (err) {
        state.saving = false;
        render();
        alert(err.message || "保存失败");
      });
  }

  function bindOnce() {
    var el = target();
    if (!el || el.dataset.gpBound === "1") return;
    el.dataset.gpBound = "1";

    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-gp-new]")) {
        state.editing = blank();
        state.formOpen = true;
        if (!openFormOverlay()) render();
        return;
      }
      if (e.target.closest("[data-gp-cancel]")) {
        closeFormOverlay();
        return;
      }
      if (e.target.closest("[data-gp-reload]")) {
        load();
        return;
      }
      if (e.target.closest("[data-gp-save-draft]")) {
        var draftForm = el.querySelector("[data-gp-form]");
        if (draftForm) save(draftForm, "draft");
        return;
      }
      var edit = e.target.closest("[data-gp-edit]");
      if (edit) {
        state.editing = state.products.find(function (item) { return String(item.id) === String(edit.getAttribute("data-gp-edit")); }) || blank();
        state.formOpen = true;
        if (!openFormOverlay()) render();
        return;
      }
      var pub = e.target.closest("[data-gp-publish]");
      if (pub) {
        apiPost({ action: "publish", id: pub.getAttribute("data-gp-publish") }).then(load).catch(function (err) { alert(err.message); });
        return;
      }
      var un = e.target.closest("[data-gp-unpublish]");
      if (un) {
        apiPost({ action: "unpublish", id: un.getAttribute("data-gp-unpublish") }).then(load).catch(function (err) { alert(err.message); });
        return;
      }
      var copy = e.target.closest("[data-gp-copy]");
      if (copy) {
        apiPost({ action: "duplicate", id: copy.getAttribute("data-gp-copy") }).then(load).catch(function (err) { alert(err.message); });
        return;
      }
      var del = e.target.closest("[data-gp-delete]");
      if (del) {
        if (!confirm("确认删除该商品？已产生历史订单的商品将软删除（仅下架保留记录）。")) return;
        apiPost({ action: "delete", id: del.getAttribute("data-gp-delete") }).then(load).catch(function (err) { alert(err.message); });
        return;
      }
      if (e.target.closest("[data-gp-cover-pick], [data-gp-cover-replace]")) {
        var fileInput = el.querySelector("[data-gp-cover-file]");
        if (fileInput) fileInput.click();
        return;
      }
      if (e.target.closest("[data-gp-cover-remove]")) {
        if (state.editing) state.editing.coverUrl = "";
        var hidden = el.querySelector('[name="coverUrl"]');
        if (hidden) hidden.value = "";
        render();
      }
    });

    el.addEventListener("submit", function (e) {
      var form = e.target.closest("[data-gp-form]");
      if (!form) return;
      e.preventDefault();
      save(form, "published");
    });

    el.addEventListener("change", function (e) {
      if (e.target.matches("[data-gp-cover-file]")) {
        var form = e.target.closest("[data-gp-form]");
        var file = e.target.files && e.target.files[0];
        if (!form || !file) return;
        uploadCover(file, form).catch(function (err) { alert(err.message || "上传失败"); });
        return;
      }
      if (e.target.matches('[name="categoryFilter"]') || e.target.closest("[data-gp-category-filter]")) {
        var cat = el.querySelector('[name="categoryFilter"]');
        state.category = cat ? cat.value : "";
        render();
        return;
      }
      if (e.target.matches('[name="statusFilter"]') || e.target.closest("[data-gp-status-filter]")) {
        var st = el.querySelector('[name="statusFilter"]');
        state.status = st ? st.value : "";
        render();
      }
    });

    el.addEventListener("input", function (e) {
      if (e.target.matches("[data-gp-search]")) {
        state.keyword = e.target.value || "";
        // debounce light: re-render rows only via full render
        clearTimeout(el._gpSearchTimer);
        el._gpSearchTimer = setTimeout(function () { render(); }, 180);
      }
    });

    el.addEventListener("dragover", function (e) {
      if (!e.target.closest("[data-gp-cover]")) return;
      e.preventDefault();
    });
    el.addEventListener("drop", function (e) {
      var zone = e.target.closest("[data-gp-cover]");
      if (!zone) return;
      e.preventDefault();
      var form = zone.closest("[data-gp-form]");
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!form || !file) return;
      uploadCover(file, form).catch(function (err) { alert(err.message || "上传失败"); });
    });
  }

  function boot() {
    if (!target()) return;
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJAdminGameplayMall = { reload: load };
})();
