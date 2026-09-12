import fs from "fs";

const path = "src/boss-header.js";
let t = fs.readFileSync(path, "utf8");

// Replace headerHtml completely
const start = t.indexOf("  function headerHtml()");
const end = t.indexOf("  function findExistingHeader()");
if (start < 0 || end < 0) throw new Error("headerHtml bounds missing");

const next = `  function headerHtml() {
    return (
      '<div class="mcj-boss-header-inner header-inner">' +
      '<nav class="header-nav mcj-boss-nav mcj-boss-nav-primary" aria-label="主导航">' +
      navLink("index.html", "首页") +
      navLink("companion-center.html", "大厅") +
      navLink("orders.html", "订单") +
      navLink("support.html?start=1", "客服") +
      "</nav>" +
      "</div>"
    );
  }

`;

t = t.slice(0, start) + next + t.slice(end);

// Simplify applyAuthVisibility — no more/login chrome
const authStart = t.indexOf("  function applyAuthVisibility()");
const authEnd = t.indexOf("  function scheduleAuthVisibility()");
if (authStart < 0 || authEnd < 0) throw new Error("applyAuthVisibility bounds missing");

t =
  t.slice(0, authStart) +
  `  function applyAuthVisibility() {
    if (!document.body) return;
    var logged = isLoggedIn();
    document.body.classList.toggle("is-logged-in", logged);
    document.body.classList.toggle("is-guest", !logged);
    document.body.setAttribute("data-mcj-auth", logged ? "in" : "out");

    var header = document.querySelector("header.mcj-boss-header");
    if (!header) return;
    header.setAttribute("data-mcj-auth", logged ? "in" : "out");
    header.classList.toggle("is-logged-in", logged);
    header.classList.toggle("is-guest", !logged);
    header.classList.add("mcj-tab-nav-only");

    // Remove any leftover brand / menu / favorite nodes injected by other scripts
    header.querySelectorAll(
      ".mcj-boss-brand, .brand, .mcj-boss-more, .mcj-boss-user, .top-actions, .live2d-avatar, [data-mcj-nav-more], [data-favorite], [data-mcj-favorite]"
    ).forEach(function (el) {
      el.remove();
    });

    // Ensure exactly 4 nav links with short labels
    var nav = header.querySelector("nav.mcj-boss-nav, nav.header-nav");
    if (nav) {
      var wanted = [
        ["index.html", "首页"],
        ["companion-center.html", "大厅"],
        ["orders.html", "订单"],
        ["support.html?start=1", "客服"],
      ];
      var links = Array.prototype.slice.call(nav.querySelectorAll("a"));
      if (links.length !== 4 || /我的订单|在线客服|妙脆角/.test(nav.textContent || "")) {
        nav.innerHTML = wanted
          .map(function (item) {
            return navLink(item[0], item[1]);
          })
          .join("");
      } else {
        links.forEach(function (a, i) {
          if (wanted[i]) {
            a.setAttribute("href", wanted[i][0]);
            a.textContent = wanted[i][1];
            a.classList.toggle("active", !!activeHref(wanted[i][0]));
          }
        });
      }
    }
  }

` +
  t.slice(authEnd);

t = t.replace(
  /ensureCss\("\/src\/boss-header\.css[^"]*",\s*"data-mcj-boss-header-css"\);/,
  'ensureCss("/src/boss-header.css?v=20260802tabNav4", "data-mcj-boss-header-css");'
);
t = t.replace(
  /ensureCss\("\/src\/mcj-safe-area\.css[^"]*",\s*"data-mcj-safe-area-css"\);/,
  'ensureCss("/src/mcj-safe-area.css?v=20260802tabNav4", "data-mcj-safe-area-css");'
);

// Force remount flag so old cached DOM is replaced
t = t.replace(
  "function mount() {\n    if (!isBossPublicPage() || !document.body) return;",
  `function mount() {
    if (!isBossPublicPage() || !document.body) return;
    // Always rebuild header markup for tab-nav-only layout`
);

fs.writeFileSync(path, t);
console.log("boss-header.js rewritten", {
  has订单: t.includes('navLink("orders.html", "订单")'),
  has客服: t.includes('navLink("support.html?start=1", "客服")'),
  noBrand: !t.includes("妙脆角首页"),
  noMore: !t.includes("mcj-boss-more-toggle"),
  cssVer: t.includes("20260802tabNav4"),
});
