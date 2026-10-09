(function () {
  "use strict";

  var CFG = window.BX_SUPABASE || {};
  var FN = String(CFG.url || "").replace(/\/$/, "") + "/functions/v1/support-visitor";
  var CATEGORIES = [
    "Не подключается VPN",
    "Проблема с подпиской",
    "Не работает сервер",
    "Проблема с оплатой",
    "Другой вопрос"
  ];

  function $(id) { return document.getElementById(id); }

  var el = {
    root: $("spRoot"), wrap: $("spWrap"), empty: $("spEmpty"), thread: $("spThread"),
    quick: $("spQuick"), quick2: $("spQuick2"), quickBar: $("spQuickBar"), plus: $("spPlus"),
    form: $("spForm"), text: $("spText"), send: $("spSend"),
    unread: $("spUnread"), unreadN: $("spUnreadN"),
    closedBar: $("spClosedBar"), newBtn: $("spNewBtn"),
    chip: $("spChip"), chipText: $("spChipText"), chipX: $("spChipX"),
    menuBtn: $("spMenuBtn"), menu: $("spMenu"), notifyBtn: $("spNotifyBtn"),
    toast: $("spToast")
  };

  var sb = null, session = null, uid = null;
  var conv = null, msgs = [], channel = null;
  var rendered = Object.create(null), lastDay = null, lastSender = null;
  var ready = false, sending = false, newCount = 0, sendSeq = 0;
  var selectedCategory = null, readTimer = null, statusTimer = null;

  var typingNode = document.createElement("div");
  typingNode.className = "sp__typing";
  typingNode.innerHTML = '<div class="sp__av" aria-hidden="true"></div><span class="sp__dots"><i></i><i></i><i></i></span>';

  /* ---------------- helpers ---------------- */

  function esc(s) {
    return String(s == null ? "" : s);
  }

  function fmtTime(t) {
    try {
      return new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  function dayKey(t) {
    var d = new Date(t);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function fmtDay(t) {
    var d = new Date(t), today = new Date();
    var y = new Date(today.getTime() - 86400000);
    if (dayKey(d) === dayKey(today)) return "Сегодня";
    if (dayKey(d) === dayKey(y)) return "Вчера";
    try {
      return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return ""; }
  }

  function atBottom() {
    return el.wrap.scrollHeight - el.wrap.scrollTop - el.wrap.clientHeight < 90;
  }

  function scrollToBottom(smooth) {
    try {
      el.wrap.scrollTo({ top: el.wrap.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    } catch (e) { el.wrap.scrollTop = el.wrap.scrollHeight; }
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    el.toast.classList.toggle("is-err", !!isErr);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3600);
  }

  function ls(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }

  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) {}
  }

  function headers() {
    return {
      apikey: CFG.key,
      Authorization: "Bearer " + session.access_token,
      "Content-Type": "application/json"
    };
  }

  /* ---------------- приветствие / быстрые категории ---------------- */

  function closeQuickBar() {
    el.quickBar.hidden = true;
    el.plus.classList.remove("is-open");
  }

  function renderQuick() {
    var boxes = [el.quick, el.quick2];
    CATEGORIES.forEach(function (cat) {
      for (var i = 0; i < boxes.length; i++) {
        if (!boxes[i]) continue;
        var b = document.createElement("button");
        b.type = "button";
        b.className = "sp__qbtn";
        b.textContent = cat;
        b.addEventListener("click", function () {
          selectedCategory = cat;
          el.chipText.textContent = cat;
          el.chip.hidden = false;
          closeQuickBar();
          el.text.focus();
        });
        boxes[i].appendChild(b);
      }
    });
  }

  function clearChip() {
    selectedCategory = null;
    el.chip.hidden = true;
  }

  /* ---------------- отрисовка ---------------- */

  function updateSendState() {
    var ok = ready && !sending && el.text.value.trim().length > 0;
    el.send.disabled = !ok;
  }

  function renderShell() {
    var has = !!conv || msgs.length > 0;
    el.empty.hidden = has;
    el.thread.hidden = !has;
    el.closedBar.hidden = !(conv && conv.status === "closed");
    updateSendState();
  }

  /* ---------------- авто-сообщения из меню ---------------- */

  var INFO = {
    pricing:
      "Тарифы BYNEXVPN:\n\n" +
      "1 месяц — 250 ₽\n" +
      "3 месяца — 650 ₽ (≈ 217 ₽/мес)\n" +
      "6 месяцев — 1250 ₽ (≈ 208 ₽/мес)\n" +
      "12 месяцев — 2500 ₽ (≈ 208 ₽/мес) · выгодно\n\n" +
      "В каждом тарифе: 5 устройств, все страны, максимальная скорость и премиальная поддержка.\n\n" +
      "Подключить: t.me/BynexVPN_rubot",
    advantages:
      "Преимущества BYNEXVPN:\n\n" +
      "01 · Мгновенное подключение — подключайтесь к защищённым серверам за несколько секунд.\n\n" +
      "02 · Все устройства — Windows / macOS / iOS / Android и другие платформы.\n\n" +
      "03 · Приватность — ваш трафик защищён в любой сети.\n\n" +
      "04 · Управление — контроль подписки из одного кабинета."
  };

  function showInfo(key, silent) {
    if (!INFO[key]) return;
    var m = {
      id: "bx-info-" + key,
      sender: "system",
      body: INFO[key],
      created_at: new Date().toISOString()
    };
    if (!rendered[m.id]) appendMsg(m);
    var node = rendered[m.id];
    if (node) node.classList.add("sp__m--info");
    try { sessionStorage.setItem("bx_sp_info_" + key, "1"); } catch (e) {}
    if (silent) return;
    renderShell();
    scrollToBottom(true);
  }

  function restoreInfos() {
    var keys = ["pricing", "advantages"];
    for (var i = 0; i < keys.length; i++) {
      try {
        if (sessionStorage.getItem("bx_sp_info_" + keys[i]) === "1") showInfo(keys[i], true);
      } catch (e) {}
    }
  }

  function makeDaySep(t) {
    var sep = document.createElement("div");
    sep.className = "sp__day";
    sep.textContent = fmtDay(t);
    return sep;
  }

  function nodeFor(m) {
    var wrap = document.createElement("div");
    var kind = m.sender === "visitor" ? "me" : (m.sender === "operator" ? "op" : "sys");
    wrap.className = "sp__m sp__m--" + kind;
    wrap.dataset.id = m.id;

    var body = document.createElement("div");
    body.className = "sp__b";
    body.textContent = esc(m.body);

    var time = document.createElement("span");
    time.className = "sp__t";
    time.textContent = fmtTime(m.created_at);

    if (kind === "op") {
      var first = lastSender !== "operator";
      var row = document.createElement("div");
      row.className = "sp__row" + (first ? "" : " sp__row--cont");

      if (first) {
        var av = document.createElement("div");
        av.className = "sp__av";
        av.setAttribute("aria-hidden", "true");
        row.appendChild(av);
      }

      var col = document.createElement("div");
      col.className = "sp__col";
      col.appendChild(body);
      col.appendChild(time);
      row.appendChild(col);
      wrap.appendChild(row);
    } else if (kind === "me") {
      var meta = document.createElement("span");
      meta.className = "sp__meta";
      meta.appendChild(time);
      var chk = document.createElement("span");
      chk.className = "sp__check" + (m.read_at ? " is-read" : "");
      chk.textContent = "✓✓";
      meta.appendChild(chk);
      body.appendChild(meta);
      wrap.appendChild(body);
    } else {
      wrap.appendChild(body);
      wrap.appendChild(time);
    }

    lastSender = m.sender;
    return wrap;
  }

  function appendMsg(m) {
    if (!m || !m.id || rendered[m.id]) return false;
    var dk = dayKey(m.created_at);
    if (dk !== lastDay) {
      lastDay = dk;
      el.thread.insertBefore(makeDaySep(m.created_at), typingNode);
    }
    var node = nodeFor(m);
    rendered[m.id] = node;
    msgs.push(m);
    el.thread.insertBefore(node, typingNode);
    return true;
  }

  function paintAll() {
    el.thread.textContent = "";
    rendered = Object.create(null);
    lastDay = null;
    lastSender = null;
    el.thread.appendChild(typingNode);
    msgs.forEach(function (m) { appendMsg(m); });
    restoreInfos();
  }

  function appendPending(text) {
    var id = "tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    var node = nodeFor({ id: id, sender: "visitor", body: text, created_at: new Date().toISOString() });
    node.classList.add("sp__m--pending");
    node.dataset.tmp = "1";
    el.thread.insertBefore(node, typingNode);
    return node;
  }

  function localSystem(text, id) {
    if (rendered[id]) return;
    var node = nodeFor({ id: id, sender: "system", body: text, created_at: new Date().toISOString() });
    rendered[id] = node;
    el.thread.insertBefore(node, typingNode);
  }

  /* ---------------- непрочитанные / статус заголовка ---------------- */

  function resetTitle() {
    document.title = "Поддержка — BYNEXVPN";
  }

  function bumpTitle() {
    document.title = "(" + (newCount || 1) + ") Поддержка — BYNEXVPN";
  }

  function showUnread() {
    if (newCount <= 0) { el.unread.hidden = true; return; }
    el.unreadN.textContent = String(newCount);
    el.unread.hidden = false;
    bumpTitle();
  }

  function hideUnread() {
    newCount = 0;
    el.unread.hidden = true;
    resetTitle();
  }

  function scheduleMarkRead() {
    clearTimeout(readTimer);
    readTimer = setTimeout(markRead, 700);
  }

  function markRead() {
    if (!conv || !session) return;
    var need = false;
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].sender !== "visitor" && !msgs[i].read_at) { need = true; break; }
    }
    if (!need && !conv.unread_visitor) return;
    var nowIso = new Date().toISOString();
    sb.from("support_messages")
      .update({ read_at: nowIso })
      .eq("conversation_id", conv.id)
      .neq("sender", "visitor")
      .is("read_at", null)
      .then(function () {
        return sb.from("support_conversations").update({ unread_visitor: 0 }).eq("id", conv.id);
      })
      .then(function () {
        conv.unread_visitor = 0;
        msgs.forEach(function (m) { if (m.sender !== "visitor" && !m.read_at) m.read_at = nowIso; });
      })
      .catch(function () {});
  }

  /* ---------------- статус операторов ---------------- */

  function paintStatus(text, online) {
    var dots = document.querySelectorAll(".js-dot");
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle("is-online", !!online);
      dots[i].classList.toggle("is-busy", !online);
    }
    var texts = document.querySelectorAll(".js-stat");
    for (var j = 0; j < texts.length; j++) texts[j].textContent = text;
  }

  function setOnline(online) {
    paintStatus(online ? "Онлайн" : "Не в сети", !!online);
  }

  function fetchStatus() {
    if (!session) return;
    fetch(FN, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action: "status" })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (d && typeof d.operators_online === "boolean") setOnline(d.operators_online);
      else fallbackStatus();
    }).catch(fallbackStatus);
  }

  function fallbackStatus() {
    if (conv && conv.last_operator_activity_at &&
        Date.now() - Date.parse(conv.last_operator_activity_at) < 150000) {
      setOnline(true);
    } else if (conv && (conv.status === "operator_active" || conv.status === "waiting_for_visitor")) {
      setOnline(true);
    } else {
      setOnline(false);
    }
  }

  /* ---------------- «печатает…» / долгое ожидание ---------------- */

  function updateTyping() {
    var fresh = !!(conv && conv.operator_typing_at &&
      Date.now() - Date.parse(conv.operator_typing_at) < 8000 &&
      conv.status !== "closed");
    var was = typingNode.classList.contains("is-on");
    typingNode.classList.toggle("is-on", fresh);
    if (fresh && !was && atBottom()) scrollToBottom(true);
  }

  function maybeNudge() {
    if (!conv || conv.status !== "waiting_for_operator") return;
    var last = Date.parse(conv.last_message_at || conv.updated_at || conv.created_at);
    if (!last || Date.now() - last < 10 * 60 * 1000) return;
    var key = "bx_sp_nudge_" + conv.id;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch (e) {}
    localSystem("Нам потребуется немного больше времени для решения вопроса. Спасибо за ожидание.", "nudge-" + conv.id);
    if (atBottom()) scrollToBottom(true);
  }

  /* ---------------- realtime ---------------- */

  function onInsert(row) {
    if (!row || rendered[row.id]) return;
    var wasBottom = atBottom();
    appendMsg(row);
    if (row.sender !== "visitor") {
      scheduleMarkRead();
      if (document.hidden) notify("Поддержка BynexVPN", row.body);
      if (wasBottom) scrollToBottom(true);
      else { newCount++; showUnread(); }
    } else if (wasBottom) {
      scrollToBottom(true);
    }
    updateTyping();
  }

  function onConv(row) {
    if (!row) return;
    conv = Object.assign({}, conv, row);
    renderShell();
    maybeNudge();
    updateTyping();
    if (atBottom()) scrollToBottom(true);
  }

  function subscribe() {
    if (channel) { try { sb.removeChannel(channel); } catch (e) {} channel = null; }
    if (!conv) return;
    channel = sb.channel("bx-support-" + conv.id)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: "conversation_id=eq." + conv.id },
        function (p) { onInsert(p.new); })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "support_conversations", filter: "id=eq." + conv.id },
        function (p) { onConv(p.new); })
      .subscribe(function () {});
  }

  /* ---------------- уведомления браузера ---------------- */

  function notify(title, body) {
    if (ls("bx_sp_notify") !== "1") return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      new Notification(title, {
        body: String(body || "").slice(0, 160),
        icon: "../logo.png",
        tag: "bx-support"
      });
    } catch (e) {}
  }

  function initNotify() {
    if (!("Notification" in window)) return;
    el.notifyBtn.hidden = false;
    var sync = function () {
      el.notifyBtn.classList.toggle("is-on", ls("bx_sp_notify") === "1" && Notification.permission === "granted");
    };
    sync();
    el.notifyBtn.addEventListener("click", function () {
      var p = Notification.permission;
      var done = function (perm) {
        var ok = perm === "granted";
        lsSet("bx_sp_notify", ok ? "1" : "0");
        sync();
        closeMenu();
        toast(ok ? "Уведомления включены" : "Уведомления не разрешены", !ok);
      };
      if (p === "granted") { done("granted"); return; }
      if (p === "denied") { done("denied"); return; }
      var res = Notification.requestPermission(done);
      if (res && typeof res.then === "function") res.then(done).catch(function () {});
    });
  }

  function closeMenu() {
    el.menu.hidden = true;
    el.menuBtn.setAttribute("aria-expanded", "false");
  }

  /* ---------------- отправка ---------------- */

  function apiSend(action, payload) {
    payload.action = action;
    return fetch(FN, { method: "POST", headers: headers(), body: JSON.stringify(payload) })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (d) {
          if (!r.ok) {
            var err = new Error((d && d.error) || "HTTP " + r.status);
            err.status = r.status;
            throw err;
          }
          return d;
        });
      });
  }

  function send(text) {
    if (sending || !ready || !session) return false;
    var flight = ++sendSeq;
    sending = true;
    updateSendState();

    var node = appendPending(text);
    var payload = {
      text: text,
      category: selectedCategory,
      bx_vid: ls("bx_vid")
    };

    apiSend("send", payload).then(function (data) {
      var prevId = conv && conv.id;
      conv = data.conversation;
      if (node.parentNode) node.parentNode.removeChild(node);

      if (prevId !== conv.id) {
        clearChip();
        return loadMsgs().then(function () {
          paintAll();
          subscribe();
          renderShell();
          maybeNudge();
          scrollToBottom(false);
          markReadSoonFirst();
        });
      } else {
        if (data.message) appendMsg(data.message);
        clearChip();
        renderShell();
        maybeNudge();
        scrollToBottom(true);
        scheduleMarkRead();
      }
      if (typeof data.operators_online === "boolean") setOnline(data.operators_online);
    }).catch(function (e) {
      if (node.parentNode) node.parentNode.removeChild(node);
      if (e && e.status === 401) {
        sb.auth.refreshSession().then(function (r) {
          if (r.data && r.data.session) {
            session = r.data.session;
            sending = false;
            send(text);
          } else {
            toast("Сессия истекла. Обновите страницу.", true);
          }
        }).catch(function () {
          toast("Не удалось отправить. Попробуйте ещё раз.", true);
        });
        return;
      }
      if (!el.text.value.trim()) el.text.value = text;
      autoGrow();
      updateSendState();
      if (e && e.status === 404) toast("Поддержка временно недоступна. Попробуйте позже.", true);
      else if (e && e.status === 429) toast("Слишком часто. Подождите немного и повторите.", true);
      else toast("Не удалось отправить. Попробуйте ещё раз.", true);
      console.error("[support]", e);
    }).then(function () {
      if (flight !== sendSeq) return;
      sending = false;
      updateSendState();
    });
    return true;
  }

  function markReadSoonFirst() {
    setTimeout(markRead, 900);
  }

  /* ---------------- загрузка ---------------- */

  function ensureAuth() {
    return sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) return r.data.session;
      return sb.auth.signInAnonymously().then(function (r2) {
        if (r2.error) throw r2.error;
        return r2.data.session;
      });
    }).then(function (s) {
      session = s;
      uid = s.user.id;
      sb.auth.onAuthStateChange(function (_e, s2) {
        if (s2) { session = s2; uid = s2.user.id; }
      });
    });
  }

  function loadConv() {
    return sb.from("support_conversations")
      .select("*")
      .eq("visitor_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(function (r) {
        if (r.error) throw r.error;
        conv = (r.data && r.data[0]) || null;
      });
  }

  function loadMsgs() {
    if (!conv) { msgs = []; return Promise.resolve(); }
    return sb.from("support_messages")
      .select("id,conversation_id,sender,body,read_at,created_at")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(500)
      .then(function (r) {
        if (r.error) throw r.error;
        msgs = r.data || [];
      });
  }

  /* ---------------- ввод ---------------- */

  function autoGrow() {
    el.text.style.height = "auto";
    el.text.style.height = Math.min(el.text.scrollHeight, 132) + "px";
  }

  /* ---------------- события ---------------- */

  function wire() {
    el.form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = el.text.value.trim();
      if (!text) return;
      if (!send(text)) return;
      el.text.value = "";
      autoGrow();
      updateSendState();
    });

    el.text.addEventListener("input", function () {
      autoGrow();
      updateSendState();
    });

    el.text.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (el.text.value.trim()) el.form.requestSubmit ? el.form.requestSubmit() : el.form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });

    el.chipX.addEventListener("click", clearChip);

    var infoLinks = document.querySelectorAll("[data-info]");
    for (var i = 0; i < infoLinks.length; i++) {
      infoLinks[i].addEventListener("click", function (e) {
        e.preventDefault();
        closeMenu();
        showInfo(this.getAttribute("data-info"));
      });
    }

    el.menuBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = el.menu.hidden;
      el.menu.hidden = !open;
      el.menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", function (e) {
      if (el.menu.hidden) return;
      if (!el.menu.contains(e.target) && !el.menuBtn.contains(e.target)) closeMenu();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });

    el.plus.addEventListener("click", function () {
      var show = el.quickBar.hidden;
      el.quickBar.hidden = !show;
      el.plus.classList.toggle("is-open", show);
    });

    el.unread.addEventListener("click", function () {
      hideUnread();
      scrollToBottom(true);
    });

    el.newBtn.addEventListener("click", function () {
      el.text.focus();
      toast("Напишите сообщение — создадим новое обращение");
    });

    el.wrap.addEventListener("scroll", function () {
      if (atBottom()) hideUnread();
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        if (atBottom()) hideUnread();
        scheduleMarkRead();
        fetchStatus();
      }
    });

    setInterval(function () {
      updateTyping();
    }, 2000);

    statusTimer = setInterval(fetchStatus, 60000);

    if (window.visualViewport) {
      var vv = function () {
        try {
          document.documentElement.style.setProperty("--vvh", Math.round(window.visualViewport.height) + "px");
        } catch (e) {}
      };
      window.visualViewport.addEventListener("resize", vv);
      window.visualViewport.addEventListener("scroll", vv);
      vv();
    }

    window.addEventListener("beforeunload", function () {
      if (channel) { try { sb.removeChannel(channel); } catch (e) {} }
    });
  }

  /* ---------------- boot ---------------- */

  function fail(msg, err) {
    ready = false;
    updateSendState();
    paintStatus(msg, false);
    if (err) console.error("[support]", err);
  }

  function boot() {
    renderQuick();
    initNotify();
    wire();

    if (!CFG.url || !CFG.key) {
      fail("Поддержка не подключена");
      return;
    }
    if (typeof supabase === "undefined" || !supabase.createClient) {
      fail("Поддержка временно недоступна");
      console.error("[support] supabase-js не загружен");
      return;
    }

    sb = supabase.createClient(CFG.url, CFG.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "bx_support_auth"
      }
    });

    ensureAuth()
      .then(function () { return loadConv(); })
      .then(function () { return loadMsgs(); })
      .then(function () {
        ready = true;
        paintAll();
        renderShell();
        updateTyping();
        maybeNudge();
        subscribe();
        scheduleMarkRead();
        fetchStatus();
        scrollToBottom(false);
        autoGrow();
      })
      .catch(function (e) {
        if (e && /anonymous/i.test(String(e.message || e))) {
          fail("Поддержка временно недоступна", e);
          console.error("[support] Включите Auth -> Sign In / Providers -> Anonymous sign-ins в Supabase Dashboard");
        } else {
          fail("Не удалось загрузить чат", e);
        }
      });
  }

  boot();
})();
