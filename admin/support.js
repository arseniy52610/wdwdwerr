(function () {
  "use strict";

  var CFG = window.BX_SUPABASE || {};
  function $(id) { return document.getElementById(id); }

  var STATUS = {
    "new": ["Новое", "spill--new"],
    "waiting_for_operator": ["Ожидает оператора", "spill--wait"],
    "operator_active": ["В работе", "spill--work"],
    "waiting_for_visitor": ["Ожидает посетителя", "spill--vis"],
    "closed": ["Закрыто", "spill--closed"]
  };

  var ST = {
    built: false,
    session: null,
    uid: null,
    isOp: false,
    convs: [],
    filter: "all",
    open: null,
    msgs: [],
    channel: null,
    pingTimer: null,
    reloadTimer: null,
    typingAt: 0,
    sending: false,
    rendered: Object.create(null),
    lastDay: null,
    lastSender: null
  };

  var sb = null;

  /* ---- диагностика ошибок (классификатор общий с admin.js) ---- */

  function classify(err, stage) {
    if (window.BX_SUPA_DIAG && typeof window.BX_SUPA_DIAG.classify === "function") {
      return window.BX_SUPA_DIAG.classify(err, stage);
    }
    var msg = err && err.message ? String(err.message) : "";
    return {
      stage: stage || "", kind: "unknown", status: null, code: "",
      text: "Ошибка Supabase" + (msg ? ": " + msg.slice(0, 140) : ""),
      detail: "stage=" + (stage || "-") + " kind=unknown"
    };
  }

  function logDiag(err, stage) {
    var d = classify(err, stage);
    try { console.error("[support-admin] " + d.detail, err); } catch (e) {}
    return d;
  }

  /* Убираем локально сломанную сессию, чтобы не зациклить ошибку входа.
     Серверные токены не отзываем — чужих сессий это не касается. */
  function clearLocalSession() {
    try {
      if (sb && sb.auth && typeof sb.auth.signOut === "function") {
        var p = sb.auth.signOut({ scope: "local" });
        if (p && typeof p.catch === "function") p.catch(function () {});
      }
    } catch (e) {}
    try { window.localStorage && localStorage.removeItem("bx_support_ops"); } catch (e) {}
    ST.session = null;
    ST.uid = null;
    ST.isOp = false;
  }

  /* Единая точка показа ошибок входа/проверки оператора:
     текст всегда соответствует реальной причине, а не «подключению». */
  function handleStageError(stage, err) {
    var d = logDiag(err, stage);
    if (d.kind === "auth") clearLocalSession();
    var tail = d.kind === "auth" ? " Войдите заново." : "";
    showGate(d.text + tail + " [" + d.detail + "]");
  }

  function alertStage(prefix, err, stage) {
    var d = logDiag(err, stage);
    alert(prefix + ": " + d.text);
  }

  function rootEl() { return document.querySelector('.view[data-view="support"]'); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function shortId(v) {
    var h = String(v || "").replace(/-/g, "").toUpperCase();
    return "#" + (h.slice(0, 6) || "??????");
  }

  function fmtTime(t) {
    try { return new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ""; }
  }

  function fmtDT(t) {
    try {
      return new Date(t).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) + " " + fmtTime(t);
    } catch (e) { return ""; }
  }

  function dayKey(t) {
    var d = new Date(t);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function fmtDay(t) {
    var d = new Date(t), now = new Date();
    if (dayKey(d) === dayKey(now)) return "Сегодня";
    if (dayKey(d) === dayKey(new Date(now.getTime() - 86400000))) return "Вчера";
    try { return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }); }
    catch (e) { return ""; }
  }

  function updBadge() {
    var b = $("supBadge");
    if (!b) return;
    var n = 0;
    ST.convs.forEach(function (c) { if ((c.unread_operator || 0) > 0 && c.status !== "closed") n++; });
    b.hidden = n === 0;
    b.textContent = n > 99 ? "99+" : String(n);
  }

  /* ---------------- вход оператора ---------------- */

  function gateHtml(msg) {
    return '<div class="sup-gate card">' +
      "<h3>Вход оператора</h3>" +
      "<p>Раздел поддержки защищён отдельным входом Supabase Auth. Статистика и остальные разделы работают как раньше.</p>" +
      '<label class="field"><span>E-mail</span><input id="sgMail" type="email" placeholder="operator@example.com" autocomplete="username"></label>' +
      '<label class="field"><span>Пароль</span><input id="sgPass" type="password" placeholder="пароль" autocomplete="current-password"></label>' +
      '<div class="btn-row"><button class="set-btn" id="sgIn">Войти</button></div>' +
      '<p class="set-msg" id="sgMsg">' + esc(msg || "") + "</p>" +
      "</div>";
  }

  function signInErrorText(err) {
    var m = err && err.message ? String(err.message) : "";
    var low = m.toLowerCase();
    if (/invalid login credentials|invalid credentials/.test(low)) return "Неверный e-mail или пароль";
    if (/email not confirmed/.test(low)) return "E-mail не подтверждён — подтвердите письмо от Supabase.";
    if (/rate limit|too many requests|security purposes/.test(low)) return "Слишком много попыток. Подождите минуту.";
    var d = classify(err, "sign-in");
    if (d.kind === "network") return d.text;
    if (m) return "Не удалось войти: " + m.slice(0, 80);
    return "Не удалось войти.";
  }

  function wireGate() {
    var msg = $("sgMsg");
    function go() {
      var m = $("sgMail").value.trim();
      var p = $("sgPass").value;
      if (!m || !p) { msg.className = "set-msg err"; msg.textContent = "Введите e-mail и пароль"; return; }
      msg.className = "set-msg";
      msg.textContent = "Входим…";
      sb.auth.signInWithPassword({ email: m, password: p }).then(function (r) {
        if (r.error) {
          logDiag(r.error, "sign-in");
          msg.className = "set-msg err";
          msg.textContent = signInErrorText(r.error);
          return;
        }
        ST.session = r.data.session;
        ST.uid = r.data.session.user.id;
        verifyOperator();
      }).catch(function (e) {
        logDiag(e, "sign-in");
        msg.className = "set-msg err";
        msg.textContent = signInErrorText(e);
      });
    }
    $("sgIn").addEventListener("click", go);
    $("sgPass").addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  }

  function showGate(msg) {
    var r = rootEl();
    r.innerHTML = gateHtml(msg);
    wireGate();
  }

  function verifyOperator() {
    return sb.from("support_operators").select("user_id,name").eq("user_id", ST.uid).maybeSingle().then(function (r) {
      if (r.error) { handleStageError("operator-check", r.error); return false; }
      if (!r.data) {
        ST.isOp = false;
        var em = (ST.session && ST.session.user && ST.session.user.email) || "";
        showGate("Пользователь " + em + " не добавлен в операторы. " +
          "Выполните в SQL Editor: insert into public.support_operators (user_id, name) values ('" + ST.uid + "', 'Оператор');");
        return false;
      }
      ST.isOp = true;
      buildMain();
      startPing();
      loadConvs().then(function () {
        var p = new URLSearchParams(location.search).get("support");
        if (p) {
          try { history.replaceState(null, "", location.pathname); } catch (e) {}
          openConv(p);
        }
      });
      return true;
    }).catch(function (e) {
      handleStageError("operator-check", e);
      return false;
    });
  }

  function startPing() {
    if (ST.pingTimer) return;
    var ping = function () { sb.rpc("support_ping").catch(function () {}); };
    ping();
    ST.pingTimer = setInterval(ping, 30000);
  }

  /* ---------------- разметка ---------------- */

  function buildMain() {
    if (ST.built) return;
    ST.built = true;
    rootEl().innerHTML =
      '<div class="sup" id="supRoot">' +
        '<div class="sup__tabs" id="supTabs">' +
          '<button class="sup__tab is-active" data-f="all">Все <span data-c="all"></span></button>' +
          '<button class="sup__tab" data-f="new">Новые <span data-c="new"></span></button>' +
          '<button class="sup__tab" data-f="waiting_for_operator">Ожидают оператора <span data-c="waiting_for_operator"></span></button>' +
          '<button class="sup__tab" data-f="operator_active">В работе <span data-c="operator_active"></span></button>' +
          '<button class="sup__tab" data-f="waiting_for_visitor">Ожидают посетителя <span data-c="waiting_for_visitor"></span></button>' +
          '<button class="sup__tab" data-f="closed">Закрытые <span data-c="closed"></span></button>' +
        "</div>" +
        '<div class="sup__body">' +
          '<aside class="sup__list">' +
            '<div class="sup__items" id="supItems"></div>' +
            '<div class="sup__none" id="supListNone" hidden>Обращений нет</div>' +
          "</aside>" +
          '<section class="sup__chat">' +
            '<div class="sup__placeholder" id="supPh">Выберите обращение из списка</div>' +
            '<div class="sup__pane" id="supPane" hidden>' +
              '<div class="sup__head">' +
                '<button class="sup__back" id="supBack" type="button" aria-label="К списку">' +
                  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>' +
                "</button>" +
                '<div class="sup__who"><b id="supVis">#—</b><span id="supMeta">—</span></div>' +
                '<div class="sup__acts">' +
                  '<span class="sup-pill" id="supPill">—</span>' +
                  '<select class="sup__sel" id="supStatusSel">' +
                    '<option value="new">Новое</option>' +
                    '<option value="waiting_for_operator">Ожидает оператора</option>' +
                    '<option value="operator_active">В работе</option>' +
                    '<option value="waiting_for_visitor">Ожидает посетителя</option>' +
                    '<option value="closed">Закрыто</option>' +
                  "</select>" +
                  '<button class="linkbtn" id="supRead" type="button">Прочитано</button>' +
                  '<button class="linkbtn" id="supClose" type="button">Закрыть</button>' +
                "</div>" +
              "</div>" +
              '<div class="sup__cat" id="supCat" hidden></div>' +
              '<div class="sup__msgs" id="supMsgs"></div>' +
              '<form class="sup__composer" id="supForm" autocomplete="off">' +
                '<textarea class="sup__ta" id="supText" rows="1" placeholder="Ответ посетителю…"></textarea>' +
                '<button class="sup__send" id="supSend" type="submit" disabled>Ответить</button>' +
              "</form>" +
            "</div>" +
          "</section>" +
        "</div>" +
      "</div>";

    wireMain();
    subscribeGlobal();
  }

  function wireMain() {
    $("supTabs").addEventListener("click", function (e) {
      var b = e.target.closest(".sup__tab");
      if (!b) return;
      ST.filter = b.getAttribute("data-f");
      Array.prototype.forEach.call($("supTabs").children, function (t) {
        t.classList.toggle("is-active", t === b);
      });
      renderList();
    });

    $("supItems").addEventListener("click", function (e) {
      var it = e.target.closest(".sup__item");
      if (it) openConv(it.getAttribute("data-id"));
    });

    $("supBack").addEventListener("click", function () {
      $("supRoot").classList.remove("show-chat");
    });

    $("supForm").addEventListener("submit", function (e) {
      e.preventDefault();
      reply();
    });

    $("supText").addEventListener("input", function () {
      autoGrow();
      updateSend();
      var now = Date.now();
      if (ST.open && now - ST.typingAt > 5000) {
        ST.typingAt = now;
        sb.rpc("support_set_typing", { p_conversation_id: ST.open.id }).catch(function () {});
      }
    });

    $("supText").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if ($("supText").value.trim()) $("supForm").requestSubmit ? $("supForm").requestSubmit() : $("supForm").dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });

    $("supStatusSel").addEventListener("change", function () {
      if (!ST.open) return;
      var v = $("supStatusSel").value;
      sb.rpc("support_set_status", { p_conversation_id: ST.open.id, p_status: v }).catch(function (e) {
        alertStage("Не удалось изменить статус", e, "set-status");
      });
    });

    $("supClose").addEventListener("click", function () {
      if (!ST.open) return;
      var next = ST.open.status === "closed" ? "operator_active" : "closed";
      sb.rpc("support_set_status", { p_conversation_id: ST.open.id, p_status: next }).catch(function (e) {
        alertStage("Не удалось изменить статус", e, "set-status");
      });
    });

    $("supRead").addEventListener("click", function () {
      if (!ST.open) return;
      sb.rpc("support_operator_read", { p_conversation_id: ST.open.id }).catch(function () {});
    });
  }

  function autoGrow() {
    var t = $("supText");
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 120) + "px";
  }

  function updateSend() {
    var b = $("supSend");
    if (b) b.disabled = ST.sending || !$("supText").value.trim();
  }

  /* ---------------- список ---------------- */

  function counts() {
    var c = { all: ST.convs.length, "new": 0, waiting_for_operator: 0, operator_active: 0, waiting_for_visitor: 0, closed: 0 };
    ST.convs.forEach(function (x) { if (c[x.status] != null) c[x.status]++; });
    return c;
  }

  function renderCounts() {
    var c = counts();
    Array.prototype.forEach.call(document.querySelectorAll("#supTabs span"), function (s) {
      var k = s.getAttribute("data-c");
      s.textContent = c[k] ? String(c[k]) : "";
    });
    updBadge();
  }

  function lastPreview(c) {
    var m = c._last;
    if (!m) return "";
    var t = String(m.body || "").replace(/\s+/g, " ").trim();
    if (t.length > 90) t = t.slice(0, 90) + "…";
    return (m.sender === "operator" ? "Вы: " : m.sender === "system" ? "▸ " : "") + t;
  }

  function renderList() {
    var box = $("supItems");
    if (!box) return;
    var list = ST.convs.filter(function (c) {
      return ST.filter === "all" || c.status === ST.filter;
    });

    box.textContent = "";
    $("supListNone").hidden = list.length > 0;

    list.forEach(function (c) {
      var st = STATUS[c.status] || STATUS["new"];
      var item = document.createElement("div");
      item.className = "sup__item" +
        (ST.open && ST.open.id === c.id ? " is-active" : "") +
        ((c.unread_operator || 0) > 0 ? " is-unread" : "");
      item.setAttribute("data-id", c.id);

      var top = document.createElement("div");
      top.className = "sup__item-top";
      var idb = document.createElement("b");
      idb.textContent = shortId(c.visitor_id);
      var tm = document.createElement("span");
      tm.className = "sup__time";
      tm.textContent = fmtTime(c.last_message_at || c.created_at);
      top.appendChild(idb);
      top.appendChild(tm);
      item.appendChild(top);

      if (c.category) {
        var cat = document.createElement("div");
        cat.className = "sup__item-cat";
        cat.textContent = c.category;
        item.appendChild(cat);
      }

      var last = document.createElement("div");
      last.className = "sup__item-last";
      last.textContent = lastPreview(c) || "—";
      item.appendChild(last);

      var bot = document.createElement("div");
      bot.className = "sup__item-bot";
      var pill = document.createElement("span");
      pill.className = "sup-pill " + st[1];
      pill.textContent = st[0];
      bot.appendChild(pill);
      if ((c.unread_operator || 0) > 0) {
        var un = document.createElement("span");
        un.className = "sup__nb";
        un.textContent = String(c.unread_operator);
        bot.appendChild(un);
      }
      item.appendChild(bot);

      box.appendChild(item);
    });

    renderCounts();
  }

  function loadConvs() {
    return sb.from("support_conversations")
      .select("*")
      .order("last_message_at", { ascending: false })
      .limit(200)
      .then(function (r) {
        if (r.error) throw r.error;
        ST.convs = r.data || [];
        renderList();
        return loadPreviews();
      })
      .catch(function (e) {
        var d = logDiag(e, "load-conversations");
        var box = $("supItems");
        if (box) {
          box.textContent = "";
          var p = document.createElement("p");
          p.className = "sup__none";
          p.textContent = "Не удалось загрузить обращения: " + d.text + " [" + d.detail + "]";
          box.appendChild(p);
        }
        var none = $("supListNone");
        if (none) none.hidden = true;
      });
  }

  function loadPreviews() {
    if (!ST.convs.length) return Promise.resolve();
    var ids = ST.convs.slice(0, 200).map(function (c) { return c.id; });
    return sb.from("support_messages")
      .select("id,conversation_id,sender,body,created_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false })
      .limit(400)
      .then(function (r) {
        if (r.error) return;
        var rows = r.data || [];
        ST.convs.forEach(function (c) {
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].conversation_id === c.id) { c._last = rows[i]; break; }
          }
        });
        renderList();
      });
  }

  function scheduleReload() {
    clearTimeout(ST.reloadTimer);
    ST.reloadTimer = setTimeout(loadConvs, 400);
  }

  /* ---------------- переписка ---------------- */

  function openConv(id) {
    var c = null;
    for (var i = 0; i < ST.convs.length; i++) if (ST.convs[i].id === id) c = ST.convs[i];
    if (!c) {
      sb.from("support_conversations").select("*").eq("id", id).maybeSingle().then(function (r) {
        if (r.data) { ST.convs.unshift(r.data); renderList(); openConv(id); return; }
        if (r.error) { alertStage("Не удалось открыть обращение", r.error, "open-conversation"); return; }
        alert("Обращение не найдено или доступ закрыт");
      }).catch(function (e) { alertStage("Не удалось открыть обращение", e, "open-conversation"); });
      return;
    }

    ST.open = c;
    ST.msgs = [];
    ST.rendered = Object.create(null);
    ST.lastDay = null;
    ST.lastSender = null;
    $("supMsgs").textContent = "";
    $("supPh").hidden = true;
    $("supPane").hidden = false;
    $("supRoot").classList.add("show-chat");
    renderHead();
    updateSend();

    sb.rpc("support_operator_read", { p_conversation_id: c.id }).catch(function () {});

    sb.from("support_messages")
      .select("id,conversation_id,sender,body,read_at,created_at")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(500)
      .then(function (r) {
        if (!ST.open || ST.open.id !== c.id) return;
        if (r.error) throw r.error;
        ST.msgs = r.data || [];
        paintMsgs();
        scrollMsgs(false);
      })
      .catch(function (e) {
        if (!ST.open || ST.open.id !== c.id) return;
        var d = logDiag(e, "load-messages");
        var box = $("supMsgs");
        if (box) {
          box.textContent = "";
          var wrap = document.createElement("div");
          wrap.className = "sup__m sup__m--sys";
          var b = document.createElement("div");
          b.className = "sup__b";
          b.textContent = "Не удалось загрузить сообщения: " + d.text + " [" + d.detail + "]";
          wrap.appendChild(b);
          box.appendChild(wrap);
        }
      });

    renderList();
  }

  function renderHead() {
    var c = ST.open;
    if (!c) return;
    var st = STATUS[c.status] || STATUS["new"];
    $("supVis").textContent = shortId(c.visitor_id);
    $("supMeta").textContent = "Обращение от " + fmtDT(c.created_at);
    $("supPill").className = "sup-pill " + st[1];
    $("supPill").textContent = st[0];
    $("supStatusSel").value = c.status;
    $("supClose").textContent = c.status === "closed" ? "Открыть" : "Закрыть";
    if (c.category) {
      $("supCat").hidden = false;
      $("supCat").textContent = "Категория: " + c.category;
    } else {
      $("supCat").hidden = true;
    }
  }

  function daySep(t) {
    var s = document.createElement("div");
    s.className = "sup__day";
    s.textContent = fmtDay(t);
    return s;
  }

  function msgNode(m, pending) {
    var wrap = document.createElement("div");
    var kind = m.sender === "operator" ? "me" : (m.sender === "visitor" ? "op" : "sys");
    wrap.className = "sup__m sup__m--" + kind + (pending ? " sup__m--pending" : "");
    wrap.dataset.id = m.id;

    if (kind === "me" && ST.lastSender !== "operator") {
      var who = document.createElement("div");
      who.className = "sup__who-lbl";
      who.textContent = "Оператор";
      wrap.appendChild(who);
    } else if (kind === "op" && ST.lastSender !== "visitor") {
      var who2 = document.createElement("div");
      who2.className = "sup__who-lbl";
      who2.textContent = shortId(ST.open ? ST.open.visitor_id : "");
      wrap.appendChild(who2);
    }

    var body = document.createElement("div");
    body.className = "sup__b";
    body.textContent = String(m.body || "");
    wrap.appendChild(body);

    var time = document.createElement("span");
    time.className = "sup__t";
    time.textContent = fmtTime(m.created_at);
    wrap.appendChild(time);

    if (!pending) ST.lastSender = m.sender;
    return wrap;
  }

  function appendMsg(m) {
    if (!m || !m.id || ST.rendered[m.id]) return;
    var dk = dayKey(m.created_at);
    if (dk !== ST.lastDay) {
      ST.lastDay = dk;
      $("supMsgs").appendChild(daySep(m.created_at));
    }
    var node = msgNode(m);
    ST.rendered[m.id] = node;
    ST.msgs.push(m);
    $("supMsgs").appendChild(node);
  }

  function paintMsgs() {
    $("supMsgs").textContent = "";
    ST.rendered = Object.create(null);
    ST.lastDay = null;
    ST.lastSender = null;
    ST.msgs.forEach(function (m) { appendMsg(m); });
  }

  function scrollMsgs(smooth) {
    var box = $("supMsgs");
    if (!box) return;
    try { box.scrollTo({ top: box.scrollHeight, behavior: smooth ? "smooth" : "auto" }); }
    catch (e) { box.scrollTop = box.scrollHeight; }
  }

  function atBottom() {
    var box = $("supMsgs");
    if (!box) return true;
    return box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  }

  function reply() {
    var t = $("supText");
    var text = t.value.trim();
    if (!text || !ST.open || ST.sending) return;
    ST.sending = true;
    updateSend();

    var tmpId = "tmp-" + Date.now();
    var node = msgNode({ id: tmpId, sender: "operator", body: text, created_at: new Date().toISOString() }, true);
    $("supMsgs").appendChild(node);
    scrollMsgs(true);
    t.value = "";
    autoGrow();

    sb.rpc("support_operator_reply", {
      p_conversation_id: ST.open.id,
      p_body: text
    }).then(function (r) {
      if (r.error) throw r.error;
      if (node.parentNode) node.parentNode.removeChild(node);
      ST.sending = false;
      updateSend();
      scheduleReload();
      scrollMsgs(true);
    }).catch(function (e) {
      if (node.parentNode) node.parentNode.removeChild(node);
      ST.sending = false;
      updateSend();
      t.value = text;
      autoGrow();
      updateSend();
      alertStage("Не удалось отправить ответ", e, "reply");
    });
  }

  /* ---------------- realtime ---------------- */

  function subscribeGlobal() {
    if (ST.channel) { try { sb.removeChannel(ST.channel); } catch (e) {} }
    ST.channel = sb.channel("bx-support-ops")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages" },
        function (p) {
          var row = p.new;
          if (!row) return;
          if (ST.open && row.conversation_id === ST.open.id) {
            appendMsg(row);
            if (row.sender !== "operator") {
              sb.rpc("support_operator_read", { p_conversation_id: ST.open.id }).catch(function () {});
            }
            if (atBottom()) scrollMsgs(true);
          }
          scheduleReload();
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "support_conversations" },
        function (p) {
          var row = p.new;
          if (!row) return;
          var found = false;
          for (var i = 0; i < ST.convs.length; i++) {
            if (ST.convs[i].id === row.id) {
              ST.convs[i] = Object.assign({}, ST.convs[i], row);
              found = true;
              break;
            }
          }
          if (!found) ST.convs.unshift(row);
          if (ST.open && ST.open.id === row.id) {
            ST.open = Object.assign({}, ST.open, row);
            renderHead();
          }
          renderList();
        })
      .subscribe(function () {});
  }

  /* ---------------- render() ---------------- */

  function render() {
    if (!CFG.url || !CFG.key) {
      rootEl().innerHTML = '<div class="card"><p>Supabase не настроен: заполните файл supabase-config.js в корне сайта.</p></div>';
      return;
    }
    if (typeof supabase === "undefined" || !supabase.createClient) {
      rootEl().innerHTML = '<div class="card"><p>Библиотека supabase-js не загрузилась — проверьте доступность CDN jsdelivr.</p></div>';
      return;
    }
    if (!sb) {
      sb = supabase.createClient(CFG.url, CFG.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: "bx_support_ops"
        }
      });
    }

    if (ST.built) return;

    rootEl().innerHTML = '<div class="sup-loading">Проверка доступа…</div>';

    // Этап «session» — чтение/обновление локальной сессии.
    // Этап «operator-check» — запрос к БД; его сбои обрабатывает сам
    // verifyOperator, чтобы не смешивать «нет сессии», «нет прав» и «нет сети».
    sb.auth.getSession().then(function (r) {
      var sess = r && r.data ? r.data.session : null;
      if (!sess) {
        if (r && r.error) {
          var d = classify(r.error, "session");
          if (d.kind === "network") { handleStageError("session", r.error); return false; }
          logDiag(r.error, "session");
        }
        showGate("");
        return false;
      }
      ST.session = sess;
      ST.uid = sess.user.id;
      return verifyOperator();
    }).catch(function (e) {
      handleStageError("session", e);
      return false;
    });
  }

  function autoDeepLink() {
    var p = new URLSearchParams(location.search).get("support");
    if (!p) return;
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var app = document.getElementById("app");
      var btn = document.querySelector('.navitem[data-view="support"]');
      if (app && !app.hidden && btn) {
        clearInterval(t);
        btn.click();
      } else if (tries > 40) {
        clearInterval(t);
      }
    }, 250);
  }

  window.BX_SUPPORT = { render: render };
  render();
  autoDeepLink();
})();
