/* index.js v16 - Form Patroli Petugas (QR zona + Hard Geofence) */
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
  if ($("ikon-foto")) $("ikon-foto").appendChild(PC.ikon("KAMERA"));

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
      tampilGeo("cari", "Mencari sinyal GPS... pastikan izin lokasi aktif.");
      return;
    }
    var jarak = hitungJarakM(gps.lat, gps.lng, lat0, lng0);
    var toleransi = Math.min(Math.max(parseFloat(gps.akurasi) || 0, 0), TOLERANSI_GPS_MAKS);
    if (jarak - toleransi > radius) {
      geoState = "luar";
      tampilGeo("luar", "Di luar area mall (" + Math.round(jarak) + " m dari titik pusat, maks " + Math.round(radius) + " m). Pengiriman dikunci.");
    } else {
      geoState = "ok";
      tampilGeo("ok", "Posisi di dalam area mall.");
    }
  }

  /* ---------- Lokasi (QR) ---------- */
  function tampilLokasi() {
    var ada = !!zona;
    $("lokasi-nama").textContent = ada ? zona : "Belum ada lokasi";
    $("lokasi-tag").textContent = ada ? "Terverifikasi QR" : "Belum dipindai";
    $("lokasi-petunjuk").hidden = ada;
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

  /* ---------- Muat data ---------- */
  function muat() {
    var muatEl = $("muat");
    muatEl.hidden = false;
    PC.kosongkan(muatEl);
    muatEl.textContent = "Memuat data...";
    var t0 = Date.now();
    PC.api("ambilDropdown", {}, 25000).then(function (r) {
      if (r.status !== "SUCCESS") throw new Error(r.message);
      PC.Jam.sinkron(r.waktuServer + (Date.now() - t0) / 2);
      master = r;
      try { localStorage.setItem(KUNCI_MASTER, JSON.stringify(r)); } catch (e) {}
    }).catch(function () {
      try {
        var c = JSON.parse(localStorage.getItem(KUNCI_MASTER));
        if (c && c.checklist) { master = c; PC.toast("Memakai data tersimpan.", "bad"); }
      } catch (e) {}
    }).then(function () {
      if (master) { mulai(); return; }
      PC.kosongkan(muatEl);
      muatEl.appendChild(h("p", { text: "Gagal memuat data." }));
      muatEl.appendChild(h("button", { type: "button", class: "btn btn-utama", text: "Coba Lagi", onclick: muat }));
    });
  }

  function mulai() {
    $("muat").hidden = true;
    $("form").hidden = false;
    $("bar-kirim").hidden = false;

    cbNama = PC.Combobox({ input: $("nama"), list: $("daftar-nama"), kosong: "Nama tidak terdaftar.",
      items: function () { return master.daftarNama; },
      onPick: function (v) {
        if (v) { try { localStorage.setItem(KUNCI_NAMA, v); } catch (e) {} }
        $("g-nama").hidden = true; $("nama").classList.remove("invalid");
        ubah();
      } });
    foto = PC.FotoGrid($("foto-grid"), { maks: 3, onUbah: ubah });
    cl = PC.Checklist($("checklist"), { onUbah: ubah });

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
      PC.toast(n ? n + " item ditandai Sesuai." : "Semua item sudah dijawab.", n ? "ok" : "");
    });
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
    s.push({ ok: !!zona, label: "pindai QR lokasi" });
    s.push({ ok: !!cbNama.nilai(), label: "nama petugas" });
    s.push({ ok: !!c.lengkap, label: "checklist (" + c.terisi + "/" + c.total + ")" });
    if (c.adaTemuan) {
      s.push({ ok: !c.catatanKurang, label: "penjelasan temuan" });
      s.push({ ok: !!tingkat, label: "tingkat temuan" });
    }
    s.push({ ok: foto.daftar().length > 0, label: "foto" });
    if (geoState !== "none") {
      s.push({ ok: geoState === "ok", label: geoState === "cari" ? "sinyal GPS" : "posisi di dalam area mall" });
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

    $("progres").textContent = c.terisi + " dari " + c.total;
    $("blok-temuan").hidden = !c.adaTemuan;
    if (!c.adaTemuan && tingkat) {
      tingkat = "";
      Array.prototype.forEach.call(document.querySelectorAll('input[name="tingkat"]'), function (r) { r.checked = false; });
    }

    var nFoto = foto.daftar().length;
    var lokasiOk = geoState === "none" || geoState === "ok";
    var siapFoto = !!cbNama.nilai() && !!zona && lokasiOk;
    $("jml-foto").textContent = nFoto + " dari 3";
    $("btn-foto").disabled = !siapFoto || foto.penuh();
    $("btn-foto-teks").textContent = foto.penuh() ? "Foto maks 3" : (nFoto ? "Tambah Foto" : "Ambil Foto");
    $("hint-foto").textContent = siapFoto ? "" :
      (!zona || !cbNama.nilai() ? "Pindai QR lokasi dan pilih nama dulu." : "Foto aktif setelah posisi Anda di dalam area mall.");

    $("kurang").textContent = k.length ? "Lengkapi: " + k.join(", ") : "Semua isian lengkap. Siap dikirim.";
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
    $("btn-kirim").textContent = v ? "Mengirim..." : "Kirim Laporan Patroli";
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
      if (k.length) PC.toast("Lengkapi: " + k.join(", "), "bad");
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
        hasil.textContent = "Laporan patroli tercatat" + (r.waktu ? " pukul " + r.waktu + " WIB" : "") + ". Lokasi: " + zonaTeks + ".";
        hasil.hidden = false;
        PC.toast("Laporan tersimpan.", "ok");
        reset();
        return;
      }
      PC.toast(r.message || "Laporan ditolak.", "bad");
      if (r.kode === "NAMA") {
        var g = $("g-nama");
        g.textContent = r.message; g.hidden = false;
        $("nama").classList.add("invalid"); $("nama").focus();
      }
    }).catch(function (e) {
      if (!e.jaringan) { PC.toast("Gagal mengirim. Coba lagi.", "bad"); return; }
      PC.Antrean.simpan({ id: payload.id, aksi: "simpanPatroli", payload: payload, dibuat: Date.now(),
        status: "menunggu", label: "Patroli " + zonaTeks }).then(function () {
        PC.toast("Tidak ada sinyal. Laporan disimpan di perangkat.", "ok");
        $("hasil").hidden = true;
        reset();
        antrean.segarkan();
      }).catch(function () {
        PC.toast("Penyimpanan gagal. Coba kirim kembali.", "bad");
      });
    }).then(function () { setMengirim(false); });
  }

  muat();
})();
