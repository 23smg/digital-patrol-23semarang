/* core.js - modul bersama Digital Patrol (form petugas + dashboard).
   Tanpa dependensi eksternal. Semua DOM dibuat lewat h() (tanpa innerHTML)
   sehingga teks dari server tidak pernah dieksekusi sebagai HTML. */
(function (w) {
  "use strict";

  var CFG = w.PATROL_CONFIG || {};
  var TZ = "Asia/Jakarta";

  /* ---------------------------------------------------------------- DOM */
  function tambah(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { tambah(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "checked" || k === "disabled" || k === "hidden") el[k] = !!v;
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) tambah(el, arguments[i]);
    return el;
  }

  function kosongkan(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  /* Piktogram (SVG statis dari kode ini, bukan dari data pengguna). */
  var IKON = {
    OK: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    TEMUAN: '<path d="M12 3.8 21.2 19.6H2.8z"/><path d="M12 10.2v4.3"/><path d="M12 17.2v.2"/>',
    NA: '<path d="M6.5 12h11"/>',
    KAMERA: '<path d="M3.8 8.2h3.2l1.5-2.4h7l1.5 2.4h3.2v10.6H3.8z"/><circle cx="12" cy="13.4" r="3.5"/>',
    BUKA: '<path d="M12 19V6.5"/><path d="M6.4 11.6 12 6l5.6 5.6"/>',
    TUTUP: '<rect x="5.2" y="10.4" width="13.6" height="9.4" rx="1.6"/><path d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4"/>',
    PANAH: '<path d="M9 5.5 15.5 12 9 18.5"/>',
    PENSIL: '<path d="M4 20l1-4.2L16.6 4.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19z"/><path d="M14.5 6.3l3.2 3.2"/>',
    SAKLAR: '<path d="M12 3.5v8"/><path d="M7.3 6.6a7.5 7.5 0 1 0 9.4 0"/>',
    SAMPAH: '<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.8 12.2h9.4L17.5 7"/><path d="M10.2 10.5v5.5M13.8 10.5v5.5"/>',
    KUNCI: '<circle cx="8.5" cy="14.5" r="3.7"/><path d="M11.2 11.8 19.5 3.5"/><path d="M16 7l2.5 2.5"/>',
    CARI: '<circle cx="10.8" cy="10.8" r="6"/><path d="M15.4 15.4 20 20"/>'
  };
  function ikon(nama) {
    var t = document.createElement("template");
    t.innerHTML = '<svg class="ikon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (IKON[nama] || "") + "</svg>";
    return t.content.firstChild;
  }

  function buatId() {
    if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID();
    var a = new Uint8Array(16);
    w.crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  /* --------------------------------------------------------------- API */
  function api(aksi, data, ms) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, ms || 60000);
    return fetch(CFG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },   // permintaan sederhana: tanpa preflight CORS
      body: JSON.stringify(Object.assign({ aksi: aksi }, data || {})),
      signal: ctl.signal,
      redirect: "follow"
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      clearTimeout(t);
      return j;
    }).catch(function () {
      clearTimeout(t);
      var er = new Error("Tidak dapat terhubung ke server.");
      er.jaringan = true;
      throw er;
    });
  }

  /* ------------------------------------------------- Jam sinkron server */
  var Jam = (function () {
    var ok = false, dasarServer = 0, dasarPerf = 0;
    return {
      sinkron: function (serverMs) { dasarServer = serverMs; dasarPerf = performance.now(); ok = true; },
      terpercaya: function () { return ok; },
      kini: function () { return ok ? new Date(dasarServer + (performance.now() - dasarPerf)) : new Date(); }
    };
  })();

  function sinkronJam() {
    var t0 = Date.now();
    return api("ping", {}, 8000).then(function (r) {
      if (r && r.waktuServer) Jam.sinkron(r.waktuServer + (Date.now() - t0) / 2);
    }).catch(function () { /* tetap pakai sinkron terakhir */ });
  }

  function fmtWIB(d) {
    var p = new Intl.DateTimeFormat("id-ID", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).formatToParts(d);
    var o = {};
    p.forEach(function (x) { o[x.type] = x.value; });
    if (o.hour === "24") o.hour = "00";
    return { tgl: o.day + "/" + o.month + "/" + o.year, jam: o.hour + ":" + o.minute + ":" + o.second };
  }

  function namaHari(d) {
    return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, weekday: "long" }).format(d);
  }

  /* ------------------------------------------------------- Notifikasi */
  function toast(pesan, jenis) {
    var wadah = document.getElementById("toast");
    if (!wadah) {
      wadah = h("div", { id: "toast", role: "status", "aria-live": "polite" });
      document.body.appendChild(wadah);
    }
    var t = h("div", { class: "toast " + (jenis || ""), text: pesan });
    wadah.appendChild(t);
    setTimeout(function () { t.remove(); }, jenis === "bad" ? 7000 : 3500);
  }

  function tanya(judul, pesan, ya, tidak) {
    return new Promise(function (res) {
      if (!w.HTMLDialogElement) { res(w.confirm(judul + "\n\n" + pesan)); return; }
      var hasil = false;
      var dlg = h("dialog", { class: "dialog" },
        h("h3", { text: judul }),
        h("p", { text: pesan }),
        h("div", { class: "dialog-aksi" },
          h("button", { type: "button", class: "btn btn-garis", text: tidak || "Batal",
            onclick: function () { dlg.close(); } }),
          h("button", { type: "button", class: "btn btn-utama", text: ya || "Lanjut",
            onclick: function () { hasil = true; dlg.close(); } })));
      dlg.addEventListener("close", function () { dlg.remove(); res(hasil); });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  /* -------------------------------------------------------------- GPS */
  var Lokasi = (function () {
    var cur = null, state = "mencari", subs = [], mulaiOk = false, watchId = null;
    function emit() { subs.forEach(function (f) { f(state, cur); }); }
    function pantau() {
      if (watchId !== null || !navigator.geolocation) return;
      watchId = navigator.geolocation.watchPosition(function (p) {
        cur = { lat: p.coords.latitude, lng: p.coords.longitude, akurasi: Math.round(p.coords.accuracy) };
        state = cur.akurasi <= 50 ? "baik" : (cur.akurasi <= 150 ? "lemah" : "buruk");
        emit();
      }, function (err) {
        if (err.code === 1) state = "ditolak";
        else if (!cur) state = "tidakada";
        emit();
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 });
    }
    function henti() {
      if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    }
    return {
      mulai: function () {
        if (mulaiOk) return;
        mulaiOk = true;
        if (!navigator.geolocation) { state = "tidakada"; emit(); return; }
        pantau();
        emit();
        // Hemat baterai: berhenti memantau saat halaman tersembunyi, lanjut saat dibuka lagi.
        document.addEventListener("visibilitychange", function () {
          if (document.hidden) henti();
          else if (state !== "ditolak") pantau();
        });
      },
      // Minta izin lokasi lewat tombol (memunculkan dialog izin bila belum pernah ditanya). Mengembalikan status akhir.
      minta: function () {
        return new Promise(function (res) {
          if (!navigator.geolocation) { state = "tidakada"; emit(); res(state); return; }
          navigator.geolocation.getCurrentPosition(function (p) {
            cur = { lat: p.coords.latitude, lng: p.coords.longitude, akurasi: Math.round(p.coords.accuracy) };
            state = cur.akurasi <= 50 ? "baik" : (cur.akurasi <= 150 ? "lemah" : "buruk");
            henti(); pantau();   // pemantauan lama berhenti setelah ditolak, mulai ulang
            emit(); res(state);
          }, function (err) {
            if (err.code === 1) state = "ditolak"; else if (!cur) state = "tidakada";
            emit(); res(state);
          }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
        });
      },
      on: function (f) { subs.push(f); f(state, cur); },
      saatIni: function () { return cur; },
      status: function () { return state; }
    };
  })();

  function teksGps() {
    var c = Lokasi.saatIni();
    return c ? "GPS " + c.lat.toFixed(5) + ", " + c.lng.toFixed(5) + " (\u00B1" + c.akurasi + " m)" : "GPS tidak tersedia";
  }

  /* Pelat waktu + GPS yang menempel di atas halaman. Sama dengan stempel yang dicetak pada foto. */
  function pasangStempel(el) {
    var jam = h("div", { class: "st-jam" });
    var tgl = h("div", { class: "st-tgl" });
    var sumber = h("div", { class: "st-sumber" });
    var teks = h("span", { class: "st-gps-teks" });
    var gps = h("div", { class: "st-gps" }, h("span", { class: "st-bar", "aria-hidden": "true" }, h("i"), h("i"), h("i")), teks);
    el.appendChild(h("div", { class: "st-kiri" }, jam, h("div", { class: "st-meta" }, tgl, sumber)));
    el.appendChild(gps);
    function ubah() {
      var d = Jam.kini(), f = fmtWIB(d);
      jam.textContent = f.jam;
      tgl.textContent = namaHari(d) + ", " + f.tgl + " WIB";
      sumber.textContent = Jam.terpercaya() ? "Jam server" : "Jam perangkat";
      sumber.className = "st-sumber " + (Jam.terpercaya() ? "ok" : "warn");
    }
    setInterval(ubah, 250);
    ubah();
    Lokasi.on(function (state, cur) {
      var label = { mencari: "Mencari GPS", ditolak: "GPS ditolak", tidakada: "Tanpa GPS" }[state];
      var level = 0;
      if (cur && (state === "baik" || state === "lemah" || state === "buruk")) {
        label = "\u00B1" + cur.akurasi + " m";
        level = state === "baik" ? 3 : (state === "lemah" ? 2 : 1);
      }
      teks.textContent = label;
      gps.className = "st-gps " + state;
      gps.setAttribute("data-level", String(level));
      gps.title = state === "ditolak" ? "Izinkan lokasi di pengaturan browser" : "";
    });
  }

  /* ------------------------------------------------- Stempel pada foto */
  function potong(ctx, teks, maks) {
    if (ctx.measureText(teks).width <= maks) return teks;
    while (teks.length > 1 && ctx.measureText(teks + "\u2026").width > maks) teks = teks.slice(0, -1);
    return teks + "\u2026";
  }

  // Menggambar frame ke canvas, menempelkan stempel (waktu, petugas, lokasi, GPS), dan mengekspor JPEG.
  function bakar(sumberEl, lebar, tinggi, baris) {
    var maks = 1280, skala = Math.min(1, maks / Math.max(lebar, tinggi));
    var cw = Math.round(lebar * skala), ch = Math.round(tinggi * skala);
    var c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    var x = c.getContext("2d");
    x.drawImage(sumberEl, 0, 0, cw, ch);

    var fs = Math.max(14, Math.round(Math.min(cw, ch) / 30));
    var pad = Math.round(fs * 0.7);
    var tBesar = Math.round(fs * 1.5), tKecil = Math.round(fs * 1.3);
    var tinggiBar = pad * 2 + tBesar + tKecil * (baris.length - 1);
    var y0 = ch - tinggiBar;
    var strip = Math.max(6, Math.round(fs * 0.4));
    x.fillStyle = "rgba(27,26,23,0.82)";
    x.fillRect(0, y0, cw, tinggiBar);
    x.fillStyle = "#3F6AD8";
    x.fillRect(0, y0, strip, tinggiBar);

    var tx = strip + pad, maksLebar = cw - tx - pad, y = y0 + pad;
    x.textBaseline = "top";
    baris.forEach(function (teks, i) {
      if (i === 0) {
        x.font = "600 " + Math.round(fs * 1.35) + "px \"Open Sans\", system-ui, sans-serif";
        x.fillStyle = "#FFFFFF";
        x.fillText(potong(x, teks, maksLebar), tx, y);
        y += tBesar;
      } else {
        x.font = "500 " + fs + "px \"Open Sans\", system-ui, sans-serif";
        x.fillStyle = "rgba(255,255,255,0.93)";
        x.fillText(potong(x, teks, maksLebar), tx, y);
        y += tKecil;
      }
    });

    var q = 0.74, d = c.toDataURL("image/jpeg", q);
    while (d.length > 1100000 && q > 0.4) { q -= 0.08; d = c.toDataURL("image/jpeg", q); }
    return { dataUrl: d, b64: d.split(",")[1] };
  }

  /* ----------------------------------------------------------- Kamera */
  var Kamera = (function () {
    var modal, video, stempelEl, hasilImg, pesanEl, pesanTeks, btnJepret, btnSenter, btnTutup, btnUlang, btnPakai,
      inputBerkas, aksiLive, aksiHasil;
    var stream = null, track = null, tick = null, opsi = null, hasil = null, senterOn = false;

    function bangun() {
      if (modal) return;
      video = h("video", { playsinline: "", autoplay: "" });
      video.muted = true;
      stempelEl = h("div", { class: "kamera-stempel" });
      hasilImg = h("img", { class: "kamera-hasil", alt: "Hasil foto", hidden: true });
      pesanTeks = h("p");
      inputBerkas = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true,
        onchange: dariBerkas });
      pesanEl = h("div", { class: "kamera-pesan", hidden: true }, pesanTeks,
        h("button", { type: "button", class: "btn btn-utama", text: "Pakai kamera bawaan HP",
          onclick: function () { inputBerkas.click(); } }));
      btnTutup = h("button", { type: "button", class: "kamera-x", "aria-label": "Tutup kamera", text: "\u00D7",
        onclick: tutup });
      btnSenter = h("button", { type: "button", class: "kamera-senter", text: "Senter", hidden: true,
        onclick: senter });
      btnJepret = h("button", { type: "button", class: "kamera-jepret", "aria-label": "Ambil foto", onclick: jepret });
      btnUlang = h("button", { type: "button", class: "btn btn-garis-terang", text: "Ulangi",
        onclick: function () { mode("live"); } });
      btnPakai = h("button", { type: "button", class: "btn btn-stempel", text: "Pakai foto ini", onclick: pakai });
      aksiLive = h("div", { class: "kamera-aksi" }, btnSenter, btnJepret);
      aksiHasil = h("div", { class: "kamera-aksi hasil", hidden: true }, btnUlang, btnPakai);
      modal = h("div", { class: "kamera", hidden: true, role: "dialog", "aria-modal": "true", "aria-label": "Kamera" },
        video, hasilImg, stempelEl, pesanEl, btnTutup, aksiLive, aksiHasil, inputBerkas);
      document.body.appendChild(modal);
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) tutup(); });
    }

    function mode(m) {
      var live = m === "live";
      video.hidden = !live;
      hasilImg.hidden = live;
      aksiLive.hidden = !live;
      aksiHasil.hidden = live;
      if (live) hasil = null;
    }

    function henti() {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null; track = null; senterOn = false;
      video.srcObject = null;
    }

    function tutup() {
      henti();
      if (tick) { clearInterval(tick); tick = null; }
      modal.hidden = true;
      document.body.classList.remove("kamera-terbuka");
    }

    function gagal(pesan) {
      pesanTeks.textContent = pesan;
      pesanEl.hidden = false;
      aksiLive.hidden = true;
    }

    function nyalakan() {
      pesanEl.hidden = true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        gagal("Kamera tidak tersedia di browser ini. Buka halaman lewat HTTPS dan gunakan browser terbaru.");
        return;
      }
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      }).then(function (s) {
        stream = s;
        video.srcObject = s;
        track = s.getVideoTracks()[0];
        var cap = track && track.getCapabilities ? track.getCapabilities() : {};
        btnSenter.hidden = !(cap && cap.torch);
        return video.play();
      }).catch(function (e) {
        gagal(e && e.name === "NotAllowedError"
          ? "Izin kamera ditolak. Izinkan kamera pada pengaturan browser, lalu coba lagi."
          : "Kamera tidak dapat dibuka.");
      });
    }

    function senter() {
      if (!track) return;
      senterOn = !senterOn;
      track.applyConstraints({ advanced: [{ torch: senterOn }] }).catch(function () { senterOn = false; });
      btnSenter.classList.toggle("aktif", senterOn);
    }

    function jepret() {
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      var now = Jam.kini();
      var b = bakar(video, vw, vh, opsi.baris(now));
      hasil = { dataUrl: b.dataUrl, b64: b.b64, t: now.toISOString(), sumber: "kamera" };
      hasilImg.src = b.dataUrl;
      if (navigator.vibrate) navigator.vibrate(30);
      mode("hasil");
    }

    function dariBerkas() {
      var f = inputBerkas.files && inputBerkas.files[0];
      inputBerkas.value = "";
      if (!f) return;
      var url = URL.createObjectURL(f);
      var img = new Image();
      img.onload = function () {
        var now = Jam.kini();
        var b = bakar(img, img.naturalWidth, img.naturalHeight, opsi.baris(now));
        URL.revokeObjectURL(url);
        hasil = { dataUrl: b.dataUrl, b64: b.b64, t: now.toISOString(), sumber: "berkas" };
        hasilImg.src = b.dataUrl;
        pesanEl.hidden = true;
        mode("hasil");
      };
      img.onerror = function () { URL.revokeObjectURL(url); toast("Foto tidak bisa dibaca.", "bad"); };
      img.src = url;
    }

    function pakai() {
      var f = hasil;
      tutup();
      if (f && opsi && opsi.onFoto) opsi.onFoto(f);
    }

    function isiStempel() {
      stempelEl.textContent = opsi.baris(Jam.kini()).join("\n");
    }

    return {
      buka: function (o) {
        bangun();
        if (w.document.fonts && w.document.fonts.load) {   // pastikan font stempel siap sebelum foto diambil
          w.document.fonts.load('700 24px "Open Sans"').catch(function () {});
          w.document.fonts.load('400 18px "Open Sans"').catch(function () {});
        }
        opsi = o;
        mode("live");
        modal.hidden = false;
        document.body.classList.add("kamera-terbuka");
        isiStempel();
        tick = setInterval(isiStempel, 500);
        nyalakan();
      }
    };
  })();

  function FotoGrid(wadah, o) {
    var daftar = [];
    function render() {
      kosongkan(wadah);
      daftar.forEach(function (f, i) {
        wadah.appendChild(h("figure", { class: "foto-item" },
          h("img", { src: f.dataUrl, alt: "Foto bukti " + (i + 1) }),
          h("button", { type: "button", class: "foto-hapus", "aria-label": "Hapus foto " + (i + 1), text: "\u00D7",
            onclick: function () { daftar.splice(i, 1); render(); if (o.onUbah) o.onUbah(); } })));
      });
    }
    return {
      tambah: function (f) { if (daftar.length < o.maks) { daftar.push(f); render(); if (o.onUbah) o.onUbah(); } },
      daftar: function () { return daftar.slice(); },
      kosongkan: function () { daftar = []; render(); if (o.onUbah) o.onUbah(); },
      penuh: function () { return daftar.length >= o.maks; }
    };
  }

  /* ------------------------------------------------- Antrean offline */
  var Antrean = (function () {
    var dbp = null, sibuk = false;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        if (!w.indexedDB) { rej(new Error("IndexedDB tidak tersedia")); return; }
        var r = indexedDB.open("patrol-antrean", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("q", { keyPath: "id" }); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction("q", mode), out = fn(t.objectStore("q"));
          t.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); };
          t.onerror = function () { rej(t.error); };
        });
      });
    }
    function semua() { return tx("readonly", function (s) { return s.getAll(); }).then(function (l) { return l || []; }); }
    function simpan(item) { return tx("readwrite", function (s) { return s.put(item); }); }
    function hapus(id) { return tx("readwrite", function (s) { return s.delete(id); }); }

    // Kode galat yang bersifat sementara: laporan tetap antre dan dicoba lagi nanti.
    //  - SIBUK / SERVER: server sedang penuh atau error, hentikan putaran ini.
    //  - SETUP: sheet belum siap (admin belum menjalankan Setup awal), lewati.
    //  - BATAS: terlalu banyak laporan dari satu nama dalam 1 jam, coba lagi nanti.
    var KODE_HENTI = { SIBUK: 1, SERVER: 1 };
    var KODE_TUNGGU = { SETUP: 1, BATAS: 1 };
    // Laporan lama yang ditolak karena PIN: PIN sudah tidak dipakai, jadi kirim ulang otomatis.
    var KODE_PIN_LAMA = { PIN: 1, PIN_KOSONG: 1, TERKUNCI: 1 };

    function proses() {
      if (sibuk) return Promise.resolve();
      sibuk = true;
      return semua().then(function (list) {
        return Promise.all(list.filter(function (x) { return x.status === "ditolak" && KODE_PIN_LAMA[x.kode]; })
          .map(function (x) {
            x.status = "menunggu"; delete x.kode; delete x.pesan; delete x.tunggu;
            return simpan(x);
          })).then(function () { return list; });
      }).then(function (list) {
        list = list.filter(function (x) { return x.status !== "ditolak"; })
          .sort(function (a, b) { return a.dibuat - b.dibuat; });
        var urut = Promise.resolve(true);
        list.forEach(function (item) {
          urut = urut.then(function (lanjut) {
            if (!lanjut) return false;
            var payload = Object.assign({}, item.payload, { tertunda: true, konfirmasiUlang: true });
            delete payload.pin;
            return api(item.aksi, { payload: payload }).then(function (r) {
              if (r.status === "SUCCESS") return hapus(item.id).then(function () { return true; });
              if (KODE_HENTI[r.kode]) return false;
              if (KODE_TUNGGU[r.kode]) {
                item.tunggu = r.message || "Menunggu, dicoba lagi otomatis.";
                return simpan(item).then(function () { return true; });
              }
              item.status = "ditolak";
              item.kode = r.kode || "";
              item.pesan = r.message || "Ditolak server.";
              delete item.tunggu;
              return simpan(item).then(function () { return true; });
            }).catch(function () { return false; });
          });
        });
        return urut;
      }).catch(function () { /* IndexedDB tidak tersedia */ }).then(function () { sibuk = false; });
    }

    // Laporan yang ditolak masih menyimpan foto dan checklist: petugas boleh mencoba kirim ulang.
    function ulangi(id) {
      return semua().then(function (list) {
        var item = list.filter(function (x) { return x.id === id; })[0];
        if (!item) return;
        item.status = "menunggu";
        delete item.kode; delete item.pesan; delete item.tunggu;
        return simpan(item);
      });
    }

    return { semua: semua, simpan: simpan, hapus: hapus, proses: proses, ulangi: ulangi };
  })();

  function pasangAntrean(wadah) {
    var panel = h("div", { class: "antrean", hidden: true });
    wadah.appendChild(panel);
    function segarkan() {
      Antrean.semua().then(function (list) {
        kosongkan(panel);
        var menunggu = list.filter(function (x) { return x.status !== "ditolak"; });
        var ditolak = list.filter(function (x) { return x.status === "ditolak"; });
        panel.hidden = !list.length;
        if (menunggu.length) {
          var tertahan = menunggu.filter(function (x) { return x.tunggu; })[0];
          panel.appendChild(h("div", { class: "antrean-baris" },
            h("span", { text: menunggu.length + " laporan menunggu terkirim. " +
              (tertahan ? tertahan.tunggu : "Akan dikirim otomatis saat sinyal tersedia.") }),
            h("button", { type: "button", class: "btn btn-kecil", text: "Kirim sekarang",
              onclick: function () { Antrean.proses().then(segarkan); } })));
        }
        ditolak.forEach(function (it) {
          var judul = (it.label || "Laporan") + " ditolak server: " + it.pesan;
          var buang = h("button", { type: "button", class: "btn btn-kecil", text: "Buang laporan",
            onclick: function () {
              tanya("Buang laporan ini?", "Foto dan checklist akan dihapus dari perangkat dan tidak akan terkirim.",
                "Buang", "Batal").then(function (ya) { if (ya) Antrean.hapus(it.id).then(segarkan); });
            } });
          // Nama yang belum terdaftar bisa diperbaiki admin, jadi laporan boleh dicoba lagi.
          var coba = it.kode === "NAMA"
            ? h("button", { type: "button", class: "btn btn-kecil btn-utama", text: "Coba lagi",
                onclick: function () { Antrean.ulangi(it.id).then(function () { return Antrean.proses(); }).then(segarkan); } })
            : null;
          panel.appendChild(h("div", { class: "antrean-tolak" },
            h("span", { text: judul }),
            h("div", { class: "antrean-aksi" }, coba, buang)));
        });
      }).catch(function () { panel.hidden = true; });
    }
    segarkan();
    function kirimLagi() { Antrean.proses().then(segarkan); }
    setInterval(kirimLagi, 30000);
    w.addEventListener("online", kirimLagi);
    kirimLagi();
    return { segarkan: segarkan };
  }

  /* ------------------------------------------------------- Combobox
     Daftar pilihan yang bisa di-scroll (iPhone/Android). Penting untuk layar sentuh:
     - pilihan diambil saat "click" (bukan pointerdown), jadi menggeser daftar tidak memilih item
     - daftar tidak menutup selama jari menyentuhnya (blur input tidak lagi memutus scroll)
     - buka() menampilkan seluruh isi daftar tanpa perlu mengetik / membuka keyboard */
  function Combobox(o) {
    var inp = o.input, ul = o.list, aktif = -1, tampil = [], sentuh = false, timerSentuh = null;

    function item() { return o.items() || []; }
    function pastikanTampak() {
      var r = ul.getBoundingClientRect(), batas = (w.innerHeight || 600) - 120;   // sisakan ruang untuk bar kirim
      if (r.bottom > batas) w.scrollBy({ top: Math.min(r.bottom - batas + 8, r.top - 90), behavior: "smooth" });
    }
    function render(semua) {
      var q = semua ? "" : inp.value.trim().toLowerCase();
      tampil = item().filter(function (x) {
        return !q || x.toLowerCase().indexOf(q) >= 0 || (o.detail && String(o.detail(x)).toLowerCase().indexOf(q) >= 0);
      });
      if (o.maks) tampil = tampil.slice(0, o.maks);
      kosongkan(ul);
      if (!tampil.length) {
        ul.appendChild(h("li", { class: "kosong", text: o.kosong || "Tidak ditemukan" }));
      } else {
        tampil.forEach(function (x, i) {
          var det = o.detail ? o.detail(x) : "";
          ul.appendChild(h("li", { role: "option", class: i === aktif ? "aktif" : "",
            onclick: function (e) { e.preventDefault(); pilih(x); } },
            h("span", { class: "opsi-teks", text: x }), det ? h("span", { class: "opsi-detail", text: det }) : null));
        });
      }
      ul.hidden = false;
      inp.setAttribute("aria-expanded", "true");
    }
    function tutup() { ul.hidden = true; inp.setAttribute("aria-expanded", "false"); aktif = -1; }
    function pilih(v) { inp.value = v; tutup(); if (o.onPick) o.onPick(v); }
    function buka() { aktif = -1; ul.scrollTop = 0; render(true); ul.scrollTop = 0; pastikanTampak(); }

    // Jari di dalam daftar = sedang scroll: jangan tutup daftar.
    function mulaiSentuh() { sentuh = true; clearTimeout(timerSentuh); }
    function akhirSentuh() { clearTimeout(timerSentuh); timerSentuh = setTimeout(function () { sentuh = false; }, 400); }
    ul.addEventListener("touchstart", mulaiSentuh, { passive: true });
    ul.addEventListener("touchend", akhirSentuh, { passive: true });
    ul.addEventListener("touchcancel", akhirSentuh, { passive: true });
    ul.addEventListener("pointerdown", mulaiSentuh);
    ul.addEventListener("pointerup", akhirSentuh);
    ul.addEventListener("pointercancel", akhirSentuh);
    ul.addEventListener("mousedown", function (e) { e.preventDefault(); });   // desktop: input tidak kehilangan fokus

    // Sentuh di luar kolom dan daftar = tutup (daftar yang dibuka lewat buka() tidak punya fokus input).
    document.addEventListener("pointerdown", function (e) {
      if (ul.hidden || e.target === inp || ul.contains(e.target)) return;
      if (o.abaikanLuar && o.abaikanLuar(e.target)) return;
      tutup();
    });

    inp.setAttribute("role", "combobox");
    inp.setAttribute("aria-expanded", "false");
    ul.style.webkitOverflowScrolling = "touch";
    inp.addEventListener("input", function () { aktif = -1; if (o.onPick) o.onPick(null); render(); });
    inp.addEventListener("focus", function () { render(); pastikanTampak(); });
    inp.addEventListener("blur", function () { setTimeout(function () { if (!sentuh) tutup(); }, 200); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (ul.hidden) render(); aktif = Math.min(tampil.length - 1, aktif + 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); aktif = Math.max(0, aktif - 1); render(); }
      else if (e.key === "Enter" && !ul.hidden && tampil[aktif]) { e.preventDefault(); pilih(tampil[aktif]); }
      else if (e.key === "Escape") { tutup(); }
    });
    return {
      nilai: function () { var v = inp.value.trim(); return item().indexOf(v) >= 0 ? v : ""; },
      set: function (v) { inp.value = v || ""; },
      buka: buka,
      tutup: tutup
    };
  }

  /* ------------------------------------------------------- Checklist
     Dua tampilan: "fokus" (satu item per layar, bagus untuk satu tangan) dan "daftar" (semua item sekaligus).
     Pilihan disimpan di perangkat. API ke luar sama di kedua tampilan. */
  function Checklist(wadah, o) {
    var items = [], state = {}, baris = {}, mulaiIsi = 0, idx = 0, mode = "fokus", timerLanjut = null;
    o = o || {};
    try { if (localStorage.getItem("dp_cl_mode") === "daftar") mode = "daftar"; } catch (e) { /* abaikan */ }

    function ubah() { if (!mulaiIsi) mulaiIsi = Date.now(); if (o.onUbah) o.onUbah(); }

    function perbarui(nama) {
      var st = state[nama], b = baris[nama];
      if (!b) return;
      b.el.classList.toggle("temuan", st.s === "TEMUAN");
      b.el.classList.toggle("terisi", st.s !== "");
      b.catWrap.hidden = st.s !== "TEMUAN";
      b.cat.value = st.c;
    }

    function ubahMode(m) {
      mode = m;
      try { localStorage.setItem("dp_cl_mode", m); } catch (e) { /* abaikan */ }
      if (m === "fokus") idx = Math.max(0, items.findIndex(function (n) { return !state[n].s; }));
      render();
    }

    function bilahMode() {
      return h("div", { class: "cl-mode" },
        h("button", { type: "button", class: "cl-mode-btn", "aria-pressed": mode === "fokus" ? "true" : "false", text: "Satu per satu",
          onclick: function () { if (mode !== "fokus") ubahMode("fokus"); } }),
        h("button", { type: "button", class: "cl-mode-btn", "aria-pressed": mode === "daftar" ? "true" : "false", text: "Daftar",
          onclick: function () { if (mode !== "daftar") ubahMode("daftar"); } }));
    }

    function renderDaftar(tujuan) {
      baris = {};
      items.forEach(function (nama, i) {
        var st = state[nama], gn = "cl" + i;
        var radios = {};
        function opsi(val, label, kls) {
          var id = gn + "_" + val;
          radios[val] = h("input", { type: "radio", name: gn, id: id, value: val, checked: st.s === val,
            onchange: function () { st.s = val; perbarui(nama); ubah(); } });
          return [radios[val], h("label", { for: id, class: "seg " + kls }, ikon(val), h("span", { text: label }))];
        }
        var cat = h("textarea", { rows: "2", maxlength: "200", class: "input cl-cat",
          placeholder: "Jelaskan temuan (wajib)", "aria-label": "Penjelasan temuan: " + nama,
          oninput: function () { st.c = cat.value; ubah(); } });
        var catWrap = h("div", { class: "cl-catatan", hidden: true }, cat);
        var el = h("div", { class: "cl-baris" },
          h("div", { class: "cl-nama", text: nama }),
          h("div", { class: "seg-grup", role: "radiogroup", "aria-label": nama },
            opsi("OK", "Sesuai", "seg-ok"),
            opsi("TEMUAN", "Temuan", "seg-bad"),
            o.izinNA === false ? null : opsi("NA", "N/A", "seg-na")),
          catWrap);
        baris[nama] = { el: el, cat: cat, catWrap: catWrap, radios: radios };
        tujuan.appendChild(el);
        perbarui(nama);
      });
    }

    function renderFokus(tujuan) {
      baris = {};
      if (!items.length) return;
      if (idx >= items.length) idx = items.length - 1;
      if (idx < 0) idx = 0;
      var nama = items[idx], st = state[nama];
      var terisi = items.filter(function (n) { return state[n].s; }).length;

      var titik = h("div", { class: "fokus-titik", role: "group", "aria-label": "Item checklist" });
      items.forEach(function (n, i) {
        var s = state[n].s;
        titik.appendChild(h("button", { type: "button",
          class: "titik" + (i === idx ? " aktif" : "") + (s === "OK" ? " ok" : (s === "TEMUAN" ? " bad" : (s === "NA" ? " na" : ""))),
          "aria-label": "Item " + (i + 1) + (s ? ", sudah dijawab" : ", belum dijawab"), "aria-current": i === idx ? "true" : null,
          onclick: function () { clearTimeout(timerLanjut); idx = i; render(); } }));
      });

      function pilih(val) {
        clearTimeout(timerLanjut);
        st.s = val;
        if (val !== "TEMUAN") st.c = "";
        ubah();
        if (val === "TEMUAN") { render(); return; }
        if (idx < items.length - 1) { timerLanjut = setTimeout(function () { idx++; render(); }, 220); render(); }
        else render();
      }
      function tombol(val, label, kls) {
        return h("button", { type: "button", class: "fokus-pilih " + kls, "aria-pressed": st.s === val ? "true" : "false",
          onclick: function () { pilih(val); } }, ikon(val), h("span", { text: label }));
      }
      var cat = null;
      if (st.s === "TEMUAN") {
        cat = h("textarea", { rows: "3", maxlength: "200", class: "input cl-cat", placeholder: "Jelaskan temuan (wajib)",
          "aria-label": "Penjelasan temuan: " + nama,
          oninput: function () { st.c = cat.value; ubah(); lanjut.disabled = cat.value.trim().length < 3 && idx < items.length - 1; } });
        cat.value = st.c;
      }
      var lanjut = h("button", { type: "button", class: "btn btn-utama fokus-lanjut",
        text: idx < items.length - 1 ? "Lanjut" : "Selesai",
        disabled: (st.s === "TEMUAN" && st.c.trim().length < 3 && idx < items.length - 1) || (idx < items.length - 1 && !st.s),
        onclick: function () { if (idx < items.length - 1) { idx++; render(); } else { o.onSelesai && o.onSelesai(); } } });
      var sebelum = h("button", { type: "button", class: "btn btn-garis", text: "Sebelumnya", disabled: idx === 0,
        onclick: function () { clearTimeout(timerLanjut); idx--; render(); } });

      tujuan.appendChild(h("div", { class: "fokus" },
        h("div", { class: "fokus-atas" }, h("span", { text: "Item " + (idx + 1) + " dari " + items.length }),
          h("span", { class: "fokus-hitung", text: terisi + " terjawab" })),
        titik,
        h("div", { class: "fokus-nama", text: nama }),
        h("div", { class: "fokus-aksi", role: "group", "aria-label": nama },
          tombol("OK", "Sesuai", "seg-ok"), tombol("TEMUAN", "Temuan", "seg-bad"), o.izinNA === false ? null : tombol("NA", "N/A", "seg-na")),
        cat ? h("div", { class: "cl-catatan" }, cat) : null,
        h("div", { class: "fokus-nav" }, sebelum, lanjut)));
      if (cat && !st.c) setTimeout(function () { try { cat.focus({ preventScroll: true }); } catch (e) { /* abaikan */ } }, 30);
    }

    function render() {
      kosongkan(wadah);
      wadah.appendChild(bilahMode());
      var isi = h("div", { class: "cl-isi" });
      wadah.appendChild(isi);
      if (mode === "fokus") renderFokus(isi); else renderDaftar(isi);
    }

    return {
      set: function (daftar, awal) {
        clearTimeout(timerLanjut);
        items = daftar.slice();
        state = {};
        mulaiIsi = 0;
        items.forEach(function (n) { state[n] = awal && awal[n] ? { s: awal[n].s || "", c: awal[n].c || "" } : { s: "", c: "" }; });
        idx = Math.max(0, items.findIndex(function (n) { return !state[n].s; }));
        render();
      },
      nilai: function () {
        var terisi = 0, adaTemuan = false, catKurang = false, daftar = [];
        items.forEach(function (n) {
          var st = state[n];
          if (st.s) terisi++;
          if (st.s === "TEMUAN") { adaTemuan = true; if (st.c.trim().length < 3) catKurang = true; }
          daftar.push({ i: n, s: st.s, c: st.s === "TEMUAN" ? st.c.trim() : "" });
        });
        return { daftar: daftar, terisi: terisi, total: items.length, lengkap: items.length > 0 && terisi === items.length,
          adaTemuan: adaTemuan, catatanKurang: catKurang };
      },
      ekspor: function () { return JSON.parse(JSON.stringify(state)); },
      reset: function () { this.set(items); },
      // Pintasan: hanya mengisi item yang BELUM dijawab. Jawaban Temuan / N/A yang sudah dipilih tidak diubah.
      isiSemuaSesuai: function () {
        var n = 0;
        items.forEach(function (nama) {
          if (state[nama].s) return;
          state[nama].s = "OK";
          n++;
        });
        ubah();
        render();
        return n;
      },
      durasiDetik: function () { return mulaiIsi ? Math.round((Date.now() - mulaiIsi) / 1000) : 0; }
    };
  }

  /* ----------------------------------------------------------- PWA */
  // Mendaftarkan service worker dan menampilkan ajakan pasang ke layar utama (Android: tombol, iOS: petunjuk).
  function pasangPWA(wadah) {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* abaikan */ });
    }
    var mandiri = (w.matchMedia && w.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    if (mandiri) return;
    try {
      var tutup = Number(localStorage.getItem("dp_pwa_tutup") || 0);
      if (tutup && Date.now() - tutup < 7 * 86400000) return;
    } catch (e) { /* abaikan */ }

    var panel = h("div", { class: "pasang", hidden: true });
    wadah.appendChild(panel);
    function sembunyikan(simpan) {
      panel.hidden = true;
      if (simpan) { try { localStorage.setItem("dp_pwa_tutup", String(Date.now())); } catch (e) { /* abaikan */ } }
    }
    function isi(teks, tombol) {
      kosongkan(panel);
      panel.appendChild(h("p", { text: teks }));
      panel.appendChild(h("div", { class: "pasang-aksi" }, tombol,
        h("button", { type: "button", class: "btn btn-kecil", text: "Nanti", onclick: function () { sembunyikan(true); } })));
      panel.hidden = false;
    }
    var tunda = null;
    w.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      tunda = e;
      isi("Pasang aplikasi di layar utama agar bisa dibuka satu ketukan dan tetap jalan saat sinyal lemah.",
        h("button", { type: "button", class: "btn btn-utama btn-kecil", text: "Pasang",
          onclick: function () {
            if (!tunda) return;
            tunda.prompt();
            tunda.userChoice.then(function () { tunda = null; sembunyikan(false); });
          } }));
    });
    w.addEventListener("appinstalled", function () { sembunyikan(false); toast("Aplikasi terpasang.", "ok"); });
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (ios) {
      isi("Untuk memasang di iPhone: buka menu Bagikan di Safari, lalu pilih Tambah ke Layar Utama.",
        h("span"));
    }
  }

  /* ------------------------------------------------- Logo + tema */
  IKON.BULAN = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';
  IKON.MATAHARI = '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>';

  // Logo hanya muncul bila CFG.LOGO diisi dengan nama file di folder situs (CSP hanya mengizinkan gambar dari situs sendiri).
  function pasangLogo(wadah) {
    if (!CFG.LOGO || !/^[A-Za-z0-9_\-\/]+\.(png|jpg|jpeg|svg|webp)$/i.test(CFG.LOGO)) return;
    var img = h("img", { class: "logo-merek", src: CFG.LOGO, alt: "", onerror: function () { img.remove(); } });
    wadah.insertBefore(img, wadah.firstChild);
  }

  function pasangTema(wadah) {
    var btn = h("button", { type: "button", class: "btn-tema" });
    function segar() {
      var gelap = document.documentElement.getAttribute("data-tema") === "gelap";
      kosongkan(btn);
      btn.appendChild(ikon(gelap ? "MATAHARI" : "BULAN"));
      btn.setAttribute("aria-label", gelap ? "Ganti ke tampilan terang" : "Ganti ke tampilan gelap");
      btn.title = btn.getAttribute("aria-label");
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", gelap ? "#1E3A7A" : "#3F6AD8");
    }
    btn.addEventListener("click", function () {
      var gelap = document.documentElement.getAttribute("data-tema") === "gelap";
      var baru = gelap ? "terang" : "gelap";
      document.documentElement.setAttribute("data-tema", baru);
      try { localStorage.setItem("dp_tema", baru); } catch (e) { /* abaikan */ }
      segar();
    });
    segar();
    wadah.appendChild(btn);
  }

  /* ------------------------------------------------------ Eksport */
  w.PC = {
    h: h, kosongkan: kosongkan, buatId: buatId, api: api, Jam: Jam, sinkronJam: sinkronJam, fmtWIB: fmtWIB,
    namaHari: namaHari, toast: toast, tanya: tanya, Lokasi: Lokasi, teksGps: teksGps, pasangStempel: pasangStempel,
    Kamera: Kamera, FotoGrid: FotoGrid, Antrean: Antrean, pasangAntrean: pasangAntrean, Combobox: Combobox,
    Checklist: Checklist, pasangPWA: pasangPWA, CFG: CFG, ikon: ikon, pasangLogo: pasangLogo, pasangTema: pasangTema
  };
})(window);
