import assert from "node:assert/strict";
import {
  captureChatScroll,
  restoreChatScroll,
  shouldStickToBottom,
  keyboardInsetPx,
  virtStartIndex,
  distanceFromBottom,
} from "../src/scroll-keep.js";

function node(id, top, height) {
  return {
    offsetTop: top,
    offsetHeight: height,
    getAttribute: function (name) {
      return name === "data-msg-id" ? id : null;
    },
  };
}

function box(opts) {
  var nodes = opts.nodes || [];
  return {
    scrollHeight: opts.scrollHeight,
    scrollTop: opts.scrollTop,
    clientHeight: opts.clientHeight,
    isConnected: true,
    querySelectorAll: function () {
      return nodes;
    },
    querySelector: function (sel) {
      var m = /data-msg-id="([^"]+)"/.exec(sel);
      var id = m && m[1];
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].getAttribute("data-msg-id") === id) return nodes[i];
      }
      return null;
    },
  };
}

var atBottom = box({
  scrollHeight: 4000,
  scrollTop: 3600,
  clientHeight: 400,
  nodes: [node("a", 0, 80), node("b", 3500, 80)],
});
assert.equal(distanceFromBottom(atBottom), 0);
assert.equal(shouldStickToBottom(atBottom, true, false), true);
assert.equal(captureChatScroll(atBottom).near, true);

var reading = box({
  scrollHeight: 8000,
  scrollTop: 1200,
  clientHeight: 500,
  nodes: [node("old-1", 0, 80), node("old-40", 1180, 90), node("old-41", 1280, 90)],
});
assert.equal(shouldStickToBottom(reading, true, false), false);
var snap = captureChatScroll(reading);
assert.equal(snap.near, false);
assert.equal(snap.anchor.id, "old-40");

var afterPrepend = box({
  scrollHeight: 9600,
  scrollTop: 0,
  clientHeight: 500,
  nodes: [node("new-1", 0, 80), node("old-40", 1980, 90)],
});
restoreChatScroll(afterPrepend, snap, false);
assert.equal(afterPrepend.scrollTop, 1980 - snap.anchor.offset);
assert.notEqual(afterPrepend.scrollTop, 0);

var afterSend = box({
  scrollHeight: 5000,
  scrollTop: 0,
  clientHeight: 400,
  nodes: [node("m", 0, 40)],
});
restoreChatScroll(afterSend, snap, true);
assert.equal(afterSend.scrollTop, 5000);

assert.equal(keyboardInsetPx({ innerHeight: 800, visualViewport: { height: 760 } }), 0);
assert.equal(keyboardInsetPx({ innerHeight: 800, visualViewport: { height: 420 } }), 380);
assert.equal(
  keyboardInsetPx({ innerHeight: 800, visualViewport: { height: 800, offsetTop: 400 } }),
  0
);

assert.equal(virtStartIndex(0, 92, 6), 0);
var bottomStart = virtStartIndex(100 * 92 - 400, 92, 6);
assert.ok(bottomStart > 40, "bottom of a 100-row list must not rewind the window to 0");

console.log("scroll-keep-test: ok");
