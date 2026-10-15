/* core.js — modul bersama */
(function (w) {
  var CFG = w.PATROL_CONFIG || {};

  function h(tag, attrs, anak) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (Array.isArray(anak) ? anak : anak ? [anak] : []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  function buatId() {
    return (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "")
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 18));
  }

  var offsetJam = 0;
  function sinkronJam() {
    return api({ aksi: "ping" }).then(function (r) {
      offsetJam = (r.waktuServer || Date.now()) - Date.now();
      return offsetJam;
    }).catch(function () { return 0; });
  }
  function sekarang() { return Date.now() + offsetJam; }

  function api(data, opts) {
    opts = opts || {};
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, opts.timeout || 30000);
    return fetch(CFG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(data || {}),
      redirect: "follow",
      signal: ctrl.signal,
      credentials: "omit"
    })
    .then(function (r) { return r.json(); })
    .finally(function () { clearTimeout(to); });
  }

  function ambilGps() {
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) return rej(new Error("GPS tidak didukung"));
      navigator.geolocation.getCurrentPosition(
        function (p) { res({ lat: p.coords.latitude, lng: p.coords.longitude, akurasi: Math.round(p.coords.accuracy || 0) }); },
        function (e) { rej(e); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  function kompresFoto(file, maxW, kualitas) {
    maxW = maxW || 800; kualitas = kualitas || 0.75;
    return new Promise(function (res, rej) {
      if (!file || !file.type.startsWith("image/")) return rej(new Error("Bukan gambar"));
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var c = document.createElement("canvas");
          var w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          var url = c.toDataURL("image/jpeg", kualitas);
          res({ b64: url.split(",")[1], t: Date.now(), sumber: "kamera" });
        };
        img.onerror = rej;
        img.src = e.target.result;
      };
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
  }

  w.DP = { h: h, api: api, buatId: buatId, sinkronJam: sinkronJam, sekarang: sekarang,
    ambilGps: ambilGps, kompresFoto: kompresFoto, CFG: CFG };
})(window);
