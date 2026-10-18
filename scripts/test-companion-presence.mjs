import assert from "node:assert/strict";
import { classifyPresenceWrite, resolvePresenceKind } from "../server/api/_companion-presence.js";

const online = { onlineStatus: "online", presenceRev: 10 };
const offline = { onlineStatus: "offline", presenceRev: 20 };

assert.equal(resolvePresenceKind({ online_status: "offline" }, "offline"), "lifecycle");
assert.equal(resolvePresenceKind({ online_status: "online" }, "online"), "explicit");
assert.equal(resolvePresenceKind({ heartbeat: 1, online_status: "online" }, "online"), "heartbeat");

const hidden = classifyPresenceWrite(online, { online_status: "offline" });
assert.equal(hidden.write, false);
assert.equal(hidden.code, "PRESENCE_LIFECYCLE_IGNORED");
assert.equal(hidden.onlineStatus, "online");

const pagehide = classifyPresenceWrite(online, { online_status: "offline", presenceKind: "lifecycle", presenceRev: 99 });
assert.equal(pagehide.write, false);

const beatFail = classifyPresenceWrite(online, { online_status: "online", heartbeat: 1, presenceRev: 10 });
assert.equal(beatFail.write, true);
assert.equal(beatFail.onlineStatus, "online");

const lateBeat = classifyPresenceWrite(online, { online_status: "online", presenceKind: "heartbeat", presenceRev: 9 });
assert.equal(lateBeat.write, false);
assert.equal(lateBeat.code, "PRESENCE_STALE");

const beatAfterOff = classifyPresenceWrite(offline, { online_status: "online", presenceKind: "heartbeat", presenceRev: 21 });
assert.equal(beatAfterOff.write, false);
assert.equal(beatAfterOff.code, "PRESENCE_HEARTBEAT_RESPECTS_OFFLINE");

const explicitOff = classifyPresenceWrite(online, { online_status: "offline", explicit: 1, presenceKind: "explicit", presenceRev: 11 });
assert.equal(explicitOff.write, true);
assert.equal(explicitOff.onlineStatus, "offline");

const staleOff = classifyPresenceWrite({ onlineStatus: "online", presenceRev: 30 }, {
  online_status: "offline",
  presenceKind: "explicit",
  presenceRev: 12,
});
assert.equal(staleOff.write, false);
assert.equal(staleOff.code, "PRESENCE_STALE");
assert.equal(staleOff.onlineStatus, "online");

const explicitOn = classifyPresenceWrite(offline, { online_status: "online", presenceKind: "explicit", presenceRev: 31 });
assert.equal(explicitOn.write, true);
assert.equal(explicitOn.onlineStatus, "online");

const legacyOn = classifyPresenceWrite({ onlineStatus: "offline", presenceRev: 0 }, { online_status: "online" });
assert.equal(legacyOn.write, true);

const legacyBlocked = classifyPresenceWrite(offline, { online_status: "online" });
assert.equal(legacyBlocked.write, false);
assert.equal(legacyBlocked.code, "PRESENCE_STALE");

console.log("companion presence rules ok");
