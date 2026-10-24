/* Service worker Digital Patrol.
   - Aplikasi (index, tenant, core, css) memakai strategi "jaringan dulu": selalu terbaru saat ada sinyal,
     jatuh ke salinan tersimpan saat sinyal lemah atau offline.
   - Permintaan ke API Google dan foto TIDAK pernah di-cache.
   - dashboard.html sengaja tidak ditangani (data admin tidak disimpan di perangkat). */
const VERSI = "dp-v23";
const FONT = "dp-font-v1";
const SHELL = ["./", "index.html", "tenant.html", "core.js", "index.js", "tenant.js", "tema.js", "petugas.css", "config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSI).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () { /* abaikan satu file gagal */ }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSI && k !== FONT; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function denganBatas(req, ms) {
  return new Promise(function (res, rej) {
    var t = setTimeout(function () { rej(new Error("timeout")); }, ms);
    fetch(req).then(function (r) { clearTimeout(t); res(r); }, function (er) { clearTimeout(t); rej(er); });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  if (url.hostname === "script.google.com" || url.hostname.endsWith("googleusercontent.com")) return;

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONT).then(function (c) {
      return c.match(req).then(function (hit) {
        var jar = fetch(req).then(function (r) { if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone()); return r; })
          .catch(function () { return hit; });
        return hit || jar;
      });
    }));
    return;
  }

  if (url.origin !== location.origin) return;
  // Dashboard admin (halaman dan skripnya) tidak disimpan di perangkat.
  if (/\/(dashboard|laporan|kelola|tenant-awal|dashboard-mulai|cakupan|qr|qrcode|notif)(\.[a-z]+)?$/.test(url.pathname)) return;

  e.respondWith(caches.open(VERSI).then(function (c) {
    return denganBatas(req, 6000).then(function (r) {
      if (r && r.ok) c.put(req, r.clone());
      return r;
    }).catch(function () {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === "navigate") return c.match("index.html").then(function (h) { return h || Response.error(); });
        return Response.error();
      });
    });
  }));
});
