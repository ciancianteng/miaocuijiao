(function () {
  "use strict";

  if (window.MCJNotify) return;

  var STORE_KEY = "mcjNotify.v1";
  var stack;

  function read() {
    try {
      var data = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function write(items) {
    localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, 80)));
  }

  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function ensureStack() {
    if (stack && document.body.contains(stack)) return stack;
    stack = document.createElement("div");
    stack.className = "mcj-notify-stack";
    stack.setAttribute("aria-live", "polite");
    document.body.appendChild(stack);
    return stack;
  }

  function show(item) {
    if (!document.body) return;
    var node = document.createElement("div");
    node.className = "mcj-notify-item";
    node.innerHTML = "<strong>" + esc(item.title || "通知") + "</strong><span>" + esc(item.message || "") + "</span>" +
      (item.source ? "<small>" + esc(item.source) + "</small>" : "");
    ensureStack().appendChild(node);
    setTimeout(function () { node.remove(); }, 2600);
  }

  function push(type, title, message, source) {
    var item = {
      id: Date.now() + "-" + Math.random().toString(16).slice(2),
      type: type || "system",
      title: title || "通知",
      message: message || "",
      source: source || "",
      time: new Date().toISOString(),
      read: false
    };
    var items = read();
    items.unshift(item);
    write(items);
    show(item);
    window.dispatchEvent(new CustomEvent("mcj:notify", { detail: item }));
    return item;
  }

  window.MCJNotify = {
    read: read,
    push: push,
    markAllRead: function () {
      write(read().map(function (item) {
        item.read = true;
        return item;
      }));
    },
    clear: function () {
      write([]);
    }
  };
})();
