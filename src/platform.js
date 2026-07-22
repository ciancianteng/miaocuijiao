function $(q, r) { return (r || document).querySelector(q); }
function $$(q, r) { return Array.prototype.slice.call((r || document).querySelectorAll(q)); }

function toast(text) {
  var t = document.createElement("div");
  t.textContent = text;
  t.style.cssText = "position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:200;background:rgba(20,14,24,.95);border:1px solid rgba(239,171,201,.35);border-radius:999px;padding:12px 18px;color:#fff5fa;box-shadow:0 0 24px rgba(239,171,201,.16);font-weight:900";
  document.body.appendChild(t);
  setTimeout(function() { t.remove(); }, 1800);
}

function openModal(html) {
  var m = $("#modal");
  var b = $("#modalBody");
  if (!m || !b) return;
  b.innerHTML = html;
  m.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  var m = $("#modal");
  if (!m) return;
  m.classList.remove("open");
  document.body.style.overflow = "";
}

function readText(el, selector, fallback) {
  var node = selector ? el.querySelector(selector) : el;
  return ((node && node.textContent) || fallback || "").trim();
}

function htmlSafe(text) {
  return String(text || "").replace(/[&<>"']/g, function(ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function collectCompanionData(button) {
  var card = button.closest("[data-player],.companion-card,.player-card,.hot-card") || button.closest("article") || document;
  var img = card.querySelector("img");
  var tagNodes = $$(".tag-row span,.mini-tags span", card);
  var tags = tagNodes.map(function(x) { return readText(x); }).filter(Boolean);
  var muted = readText(card, ".muted", "VALORANT");
  return {
    name: card.dataset.name || readText(card, "h3", "MOMO"),
    game: readText(card, ".game-line", "") || muted.split("·")[0].trim(),
    price: readText(card, ".price", "RM12/h"),
    rating: readText(card, ".rating", "5.0"),
    orders: readText(card, ".order-line", "24h: 36"),
    status: card.dataset.online || readText(card, ".status", "online"),
    img: img ? img.getAttribute("src") : "assets/meow-cuijiao-brand.jpg",
    tags: tags.length ? tags : ["voice", "chat", "easy"],
    desc: "Meow Cui Jiao verified companion. Stable service, friendly communication, game or chat service can be arranged."
  };
}

function companionDetailHtml(data) {
  var tags = data.tags.map(function(t) {
    return "<span>" + htmlSafe(t) + "</span>";
  }).join("");
  return '<div class="companion-detail-modal">' +
    '<div class="detail-cover"><img src="' + htmlSafe(data.img) + '" alt="' + htmlSafe(data.name) + '"><span class="detail-status">' + htmlSafe(data.status) + '</span></div>' +
    '<div class="detail-body"><h2>' + htmlSafe(data.name) + '</h2>' +
    '<p class="detail-meta">' + htmlSafe(data.game) + ' · ' + htmlSafe(data.rating) + ' · ' + htmlSafe(data.price) + '</p>' +
    '<p class="detail-desc">' + htmlSafe(data.desc) + '</p>' +
    '<div class="detail-grid">' +
    '<div class="detail-chip"><span>&#36817;24&#23567;&#26102;</span><strong>' + htmlSafe(data.orders.replace("近24小时下单：", "")) + '</strong></div>' +
    '<div class="detail-chip"><span>&#21487;&#26381;&#21153;&#26102;&#38388;</span><strong>24H &#21487;&#39044;&#32422;</strong></div>' +
    '<div class="detail-chip"><span>&#26381;&#21153;&#26041;&#24335;</span><strong>&#35821;&#38899; / &#25991;&#23383;</strong></div>' +
    '<div class="detail-chip"><span>&#22312;&#32447;&#29366;&#24577;</span><strong>' + htmlSafe(data.status) + '</strong></div>' +
    '</div><div class="detail-tags">' + tags + '</div>' +
    '<button class="confirm-order" data-confirm-order data-companion="' + htmlSafe(data.name) + '">&#30830;&#35748;&#19979;&#21333;</button>' +
    '</div></div>';
}

function openCompanionOrder(button) {
  openModal(companionDetailHtml(collectCompanionData(button)));
}

document.addEventListener("click", function(e) {
  if (e.target.matches("[data-close]") || e.target.id === "modal") {
    closeModal();
    return;
  }

  var detailBtn = e.target.closest("[data-detail],[data-book]");
  if (detailBtn) {
    e.preventDefault();
    openCompanionOrder(detailBtn);
    return;
  }

  var confirm = e.target.closest("[data-confirm-order]");
  if (confirm) {
    e.preventDefault();
    location.href = "checkin.html?companion=" + encodeURIComponent(confirm.dataset.companion || "");
    return;
  }

  if (e.target.closest("[data-review]")) {
    openModal('<h2>&#35746;&#21333;&#35780;&#20215;</h2><div class="grid"><label class="field"><span>&#24635;&#35780;&#20998;</span><select><option>5</option><option>4</option></select></label><label class="field"><span>&#25991;&#23383;&#35780;&#20215;</span><textarea placeholder="Review"></textarea></label><button class="btn primary" data-close>&#25552;&#20132;&#35780;&#20215;</button></div>');
    return;
  }

  var gift = e.target.closest("[data-gift]");
  if (gift) {
    var name = gift.dataset.gift;
    var arr = JSON.parse(localStorage.getItem("mcjGiftSpend") || "[]");
    arr.unshift({ name: name, time: new Date().toLocaleString() });
    localStorage.setItem("mcjGiftSpend", JSON.stringify(arr));
    toast("Gift sent: " + name);
    return;
  }

  var copy = e.target.closest("[data-copy]");
  if (copy) {
    if (navigator.clipboard) navigator.clipboard.writeText(copy.dataset.copy);
    toast("Copied");
  }
});

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") closeModal();
});

function runCompanionSearch() {
  var list = $("#playerList");
  if (!list) return;
  var cards = $$("[data-player]", list);
  var empty = $("#emptyState");
  var count = $("#resultCount");

  function val(id) {
    var el = $("#" + id);
    return el ? el.value : "";
  }

  function apply() {
    var q = val("searchInput").trim().toLowerCase();
    var game = val("gameFilter");
    var price = val("priceFilter");
    var online = val("onlineFilter");
    var score = Number(val("scoreFilter") || 0);
    var gender = val("genderFilter");
    var shown = 0;

    cards.forEach(function(c) {
      var hay = (c.dataset.name + " " + c.dataset.game + " " + c.dataset.tags).toLowerCase();
      var ok = !q || hay.indexOf(q) > -1;
      if (game) ok = ok && c.dataset.game.indexOf(game) > -1;
      if (price) {
        var p = Number(c.dataset.price);
        var r = price.split("-").map(Number);
        ok = ok && p >= r[0] && p <= r[1];
      }
      if (online) ok = ok && c.dataset.online === online;
      if (score) ok = ok && Number(c.dataset.score) >= score;
      if (gender) ok = ok && c.dataset.gender === gender;
      c.style.display = ok ? "" : "none";
      if (ok) shown++;
    });

    if (empty) empty.style.display = shown ? "none" : "block";
    if (count) count.textContent = shown ? "共 " + shown + " 位陪玩" : "喵～没有找到合适的陪玩";
  }

  ["searchInput", "gameFilter", "priceFilter", "onlineFilter", "scoreFilter", "genderFilter"].forEach(function(id) {
    var el = $("#" + id);
    if (!el) return;
    el.addEventListener("input", apply);
    el.addEventListener("change", apply);
  });

  apply();
}

runCompanionSearch();

var check = $("#checkinBtn");
if (check) {
  check.addEventListener("click", function() {
    check.textContent = "Signed";
    check.disabled = true;
    toast("Check-in success");
  });
}
