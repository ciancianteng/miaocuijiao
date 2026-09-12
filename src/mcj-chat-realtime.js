/**
 * Shared Supabase Realtime helper for boss support + CS desk.
 * Loads @supabase/supabase-js from CDN once; dedupes channels by conversation id.
 */
(function (global) {
  var LOCAL = "/vendor/supabase.js";
  var CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.js";
  var state = {
    loading: null,
    client: null,
    config: null,
    channels: {},
    token: "",
    handlers: {},
  };

  function loadScript() {
    if (global.supabase && global.supabase.createClient) return Promise.resolve(global.supabase);
    if (state.loading) return state.loading;
    state.loading = new Promise(function (resolve, reject) {
      function attach(src, isFallback) {
        var s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = function () {
          if (global.supabase && global.supabase.createClient) resolve(global.supabase);
          else if (!isFallback) attach(CDN, true);
          else reject(new Error("Supabase SDK 加载失败"));
        };
        s.onerror = function () {
          if (!isFallback) attach(CDN, true);
          else reject(new Error("Supabase SDK 网络加载失败"));
        };
        document.head.appendChild(s);
      }
      // Prefer same-origin vendor copy (stable in CN); fall back to jsDelivr.
      attach(LOCAL, false);
    });
    return state.loading;
  }

  function fetchConfig() {
    if (state.config) return Promise.resolve(state.config);
    return fetch("/api/public/realtime-config", { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (body) {
        if (!body || !body.ok || !body.url || !body.anonKey) throw new Error((body && body.message) || "Realtime 未配置");
        state.config = body;
        return body;
      });
  }

  function ensureClient(accessToken) {
    return Promise.all([loadScript(), fetchConfig()]).then(function (pair) {
      var sb = pair[0];
      var cfg = pair[1];
      var token = String(accessToken || "").trim();
      if (!state.client) {
        state.client = sb.createClient(cfg.url, cfg.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          realtime: { params: { eventsPerSecond: 8 } },
        });
      }
      if (token && token !== state.token) {
        state.token = token;
        try {
          state.client.realtime.setAuth(token);
        } catch (e) {}
      }
      return state.client;
    });
  }

  function channelKey(conversationId) {
    return "mcj-msg:" + String(conversationId || "");
  }

  function removeChannel(key) {
    var ch = state.channels[key];
    if (!ch) return;
    try {
      if (state.client) state.client.removeChannel(ch);
    } catch (e) {}
    delete state.channels[key];
  }

  function unsubscribe(conversationId) {
    removeChannel(channelKey(conversationId));
  }

  function unsubscribeAll() {
    Object.keys(state.channels).forEach(function (k) {
      removeChannel(k);
    });
  }

  function subscribeConversations(accessToken, handlers) {
    handlers = handlers || {};
    var key = "mcj-conv:pool";
    state.handlers[key] = handlers;
    removeChannel(key);
    return ensureClient(accessToken).then(function (client) {
      var retries = 0;
      function attach() {
        var channel = client.channel(key + (retries ? ":r" + retries : ""));
        ["INSERT", "UPDATE"].forEach(function (event) {
          channel = channel.on(
            "postgres_changes",
            { event: event, schema: "public", table: "conversations" },
            function (payload) {
              var row = (payload && payload.new) || null;
              if (!row) return;
              try {
                var h = state.handlers[key] || handlers;
                if (typeof h.onChange === "function") h.onChange(row, event);
              } catch (e) {}
            }
          );
        });
        channel = channel.on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          function (payload) {
            var row = (payload && payload.new) || null;
            if (!row) return;
            try {
              var h = state.handlers[key] || handlers;
              if (typeof h.onMessage === "function") h.onMessage(row);
            } catch (e) {}
          }
        );
        channel.subscribe(function (status) {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            try {
              var hErr = state.handlers[key] || handlers;
              if (typeof hErr.onError === "function") hErr.onError(status);
            } catch (e) {}
            if (retries >= 4) return;
            retries += 1;
            removeChannel(key);
            setTimeout(function () {
              if (state.channels[key]) return;
              if (!state.handlers[key]) return;
              attach();
            }, 1000 * retries);
          } else if (status === "SUBSCRIBED") {
            retries = 0;
            try {
              var hOk = state.handlers[key] || handlers;
              if (typeof hOk.onReady === "function") hOk.onReady();
            } catch (e) {}
          }
        });
        state.channels[key] = channel;
        return channel;
      }
      return attach();
    });
  }

  /**
   * Subscribe to INSERT on messages for one conversation.
   * onInsert(row) receives raw DB row.
   */
  function subscribeMessages(conversationId, accessToken, onInsert) {
    var cid = String(conversationId || "").trim();
    if (!cid || typeof onInsert !== "function") return Promise.resolve(null);
    var key = channelKey(cid);
    state.handlers[key] = { onInsert: onInsert };
    unsubscribe(cid);
    return ensureClient(accessToken).then(function (client) {
      var retries = 0;
      function attach() {
        var channel = client
          .channel(key + (retries ? ":r" + retries : ""))
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "messages",
              filter: "conversation_id=eq." + cid,
            },
            function (payload) {
              var row = (payload && payload.new) || null;
              if (!row) return;
              try {
                var h = state.handlers[key];
                var fn = (h && h.onInsert) || onInsert;
                fn(row);
              } catch (e) {}
            }
          )
          .subscribe(function (status) {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              if (retries >= 4) return;
              retries += 1;
              removeChannel(key);
              setTimeout(function () {
                if (state.channels[key]) return;
                if (!state.handlers[key]) return;
                attach();
              }, 1200 * retries);
            } else if (status === "SUBSCRIBED") {
              retries = 0;
            }
          });
        state.channels[key] = channel;
        return channel;
      }
      return attach();
    });
  }

  /** Re-auth + re-subscribe known channels after tab wake / token refresh. */
  function reconnect(accessToken) {
    var token = String(accessToken || state.token || "").trim();
    return ensureClient(token).then(function (client) {
      try {
        if (token) client.realtime.setAuth(token);
      } catch (e) {}
      var keys = Object.keys(state.handlers);
      keys.forEach(function (k) {
        removeChannel(k);
      });
      var jobs = [];
      keys.forEach(function (k) {
        var h = state.handlers[k];
        if (!h) return;
        if (k === "mcj-conv:pool") {
          jobs.push(subscribeConversations(token, h));
        } else if (k.indexOf("mcj-msg:") === 0 && typeof h.onInsert === "function") {
          jobs.push(subscribeMessages(k.slice("mcj-msg:".length), token, h.onInsert));
        } else if (k.indexOf("mcj-companion-orders:") === 0) {
          jobs.push(subscribeCompanionOrders(k.slice("mcj-companion-orders:".length), token, h));
        } else if (k.indexOf("mcj-orders:") === 0) {
          jobs.push(subscribeCompanionOrders(k.slice("mcj-orders:".length), token, h));
        }
      });
      return Promise.all(jobs);
    });
  }

  /**
   * Companion-scoped order sync:
   * - postgres_changes on public.orders filtered by companion_id (needs publication)
   * - broadcast topic mcj-companion-orders:{uid} as fallback when server fires assign
   */
  function subscribeCompanionOrders(companionId, accessToken, handlers) {
    var uid = String(companionId || "").trim();
    if (!uid || !handlers) return Promise.resolve(null);
    var key = "mcj-companion-orders:" + uid;
    state.handlers[key] = handlers;
    removeChannel(key);
    return ensureClient(accessToken).then(function (client) {
      var retries = 0;
      function attach() {
        // Channel topic must match server broadcast topic `mcj-companion-orders:{uid}`.
        // Keep topic stable across reconnects (no :rN suffix) so broadcast still arrives.
        var channel = client.channel(key, {
          config: { broadcast: { self: false } },
        });
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: "companion_id=eq." + uid,
          },
          function (payload) {
            var row = (payload && payload.new) || (payload && payload.old) || null;
            var eventType = (payload && payload.eventType) || "";
            try {
              var h = state.handlers[key] || handlers;
              if (typeof h.onChange === "function") h.onChange(row, eventType, payload);
            } catch (e) {}
          }
        );
        channel.on("broadcast", { event: "order_assigned" }, function (payload) {
          try {
            var h = state.handlers[key] || handlers;
            var body = (payload && payload.payload) || payload || {};
            if (typeof h.onAssigned === "function") h.onAssigned(body);
            else if (typeof h.onChange === "function") h.onChange(body, "BROADCAST", payload);
          } catch (e) {}
        });
        channel.on("broadcast", { event: "order_changed" }, function (payload) {
          try {
            var h = state.handlers[key] || handlers;
            var body = (payload && payload.payload) || payload || {};
            if (typeof h.onChange === "function") h.onChange(body, "BROADCAST", payload);
          } catch (e) {}
        });
        channel.subscribe(function (status) {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            try {
              var hErr = state.handlers[key] || handlers;
              if (typeof hErr.onError === "function") hErr.onError(status);
            } catch (e) {}
            if (retries >= 6) return;
            retries += 1;
            removeChannel(key);
            setTimeout(function () {
              if (state.channels[key]) return;
              if (!state.handlers[key]) return;
              attach();
            }, 1200 * retries);
          } else if (status === "SUBSCRIBED") {
            retries = 0;
            try {
              var hOk = state.handlers[key] || handlers;
              if (typeof hOk.onReady === "function") hOk.onReady();
            } catch (e) {}
          }
        });
        state.channels[key] = channel;
        return channel;
      }
      return attach();
    });
  }

  if (!global.__MCJChatRealtimeVisBound) {
    global.__MCJChatRealtimeVisBound = true;
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      if (!state.client || !Object.keys(state.handlers).length) return;
      reconnect(state.token).catch(function () {});
    });
  }

  global.MCJChatRealtime = {
    ensureClient: ensureClient,
    subscribeMessages: subscribeMessages,
    subscribeConversations: subscribeConversations,
    subscribeCompanionOrders: subscribeCompanionOrders,
    unsubscribe: unsubscribe,
    unsubscribeAll: unsubscribeAll,
    reconnect: reconnect,
  };
})(typeof window !== "undefined" ? window : globalThis);
