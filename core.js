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
        else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "checked" || k === "disabled" || k === "hidden") el[k] = !!v;
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) tambah(el, arguments[i]);
    return el;
  }

  function kosongkan(el) { while (el.firstChild) el.removeChild(el.firstChild); }

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
    var cur = null, state = "mencari", subs = [], mulaiOk = false;
    function emit() { subs.forEach(function (f) { f(state, cur); }); }
    return {
      mulai: function () {
        if (mulaiOk) return;
        mulaiOk = true;
        if (!navigator.geolocation) { state = "tidakada"; emit(); return; }
        navigator.geolocation.watchPosition(function (p) {
          cur = { lat: p.coords.latitude, lng: p.coords.longitude, akurasi: Math.round(p.coords.accuracy) };
          state = cur.akurasi <= 50 ? "baik" : (cur.akurasi <= 150 ? "lemah" : "buruk");
          emit();
        }, function (err) {
          if (err.code === 1) state = "ditolak";
          else if (!cur) state = "tidakada";
          emit();
        }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 });
        emit();
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

  /* Strip stempel waktu + GPS yang menempel di atas halaman. */
  function pasangStempel(el) {
    var jam = h("div", { class: "st-jam" });
    var tgl = h("div", { class: "st-tgl" });
    var sumber = h("div", { class: "st-sumber" });
    var gps = h("div", { class: "st-gps" });
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
      var teks = { mencari: "GPS mencari", ditolak: "GPS ditolak", tidakada: "GPS tidak tersedia" }[state];
      if (cur && (state === "baik" || state === "lemah" || state === "buruk")) {
        teks = "GPS \u00B1" + cur.akurasi + " m";
      }
      gps.textContent = teks;
      gps.className = "st-gps " + state;
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
    x.fillStyle = "rgba(8,19,33,0.78)";
    x.fillRect(0, y0, cw, tinggiBar);
    x.fillStyle = "#E8A92B";
    x.fillRect(0, y0, strip, tinggiBar);

    var tx = strip + pad, maksLebar = cw - tx - pad, y = y0 + pad;
    x.textBaseline = "top";
    baris.forEach(function (teks, i) {
      if (i === 0) {
        x.font = "700 " + Math.round(fs * 1.25) + "px \"Schibsted Grotesk\", system-ui, sans-serif";
        x.fillStyle = "#FFFFFF";
        x.fillText(potong(x, teks, maksLebar), tx, y);
        y += tBesar;
      } else {
        x.font = "500 " + fs + "px \"Schibsted Grotesk\", system-ui, sans-serif";
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

    function proses() {
      if (sibuk) return Promise.resolve();
      sibuk = true;
      return semua().then(function (list) {
        list = list.filter(function (x) { return x.status !== "ditolak"; })
          .sort(function (a, b) { return a.dibuat - b.dibuat; });
        var urut = Promise.resolve(true);
        list.forEach(function (item) {
          urut = urut.then(function (lanjut) {
            if (!lanjut) return false;
            var payload = Object.assign({}, item.payload, { tertunda: true, konfirmasiUlang: true });
            return api(item.aksi, { payload: payload }).then(function (r) {
              if (r.status === "SUCCESS") return hapus(item.id).then(function () { return true; });
              if (r.kode === "SIBUK" || r.kode === "SERVER") return false;
              item.status = "ditolak";
              item.pesan = r.message || "Ditolak server.";
              return simpan(item).then(function () { return true; });
            }).catch(function () { return false; });
          });
        });
        return urut;
      }).catch(function () { /* IndexedDB tidak tersedia */ }).then(function () { sibuk = false; });
    }

    return { semua: semua, simpan: simpan, hapus: hapus, proses: proses };
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
          panel.appendChild(h("div", { class: "antrean-baris" },
            h("span", { text: menunggu.length + " laporan menunggu terkirim. Akan dikirim otomatis saat sinyal tersedia." }),
            h("button", { type: "button", class: "btn btn-kecil", text: "Kirim sekarang",
              onclick: function () { Antrean.proses().then(segarkan); } })));
        }
        ditolak.forEach(function (it) {
          panel.appendChild(h("div", { class: "antrean-baris bad" },
            h("span", { text: (it.label || "Laporan") + " ditolak server: " + it.pesan }),
            h("button", { type: "button", class: "btn btn-kecil", text: "Buang",
              onclick: function () { Antrean.hapus(it.id).then(segarkan); } })));
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

  /* ------------------------------------------------------- Combobox */
  function Combobox(o) {
    var inp = o.input, ul = o.list, aktif = -1, tampil = [];

    function item() { return o.items(); }
    function render() {
      var q = inp.value.trim().toLowerCase();
      tampil = item().filter(function (x) { return !q || x.toLowerCase().indexOf(q) >= 0; }).slice(0, 60);
      kosongkan(ul);
      if (!tampil.length) {
        ul.appendChild(h("li", { class: "kosong", text: o.kosong || "Tidak ditemukan" }));
      } else {
        tampil.forEach(function (x, i) {
          ul.appendChild(h("li", { role: "option", class: i === aktif ? "aktif" : "", text: x,
            onpointerdown: function (e) { e.preventDefault(); pilih(x); } }));
        });
      }
      ul.hidden = false;
      inp.setAttribute("aria-expanded", "true");
    }
    function tutup() { ul.hidden = true; inp.setAttribute("aria-expanded", "false"); aktif = -1; }
    function pilih(v) { inp.value = v; tutup(); if (o.onPick) o.onPick(v); }

    inp.setAttribute("role", "combobox");
    inp.setAttribute("aria-expanded", "false");
    inp.addEventListener("input", function () { aktif = -1; if (o.onPick) o.onPick(null); render(); });
    inp.addEventListener("focus", render);
    inp.addEventListener("blur", function () { setTimeout(tutup, 150); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (ul.hidden) render(); aktif = Math.min(tampil.length - 1, aktif + 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); aktif = Math.max(0, aktif - 1); render(); }
      else if (e.key === "Enter" && !ul.hidden && tampil[aktif]) { e.preventDefault(); pilih(tampil[aktif]); }
      else if (e.key === "Escape") { tutup(); }
    });
    return {
      nilai: function () { var v = inp.value.trim(); return item().indexOf(v) >= 0 ? v : ""; },
      set: function (v) { inp.value = v || ""; },
      tutup: tutup
    };
  }

  /* ------------------------------------------------------- Checklist */
  function Checklist(wadah, o) {
    var items = [], state = {}, baris = {};
    o = o || {};

    function ubah() { if (o.onUbah) o.onUbah(); }

    function perbarui(nama) {
      var st = state[nama], b = baris[nama];
      b.el.classList.toggle("temuan", st.s === "TEMUAN");
      b.el.classList.toggle("terisi", st.s !== "");
      b.catWrap.hidden = st.s !== "TEMUAN";
      b.cat.value = st.c;
    }

    function render() {
      kosongkan(wadah);
      baris = {};
      items.forEach(function (nama, i) {
        var st = state[nama], gn = "cl" + i;
        function opsi(val, label, kls) {
          var id = gn + "_" + val;
          return [
            h("input", { type: "radio", name: gn, id: id, value: val, checked: st.s === val,
              onchange: function () { st.s = val; perbarui(nama); ubah(); } }),
            h("label", { for: id, class: "seg " + kls, text: label })
          ];
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
        baris[nama] = { el: el, cat: cat, catWrap: catWrap };
        wadah.appendChild(el);
        perbarui(nama);
      });
    }

    return {
      set: function (daftar, awal) {
        items = daftar.slice();
        state = {};
        items.forEach(function (n) { state[n] = awal && awal[n] ? { s: awal[n].s || "", c: awal[n].c || "" } : { s: "", c: "" }; });
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
      reset: function () { this.set(items); }
    };
  }

  /* ------------------------------------------------------ Eksport */
  w.PC = {
    h: h, kosongkan: kosongkan, buatId: buatId, api: api, Jam: Jam, sinkronJam: sinkronJam, fmtWIB: fmtWIB,
    namaHari: namaHari, toast: toast, tanya: tanya, Lokasi: Lokasi, teksGps: teksGps, pasangStempel: pasangStempel,
    Kamera: Kamera, FotoGrid: FotoGrid, Antrean: Antrean, pasangAntrean: pasangAntrean, Combobox: Combobox,
    Checklist: Checklist, CFG: CFG
  };
})(window);
