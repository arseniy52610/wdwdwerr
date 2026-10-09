/* ============================================================
   BYNEXVPN — админ-панель
   Реальная статистика из Supabase (события собирает analytics.js)
   ============================================================ */
(function () {
  "use strict";

  var CFG = window.BX_SUPABASE || {};
  var AUTH = window.BX_ADMIN_AUTH || {};
  var $ = function (id) { return document.getElementById(id); };

  /* ================= SHA-256 ================= */

  function sha256hex(str) {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var utf8 = unescape(encodeURIComponent(str));
    var bytes = [];
    for (var i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var j = 7; j >= 0; j--) bytes.push((bitLen / Math.pow(2, j * 8)) & 0xff);
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var b = 0; b < bytes.length; b += 64) {
      var w = new Array(64);
      for (var t = 0; t < 16; t++) w[t] = (bytes[b + t * 4] << 24) | (bytes[b + t * 4 + 1] << 16) | (bytes[b + t * 4 + 2] << 8) | bytes[b + t * 4 + 3];
      for (t = 16; t < 64; t++) {
        var s0 = rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        var mj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = "";
    for (var q = 0; q < 8; q++) out += ("00000000" + (H[q] >>> 0).toString(16)).slice(-8);
    return out;
  }

  function hash(str) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest && window.TextEncoder) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function (buf) {
        var arr = new Uint8Array(buf), s = "";
        for (var i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, "0");
        return s;
      }).catch(function () { return sha256hex(str); });
    }
    return Promise.resolve(sha256hex(str));
  }

  /* ================= AUTH ================= */

  function getOverride() {
    try { return JSON.parse(localStorage.getItem("bx_auth_override") || "null"); } catch (e) { return null; }
  }

  function authCfg() {
    var ov = getOverride();
    if (ov && ov.loginHash && ov.passHash) return ov;
    return AUTH;
  }

  function isLogged() {
    try {
      var s = JSON.parse(sessionStorage.getItem("bx_admin") || "null");
      return !!(s && s.ok && Date.now() - s.t < 12 * 3600e3);
    } catch (e) { return false; }
  }

  function isHash(s) {
    return /^[0-9a-f]{64}$/i.test(String(s || ""));
  }

  function needsSetup() {
    var cfg = authCfg();
    return !cfg || !isHash(cfg.loginHash) || !isHash(cfg.passHash);
  }

  function lockLeft() {
    var until = 0;
    try { until = parseInt(sessionStorage.getItem("bx_lock") || "0", 10) || 0; } catch (e) {}
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  var fails = 0;
  try { fails = parseInt(sessionStorage.getItem("bx_fails") || "0", 10) || 0; } catch (e) {}

  function setFails(n) {
    fails = n;
    try {
      if (n) sessionStorage.setItem("bx_fails", String(n));
      else sessionStorage.removeItem("bx_fails");
    } catch (e) {}
  }

  function initLogin() {
    $("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      doLogin();
    });
    $("setupForm").addEventListener("submit", function (e) {
      e.preventDefault();
      doSetup();
    });
  }

  function showLogin() {
    $("loginTitle").textContent = "Вход в админ-панель";
    $("loginSub").textContent = "Аналитика и статистика вашего сайта";
    $("loginNote").textContent = "Доступ ограничен. Все попытки входа проверяются по хешу.";
    $("loginForm").hidden = false;
    $("setupForm").hidden = true;
  }

  function showSetup() {
    $("loginTitle").textContent = "Первый запуск";
    $("loginSub").textContent = "Придумайте логин и пароль администратора";
    $("loginNote").textContent = "Данные сохранятся в этом браузере. После входа раздел «Настройки» покажет хеши — вставьте их в admin/auth-config.js, чтобы закрепить доступ на всех устройствах.";
    $("loginForm").hidden = true;
    $("setupForm").hidden = false;
  }

  function doSetup() {
    var err = $("setupError");
    var u = $("setupUser").value.trim();
    var p = $("setupPass").value;
    var p2 = $("setupPass2").value;
    if (!u) { err.textContent = "Введите логин"; return; }
    if (u.length < 3) { err.textContent = "Логин должен быть не короче 3 символов"; return; }
    if (p.length < 6) { err.textContent = "Пароль должен быть не короче 6 символов"; return; }
    if (p !== p2) { err.textContent = "Пароли не совпадают"; return; }
    var salt = (authCfg() && authCfg().salt) || "bx-admin-salt-v1";
    $("setupBtn").disabled = true;
    err.textContent = "";
    Promise.all([hash(salt + "u:" + u), hash(salt + "p:" + p)]).then(function (r) {
      var payload = { salt: salt, loginHash: r[0], passHash: r[1], loginName: u };
      try { localStorage.setItem("bx_auth_override", JSON.stringify(payload)); } catch (e) {}
      sessionStorage.setItem("bx_admin", JSON.stringify({ ok: true, t: Date.now() }));
      $("setupBtn").disabled = false;
      showApp();
    });
  }

  function doLogin() {
    var err = $("loginError");
    var left = lockLeft();
    if (left > 0) { err.textContent = "Слишком много попыток. Подождите " + left + " сек."; return; }
    var u = $("loginUser").value.trim();
    var p = $("loginPass").value;
    if (!u || !p) { err.textContent = "Введите логин и пароль"; return; }
    var cfg = authCfg();
    if (!cfg || !cfg.loginHash || !cfg.passHash) {
      err.textContent = "Хеши не заданы — заполните admin/auth-config.js";
      return;
    }
    var salt = cfg.salt || "bx-admin";
    $("loginBtn").disabled = true;
    err.textContent = "";
    Promise.all([hash(salt + "u:" + u), hash(salt + "p:" + p)]).then(function (r) {
      var okUser = r[0] === cfg.loginHash;
      var okPass = r[1] === cfg.passHash;
      $("loginBtn").disabled = false;
      if (okUser && okPass) {
        setFails(0);
        sessionStorage.removeItem("bx_lock");
        sessionStorage.setItem("bx_admin", JSON.stringify({ ok: true, t: Date.now() }));
        showApp();
      } else {
        setFails(fails + 1);
        if (fails >= 5) {
          sessionStorage.setItem("bx_lock", String(Date.now() + 60000));
          setFails(0);
          err.textContent = "5 неудачных попыток. Повторите через 60 секунд.";
        } else {
          err.textContent = "Неверный логин или пароль";
        }
        $("loginPass").value = "";
      }
    });
  }

  function showApp() {
    $("loginScreen").hidden = true;
    $("app").hidden = false;
    var cfg = authCfg();
    if (cfg && cfg.loginName) $("userChipName").textContent = cfg.loginName;
    $("setupNotice").hidden = configured();
    var ov = getOverride();
    var an = $("authNotice");
    if (ov && isHash(ov.loginHash) && !isHash(AUTH.loginHash)) {
      an.hidden = false;
      an.innerHTML = "<strong>Доступ сохранён только в этом браузере.</strong> " +
        "Чтобы войти с любого устройства, вставьте в <code>admin/auth-config.js</code> вместо REPLACE_ME строки:<br>" +
        '<code>salt: "' + esc(ov.salt || "bx-admin-salt-v1") + '", loginHash: "' + esc(ov.loginHash) +
        '", passHash: "' + esc(ov.passHash) + '", loginName: "' + esc(ov.loginName || "admin") + '"</code>';
    } else {
      an.hidden = true;
    }
    setRange(7);
    wireApp();
    refresh();
  }

  function logout() {
    sessionStorage.removeItem("bx_admin");
    $("app").hidden = true;
    $("loginScreen").hidden = false;
    $("loginPass").value = "";
    $("loginError").textContent = "";
    if (needsSetup()) showSetup(); else showLogin();
  }

  /* ================= SUPABASE ================= */

  function configured() {
    return !!(CFG.url && CFG.key && String(CFG.url).indexOf("YOUR_PROJECT") === -1);
  }

  /* ================= ДИАГНОСТИКА ОШИБОК SUPABASE =================
     Одна классификация на всю админ-панель (admin.js + support.js).
     kind: config | network | auth | permission | missing | unknown
     Правило: сетевой категорией помечается только реально сетевой сбой;
     полученный от сервера ответ (401/403/404, код SQLSTATE) классифицируется
     по содержимому, а не по общему слову «ошибка».                */

  function errText(e) {
    if (!e) return "";
    if (typeof e === "string") return e;
    return String(e.message || e.error_description || e.error || e.hint || "");
  }

  function classifySupa(err, stage) {
    var status = err && (err.status || err.statusCode) || null;
    var code = err && err.code ? String(err.code) : "";
    var msg = errText(err);
    var name = err && err.name ? String(err.name) : "";
    var lower = (msg + " " + name).toLowerCase();

    var d = { stage: stage || "", kind: "unknown", status: status, code: code, text: "", detail: "" };

    if (!CFG.url || !CFG.key || String(CFG.url).indexOf("YOUR_PROJECT") !== -1) {
      d.kind = "config";
      d.text = "Supabase не настроен: заполните supabase-config.js";
    } else if (/failed to fetch|fetch failed|networkerror|network error|load failed|network request failed/.test(lower) ||
               (name === "TypeError" && /fetch|network/.test(lower))) {
      d.kind = "network";
      d.text = "Сеть недоступна: сервер Supabase не отвечает (это не ошибка ключа).";
    } else if (code === "42501" || status === 403 || /permission denied|row-level security/.test(lower)) {
      d.kind = "permission";
      d.text = "Нет прав (RLS): запрос отклонён политикой доступа для текущей роли.";
    } else if (code === "PGRST301" || status === 401 ||
               /jwt expired|invalid token|refresh token|not authorized|invalid login credentials|email not confirmed/.test(lower)) {
      d.kind = "auth";
      d.text = "Сессия Supabase истекла или недействительна.";
    } else if (code === "PGRST205" || status === 404 ||
               /does not exist|could not find the table|relation .* does not exist/.test(lower)) {
      d.kind = "missing";
      d.text = "Таблица не найдена в проекте Supabase — выполните SQL-схему.";
    } else {
      d.text = "Ошибка Supabase" + (status ? " (HTTP " + status + ")" : "") + (msg ? ": " + msg.slice(0, 140) : "");
    }

    d.detail = "stage=" + (d.stage || "-") + " kind=" + d.kind +
      " status=" + (d.status === null ? "-" : d.status) + " code=" + (d.code || "-");
    return d;
  }

  function supaLog(err, stage) {
    var d = classifySupa(err, stage);
    try { console.error("[supabase] " + d.detail, err); } catch (e) {}
    return d;
  }

  window.BX_SUPA_DIAG = { classify: classifySupa, log: supaLog };

  function api(filters) {
    var base = String(CFG.url).replace(/\/$/, "");
    var url = base + "/rest/v1/events?select=visitor_id,session_id,type,page,label,country,referrer,device,created_at&" +
      filters + "&order=created_at.desc&limit=20000";
    return fetch(url, {
      headers: {
        apikey: CFG.key,
        Authorization: "Bearer " + CFG.key,
        Accept: "application/json"
      }
    }).then(function (r) {
      if (r.ok) return r.json();
      return r.text().then(function (t) {
        var payload = {};
        try { payload = JSON.parse(t); } catch (e) {}
        var e2 = new Error(payload.message || payload.error_description || t.slice(0, 160) || ("HTTP " + r.status));
        e2.status = r.status;
        e2.code = payload.code || "";
        e2.hint = payload.hint || "";
        throw e2;
      });
    });
  }

  /* ================= STATE ================= */

  var state = {
    view: "dashboard",
    from: null,
    to: null,
    metric: "uniq",
    data: null,
    prev: null,
    hb24: [],
    loading: false
  };

  var TITLES = {
    dashboard: ["ПАНЕЛЬ АДМИНИСТРАТОРА", "Аналитика и статистика вашего сайта"],
    visitors: ["ПОСЕТИТЕЛИ", "Кто и когда заходит на сайт"],
    clicks: ["КЛИКИ", "Статистика нажатий по элементам сайта"],
    pages: ["СТРАНИЦЫ", "Просмотры страниц сайта"],
    pricing: ["ТАРИФЫ", "Статистика переходов к тарифам"],
    users: ["ПОЛЬЗОВАТЕЛИ", "Список посетителей сайта"],
    events: ["СОБЫТИЯ", "Полный журнал действий на сайте"],
    support: ["ПОДДЕРЖКА", "Обращения посетителей в реальном времени"],
    settings: ["НАСТРОЙКИ", "Параметры админ-панели и доступа"]
  };

  /* ================= HELPERS ================= */

  function nf(n) { return new Intl.NumberFormat("ru-RU").format(Math.round(n || 0)); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function endOfDay(d) { var x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

  function dayKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function fmtDate(d) {
    return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
  }

  var MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  var MONTHS_FULL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  function fmtDayShort(d) { return d.getDate() + " " + MONTHS[d.getMonth()]; }
  function fmtDayLong(d) { return d.getDate() + " " + MONTHS_FULL[d.getMonth()]; }

  function fmtTime(d) {
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function dayList(from, to) {
    var out = [], d = startOfDay(from), end = startOfDay(to);
    var guard = 0;
    while (d <= end && guard++ < 800) {
      out.push(new Date(d));
      d = new Date(d.getTime() + 864e5);
    }
    return out;
  }

  var regionNames = null;
  try { regionNames = new Intl.DisplayNames(["ru"], { type: "region" }); } catch (e) {}

  function countryName(code) {
    if (!code) return "Неизвестно";
    try {
      var n = regionNames && regionNames.of(String(code).toUpperCase());
      return n || String(code).toUpperCase();
    } catch (e) { return String(code).toUpperCase(); }
  }

  function flagHtml(code) {
    if (!code) return '<span class="geo__flag">—</span>';
    var c = String(code).toLowerCase();
    return '<img data-flag="' + esc(c) + '" src="https://flagcdn.com/w40/' + esc(c) + '.png" alt="" loading="lazy">';
  }

  function fixFlags(root) {
    var imgs = (root || document).querySelectorAll("img[data-flag]");
    Array.prototype.forEach.call(imgs, function (img) {
      img.onerror = function () {
        var sp = document.createElement("span");
        sp.className = "geo__flag";
        sp.textContent = img.getAttribute("data-flag").toUpperCase();
        if (img.parentNode) img.parentNode.replaceChild(sp, img);
      };
    });
  }

  function sourceName(ref) {
    if (!ref) return "Прямой переход";
    if (ref.indexOf("utm:") === 0) return "Реклама";
    var host = String(ref).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
    if (!host) return "Прямой переход";
    if (host.indexOf("google") >= 0) return "Google";
    if (host.indexOf("yandex") >= 0 || host === "ya.ru") return "Яндекс";
    if (host.indexOf("t.me") >= 0 || host.indexOf("telegram") >= 0) return "Telegram";
    if (host.indexOf("vk.com") >= 0 || host === "vk.ru") return "VK";
    if (host.indexOf("bing") >= 0) return "Bing";
    if (host.indexOf("duckduckgo") >= 0) return "DuckDuckGo";
    return host;
  }

  var PAGE_NAMES = {
    "": "Главная",
    "top": "Главная",
    "advantages": "Преимущества",
    "cabinet": "Кабинет",
    "pricing": "Тарифы",
    "support": "Поддержка"
  };

  function pageName(p) {
    p = String(p || "/");
    var h = p.indexOf("#") >= 0 ? p.split("#")[1] : "";
    if (PAGE_NAMES[h] !== undefined) return PAGE_NAMES[h];
    return p;
  }

  function pagePath(p) {
    p = String(p || "/");
    var h = p.indexOf("#") >= 0 ? p.split("#")[1] : "";
    if (!h) return "/";
    return "/" + h;
  }

  function buttonIcon(label) {
    var l = String(label || "").toLowerCase();
    if (/подключ|vpn|попроб/.test(l)) return '<svg viewBox="0 0 24 24" fill="none"><path d="M13.2 2.5L4.5 13.7h6.4l-1.1 7.8 8.7-11.2h-6.4l1.1-7.8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    if (/кабинет|войти|вход/.test(l)) return '<svg viewBox="0 0 24 24" fill="none"><path d="M9.5 4.5H5.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5h4M14 8l4 4-4 4M9 12h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (/premium|тариф|выбрать|1 месяц|3 месяц|6 месяц|12 месяц/.test(l)) return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 17.5l-1.2-9L8 12l4-6.5L16 12l5.2-3.5-1.2 9H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M4.5 20.5h15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    if (/управлен|подпис|настрой/.test(l)) return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.1" stroke="currentColor" stroke-width="1.5"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    if (/телеграм|телег|мы в/.test(l)) return '<svg viewBox="0 0 24 24" fill="none"><path d="M21.5 4.2L2.8 11.1c-.6.2-.6 1.1.1 1.3l4.7 1.4 1.8 5.4c.2.6 1 .8 1.5.3l2.5-2.5 4.6 3.4c.5.4 1.3.1 1.5-.6l2.9-13.7c.2-.8-.6-1.4-1.3-1.1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7.6 13.8L18.6 6.6l-8.3 8.3-.2 3.8" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    if (/поддерж|чат|помощь/.test(l)) return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-5 4v-4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7l-1.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.5-1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  }

  function pageIcon(name) {
    var l = String(name).toLowerCase();
    if (l === "главная") return '<svg viewBox="0 0 24 24" fill="none"><path d="M3.5 10.5L12 3.5l8.5 7v9a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5a1.5 1.5 0 0 1-1.5-1.5v-9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    if (l === "кабинет" || l === "профиль") return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8.5" r="3.6" stroke="currentColor" stroke-width="1.5"/><path d="M4.8 20c0-3.7 3.2-6 7.2-6s7.2 2.3 7.2 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    if (l === "тарифы" || l === "premium") return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 17.5l-1.2-9L8 12l4-6.5L16 12l5.2-3.5-1.2 9H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    if (l === "поддержка") return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-5 4v-4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M6 3.5h7.5L18.5 8v12.5H6V3.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13.5 3.5V8h5M9 12.5h6M9 16h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  }

  function actionIcon(type) {
    if (type === "click") return '<svg viewBox="0 0 24 24" fill="none"><path d="M6.5 3.5l11 6.7-4.6 1.2-1.4 4.7-5-12.6z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    if (type === "heartbeat") return '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h4l2-5 3 10 2.5-7 1.5 4h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg>';
  }

  function actionText(e) {
    if (e.type === "click") return "Клик: " + (e.label || "—");
    if (e.type === "heartbeat") return "Активность на сайте";
    return "Просмотр страницы";
  }

  /* ================= ANALYSIS ================= */

  function analyze(events) {
    var a = {
      uniq: new Set(), sessions: new Set(), views: 0, clicks: 0,
      days: {}, visitorCountry: {}, countries: {},
      pages: {}, labels: {}, devices: {}, sources: {},
      visitors: {}, events: events
    };
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var t = Date.parse(e.created_at);
      if (isNaN(t)) continue;
      a.uniq.add(e.visitor_id);
      a.sessions.add(e.session_id);
      if (e.type === "pageview") a.views++;
      else if (e.type === "click") a.clicks++;

      var k = dayKey(new Date(t));
      var d = a.days[k] || (a.days[k] = { u: new Set(), v: 0, c: 0 });
      d.u.add(e.visitor_id);
      if (e.type === "pageview") d.v++;
      if (e.type === "click") d.c++;

      if (e.country && !a.visitorCountry[e.visitor_id]) a.visitorCountry[e.visitor_id] = e.country;

      if (e.type === "pageview") a.pages[e.page] = (a.pages[e.page] || 0) + 1;
      if (e.type === "click" && e.label) a.labels[e.label] = (a.labels[e.label] || 0) + 1;
      if (e.device) a.devices[e.device] = (a.devices[e.device] || 0) + 1;
      var src = sourceName(e.referrer);
      a.sources[src] = (a.sources[src] || 0) + 1;

      var v = a.visitors[e.visitor_id] || (a.visitors[e.visitor_id] = {
        sess: new Set(), first: t, last: t, v: 0, c: 0, country: e.country || "", device: e.device || ""
      });
      v.sess.add(e.session_id);
      if (t < v.first) v.first = t;
      if (t > v.last) v.last = t;
      if (e.type === "pageview") v.v++;
      if (e.type === "click") v.c++;
      if (!v.country && e.country) v.country = e.country;
      if (!v.device && e.device) v.device = e.device;
    }
    for (var id in a.visitorCountry) {
      var c = a.visitorCountry[id];
      a.countries[c] = (a.countries[c] || 0) + 1;
    }
    return a;
  }

  function topEntries(obj, n) {
    var arr = [];
    for (var k in obj) arr.push([k, obj[k]]);
    arr.sort(function (a, b) { return b[1] - a[1]; });
    return n ? arr.slice(0, n) : arr;
  }

  function sumValues(obj) {
    var s = 0;
    for (var k in obj) s += obj[k];
    return s;
  }

  function deltaHtml(cur, prev) {
    if (!prev) return cur > 0 ? '<span class="delta delta--flat">—</span>' : '<span class="delta delta--flat">—</span>';
    var pct = Math.round(((cur - prev) / prev) * 100);
    if (pct > 0) return '<span class="delta">↑ ' + pct + "%</span>";
    if (pct < 0) return '<span class="delta delta--down">↓ ' + Math.abs(pct) + "%</span>";
    return '<span class="delta delta--flat">0%</span>';
  }

  /* ================= CHARTS ================= */

  function niceMax(v) {
    if (v <= 0) return 10;
    var pow = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / pow;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * pow;
  }

  function fmtAxis(v) {
    if (v >= 1000) {
      var k = v / 1000;
      return (k % 1 === 0 ? k : k.toFixed(1)) + "K";
    }
    return String(+(+v).toFixed(2));
  }

  function smoothPath(pts) {
    if (!pts.length) return "";
    if (pts.length === 1) return "M" + pts[0][0] + "," + pts[0][1];
    var d = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += " C" + c1x.toFixed(1) + "," + c1y.toFixed(1) + " " + c2x.toFixed(1) + "," + c2y.toFixed(1) + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
    }
    return d;
  }

  var gradSeq = 0;

  function chartPalette() {
    if (document.documentElement.getAttribute("data-theme") === "light") {
      return { g0: "rgba(0,0,0,0.13)", g1: "rgba(0,0,0,0)", grid: "rgba(0,0,0,0.08)",
        text: "#6b7280", line: "#14161a", dotFill: "#ffffff", dotStroke: "#14161a" };
    }
    return { g0: "rgba(255,255,255,0.16)", g1: "rgba(255,255,255,0)", grid: "rgba(255,255,255,0.07)",
      text: "#5f656e", line: "#ffffff", dotFill: "#000000", dotStroke: "#ffffff" };
  }

  function lineChart(el, labels, values, opts) {
    opts = opts || {};
    if (!el) return;
    var gid = "areaGrad" + (++gradSeq);
    var pal = chartPalette();
    var w = el.clientWidth || 640;
    var h = el.clientHeight || 275;
    var padL = 46, padR = 14, padT = 16, padB = 30;
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;

    if (!values.length) {
      el.innerHTML = '<div class="loading">Нет данных за выбранный период</div>';
      return;
    }

    var max = niceMax(Math.max.apply(null, values.concat([1])));
    var n = values.length;
    var stepX = n > 1 ? plotW / (n - 1) : 0;
    var pts = values.map(function (v, i) {
      return [padL + (n > 1 ? i * stepX : plotW / 2), padT + plotH - (v / max) * plotH];
    });

    var svg = [];
    svg.push('<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" role="img">');
    svg.push("<defs><linearGradient id=\"" + gid + "\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">" +
      '<stop offset="0%" stop-color="' + pal.g0 + '"/>' +
      '<stop offset="100%" stop-color="' + pal.g1 + '"/>' +
      "</linearGradient></defs>");

    var gridN = 5;
    for (var g = 0; g <= gridN; g++) {
      var val = (max / gridN) * g;
      var y = padT + plotH - (g / gridN) * plotH;
      svg.push('<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) +
        '" stroke="' + pal.grid + '" stroke-dasharray="4 5"/>');
      svg.push('<text x="' + (padL - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" fill="' + pal.text + '" font-size="11">' + fmtAxis(val) + "</text>");
    }

    var lineD = smoothPath(pts);
    var areaD = lineD + " L" + pts[n - 1][0].toFixed(1) + "," + (padT + plotH) + " L" + pts[0][0].toFixed(1) + "," + (padT + plotH) + " Z";
    svg.push('<path d="' + areaD + '" fill="url(#' + gid + ')"/>');
    svg.push('<path d="' + lineD + '" fill="none" stroke="' + pal.line + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');

    var every = Math.ceil(n / 8);
    for (var i = 0; i < n; i++) {
      if (i % every === 0 || i === n - 1) {
        svg.push('<text x="' + pts[i][0].toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" fill="' + pal.text + '" font-size="11">' +
          esc(fmtDayShort(labels[i])) + "</text>");
      }
    }

    for (i = 0; i < n; i++) {
      var px = pts[i][0], py = pts[i][1];
      svg.push('<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="3" fill="' + pal.dotFill + '" stroke="' + pal.dotStroke + '" stroke-width="1.6"/>');
      var hitW = n > 1 ? stepX : plotW;
      var hx = n > 1 ? px - hitW / 2 : padL;
      svg.push('<rect class="hit" data-i="' + i + '" x="' + hx.toFixed(1) + '" y="' + padT + '" width="' + hitW.toFixed(1) +
        '" height="' + plotH + '" fill="transparent"/>');
    }
    svg.push("</svg>");
    el.innerHTML = svg.join("");

    var tip = $("tooltip");
    var hits = el.querySelectorAll(".hit");
    Array.prototype.forEach.call(hits, function (r) {
      r.addEventListener("mouseenter", function (ev) {
        var idx = +r.getAttribute("data-i");
        tip.innerHTML = "<b>" + esc(fmtDayLong(labels[idx])) + "</b><span>" + nf(values[idx]) + " " + (opts.unit || "") + "</span>";
        tip.hidden = false;
        moveTip(ev);
      });
      r.addEventListener("mousemove", moveTip);
      r.addEventListener("mouseleave", function () { tip.hidden = true; });
    });
    function moveTip(ev) {
      tip.style.left = ev.clientX + "px";
      tip.style.top = ev.clientY + "px";
    }
  }

  function renderBars(el, values) {
    if (!el) return;
    var max = Math.max.apply(null, values.concat([1]));
    el.innerHTML = values.map(function (v, i) {
      var pct = Math.max(3, Math.round((v / max) * 100));
      return '<i style="height:' + pct + '%" title="' + esc(values[i]) + ' активных"></i>';
    }).join("");
  }

  /* ================= GEO MAP ================= */

  var COORDS = {
    RU: [55.8, 78], DE: [51.2, 10.4], US: [39.8, -98.6], UA: [49, 31.3], GB: [54, -2],
    FR: [46.6, 2.4], PL: [52.1, 19.4], KZ: [48, 67], TR: [39, 35.2], CN: [35, 105],
    IN: [21, 78], BR: [-10, -52], IT: [42.8, 12.8], ES: [40.3, -3.7], NL: [52.2, 5.5],
    CA: [56, -106], JP: [36.5, 138], BY: [53.7, 28], UZ: [41.4, 64.5], AZ: [40.3, 47.7],
    AM: [40.4, 44.9], GE: [42.3, 43.4], LT: [55.2, 23.9], LV: [56.9, 24.6], EE: [58.6, 25],
    MD: [47.4, 28.4], RO: [45.9, 25], CZ: [49.8, 15.5], SK: [48.7, 19.7], HU: [47.2, 19.5],
    BG: [42.7, 25.5], RS: [44, 20.8], GR: [39, 22], SE: [62, 15], NO: [61, 9],
    FI: [63, 26], DK: [56, 9.5], CH: [46.8, 8.2], AT: [47.6, 14.1], BE: [50.6, 4.6],
    IE: [53.2, -8], PT: [39.5, -8], AR: [-34, -64], MX: [23, -102], EG: [26.8, 30.8],
    IL: [31.3, 34.9], AE: [24, 54], SA: [24, 45], ID: [-2, 118], AU: [-25, 134],
    ZA: [-29, 24], NG: [9, 8], PK: [30, 69], VN: [16, 107], TH: [15, 101],
    KR: [36.5, 128], MY: [4, 102], PH: [12.9, 122], CL: [-30, -71], CO: [4.5, -74]
  };

  var WORLD_IMG = "world-map.svg";

  function renderGeo(listEl, mapEl, countries, total) {
    if (!listEl || !mapEl) return;
    var entries = topEntries(countries, 0);
    var sum = 0;
    entries.forEach(function (e) { sum += e[1]; });

    if (!entries.length) {
      listEl.innerHTML = '<div class="loading">Нет данных по географии</div>';
      mapEl.innerHTML = "";
      return;
    }

    var top = entries.slice(0, 4);
    var rest = entries.slice(4);
    var restSum = 0;
    rest.forEach(function (e) { restSum += e[1]; });
    var rows = top.map(function (e) { return { code: e[0], n: e[1] }; });
    if (restSum > 0) rows.push({ code: "OTHER", n: restSum });

    listEl.innerHTML = rows.map(function (r) {
      var pct = sum ? Math.round((r.n / sum) * 100) : 0;
      var name = r.code === "OTHER" ? "Другие" : countryName(r.code);
      var flag = r.code === "OTHER"
        ? '<span class="geo__flag">•</span>'
        : flagHtml(r.code);
      return '<div class="geo__row">' + flag +
        '<span class="geo__name">' + esc(name) + "</span>" +
        '<span class="geo__pct">' + pct + "%</span>" +
        '<span class="geo__count">' + nf(r.n) + "</span>" +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        "</div>";
    }).join("");

    mapEl.innerHTML = '<img src="' + WORLD_IMG + '" alt="Карта мира" onerror="this.style.display=\'none\'">';
    var topCodes = entries.slice(0, 8).map(function (e) { return e[0]; });
    topCodes.forEach(function (code) {
      var c = COORDS[String(code).toUpperCase()];
      if (!c) return;
      var x = ((c[1] + 180) / 360) * 100;
      var y = ((90 - c[0]) / 180) * 100;
      var dot = document.createElement("span");
      dot.className = "dot";
      dot.style.left = x.toFixed(2) + "%";
      dot.style.top = y.toFixed(2) + "%";
      mapEl.appendChild(dot);
    });
    fixFlags(listEl);
  }

  /* ================= DASHBOARD ================= */

  function renderDashboard() {
    var d = state.data, p = state.prev;
    if (!d) return;

    $("mUniq").textContent = nf(d.uniq.size);
    $("dUniq").innerHTML = deltaHtml(d.uniq.size, p.uniq.size);
    $("mViews").textContent = nf(d.views);
    $("dViews").innerHTML = deltaHtml(d.views, p.views);
    $("mClicks").textContent = nf(d.clicks);
    $("dClicks").innerHTML = deltaHtml(d.clicks, p.clicks);

    renderActiveCard();

    var metricLabels = { uniq: "Уникальные посетители", views: "Просмотры страниц", clicks: "Клики по кнопкам" };
    $("trafficSub").textContent = metricLabels[state.metric];
    $("metricBtn").innerHTML = (state.metric === "uniq" ? "Уникальные" : state.metric === "views" ? "Просмотры" : "Клики") +
      '<svg viewBox="0 0 24 24" fill="none"><path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    var days = dayList(state.from, state.to);
    var values = days.map(function (day) {
      var rec = d.days[dayKey(day)];
      if (!rec) return 0;
      if (state.metric === "uniq") return rec.u.size;
      if (state.metric === "views") return rec.v;
      return rec.c;
    });
    lineChart($("trafficChart"), days, values, { unit: state.metric === "uniq" ? "уник." : state.metric === "views" ? "просмотров" : "кликов" });

    renderGeo($("geoList"), $("geoMap"), d.countries, d.uniq.size);

    // Популярные кнопки
    var clicks = topEntries(d.labels, 5);
    var totalClicks = d.clicks || 1;
    $("topButtons").innerHTML = clicks.length ? clicks.map(function (e, i) {
      var pct = Math.round((e[1] / totalClicks) * 100);
      return '<div class="rank__item">' +
        '<span class="rank__n">' + (i + 1) + ".</span>" +
        '<span class="rank__ico">' + buttonIcon(e[0]) + "</span>" +
        '<span class="rank__mid"><span class="rank__name">' + esc(e[0]) + "</span>" +
        '<span class="bar"><i style="width:' + pct + '%"></i></span></span>' +
        '<span class="rank__val">' + nf(e[1]) + "</span>" +
        '<span class="rank__pct">' + pct + "%</span>" +
        "</div>";
    }).join("") : '<div class="loading">Кликов пока нет</div>';

    // Популярные страницы
    var pages = topEntries(d.pages, 5);
    var totalViews = d.views || 1;
    var head = '<div class="ptable__head"><span>Страница</span><span>Просмотры</span><span>%</span></div>';
    $("topPages").innerHTML = head + (pages.length ? pages.map(function (e) {
      var pct = Math.round((e[1] / totalViews) * 100);
      var name = pageName(e[0]);
      return '<div class="ptable__row">' +
        '<span class="ptable__name">' + pageIcon(name) + "<span>" + esc(name) + "</span></span>" +
        '<span class="ptable__val">' + nf(e[1]) + "</span>" +
        '<span class="ptable__pct">' + pct + "%</span>" +
        "</div>";
    }).join("") : '<div class="loading">Просмотров пока нет</div>');

    // Последние события
    renderEventsRows($("eventsBody"), d.events.filter(function (e) { return e.type !== "heartbeat"; }).slice(0, 7));
  }

  function renderActiveCard() {
    var hb = state.hb24 || [];
    var now = Date.now();
    var onlineSet = {};
    var buckets = new Array(48).fill(0);
    var bucketVisitors = [];
    for (var b = 0; b < 48; b++) bucketVisitors.push({});

    for (var i = 0; i < hb.length; i++) {
      var t = Date.parse(hb[i].created_at);
      if (isNaN(t)) continue;
      if (now - t <= 5 * 60e3) onlineSet[hb[i].visitor_id] = 1;
      var age = now - t;
      if (age >= 0 && age < 24 * 3600e3) {
        var idx = 47 - Math.floor(age / (30 * 60e3));
        if (idx >= 0 && idx < 48) bucketVisitors[idx][hb[i].visitor_id] = 1;
      }
    }
    for (var k = 0; k < 48; k++) buckets[k] = Object.keys(bucketVisitors[k]).length;

    var online = Object.keys(onlineSet).length;
    var max = Math.max.apply(null, buckets.concat([0]));

    $("mOnline").textContent = nf(online);
    $("onlineBig").textContent = nf(online);
    $("onlineMax").textContent = nf(max);
    renderBars($("onlineBars"), buckets);
  }

  function renderEventsRows(tbody, events) {
    if (!tbody) return;
    if (!events.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">Событий за период нет</td></tr>';
      return;
    }
    tbody.innerHTML = events.map(function (e) {
      var t = new Date(Date.parse(e.created_at));
      return "<tr>" +
        "<td>" + fmtTime(t) + "</td>" +
        '<td><span class="user-cell">' + flagHtml(e.country) + "Гость" + (e.country ? " (" + esc(String(e.country).toUpperCase()) + ")" : "") + "</span></td>" +
        '<td><span class="action-cell">' + actionIcon(e.type) + esc(actionText(e)) + "</span></td>" +
        '<td class="muted">' + esc(pagePath(e.page)) + "</td>" +
        '<td class="muted">' + esc(sourceName(e.referrer)) + "</td>" +
        "</tr>";
    }).join("");
    fixFlags(tbody);
  }

  /* ================= VIEWS ================= */

  function metricValues(a, kind) {
    return dayList(state.from, state.to).map(function (day) {
      var rec = a.days[dayKey(day)];
      if (!rec) return 0;
      if (kind === "uniq") return rec.u.size;
      if (kind === "views") return rec.v;
      return rec.c;
    });
  }

  function chartCard(title, sub, id) {
    return '<div class="card"><div class="card__head"><div><h3>' + esc(title) + "</h3><p>" + esc(sub) + "</p></div></div>" +
      '<div class="chart" id="' + id + '"></div></div>';
  }

  function listRows(entries, total, nameFn, useFlag) {
    if (!entries.length) return '<div class="loading">Нет данных</div>';
    return '<div class="list">' + entries.map(function (e) {
      var pct = total ? Math.round((e[1] / total) * 100) : 0;
      var flag = useFlag && /^[A-Za-z]{2}$/.test(e[0]) ? flagHtml(e[0]) : '<span class="list__flag"></span>';
      var label = nameFn ? nameFn(e[0]) : e[0];
      return '<div class="list__row">' + flag +
        '<span class="list__label">' + esc(label) + "</span>" +
        '<span class="list__val">' + nf(e[1]) + "</span>" +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        "</div>";
    }).join("") + "</div>";
  }

  function renderVisitors() {
    var el = document.querySelector('.view[data-view="visitors"]');
    var d = state.data, p = state.prev;
    var days = dayList(state.from, state.to);
    var countries = topEntries(d.countries, 8);
    var devices = topEntries(d.devices, 6);
    var sources = topEntries(d.sources, 8);

    el.innerHTML =
      '<div class="kpis">' +
        kpi("Уникальных посетителей", nf(d.uniq.size), deltaHtml(d.uniq.size, p.uniq.size)) +
        kpi("Сессий", nf(d.sessions.size), "") +
        kpi("Просмотров", nf(d.views), deltaHtml(d.views, p.views)) +
        kpi("Просмотров на посетителя", d.uniq.size ? (d.views / d.uniq.size).toFixed(1) : "0", "") +
      "</div>" +
      chartCard("Уникальные посетители", "Динамика по дням", "vChart") +
      '<div class="grid-3">' +
        '<div class="card"><div class="card__head"><div><h3>Страны</h3></div></div>' + listRows(countries, d.uniq.size, countryName, true) + "</div>" +
        '<div class="card"><div class="card__head"><div><h3>Устройства</h3></div></div>' + listRows(devices, sumValues(d.devices)) + "</div>" +
        '<div class="card"><div class="card__head"><div><h3>Источники</h3></div></div>' + listRows(sources, sumValues(d.sources)) + "</div>" +
      "</div>" +
      '<div class="card"><div class="card__head"><div><h3>По дням</h3><p>Детализация за период</p></div></div>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th class="num">Уникальные</th><th class="num">Просмотры</th><th class="num">Клики</th></tr></thead><tbody>' +
        days.slice().reverse().map(function (day) {
          var rec = d.days[dayKey(day)];
          return "<tr><td>" + fmtDayLong(day) + " " + day.getFullYear() + '</td><td class="num">' +
            (rec ? nf(rec.u.size) : "0") + '</td><td class="num">' + (rec ? nf(rec.v) : "0") +
            '</td><td class="num">' + (rec ? nf(rec.c) : "0") + "</td></tr>";
        }).join("") +
        "</tbody></table></div></div>";

    fixFlags(el);
    lineChart($("vChart"), dayList(state.from, state.to), metricValues(d, "uniq"), { unit: "уник." });
  }

  function kpi(label, value, delta) {
    return '<div class="card kpi"><span>' + esc(label) + "</span><strong>" + value + "</strong><em>" + (delta || "") + "</em></div>";
  }

  function renderClicks() {
    var el = document.querySelector('.view[data-view="clicks"]');
    var d = state.data;
    var labels = topEntries(d.labels, 0);
    var clickers = new Set();
    d.events.forEach(function (e) { if (e.type === "click") clickers.add(e.visitor_id); });

    el.innerHTML =
      '<div class="kpis">' +
        kpi("Кликов всего", nf(d.clicks), "") +
        kpi("Кликнули хотя бы раз", nf(clickers.size), "") +
        kpi("Кнопок с кликами", nf(labels.length), "") +
        kpi("Кликов на посетителя", d.uniq.size ? (d.clicks / d.uniq.size).toFixed(1) : "0", "") +
      "</div>" +
      chartCard("Клики по дням", "Все нажатия на элементы сайта", "cChart") +
      '<div class="card"><div class="card__head"><div><h3>Все кнопки</h3><p>Полный рейтинг за период</p></div></div>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Кнопка</th><th class="num">Клики</th><th class="num">Доля</th><th style="width:34%"></th></tr></thead><tbody>' +
        (labels.length ? labels.map(function (e) {
          var pct = d.clicks ? Math.round((e[1] / d.clicks) * 100) : 0;
          return "<tr><td>" + esc(e[0]) + '</td><td class="num">' + nf(e[1]) + '</td><td class="num">' + pct +
            '%</td><td><div class="bar"><i style="width:' + pct + '%"></i></div></td></tr>';
        }).join("") : '<tr><td colspan="4" class="empty">Кликов за период нет</td></tr>') +
        "</tbody></table></div></div>";

    lineChart($("cChart"), dayList(state.from, state.to), metricValues(d, "clicks"), { unit: "кликов" });
  }

  function renderPages() {
    var el = document.querySelector('.view[data-view="pages"]');
    var d = state.data;
    var pages = topEntries(d.pages, 0);

    el.innerHTML =
      '<div class="kpis">' +
        kpi("Просмотров", nf(d.views), "") +
        kpi("Страниц с трафиком", nf(pages.length), "") +
        kpi("Просмотров на посетителя", d.uniq.size ? (d.views / d.uniq.size).toFixed(1) : "0", "") +
        kpi("Популярная страница", pages.length ? esc(pageName(pages[0][0])) : "—", "") +
      "</div>" +
      chartCard("Просмотры по дням", "Все просмотры страниц", "pChart") +
      '<div class="card"><div class="card__head"><div><h3>Все страницы</h3><p>Полный рейтинг за период</p></div></div>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Страница</th><th>Путь</th><th class="num">Просмотры</th><th class="num">Доля</th><th style="width:30%"></th></tr></thead><tbody>' +
        (pages.length ? pages.map(function (e) {
          var pct = d.views ? Math.round((e[1] / d.views) * 100) : 0;
          return "<tr><td>" + esc(pageName(e[0])) + '</td><td class="muted">' + esc(pagePath(e[0])) +
            '</td><td class="num">' + nf(e[1]) + '</td><td class="num">' + pct +
            '%</td><td><div class="bar"><i style="width:' + pct + '%"></i></div></td></tr>';
        }).join("") : '<tr><td colspan="5" class="empty">Просмотров за период нет</td></tr>') +
        "</tbody></table></div></div>";

    lineChart($("pChart"), dayList(state.from, state.to), metricValues(d, "views"), { unit: "просмотров" });
  }

  function renderPricing() {
    var el = document.querySelector('.view[data-view="pricing"]');
    var d = state.data;

    var pricingViews = 0;
    var pricingByDay = {};
    var pricingVisitors = new Set();
    d.events.forEach(function (e) {
      if (e.type !== "pageview") return;
      var h = String(e.page).indexOf("#") >= 0 ? String(e.page).split("#")[1] : "";
      if (h === "pricing") {
        pricingViews++;
        pricingVisitors.add(e.visitor_id);
        var k = dayKey(new Date(Date.parse(e.created_at)));
        pricingByDay[k] = (pricingByDay[k] || 0) + 1;
      }
    });

    var planClicks = 0;
    var planVisitors = new Set();
    var plans = {};
    var keyButtons = {};
    for (var label in d.labels) {
      var cnt = d.labels[label];
      if (label.indexOf("Тариф · ") === 0) {
        planClicks += cnt;
        var name = label.replace("Тариф · ", "");
        plans[name] = (plans[name] || 0) + cnt;
      } else if (["Подключить VPN", "Войти в кабинет", "Управление подпиской", "Мы в телеграм", "Поддержка"].indexOf(label) >= 0) {
        keyButtons[label] = cnt;
      }
    }
    d.events.forEach(function (e) {
      if (e.type === "click" && String(e.label).indexOf("Тариф · ") === 0 && pricingVisitors.has(e.visitor_id)) {
        planVisitors.add(e.visitor_id);
      }
    });

    var conv = pricingVisitors.size ? Math.round((planVisitors.size / pricingVisitors.size) * 1000) / 10 : 0;
    var planEntries = topEntries(plans, 0);
    var planTotal = planEntries.reduce(function (s, e) { return s + e[1]; }, 0);

    el.innerHTML =
      '<div class="kpis">' +
        kpi("Просмотры тарифов", nf(pricingViews), "") +
        kpi("Клики «Выбрать»", nf(planClicks), "") +
        kpi("Конверсия в клик", conv + "%", "") +
        kpi("«Подключить VPN»", nf(d.labels["Подключить VPN"] || 0), "") +
      "</div>" +
      chartCard("Просмотры раздела тарифов", "Страница /#pricing по дням", "prChart") +
      '<div class="grid-2">' +
        '<div class="card"><div class="card__head"><div><h3>Тарифы</h3><p>Клики по кнопкам «Выбрать»</p></div></div>' +
          '<div class="table-wrap"><table class="table"><thead><tr><th>Тариф</th><th class="num">Клики</th><th class="num">Доля</th><th style="width:30%"></th></tr></thead><tbody>' +
          (planEntries.length ? planEntries.map(function (e) {
            var pct = planTotal ? Math.round((e[1] / planTotal) * 100) : 0;
            return "<tr><td>" + esc(e[0]) + '</td><td class="num">' + nf(e[1]) + '</td><td class="num">' + pct +
              '%</td><td><div class="bar"><i style="width:' + pct + '%"></i></div></td></tr>';
          }).join("") : '<tr><td colspan="4" class="empty">Кликов по тарифам нет</td></tr>') +
          "</tbody></table></div></div>" +
        '<div class="card"><div class="card__head"><div><h3>Ключевые кнопки</h3><p>Конверсия сайта в действия</p></div></div>' +
          '<div class="table-wrap"><table class="table"><thead><tr><th>Кнопка</th><th class="num">Клики</th></tr></thead><tbody>' +
          (Object.keys(keyButtons).length ? Object.keys(keyButtons).map(function (k) {
            return "<tr><td>" + esc(k) + '</td><td class="num">' + nf(keyButtons[k]) + "</td></tr>";
          }).join("") : '<tr><td colspan="2" class="empty">Нет данных</td></tr>') +
          "</tbody></table></div></div>" +
      "</div>";

    var days = dayList(state.from, state.to);
    var vals = days.map(function (day) { return pricingByDay[dayKey(day)] || 0; });
    lineChart($("prChart"), days, vals, { unit: "просмотров" });
  }

  function renderUsers() {
    var el = document.querySelector('.view[data-view="users"]');
    var d = state.data;
    var rows = [];
    for (var id in d.visitors) rows.push([id, d.visitors[id]]);
    rows.sort(function (a, b) { return b[1].last - a[1].last; });
    var shown = rows.slice(0, 200);

    el.innerHTML =
      '<div class="kpis">' +
        kpi("Посетителей", nf(d.uniq.size), "") +
        kpi("Сессий", nf(d.sessions.size), "") +
        kpi("Среднее сессий", d.uniq.size ? (d.sessions.size / d.uniq.size).toFixed(1) : "0", "") +
        kpi("Уникальных кликнувших", nf(new Set(d.events.filter(function (e) { return e.type === "click"; }).map(function (e) { return e.visitor_id; })).size), "") +
      "</div>" +
      '<div class="card"><div class="card__head"><div><h3>Посетители</h3><p>Показаны ' + shown.length + " из " + rows.length + "</p></div></div>" +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Посетитель</th><th>Страна</th><th>Устройство</th><th>Первый визит</th><th>Последний визит</th><th class="num">Сессии</th><th class="num">Просмотры</th><th class="num">Клики</th></tr></thead><tbody>' +
        (shown.length ? shown.map(function (r) {
          var v = r[1];
          return "<tr>" +
            '<td class="muted">' + esc(String(r[0]).slice(0, 8)) + "</td>" +
            "<td>" + (v.country ? '<span class="user-cell">' + flagHtml(v.country) + esc(countryName(v.country)) + "</span>" : '<span class="muted">—</span>') + "</td>" +
            '<td class="muted">' + esc(v.device || "—") + "</td>" +
            '<td class="muted">' + fmtTime(new Date(v.first)) + ", " + fmtDayShort(new Date(v.first)) + "</td>" +
            '<td class="muted">' + fmtTime(new Date(v.last)) + ", " + fmtDayShort(new Date(v.last)) + "</td>" +
            '<td class="num">' + v.sess.size + "</td>" +
            '<td class="num">' + v.v + "</td>" +
            '<td class="num">' + v.c + "</td>" +
            "</tr>";
        }).join("") : '<tr><td colspan="8" class="empty">Посетителей за период нет</td></tr>') +
        "</tbody></table></div></div>";

    fixFlags(el);
  }

  var eventsShown = 100;
  var eventsQuery = "";

  function renderEvents() {
    var el = document.querySelector('.view[data-view="events"]');
    var d = state.data;
    var all = d.events.filter(function (e) {
      if (e.type === "heartbeat") return false;
      if (!eventsQuery) return true;
      var hay = (e.label || "") + " " + pageName(e.page) + " " + sourceName(e.referrer) + " " + (e.country || "") + " " + e.type;
      return hay.toLowerCase().indexOf(eventsQuery) >= 0;
    });
    var shown = all.slice(0, eventsShown);

    el.innerHTML =
      '<div class="card"><div class="card__head">' +
        "<div><h3>Все события</h3><p>Найдено: " + nf(all.length) + "</p></div>" +
        '<div class="btn-row">' +
          '<input id="eventsSearch" placeholder="Поиск..." value="' + esc(eventsQuery) + '" style="background:var(--w04);border:1px solid var(--border);border-radius:9px;padding:8px 12px;color:var(--text);outline:none;font-size:13px;min-width:190px">' +
          '<button class="linkbtn" id="eventsMore">Показать ещё</button>' +
          '<button class="linkbtn" id="eventsExport">Экспорт CSV</button>' +
        "</div></div>" +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Страница</th><th>Источник</th></tr></thead><tbody id="eventsFull"></tbody></table></div>' +
      "</div>";

    renderEventsRows($("eventsFull"), shown);
    if (shown.length >= all.length) $("eventsMore").style.display = "none";

    $("eventsSearch").addEventListener("input", function (e) {
      eventsQuery = e.target.value.trim().toLowerCase();
      eventsShown = 100;
      renderEvents();
      var inp = $("eventsSearch");
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
    $("eventsMore").addEventListener("click", function () {
      eventsShown += 200;
      renderEvents();
    });
    $("eventsExport").addEventListener("click", exportCsv);
  }

  function renderSettings() {
    var el = document.querySelector('.view[data-view="settings"]');
    var cfg = authCfg();
    el.innerHTML =
      '<div class="set-grid">' +
        '<div class="card set-block">' +
          "<h3>Смена доступа</h3>" +
          "<p>Хеши SHA-256 с солью. Пароль в коде сайта не хранится — только хеш. Новые значения сохраняются в этом браузере; чтобы закрепить их для всех устройств, вставьте строки в <code>admin/auth-config.js</code>.</p>" +
          '<label class="field"><span>Новый логин</span><input id="setLogin" placeholder="логин" autocomplete="off"></label>' +
          '<label class="field"><span>Новый пароль</span><input id="setPass" type="password" placeholder="пароль" autocomplete="new-password"></label>' +
          '<div class="btn-row"><button class="set-btn" id="setApply">Сохранить</button>' +
          '<button class="set-btn set-btn--ghost" id="setReset">Сбросить к auth-config.js</button></div>' +
          '<p class="set-msg" id="setMsg"></p>' +
          '<div class="kv" style="margin-top:16px">' +
            "<div><span>Соль</span><b>" + esc(cfg.salt || "—") + "</b></div>" +
            "<div><span>Хеш логина</span><b>" + esc((cfg.loginHash || "—").slice(0, 24)) + "…</b></div>" +
            "<div><span>Хеш пароля</span><b>" + esc((cfg.passHash || "—").slice(0, 24)) + "…</b></div>" +
          "</div>" +
        "</div>" +
        '<div class="card set-block">' +
          "<h3>Подключение статистики</h3>" +
          "<p>Supabase используется как хранилище событий. События пишет <code>analytics.js</code> на главной странице.</p>" +
          '<div class="kv">' +
            "<div><span>Статус</span><b>" + (configured() ? '<span class="pill pill--green">настроено</span>' : '<span class="pill">не настроено</span>') + "</b></div>" +
            "<div><span>Проект</span><b>" + esc(configured() ? String(CFG.url).replace(/^https?:\/\//, "") : "—") + "</b></div>" +
            "<div><span>Таблица</span><b>events</b></div>" +
            "<div><span>Событий загружено</span><b>" + nf(state.data ? state.data.events.length : 0) + "</b></div>" +
            "<div><span>Обновлено</span><b>" + esc($("lastUpdate").textContent) + "</b></div>" +
          "</div>" +
          '<div class="btn-row" style="margin-top:16px">' +
            '<button class="set-btn" id="setRefresh">Обновить данные</button>' +
            '<button class="set-btn set-btn--ghost" id="setCsv">Экспорт CSV</button>' +
          "</div>" +
          '<p class="set-msg" id="setMsg2"></p>' +
        "</div>" +
      "</div>";

    $("setApply").addEventListener("click", function () {
      var u = $("setLogin").value.trim();
      var p = $("setPass").value;
      var msg = $("setMsg");
      if (!u || !p) { msg.className = "set-msg err"; msg.textContent = "Введите логин и пароль"; return; }
      if (p.length < 6) { msg.className = "set-msg err"; msg.textContent = "Пароль должен быть не короче 6 символов"; return; }
      var salt = (authCfg().salt) || "bx-admin";
      Promise.all([hash(salt + "u:" + u), hash(salt + "p:" + p)]).then(function (r) {
        var payload = { salt: salt, loginHash: r[0], passHash: r[1], loginName: u };
        try { localStorage.setItem("bx_auth_override", JSON.stringify(payload)); } catch (e) {}
        msg.className = "set-msg ok";
        msg.textContent = "Сохранено. Чтобы закрепить на всех устройствах, замените строки в admin/auth-config.js (см. внизу). Скопировать: " +
          'loginHash: "' + r[0] + '", passHash: "' + r[1] + '"';
      });
    });

    $("setReset").addEventListener("click", function () {
      try { localStorage.removeItem("bx_auth_override"); } catch (e) {}
      var msg = $("setMsg");
      msg.className = "set-msg ok";
      msg.textContent = "Локальная переопределена отменена — используется auth-config.js";
    });

    $("setRefresh").addEventListener("click", function () {
      var msg = $("setMsg2");
      msg.className = "set-msg";
      msg.textContent = "Обновляю…";
      refresh().then(function () {
        msg.className = "set-msg ok";
        msg.textContent = "Данные обновлены";
      }).catch(function (err) {
        var d = supaLog(err, "stats-refresh");
        msg.className = "set-msg err";
        msg.textContent = "Ошибка: " + d.text + " [" + d.detail + "]";
      });
    });

    $("setCsv").addEventListener("click", exportCsv);
  }

  function exportCsv() {
    if (!state.data) return;
    var rows = [["Время", "Посетитель", "Страна", "Тип", "Действие", "Страница", "Источник", "Устройство"]];
    state.data.events.forEach(function (e) {
      rows.push([
        new Date(Date.parse(e.created_at)).toLocaleString("ru-RU"),
        e.visitor_id, e.country || "", e.type, e.label || "",
        pagePath(e.page), sourceName(e.referrer), e.device || ""
      ]);
    });
    var csv = "\uFEFF" + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(";");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bynexvpn-events-" + fmtDate(state.from) + "-" + fmtDate(state.to) + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  var RENDERERS = {
    dashboard: renderDashboard,
    visitors: renderVisitors,
    clicks: renderClicks,
    pages: renderPages,
    pricing: renderPricing,
    users: renderUsers,
    events: renderEvents,
    support: function () {
      if (window.BX_SUPPORT && typeof window.BX_SUPPORT.render === "function") window.BX_SUPPORT.render();
    },
    settings: renderSettings
  };

  /* ================= REFRESH ================= */

  function refresh() {
    if (!configured() || !state.from || !state.to) {
      $("setupNotice").hidden = configured();
      $("errorNotice").hidden = true;
      return Promise.resolve();
    }
    state.loading = true;
    $("errorNotice").hidden = true;

    var from = state.from, to = state.to;
    var span = to.getTime() - from.getTime();
    var pTo = new Date(from.getTime() - 1);
    var pFrom = new Date(pTo.getTime() - span);

    var hbFrom = new Date(Date.now() - 24 * 3600e3);

    return Promise.all([
      api("created_at=gte." + from.toISOString() + "&created_at=lte." + to.toISOString()),
      api("created_at=gte." + pFrom.toISOString() + "&created_at=lte." + pTo.toISOString()),
      api("type=eq.heartbeat&created_at=gte." + hbFrom.toISOString() + "&order=created_at.desc")
    ]).then(function (res) {
      state.data = analyze(res[0]);
      state.prev = analyze(res[1]);
      state.hb24 = res[2];
      state.loading = false;
      $("lastUpdate").textContent = fmtDate(new Date()) + " " + fmtTime(new Date());
      renderCurrent();
    }).catch(function (err) {
      state.loading = false;
      var d = supaLog(err, "stats");
      var n = $("errorNotice");
      n.hidden = false;
      n.textContent = "Не удалось загрузить статистику: " + d.text + " [" + d.detail + "]";
    });
  }

  function renderCurrent() {
    if (state.view === "settings") { RENDERERS.settings(); return; }
    if (state.view === "support") { RENDERERS.support(); return; }
    if (!state.data) return;
    RENDERERS[state.view]();
  }

  /* ================= NAVIGATION ================= */

  function setView(name) {
    if (!TITLES[name]) return;
    state.view = name;
    eventsShown = 100;
    Array.prototype.forEach.call(document.querySelectorAll(".view"), function (v) {
      v.hidden = v.getAttribute("data-view") !== name;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".navitem"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-view") === name);
    });
    $("viewTitle").textContent = TITLES[name][0];
    $("viewSub").textContent = TITLES[name][1];
    $("topTools").style.display = (name === "settings" || name === "support") ? "none" : "";
    window.scrollTo({ top: 0, behavior: "smooth" });
    renderCurrent();
  }

  function setRange(days) {
    var to = endOfDay(new Date());
    var from = startOfDay(new Date(Date.now() - (days - 1) * 864e5));
    state.from = from;
    state.to = to;
    $("dateFrom").value = dayKey(from);
    $("dateTo").value = dayKey(to);
    Array.prototype.forEach.call($("presets").children, function (b) {
      b.classList.toggle("is-active", +b.getAttribute("data-days") === days);
    });
  }

  function applyDates() {
    var f = $("dateFrom").value, t = $("dateTo").value;
    if (!f || !t) return;
    var from = startOfDay(new Date(f + "T00:00:00"));
    var to = endOfDay(new Date(t + "T00:00:00"));
    if (from > to) { var tmp = from; from = startOfDay(to); to = endOfDay(tmp); }
    state.from = from;
    state.to = to;
    Array.prototype.forEach.call($("presets").children, function (b) { b.classList.remove("is-active"); });
    refresh();
  }

  var wired = false;

  function wireApp() {
    if (wired) return;
    wired = true;

    $("logoutBtn").addEventListener("click", logout);
    $("gearBtn").addEventListener("click", function () { setView("settings"); });

    $("themeBtn").addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("bx_theme", next); } catch (e) {}
      renderCurrent();
    });

    $("sideNav").addEventListener("click", function (e) {
      var b = e.target.closest(".navitem");
      if (b) setView(b.getAttribute("data-view"));
    });

    document.addEventListener("click", function (e) {
      var g = e.target.closest("[data-goto]");
      if (g) setView(g.getAttribute("data-goto"));
    });

    $("presets").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-days]");
      if (!b) return;
      setRange(+b.getAttribute("data-days"));
      refresh();
    });

    $("dateFrom").addEventListener("change", applyDates);
    $("dateTo").addEventListener("change", applyDates);

    var menu = $("metricMenu");
    $("metricBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    menu.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-metric]");
      if (!b) return;
      state.metric = b.getAttribute("data-metric");
      Array.prototype.forEach.call(menu.children, function (x) {
        x.classList.toggle("is-active", x === b);
      });
      menu.hidden = true;
      renderDashboard();
    });
    document.addEventListener("click", function () { menu.hidden = true; });

    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () { renderCurrent(); }, 220);
    });

    setInterval(function () {
      if (!configured() || state.loading) return;
      var hbFrom = new Date(Date.now() - 24 * 3600e3);
      api("type=eq.heartbeat&created_at=gte." + hbFrom.toISOString() + "&order=created_at.desc")
        .then(function (rows) { state.hb24 = rows; if (state.view === "dashboard") renderActiveCard(); })
        .catch(function (e) { supaLog(e, "hb24"); });
      $("lastUpdate").textContent = fmtDate(new Date()) + " " + fmtTime(new Date());
    }, 60000);
  }

  /* ================= BOOT ================= */

  try {
    var th = localStorage.getItem("bx_theme");
    document.documentElement.setAttribute("data-theme", th === "light" ? "light" : "dark");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }

  initLogin();

  if (isLogged()) {
    showApp();
  } else {
    $("app").hidden = true;
    $("loginScreen").hidden = false;
    if (needsSetup()) showSetup(); else showLogin();
  }
})();
