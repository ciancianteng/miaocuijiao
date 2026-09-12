/**
 * Smoke-check MCJAuthContinue pending-action API (no network login).
 * Run: node scripts/_verify-auth-continue.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadScript(rel) {
  const code = fs.readFileSync(path.join(root, rel), "utf8");
  const document = {
    readyState: "complete",
    documentElement: { classList: { add() {}, remove() {} }, style: {}, setAttribute() {}, style: {} },
    body: {
      classList: { add() {}, remove() {} },
      style: {},
      appendChild(el) {
        this._kids = this._kids || [];
        this._kids.push(el);
        return el;
      },
    },
    head: {
      appendChild(el) {
        this._kids = this._kids || [];
        this._kids.push(el);
        return el;
      },
    },
    getElementById(id) {
      if (id === "modal") return this._modal || null;
      if (id === "modalBody") return this._modalBody || null;
      return null;
    },
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        className: "",
        id: "",
        style: {},
        innerHTML: "",
        children: [],
        classList: {
          _s: new Set(),
          add(c) {
            this._s.add(c);
            el.className = Array.from(this._s).join(" ");
          },
          remove(c) {
            this._s.delete(c);
            el.className = Array.from(this._s).join(" ");
          },
          contains(c) {
            return this._s.has(c);
          },
          toggle(c, on) {
            if (on) this.add(c);
            else this.remove(c);
          },
        },
        setAttribute(k, v) {
          this[k] = v;
        },
        getAttribute(k) {
          return this[k];
        },
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
        addEventListener() {},
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        contains() {
          return true;
        },
      };
      if (tag === "div") {
        // capture modal when created
        const origSet = Object.getOwnPropertyDescriptor(el, "id") || { configurable: true };
        Object.defineProperty(el, "id", {
          configurable: true,
          get() {
            return this._id || "";
          },
          set(v) {
            this._id = v;
            if (v === "modal") document._modal = el;
          },
        });
      }
      return el;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };
  // After createElement builds modal with innerHTML, set modalBody stub
  const origCreate = document.createElement.bind(document);
  document.createElement = function (tag) {
    const el = origCreate(tag);
    if (tag === "div") {
      const prev = el.appendChild;
      // When portal sets innerHTML, inject modalBody for getElementById
      Object.defineProperty(el, "innerHTML", {
        configurable: true,
        get() {
          return this._html || "";
        },
        set(v) {
          this._html = v;
          if (String(v).includes("modalBody") || String(v).includes('id="modalBody"')) {
            document._modalBody = {
              innerHTML: "",
              scrollTop: 0,
              querySelector() {
                return null;
              },
            };
            document._modal = el;
          }
        },
      });
    }
    return el;
  };

  const window = {
    document,
    location: { href: "http://localhost/profile.html", pathname: "/profile.html", search: "", hash: "", scrollY: 0 },
    scrollY: 0,
    pageYOffset: 0,
    scrollTo() {},
    addEventListener() {},
    setTimeout,
    clearTimeout,
    localStorage: {
      _m: {},
      getItem(k) {
        return this._m[k] || null;
      },
      setItem(k, v) {
        this._m[k] = String(v);
      },
      removeItem(k) {
        delete this._m[k];
      },
    },
    sessionStorage: {
      _m: {},
      getItem(k) {
        return this._m[k] || null;
      },
      setItem(k, v) {
        this._m[k] = String(v);
      },
      removeItem(k) {
        delete this._m[k];
      },
    },
    console,
    CustomEvent: function () {},
  };
  window.window = window;
  window.globalThis = window;
  document.defaultView = window;

  vm.runInNewContext(code, window, { filename: rel });
  return window;
}

const w = loadScript("src/login-modal-portal.js");
const Cont = w.MCJAuthContinue;
const Modal = w.MCJModal;
if (!Cont || !Modal) {
  console.error("FAIL: MCJAuthContinue / MCJModal missing");
  process.exit(1);
}

let ran = false;
const okFalse = Cont.requireLogin(function () {
  ran = true;
});
if (okFalse !== false) {
  console.error("FAIL: requireLogin should return false when logged out");
  process.exit(1);
}
if (!Cont.hasPending()) {
  console.error("FAIL: pending action not stored");
  process.exit(1);
}
if (!documentOpen(w)) {
  console.error("FAIL: login modal should open");
  process.exit(1);
}

// Simulate login success resume
Cont.runPending();
await new Promise((r) => setTimeout(r, 20));
if (!ran) {
  console.error("FAIL: pending action did not run");
  process.exit(1);
}
if (Cont.hasPending()) {
  console.error("FAIL: pending should be cleared after run");
  process.exit(1);
}

// Logged-in path: return true without running onSuccess (caller continues).
w.localStorage.setItem("mcjAuthAccessToken", "tok");
w.localStorage.setItem("mcjRole", "boss");
let ran2 = false;
const okTrue = Cont.requireLogin(function () {
  ran2 = true;
});
if (okTrue !== true) {
  console.error("FAIL: requireLogin should return true when logged in");
  process.exit(1);
}
if (ran2) {
  console.error("FAIL: requireLogin must not run onSuccess when already logged in");
  process.exit(1);
}
if (Cont.hasPending()) {
  console.error("FAIL: should not stash pending when already logged in");
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: ["pending_store", "modal_open", "run_pending", "logged_in_passthrough"],
    },
    null,
    2
  )
);

function documentOpen(win) {
  const modal = win.document.getElementById("modal");
  return !!(modal && modal.classList && modal.classList.contains("open"));
}
