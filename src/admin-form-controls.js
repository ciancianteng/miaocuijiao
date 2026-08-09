(function () {
  "use strict";

  if (window.MCJAdminForms) return;

  var BOOL_VALUE_TRUE = /^(true|1|yes|on|enabled|enable|open|show|active|published)$/i;
  var BOOL_VALUE_FALSE = /^(false|0|no|off|disabled|disable|closed|close|hide|hidden|inactive|unpublished)$/i;
  var BOOL_LABEL_TRUE = /^(启用|开启|显示|是|允许|上架|置顶|开放|上线|自动通过|推荐|热门|正常)$/;
  var BOOL_LABEL_FALSE = /^(停用|关闭|隐藏|否|不允许|下架|不置顶|关闭申请|下线|人工审核|不推荐|非热门|冻结|限制)/;

  var openSelect = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isTruthyOption(opt) {
    var value = String(opt.value == null ? "" : opt.value).trim();
    var label = String(opt.textContent || "").trim();
    if (BOOL_VALUE_TRUE.test(value) || BOOL_LABEL_TRUE.test(label)) return true;
    if (BOOL_VALUE_FALSE.test(value) || BOOL_LABEL_FALSE.test(label)) return false;
    return null;
  }

  function readOptions(select) {
    return Array.prototype.map.call(select.options || [], function (opt) {
      return {
        value: String(opt.value == null ? "" : opt.value),
        label: String(opt.textContent || "").trim() || String(opt.value || ""),
        disabled: !!opt.disabled,
        selected: !!opt.selected,
      };
    });
  }

  function detectBoolean(select) {
    if (select.multiple) return null;
    if (select.getAttribute("data-admin-control") === "select") return null;
    var all = readOptions(select);
    var hasEmpty = all.some(function (opt) {
      return opt.value === "";
    });
    var candidates = all.filter(function (opt) {
      return opt.value !== "";
    });
    if (select.getAttribute("data-admin-control") === "switch") {
      if (candidates.length < 2) {
        return { onValue: "true", offValue: "false", onLabel: "启用", offLabel: "停用" };
      }
    } else if (hasEmpty || candidates.length !== 2) {
      return null;
    }
    if (candidates.length !== 2) return null;
    var a = isTruthyOption({ value: candidates[0].value, textContent: candidates[0].label });
    var b = isTruthyOption({ value: candidates[1].value, textContent: candidates[1].label });
    if (a === null || b === null || a === b) {
      // Still treat explicit switch control as boolean using option order true/false-ish
      if (select.getAttribute("data-admin-control") !== "switch") return null;
      a = true;
      b = false;
    }
    var onOpt = a ? candidates[0] : candidates[1];
    var offOpt = a ? candidates[1] : candidates[0];
    return {
      onValue: onOpt.value,
      offValue: offOpt.value,
      onLabel: onOpt.label,
      offLabel: offOpt.label,
    };
  }

  function inferBoolLabels(meta, select) {
    if (meta.onLabel && meta.offLabel) return meta;
    var name = String(select.name || select.getAttribute("data-admin-name") || "").toLowerCase();
    if (/show|visible|display|home/.test(name)) return Object.assign({}, meta, { onLabel: "显示", offLabel: "隐藏" });
    if (/pin|top/.test(name)) return Object.assign({}, meta, { onLabel: "置顶", offLabel: "不置顶" });
    if (/allow|open|enable|enabled|active|status/.test(name)) return Object.assign({}, meta, { onLabel: "开启", offLabel: "关闭" });
    return Object.assign({}, meta, { onLabel: meta.onLabel || "启用", offLabel: meta.offLabel || "停用" });
  }

  function currentIsOn(select, meta) {
    var value = String(select.value);
    if (value === meta.onValue) return true;
    if (value === meta.offValue) return false;
    return BOOL_VALUE_TRUE.test(value) || value === "true" || value === "1";
  }

  function enhanceSwitch(select) {
    if (select.dataset.adminEnhanced === "1") return;
    var meta = detectBoolean(select);
    if (!meta) return false;
    meta = inferBoolLabels(meta, select);
    if (!meta.onValue) meta.onValue = "true";
    if (!meta.offValue) meta.offValue = "false";

    select.dataset.adminEnhanced = "1";
    select.classList.add("admin-native-hidden");
    select.setAttribute("tabindex", "-1");
    select.setAttribute("aria-hidden", "true");

    var wrap = document.createElement("div");
    wrap.className = "admin-switch-row";
    wrap.setAttribute("data-admin-switch-wrap", "");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-switch";
    btn.setAttribute("role", "switch");
    btn.setAttribute("data-admin-switch", "");

    var text = document.createElement("span");
    text.className = "admin-switch-text";

    function sync(fromSelect) {
      var on = currentIsOn(select, meta);
      if (!fromSelect) {
        select.value = on ? meta.onValue : meta.offValue;
      } else {
        on = currentIsOn(select, meta);
      }
      btn.setAttribute("aria-checked", on ? "true" : "false");
      btn.disabled = !!select.disabled;
      text.textContent = on ? meta.onLabel : meta.offLabel;
      btn.setAttribute("aria-label", (select.getAttribute("aria-label") || select.name || "开关") + "：" + text.textContent);
    }

    function toggle() {
      if (select.disabled || btn.disabled) return;
      var on = btn.getAttribute("aria-checked") !== "true";
      select.value = on ? meta.onValue : meta.offValue;
      sync(true);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new Event("input", { bubbles: true }));
    }

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      toggle();
    });
    btn.addEventListener("keydown", function (e) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggle();
      }
    });

    select.addEventListener("change", function () {
      sync(true);
    });

    wrap.appendChild(btn);
    wrap.appendChild(text);

    var parentLabel = select.closest("label");
    if (parentLabel && select.parentNode === parentLabel) {
      // Avoid nested interactive controls inside <label> (would double-toggle).
      var field = document.createElement("div");
      field.className = "admin-switch-field";
      while (parentLabel.firstChild) field.appendChild(parentLabel.firstChild);
      parentLabel.parentNode.replaceChild(field, parentLabel);
      select.insertAdjacentElement("afterend", wrap);
    } else {
      var shell = document.createElement("div");
      shell.className = "admin-switch-field";
      select.parentNode.insertBefore(shell, select);
      shell.appendChild(select);
      shell.appendChild(wrap);
    }

    sync(true);
    return true;
  }

  function closeOpenSelect() {
    if (!openSelect) return;
    openSelect.classList.remove("is-open");
    var trigger = openSelect.querySelector(".admin-select-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    openSelect = null;
  }

  function placeMenu(wrap, menu) {
    menu.classList.remove("is-up");
    var rect = wrap.getBoundingClientRect();
    var spaceBelow = window.innerHeight - rect.bottom;
    var spaceAbove = rect.top;
    if (spaceBelow < 220 && spaceAbove > spaceBelow) menu.classList.add("is-up");
  }

  function enhanceSelect(select) {
    if (select.dataset.adminEnhanced === "1") return;
    if (enhanceSwitch(select)) return;

    select.dataset.adminEnhanced = "1";
    select.classList.add("admin-native-hidden");
    select.setAttribute("tabindex", "-1");
    select.setAttribute("aria-hidden", "true");

    var wrap = document.createElement("div");
    wrap.className = "admin-select";
    wrap.setAttribute("data-admin-select", "");

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "admin-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    var valueEl = document.createElement("span");
    valueEl.className = "admin-select-value";
    var caret = document.createElement("span");
    caret.className = "admin-select-caret";
    caret.setAttribute("aria-hidden", "true");
    trigger.appendChild(valueEl);
    trigger.appendChild(caret);

    var menu = document.createElement("div");
    menu.className = "admin-select-menu";
    menu.setAttribute("role", "listbox");

    function selectedOption() {
      var opts = readOptions(select);
      return opts.find(function (opt) { return opt.value === String(select.value); }) || opts[0] || { value: "", label: "请选择" };
    }

    function isPlaceholder(opt) {
      return !opt || (opt.value === "" && (/全部|请选择|筛选|类型|状态|方式/.test(opt.label) || opt.label === ""));
    }

    function syncTrigger() {
      var opt = selectedOption();
      valueEl.textContent = opt.label || "请选择";
      valueEl.classList.toggle("is-placeholder", isPlaceholder(opt));
      trigger.setAttribute("aria-label", (select.getAttribute("aria-label") || select.name || "下拉选择") + "：" + valueEl.textContent);
    }

    function renderMenu(activeIndex) {
      var opts = readOptions(select);
      menu.innerHTML = "";
      opts.forEach(function (opt, index) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "admin-select-option";
        btn.setAttribute("role", "option");
        btn.setAttribute("data-value", opt.value);
        btn.setAttribute("aria-selected", opt.value === String(select.value) ? "true" : "false");
        if (opt.value === String(select.value)) btn.classList.add("is-selected");
        if (index === activeIndex) btn.classList.add("is-active");
        if (opt.disabled) btn.disabled = true;
        btn.textContent = opt.label;
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          select.value = opt.value;
          syncTrigger();
          closeOpenSelect();
          select.dispatchEvent(new Event("change", { bubbles: true }));
          select.dispatchEvent(new Event("input", { bubbles: true }));
          trigger.focus();
        });
        menu.appendChild(btn);
      });
    }

    function openMenu() {
      if (openSelect && openSelect !== wrap) closeOpenSelect();
      renderMenu(
        Math.max(
          0,
          readOptions(select).findIndex(function (opt) {
            return opt.value === String(select.value);
          })
        )
      );
      wrap.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      placeMenu(wrap, menu);
      openSelect = wrap;
      var selected = menu.querySelector(".admin-select-option.is-selected") || menu.querySelector(".admin-select-option");
      if (selected) selected.focus();
    }

    function moveActive(delta) {
      var items = Array.prototype.slice.call(menu.querySelectorAll(".admin-select-option:not(:disabled)"));
      if (!items.length) return;
      var current = items.findIndex(function (el) { return el.classList.contains("is-active") || el === document.activeElement; });
      if (current < 0) current = items.findIndex(function (el) { return el.classList.contains("is-selected"); });
      var next = items[(current + delta + items.length) % items.length];
      items.forEach(function (el) { el.classList.remove("is-active"); });
      next.classList.add("is-active");
      next.focus();
    }

    trigger.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (wrap.classList.contains("is-open")) closeOpenSelect();
      else openMenu();
    });

    trigger.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
    });

    menu.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeOpenSelect();
        trigger.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        moveActive(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveActive(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        var active = menu.querySelector(".admin-select-option.is-active") || menu.querySelector(".admin-select-option.is-selected");
        if (active) active.click();
      }
    });

    trigger.disabled = !!select.disabled;
    select.addEventListener("change", syncTrigger);

    var parent = select.parentNode;
    parent.insertBefore(wrap, select);
    wrap.appendChild(select);
    wrap.appendChild(trigger);
    wrap.appendChild(menu);

    var hostLabel = wrap.closest("label");
    if (hostLabel) {
      var field = document.createElement("div");
      field.className = "admin-select-field";
      while (hostLabel.firstChild) field.appendChild(hostLabel.firstChild);
      hostLabel.parentNode.replaceChild(field, hostLabel);
    }

    syncTrigger();
  }

  function enhance(root) {
    root = root || document;
    var scope = root.querySelectorAll ? root : document;
    var selects = [];
    if (root && root.matches && root.matches("select")) selects.push(root);
    if (scope.querySelectorAll) {
      Array.prototype.forEach.call(scope.querySelectorAll("select"), function (el) {
        selects.push(el);
      });
    }
    selects.forEach(function (select) {
      if (!select || select.dataset.adminEnhanced === "1") return;
      if (select.closest(".admin-select") && select.dataset.adminEnhanced === "1") return;
      // Keep filter/search toolbars on native controls so enhanced selects cannot break row flow.
      if (select.getAttribute("data-admin-control") === "native") return;
      if (select.closest(".cs-reward-toolbar, .service-record-toolbar, [role='search']")) return;
      // Only enhance inside admin surfaces
      if (!select.closest(".admin-shell, #adminModal, .admin-content, body[data-allowed-roles]")) return;
      try {
        enhanceSelect(select);
      } catch (err) {
        console.error("[AdminForms] enhance failed", err);
      }
    });
  }

  function switchHtml(options) {
    options = options || {};
    var name = options.name || "";
    var checked = options.checked !== false;
    var onLabel = options.onLabel || "启用";
    var offLabel = options.offLabel || "停用";
    var label = options.label || "";
    var onValue = options.onValue == null ? "true" : String(options.onValue);
    var offValue = options.offValue == null ? "false" : String(options.offValue);
    return (
      '<label class="admin-switch-field">' +
      (label ? '<span class="admin-field-label">' + esc(label) + "</span>" : "") +
      '<select name="' +
      esc(name) +
      '" data-admin-control="switch">' +
      '<option value="' +
      esc(onValue) +
      '" ' +
      (checked ? "selected" : "") +
      ">" +
      esc(onLabel) +
      "</option>" +
      '<option value="' +
      esc(offValue) +
      '" ' +
      (!checked ? "selected" : "") +
      ">" +
      esc(offLabel) +
      "</option>" +
      "</select></label>"
    );
  }

  function selectHtml(options) {
    options = options || {};
    var name = options.name || "";
    var value = options.value == null ? "" : String(options.value);
    var label = options.label || "";
    var list = options.options || [];
    var opts = list
      .map(function (item) {
        var val = typeof item === "string" ? item : item.value;
        var text = typeof item === "string" ? item : item.label;
        return '<option value="' + esc(val) + '" ' + (String(val) === value ? "selected" : "") + ">" + esc(text) + "</option>";
      })
      .join("");
    return (
      '<label class="admin-select-field">' +
      (label ? '<span class="admin-field-label">' + esc(label) + "</span>" : "") +
      '<select name="' +
      esc(name) +
      '" data-admin-control="select">' +
      opts +
      "</select></label>"
    );
  }

  function observe() {
    var root = document.querySelector(".admin-shell") || document.body;
    if (!root || root.dataset.adminFormsObserved === "1") return;
    root.dataset.adminFormsObserved = "1";
    var timer = null;
    var observer = new MutationObserver(function () {
      if (timer) cancelAnimationFrame(timer);
      timer = requestAnimationFrame(function () {
        enhance(root);
        var modal = document.getElementById("adminModal");
        if (modal) enhance(modal);
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    document.addEventListener("click", function (e) {
      if (openSelect && !e.target.closest(".admin-select")) closeOpenSelect();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeOpenSelect();
    });
    window.addEventListener("resize", closeOpenSelect);
    enhance(root);
  }

  window.MCJAdminForms = {
    enhance: enhance,
    observe: observe,
    switchHtml: switchHtml,
    selectHtml: selectHtml,
    closeSelect: closeOpenSelect,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observe);
  } else {
    observe();
  }
})();
