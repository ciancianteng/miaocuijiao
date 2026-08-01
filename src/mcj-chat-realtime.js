/**
 * Shared Supabase Realtime helper for boss support + CS desk.
 * Loads @supabase/supabase-js from CDN once; dedupes channels by conversation id.
 */
(function (global) {
  var CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.js";
  var state = {
    loading: null,
    client: null,
    config: null,
    channels: {},
    token: "",
  };

  function loadScript() {
    if (global.supabase && global.supabase.createClient) return Promise.resolve(global.supabase);
    if (state.loading) return state.loading;
    state.loading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = CDN;
      s.async = true;
      s.onload = function () {
        if (global.supabase && global.supabase.createClient) resolve(global.supabase);
        else reject(new Error("Supabase SDK 加载失败"));
      };
      s.onerror = function () {
        reject(new Error("Supabase SDK 网络加载失败"));
      };
      document.head.appendChild(s);
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

  function unsubscribe(conversationId) {
    var key = channelKey(conversationId);
    var ch = state.channels[key];
    if (!ch) return;
    try {
      if (state.client) state.client.removeChannel(ch);
    } catch (e) {}
    delete state.channels[key];
  }

  function unsubscribeAll() {
    Object.keys(state.channels).forEach(function (k) {
      var ch = state.channels[k];
      try {
        if (state.client && ch) state.client.removeChannel(ch);
      } catch (e) {}
      delete state.channels[k];
    });
  }

  function subscribeConversations(accessToken, handlers) {
    handlers = handlers || {};
    var key = "mcj-conv:pool";
    var existing = state.channels[key];
    if (existing) {
      try {
        if (state.client) state.client.removeChannel(existing);
      } catch (e) {}
      delete state.channels[key];
    }
    return ensureClient(accessToken).then(function (client) {
      var channel = client.channel(key);
      ["INSERT", "UPDATE"].forEach(function (event) {
        channel = channel.on(
          "postgres_changes",
          { event: event, schema: "public", table: "conversations" },
          function (payload) {
            var row = (payload && payload.new) || null;
            if (!row) return;
            try {
              if (typeof handlers.onChange === "function") handlers.onChange(row, event);
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
            if (typeof handlers.onMessage === "function") handlers.onMessage(row);
          } catch (e) {}
        }
      );
      channel.subscribe();
      state.channels[key] = channel;
      return channel;
    });
  }

  /**
   * Subscribe to INSERT on messages for one conversation.
   * onInsert(row) receives raw DB row.
   */
  function subscribeMessages(conversationId, accessToken, onInsert) {
    var cid = String(conversationId || "").trim();
    if (!cid || typeof onInsert !== "function") return Promise.resolve(null);
    unsubscribe(cid);
    return ensureClient(accessToken).then(function (client) {
      var key = channelKey(cid);
      var channel = client
        .channel(key)
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
              onInsert(row);
            } catch (e) {}
          }
        )
        .subscribe(function (status) {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // Keep a quiet fail — callers may keep a slow backup poll.
          }
        });
      state.channels[key] = channel;
      return channel;
    });
  }

  global.MCJChatRealtime = {
    ensureClient: ensureClient,
    subscribeMessages: subscribeMessages,
    subscribeConversations: subscribeConversations,
    unsubscribe: unsubscribe,
    unsubscribeAll: unsubscribeAll,
  };
})(typeof window !== "undefined" ? window : globalThis);
