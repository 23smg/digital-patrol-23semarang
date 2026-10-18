/* index.js - Form Patroli Petugas (Tampilan Mewah & Hard Geofence) */
(function () {
  "use strict";
  var PC = window.PC, h = PC.h;
  var $ = function (id) { return document.getElementById(id); };
  var KUNCI_DRAFT = "dp_draft_patroli_v2", KUNCI_MASTER = "dp_master_v2", KUNCI_NAMA = "dp_nama";
  var master = null, idLaporan = PC.buatId(), tingkat = "", zona = "", mengirim = false, timerDraft = null;
  var cbNama, cl, foto, zonaQR = "";
  var diluarArea = false;

  PC.pasangLogo(document.querySelector(".merek-grup"));
  PC.pasangTema(document.querySelector(".kepala-isi"));
  PC.pasangStempel($("stempel"));
  PC.Lokasi.mulai();
  var antrean = PC.pasangAntrean($("antrean-wadah"));
  PC.pasangPWA($("antrean-wadah"));
  setInterval(PC.sinkronJam, 300000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) PC.sinkronJam(); });
  if ($("ikon-foto")) $("ikon-foto").appendChild(PC.ikon("KAMERA"));

  function hitungJarakM(lat1, lng1, lat2, lng2) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function periksaGeofence() {
    var gps = PC.Lokasi.saatIni();
    var geo = master && master.geo ? master.geo : null;
    var pesanEl = $("pesan-geofence");

    if (geo && geo.lat && geo.lng && geo.radius) {
      var latMall = parseFloat(geo.lat), lngMall = parseFloat(geo.lng), radiusMaks = parseFloat(geo.radius);

      if (!gps || gps.lat === null || gps.lng === null) {
        diluarArea = true;
        if (pesanEl) {
          pesanEl.textContent = "⚠️ Mencari koordinat GPS... Mohon aktifkan GPS perangkat Anda.";
          pesanEl.hidden = false;
        }
        return;
      }

      var jarak = hitungJarakM(gps.lat, gps.lng, latMall, lngMall);

      if (jarak > radiusMaks) {
        diluarArea = true;
        if (pesanEl) {
          pesanEl.textContent = "🚫 Posisi di luar jangkauan area Mall (Jarak: " + Math.round(jarak) + "m, Maks: " + radiusMaks + "m). Tombol kirim dikunci.";
          pesanEl.hidden = false;
        }
        return;
      }
    }

    diluarArea = false;
    if (pesanEl) pesanEl.hidden = true;
  }

  function muat() {
    var muatEl = $("muat");
    muatEl.hidden = false;
    PC.kosongkan(muatEl);
    muatEl.textContent = "Memuat konfigurasi sistem...";
    var t0 = Date.now();
    PC.api("ambilDropdown", {}, 25000).then(function (r) {
      if (r.status !== "SUCCESS") throw new Error(r.message);
      PC.Jam.sinkron(r.waktuServer + (Date.now() - t0) / 2);
      master = r;
      try { localStorage.setItem(KUNCI_MASTER, JSON.stringify(r)); } catch (e) {}
    }).catch(function () {
      try {
        var c = JSON.parse(localStorage.getItem(KUNCI_MASTER));
        if (c && c.checklist) { master = c; PC.toast("Mode offline: Memakai data tersimpan.", "bad"); }
      } catch (e) {}
    }).then(function () {
      if (master) { mulai(); return; }
      PC.kosongkan(muatEl);
      muatEl.appendChild(h("p", { text: "Gagal memuat data. Periksa koneksi internet Anda." }));
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

    // Sembunyikan selektor zona manual
    if ($("zona-cari-wadah")) $("zona-cari-wadah").hidden = true;
    if ($("zona-lantai")) $("zona-lantai").hidden = true;
    if ($("zona-petunjuk")) $("zona-petunjuk").hidden = true;
    if ($("zona-grup")) $("zona-grup").hidden = true;

    var draft = bacaDraft();
    cl.set(master.checklist.PATROLI, draft && draft.cl);
    if (draft) {
      if (draft.zona) zona = draft.zona;
      $("catatan").value = draft.catatan || "";
      if (draft.tingkat) {
        tingkat = draft.tingkat;
        var r = document.querySelector('input[name="tingkat"][value="' + draft.tingkat + '"]');
        if (r) r.checked = true;
      }
    }

    // Deteksi QR Code lokasi
    try {
      var zq = new URLSearchParams(location.search).get("zona");
      if (zq && master.daftarZona.indexOf(zq) >= 0) {
        zona = zq;
        zonaQR = zq;
        if ($("zona-qr")) {
          $("zona-qr").hidden = false;
          $("zona-qr").innerHTML = "<span>📍</span> <span>Lokasi Terverifikasi: <strong>" + zq + "</strong></span>";
        }
      } else {
        if ($("zona-qr")) {
          $("zona-qr").hidden = false;
          $("zona-qr").style.border = "1px solid rgba(239, 68, 68, 0.4)";
          $("zona-qr").style.background = "rgba(239, 68, 68, 0.15)";
          $("zona-qr").style.color = "#fca5a5";
          $("zona-qr").innerHTML = "<span>⚠️</span> <span>Silakan pindai QR Code di lokasi patroli terlebih dahulu.</span>";
        }
      }
    } catch (e) {}

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

    setInterval(function () {
      periksaGeofence();
      ubah();
    }, 3000);

    ubah();
  }

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
        t: Date.now(), zona: zona, cl: cl.ekspor(), tingkat: tingkat, catatan: $("catatan").value
      }));
    } catch (e) {}
  }

  function kekurangan() {
    var k = [], c = cl.nilai();
    if (!cbNama.nilai()) k.push("nama petugas");
    if (!zona) k.push("pindai QR lokasi");
    if (!c.lengkap) k.push("checklist (" + c.terisi + "/" + c.total + ")");
    if (c.adaTemuan) {
      if (c.catatanKurang) k.push("penjelasan temuan");
      if (!tingkat) k.push("tingkat temuan");
    }
    if (!foto.daftar().length) k.push("foto");
    if (diluarArea) k.push("posisi berada di luar area mall");
    return k;
  }

  function ubah() {
    if (!cl) return;
    periksaGeofence();
    var c = cl.nilai(), k = kekurangan();
    $("progres").textContent = c.terisi + " dari " + c.total;
    $("blok-temuan").hidden = !c.adaTemuan;
    if (!c.adaTemuan) {
      tingkat = "";
      Array.prototype.forEach.call(document.querySelectorAll('input[name="tingkat"]'), function (r) { r.checked = false; });
    }
    $("jml-foto").textContent = foto.daftar().length + " dari 3";
    var siapFoto = !!cbNama.nilai() && !!zona;
    $("btn-foto").disabled = !siapFoto || foto.penuh();
    $("btn-foto-teks").textContent = foto.penuh() ? "Foto maksimal 3" : (foto.daftar().length ? "Tambah Foto" : "Ambil Foto Bukti");
    $("hint-foto").textContent = siapFoto ? "" : "Pilih nama petugas dan pindai QR lokasi terlebih dahulu.";
    $("kurang").textContent = k.length ? "Lengkapi: " + k.join(", ") : "Semua isian lengkap. Siap dikirim.";
    $("kurang").className = "kurang" + (k.length ? "" : " siap");
    
    $("btn-kirim").disabled = mengirim || k.length > 0 || diluarArea;

    $("b-nama").classList.toggle("selesai", !!cbNama.nilai());
    $("b-zona").classList.toggle("selesai", !!zona);
    if ($("b-cl")) $("b-cl").classList.toggle("selesai", c.lengkap && (!c.adaTemuan || (!c.catatanKurang && !!tingkat)));
    if ($("b-foto")) $("b-foto").classList.toggle("selesai", foto.daftar().length > 0);
    clearTimeout(timerDraft);
    timerDraft = setTimeout(simpanDraft, 500);
  }

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

  function setMengirim(v) {
    mengirim = v;
    $("btn-kirim").textContent = v ? "Mengirim Laporan..." : "Kirim Laporan Patroli";
    ubah();
  }

  function reset() {
    cl.set(master.checklist.PATROLI);
    zona = "";
    zonaQR = "";
    if ($("zona-qr")) {
      $("zona-qr").hidden = false;
      $("zona-qr").style.border = "1px solid rgba(239, 68, 68, 0.4)";
      $("zona-qr").style.background = "rgba(239, 68, 68, 0.15)";
      $("zona-qr").style.color = "#fca5a5";
      $("zona-qr").innerHTML = "<span>⚠️</span> <span>Silakan pindai QR Code lokasi patroli untuk titik berikutnya.</span>";
    }
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
      return; 
    }
    var c = cl.nilai(), gps = PC.Lokasi.saatIni();
    var payload = {
      id: idLaporan, nama: cbNama.nilai(), zona: zona,
      checklist: c.daftar, tingkat: c.adaTemuan ? tingkat : "", catatan: $("catatan").value.trim(),
      lat: gps ? gps.lat : null, lng: gps ? gps.lng : null, akurasi: gps ? gps.akurasi : null,
      fotos: foto.daftar().map(function (f) { return { b64: f.b64, t: f.t, sumber: f.sumber }; }),
      jamPerangkat: !PC.Jam.terpercaya(), durasiDetik: cl.durasiDetik(), qr: true
    };
    var zonaTeks = payload.zona;
    setMengirim(true);
    PC.api("simpanPatroli", { payload: payload }).then(function (r) {
      if (r.status === "SUCCESS") {
        var hasil = $("hasil");
        hasil.textContent = "Laporan patroli berhasil tercatat" + (r.waktu ? " pukul " + r.waktu + " WIB" : "") + ". Lokasi: " + zonaTeks + ".";
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
        PC.toast("Tidak ada sinyal. Laporan disimpan di perangkat dan dikirim otomatis nanti.", "ok");
        $("hasil").hidden = true;
        reset();
        antrean.segarkan();
      }).catch(function () {
        PC.toast("Tidak ada sinyal dan penyimpanan lokal gagal. Coba kirim kembali.", "bad");
      });
    }).then(function () { setMengirim(false); });
  }

  muat();
})();
