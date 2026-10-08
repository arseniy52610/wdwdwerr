/* ============================================================
   BYNEXVPN — трекер статистики
   Собирает реальные события (просмотры, клики, активность)
   и отправляет их в Supabase. Работает только если заполнен
   supabase-config.js. Не ломает сайт при ошибках сети.
   ============================================================ */
(function () {
  "use strict";

  var CFG = window.BX_SUPABASE || {};
  var URL_ = (CFG.url || "").replace(/\/$/, "");
  var KEY = CFG.key || "";
  if (!URL_ || !KEY || URL_.indexOf("YOUR_PROJECT") !== -1) return;
  if (typeof navigator !== "undefined" && navigator.webdriver) return;

  var TABLE = URL_ + "/rest/v1/events";
  var HEAD = {
    "Content-Type": "application/json",
    apikey: KEY,
    Authorization: "Bearer " + KEY,
    Prefer: "return=minimal"
  };

  var LS_VID = "bx_vid";
  var LS_GEO = "bx_geo";
  var LS_SRC = "bx_src";

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var s = "";
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s.slice(0, 8) + "-" + s.slice(8, 12) + "-4" + s.slice(13, 16) + "-8" + s.slice(17, 20) + "-" + s.slice(20, 32);
  }

  function getLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function getSS(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function setSS(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  var vid = getLS(LS_VID);
  if (!vid) { vid = uuid(); setLS(LS_VID, vid); }

  var sid = getSS("bx_sid");
  if (!sid) { sid = uuid(); setSS("bx_sid", sid); }

  function detectDevice() {
    var ua = navigator.userAgent || "";
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return "Планшет";
    if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return "Телефон";
    return "Компьютер";
  }

  function currentPage() {
    var p = location.pathname.replace(/index\.html$/, "");
    if (p.slice(-1) !== "/") p = p + "/";
    if (p.indexOf("/admin") === 0) return p;
    return p + (location.hash || "");
  }

  function currentReferrer() {
    try {
      var m = /[?&]utm_source=([^&#]+)/.exec(location.search);
      if (m) return "utm:" + decodeURIComponent(m[1]);
      if (document.referrer) return document.referrer;
    } catch (e) {}
    return "";
  }

  var country = "";
  (function loadGeo() {
    var cached = null;
    try { cached = JSON.parse(getLS(LS_GEO) || "null"); } catch (e) {}
    if (cached && cached.t && Date.now() - cached.t < 30 * 864e5) { country = cached.c; return; }
    fetch("https://get.geojs.io/v1/ip/country.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.country) {
          country = String(j.country).toUpperCase();
          setLS(LS_GEO, JSON.stringify({ c: country, t: Date.now() }));
        }
      })
      .catch(function () {
        fetch("https://ipapi.co/json/")
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (j && j.country_code) {
              country = String(j.country_code).toUpperCase();
              setLS(LS_GEO, JSON.stringify({ c: country, t: Date.now() }));
            }
          })
          .catch(function () {});
      });
  })();

  var queue = [];
  var timer = null;

  function flush() {
    if (!queue.length) return;
    var batch = queue.splice(0, queue.length);
    for (var i = 0; i < batch.length; i++) {
      if (!batch[i].country) batch[i].country = country || "";
    }
    try {
      fetch(TABLE, {
        method: "POST",
        headers: HEAD,
        body: JSON.stringify(batch),
        keepalive: true,
        mode: "cors"
      }).catch(function () {});
    } catch (e) {}
  }

  function send(type, label) {
    queue.push({
      visitor_id: vid,
      session_id: sid,
      type: type,
      page: currentPage(),
      label: label || "",
      referrer: currentReferrer(),
      device: detectDevice()
    });
    if (queue.length >= 15) { flush(); }
    else if (!timer) { timer = setTimeout(function () { timer = null; flush(); }, 4000); }
  }

  function friendlyLabel(el) {
    if (!el) return "";
    var t = (el.getAttribute("data-track") || "").trim();
    if (t) return t;
    var txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (!txt) {
      var href = el.getAttribute("href") || "";
      if (href) txt = href;
    }
    return txt.slice(0, 60);
  }

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("a,button,[role=button],.btn") : null;
    if (!el) return;
    if (el.closest("#loginScreen") || el.closest("[data-no-track]")) return;
    var label = friendlyLabel(el);
    if (label) send("click", label);
  }, true);

  window.addEventListener("hashchange", function () {
    send("pageview");
  });

  send("pageview");
  send("heartbeat");

  setInterval(function () {
    if (!document.hidden) send("heartbeat");
  }, 60000);

  setInterval(flush, 8000);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) flush();
  });
})();
