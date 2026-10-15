var VERSI = "dp-v3";
var CACHE = "digital-patrol-" + VERSI;
var SHELL = [
  "./", "./index.html", "./tenant.html",
  "./config.js", "./core.js", "./petugas.css",
  "./manifest.webmanifest"
];
var LEWAT = [/script\.google\.com/, /googleusercontent\.com/, /googleapis\.com/];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var url = e.request.url;
  if (e.request.method !== "GET") return;
  if (LEWAT.some(function (re) { return re.test(url); })) return;

  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") {
        var clone = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, clone); });
      }
      return res;
    }).catch(function () { return caches.match(e.request); })
  );
});
