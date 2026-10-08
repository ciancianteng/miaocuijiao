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

/** Keyboard overlap only. Ignore visualViewport offset from page scroll and the URL bar. */
export function keyboardInsetPx(view) {
  var win = view || (typeof window !== "undefined" ? window : null);
  if (!win || !win.visualViewport) return 0;
  var covered = Math.round((win.innerHeight || 0) - win.visualViewport.height);
  if (covered < 80) return 0;
  return covered;
}

export function virtStartIndex(scrollTop, rowH, overscan) {
  var h = rowH > 0 ? rowH : 1;
  return Math.max(0, Math.floor((scrollTop || 0) / h) - (overscan || 0));
}
