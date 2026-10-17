/* index.js - form patroli petugas. Tanpa PIN: petugas memilih namanya dari daftar aktif. */
(function () {
  "use strict";
  var PC = window.PC, h = PC.h;
  var $ = function (id) { return document.getElementById(id); };
  var KUNCI_DRAFT = "dp_draft_patroli_v2", KUNCI_MASTER = "dp_master_v2", KUNCI_NAMA = "dp_nama";
  var master = null, idLaporan = PC.buatId(), tingkat = "", zona = "", mengirim = false, timerDraft = null;
  var cbNama, cl, foto;

  PC.pasangStempel($("stempel"));
  PC.Lokasi.mulai();
  var antrean = PC.pasangAntrean($("antrean-wadah"));
  PC.pasangPWA($("antrean-wadah"));
  setInterval(PC.sinkronJam, 300000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) PC.sinkronJam(); });
  $("ikon-foto").appendChild(PC.ikon("KAMERA"));

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
    ubah();
  }

  /* ------------------------------------------------ zona: tombol besar */
  function bangunZona() {
    var wadah = $("zona-grup");
    PC.kosongkan(wadah);
    if (!master.daftarZona.length) {
      wadah.appendChild(h("div", { class: "kosong-zona", text: "Belum ada zona. Minta admin menambahkannya di dashboard." }));
      return;
    }
    master.daftarZona.forEach(function (nama, i) {
      var id = "zona" + i;
      wadah.appendChild(h("div", null,
        h("input", { type: "radio", name: "zona", id: id, value: nama,
          onchange: function () { zona = nama; ubah(); } }),
        h("label", { class: "ubin-z", for: id, text: nama })));
    });
  }

  function pilihZona(nama) {
    var el = Array.prototype.filter.call(document.querySelectorAll('input[name="zona"]'), function (r) { return r.value === nama; })[0];
    if (el) { el.checked = true; zona = nama; }
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
    return k;
  }

  function ubah() {
    if (!cl) return;
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
    $("btn-kirim").disabled = mengirim || k.length > 0;
    $("b-nama").classList.toggle("selesai", !!cbNama.nilai());
    $("b-zona").classList.toggle("selesai", !!zona);
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
    Array.prototype.forEach.call(document.querySelectorAll('input[name="zona"]'), function (r) { r.checked = false; });
    zona = "";
    $("catatan").value = "";
    tingkat = "";
    foto.kosongkan();
    idLaporan = PC.buatId();
    try { localStorage.removeItem(KUNCI_DRAFT); } catch (e) { /* abaikan */ }
    window.scrollTo({ top: 0, behavior: "smooth" });
    ubah();
  }

  function kirim() {
    var k = kekurangan();
    if (mengirim || k.length) { if (k.length) PC.toast("Lengkapi: " + k.join(", "), "bad"); return; }
    var c = cl.nilai(), gps = PC.Lokasi.saatIni();
    var payload = {
      id: idLaporan, nama: cbNama.nilai(), zona: zona,
      checklist: c.daftar, tingkat: c.adaTemuan ? tingkat : "", catatan: $("catatan").value.trim(),
      lat: gps ? gps.lat : null, lng: gps ? gps.lng : null, akurasi: gps ? gps.akurasi : null,
      fotos: foto.daftar().map(function (f) { return { b64: f.b64, t: f.t, sumber: f.sumber }; }),
      jamPerangkat: !PC.Jam.terpercaya(), durasiDetik: cl.durasiDetik()
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
