(function () {
  "use strict";

  if (window.MCJPlatformStore) return;

  var KEY = "mcjRealDB.v1";

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function write(data) {
    localStorage.setItem(KEY, JSON.stringify(data || {}));
    window.dispatchEvent(new CustomEvent("mcj:data-updated"));
  }

  function list(name) {
    var data = read();
    return Array.isArray(data[name]) ? data[name] : [];
  }

  window.MCJPlatformStore = {
    key: KEY,
    read: read,
    write: write,
    list: list
  };
})();
