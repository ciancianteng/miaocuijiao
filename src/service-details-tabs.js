/**
 * Service detail display.
 * Boss order window: two collapsed headings, 服务内容 and 服务要求.
 * Companion 我的服务: 服务要求 only, collapsed until tapped.
 * Display only. Does not change prices, orders, or saved text.
 */
function escHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function splitLines(text) {
  var raw = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!raw.trim()) return [];
  if (raw.indexOf("\n") === -1) return [{ title: "", body: raw.trim() }];
  return raw.split("\n").map(function (line) {
    var textLine = String(line || "").replace(/^\s+|\s+$/g, "");
    if (!textLine) return null;
    var labeled = textLine.match(/^([^：:]{1,12})[：:]\s*(\S[\s\S]*)$/);
    if (labeled && !/[。！？]/.test(labeled[1])) {
      return { title: labeled[1], body: labeled[2] };
    }
    return { title: "", body: textLine };
  }).filter(Boolean);
}

function asItems(value) {
  if (Array.isArray(value)) {
    return value.map(function (item) {
      if (!item) return null;
      var title = String(item.title || item.label || "").trim();
      var body = String(item.body || item.value || "").trim();
      if (!title && !body) return null;
      return { title: title, body: body || title, titled: !!title && !!body && body !== title };
    }).filter(Boolean);
  }
  return splitLines(value).map(function (item) {
    return { title: item.title, body: item.body, titled: !!item.title };
  });
}

function itemsHtml(items, emptyLabel) {
  if (!items.length) return '<p class="sdt-empty">' + escHtml(emptyLabel) + "</p>";
  return items.map(function (item) {
    return '<div class="sdt-item">' +
      (item.titled ? "<strong>" + escHtml(item.title) + "</strong>" : "") +
      "<p>" + escHtml(item.body) + "</p></div>";
  }).join("");
}

function accordionHtml(key, label, open, items, emptyLabel) {
  return '<div class="sdt-acc">' +
    '<button type="button" class="sdt-acc-btn" data-sdt-acc="' + key + '" aria-expanded="' + (open ? "true" : "false") + '">' +
    "<span>" + escHtml(label) + '</span><i aria-hidden="true"></i></button>' +
    (open ? '<div class="sdt-acc-panel">' + itemsHtml(items, emptyLabel) + "</div>" : "") +
    "</div>";
}

function renderServiceDetails(opts) {
  opts = opts || {};
  var layout = opts.layout === "requirements" ? "requirements" : "boss";
  var contentOpen = !!opts.contentOpen;
  var requirementsOpen = !!opts.requirementsOpen;
  var contentItems = asItems(opts.content).concat(asItems(opts.extraContent));
  var requirementItems = asItems(opts.requirements).concat(asItems(opts.extraRequirements));
  function pack(value) {
    return encodeURIComponent(JSON.stringify(value == null ? "" : value));
  }
  var blocks = layout === "requirements"
    ? accordionHtml("requirements", "服务要求", requirementsOpen, requirementItems, "暂无服务要求")
    : accordionHtml("content", "服务内容", contentOpen, contentItems, "暂无服务内容") +
      accordionHtml("requirements", "服务要求", requirementsOpen, requirementItems, "暂无服务要求");
  return '<div class="sdt-root" data-sdt-root data-sdt-layout="' + layout + '" data-sdt-content-open="' + (contentOpen ? "1" : "0") + '" data-sdt-requirements-open="' + (requirementsOpen ? "1" : "0") + '" data-sdt-content="' + pack(layout === "requirements" ? "" : (opts.content || "")) + '" data-sdt-requirements="' + pack(opts.requirements || "") + '" data-sdt-extra-content="' + pack(layout === "requirements" ? [] : (opts.extraContent || [])) + '" data-sdt-extra-requirements="' + pack(opts.extraRequirements || []) + '">' +
    blocks + "</div>";
}

function readServiceDetails(root) {
  function unpack(name, fallback) {
    try {
      var parsed = JSON.parse(decodeURIComponent(root.getAttribute(name) || ""));
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }
  return {
    layout: root.getAttribute("data-sdt-layout") === "requirements" ? "requirements" : "boss",
    contentOpen: root.getAttribute("data-sdt-content-open") === "1",
    requirementsOpen: root.getAttribute("data-sdt-requirements-open") === "1",
    content: unpack("data-sdt-content", ""),
    requirements: unpack("data-sdt-requirements", ""),
    extraContent: unpack("data-sdt-extra-content", []),
    extraRequirements: unpack("data-sdt-extra-requirements", []),
  };
}

function installServiceDetailsCss() {
  if (typeof document === "undefined" || document.getElementById("mcj-sdt-css")) return;
  var style = document.createElement("style");
  style.id = "mcj-sdt-css";
  style.textContent = [
    ".sdt-root{display:grid;gap:0;min-width:0;max-width:100%}",
    ".sdt-acc{min-width:0;border-top:1px solid rgba(255,255,255,.08)}",
    ".sdt-acc-btn{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:42px;padding:8px 0;border:0;background:transparent;color:#fff;font-size:14px;font-weight:650;line-height:1.3;text-align:left}",
    ".sdt-acc-btn span{min-width:0;overflow-wrap:anywhere}",
    ".sdt-acc-btn i{flex:none;width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);margin-top:-3px}",
    ".sdt-acc-btn[aria-expanded=true]{color:#ff8fc7}",
    ".sdt-acc-btn[aria-expanded=true] i{transform:rotate(225deg);margin-top:3px}",
    ".sdt-acc-panel{display:grid;gap:10px;min-width:0;padding:0 0 12px}",
    ".sdt-item{display:grid;gap:3px;min-width:0}",
    ".sdt-item strong{color:#fff;font-size:13px;font-weight:650;line-height:1.4}",
    ".sdt-item p,.sdt-empty{margin:0;color:#c8c8c8;font-size:13px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}",
    "@media (max-width:480px){.sdt-acc-btn{font-size:14px}.sdt-item p,.sdt-empty,.sdt-item strong{font-size:13px}}",
    ".pw-app .sdt-acc-btn,.mcj-po-dialog .sdt-acc-btn{border:0 !important;background:transparent !important;color:#fff !important;border-radius:0 !important;box-shadow:none !important;width:100% !important;height:auto !important;min-height:42px !important;padding:8px 0 !important;font-size:14px !important}",
    ".pw-app .sdt-acc-btn[aria-expanded=true],.mcj-po-dialog .sdt-acc-btn[aria-expanded=true]{color:#ff8fc7 !important}"
  ].join("");
  document.head.appendChild(style);
}

var api = {
  render: renderServiceDetails,
  read: readServiceDetails,
  installCss: installServiceDetailsCss,
  splitLines: splitLines,
};

if (typeof window !== "undefined") window.MCJServiceDetails = api;
