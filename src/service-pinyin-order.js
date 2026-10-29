/**
 * Display order for companion「我的服务」.
 * Group by the pinyin initial of the first character, then full zh-CN pinyin.
 * Latin names use their first letter. This does not write prices or offers.
 */
(function (root) {
  "use strict";
  var LETTERS = "ABCDEFGHJKLMNOPQRSTWXYZ";
  var BOUNDS = "啊芭擦搭蛾发噶哈击喀垃妈拿哦啪期然撒塌挖昔压匝";
  var collator = null;
  var HAN = /\p{Script=Han}/u;

  function nameCollator() {
    if (!collator) collator = new Intl.Collator("zh-CN");
    return collator;
  }

  function displayName(item) {
    var raw = item && typeof item === "object" ? item.name || item.title || "" : item;
    return String(raw || "").trim().normalize("NFKC");
  }

  function initialOfChar(ch) {
    if (!ch) return "#";
    if (/[A-Za-z]/.test(ch)) return ch.toUpperCase();
    if (!HAN.test(ch)) return "#";
    var compare = nameCollator();
    var letter = "#";
    for (var i = 0; i < BOUNDS.length; i += 1) {
      if (compare.compare(ch, BOUNDS.charAt(i)) >= 0) letter = LETTERS.charAt(i);
      else break;
    }
    return letter;
  }

  function groupingChar(name) {
    var chars = Array.from(String(name || "").trim().normalize("NFKC"));
    for (var i = 0; i < chars.length; i += 1) {
      var ch = chars[i];
      if (HAN.test(ch) || /[A-Za-z]/.test(ch)) return ch;
    }
    return "";
  }

  function initialOf(name) {
    return initialOfChar(groupingChar(name));
  }

  function compareNames(a, b) {
    var left = String(a || "");
    var right = String(b || "");
    var ia = initialOf(left);
    var ib = initialOf(right);
    if (ia !== ib) {
      if (ia === "#") return 1;
      if (ib === "#") return -1;
      return ia < ib ? -1 : 1;
    }
    return nameCollator().compare(left, right);
  }

  function initialsOf(name) {
    return Array.from(String(name || "").trim().normalize("NFKC")).map(function (ch) {
      if (!(HAN.test(ch) || /[A-Za-z]/.test(ch))) return "";
      var letter = initialOfChar(ch);
      return letter === "#" ? "" : letter;
    }).join("");
  }

  function matchesQuery(name, query) {
    var q = String(query || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!q) return true;
    var raw = String(name || "").trim().toLowerCase();
    if (raw.indexOf(q) >= 0) return true;
    var initials = initialsOf(name).toLowerCase().replace(/#/g, "");
    return initials.indexOf(q) >= 0;
  }

  function sortByPinyin(list) {
    return (Array.isArray(list) ? list : []).map(function (item, index) {
      return { item: item, index: index };
    }).sort(function (a, b) {
      var diff = compareNames(displayName(a.item), displayName(b.item));
      if (diff) return diff;
      return a.index - b.index;
    });
  }

  root.MCJServicePinyinOrder = {
    initialOf: initialOf,
    initialsOf: initialsOf,
    matchesQuery: matchesQuery,
    compareNames: compareNames,
    sortByPinyin: sortByPinyin,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
