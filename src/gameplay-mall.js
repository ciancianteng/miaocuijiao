(function () {
  "use strict";

  var state = {
    products: [],
    categories: [],
    services: [],
    keyword: "",
    category: "",
    sort: "recommend",
    loading: true,
    error: "",
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function priceText(item) {
    if (item.fixedPrice === false) return "咨询客服报价";
    if (window.MCJCurrency) return window.MCJCurrency.formatRate(item.price || 0, item.pricingUnit || "每单");
    return Number(item.price || 0) + " 猫粮 / " + (item.pricingUnit || "每单");
  }

  function filtered() {
    var keyword = state.keyword.trim().toLowerCase();
    var rows = state.products.filter(function (item) {
      if (state.category && item.category !== state.category) return false;
      if (!keyword) return true;
      return [item.name, item.shortDescription, item.gamesText, item.category].join(" ").toLowerCase().indexOf(keyword) > -1;
    });
    rows.sort(function (a, b) {
      if (state.sort === "sold") return Number(b.soldCount || 0) - Number(a.soldCount || 0);
      if (state.sort === "priceAsc") return Number(a.price || 0) - Number(b.price || 0);
      if (state.sort === "priceDesc") return Number(b.price || 0) - Number(a.price || 0);
      if (state.sort === "newest") return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      return Number(b.featured) - Number(a.featured) || Number(a.sortOrder || 100) - Number(b.sortOrder || 100);
    });
    return rows;
  }

  function card(item) {
    var cover = item.coverUrl
      ? '<div class="gp-card-cover"><img src="' + esc(item.coverUrl) + '" alt="' + esc(item.name) + '"></div>'
      : '<div class="gp-card-cover"><div class="gp-card-cover-empty">MEOW</div></div>';
    return (
      '<a class="gp-card" href="gameplay-product.html?id=' + encodeURIComponent(item.id) + '">' +
        (item.featured ? '<span class="gp-badge">推荐</span>' : "") +
        cover +
        '<div class="gp-card-body">' +
          "<h2>" + esc(item.name) + "</h2>" +
          "<p>" + esc(item.shortDescription || item.category || "") + "</p>" +
          '<div class="gp-card-meta"><span class="gp-price">' + esc(priceText(item)) + '</span><span class="gp-sold">已售 ' + esc(item.soldCount || 0) + "</span></div>" +
          '<span class="gp-card-btn">查看详情</span>' +
        "</div>" +
      "</a>"
    );
  }

  function renderServiceStrip() {
    var head = document.querySelector(".gp-mall-head > div");
    if (!head) return;
    var existing = document.getElementById("gpServiceStrip");
    if (existing) existing.remove();
    if (!state.services.length) return;
    var strip = document.createElement("div");
    strip.id = "gpServiceStrip";
    strip.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-top:10px";
    strip.innerHTML = state.services
      .map(function (item) {
        var label = (item.icon ? item.icon + " " : "") + (item.name || "");
        var price = item.defaultPrice || item.default_price || "";
        return (
          '<a href="custom-order.html?service=' +
          encodeURIComponent(item.name || "") +
          '" style="display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:0 12px;border-radius:999px;border:1px solid rgba(243,168,203,.28);background:rgba(243,168,203,.10);color:#ffe7f2;text-decoration:none;font-size:12px;font-weight:800">' +
          esc(label) +
          (price ? '<small style="opacity:.78">' + esc(price) + "</small>" : "") +
          "</a>"
        );
      })
      .join("");
    head.appendChild(strip);
  }

  function renderCats() {
    var box = document.getElementById("gpCats");
    if (!box) return;
    var cats = ["全部"].concat(state.categories);
    box.innerHTML = cats.map(function (cat) {
      var value = cat === "全部" ? "" : cat;
      var active = state.category === value ? " active" : "";
      return '<button type="button" class="gp-cat' + active + '" data-gp-cat="' + esc(value) + '">' + esc(cat) + "</button>";
    }).join("");
  }

  function renderGrid() {
    var box = document.getElementById("gpGrid");
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="gp-empty">正在读取商城商品...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML = '<div class="gp-empty">' + esc(state.error) + "</div>";
      return;
    }
    var rows = filtered();
    box.innerHTML = rows.length ? rows.map(card).join("") : '<div class="gp-empty">暂无玩法商品</div>';
  }

  function withTimeout(promise, ms, fallback) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve(fallback);
      }, ms);
      Promise.resolve(promise)
        .then(function (value) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(value);
        })
        .catch(function (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(fallback === undefined ? Promise.reject(err) : fallback);
        });
    });
  }

  function load() {
    state.loading = true;
    state.error = "";
    renderGrid();
    var productsReq = fetch("/api/platform/gameplay-products", { headers: { Accept: "application/json" }, cache: "no-store" }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "商城读取失败");
        return body;
      });
    });
    var servicesReq = fetch("/api/platform/services?scope=gameplay", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (res) {
        return res.json().catch(function () {
          return { services: [] };
        });
      })
      .catch(function () {
        return { services: [] };
      });

    withTimeout(productsReq, 12000, { __timeout: true })
      .then(function (body) {
        if (body && body.__timeout) throw new Error("商城读取超时，请刷新重试");
        state.products = (body && body.products) || [];
        state.categories = (body && body.categories) || [];
        state.error = "";
        return withTimeout(servicesReq, 4000, { services: [] });
      })
      .then(function (serviceBody) {
        state.services = (serviceBody && serviceBody.services) || [];
      })
      .catch(function (err) {
        state.products = [];
        state.services = [];
        state.error = err.message || "商城读取失败";
      })
      .then(function () {
        state.loading = false;
        renderServiceStrip();
        renderCats();
        renderGrid();
      });
  }

  document.addEventListener("click", function (e) {
    var cat = e.target.closest("[data-gp-cat]");
    if (!cat) return;
    state.category = cat.getAttribute("data-gp-cat") || "";
    renderCats();
    renderGrid();
  });

  var search = document.getElementById("gpSearch");
  if (search) {
    search.addEventListener("input", function () {
      state.keyword = search.value || "";
      renderGrid();
    });
  }
  var sort = document.getElementById("gpSort");
  if (sort) {
    sort.addEventListener("change", function () {
      state.sort = sort.value || "recommend";
      renderGrid();
    });
  }

  load();
})();
