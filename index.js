/* index.js v23 - Form Patroli Petugas (QR zona + Hard Geofence) */
(function () {
  "use strict";
  var PC = window.PC, h = PC.h;
  var $ = function (id) { return document.getElementById(id); };
  var KUNCI_DRAFT = "dp_draft_patroli_v2", KUNCI_MASTER = "dp_master_v2", KUNCI_NAMA = "dp_nama";
  var TOLERANSI_GPS_MAKS = 30; // meter; akurasi GPS dipakai sbg toleransi, maksimal segini. Isi 0 = geofence mutlak.
  var master = null, idLaporan = PC.buatId(), tingkat = "", zona = "", zonaQR = "", mengirim = false, timerDraft = null;
  var cbNama, cl, foto;
  var KUNCI_PETUGAS = "dp_kunci_petugas_v1";
  var kunci = null, shiftDipilih = "", lantaiDipilih = "", ronde = null, mengunciProses = false;   // kunci nama + shift di perangkat
  var geoState = "none"; // none | cari | ok | luar

  PC.pasangLogo(document.querySelector(".merek-grup"));
  PC.pasangTema(document.querySelector(".kepala-isi"));
  PC.pasangStempel($("stempel"));
  PC.Lokasi.mulai();
  var antrean = PC.pasangAntrean($("antrean-wadah"));
  PC.pasangPWA($("antrean-wadah"));
  setInterval(PC.sinkronJam, 300000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) PC.sinkronJam(); });

  /* ---------- Geofence ---------- */
  function hitungJarakM(lat1, lng1, lat2, lng2) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ---------- Catatan: satu baris, tumbuh otomatis (maks 3 baris) ---------- */
  function rapatkanCatatan() {
    var t = $("catatan");
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight + 2, 96) + "px";
  }

  /* ---------- Tombol izin lokasi + kamera ----------
     Tombol kecil di samping judul "Lokasi". Muncul hanya bila lokasi atau kamera belum diizinkan,
     dan otomatis hilang setelah keduanya aktif. */
  var KUNCI_KAMERA_OK = "dp_kamera_ok", izinLokasi = false, izinKamera = false, lokasiPerm = false;

  function tandaiKameraOk() { try { localStorage.setItem(KUNCI_KAMERA_OK, "1"); } catch (e) {} izinKamera = true; segarIzin(); }

  function segarIzin() {
    var btn = $("btn-izin"); if (!btn) return;
    var st = PC.Lokasi.status();
    izinLokasi = lokasiPerm || st === "baik" || st === "lemah" || st === "buruk";
    btn.hidden = izinLokasi && izinKamera;
  }

  function cekIzin() {
    try { izinKamera = localStorage.getItem(KUNCI_KAMERA_OK) === "1"; } catch (e) {}
    segarIzin();
    if (!navigator.permissions || !navigator.permissions.query) return;
    function pantau(nama, baca) {
      navigator.permissions.query({ name: nama }).then(function (p) {
        function f() { baca(p.state); segarIzin(); }
        f(); p.onchange = f;
      }).catch(function () { /* browser tidak mendukung: andalkan hasil nyata */ });
    }
    pantau("geolocation", function (s) { lokasiPerm = s === "granted"; });
    pantau("camera", function (s) {
      if (s === "granted") { try { localStorage.setItem(KUNCI_KAMERA_OK, "1"); } catch (e) {} izinKamera = true; }
      else if (s === "denied") { try { localStorage.removeItem(KUNCI_KAMERA_OK); } catch (e) {} izinKamera = false; }
    });
  }

  function mintaAkses() {
    var btn = $("btn-izin"), hasil = { lokasi: "", kamera: "" };
    btn.disabled = true; btn.textContent = "Meminta...";
    PC.Lokasi.minta().then(function (st) {
      hasil.lokasi = st === "ditolak" ? "ditolak" : (st === "tidakada" ? "tidakada" : "ok");
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { hasil.kamera = "tidakada"; return; }
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
        .then(function (s) { s.getTracks().forEach(function (t) { t.stop(); }); hasil.kamera = "ok"; tandaiKameraOk(); })
        .catch(function (e) { hasil.kamera = e && e.name === "NotAllowedError" ? "ditolak" : "tidakada"; });
    }).then(function () {
      btn.disabled = false; btn.textContent = "Izinkan akses";
      segarIzin();
      var masalah = [];
      if (hasil.lokasi !== "ok") masalah.push("lokasi");
      if (hasil.kamera !== "ok") masalah.push("kamera");
      if (!masalah.length) { PC.toast("Akses lokasi dan kamera sudah aktif.", "ok"); return; }
      PC.tanya("Izin " + masalah.join(" dan ") + " belum aktif",
        "Browser memblokir izin ini. Ketuk ikon gembok (atau ikon pengaturan) di sebelah alamat situs, pilih Izin, aktifkan " +
        masalah.join(" dan ") + ", lalu muat ulang halaman. Di iPhone: Pengaturan > Safari > Lokasi / Kamera > Izinkan.",
        "Muat ulang", "Tutup").then(function (ya) { if (ya) location.reload(); });
    });
  }

  function tampilGeo(state, teks) {
    var el = $("geo-status");
    if (!el) return;
    el.hidden = state === "none";
    el.setAttribute("data-state", state);
    $("geo-teks").textContent = teks || "";
  }

  function periksaGeofence() {
    var geo = master && master.geo ? master.geo : null;
    var lat0 = geo ? parseFloat(geo.lat) : NaN, lng0 = geo ? parseFloat(geo.lng) : NaN, radius = geo ? parseFloat(geo.radius) : NaN;
    if (!geo || isNaN(lat0) || isNaN(lng0) || isNaN(radius)) {
      geoState = "none"; tampilGeo("none"); return;
    }
    var gps = PC.Lokasi.saatIni();
    if (!gps || gps.lat === null || gps.lng === null) {
      geoState = "cari";
      tampilGeo("cari", "Mencari GPS...");
      return;
    }
    var jarak = hitungJarakM(gps.lat, gps.lng, lat0, lng0);
    var toleransi = Math.min(Math.max(parseFloat(gps.akurasi) || 0, 0), TOLERANSI_GPS_MAKS);
    if (jarak - toleransi > radius) {
      geoState = "luar";
      tampilGeo("luar", "Di luar area (" + Math.round(jarak) + " m)");
    } else {
      geoState = "ok";
      tampilGeo("ok", "Dalam area");
    }
  }

  /* ---------- Lokasi (QR) ---------- */
  function tampilLokasi() {
    var ada = !!zona;
    $("lokasi-nama").textContent = zona + (zona && !zonaQR ? " (manual)" : "");
    $("lokasi-nama").hidden = !ada;
    $("btn-scan").textContent = ada ? "Scan Ulang" : "Scan QR";
    $("b-lokasi").classList.toggle("selesai", ada);
    saranZona();

    var elBadge = $("st-lokasi-badge");
    if (!ada) { if (elBadge) elBadge.remove(); return; }
    if (!elBadge) {
      var stMeta = $("stempel") && $("stempel").querySelector(".st-meta");
      if (!stMeta) return;
      elBadge = document.createElement("div");
      elBadge.id = "st-lokasi-badge";
      elBadge.className = "st-lokasi-badge";
      stMeta.appendChild(elBadge);
    }
    elBadge.textContent = "📍 " + zona + (zonaQR ? "" : " (manual)");
  }

  /* ---------- Daftar zona terjadwal ---------- */
  // Saran zona berikutnya: yang terlambat atau belum dipatroli hari ini.
  // Zona yang ditampilkan: bila petugas punya lantai tugas dan shift berjalan, hanya zona lantainya (yang belum dipatroli ronde ini di atas).
  function lantaiZonaJs(z) { var m = String(z || "").trim().match(/^([A-Za-z0-9]{1,4})\s*[-\u2013]/); return m ? m[1].toUpperCase() : ""; }
  function zonaTampil() {
    var semua = master ? master.daftarZona : [];
    if (!kunci || !kunci.lantai) return semua;
    var f = semua.filter(function (z) { return lantaiZonaJs(z) === kunci.lantai; });
    if (!f.length) return semua;
    var sudah = ronde && ronde.sudah ? ronde.sudah : [];
    return f.filter(function (z) { return sudah.indexOf(z) < 0; }).concat(f.filter(function (z) { return sudah.indexOf(z) >= 0; }));
  }

  function saranZona() { var el = $("zona-saran"); if (el) el.hidden = true; }

  /* ---------- Scan QR lokasi (langsung dari form) ---------- */
  var scanStream = null, scanTimer = null;

  function zonaDariQR(teks) {
    var v = String(teks || "").trim(), z = v;
    try { z = new URL(v).searchParams.get("zona") || ""; } catch (e) {}
    return master.daftarZona.indexOf(z) >= 0 ? z : "";
  }

  function tutupScan() {
    clearInterval(scanTimer); scanTimer = null;
    if (scanStream) { scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null; }
    var v = $("scan-video"); if (v) v.srcObject = null;
    var o = $("scan"); if (o) o.hidden = true;
  }

  // manual = dipilih dari daftar zona (tanpa scan QR); server menandainya ZONA_MANUAL.
  function setZona(z, manual) {
    if (zona && zona !== z && foto.daftar().length) {
      foto.kosongkan();
      PC.toast("Lokasi berubah, foto direset.", "bad");
    }
    zona = z; zonaQR = manual ? "" : z;
    tampilLokasi();
    ubah();
  }

  function mulaiDeteksi() {
    var v = $("scan-video"), det = null, cv = null, ctx = null, sibuk = false;
    if (window.BarcodeDetector) { try { det = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { det = null; } }

    // Baca satu frame lewat jsQR (dipakai di iPhone/Safari yang belum punya BarcodeDetector).
    function bacaJsQR() {
      if (!window.jsQR || !v.videoWidth || !v.videoHeight) return "";
      if (!cv) { cv = document.createElement("canvas"); ctx = cv.getContext("2d", { willReadFrequently: true }); }
      var sk = Math.min(1, 800 / Math.max(v.videoWidth, v.videoHeight));
      var cw = Math.round(v.videoWidth * sk), ch = Math.round(v.videoHeight * sk);
      if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
      ctx.drawImage(v, 0, 0, cw, ch);
      var d = ctx.getImageData(0, 0, cw, ch);
      var q = window.jsQR(d.data, d.width, d.height);
      return q ? q.data : "";
    }

    scanTimer = setInterval(function () {
      if (sibuk || v.readyState < 2 || !v.videoWidth) return;
      sibuk = true;
      var p;
      if (det) {
        p = det.detect(v).then(function (r) { return r.length ? r[0].rawValue : bacaJsQR(); })
          .catch(function () { det = null; return bacaJsQR(); });
      } else {
        p = new Promise(function (ok) { ok(bacaJsQR()); });
      }
      p.then(function (teks) {
        if (!teks) return;
        var z = zonaDariQR(teks);
        if (z) { tutupScan(); setZona(z); PC.toast("Lokasi: " + z, "ok"); }
        else { $("scan-teks").textContent = "QR bukan lokasi patroli"; }
      }).catch(function () {}).then(function () { sibuk = false; });
    }, 200);
  }

  function bukaScan() {
    if (!window.BarcodeDetector && !window.jsQR) { PC.toast("Scan tidak didukung. Pakai kamera HP.", "bad"); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      PC.toast("Kamera tidak tersedia. Buka lewat HTTPS dan pakai Safari/Chrome terbaru.", "bad"); return;
    }
    var v = $("scan-video");
    // iOS Safari: video harus muted + playsinline, kalau tidak kamera hitam / tidak mau diputar.
    v.muted = true; v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    $("scan-teks").textContent = "Membuka kamera...";
    $("scan").hidden = false;
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
    }).catch(function (e) {
      if (e && (e.name === "OverconstrainedError" || e.name === "NotFoundError"))
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      throw e;
    }).then(function (st) {
      if ($("scan").hidden) { st.getTracks().forEach(function (t) { t.stop(); }); throw new Error("batal"); }   // dibatalkan saat menunggu izin
      scanStream = st; tandaiKameraOk();
      v.srcObject = st;
      $("scan-teks").textContent = "Arahkan ke QR lokasi";
      var pl = v.play();
      return pl && pl.catch ? pl.catch(function () {}) : pl;
    }).then(mulaiDeteksi).catch(function (e) {
      if (e && e.message === "batal") return;
      tutupScan();
      PC.toast(e && e.name === "NotAllowedError"
        ? "Izin kamera ditolak. Izinkan kamera di Pengaturan > Safari, lalu coba lagi."
        : "Kamera tidak bisa dibuka.", "bad");
    });
  }

  /* ---------- Kolom nama (dropdown bisa di-scroll) ---------- */
  function buatKombo(o) {
    var inp = o.input, ul = o.list, aktif = -1;
    function daftar() { return o.items() || []; }
    function kanon() {
      var v = inp.value.trim().toLowerCase(), a = daftar();
      for (var i = 0; i < a.length; i++) if (a[i].toLowerCase() === v) return a[i];
      return "";
    }
    function tutup() { ul.hidden = true; aktif = -1; inp.setAttribute("aria-expanded", "false"); }
    function pilih(n) { inp.value = n; tutup(); inp.blur(); o.onPick(n); }
    function sorot(i) {
      var li = ul.querySelectorAll("li[role=option]");
      if (!li.length) return;
      aktif = (i + li.length) % li.length;
      Array.prototype.forEach.call(li, function (x, j) { x.setAttribute("aria-selected", j === aktif ? "true" : "false"); });
      li[aktif].scrollIntoView({ block: "nearest" });
    }
    function gambar() {
      var q = inp.value.trim().toLowerCase();
      ul.textContent = ""; aktif = -1;
      var hasil = daftar().filter(function (n) { return !q || n.toLowerCase().indexOf(q) >= 0; });
      if (!hasil.length) ul.appendChild(h("li", { class: "kosong", text: o.kosong || "Tidak ada." }));
      hasil.forEach(function (n) {
        var li = h("li", { role: "option", text: n });
        li.addEventListener("click", function () { pilih(n); });
        ul.appendChild(li);
      });
      ul.hidden = false; inp.setAttribute("aria-expanded", "true");
      var r = inp.getBoundingClientRect(), bawah = window.innerHeight - r.bottom - 150;
      ul.classList.toggle("atas", bawah < 200 && r.top > bawah);
    }
    inp.addEventListener("focus", gambar);
    inp.addEventListener("input", function () { gambar(); o.onPick(kanon()); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (ul.hidden) gambar(); sorot(aktif + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sorot(aktif - 1); }
      else if (e.key === "Enter") {
        var li = ul.querySelectorAll("li[role=option]");
        if (!ul.hidden && li.length) { e.preventDefault(); pilih(li[aktif >= 0 ? aktif : 0].textContent); }
      } else if (e.key === "Escape") tutup();
    });
    // Tutup hanya saat menyentuh di luar (bukan saat scroll di dalam daftar)
    document.addEventListener("pointerdown", function (e) {
      if (!ul.hidden && e.target !== inp && !ul.contains(e.target)) tutup();
    });
    return { nilai: kanon };
  }

  /* Sembunyikan teks "Item X dari Y ..." di checklist */
  function rapikanChecklist() {
    var w = $("checklist");
    if (!w) return;
    var rapi = function () {
      Array.prototype.forEach.call(w.querySelectorAll("*"), function (el) {
        if (!el.children.length && /^Item\s+\d+\s+dari\s+\d+/i.test(el.textContent.trim())) el.hidden = true;
      });
    };
    rapi();
    new MutationObserver(rapi).observe(w, { childList: true, subtree: true, characterData: true });
  }

  /* ---------- Shift, kunci nama + shift, dan ronde ---------- */
  function sekarangMs() { return PC.Jam.kini().getTime(); }
  function jamTeks(j) { return String(j || "").replace(":", "."); }
  function jamDariMs(ms) { return PC.fmtWIB(new Date(ms)).jam.slice(0, 5).replace(":", "."); }
  function perluShift() { return !!(master && master.shift && master.shift.length); }
  function sisaTeks(menit) { return menit >= 60 ? Math.floor(menit / 60) + " j " + (menit % 60 ? (menit % 60) + " m" : "") : menit + " m"; }

  function bacaKunci() { try { return JSON.parse(localStorage.getItem(KUNCI_PETUGAS)); } catch (e) { return null; } }
  function simpanKunci() { try { localStorage.setItem(KUNCI_PETUGAS, JSON.stringify(kunci)); } catch (e) {} }

  function daftarLantaiForm() {
    var u = [];
    (master.daftarZona || []).forEach(function (z) { var f = lantaiZonaJs(z); if (f && u.indexOf(f) < 0) u.push(f); });
    function rk(f) { if (f === "LG") return 0; var m = /^L(\d+)$/.exec(f); return m ? 1 + Number(m[1]) : 100; }
    return u.sort(function (a, b) { return rk(a) - rk(b) || a.localeCompare(b); });
  }

  function gambarShift() {
    var wadah = $("shift-grup"), lw = $("lantai-grup");
    PC.kosongkan(wadah); PC.kosongkan(lw);
    $("shift-wadah").hidden = !perluShift();
    (master.shift || []).forEach(function (x) {
      wadah.appendChild(h("button", { type: "button", class: "lantai-btn", "aria-pressed": shiftDipilih === x.nama ? "true" : "false",
        disabled: !!kunci, onclick: function () { if (kunci) return; shiftDipilih = x.nama; gambarShift(); cobaKunci(); ubah(); } },
        x.nama, h("small", { class: "shift-jam", text: jamTeks(x.mulai) + "-" + jamTeks(x.selesai) })));
    });
    var lt = perluShift() ? daftarLantaiForm() : [];
    $("lantai-wadah").hidden = !lt.length;
    lt.forEach(function (f) {
      lw.appendChild(h("button", { type: "button", class: "lantai-btn", "aria-pressed": lantaiDipilih === f ? "true" : "false",
        disabled: !!kunci, onclick: function () { if (kunci) return; lantaiDipilih = f; gambarShift(); cobaKunci(); ubah(); } }, f));
    });
  }

  function tampilKunci() {
    var ada = !!kunci;
    $("nama").disabled = ada;
    $("b-nama").classList.toggle("terkunci", ada);
    gambarShift();
  }

  function bukaKunci(diam) {
    kunci = null; shiftDipilih = ""; lantaiDipilih = ""; ronde = null;
    try { localStorage.removeItem(KUNCI_PETUGAS); } catch (e) {}
    $("nama").value = "";
    tampilKunci(); gambarRonde(); saranZona(); ubah();
    if (!diam) PC.toast("Pilih shift, lantai, dan nama lagi.", "ok");
  }

  // Kunci terpasang setelah shift dan nama dipilih, dan hanya bila shift itu memang sedang berjalan.
  function cobaKunci() {
    var nama = cbNama && cbNama.nilai();
    var lantaiAda = !daftarLantaiForm().length;   // zona tanpa pola lantai: lantai tidak diminta
    if (kunci || mengunciProses || !nama || !shiftDipilih || !(lantaiDipilih || lantaiAda) || !perluShift()) return;
    mengunciProses = true;
    PC.api("statusRonde", { nama: nama, shift: shiftDipilih, lantai: lantaiDipilih, simpan: true }, 20000).then(function (r) {
      if (r.status !== "SUCCESS") { PC.toast(r.message || "Gagal memeriksa shift.", "bad"); return; }
      if (!r.shiftAktif) {
        PC.toast("Shift " + shiftDipilih + (r.mulai ? " (" + jamTeks(r.mulai) + "-" + jamTeks(r.selesai) + ")" : "") + " sedang tidak berjalan.", "bad");
        shiftDipilih = ""; gambarShift(); ubah(); return;
      }
      kunci = { nama: nama, shift: shiftDipilih, lantai: lantaiDipilih, sampai: r.akhirMs, t: r.waktuServer || sekarangMs(), v: String(master.kunciVersi || "0") };
      simpanKunci(); tampilKunci();
      ronde = r.ada ? r : null;
      gambarRonde(); ubah();
    }).catch(function () {
      kunci = { nama: nama, shift: shiftDipilih, lantai: lantaiDipilih, sampai: sekarangMs() + 12 * 3600000, t: sekarangMs(), v: String(master.kunciVersi || "0") };
      simpanKunci(); tampilKunci(); ubah();
    }).then(function () { mengunciProses = false; });
  }

  function pulihKunci() {
    var k = bacaKunci();
    if (!k || !k.nama || !k.shift) return;
    var valid = k.sampai > sekarangMs() && String(k.v || "0") === String(master.kunciVersi || "0") && master.daftarNama.indexOf(k.nama) >= 0;
    if (!valid) { try { localStorage.removeItem(KUNCI_PETUGAS); } catch (e) {} return; }
    kunci = k; shiftDipilih = k.shift; lantaiDipilih = k.lantai || "";
    $("nama").value = k.nama;
    tampilKunci();
    muatRonde();
  }

  function periksaKunci() {
    if (!kunci) return;
    if (kunci.sampai <= sekarangMs()) { bukaKunci(true); PC.toast("Shift selesai. Pilih shift, lantai, dan nama lagi.", ""); return; }
    if (master && String(kunci.v || "0") !== String(master.kunciVersi || "0")) { bukaKunci(true); PC.toast("Kunci dibuka admin. Pilih lagi.", ""); }
  }

  // Muat ulang data tanpa menutup halaman (isian dan foto tetap aman).
  function segarkan() {
    var b = $("btn-segar"); b.disabled = true; b.classList.add("memuat");
    var t0 = Date.now();
    PC.api("ambilDropdown", {}, 25000).then(function (r) {
      if (r.status !== "SUCCESS") throw new Error(r.message);
      PC.Jam.sinkron(r.waktuServer + (Date.now() - t0) / 2);
      master = r;
      try { localStorage.setItem(KUNCI_MASTER, JSON.stringify(r)); } catch (e) {}
      periksaGeofence(); periksaKunci(); gambarShift(); muatRonde();
      PC.ZonaJadwal.muat().then(saranZona);
      if (antrean && antrean.segarkan) antrean.segarkan();
      PC.toast("Data diperbarui.", "ok");
    }).catch(function () { PC.toast("Gagal memuat. Periksa sinyal.", "bad"); })
      .then(function () { b.disabled = false; b.classList.remove("memuat"); });
  }

  function gambarRonde() {
    var el = $("ronde");
    PC.kosongkan(el);
    if (!ronde || !ronde.ada) { el.hidden = true; return; }
    el.hidden = false; el.className = "ronde";
    var kepala = h("div", { class: "ronde-kepala" },
      h("div", { class: "ronde-judul", text: (ronde.lantai || []).join(", ") + "  \u00b7  Shift " + ronde.shift }));
    if (ronde.aktif) kepala.appendChild(h("span", { class: "ronde-badge", text: "Sesi " + ronde.ronde + "/" + ronde.totalRonde }));
    el.appendChild(kepala);
    if (!ronde.aktif) {
      el.classList.add("ronde-diam");
      el.appendChild(h("p", { class: "ronde-ket", text: (ronde.alasan || "Di luar jam shift") + "." }));
      return;
    }
    var persen = ronde.total ? Math.round(ronde.selesaiJml * 100 / ronde.total) : 0;
    el.classList.toggle("ronde-lengkap", !!ronde.lengkap);
    el.appendChild(h("div", { class: "ronde-angka" },
      h("span", null, h("b", { text: String(ronde.selesaiJml) }), " dari " + ronde.total + " zona"),
      h("span", { class: "ronde-sisa", text: ronde.lengkap ? "Selesai" : "Sisa " + sisaTeks(ronde.sisaMenit) })));
    el.appendChild(h("progress", { max: "100", value: String(persen), "aria-label": "Progres sesi patroli" }));
    el.appendChild(h("p", { class: "ronde-ket", text: ronde.lengkap
      ? "Semua zona sesi ini sudah dipatroli." + (ronde.rondeBerikut ? " Sesi berikut mulai " + jamTeks(ronde.rondeBerikut) + "." : "")
      : "Sesi " + jamTeks(ronde.mulaiRonde) + "\u2013" + jamTeks(ronde.selesaiRonde) + ". Datangi semua zona sebelum " + jamTeks(ronde.selesaiRonde) + "." }));
    if (!ronde.lengkap && ronde.belum && ronde.belum.length) {
      el.appendChild(h("details", { class: "ronde-belum" }, h("summary", { text: "Zona belum dipatroli (" + ronde.belum.length + ")" }),
        h("div", { class: "ronde-chip-wadah" }, ronde.belum.map(function (n) { return h("span", { class: "ronde-chip", text: n }); }))));
    }
  }

  function muatRonde() {
    if (!kunci) return;
    var nama = kunci.nama;
    PC.api("statusRonde", { nama: nama, shift: kunci.shift, lantai: kunci.lantai }, 20000).then(function (r) {
      if (r.status !== "SUCCESS" || !kunci || kunci.nama !== nama) return;
      if (r.bukaKunci && r.bukaKunci > (kunci.t || 0)) { bukaKunci(true); PC.toast("Kunci dibuka admin. Pilih lagi.", ""); return; }
      if (r.shiftAktif && r.akhirMs && r.akhirMs !== kunci.sampai) { kunci.sampai = r.akhirMs; simpanKunci(); tampilKunci(); }
      ronde = r.ada ? r : null;
      gambarRonde(); ubah();
    }).catch(function () {});
  }

  /* ---------- Muat data ---------- */
  /* Data dari cache dipakai langsung (halaman terbuka tanpa menunggu), lalu disegarkan di latar belakang. */
  function muat() {
    var muatEl = $("muat"), sudahMulai = false, cache = null;
    try { cache = JSON.parse(localStorage.getItem(KUNCI_MASTER)); } catch (e) {}
    if (cache && cache.checklist && cache.daftarNama) { master = cache; sudahMulai = true; mulai(); }
    else { muatEl.hidden = false; PC.kosongkan(muatEl); muatEl.textContent = "Memuat..."; }
    var t0 = Date.now();
    PC.api("ambilDropdown", {}, 25000).then(function (r) {
      if (r.status !== "SUCCESS") throw new Error(r.message);
      PC.Jam.sinkron(r.waktuServer + (Date.now() - t0) / 2);
      master = r;
      try { localStorage.setItem(KUNCI_MASTER, JSON.stringify(r)); } catch (e) {}
      if (!sudahMulai) { sudahMulai = true; mulai(); } else { periksaGeofence(); periksaKunci(); gambarShift(); }
    }).catch(function () {
      if (sudahMulai) { if (!PC.Jam.terpercaya()) PC.sinkronJam(); return; }
      PC.kosongkan(muatEl);
      muatEl.hidden = false;
      muatEl.appendChild(h("p", { text: "Gagal memuat." }));
      muatEl.appendChild(h("button", { type: "button", class: "btn btn-utama", text: "Coba Lagi", onclick: muat }));
    });
  }

  function mulai() {
    $("muat").hidden = true;
    $("form").hidden = false;
    $("bar-kirim").hidden = false;

    cbNama = buatKombo({ input: $("nama"), list: $("daftar-nama"), kosong: "Nama tidak terdaftar.",
      items: function () { return master.daftarNama; },
      onPick: function (v) {
        $("g-nama").hidden = true; $("nama").classList.remove("invalid");
        if (v) cobaKunci();
        ubah();
      } });
    gambarShift();
    pulihKunci();
    $("btn-segar").addEventListener("click", segarkan);
    setInterval(function () { periksaKunci(); if (kunci && !document.hidden) muatRonde(); }, 60000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) { periksaKunci(); muatRonde(); } });
    foto = PC.FotoGrid($("foto-grid"), { maks: 3, onUbah: ubah });
    try { localStorage.setItem("dp_cl_mode", "daftar"); } catch (e) {}   // tampilan daftar: tanpa tombol Sebelumnya/Selesai
    cl = PC.Checklist($("checklist"), { onUbah: ubah });
    rapikanChecklist();

    // Draft: checklist, tingkat, catatan. Lokasi TIDAK dipulihkan dari draft: hanya sah dari pindai QR.
    var draft = bacaDraft();
    cl.set(master.checklist.PATROLI, draft && draft.cl);
    // Semua item patroli dimatikan admin: bagian checklist hilang (kolom catatan tetap ada).
    var adaItem = (master.checklist.PATROLI || []).length > 0;
    $("cl-kepala").hidden = !adaItem;
    $("checklist").hidden = !adaItem;
    if (draft) {
      $("catatan").value = draft.catatan || "";
      if (draft.tingkat) {
        tingkat = draft.tingkat;
        var r = document.querySelector('input[name="tingkat"][value="' + draft.tingkat + '"]');
        if (r) r.checked = true;
      }
    }

    try {
      var zq = new URLSearchParams(location.search).get("zona");
      if (zq && master.daftarZona.indexOf(zq) >= 0) { zona = zq; zonaQR = zq; }
    } catch (e) {}
    tampilLokasi();
    PC.ZonaJadwal.muat().then(saranZona);
    setInterval(saranZona, 60000);

    try { localStorage.removeItem(KUNCI_NAMA); } catch (e) {}   // nama tidak lagi terisi otomatis

    Array.prototype.forEach.call(document.querySelectorAll('input[name="tingkat"]'), function (r) {
      r.addEventListener("change", function () { tingkat = r.value; ubah(); });
    });
    $("catatan").addEventListener("input", ubah);
    $("catatan").addEventListener("input", rapatkanCatatan);
    $("btn-izin").addEventListener("click", mintaAkses);
    PC.Lokasi.on(segarIzin);
    cekIzin();
    $("btn-scan").addEventListener("click", bukaScan);
    $("scan-batal").addEventListener("click", tutupScan);
    window.addEventListener("pagehide", tutupScan);
    $("btn-foto").addEventListener("click", ambilFoto);
    $("btn-kirim").addEventListener("click", kirim);

    // Pantau GPS tanpa menyimpan draft berulang-ulang
    setInterval(render, 3000);
    ubah();
  }

  /* ---------- Draft ---------- */
  function bacaDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(KUNCI_DRAFT));
      if (d && Date.now() - d.t < 12 * 3600 * 1000) return d;
    } catch (e) {}
    return null;
  }
  function simpanDraft() {
    try {
      localStorage.setItem(KUNCI_DRAFT, JSON.stringify({
        t: Date.now(), cl: cl.ekspor(), tingkat: tingkat, catatan: $("catatan").value
      }));
    } catch (e) {}
  }

  /* ---------- Syarat kirim ---------- */
  function syarat() {
    var c = cl.nilai(), s = [];
    s.push({ ok: !!zona, label: "lokasi" });
    if (perluShift()) s.push({ ok: !!shiftDipilih, label: "shift" });
    if (perluShift() && daftarLantaiForm().length) s.push({ ok: !!lantaiDipilih, label: "lantai" });
    s.push({ ok: !!cbNama.nilai(), label: "nama" });
    s.push({ ok: !!c.lengkap, label: "checklist (" + c.terisi + "/" + c.total + ")" });
    if (c.adaTemuan) {
      s.push({ ok: !!tingkat, label: "tingkat temuan" });
    }
    s.push({ ok: foto.daftar().length > 0, label: "foto" });
    if (geoState !== "none") {
      s.push({ ok: geoState === "ok", label: geoState === "cari" ? "GPS" : "posisi di area" });
    }
    return s;
  }
  function kekurangan() {
    return syarat().filter(function (x) { return !x.ok; }).map(function (x) { return x.label; });
  }

  /* ---------- Render ---------- */
  function render() {
    if (!cl) return;
    periksaGeofence();
    var c = cl.nilai(), s = syarat();
    var k = s.filter(function (x) { return !x.ok; }).map(function (x) { return x.label; });
    var selesaiN = s.length - k.length;

    $("progres").textContent = c.terisi + "/" + c.total;
    $("blok-temuan").hidden = !c.adaTemuan;
    if (!c.adaTemuan && tingkat) {
      tingkat = "";
      Array.prototype.forEach.call(document.querySelectorAll('input[name="tingkat"]'), function (r) { r.checked = false; });
    }

    var nFoto = foto.daftar().length;
    var lokasiOk = geoState === "none" || geoState === "ok";
    var siapFoto = !!cbNama.nilai() && !!zona && lokasiOk;
    $("jml-foto").textContent = nFoto + "/3";
    $("btn-foto").disabled = !siapFoto || foto.penuh();
    $("btn-foto-teks").textContent = foto.penuh() ? "Maks 3" : (nFoto ? "Tambah Foto" : "Ambil Foto");

    $("kurang").textContent = k.length ? "Kurang: " + k.join(", ") : "Siap dikirim";
    $("kurang").className = "kurang" + (k.length ? "" : " siap");
    var bar = $("bar-progres");
    bar.max = s.length; bar.value = selesaiN;
    bar.className = k.length ? "" : "siap";

    $("btn-kirim").disabled = mengirim || k.length > 0;

    $("b-nama").classList.toggle("selesai", !!cbNama.nilai());
    $("b-cl").classList.toggle("selesai", !!c.lengkap && (!c.adaTemuan || (!c.catatanKurang && !!tingkat)));
    $("b-foto").classList.toggle("selesai", nFoto > 0);
  }

  function ubah() {
    if (!cl) return;
    render();
    clearTimeout(timerDraft);
    timerDraft = setTimeout(simpanDraft, 500);
  }

  /* ---------- Foto ---------- */
  function ambilFoto() {
    PC.Kamera.buka({
      baris: function (now) {
        var f = PC.fmtWIB(now);
        return [f.tgl + "  " + f.jam + " WIB", "Patroli: " + (zona || "-"),
          "Petugas: " + (cbNama.nilai() || "-"), PC.teksGps()];
      },
      onFoto: function (f) { foto.tambah(f); }
    });
  }

  /* ---------- Kirim ---------- */
  function setMengirim(v) {
    mengirim = v;
    $("btn-kirim").textContent = v ? "Mengirim..." : "Kirim";
    ubah();
  }

  function reset() {
    cl.set(master.checklist.PATROLI);
    zona = ""; zonaQR = "";
    tampilLokasi();
    $("catatan").value = "";
    tingkat = "";
    foto.kosongkan();
    idLaporan = PC.buatId();
    try { localStorage.removeItem(KUNCI_DRAFT); } catch (e) {}
    window.scrollTo({ top: 0, behavior: "smooth" });
    ubah();
  }

  function kirim() {
    periksaGeofence();
    var k = kekurangan();
    if (mengirim || k.length) {
      if (k.length) PC.toast("Kurang: " + k.join(", "), "bad");
      render();
      return;
    }
    var c = cl.nilai(), gps = PC.Lokasi.saatIni();
    var payload = {
      id: idLaporan, nama: cbNama.nilai(), shift: shiftDipilih, zona: zona,
      checklist: c.daftar, tingkat: c.adaTemuan ? tingkat : "", catatan: $("catatan").value.trim(),
      lat: gps ? gps.lat : null, lng: gps ? gps.lng : null, akurasi: gps ? gps.akurasi : null,
      fotos: foto.daftar().map(function (f) { return { b64: f.b64, t: f.t, sumber: f.sumber }; }),
      jamPerangkat: !PC.Jam.terpercaya(), durasiDetik: cl.durasiDetik(), qr: !!zonaQR
    };
    var zonaTeks = payload.zona;
    setMengirim(true);
    PC.api("simpanPatroli", { payload: payload }).then(function (r) {
      if (r.status === "SUCCESS") {
        var hasil = $("hasil");
        hasil.textContent = "Tercatat" + (r.waktu ? " " + r.waktu + " WIB" : "") + " · " + zonaTeks;
        hasil.hidden = false;
        PC.toast("Terkirim.", "ok");
        PC.Riwayat.catat({ id: payload.id, jenis: "PATROLI", judul: zonaTeks, zona: zonaTeks, temuan: c.adaTemuan, status: "terkirim" });
        reset();
        PC.ZonaJadwal.muat().then(saranZona);
        muatRonde();
        return;
      }
      PC.toast(r.message || "Ditolak.", "bad");
      if (r.kode === "NAMA") {
        var g = $("g-nama");
        g.textContent = r.message; g.hidden = false;
        $("nama").classList.add("invalid"); $("nama").focus();
      }
    }).catch(function (e) {
      if (!e.jaringan) { PC.toast("Gagal mengirim.", "bad"); return; }
      PC.Antrean.simpan({ id: payload.id, aksi: "simpanPatroli", payload: payload, dibuat: Date.now(),
        status: "menunggu", label: "Patroli " + zonaTeks }).then(function () {
        PC.Riwayat.catat({ id: payload.id, jenis: "PATROLI", judul: zonaTeks, zona: zonaTeks, temuan: c.adaTemuan, status: "menunggu" });
        PC.toast("Offline. Tersimpan di HP.", "ok");
        $("hasil").hidden = true;
        reset();
        antrean.segarkan();
      }).catch(function () {
        PC.toast("Gagal menyimpan.", "bad");
      });
    }).then(function () { setMengirim(false); });
  }

  muat();
})();
