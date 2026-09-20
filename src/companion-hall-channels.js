/**
 * Companion hall dual channel: 陪玩大厅 | 更多玩法
 * Services data: GET /api/platform/gameplay-products (same SoT as more-gameplays.html)
 * No mock catalog — empty API = empty UI.
 */
(function () {
  "use strict";

  var state = {
    channel: "companions",
    products: [],
    categories: [],
    keyword: "",
    category: "",
    sort: "recommend",
    loading: false,
    loaded: false,
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

  function filteredProducts() {
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
      ? '<div class="hall-gp-cover"><img src="' + esc(item.coverUrl) + '" alt=""></div>'
      : '<div class="hall-gp-cover hall-gp-cover--empty"><span>' + esc((item.category || "玩法").slice(0, 2)) + "</span></div>";
    return (
      '<a class="hall-gp-card" href="gameplay-product.html?id=' +
      encodeURIComponent(item.id) +
      '">' +
      cover +
      '<div class="hall-gp-body">' +
      "<strong>" +
      esc(item.name || "玩法商品") +
      "</strong>" +
      "<span>" +
      esc(item.shortDescription || item.category || "查看服务") +
      "</span>" +
      '<em><i>' +
      esc(priceText(item)) +
      "</i><b>查看服务 →</b></em>" +
      "</div></a>"
    );
  }

  function renderCats() {
    var box = document.getElementById("hallGpCats");
    if (!box) return;
    var cats = ["全部"].concat(state.categories || []);
    box.innerHTML = cats
      .map(function (cat) {
        var value = cat === "全部" ? "" : cat;
        var active = state.category === value ? " is-active" : "";
        return (
          '<button type="button" class="hall-gp-cat' +
          active +
          '" data-hall-gp-cat="' +
          esc(value) +
          '">' +
          esc(cat) +
          "</button>"
        );
      })
      .join("");
  }

  function renderServices() {
    var grid = document.getElementById("hallGpGrid");
    var empty = document.getElementById("hallGpEmpty");
    var count = document.getElementById("hallGpCount");
    if (!grid) return;

    if (state.loading) {
      grid.innerHTML = '<div class="hall-gp-loading">正在读取商城商品…</div>';
      if (empty) empty.hidden = true;
      if (count) count.textContent = "读取真实商城商品中…";
      return;
    }

    if (state.error) {
      grid.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        var title = empty.querySelector("strong");
        var hint = empty.querySelector("span");
        if (title) title.textContent = "玩法商品加载失败";
        if (hint) hint.textContent = state.error;
      }
      if (count) count.textContent = "加载失败";
      return;
    }

    var rows = filteredProducts();
    grid.innerHTML = rows.length ? rows.map(card).join("") : "";
    if (empty) {
      empty.hidden = rows.length > 0;
      if (!rows.length) {
        var t = empty.querySelector("strong");
        var h = empty.querySelector("span");
        if (t) t.textContent = state.products.length ? "暂无符合条件的玩法" : "暂无玩法商品";
        if (h) {
          h.textContent = state.products.length
            ? "试试调整搜索词或分类。"
            : "后台「更多玩法管理」发布后会显示在这里。";
        }
      }
    }
    if (count) count.textContent = "共 " + rows.length + " 个服务";
  }

  function loadProducts() {
    if (state.loading) return;
    state.loading = true;
    state.error = "";
    renderServices();
    fetch("/api/platform/gameplay-products", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error((body && body.message) || "商城读取失败");
          return body;
        });
      })
      .then(function (body) {
        state.products = (body && body.products) || [];
        state.categories = (body && body.categories) || [];
        state.error = "";
        state.loaded = true;
      })
      .catch(function (err) {
        state.products = [];
        state.categories = [];
        state.error = (err && err.message) || "商城读取失败";
        state.loaded = true;
      })
      .then(function () {
        state.loading = false;
        renderCats();
        renderServices();
      });
  }

  function setChannel(channel, opts) {
    opts = opts || {};
    var next = channel === "services" ? "services" : "companions";
    state.channel = next;

    var page = document.querySelector(".companion-hall-page");
    if (page) page.setAttribute("data-hall-channel", next);

    document.querySelectorAll("[data-hall-tab]").forEach(function (btn) {
      var on = btn.getAttribute("data-hall-tab") === next;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });

    document.querySelectorAll("[data-hall-panel]").forEach(function (panel) {
      var on = panel.getAttribute("data-hall-panel") === next;
      panel.classList.toggle("is-active", on);
      panel.hidden = !on;
    });

    document.querySelectorAll("[data-hall-search]").forEach(function (search) {
      var on = search.getAttribute("data-hall-search") === next;
      search.hidden = !on;
      if (!on) search.classList.remove("filters-open");
    });

    var tabs = document.querySelector(".hall-channel-tabs");
    if (tabs) tabs.setAttribute("data-active", next);

    var lead = document.getElementById("companionHallLead");
    if (lead) {
      lead.textContent =
        next === "services" ? "护航、跑刀、代练与趣味服务，选择需要的玩法。" : "找到喜欢的陪玩，立即开始游戏。";
    }

    document.body.classList.remove("hall-filter-lock");

    if (!opts.skipUrl) {
      try {
        var url = new URL(location.href);
        if (next === "companions") url.searchParams.delete("tab");
        else url.searchParams.set("tab", "services");
        history.replaceState(null, "", url.pathname + url.search + url.hash);
      } catch (e) {}
    }

    if (next === "services" && !state.loaded) loadProducts();
    else if (next === "services") renderServices();
  }

  function bind() {
    document.querySelectorAll("[data-hall-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setChannel(btn.getAttribute("data-hall-tab") || "companions");
      });
    });

    var search = document.getElementById("hallGpSearch");
    if (search) {
      search.addEventListener("input", function () {
        state.keyword = search.value || "";
        renderServices();
      });
    }
    var sort = document.getElementById("hallGpSort");
    if (sort) {
      sort.addEventListener("change", function () {
        state.sort = sort.value || "recommend";
        renderServices();
      });
    }
    document.addEventListener("click", function (e) {
      var cat = e.target.closest("[data-hall-gp-cat]");
      if (!cat) return;
      state.category = cat.getAttribute("data-hall-gp-cat") || "";
      renderCats();
      renderServices();
    });
  }

  function readInitialTab() {
    try {
      var q = new URLSearchParams(location.search).get("tab") || "";
      if (q === "services" || q === "more" || q === "gameplays") return "services";
      if (location.hash === "#services" || location.hash === "#more-gameplays") return "services";
    } catch (e) {}
    return "companions";
  }

  function init() {
    bind();
    setChannel(readInitialTab(), { skipUrl: false });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
