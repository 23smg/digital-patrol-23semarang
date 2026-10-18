/* index.js v23 - Form Patroli Petugas (QR zona + Hard Geofence) */
(function () {
  "use strict";
  var PC = window.PC, h = PC.h;
  var $ = function (id) { return document.getElementById(id); };
  var KUNCI_DRAFT = "dp_draft_patroli_v2", KUNCI_MASTER = "dp_master_v2", KUNCI_NAMA = "dp_nama";
  var TOLERANSI_GPS_MAKS = 30; // meter; akurasi GPS dipakai sbg toleransi, maksimal segini. Isi 0 = geofence mutlak.
  var master = null, idLaporan = PC.buatId(), tingkat = "", zona = "", zonaQR = "", mengirim = false, timerDraft = null;
  var cbNama, cl, foto;
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
    $("lokasi-nama").textContent = zona;
    $("lokasi-nama").hidden = !ada;
    $("btn-scan").textContent = ada ? "Scan Ulang" : "Scan QR";
    $("b-lokasi").classList.toggle("selesai", ada);

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
    elBadge.textContent = "📍 " + zona;
  }

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

  function setZona(z) {
    if (zona && zona !== z && foto.daftar().length) {
      foto.kosongkan();
      PC.toast("Lokasi berubah, foto direset.", "bad");
    }
    zona = z; zonaQR = z;
    tampilLokasi();
    ubah();
  }

  function mulaiDeteksi() {
    var v = $("scan-video"), det = null, cv = null, sibuk = false;
    if (window.BarcodeDetector) { try { det = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) {} }
    scanTimer = setInterval(function () {
      if (sibuk || v.readyState < 2) return;
      sibuk = true;
      var p;
      if (det) {
        p = det.detect(v).then(function (r) { return r.length ? r[0].rawValue : ""; });
      } else {
        p = new Promise(function (ok) {
          if (!cv) cv = document.createElement("canvas");
          var sk = Math.min(1, 800 / (v.videoWidth || 800));
          cv.width = Math.round(v.videoWidth * sk); cv.height = Math.round(v.videoHeight * sk);
          var ctx = cv.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(v, 0, 0, cv.width, cv.height);
          var d = ctx.getImageData(0, 0, cv.width, cv.height);
          var q = window.jsQR(d.data, d.width, d.height);
          ok(q ? q.data : "");
        });
      }
      p.then(function (teks) {
        if (!teks) return;
        var z = zonaDariQR(teks);
        if (z) { tutupScan(); setZona(z); PC.toast("Lokasi: " + z, "ok"); }
        else $("scan-teks").textContent = "QR bukan lokasi patroli";
      }).catch(function () {}).then(function () { sibuk = false; });
    }, 250);
  }

  function bukaScan() {
    if (!window.BarcodeDetector && !window.jsQR) { PC.toast("Scan tidak didukung. Pakai kamera HP.", "bad"); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { PC.toast("Kamera tidak tersedia.", "bad"); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (st) {
      scanStream = st;
      var v = $("scan-video"); v.srcObject = st;
      $("scan-teks").textContent = "Arahkan ke QR lokasi";
      $("scan").hidden = false;
      return v.play();
    }).then(mulaiDeteksi).catch(function () {
      tutupScan();
      PC.toast("Kamera tidak bisa dibuka.", "bad");
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

  /* ---------- Muat data ---------- */
  function muat() {
    var muatEl = $("muat");
    muatEl.hidden = false;
    PC.kosongkan(muatEl);
    muatEl.textContent = "Memuat...";
    var t0 = Date.now();
    PC.api("ambilDropdown", {}, 25000).then(function (r) {
      if (r.status !== "SUCCESS") throw new Error(r.message);
      PC.Jam.sinkron(r.waktuServer + (Date.now() - t0) / 2);
      master = r;
      try { localStorage.setItem(KUNCI_MASTER, JSON.stringify(r)); } catch (e) {}
    }).catch(function () {
      try {
        var c = JSON.parse(localStorage.getItem(KUNCI_MASTER));
        if (c && c.checklist) { master = c; PC.toast("Data offline.", "bad"); }
      } catch (e) {}
    }).then(function () {
      if (master) { mulai(); return; }
      PC.kosongkan(muatEl);
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
        if (v) { try { localStorage.setItem(KUNCI_NAMA, v); } catch (e) {} }
        $("g-nama").hidden = true; $("nama").classList.remove("invalid");
        ubah();
      } });
    foto = PC.FotoGrid($("foto-grid"), { maks: 3, onUbah: ubah });
    cl = PC.Checklist($("checklist"), { onUbah: ubah });
    rapikanChecklist();

    // Draft: checklist, tingkat, catatan. Lokasi TIDAK dipulihkan dari draft: hanya sah dari pindai QR.
    var draft = bacaDraft();
    cl.set(master.checklist.PATROLI, draft && draft.cl);
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

    var tersimpan = null;
    try { tersimpan = localStorage.getItem(KUNCI_NAMA); } catch (e) {}
    if (tersimpan && master.daftarNama.indexOf(tersimpan) >= 0) $("nama").value = tersimpan;

    Array.prototype.forEach.call(document.querySelectorAll('input[name="tingkat"]'), function (r) {
      r.addEventListener("change", function () { tingkat = r.value; ubah(); });
    });
    $("catatan").addEventListener("input", ubah);
    $("btn-semua").addEventListener("click", function () {
      var n = cl.isiSemuaSesuai();
      PC.toast(n ? n + " item sesuai." : "Sudah lengkap.", n ? "ok" : "");
    });
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
    s.push({ ok: !!zona, label: "scan QR" });
    s.push({ ok: !!cbNama.nilai(), label: "nama" });
    s.push({ ok: !!c.lengkap, label: "checklist (" + c.terisi + "/" + c.total + ")" });
    if (c.adaTemuan) {
      s.push({ ok: !c.catatanKurang, label: "keterangan temuan" });
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
      id: idLaporan, nama: cbNama.nilai(), zona: zona,
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
        reset();
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
