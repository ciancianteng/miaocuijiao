/**
 * Chat scroll anchor.
 * Replacing a scroller's children resets scrollTop to 0. Callers must capture
 * before the write and restore after layout — never pin scroll in a loop.
 */

export function distanceFromBottom(box) {
  if (!box) return 0;
  return (box.scrollHeight || 0) - (box.scrollTop || 0) - (box.clientHeight || 0);
}

export function shouldStickToBottom(box, keepScroll, forceStick) {
  if (forceStick) return true;
  if (!keepScroll) return true;
  return distanceFromBottom(box) < 96;
}

export function captureChatScroll(box) {
  if (!box) return null;
  var nodes = box.querySelectorAll ? box.querySelectorAll("[data-msg-id]") : [];
  var anchor = null;
  var viewTop = box.scrollTop || 0;
  var i;
  for (i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var id = el.getAttribute ? el.getAttribute("data-msg-id") : "";
    if (!id) continue;
    var top = el.offsetTop || 0;
    var height = el.offsetHeight || 0;
    if (top + height > viewTop + 4) {
      anchor = { id: id, offset: top - viewTop };
      break;
    }
  }
  return {
    top: viewTop,
    near: distanceFromBottom(box) < 96,
    anchor: anchor,
  };
}

function cssAttr(id) {
  return String(id).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function applyChatScroll(box, snap, stick) {
  if (!box || box.isConnected === false) return;
  if (stick || (snap && snap.near)) {
    box.scrollTop = box.scrollHeight;
    return;
  }
  if (snap && snap.anchor && snap.anchor.id && box.querySelector) {
    var el = box.querySelector('[data-msg-id="' + cssAttr(snap.anchor.id) + '"]');
    if (el) {
      box.scrollTop = Math.max(0, (el.offsetTop || 0) - (snap.anchor.offset || 0));
      return;
    }
  }
  box.scrollTop = snap && snap.top ? snap.top : 0;
}

export function restoreChatScroll(box, snap, stick) {
  applyChatScroll(box, snap, stick);
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(function () {
    applyChatScroll(box, snap, stick);
    requestAnimationFrame(function () {
      applyChatScroll(box, snap, stick);
    });
  });
}

/**
 * Keyboard overlap only (layout viewport bottom minus visual viewport bottom).
 * Uses offsetTop so URL-bar / pinch-zoom scroll does not inflate the inset.
 *
 * NOTE: On many iOS Safari builds, focusing an input shrinks window.innerHeight
 * together with visualViewport.height, so this returns 0 even while the keyboard
 * is open. Callers must NOT gate keyboard layout mode on inset alone — use
 * composer focus (see isChatKeyboardOpen).
 */
export function keyboardInsetPx(view) {
  var win = view || (typeof window !== "undefined" ? window : null);
  if (!win || !win.visualViewport) return 0;
  var vv = win.visualViewport;
  var bottom = Math.round((win.innerHeight || 0) - (vv.height + (vv.offsetTop || 0)));
  if (bottom < 80) return 0;
  return Math.max(0, bottom);
}

/**
 * Stable mobile chat keyboard mode.
 * Focus means the soft keyboard is (or will be) open — do not wait for inset.
 * Keep mode briefly while inset remains after blur (dismiss animation).
 */
export function isChatKeyboardOpen(opts) {
  var o = opts || {};
  if (!o.lock) return false;
  if (o.focused) return true;
  return Math.round(o.inset || 0) >= 80;
}

/**
 * Pin a chat shell to the visualViewport box.
 * Prefer this over sticky + 100dvh + keyboard padding (those fight on iOS and cause upward drift).
 */
export function readVisualViewportBox(view) {
  var win = view || (typeof window !== "undefined" ? window : null);
  if (!win) return { top: 0, height: 0, inset: 0 };
  if (!win.visualViewport) {
    return {
      top: 0,
      height: Math.round(win.innerHeight || 0),
      inset: 0,
    };
  }
  var vv = win.visualViewport;
  return {
    top: Math.round(vv.offsetTop || 0),
    height: Math.round(vv.height || win.innerHeight || 0),
    inset: keyboardInsetPx(win),
  };
}

function clearVvShellInline(shell) {
  if (!shell || shell.getAttribute("data-vv-shell") !== "1") return;
  ["position", "left", "right", "top", "height", "max-height", "min-height", "width", "overflow"].forEach(
    function (prop) {
      shell.style.removeProperty(prop);
    }
  );
  shell.removeAttribute("data-vv-shell");
}

function pinVvShellInline(shell, topPx, heightPx) {
  if (!shell) return;
  shell.style.setProperty("position", "fixed", "important");
  shell.style.setProperty("left", "0px", "important");
  shell.style.setProperty("right", "0px", "important");
  shell.style.setProperty("top", topPx + "px", "important");
  shell.style.setProperty("height", heightPx + "px", "important");
  shell.style.setProperty("max-height", heightPx + "px", "important");
  shell.style.setProperty("min-height", "0px", "important");
  shell.style.setProperty("width", "100%", "important");
  shell.style.setProperty("overflow", "hidden", "important");
  shell.setAttribute("data-vv-shell", "1");
}

export function applyVisualViewportCss(prefix, box, opts) {
  var doc = typeof document !== "undefined" ? document.documentElement : null;
  if (!doc) return;
  var p = String(prefix || "cs");
  var b = box || readVisualViewportBox();
  var lock = !!(opts && opts.lock);
  var kbOpen = !!(opts && opts.kbOpen);
  var topPx = Math.max(0, Math.round(b.top || 0));
  var heightPx = Math.max(0, Math.round(b.height || 0));
  if (lock && !kbOpen && opts && opts.tabbarPx) {
    heightPx = Math.max(0, heightPx - Math.round(opts.tabbarPx || 0));
  }
  doc.style.setProperty("--" + p + "-vv-top", topPx + "px");
  doc.style.setProperty("--" + p + "-vv-height", heightPx + "px");
  // Locked chat shells track visualViewport height. Extra composer padding
  // double-counts the keyboard and lifts the input into a blank dead zone.
  // Always zero the inset var while locked; only non-lock surfaces may use it.
  doc.style.setProperty("--" + p + "-keyboard-inset", lock ? "0px" : (b.inset || 0) + "px");
  if (opts && opts.lockClass) doc.classList.toggle(opts.lockClass, lock);
  if (opts && opts.kbClass) doc.classList.toggle(opts.kbClass, kbOpen);
  // Inline pin beats base min-height:100dvh / sticky fights that CSSOM sometimes drops.
  var shellSel = opts && opts.shellSelector ? opts.shellSelector : "";
  if (shellSel && typeof document !== "undefined") {
    var shells = document.querySelectorAll(shellSel);
    var i;
    for (i = 0; i < shells.length; i++) {
      if (lock) pinVvShellInline(shells[i], topPx, heightPx);
      else clearVvShellInline(shells[i]);
    }
  }
  if (lock && typeof window !== "undefined" && (window.scrollX || window.scrollY)) {
    try {
      window.scrollTo(0, 0);
    } catch (e) {}
  }
}

export function virtStartIndex(scrollTop, rowH, overscan) {
  var h = rowH > 0 ? rowH : 1;
  return Math.max(0, Math.floor((scrollTop || 0) / h) - (overscan || 0));
}
