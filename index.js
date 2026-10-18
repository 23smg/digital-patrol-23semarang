/* index.js - form patroli petugas. Tanpa PIN: petugas memilih namanya dari daftar aktif.
   Diperbarui dengan:
   1. Auto-select dan penguncian zona via QR Code (?zona=NamaZona)
   2. Hard Geofencing (Pencegahan submit & blokir tombol jika di luar area mall)
*/
(function () {
  "use strict";
  var PC = window.PC, h = PC.h;
  var $ = function (id) { return document.getElementById(id); };
  var KUNCI_DRAFT = "dp_draft_patroli_v2", KUNCI_MASTER = "dp_master_v2", KUNCI_NAMA = "dp_nama";
  var master = null, idLaporan = PC.buatId(), tingkat = "", zona = "", mengirim = false, timerDraft = null;
  var cbNama, cl, foto, zonaQR = "";
  var diluarArea = false; // Status Geofence

  PC.pasangLogo(document.querySelector(".merek-grup"));
  PC.pasangTema(document.querySelector(".kepala-isi"));
  PC.pasangStempel($("stempel"));
  PC.Lokasi.mulai();
  var antrean = PC.pasangAntrean($("antrean-wadah"));
  PC.pasangPWA($("antrean-wadah"));
  setInterval(PC.sinkronJam, 300000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) PC.sinkronJam(); });
  if ($("ikon-foto")) $("ikon-foto").appendChild(PC.ikon("KAMERA"));

  /* ------------------------------------------------ Utilitas Geofence (Haversine) */
  function hitungJarakM(lat1, lng1, lat2, lng2) {
    var R = 6371000; // Radius bumi dalam meter
    var rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad;
    var dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function periksaGeofence() {
    var gps = PC.Lokasi.saatIni();
    var geo = master && master.geo ? master.geo : null;
    var pesanEl = $("pesan-geofence");

    // Jika batas area dikonfigurasi di server
    if (geo && geo.lat && geo.lng && geo.radius) {
      var latMall = parseFloat(geo.lat);
      var lngMall = parseFloat(geo.lng);
      var radiusMaks = parseFloat(geo.radius);

      if (!gps || gps.lat === null || gps.lng === null) {
        diluarArea = true;
        if (pesanEl) {
          pesanEl.textContent = "Mencari lokasi GPS... Pastikan izin GPS aktif.";
          pesanEl.hidden = false;
        }
        return;
      }

      var jarak = hitungJarakM(gps.lat, gps.lng, latMall, lngMall);

      if (jarak > radiusMaks) {
        diluarArea = true;
        if (pesanEl) {
          pesanEl.textContent = "Anda terdeteksi di luar area mall (Jarak: " + Math.round(jarak) + "m, Maks: " + radiusMaks + "m). Laporan tidak dapat dikirim.";
          pesanEl.hidden = false;
        }
        return;
      }
    }

    diluarArea = false;
    if (pesanEl) pesanEl.hidden = true;
  }

  /* ------------------------------------------------ memuat master */
  function muat() {
    var muatEl = $("muat");
    muatEl.hidden = false;
    PC.kosongkan(muatEl);
    muatEl.textContent = "Memuat daftar petugas dan zona...";
    var t0 = Date.now();
    PC.api("ambilDropdown", {}, 25000).then(function (r) {
      if (r.status !== "SUCCESS") throw new Error(r.message);
      PC.Jam.sinkron(r.waktuServer + (Date.now() - t0) / 2);
      master = r;
      try { localStorage.setItem(KUNCI_MASTER, JSON.stringify(r)); } catch (e) { /* abaikan */ }
    }).catch(function () {
      try {
        var c = JSON.parse(localStorage.getItem(KUNCI_MASTER));
        if (c && c.checklist) { master = c; PC.toast("Tanpa sinyal. Memakai daftar yang tersimpan.", "bad"); }
      } catch (e) { /* abaikan */ }
    }).then(function () {
      if (master) { mulai(); return; }
      PC.kosongkan(muatEl);
      muatEl.appendChild(h("p", { text: "Daftar belum bisa dimuat. Periksa sinyal, lalu coba lagi." }));
      muatEl.appendChild(h("button", { type: "button", class: "btn btn-utama", text: "Coba lagi", onclick: muat }));
    });
  }

  function mulai() {
    $("muat").hidden = true;
    $("form").hidden = false;
    $("bar-kirim").hidden = false;

    cbNama = PC.Combobox({ input: $("nama"), list: $("daftar-nama"), kosong: "Nama tidak terdaftar. Hubungi admin.",
      items: function () { return master.daftarNama; },
      onPick: function (v) {
        if (v) { try { localStorage.setItem(KUNCI_NAMA, v); } catch (e) { /* abaikan */ } }
        $("g-nama").hidden = true; $("nama").classList.remove("invalid");
        ubah();
      } });
    foto = PC.FotoGrid($("foto-grid"), { maks: 3, onUbah: ubah });
    cl = PC.Checklist($("checklist"), { onUbah: ubah });
    bangunZona();
    $("zona-cari").addEventListener("input", cariZona);

    var draft = bacaDraft();
    cl.set(master.checklist.PATROLI, draft && draft.cl);
    if (draft) {
      if (draft.zona) pilihZona(draft.zona);
      $("catatan").value = draft.catatan || "";
      if (draft.tingkat) {
        tingkat = draft.tingkat;
        var r = document.querySelector('input[name="tingkat"][value="' + draft.tingkat + '"]');
        if (r) r.checked = true;
      }
    }

    // Tautan dari QR di lokasi: ?zona=Nama.
    try {
      var zq = new URLSearchParams(location.search).get("zona");
      if (zq && master.daftarZona.indexOf(zq) >= 0) {
        pilihZona(zq); zonaQR = zq;
        if ($("zona-qr")) {
          $("zona-qr").hidden = false;
          $("zona-qr").textContent = "Zona terpilih dari QR di lokasi: " + zq + ". Ketuk zona lain bila salah.";
        }
        
        // Kunci bidang pilihan zona agar tidak bisa diedit manual bila diakses via QR
        Array.prototype.forEach.call(document.querySelectorAll('input[name="zona"]'), function (radio) {
          if (radio.value !== zq) {
            radio.disabled = true;
          }
        });
      }
    } catch (e) { /* abaikan */ }

    var tersimpan = null;
    try { tersimpan = localStorage.getItem(KUNCI_NAMA); } catch (e) { /* abaikan */ }
    if (tersimpan && master.daftarNama.indexOf(tersimpan) >= 0) $("nama").value = tersimpan;

    Array.prototype.forEach.call(document.querySelectorAll('input[name="tingkat"]'), function (r) {
      r.addEventListener("change", function () { tingkat = r.value; ubah(); });
    });
    $("catatan").addEventListener("input", ubah);
    $("btn-semua").addEventListener("click", function () {
      var n = cl.isiSemuaSesuai();
      PC.toast(n ? n + " item ditandai Sesuai. Ubah yang bermasalah." : "Semua item sudah dijawab.", n ? "ok" : "");
    });
    $("btn-foto").addEventListener("click", ambilFoto);
    $("btn-kirim").addEventListener("click", kirim);

    // Jalankan pemeriksaan posisi/geofence berkala
    setInterval(function () {
      periksaGeofence();
      ubah();
    }, 3000);

    ubah();
  }

  /* ------------------------------------------------ zona: pilih lantai dulu, lalu titiknya */
  var grupZona = [], grupAktif = "";
  function pecahZona(n) {
    var m = /^(.+?)\s+[-\u2013]\s+(.+)$/.exec(n);
    return m ? { g: m[1].trim(), s: m[2].trim() } : { g: "Lainnya", s: n };
  }

  function bangunZona() {
    var wadah = $("zona-grup");
    PC.kosongkan(wadah);
    grupZona = []; grupAktif = "";
    if (!master.daftarZona.length) {
      wadah.appendChild(h("div", { class: "kosong-zona", text: "Belum ada zona. Minta admin menambahkannya di dashboard." }));
      return;
    }
    var peta = {};
    master.daftarZona.forEach(function (nama) {
      var p = pecahZona(nama);
      if (!peta[p.g]) { peta[p.g] = { nama: p.g, jml: 0 }; grupZona.push(peta[p.g]); }
      peta[p.g].jml++;
    });
    grupZona.sort(function (a, b) { return (a.nama === "Lainnya") - (b.nama === "Lainnya"); });
    var bertingkat = grupZona.length > 1 && master.daftarZona.length > 8;
    master.daftarZona.forEach(function (nama, i) {
      var id = "zona" + i, p = pecahZona(nama);
      var pecah = bertingkat && p.g !== "Lainnya";
      wadah.appendChild(h("div", { "data-grup": p.g, "data-kunci": kunciCari(nama) },
        h("input", { type: "radio", name: "zona", id: id, value: nama, onchange: function () {
          zona = nama; 
          if (zonaQR && nama !== zonaQR) { 
            zonaQR = ""; 
            if ($("zona-qr")) $("zona-qr").hidden = true; 
          } 
          if ($("zona-cari").value) { 
            $("zona-cari").value = ""; 
            cariZona(); 
            if (pecah) tampilGrup(p.g); 
          } 
          ubah(); 
        } }),
        pecah ? h("label", { class: "ubin-z", for: id }, h("span", null, h("span", { class: "pfx", text: p.g + " - " }), h("span", { class: "sfx", text: p.s })))
              : h("label", { class: "ubin-z", for: id, text: nama })));
    });
    var lantai = $("zona-lantai");
    PC.kosongkan(lantai);
    wadah.classList.toggle("rapat", bertingkat);
    lantai.hidden = !bertingkat;
    $("zona-petunjuk").hidden = !bertingkat;
    $("zona-cari-wadah").hidden = !(bertingkat || master.daftarZona.length > 8);
    $("zona-cari").value = ""; $("zona-kosong").hidden = true;
    if (bertingkat) {
      grupZona.forEach(function (g) {
        lantai.appendChild(h("button", { type: "button", class: "lantai-btn", "data-grup": g.nama, "aria-pressed": "false",
          onclick: function () { tampilGrup(g.nama); } },
          h("b", { text: g.nama }), h("small", { text: g.jml + " titik" })));
      });
      tampilGrup("");
    }
  }

  function kunciCari(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, ""); }

  function cariZona() {
    var q = kunciCari($("zona-cari").value), bertingkat = !$("zona-lantai").hidden, wadah = $("zona-grup"), ada = 0;
    wadah.classList.toggle("cari", !!q);
    if (!q) { $("zona-kosong").hidden = true; if (bertingkat) tampilGrup(grupAktif); else Array.prototype.forEach.call(wadah.children, function (d) { d.hidden = false; }); return; }
    Array.prototype.forEach.call(wadah.children, function (d) {
      var cocok = (d.getAttribute("data-kunci") || "").indexOf(q) >= 0;
      d.hidden = !cocok; if (cocok) ada++;
    });
    Array.prototype.forEach.call($("zona-lantai").children, function (b) { b.setAttribute("aria-pressed", "false"); });
    $("zona-petunjuk").hidden = true;
    $("zona-kosong").hidden = ada > 0;
  }

  function tampilGrup(nama) {
    grupAktif = nama;
    Array.prototype.forEach.call($("zona-lantai").children, function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-grup") === nama ? "true" : "false");
    });
    Array.prototype.forEach.call($("zona-grup").children, function (d) {
      var tampil = !$("zona-lantai").hidden ? d.getAttribute("data-grup") === nama : true;
      d.hidden = !tampil;
    });
    $("zona-petunjuk").hidden = $("zona-lantai").hidden || !!nama;
  }

  function pilihZona(nama) {
    var el = Array.prototype.filter.call(document.querySelectorAll('input[name="zona"]'), function (r) { return r.value === nama; })[0];
    if (!el) return;
    el.checked = true; zona = nama;
    if (!$("zona-lantai").hidden) tampilGrup(pecahZona(nama).g);
  }

  /* ------------------------------------------------ draft lokal */
  function bacaDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(KUNCI_DRAFT));
      if (d && Date.now() - d.t < 12 * 3600 * 1000) return d;
    } catch (e) { /* abaikan */ }
    return null;
  }
  function simpanDraft() {
    try {
      localStorage.setItem(KUNCI_DRAFT, JSON.stringify({
        t: Date.now(), zona: zona, cl: cl.ekspor(), tingkat: tingkat, catatan: $("catatan").value
      }));
    } catch (e) { /* abaikan */ }
  }

  /* ------------------------------------------------ status form */
  function kekurangan() {
    var k = [], c = cl.nilai();
    if (!cbNama.nilai()) k.push("nama petugas");
    if (!zona) k.push("zona");
    if (!c.lengkap) k.push("checklist (" + c.terisi + "/" + c.total + ")");
    if (c.adaTemuan) {
      if (c.catatanKurang) k.push("penjelasan temuan");
      if (!tingkat) k.push("tingkat temuan");
    }
    if (!foto.daftar().length) k.push("foto");
    if (diluarArea) k.push("posisi berada di luar area mall (tombol dikunci)");
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
    $("btn-foto-teks").textContent = foto.penuh() ? "Foto sudah 3 (maksimal)" : (foto.daftar().length ? "Tambah foto" : "Ambil foto");
    $("hint-foto").textContent = siapFoto ? "" : "Pilih nama petugas dan zona dulu. Keduanya dicetak pada foto.";
    $("kurang").textContent = k.length ? "Lengkapi: " + k.join(", ") : "Semua isian lengkap. Siap dikirim.";
    $("kurang").className = "kurang" + (k.length ? "" : " siap");
    
    // Kunci tombol kirim jika sedang mengirim, ada isian kurang, ATAU lokasi di luar area
    $("btn-kirim").disabled = mengirim || k.length > 0 || diluarArea;

    $("b-nama").classList.toggle("selesai", !!cbNama.nilai());
    $("b-zona").classList.toggle("selesai", !!zona);
    if ($("zona-plakat")) $("zona-plakat").hidden = !zona || $("zona-lantai").hidden;
    if ($("zona-plakat-nama")) $("zona-plakat-nama").textContent = zona;
    $("b-cl").classList.toggle("selesai", c.lengkap && (!c.adaTemuan || (!c.catatanKurang && !!tingkat)));
    $("b-foto").classList.toggle("selesai", foto.daftar().length > 0);
    clearTimeout(timerDraft);
    timerDraft = setTimeout(simpanDraft, 500);
  }

  /* ------------------------------------------------ foto */
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

  /* ------------------------------------------------ kirim */
  function setMengirim(v) {
    mengirim = v;
    $("btn-kirim").textContent = v ? "Mengirim..." : "Kirim laporan patroli";
    ubah();
  }

  function reset() {
    cl.set(master.checklist.PATROLI);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="zona"]'), function (r) { 
      r.checked = false; 
      r.disabled = false; // Buka kembali kunci zona setelah reset
    });
    zona = "";
    zonaQR = "";
    if ($("zona-qr")) $("zona-qr").hidden = true;
    if (!$("zona-lantai").hidden) tampilGrup("");
    $("catatan").value = "";
    tingkat = "";
    foto.kosongkan();
    idLaporan = PC.buatId();
    try { localStorage.removeItem(KUNCI_DRAFT); } catch (e) { /* abaikan */ }
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
      jamPerangkat: !PC.Jam.terpercaya(), durasiDetik: cl.durasiDetik(), qr: !!zonaQR && zonaQR === zona
    };
    var zonaTeks = payload.zona;
    setMengirim(true);
    PC.api("simpanPatroli", { payload: payload }).then(function (r) {
      if (r.status === "SUCCESS") {
        var hasil = $("hasil");
        hasil.textContent = "Laporan patroli tercatat" + (r.waktu ? " pukul " + r.waktu + " WIB" : "") + ". Zona: " + zonaTeks + ".";
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
        PC.toast("Tidak ada sinyal dan penyimpanan perangkat gagal. Isian tetap di layar, coba kirim lagi.", "bad");
      });
    }).then(function () { setMengirim(false); });
  }

  muat();
})();
