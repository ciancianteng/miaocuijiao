(function (root) {
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = String(text || "");
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  function copyText(text) {
    var value = String(text || "").trim();
    if (!value) return Promise.reject(new Error("empty"));
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(value).catch(function () {
        if (fallbackCopy(value)) return;
        return Promise.reject(new Error("copy_failed"));
      });
    }
    if (fallbackCopy(value)) return Promise.resolve();
    return Promise.reject(new Error("copy_failed"));
  }

  root.MCJCopyText = { copy: copyText, copyText: copyText, fallbackCopy: fallbackCopy };
})(typeof window !== "undefined" ? window : globalThis);