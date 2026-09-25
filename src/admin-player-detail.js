(function () {
  "use strict";

  function authApi() {
    return window.MCJAdminAuthFetch || null;
  }

  var saving = false;
  var voiceCatalogCache = null;
  var voiceCatalogLoading = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function loadVoiceCatalog() {
    if (Array.isArray(voiceCatalogCache)) return Promise.resolve(voiceCatalogCache);
    if (voiceCatalogLoading) return voiceCatalogLoading;
    var Auth = authApi();
    voiceCatalogLoading = (Auth && Auth.get
      ? Auth.get("/api/admin/companion-voice-types")
      : fetch("/api/admin/companion-voice-types", {
          headers: { Accept: "application/json", "x-mcj-admin-role": "admin" },
        }).then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok || body.ok === false) throw new Error(body.message || "读取声线失败");
            return body;
          });
        })
    )
      .then(function (body) {
        voiceCatalogCache = (body.items || body.voiceTypes || []).map(function (item) {
          return {
            id: String(item.id || ""),
            name: String(item.name || item.title || "").trim(),
            enabled: item.enabled !== false,
          };
        }).filter(function (item) { return item.name; });
        return voiceCatalogCache;
      })
      .catch(function () {
        voiceCatalogCache = [];
        return voiceCatalogCache;
      })
      .finally(function () {
        voiceCatalogLoading = null;
      });
    return voiceCatalogLoading;
  }

  function splitVoiceNames(raw) {
    return String(raw == null ? "" : raw)
      .replace(/^声线\s*[:：]\s*/, "")
      .split(/[,，、|/]+/)
      .map(function (x) { return String(x || "").trim(); })
      .filter(Boolean);
  }

  function voiceEditHtml(currentRaw) {
    var selected = splitVoiceNames(currentRaw);
    var selectedSet = {};
    selected.forEach(function (n) { selectedSet[n] = true; });
    var catalog = Array.isArray(voiceCatalogCache) ? voiceCatalogCache.slice() : [];
    var catalogNames = {};
    catalog.forEach(function (item) { catalogNames[item.name] = true; });
    selected.forEach(function (name) {
      if (name !== "其他" && !catalogNames[name]) {
        catalog.push({ id: "legacy-" + name, name: name, enabled: false });
        catalogNames[name] = true;
      }
    });
    var otherCustom = selected.filter(function (n) {
      return n !== "其他" && !catalogNames[n];
    });
    var chips = catalog
      .map(function (item) {
        var on = !!selectedSet[item.name];
        var disabledNote = item.enabled === false ? ' <small style="opacity:.65">(已停用)</small>' : "";
        return (
          '<label class="pw-check-chip" style="display:inline-flex;align-items:center;gap:6px;margin:0 8px 8px 0;padding:8px 12px;border-radius:999px;border:1px solid rgba(239,171,201,.35);background:rgba(255,255,255,.04);font-size:13px">' +
          '<input type="checkbox" name="voice_type_opt" value="' +
          esc(item.name) +
          '"' +
          (on ? " checked" : "") +
          "> " +
          esc(item.name) +
          disabledNote +
          "</label>"
        );
      })
      .join("");
    return (
      '<div class="player-edit-grid" style="grid-column:1/-1">' +
      '<label style="display:grid;gap:8px"><span>声线（可多选）</span>' +
      '<div data-admin-voice-opts style="display:flex;flex-wrap:wrap">' +
      (chips || '<span class="muted">暂无声线目录，请先到「声线管理」新增</span>') +
      "</div>" +
      '<input name="voiceTypeCustom" type="text" maxlength="40" value="' +
      esc(otherCustom.join("、")) +
      '" placeholder="自定义声线（可选，多个用顿号分隔）">' +
      '<small class="muted">选项来自后台「声线管理」；停用项仅对已绑定陪玩保留显示。与语音录音无关。</small>' +
      "</label></div>"
    );
  }

  function emptyText(msg) {
    return '<div class="admin-sync-note">' + esc(msg) + "</div>";
  }

  function paymentMethodLabel(method) {
    var m = String(method || "").trim().toLowerCase();
    if (/tng|touch\s*n\s*go|touch'?n'?go/.test(m)) return "TNG Wallet";
    if (/alipay|支付宝/.test(m)) return "Alipay";
    if (/bank|transfer|duitnow|银行|转账/.test(m)) return "Bank Transfer";
    return String(method || "").trim() || "—";
  }

  function paymentMethodChips(method) {
    var active = paymentMethodLabel(method);
    return ["Bank Transfer", "TNG Wallet", "Alipay"]
      .map(function (label) {
        return (
          '<span class="payout-method-chip' +
          (active === label ? " is-active" : "") +
          '">' +
          esc(label) +
          "</span>"
        );
      })
      .join("");
  }

  function payoutFieldCard(opts) {
    var value = opts.value == null || opts.value === "" ? "—" : String(opts.value);
    var fullSlot = opts.fullKey
      ? '<div class="payout-field-full" data-payout-full="' +
        esc(opts.fullKey) +
        '" hidden></div>'
      : "";
    var actions = "";
    if (opts.copyable) {
      actions +=
        '<button class="mini-btn payout-copy-btn" type="button" data-payout-copy="' +
        esc(opts.fullKey || opts.copyKey || "") +
        '" hidden>复制</button>';
    }
    return (
      '<div class="payout-field-card">' +
      '<div class="payout-field-label">' +
      esc(opts.label) +
      "</div>" +
      '<div class="payout-field-value" data-payout-masked="' +
      esc(opts.fullKey || "") +
      '">' +
      esc(value) +
      "</div>" +
      fullSlot +
      (actions ? '<div class="payout-field-actions">' + actions + "</div>" : "") +
      "</div>"
    );
  }

  function paymentCardsHtml(payment) {
    var methodLabel = paymentMethodLabel(payment.method);
    var canReveal =
      !!payment.hasBankAccount ||
      !!(payment.tngAccount && payment.tngAccount !== "—") ||
      !!(payment.alipayAccount && payment.alipayAccount !== "—");
    return (
      '<div class="payout-pay-panel" data-payout-payment-panel>' +
      '<div class="payout-field-card payout-method-card">' +
      '<div class="payout-field-label">收款方式</div>' +
      '<div class="payout-field-value">' +
      esc(methodLabel) +
      "</div>" +
      '<div class="payout-method-chips" aria-label="收款方式">' +
      paymentMethodChips(payment.method) +
      "</div>" +
      "</div>" +
      '<div class="payout-pay-grid">' +
      payoutFieldCard({ label: "收款人姓名", value: payment.accountName || "—" }) +
      payoutFieldCard({ label: "银行名称", value: payment.bankName || "—" }) +
      payoutFieldCard({
        label: "银行账号",
        value: payment.bankAccountMasked || (payment.hasBankAccount ? "已绑定（已脱敏）" : "—"),
        fullKey: "bank",
        copyable: true,
      }) +
      payoutFieldCard({
        label: "TNG账号",
        value: payment.tngAccount || "—",
        fullKey: "tng",
        copyable: true,
      }) +
      payoutFieldCard({
        label: "支付宝账号",
        value: payment.alipayAccount || "—",
        fullKey: "alipay",
        copyable: true,
      }) +
      "</div>" +
      (canReveal
        ? '<div class="payout-reveal-bar"><button class="mini-btn primary-lite" type="button" data-player-reveal="bank">查看完整收款资料</button><span class="admin-sync-note">仅管理员可见 · 写入审计日志</span></div>'
        : "") +
      '<div class="payout-pay-meta">' +
      rows([
        ["提交时间", payment.submittedAt || "—"],
        ["审核状态", payment.statusLabel || payment.status],
        ["驳回原因", payment.rejectReason || "无"],
      ]) +
      "</div>" +
      '<p class="admin-sync-note payout-security-note">完整银行 / TNG / 支付宝账号仅管理员可查看。陪玩端与列表默认只显示脱敏信息。</p>' +
      "</div>"
    );
  }

  function fillRevealedPayment(form, payment) {
    if (!form || !payment) return;
    var map = {
      bank: payment.bankAccount || payment.bank_account || "",
      tng: payment.tngAccount || payment.tng_account || "",
      alipay: payment.alipayAccount || payment.alipay_account || "",
    };
    Object.keys(map).forEach(function (key) {
      var full = String(map[key] || "").trim();
      var slot = form.querySelector('[data-payout-full="' + key + '"]');
      var masked = form.querySelector('[data-payout-masked="' + key + '"]');
      var copyBtn = form.querySelector('[data-payout-copy="' + key + '"]');
      if (slot) {
        if (full) {
          slot.hidden = false;
          slot.textContent = full;
          slot.dataset.copyValue = full;
        } else {
          slot.hidden = false;
          slot.textContent = "—";
          delete slot.dataset.copyValue;
        }
      }
      if (masked && full) masked.classList.add("is-revealed-masked");
      if (copyBtn) {
        if (full) {
          copyBtn.hidden = false;
          copyBtn.dataset.copyValue = full;
        } else {
          copyBtn.hidden = true;
        }
      }
    });
  }

  function copyText(value) {
    var text = String(value || "");
    if (!text) return Promise.reject(new Error("无可复制内容"));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  function rows(list) {
    return (
      '<div class="detail-list player-detail-list">' +
      list
        .map(function (row) {
          var label = Array.isArray(row) ? row[0] : row[0];
          var value = Array.isArray(row) ? row[1] : row[1];
          var emptyFallback = Array.isArray(row) ? row[2] : row[2];
          var asHtml = !!(row && row.html);
          if (value == null || value === "") value = emptyFallback || "—";
          return (
            "<div><span>" +
            esc(label) +
            "</span><strong>" +
            (asHtml ? value : esc(value)) +
            "</strong></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function section(key, title, html, forceOpen) {
    var open =
      forceOpen === true ||
      key === "basic" ||
      key === "identity" ||
      key === "deposit" ||
      key === "media" ||
      key === "review-ops" ||
      key === "application" ||
      key === "split";
    var collapsed =
      forceOpen === false ||
      key === "income" ||
      key === "account" ||
      key === "cert-badges" ||
      key === "debug";
    if (collapsed && forceOpen !== true) open = false;
    return (
      '<details class="player-detail-section" data-player-detail-section="' +
      esc(key) +
      '"' +
      (open ? " open" : "") +
      "><summary><h3>" +
      esc(title) +
      "</h3></summary>" +
      html +
      "</details>"
    );
  }

  function formatMYT(iso) {
    if (!iso) return "—";
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) {
      var s = String(iso);
      if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s.slice(0, 16).replace("T", " ");
      return s;
    }
    try {
      return (
        new Intl.DateTimeFormat("sv-SE", {
          timeZone: "Asia/Kuala_Lumpur",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
          .format(new Date(t))
          .replace(",", "") + " MYT"
      );
    } catch (e) {
      var d = new Date(t + 8 * 3600 * 1000);
      var p = function (n) {
        return (n < 10 ? "0" : "") + n;
      };
      return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + " MYT";
    }
  }

  function field(label, name, value, type) {
    return (
      '<label><span>' +
      esc(label) +
      '</span><input name="' +
      esc(name) +
      '" type="' +
      esc(type || "text") +
      '" value="' +
      esc(value == null ? "" : value) +
      '"></label>'
    );
  }

  function select(label, name, options, selected) {
    var html = options
      .map(function (opt) {
        var value = typeof opt === "object" ? opt.value : opt;
        var text = typeof opt === "object" ? opt.label : opt;
        return (
          '<option value="' +
          esc(value) +
          '" ' +
          (String(value) === String(selected) ? "selected" : "") +
          ">" +
          esc(text) +
          "</option>"
        );
      })
      .join("");
    return '<label><span>' + esc(label) + "</span><select name=\"" + esc(name) + '">' + html + "</select></label>";
  }

  function statusOptions(selected) {
    return [
      { value: "pending", label: "待审核" },
      { value: "approved", label: "已通过" },
      { value: "rejected", label: "已驳回" },
      { value: "resubmit", label: "需要补资料" },
    ].map(function (opt) {
      return '<option value="' + opt.value + '" ' + (String(selected) === opt.value ? "selected" : "") + ">" + opt.label + "</option>";
    }).join("");
  }

  function thumb(url, title, meta) {
    if (!url) return "";
    return (
      '<button class="player-avatar-btn" type="button" data-player-preview-src="' +
      esc(url) +
      '" data-player-preview-title="' +
      esc(title || "预览") +
      '" title="点击放大">' +
      '<img class="avatar player-avatar" src="' +
      esc(url) +
      '" alt="' +
      esc(title || "") +
      '" onerror="this.onerror=null;this.src=\'/assets/meow-cuijiao-brand.jpg\'">' +
      (meta ? '<span class="player-name-meta">' + esc(meta) + "</span>" : "") +
      "</button>"
    );
  }

  /** Large proof / ID / deposit thumbs — never circular 30px avatar buttons. */
  function proofThumb(url, title, galleryJson) {
    if (!url) {
      return '<div class="player-proof-missing">尚未上传 · ' + esc(title || "图片") + "</div>";
    }
    return (
      '<button class="player-proof-thumb" type="button" data-player-preview-src="' +
      esc(url) +
      '" data-player-preview-title="' +
      esc(title || "预览") +
      '"' +
      (galleryJson ? ' data-player-gallery="' + esc(galleryJson) + '"' : "") +
      ' title="点击查看大图">' +
      '<img src="' +
      esc(url) +
      '" alt="' +
      esc(title || "") +
      '" loading="lazy" decoding="async" onerror="this.onerror=null;this.closest(\'.player-proof-thumb\').classList.add(\'is-broken\');this.alt=\'图片加载失败\'">' +
      '<span class="player-proof-hint">点击查看大图</span></button>'
    );
  }

  function galleryThumb(url, title, index, urlsJson, meta) {
    if (!url) return "";
    return (
      '<button class="player-gallery-thumb" type="button" data-player-preview-src="' +
      esc(url) +
      '" data-player-preview-title="' +
      esc(title || "相册") +
      '" data-player-gallery="' +
      esc(urlsJson || "") +
      '" data-player-gallery-index="' +
      esc(String(index || 0)) +
      '" title="点击查看">' +
      '<img src="' +
      esc(url) +
      '" alt="' +
      esc(title || "") +
      '" loading="lazy" decoding="async">' +
      (meta ? '<span class="player-name-meta">' + esc(meta) + "</span>" : "") +
      "</button>"
    );
  }

  function reviewBox(kind, currentStatus) {
    return (
      '<div class="player-edit-grid" data-player-review="' +
      esc(kind) +
      '">' +
      '<label><span>审核状态</span><select name="reviewStatus">' +
      statusOptions(currentStatus || "pending") +
      "</select></label>" +
      '<label><span>驳回原因</span><input name="rejectReason" placeholder="驳回时必填"></label>' +
      '<div class="form-actions"><button class="mini-btn primary-lite" type="button" data-player-review-save="' +
      esc(kind) +
      '">保存审核</button></div></div>'
    );
  }

  function playerMissingPrice(d) {
    d = d || {};
    if (d.missingPrice === true || d.missing_price === true) return true;
    if (d.missingPrice === false || d.missing_price === false) return false;
    var p = Number(d.price);
    if (Number.isFinite(p) && p > 0) return false;
    var gp = d.game_prices || d.gamePrices || {};
    if (typeof gp === "string") {
      try {
        gp = JSON.parse(gp);
      } catch (e) {
        gp = {};
      }
    }
    return !Object.keys(gp || {}).some(function (k) {
      var n = Number(gp[k]);
      return Number.isFinite(n) && n > 0;
    });
  }

  function levelOptions(selected, levels) {
    var html = '<option value="">请选择等级</option>';
    (levels || []).forEach(function (level) {
      var value = level.id || level.code || level.name;
      var base =
        level.basePrice != null
          ? level.basePrice
          : level.base_price != null
            ? level.base_price
            : level.minPrice != null
              ? level.minPrice
              : level.min;
      var label =
        (level.code ? level.code + " " : "") +
        (level.name || value) +
        (base != null && base !== "" ? " · 等级默认 " + base + " 猫粮" : "") +
        (level.color ? " · " + level.color : "");
      html +=
        '<option value="' +
        esc(value) +
        '" ' +
        (String(value) === String(selected) || String(level.name) === String(selected) ? "selected" : "") +
        ">" +
        esc(label) +
        "</option>";
    });
    return html;
  }
  function levelBasePriceOf(level) {
    if (!level) return 0;
    var n = Number(
      level.basePrice != null
        ? level.basePrice
        : level.base_price != null
          ? level.base_price
          : level.minPrice != null
            ? level.minPrice
            : level.min
    );
    return Number.isFinite(n) ? n : 0;
  }
  function findLevelByValue(value, levels) {
    var key = String(value || "").trim();
    if (!key) return null;
    return (levels || []).find(function (level) {
      return (
        String(level.id) === key ||
        String(level.code) === key ||
        String(level.name) === key
      );
    }) || null;
  }
  function levelPricePreviewHtml(selected, levels) {
    var lv = findLevelByValue(selected, levels);
    if (!lv) {
      return '<p class="admin-sync-note" data-level-price-preview style="grid-column:1/-1">等级默认价格：未选择。新服务或无独立单价时将 fallback 到等级 base_price。</p>';
    }
    var base = levelBasePriceOf(lv);
    return (
      '<p class="admin-sync-note" data-level-price-preview style="grid-column:1/-1"><strong>等级默认价格：</strong>' +
      esc(String(base)) +
      " 猫粮（" +
      esc((lv.code || "") + " " + (lv.name || "")) +
      "）。仅作为新服务默认价 / 无独立价时的 fallback，不会覆盖下方已保存的服务独立价格。</p>"
    );
  }

  function servicePricesList(d) {
    var list = Array.isArray(d.servicePrices) ? d.servicePrices : Array.isArray(d.service_prices) ? d.service_prices : [];
    if (list.length) return dedupeServicePriceRows(list);
    // Fallback from game_prices / games when API older
    var gp = d.game_prices || d.gamePrices || {};
    if (typeof gp === "string") {
      try {
        gp = JSON.parse(gp);
      } catch (e) {
        gp = {};
      }
    }
    var games = String(d.game || d.mainGame || d.main_service || "")
      .split(/[,，、/|]+/)
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);
    var out = [];
    var seen = {};
    function push(name, price) {
      var n = String(name || "").trim();
      var key = n.toLowerCase().replace(/\s+/g, " ");
      if (!n || seen[key]) return;
      seen[key] = 1;
      out.push({ serviceName: n, serviceId: "", unitPrice: price });
    }
    games.forEach(function (g) {
      push(g, gp[g] != null ? gp[g] : d.price);
    });
    Object.keys(gp || {}).forEach(function (k) {
      if (/^[0-9a-f-]{36}$/i.test(k)) return;
      push(k, gp[k]);
    });
    if (!out.length && d.price != null) push("默认服务", d.price);
    return out;
  }

  /** Client safety net: one row per service_id / normalized name. */
  function dedupeServicePriceRows(list) {
    var byKey = {};
    var nameToKey = {};
    (list || []).forEach(function (s) {
      if (!s) return;
      var name = String(s.serviceName || s.service_name || s.name || "").trim();
      var sid = String(s.serviceId || s.service_id || "").trim();
      if (!name && !sid) return;
      var nkey = name.toLowerCase().replace(/\s+/g, " ");
      var key = /^[0-9a-f-]{36}$/i.test(sid) ? "id:" + sid.toLowerCase() : nkey ? "name:" + nkey : "";
      if (!key) return;
      if (nkey && nameToKey[nkey]) key = nameToKey[nkey];
      if (byKey[key]) {
        if (!byKey[key].serviceId && sid) byKey[key].serviceId = sid;
        return;
      }
      byKey[key] = {
        rowId: s.rowId || s.id || "",
        serviceId: sid,
        serviceName: name || sid || "服务",
        unitPrice: s.unitPrice != null ? s.unitPrice : s.unit_price != null ? s.unit_price : s.price,
        source: s.source || "",
        pricingUnit: s.pricingUnit || s.pricing_unit || "小时",
      };
      if (nkey) nameToKey[nkey] = key;
    });
    return Object.keys(byKey).map(function (k) {
      return byKey[k];
    });
  }

  function servicePricesEditHtml(d, levels) {
    var list = servicePricesList(d);
    var lv = findLevelByValue(d.levelId || d.level_id || d.levelName, levels);
    var base = levelBasePriceOf(lv);
    var rowsHtml = list.length
      ? list
          .map(function (s, idx) {
            var name = s.serviceName || s.service_name || s.name || "服务";
            var sid = s.serviceId || s.service_id || "";
            var price = s.unitPrice != null ? s.unitPrice : s.unit_price != null ? s.unit_price : s.price != null ? s.price : base || "";
            return (
              '<label class="admin-service-price-row">' +
              '<span class="admin-service-price-name"><strong title="' +
              esc(name) +
              '">' +
              esc(name) +
              "</strong>" +
              '<input type="hidden" name="servicePrices[' +
              idx +
              '][serviceName]" value="' +
              esc(name) +
              '"><input type="hidden" name="servicePrices[' +
              idx +
              '][serviceId]" value="' +
              esc(sid) +
              '"></span>' +
              '<span class="admin-service-price-input">' +
              '<input name="servicePrices[' +
              idx +
              '][unitPrice]" type="number" min="1" step="1" value="' +
              esc(price) +
              '" required>' +
              '<small>猫粮 / 小时</small></span>' +
              "</label>"
            );
          })
          .join("")
      : '<p class="admin-sync-note">该陪玩尚未配置游戏/服务。请先在资料中填写游戏，或通过审核时按等级默认价初始化。</p>';
    return (
      '<div class="admin-service-prices" data-service-prices>' +
      "<h4>游戏/服务独立价格</h4>" +
      '<p class="muted admin-service-prices-hint">每个服务单独设置单价。老板下单时按所选服务读取；等级默认价格仅作 fallback。</p>' +
      rowsHtml +
      "</div>"
    );
  }

  function servicePricesViewHtml(d) {
    var list = servicePricesList(d);
    if (!list.length) {
      return rows([
        ["等级默认价格", d.levelBasePrice != null ? d.levelBasePrice + " 猫粮" : "—"],
        ["服务独立价格", "尚未配置"],
      ]);
    }
    var pairs = [["等级默认价格", d.levelBasePrice != null ? d.levelBasePrice + " 猫粮（fallback）" : "—"]];
    list.forEach(function (s) {
      var name = s.serviceName || s.service_name || s.name || "服务";
      var price = s.unitPrice != null ? s.unitPrice : s.price;
      pairs.push([name, (price != null ? price : "—") + " 猫粮/小时"]);
    });
    return rows(pairs);
  }

  function getLevels() {
    if (window.MCJCompanionLevels && window.MCJCompanionLevels.read) return window.MCJCompanionLevels.read() || [];
    return [];
  }

  function render(detail, mode, focus) {
    var edit = mode === "edit";
    var d = detail || {};
    var app = d.application || {};
    var identity = d.identity || {};
    var payment = d.payment || {};
    var media = d.media || {};
    var deposit = d.deposit || {};
    var stats = d.stats || {};
    var levels = getLevels();

    var basic = rows([
      { 0: "头像", 1: media.avatarUrl ? thumb(media.avatarUrl, "头像") : "", 2: "尚未上传头像", html: true },
      {
        0: "卡面展示",
        1: media.coverUrl
          ? thumb(media.coverUrl, "卡面")
          : media.avatarUrl
            ? thumb(media.avatarUrl, "卡面(=头像)")
            : "",
        2: "使用头像/相册（已取消单独卡面上传）",
        html: true,
      },
      ["昵称", d.name || d.nickname],
      ["陪玩 ID", d.publicId || d.companionCode || d.companion_code || d.playerId || "未生成"],
      ["邮箱", d.email || "尚未填写邮箱"],
      ["手机号 / 联系方式", d.phone || d.contact_phone || "尚未填写联系方式"],
      ["年龄", d.age || "尚未填写"],
      ["性别", d.gender || "尚未填写"],
      ["地区", d.region || "尚未填写"],
      ["声线", d.voiceType || d.voice_type || (d.application && d.application.voiceType) || "尚未填写"],
      ["注册时间", d.registered_at || d.created_at || "—"],
      ["最近登录", d.lastLogin || d.last_login || "暂无登录记录"],
      ["是否已设置密码", d.hasPassword || d.has_password ? "是" : "否"],
      ["最近密码重置", d.passwordSetAt || d.password_set_at || "—"],
      ["最近登录 IP", d.lastLoginIp || d.last_login_ip || "—"],
    ]);
    if (edit) {
      var voiceCurrent = d.voiceType || d.voice_type || (d.application && d.application.voiceType) || "";
      basic +=
        '<div class="player-edit-grid">' +
        field("昵称", "nickname", d.name || d.nickname) +
        field("联系方式", "contact_phone", d.phone || d.contact_phone) +
        field("主接服务", "mainService", d.mainService || app.mainService) +
        field("主接游戏", "mainGame", d.mainGame || d.game) +
        field("陪玩标签", "tags", d.tags) +
        select("账号状态", "accountStatus", [
          { value: "正常", label: "正常" },
          { value: "暂停接单", label: "暂停接单" },
          { value: "冻结", label: "冻结" },
          { value: "停用", label: "停用" },
        ], d.accountStatus || d.status || "正常") +
        select("是否允许接单", "allowOrders", [
          { value: "true", label: "允许" },
          { value: "false", label: "禁止" },
        ], d.allowOrders === false ? "false" : "true") +
        select("是否推荐到首页", "featured", [
          { value: "false", label: "否" },
          { value: "true", label: "是" },
        ], d.featured ? "true" : "false") +
        "</div>" +
        voiceEditHtml(voiceCurrent);
    }

    var hallOn = d.hallVisible === true || d.hall_visible === true || d.publishReady === true;
    var hallHidden =
      d.approvedButHidden === true ||
      d.approved_but_hidden === true ||
      (!!d.adminApproved && !d.isTestAccount && !hallOn);
    var hallReasons = d.blockReasons || d.block_reasons || [];
    var hallStatusText = d.isTestAccount
      ? "测试账号隔离"
      : hallOn
        ? "已上大厅"
        : hallHidden
          ? "已通过但未上大厅"
          : d.publishStatusLabel || "未上大厅";
    var certMode = String(
      d.certificationMethod ||
        d.certification_method ||
        d.credential_mode ||
        app.certificationMethod ||
        app.credential_mode ||
        ""
    ).toLowerCase();
    var isDepositCert = certMode === "deposit";
    var isIdCert = certMode === "id_card" || (!isDepositCert && !identity.empty);
    var appStatusRaw = String(app.status || d.applicationStatus || d.application_status || "pending").toLowerCase();
    var appPending = /pending|review|submitted|审核中|待审核/.test(appStatusRaw);
    var appApproved = /approved|verified|passed|已通过/.test(appStatusRaw);
    var appRejected = /rejected|已驳回|已拒绝/.test(appStatusRaw);
    var appDraft = /^draft$|草稿/.test(appStatusRaw);
    var appStatusLabel =
      app.statusLabel ||
      (appApproved ? "已通过" : appRejected ? "已驳回" : appDraft ? "草稿" : appPending ? "待审核" : appStatusRaw || "待审核");

    var basicCompact = rows([
      ["昵称", d.name || d.nickname || "—"],
      ["性别", d.gender || "尚未填写"],
      ["年龄", d.age || "尚未填写"],
      ["地区", d.region || "尚未填写"],
      ["游戏", d.mainGame || d.game || app.mainGame || "尚未填写"],
      ["段位", app.gameRank || d.game_rank || "尚未填写"],
      ["价格", playerMissingPrice(d) ? "审核时由等级写入" : (d.price != null ? d.price + " 猫粮" : "—")],
      ["手机号", d.phone || d.contact_phone || "尚未填写"],
      ["可接单时间", app.schedule || d.schedule || "尚未填写"],
    ]);

    var applicationHtml = app.empty
      ? emptyText("尚未提交陪玩申请资料")
      : rows([
          ["申请时间", formatMYT(app.submittedAt)],
          ["认证方式", d.certificationMethodLabel || app.certificationMethodLabel || (isDepositCert ? "押金认证" : isIdCert ? "身份证认证" : "未选择")],
          ["主接服务", app.mainService || "尚未填写"],
          ["主接游戏", app.mainGame || "尚未填写"],
          ["游戏段位", app.gameRank || "尚未填写"],
          ["擅长位置", app.position || "尚未填写"],
          ["声音类型", app.voiceType || "尚未填写"],
          ["可接单时间", app.schedule || "尚未填写"],
          ["自我介绍（前台展示）", d.description || d.bio || d.intro || "尚未填写"],
          ["申请备注（仅后台）", app.note || "无"],
          ["当前申请状态", appStatusLabel],
          ["大厅可见", hallStatusText],
          [
            "未上大厅原因",
            Array.isArray(hallReasons) && hallReasons.length
              ? hallReasons.join("、")
              : d.listingBlockReason || (hallOn || d.isTestAccount ? "无" : "—"),
          ],
          ["驳回原因", app.rejectReason || "无"],
          ["审核人", app.reviewedByName || app.reviewedBy || d.applicationReviewedByName || "—"],
          ["审核时间", formatMYT(app.reviewedAt || d.applicationReviewedAt)],
        ]);

    var idGallery = [];
    if (identity.hasFront && identity.idFrontUrl) idGallery.push({ src: identity.idFrontUrl, title: "身份证正面" });
    if (identity.hasBack && identity.idBackUrl) idGallery.push({ src: identity.idBackUrl, title: "身份证反面" });
    if (identity.hasHandheld && identity.idHandheldUrl) idGallery.push({ src: identity.idHandheldUrl, title: "手持身份证" });
    var idGalleryJson = JSON.stringify(idGallery);
    var identityHtml = identity.empty
      ? emptyText("尚未上传身份证")
      : '<div class="player-proof-block">' +
        rows([
          ["真实姓名", identity.realName || "—"],
          {
            0: "身份证号码",
            1:
              esc(identity.identityNoMasked || "—") +
              (identity.hasIdentityNo
                ? ' <button class="mini-btn" type="button" data-player-reveal="identity">查看完整号码</button><span data-player-identity-full></span>'
                : ""),
            html: true,
          },
          ["提交时间", formatMYT(identity.submittedAt)],
          ["审核状态", identity.statusLabel || identity.status],
          ["审核人", identity.reviewedBy || "—"],
          ["审核时间", formatMYT(identity.reviewedAt)],
          ["驳回原因", identity.rejectReason || "无"],
        ]) +
        '<div class="player-proof-grid">' +
        '<div class="player-proof-item"><span class="player-proof-label">身份证正面</span>' +
        proofThumb(identity.hasFront ? identity.idFrontUrl : "", "身份证正面", idGalleryJson) +
        "</div>" +
        '<div class="player-proof-item"><span class="player-proof-label">身份证反面</span>' +
        proofThumb(identity.hasBack ? identity.idBackUrl : "", "身份证反面", idGalleryJson) +
        "</div>" +
        (identity.hasHandheld
          ? '<div class="player-proof-item"><span class="player-proof-label">手持身份证</span>' +
            proofThumb(identity.idHandheldUrl, "手持身份证", idGalleryJson) +
            "</div>"
          : '<div class="player-proof-item"><span class="player-proof-label">手持身份证</span><div class="player-proof-missing">未上传（非强制）</div></div>') +
        "</div></div>";

    var paymentHtml = payment.empty ? emptyText("尚未填写结款账户") : paymentCardsHtml(payment);
    if (edit && !payment.empty) paymentHtml += reviewBox("payment", payment.status);

    var galleryUrls = (media.gallery || [])
      .filter(function (item) {
        return item && item.url;
      })
      .map(function (item) {
        return { src: item.url, title: "相册" };
      });
    var galleryJson = JSON.stringify(galleryUrls);
    var galleryHtml =
      galleryUrls.length
        ? '<div class="player-gallery-grid">' +
          (media.gallery || [])
            .map(function (item, idx) {
              if (!item || !item.url) return "";
              return (
                '<div class="player-gallery-cell">' +
                galleryThumb(item.url, "相册", idx, galleryJson, item.statusLabel) +
                (edit
                  ? '<div class="player-media-actions"><button class="mini-btn" type="button" data-player-media-review="' +
                    esc(item.id) +
                    '" data-status="approved">通过</button> <button class="mini-btn" type="button" data-player-media-review="' +
                    esc(item.id) +
                    '" data-status="rejected">不通过</button></div>'
                  : "") +
                "</div>"
              );
            })
            .join("") +
          "</div>"
        : emptyText("尚未上传相册");
    var voiceHtml =
      (media.voices || [])
        .map(function (item) {
          return (
            '<div class="player-audio-card admin-sync-note">' +
            (item.url
              ? '<audio controls playsinline preload="metadata" src="' + esc(item.url) + '" style="width:100%;max-width:100%"></audio>'
              : "语音文件暂不可播放") +
            "<div>时长：" +
            esc(item.durationSeconds != null ? item.durationSeconds + " 秒" : "未知") +
            " · 上传：" +
            esc(formatMYT(item.uploadedAt)) +
            " · " +
            esc(item.statusLabel || "") +
            "</div>" +
            (edit
              ? '<button class="mini-btn" type="button" data-player-media-review="' +
                esc(item.id) +
                '" data-status="approved">通过</button> <button class="mini-btn" type="button" data-player-media-review="' +
                esc(item.id) +
                '" data-status="rejected">不通过</button>'
              : "") +
            "</div>"
          );
        })
        .join("") || emptyText("尚未上传语音");
    var videoHtml =
      (media.videos || [])
        .map(function (item) {
          return (
            '<div class="player-video-card admin-sync-note">' +
            (item.url
              ? '<video controls playsinline preload="metadata" src="' +
                esc(item.url) +
                '" style="width:100%;max-width:100%;border-radius:12px;background:#000"></video>'
              : "展示视频暂不可播放") +
            "<div>时长：" +
            esc(item.durationSeconds != null ? item.durationSeconds + " 秒" : "未知") +
            " · 上传：" +
            esc(formatMYT(item.uploadedAt)) +
            " · " +
            esc(item.statusLabel || "") +
            "</div>" +
            (edit
              ? '<button class="mini-btn" type="button" data-player-media-review="' +
                esc(item.id) +
                '" data-status="approved">通过</button> <button class="mini-btn" type="button" data-player-media-review="' +
                esc(item.id) +
                '" data-status="rejected">不通过</button>'
              : "") +
            "</div>"
          );
        })
        .join("") || emptyText("尚未上传展示视频");
    var mediaHtml =
      rows([
        {
          0: "当前头像",
          1: media.avatarUrl ? proofThumb(media.avatarUrl, "头像") : "",
          2: "尚未上传头像",
          html: true,
        },
        ["媒体总状态", media.statusLabel || "—"],
        ["驳回原因", media.rejectReason || "无"],
        ["照片", String((media.gallery || []).length) + " 张"],
        ["视频", String((media.videos || []).length) + " 个"],
        ["声线", String((media.voices || []).length) + " 条"],
      ]) +
      "<h4 class=\"player-media-h\">相册</h4>" +
      galleryHtml +
      "<h4 class=\"player-media-h\">语音</h4>" +
      voiceHtml +
      "<h4 class=\"player-media-h\">展示视频</h4>" +
      videoHtml;

    var split =
      (edit ? "" : servicePricesViewHtml(d)) +
      rows([
        ["当前等级", d.levelName || d.level_name || "未设置"],
        ["平台抽成", (d.orderCommissionRate != null ? d.orderCommissionRate : d.commission_rate) + "%"],
        ["礼物抽成", (d.giftCommissionRate != null ? d.giftCommissionRate : d.gift_commission_rate || 0) + "%"],
        ["直属陪返点", (d.directRebateRate != null ? d.directRebateRate : d.direct_rebate_rate || 0) + "%"],
        ["等级生效时间", d.level_effective_at || "—"],
        ["抽成生效时间", d.commission_effective_at || "—"],
        ["价格完整性", playerMissingPrice(d) ? "缺少接单价格（无法公开上架）" : "已设置"],
      ]) +
      (edit
        ? '<div class="player-edit-grid" data-player-section-split>' +
          '<label><span>当前等级</span><select name="levelId">' +
          levelOptions(d.levelId || d.level_id || d.levelName, levels) +
          "</select></label>" +
          field("订单平台抽成 %", "orderCommissionRate", d.orderCommissionRate != null ? d.orderCommissionRate : d.commission_rate) +
          field("礼物抽成 %", "giftCommissionRate", d.giftCommissionRate != null ? d.giftCommissionRate : d.gift_commission_rate || 0) +
          field("直属陪返点 %", "directRebateRate", d.directRebateRate != null ? d.directRebateRate : d.direct_rebate_rate || 0) +
          field("调整原因", "reason", "") +
          levelPricePreviewHtml(d.levelId || d.level_id || d.levelName, levels) +
          servicePricesEditHtml(d, levels) +
          "</div>"
        : "");

    var depositHistory = Array.isArray(d.deposits)
      ? d.deposits
      : Array.isArray(d.depositHistory)
        ? d.depositHistory
        : deposit && !deposit.empty
          ? [deposit]
          : [];
    var depositHtml = deposit.empty && !depositHistory.length
      ? emptyText("尚未缴纳押金")
      : '<div class="player-proof-block">' +
        rows([
          ["记录编号", deposit.recordNo || "—"],
          ["押金金额", "RM" + (deposit.requiredAmount != null ? deposit.requiredAmount : 100)],
          ["已缴金额", "RM" + (deposit.paidAmount != null ? deposit.paidAmount : 0)],
          ["支付时间", formatMYT(deposit.paidAt)],
          ["支付方式", deposit.paymentMethod || "—"],
          ["付款人", deposit.payerName || deposit.accountName || deposit.payer || "—"],
          ["转账参考号", deposit.referenceNo || deposit.transferRef || deposit.refNo || "—"],
          ["审核状态", deposit.statusLabel || deposit.status],
          ["审核时间", formatMYT(deposit.reviewedAt)],
          ["审核管理员", deposit.reviewedByName || deposit.reviewedBy || "—"],
          ["退款状态", deposit.refundStatusLabel || deposit.refundStatus || "无"],
          ["驳回原因", deposit.rejectReason || "无"],
        ]) +
        '<div class="player-proof-grid"><div class="player-proof-item"><span class="player-proof-label">押金付款截图</span>' +
        proofThumb(deposit.hasProof ? deposit.proofUrl : "", "押金凭证") +
        "</div></div></div>";
    if (depositHistory.length > 1) {
      depositHtml +=
        '<div class="player-deposit-history" style="margin-top:14px"><h4 style="margin:0 0 8px">押金记录（永久账目）</h4>' +
        depositHistory
          .map(function (row) {
            return (
              '<article class="panel" style="margin:0 0 10px;padding:12px">' +
              rows([
                ["记录编号", row.recordNo || row.id || "—"],
                ["金额", "RM" + (row.requiredAmount != null ? row.requiredAmount : row.paidAmount != null ? row.paidAmount : 100)],
                ["状态", row.statusLabel || row.status || "—"],
                ["付款方式", row.paymentMethod || "—"],
                ["缴纳时间", formatMYT(row.paidAt)],
                ["审核时间", formatMYT(row.reviewedAt)],
                ["审核管理员", row.reviewedByName || row.reviewedBy || "—"],
                {
                  0: "付款凭证",
                  1: row.hasProof ? proofThumb(row.proofUrl, "押金凭证") : "",
                  2: "无凭证",
                  html: true,
                },
              ]) +
              "</article>"
            );
          })
          .join("") +
        "</div>";
    }

    var orderRows = (d.recentOrders || [])
      .map(function (o) {
        return (
          "<tr><td>" +
          esc(o.orderNo || o.id) +
          "</td><td>" +
          esc(o.game || "-") +
          "</td><td>RM" +
          esc(o.amount || 0) +
          "</td><td>" +
          esc(o.status || "-") +
          "</td><td>" +
          esc(o.createdAt || "-") +
          "</td></tr>"
        );
      })
      .join("");
    var reviewRows = (d.reviews || [])
      .slice(0, 20)
      .map(function (r) {
        return (
          "<tr><td>" +
          esc(r.rating || "-") +
          "★</td><td>" +
          esc(r.content || "无文字") +
          "</td><td>" +
          esc(r.orderId || "-") +
          "</td><td>" +
          esc(r.createdAt || "-") +
          "</td></tr>"
        );
      })
      .join("");
    var income =
      rows([
        ["累计订单", stats.totalOrders || 0],
        ["已完成订单", stats.completedOrders || 0],
        ["取消订单", stats.cancelledOrders || 0],
        ["退款订单", stats.refundOrders || 0],
        ["平均评分", (stats.rating != null ? stats.rating : d.rating) || 0],
        ["评价数", (stats.reviewCount != null ? stats.reviewCount : d.reviewCount) || 0],
        ["好评数", (stats.goodReviewCount != null ? stats.goodReviewCount : d.goodReviewCount) || 0],
        ["累计收入", "RM" + (stats.totalIncome || 0)],
        ["可提现余额", "RM" + (stats.withdrawable || 0)],
        ["已提现金额", "RM" + (stats.withdrawn || 0)],
      ]) +
      '<div class="table-wrap player-drawer-table"><table><thead><tr><th>订单号</th><th>服务</th><th>金额</th><th>状态</th><th>时间</th></tr></thead><tbody>' +
      (orderRows || '<tr><td colspan="5"><div class="boss-record-empty">暂无真实历史订单</div></td></tr>') +
      '</tbody></table></div><div class="table-wrap player-drawer-table" style="margin-top:12px"><table><thead><tr><th>评分</th><th>评价内容</th><th>订单</th><th>时间</th></tr></thead><tbody>' +
      (reviewRows || '<tr><td colspan="4"><div class="boss-record-empty">暂无真实评价</div></td></tr>') +
      "</tbody></table></div>";

    var account =
      rows([
        ["当前在线状态", d.onlineStatus || d.online_status || "—"],
        ["账号状态", d.accountStatus || d.status || "—"],
        ["是否允许接单", d.allowOrders === false ? "禁止" : "允许"],
        ["首页推荐", d.featured ? "是" : "否"],
      ]) +
      '<div class="admin-sync-note">在线状态由陪玩端维护；后台可停用账号与禁止接单。</div>';

    var assignedCertIds = Array.isArray(d.certTagIds)
      ? d.certTagIds.map(String)
      : Array.isArray(d.certTags)
        ? d.certTags.map(function (t) {
            return String(t.id || t);
          })
        : [];
    var certCatalog = Array.isArray(d.certCatalog) ? d.certCatalog : [];
    var certHtml = !certCatalog.length
      ? '<div class="admin-sync-note">暂无认证徽章目录。请先在左侧「认证徽章管理」创建并启用徽章（名称 / 颜色 / 图标）。</div>' +
        '<p style="margin:8px 0 0"><button class="mini-btn" type="button" data-section="companion-cert-tags">前往认证徽章管理</button></p>'
      : edit
        ? '<div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">' +
          certCatalog
            .map(function (tag) {
              var checked = assignedCertIds.indexOf(String(tag.id)) >= 0 ? " checked" : "";
              return (
                '<label class="mini-card" style="display:flex;gap:8px;align-items:center;padding:10px 12px">' +
                '<input type="checkbox" name="certTagIds" value="' +
                esc(tag.id) +
                '"' +
                checked +
                ">" +
                '<span style="color:' +
                esc(tag.color || "#f5c542") +
                '">' +
                esc(tag.icon || "🏅") +
                " " +
                esc(tag.name) +
                "</span></label>"
              );
            })
            .join("") +
          "</div>" +
          '<div class="admin-sync-note">勾选后保存，前台陪玩卡片会显示对应认证徽章（仅启用中的标签）。徽章名称 / 颜色 / 图标请到「认证徽章管理」编辑。</div>' +
          '<p style="margin:8px 0 0"><button class="mini-btn" type="button" data-section="companion-cert-tags">编辑徽章样式</button></p>'
        : assignedCertIds.length
          ? '<div class="row" style="flex-wrap:wrap;gap:8px">' +
            (d.certTags || [])
              .map(function (tag) {
                return (
                  '<span class="status ok" style="border-color:' +
                  esc(tag.color || "#f5c542") +
                  ";color:" +
                  esc(tag.color || "#f5c542") +
                  '">' +
                  esc((tag.icon || "🏅") + " " + (tag.name || "")) +
                  "</span>"
                );
              })
              .join("") +
            "</div>"
          : emptyText("未分配认证徽章");

    var hasPhotos = (media.gallery || []).length > 0 || !!media.avatarUrl;
    var hasVideos = (media.videos || []).length > 0;
    var hasVoices = (media.voices || []).length > 0;
    var hasIdentityOk = isDepositCert
      ? !!(deposit.hasProof || (deposit.paidAmount != null && Number(deposit.paidAmount) > 0) || /paid|approved|pending/.test(String(deposit.status || "")))
      : !!(identity.hasFront && identity.hasBack);
    var hasBasicOk = !!(d.name || d.nickname) && !!(d.mainGame || d.game || app.mainGame);
    var hasPriceOk = !playerMissingPrice(d) || !!findLevelByValue(d.levelId || d.level_id || d.levelName, levels);
    var completenessItems = [
      { ok: hasBasicOk, label: "基本资料", warn: "基本资料不完整", required: true },
      { ok: hasIdentityOk, label: isDepositCert ? "押金认证" : "身份认证", warn: isDepositCert ? "押金凭证缺失" : "身份证正反面未齐", required: true },
      { ok: hasPhotos, label: "照片", warn: "尚未上传照片", required: true },
      { ok: hasVideos, label: "视频", warn: "尚未上传视频", required: false },
      { ok: hasVoices, label: "声线", warn: "尚未上传声线", required: true },
      { ok: hasPriceOk || appPending, label: "服务价格", warn: "缺少服务价格/等级", required: false },
    ];
    var completenessHtml =
      '<div class="player-completeness" data-player-completeness><div class="player-completeness-title">资料完整度</div><ul>' +
      completenessItems
        .map(function (item) {
          return (
            "<li class=\"" +
            (item.ok ? "is-ok" : item.required ? "is-miss" : "is-warn") +
            '"><span>' +
            (item.ok ? "✓" : "⚠") +
            "</span> " +
            esc(item.ok ? item.label : item.warn || item.label) +
            (item.required && !item.ok ? "（必填）" : "") +
            "</li>"
          );
        })
        .join("") +
      "</ul></div>";

    var canQuickReview = edit && appPending && !appDraft;
    var quickReviewHtml =
      '<div class="player-review-bar" data-player-review-bar>' +
      '<div class="player-review-bar-meta">' +
      '<img class="player-review-avatar" src="' +
      esc(media.avatarUrl || d.avatar || "/assets/meow-cuijiao-brand.jpg") +
      '" alt="" onerror="this.onerror=null;this.src=\'/assets/meow-cuijiao-brand.jpg\'">' +
      "<div><strong>" +
      esc(d.name || d.nickname || "-") +
      '</strong><span>UID · ' +
      esc(d.publicId || d.companionCode || d.companion_code || d.playerId || d.id) +
      '</span><span class="player-review-status ' +
      (appApproved ? "is-ok" : appRejected ? "is-bad" : "is-wait") +
      '">审核状态：' +
      esc(appStatusLabel) +
      "</span></div></div>" +
      completenessHtml +
      '<div class="player-review-bar-actions">' +
      (canQuickReview
        ? '<label class="player-review-level"><span>通过等级</span><select data-player-quick-level>' +
          levelOptions(d.levelId || d.level_id || d.levelName, levels) +
          "</select></label>" +
          '<button class="btn primary player-one-click-approve" type="button" data-player-one-click="approve">一键通过</button>' +
          '<button class="btn danger-btn player-one-click-reject" type="button" data-player-one-click="reject">驳回</button>'
        : appDraft
          ? '<p class="admin-sync-note">草稿不可审核，请等陪玩正式提交。</p>'
          : appApproved
            ? '<p class="admin-sync-note">已通过 · ' + esc(formatMYT(app.reviewedAt || d.applicationReviewedAt || d.updated_at)) + "</p>"
            : "") +
      "</div></div>";

    var reviewOpsHtml =
      rows([
        ["状态", appStatusLabel],
        ["提交时间", formatMYT(app.submittedAt)],
        ["审核人", app.reviewedByName || app.reviewedBy || d.applicationReviewedByName || "—"],
        ["审核时间", formatMYT(app.reviewedAt || d.applicationReviewedAt)],
        ["驳回原因", app.rejectReason || "无"],
      ]) +
      (canQuickReview
        ? '<div class="player-review-bar-actions inline">' +
          '<button class="btn primary" type="button" data-player-one-click="approve">一键通过</button>' +
          '<button class="btn danger-btn" type="button" data-player-one-click="reject">驳回</button></div>'
        : "");

    var certSections = (function () {
      if (isDepositCert) {
        return section("deposit", "② 身份认证 · 押金", depositHtml, true) + section("payment", "结款账户", paymentHtml, false);
      }
      if (isIdCert || !identity.empty) {
        return section("identity", "② 身份认证 · 身份证", identityHtml, true) + section("payment", "结款账户", paymentHtml, false);
      }
      return (
        section("identity", "② 身份认证", identityHtml, true) +
        section("deposit", "押金记录", depositHtml, false) +
        section("payment", "结款账户", paymentHtml, false)
      );
    })();

    return (
      '<div class="player-drawer-head"><div><h2>陪玩审核</h2><p>' +
      esc(d.name || d.nickname || "-") +
      " · " +
      esc(d.publicId || d.playerId || d.id) +
      '</p></div><button class="mini-btn" type="button" data-player-drawer-close>关闭</button></div>' +
      '<form data-player-detail-form data-player-id="' +
      esc(d.id) +
      '" data-player-mode="' +
      esc(mode || "view") +
      '" data-app-status="' +
      esc(appStatusRaw) +
      '" data-missing-price="' +
      (playerMissingPrice(d) ? "1" : "0") +
      '">' +
      quickReviewHtml +
      section("basic", "① 基本资料", basicCompact + (edit && basic.indexOf('class="player-edit-grid"') >= 0 ? basic.slice(basic.indexOf('<div class="player-edit-grid">')) : ""), true) +
      certSections +
      section("media", "③ 展示资料 · 照片 / 视频 / 声线", mediaHtml, true) +
      section("application", "④ 接单资料", applicationHtml, false) +
      section("split", "等级与价格", split, canQuickReview) +
      section("review-ops", "⑤ 审核信息", reviewOpsHtml, true) +
      section("cert-badges", "认证徽章（前台卡片）", certHtml, false) +
      section("income", "订单与收益", income, false) +
      section("account", "账号管理", account, false) +
      (edit
        ? '<div class="player-drawer-actions"><button class="btn primary" type="button" data-player-action="save-detail" data-player-id="' +
          esc(d.id) +
          '" ' +
          (saving ? "disabled" : "") +
          ">" +
          (saving ? "保存中…" : "保存修改") +
          '</button><button class="btn" type="button" data-player-drawer-close>取消</button></div>'
        : '<div class="player-drawer-actions"><button class="btn primary" type="button" data-player-action="edit" data-player-id="' +
          esc(d.id) +
          '">进入编辑</button><button class="btn" type="button" data-player-drawer-close>关闭</button></div>') +
      "</form>" +
      '<div class="modal player-preview-modal" id="playerMediaPreview" aria-hidden="true" hidden>' +
      '<div class="modal-card player-preview-card">' +
      '<button class="modal-close" type="button" data-player-preview-close aria-label="关闭">×</button>' +
      '<button class="player-preview-nav prev" type="button" data-player-preview-prev hidden aria-label="上一张">‹</button>' +
      '<button class="player-preview-nav next" type="button" data-player-preview-next hidden aria-label="下一张">›</button>' +
      '<div id="playerMediaPreviewBody" class="player-preview-body"></div>' +
      '<div class="player-preview-caption" id="playerMediaPreviewCaption"></div>' +
      "</div></div>"
    );
  }

  function apiPost(body) {
    var Auth = authApi();
    var headers = { "x-mcj-admin-role": (window.MCJAdminRole || localStorage.getItem("mcjAdminRole") || "admin") };
    function attachError(data, status) {
      var err = new Error((data && data.message) || "请求失败");
      err.code = (data && data.code) || "";
      err.blockReasons = (data && (data.blockReasons || data.block_reasons)) || [];
      err.publish = (data && data.publish) || null;
      err.status = status;
      return err;
    }
    if (Auth && Auth.post) {
      return Auth.post("/api/admin/players", body, headers).catch(function (err) {
        if (err && (err.blockReasons || err.publish || err.code)) throw err;
        throw err;
      });
    }
    return fetch("/api/admin/players", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, headers),
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw attachError(data, res.status);
        return data;
      });
    });
  }

  function apiGetDetail(id) {
    var Auth = authApi();
    var headers = { "x-mcj-admin-role": (window.MCJAdminRole || localStorage.getItem("mcjAdminRole") || "admin") };
    // Prefer POST detail — same auth path as list mutations; avoids GET query rewrite quirks.
    if (Auth && Auth.post) {
      return Auth.post("/api/admin/players", { action: "detail", id: id }, headers).catch(function (err) {
        var url = "/api/admin/players?id=" + encodeURIComponent(id);
        if (Auth.get) return Auth.get(url, headers);
        throw err;
      });
    }
    var url = "/api/admin/players?id=" + encodeURIComponent(id);
    if (Auth && Auth.get) return Auth.get(url, headers);
    return fetch(url, { headers: Object.assign({ Accept: "application/json" }, headers) }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.message || "资料加载失败，请重试");
        return data;
      });
    });
  }

  var previewState = { items: [], index: 0, scale: 1, tx: 0, ty: 0 };

  function parseGalleryAttr(el) {
    var raw = el && el.getAttribute("data-player-gallery");
    if (!raw) return null;
    try {
      var list = JSON.parse(raw);
      if (!Array.isArray(list) || !list.length) return null;
      return list
        .map(function (item) {
          if (!item) return null;
          if (typeof item === "string") return { src: item, title: "" };
          return { src: item.src || item.url || "", title: item.title || "" };
        })
        .filter(function (x) {
          return x && x.src;
        });
    } catch (err) {
      return null;
    }
  }

  function renderPreviewBody() {
    var modal = document.getElementById("playerMediaPreview");
    var body = document.getElementById("playerMediaPreviewBody");
    var caption = document.getElementById("playerMediaPreviewCaption");
    var prevBtn = modal && modal.querySelector("[data-player-preview-prev]");
    var nextBtn = modal && modal.querySelector("[data-player-preview-next]");
    if (!modal || !body) return;
    var item = previewState.items[previewState.index] || {};
    var src = item.src || "";
    var title = item.title || "预览";
    var isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(src) || /video/i.test(title);
    body.innerHTML = isVideo
      ? '<video class="player-preview-media" controls playsinline src="' + esc(src) + '"></video>'
      : '<div class="player-preview-stage" data-player-preview-stage><img class="player-preview-media" src="' +
        esc(src) +
        '" alt="' +
        esc(title) +
        '" draggable="false"></div>';
    if (caption) {
      caption.textContent =
        title +
        (previewState.items.length > 1 ? " · " + (previewState.index + 1) + "/" + previewState.items.length : "") +
        " · 双指缩放";
    }
    if (prevBtn) prevBtn.hidden = previewState.items.length < 2;
    if (nextBtn) nextBtn.hidden = previewState.items.length < 2;
    previewState.scale = 1;
    previewState.tx = 0;
    previewState.ty = 0;
    applyPreviewTransform();
    bindPreviewGestures(body.querySelector("[data-player-preview-stage]"));
  }

  function applyPreviewTransform() {
    var img = document.querySelector("#playerMediaPreview .player-preview-media");
    if (!img || img.tagName === "VIDEO") return;
    img.style.transform =
      "translate(" + previewState.tx + "px," + previewState.ty + "px) scale(" + previewState.scale + ")";
  }

  function bindPreviewGestures(stage) {
    if (!stage || stage._mcjBound) return;
    stage._mcjBound = true;
    var lastDist = 0;
    var lastX = 0;
    var lastY = 0;
    var panning = false;
    stage.addEventListener(
      "touchstart",
      function (ev) {
        if (ev.touches.length === 2) {
          var dx = ev.touches[0].clientX - ev.touches[1].clientX;
          var dy = ev.touches[0].clientY - ev.touches[1].clientY;
          lastDist = Math.hypot(dx, dy) || 1;
          panning = false;
        } else if (ev.touches.length === 1 && previewState.scale > 1) {
          lastX = ev.touches[0].clientX;
          lastY = ev.touches[0].clientY;
          panning = true;
        }
      },
      { passive: true }
    );
    stage.addEventListener(
      "touchmove",
      function (ev) {
        if (ev.touches.length === 2) {
          ev.preventDefault();
          var dx = ev.touches[0].clientX - ev.touches[1].clientX;
          var dy = ev.touches[0].clientY - ev.touches[1].clientY;
          var dist = Math.hypot(dx, dy) || 1;
          var ratio = dist / (lastDist || dist);
          previewState.scale = Math.min(4, Math.max(1, previewState.scale * ratio));
          lastDist = dist;
          if (previewState.scale === 1) {
            previewState.tx = 0;
            previewState.ty = 0;
          }
          applyPreviewTransform();
        } else if (panning && ev.touches.length === 1) {
          ev.preventDefault();
          previewState.tx += ev.touches[0].clientX - lastX;
          previewState.ty += ev.touches[0].clientY - lastY;
          lastX = ev.touches[0].clientX;
          lastY = ev.touches[0].clientY;
          applyPreviewTransform();
        }
      },
      { passive: false }
    );
    stage.addEventListener("dblclick", function () {
      previewState.scale = previewState.scale > 1 ? 1 : 2;
      if (previewState.scale === 1) {
        previewState.tx = 0;
        previewState.ty = 0;
      }
      applyPreviewTransform();
    });
  }

  function openPreview(src, title, gallery, index) {
    var modal = document.getElementById("playerMediaPreview");
    var body = document.getElementById("playerMediaPreviewBody");
    if (!modal || !body || !src) return;
    var items = Array.isArray(gallery) && gallery.length ? gallery.slice() : [{ src: src, title: title || "预览" }];
    var idx = Number(index);
    if (!Number.isFinite(idx) || idx < 0) {
      idx = items.findIndex(function (it) {
        return it && it.src === src;
      });
      if (idx < 0) idx = 0;
    }
    previewState.items = items;
    previewState.index = Math.min(items.length - 1, Math.max(0, idx));
    renderPreviewBody();
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("open");
  }

  function closePreview() {
    var modal = document.getElementById("playerMediaPreview");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("open");
    var body = document.getElementById("playerMediaPreviewBody");
    if (body) body.innerHTML = "";
    previewState = { items: [], index: 0, scale: 1, tx: 0, ty: 0 };
  }

  function stepPreview(delta) {
    if (previewState.items.length < 2) return;
    previewState.index = (previewState.index + delta + previewState.items.length) % previewState.items.length;
    renderPreviewBody();
  }

  var REJECT_QUICK = ["身份资料不完整", "身份证照片不清晰", "押金资料有问题", "个人资料不完整", "图片/视频不合格", "录音不合格", "其他"];

  function promptRejectReason() {
    return new Promise(function (resolve) {
      var existing = document.getElementById("playerRejectModal");
      if (existing) existing.remove();
      var modal = document.createElement("div");
      modal.id = "playerRejectModal";
      modal.className = "modal open player-reject-modal";
      modal.setAttribute("aria-hidden", "false");
      modal.innerHTML =
        '<div class="modal-card player-reject-card"><h3>驳回原因</h3>' +
        '<textarea data-reject-text rows="3" placeholder="请填写驳回原因（必填）"></textarea>' +
        '<div class="player-reject-quick">' +
        REJECT_QUICK.map(function (r) {
          return '<button type="button" class="mini-btn" data-reject-chip="' + esc(r) + '">' + esc(r) + "</button>";
        }).join("") +
        '</div><div class="form-actions"><button class="btn danger-btn" type="button" data-reject-ok>确认驳回</button>' +
        '<button class="btn" type="button" data-reject-cancel>取消</button></div></div>';
      document.body.appendChild(modal);
      var ta = modal.querySelector("[data-reject-text]");
      modal.addEventListener("click", function (ev) {
        var chip = ev.target.closest("[data-reject-chip]");
        if (chip) {
          ta.value = chip.getAttribute("data-reject-chip") || "";
          return;
        }
        if (ev.target.closest("[data-reject-cancel]") || ev.target === modal) {
          modal.remove();
          resolve("");
          return;
        }
        if (ev.target.closest("[data-reject-ok]")) {
          var reason = String(ta.value || "").trim();
          if (!reason) {
            alert("驳回原因不能为空");
            return;
          }
          modal.remove();
          resolve(reason);
        }
      });
    });
  }

  function runQuickReview(form, status) {
    var appStatus = String(form.getAttribute("data-app-status") || "").toLowerCase();
    if (/^draft$|草稿/.test(appStatus)) {
      alert("草稿不可审核，请等陪玩正式提交后再审核。");
      return;
    }
    if (!/pending|review|submitted|审核中|待审核/.test(appStatus) && status === "approved") {
      alert("当前状态不可一键通过（仅待审核可通过）。");
      return;
    }
    var nick =
      (form.querySelector(".player-review-bar-meta strong") &&
        form.querySelector(".player-review-bar-meta strong").textContent) ||
      "";
    var payload = { status: status, rejectReason: "" };
    if (status === "approved") {
      if (!window.confirm("确认通过该陪玩申请？\n陪玩：" + (nick || "—"))) return;
      var levelEl =
        form.querySelector("[data-player-quick-level]") || form.querySelector('[name="levelId"]');
      var levelVal = levelEl ? String(levelEl.value || "").trim() : "";
      if (!levelVal) {
        alert("无法通过：必须选择陪玩等级。禁止无等级默认 Lv1。");
        var split = form.querySelector('[data-player-detail-section="split"]');
        if (split) split.open = true;
        return;
      }
      var lv = findLevelByValue(levelVal, getLevels());
      var base = levelBasePriceOf(lv);
      if (!(base > 0)) {
        alert("无法通过：所选等级缺少有效的基础价格 base_price。");
        return;
      }
      payload.levelId = levelVal;
      payload.level_id = levelVal;
      if (lv) {
        payload.levelName = lv.name || "";
        payload.level_name = lv.name || "";
      }
      doReview();
    } else {
      promptRejectReason().then(function (reason) {
        if (!reason) return;
        payload.rejectReason = reason;
        doReview();
      });
    }
    function doReview() {
      apiPost({
        action: "review_application",
        id: form.getAttribute("data-player-id"),
        payload: payload,
      })
        .then(function (res) {
          var msg = res.message || (status === "approved" ? "已通过" : "已驳回");
          if (status === "approved") {
            if (res.hallVisible) msg = "已通过，已同步进入陪玩大厅";
            else if (res.approvedButHidden) {
              msg =
                "已通过，但未进入大厅：" +
                ((res.blockReasons && res.blockReasons.join("、")) || "请检查资料完整性");
            }
          }
          alert(msg);
          if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadDetail) {
            window.MCJAdminPlayerBridge.reloadDetail(form.getAttribute("data-player-id"), "edit");
          }
          if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadList) {
            window.MCJAdminPlayerBridge.reloadList();
          }
        })
        .catch(function (err) {
          var extra =
            err && Array.isArray(err.blockReasons) && err.blockReasons.length
              ? "\n原因：" + err.blockReasons.join("、")
              : "";
          alert((err.message || "审核失败") + extra);
        });
    }
  }

  window.MCJAdminPlayerDetail = {
    render: render,
    fetchDetail: apiGetDetail,
    apiPost: apiPost,
    ensureVoiceCatalog: loadVoiceCatalog,
    openPreview: openPreview,
    closePreview: closePreview,
    setSaving: function (v) {
      saving = !!v;
    },
    isSaving: function () {
      return saving;
    },
  };

  // Warm voice catalog for admin companion edit.
  loadVoiceCatalog();

  document.addEventListener("click", function (e) {
    var preview = e.target.closest("[data-player-preview-src]");
    if (preview) {
      var gallery = parseGalleryAttr(preview);
      var gIndex = preview.getAttribute("data-player-gallery-index");
      openPreview(
        preview.getAttribute("data-player-preview-src"),
        preview.getAttribute("data-player-preview-title"),
        gallery,
        gIndex
      );
      var form = preview.closest("[data-player-detail-form]");
      var id = form && form.getAttribute("data-player-id");
      if (id && /身份证|押金/.test(preview.getAttribute("data-player-preview-title") || "")) {
        apiPost({
          action: "view_identity_image",
          id: id,
          payload: { side: preview.getAttribute("data-player-preview-title") },
        }).catch(function () {});
      }
      return;
    }
    if (e.target.closest("[data-player-preview-close]")) {
      closePreview();
      return;
    }
    if (e.target.closest("[data-player-preview-prev]")) {
      stepPreview(-1);
      return;
    }
    if (e.target.closest("[data-player-preview-next]")) {
      stepPreview(1);
      return;
    }
    var oneClick = e.target.closest("[data-player-one-click]");
    if (oneClick) {
      var formQuick = oneClick.closest("[data-player-detail-form]");
      if (!formQuick) return;
      runQuickReview(formQuick, oneClick.getAttribute("data-player-one-click") === "reject" ? "rejected" : "approved");
      return;
    }
    var reveal = e.target.closest("[data-player-reveal]");
    if (reveal) {
      var form2 = reveal.closest("[data-player-detail-form]");
      if (!form2) return;
      var pid = form2.getAttribute("data-player-id");
      var kind = reveal.getAttribute("data-player-reveal");
      reveal.disabled = true;
      var prevLabel = reveal.textContent;
      reveal.textContent = "读取中…";
      apiPost({
        action: kind === "bank" ? "reveal_bank_account" : "reveal_identity_no",
        id: pid,
        payload: {},
      })
        .then(function (res) {
          if (kind === "identity") {
            var box = form2.querySelector("[data-player-identity-full]");
            if (box) box.textContent = " " + (res.identityNo || "");
            reveal.textContent = prevLabel || "查看完整号码";
          } else {
            fillRevealedPayment(form2, res.payment || {});
            reveal.textContent = "已显示完整资料";
          }
          alert(res.message || "已显示完整资料（已记入操作日志）");
        })
        .catch(function (err) {
          reveal.textContent = prevLabel || "查看完整收款资料";
          alert(err.message || "查看失败");
        })
        .finally(function () {
          reveal.disabled = false;
        });
      return;
    }
    var copyBtn = e.target.closest("[data-payout-copy]");
    if (copyBtn) {
      var key = copyBtn.getAttribute("data-payout-copy") || "";
      var formCopy = copyBtn.closest("[data-player-detail-form]");
      var slot = formCopy && formCopy.querySelector('[data-payout-full="' + key + '"]');
      var value = copyBtn.dataset.copyValue || (slot && (slot.dataset.copyValue || slot.textContent)) || "";
      copyText(value)
        .then(function () {
          var old = copyBtn.textContent;
          copyBtn.textContent = "已复制";
          setTimeout(function () {
            copyBtn.textContent = old || "复制";
          }, 1200);
        })
        .catch(function (err) {
          alert(err.message || "复制失败");
        });
      return;
    }
    var reviewSave = e.target.closest("[data-player-review-save]");
    if (reviewSave) {
      var form3 = reviewSave.closest("[data-player-detail-form]");
      var wrap = reviewSave.closest("[data-player-review]");
      if (!form3 || !wrap) return;
      var kind2 = reviewSave.getAttribute("data-player-review-save");
      var status = (wrap.querySelector('[name="reviewStatus"]') || {}).value || "pending";
      var reason = (wrap.querySelector('[name="rejectReason"]') || {}).value || "";
      if ((status === "rejected" || status === "resubmit") && !String(reason).trim()) {
        alert("驳回时必须填写原因");
        return;
      }
      if (kind2 === "application" && status === "approved") {
        var levelEl = form3.querySelector('[name="levelId"]');
        var levelVal = levelEl ? String(levelEl.value || "").trim() : "";
        if (!levelVal) {
          alert("无法通过：必须选择陪玩等级。禁止无等级默认 Lv1。");
          return;
        }
        var levelsNow = getLevels();
        var lv = findLevelByValue(levelVal, levelsNow);
        var base = levelBasePriceOf(lv);
        if (!(base > 0)) {
          alert("无法通过：所选等级缺少有效的基础价格 base_price。");
          return;
        }
      }
      var action =
        kind2 === "identity"
          ? "review_identity"
          : kind2 === "payment"
            ? "review_payment"
            : kind2 === "media"
              ? "review_media"
              : kind2 === "deposit"
                ? "review_deposit"
                : "review_application";
      var payload = { status: status, rejectReason: reason };
      if (kind2 === "application" && status === "approved") {
        var levelEl2 = form3.querySelector('[name="levelId"]');
        var levelVal2 = levelEl2 ? String(levelEl2.value || "").trim() : "";
        payload.levelId = levelVal2;
        payload.level_id = levelVal2;
        var lv2 = findLevelByValue(levelVal2, getLevels());
        if (lv2) {
          payload.levelName = lv2.name || "";
          payload.level_name = lv2.name || "";
        }
        // Do not send applicant/admin free-form price on approve — server seeds from level.base_price.
      }
      apiPost({
        action: action,
        id: form3.getAttribute("data-player-id"),
        payload: payload,
      })
        .then(function (res) {
          var msg = res.message || "审核已保存";
          if (kind2 === "application" && status === "approved") {
            if (res.hallVisible) msg = "已通过，已同步进入陪玩大厅";
            else if (res.approvedButHidden) {
              msg =
                "已通过，但未进入大厅：" +
                ((res.blockReasons && res.blockReasons.join("、")) || "请检查资料完整性");
            }
          }
          alert(msg);
          if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadDetail) {
            window.MCJAdminPlayerBridge.reloadDetail(form3.getAttribute("data-player-id"), form3.getAttribute("data-player-mode") || "edit");
          }
        })
        .catch(function (err) {
          var extra =
            err && Array.isArray(err.blockReasons) && err.blockReasons.length
              ? "\n原因：" + err.blockReasons.join("、")
              : "";
          alert((err.message || "审核失败") + extra);
        });
      return;
    }
    var mediaReview = e.target.closest("[data-player-media-review]");
    if (mediaReview) {
      var form4 = mediaReview.closest("[data-player-detail-form]");
      if (!form4) return;
      var st = mediaReview.getAttribute("data-status") || "approved";
      var reason2 = st === "rejected" ? prompt("请填写不通过原因：") || "" : "";
      if (st === "rejected" && !reason2.trim()) return;
      apiPost({
        action: "review_media",
        id: form4.getAttribute("data-player-id"),
        payload: { mediaId: mediaReview.getAttribute("data-player-media-review"), status: st, rejectReason: reason2 },
      })
        .then(function (res) {
          alert(res.message || "已更新");
          if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadDetail) {
            window.MCJAdminPlayerBridge.reloadDetail(form4.getAttribute("data-player-id"), "edit");
          }
        })
        .catch(function (err) {
          alert(err.message || "操作失败");
        });
    }
  });
})();
