/* tenant.js - checklist buka / tutup tenant. Tanpa PIN: petugas memilih namanya dari daftar aktif. */
(function () {
  "use strict";
  var PC = window.PC, h = PC.h;
  var $ = function (id) { return document.getElementById(id); };
  var KUNCI_DRAFT = "dp_draft_tenant_v2", KUNCI_MASTER = "dp_master_v2", KUNCI_NAMA = "dp_nama";
  var PETUNJUK_FOTO = {
    BUKA: "Foto bagian depan tenant yang sudah siap beroperasi (pintu terbuka, etalase terlihat).",
    TUTUP: "Foto pintu atau rolling door yang sudah terkunci, dan area depan tenant."
  };
  var master = null, petaTenant = {}, kategori = "", lantai = "", idLaporan = PC.buatId(), tingkat = "",
    mengirim = false, timerDraft = null;
  var cbTenant, cbNama, cl, foto;
  var KUNCI_PETUGAS = "dp_kunci_petugas_v1";   // dipakai bersama form Patroli
  var kunci = null, shiftDipilih = "", mengunciProses = false;

  PC.pasangLogo(document.querySelector(".merek-grup"));
  PC.pasangTema(document.querySelector(".kepala-isi"));
  PC.pasangStempel($("stempel"));
  PC.Lokasi.mulai();
  var antrean = PC.pasangAntrean($("antrean-wadah"));
  PC.pasangPWA($("antrean-wadah"));
  setInterval(PC.sinkronJam, 300000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) PC.sinkronJam(); });
  $("ik-buka").appendChild(PC.ikon("BUKA"));
  $("ik-tutup").appendChild(PC.ikon("TUTUP"));
  $("ikon-foto").appendChild(PC.ikon("KAMERA"));

  /* ------------------------------------------------ lantai dan tenant */
  function peringkatLantai(f) {
    if (f === "LG") return 0;
    var m = /^L(\d+)$/.exec(f);
    return m ? 1 + Number(m[1]) : 100;
  }
  function daftarLantai() {
    var hitung = {};
    master.daftarTenant.forEach(function (t) { if (t.f) hitung[t.f] = (hitung[t.f] || 0) + 1; });
    return Object.keys(hitung).sort(function (a, b) { return peringkatLantai(a) - peringkatLantai(b) || a.localeCompare(b); })
      .map(function (f) { return { f: f, n: hitung[f] }; });
  }
  function namaTenant() {
    return master.daftarTenant.filter(function (t) { return !lantai || t.f === lantai; })
      .map(function (t) { return t.n; });
  }
  function unitTenant(nama) { var t = petaTenant[nama]; return t ? t.l : ""; }

  function bangunLantai() {
    var wadah = $("lantai-grup");
    PC.kosongkan(wadah);
    var daftar = daftarLantai();
    wadah.parentNode.hidden = !daftar.length;
    $("lbl-lantai").textContent = "Lantai";
    daftar.forEach(function (x) {
      wadah.appendChild(h("button", { type: "button", class: "lantai-btn", "data-lantai": x.f,
        "aria-pressed": lantai === x.f ? "true" : "false",
        onclick: function () { pilihLantai(lantai === x.f ? "" : x.f); } },
        x.f));
    });
  }

  function pilihLantai(f) {
    lantai = f;
    Array.prototype.forEach.call($("lantai-grup").children, function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-lantai") === f ? "true" : "false");
    });
    if ($("tenant").value && !cbTenant.nilai()) { $("tenant").value = ""; tampilPlakat(""); }
    ubah();
    cobaKunci();
    // Setelah lantai diketuk, daftar tenant langsung terbuka (bisa di-scroll atau dicari dengan mengetik).
    if (cbTenant) cbTenant.buka();
  }

  function tampilPlakat(nama) {
    var t = nama && petaTenant[nama];
    $("plakat").hidden = !t;
    if (t) {
      $("plakat-unit").textContent = t.l || t.f || "-";
      $("plakat-nama").textContent = nama;
    }
  }

  /* ------------------------------------------------ shift dan kunci petugas (dibagi dengan form Patroli) */
  function sekarangMs() { return PC.Jam.kini().getTime(); }
  function jamTeks(j) { return String(j || "").replace(":", "."); }
  function perluShift() { return !!(master && master.shift && master.shift.length); }
  function bacaKunci() { try { return JSON.parse(localStorage.getItem(KUNCI_PETUGAS)); } catch (e) { return null; } }
  function simpanKunci() { try { localStorage.setItem(KUNCI_PETUGAS, JSON.stringify(kunci)); } catch (e) {} }

  function gambarShift() {
    var wadah = $("shift-grup");
    PC.kosongkan(wadah);
    $("shift-wadah").hidden = !perluShift();
    (master.shift || []).forEach(function (x) {
      wadah.appendChild(h("button", { type: "button", class: "lantai-btn", "aria-pressed": shiftDipilih === x.nama ? "true" : "false",
        disabled: !!kunci, onclick: function () { if (kunci) return; shiftDipilih = x.nama; gambarShift(); cobaKunci(); ubah(); } },
        x.nama, h("small", { class: "shift-jam", text: jamTeks(x.mulai) + "-" + jamTeks(x.selesai) })));
    });
  }

  function tampilKunci() {
    $("nama").disabled = !!kunci;
    $("b-nama").classList.toggle("terkunci", !!kunci);
    gambarShift(); bangunLantai();
  }

  function bukaKunci(diam) {
    kunci = null; shiftDipilih = ""; lantai = "";
    try { localStorage.removeItem(KUNCI_PETUGAS); } catch (e) {}
    $("nama").value = "";
    tampilKunci(); ubah();
    if ($("tenant").value && cbTenant && !cbTenant.nilai()) $("tenant").value = "";
    if (cbTenant) cbTenant.tutup();
    if (!diam) PC.toast("Pilih shift dan nama lagi.", "ok");
  }

  function cobaKunci() {
    var nama = cbNama && cbNama.nilai();
    if (kunci || mengunciProses || !perluShift() || !nama || !shiftDipilih) return;
    mengunciProses = true;
    PC.api("statusRonde", { nama: nama, shift: shiftDipilih, lantai: "", simpan: true }, 20000).then(function (r) {
      if (r.status !== "SUCCESS") { PC.toast(r.message || "Gagal memeriksa shift.", "bad"); return; }
      if (!r.shiftAktif) {
        PC.toast("Shift " + shiftDipilih + (r.mulai ? " (" + jamTeks(r.mulai) + "-" + jamTeks(r.selesai) + ")" : "") + " sedang tidak berjalan.", "bad");
        shiftDipilih = ""; gambarShift(); ubah(); return;
      }
      kunci = { nama: nama, shift: shiftDipilih, lantai: "", sampai: r.akhirMs, t: r.waktuServer || sekarangMs(), v: String(master.kunciVersi || "0") };
      simpanKunci(); tampilKunci(); ubah();
    }).catch(function () {
      kunci = { nama: nama, shift: shiftDipilih, lantai: "", sampai: sekarangMs() + 12 * 3600000, t: sekarangMs(), v: String(master.kunciVersi || "0") };
      simpanKunci(); tampilKunci(); ubah();
    }).then(function () { mengunciProses = false; });
  }

  function pulihKunci() {
    var k = bacaKunci();
    if (!k || !k.nama || !k.shift) return;
    var valid = k.sampai > sekarangMs() && String(k.v || "0") === String(master.kunciVersi || "0") && master.daftarNama.indexOf(k.nama) >= 0;
    if (!valid) { try { localStorage.removeItem(KUNCI_PETUGAS); } catch (e) {} return; }
    kunci = k; shiftDipilih = k.shift;
    $("nama").value = k.nama;
    tampilKunci();
  }

  function periksaKunci() {
    if (!kunci) return;
    if (kunci.sampai <= sekarangMs()) { bukaKunci(true); PC.toast("Shift selesai. Pilih shift dan nama lagi.", ""); return; }
    if (master && String(kunci.v || "0") !== String(master.kunciVersi || "0")) { bukaKunci(true); PC.toast("Kunci dibuka admin. Pilih lagi.", ""); return; }
    PC.api("statusRonde", { nama: kunci.nama, shift: kunci.shift, lantai: kunci.lantai }, 20000).then(function (r) {
      if (r.status === "SUCCESS" && kunci && r.bukaKunci && r.bukaKunci > (kunci.t || 0)) { bukaKunci(true); PC.toast("Kunci dibuka admin. Pilih lagi.", ""); }
    }).catch(function () {});
  }

  function segarkan() {
    var b = $("btn-segar"); b.disabled = true; b.classList.add("memuat");
    var t0 = Date.now();
    PC.api("ambilDropdown", {}, 25000).then(function (r) {
      if (r.status !== "SUCCESS") throw new Error(r.message);
      PC.Jam.sinkron(r.waktuServer + (Date.now() - t0) / 2);
      master = r;
      try { localStorage.setItem(KUNCI_MASTER, JSON.stringify(r)); } catch (e) {}
      if (statusFormBerubah(r)) return;
      petaTenant = {};
      master.daftarTenant.forEach(function (t) { petaTenant[t.n] = t; });
      bangunLantai(); gambarShift(); periksaKunci();
      if (antrean && antrean.segarkan) antrean.segarkan();
      PC.toast("Data diperbarui.", "ok");
    }).catch(function () { PC.toast("Gagal memuat. Periksa sinyal.", "bad"); })
      .then(function () { b.disabled = false; b.classList.remove("memuat"); });
  }

  /* ------------------------------------------------ memuat master */
  /* Data dari cache dipakai langsung (halaman terbuka tanpa menunggu), lalu disegarkan di latar belakang. */
  function muat() {
    var muatEl = $("muat"), sudahMulai = false, cache = null;
    try { cache = JSON.parse(localStorage.getItem(KUNCI_MASTER)); } catch (e) {}
    if (cache && cache.daftarTenant && cache.daftarNama && cache.checklist) { master = cache; sudahMulai = true; mulai(); }
    else { muatEl.hidden = false; PC.kosongkan(muatEl); muatEl.textContent = "Memuat daftar tenant..."; }
    var t0 = Date.now();
    PC.api("ambilDropdown", {}, 25000).then(function (r) {
      if (r.status !== "SUCCESS") throw new Error(r.message);
      PC.Jam.sinkron(r.waktuServer + (Date.now() - t0) / 2);
      master = r;
      try { localStorage.setItem(KUNCI_MASTER, JSON.stringify(r)); } catch (e) { /* abaikan */ }
      if (statusFormBerubah(r)) { sudahMulai = true; return; }
      if (!sudahMulai) { sudahMulai = true; mulai(); return; }
      // Daftar sudah tampil dari cache: perbarui peta tenant dan tombol lantai tanpa mengganggu isian.
      petaTenant = {};
      master.daftarTenant.forEach(function (t) { petaTenant[t.n] = t; });
      bangunLantai(); gambarShift(); periksaKunci();
    }).catch(function () {
      if (sudahMulai) { if (!PC.Jam.terpercaya()) PC.sinkronJam(); return; }
      PC.kosongkan(muatEl);
      muatEl.hidden = false;
      muatEl.appendChild(h("p", { text: "Daftar belum bisa dimuat. Periksa sinyal, lalu coba lagi." }));
      muatEl.appendChild(h("button", { type: "button", class: "btn btn-utama", text: "Coba lagi", onclick: muat }));
    });
  }

  // Admin bisa menonaktifkan form dari dashboard. true = halaman sudah ditangani (ditutup / dimuat ulang).
  function statusFormBerubah(r) {
    if (r && r.form && r.form["tenant"] === false) { PC.formTutup("checklist tenant", r.form.pesan); return true; }
    if (PC.formOffAktif) { location.reload(); return true; }
    return false;
  }

  function mulai() {
    if (statusFormBerubah(master)) return;
    $("muat").hidden = true;
    $("form").hidden = false;
    $("bar-kirim").hidden = false;
    petaTenant = {};
    master.daftarTenant.forEach(function (t) { petaTenant[t.n] = t; });
    if (!master.daftarTenant.length) {
      $("hasil").textContent = "Daftar tenant masih kosong. Minta admin mengisinya di dashboard.";
      $("hasil").hidden = false;
    }

    cbTenant = PC.Combobox({ input: $("tenant"), list: $("daftar-tenant"), kosong: "Tenant tidak ditemukan",
      items: namaTenant, detail: unitTenant,
      onPick: function (v) { tampilPlakat(v); ubah(); } });
    cbNama = PC.Combobox({ input: $("nama"), list: $("daftar-nama"), kosong: "Nama tidak terdaftar. Hubungi admin.",
      items: function () { return master.daftarNama; },
      onPick: function (v) {
        if (v) { try { localStorage.setItem(KUNCI_NAMA, v); } catch (e) { /* abaikan */ } }
        $("g-nama").hidden = true; $("nama").classList.remove("invalid");
        if (v) cobaKunci();
        ubah();
      } });
    foto = PC.FotoGrid($("foto-grid"), { maks: 3, onUbah: ubah });
    try { localStorage.setItem("dp_cl_mode", "daftar"); } catch (e) { /* abaikan */ }   // tampilan daftar: semua item terlihat sekaligus
    cl = PC.Checklist($("checklist"), { onUbah: ubah });
    bangunLantai();

    var tersimpan = null;
    try { tersimpan = localStorage.getItem(KUNCI_NAMA); } catch (e) { /* abaikan */ }
    if (tersimpan && master.daftarNama.indexOf(tersimpan) >= 0) $("nama").value = tersimpan;
    gambarShift();
    pulihKunci();
    $("btn-segar").addEventListener("click", segarkan);
    setInterval(periksaKunci, 60000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) periksaKunci(); });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="kategori"]'), function (r) {
      r.addEventListener("change", function () { gantiKategori(r.value); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="tingkat"]'), function (r) {
      r.addEventListener("change", function () { tingkat = r.value; ubah(); });
    });
    $("catatan").addEventListener("input", function () {
      var t = $("catatan"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 96) + "px";
      ubah();
    });
    $("btn-semua").addEventListener("click", function () {
      var n = cl.isiSemuaSesuai();
      PC.toast(n ? n + " item ditandai Sesuai. Ubah yang bermasalah." : "Semua item sudah dijawab.", n ? "ok" : "");
    });
    $("btn-foto").addEventListener("click", ambilFoto);
    $("btn-kirim").addEventListener("click", kirim);

    var d = bacaDraft();
    if (d && d.kategori) {
      var r = document.querySelector('input[name="kategori"][value="' + d.kategori + '"]');
      if (r) {
        r.checked = true;
        tampilkanKategori(d.kategori, d.cl);
        if (d.lantai) { lantai = d.lantai; bangunLantai(); }
        if (d.tenant && petaTenant[d.tenant]) { $("tenant").value = d.tenant; tampilPlakat(d.tenant); }
        $("catatan").value = d.catatan || "";
        if (d.tingkat) {
          tingkat = d.tingkat;
          var rt = document.querySelector('input[name="tingkat"][value="' + d.tingkat + '"]');
          if (rt) rt.checked = true;
        }
      }
    }
    ubah();
  }

  /* ------------------------------------------------ kategori */
  function tampilkanKategori(k, awal) {
    kategori = k;
    $("bagian-cl").hidden = false;
    $("bagian-foto").hidden = false;
    $("judul-cl").textContent = "Checklist " + (k === "BUKA" ? "buka" : "tutup");
    $("petunjuk-foto").textContent = PETUNJUK_FOTO[k] + " Tanggal, jam, tenant, petugas, dan GPS tercetak otomatis.";
    cl.set(master.checklist[k], awal);
    // Semua item kategori ini dimatikan admin: bagian checklist hilang (catatan dan foto tetap ada).
    var adaItem = (master.checklist[k] || []).length > 0;
    Array.prototype.forEach.call(document.querySelectorAll("#bagian-cl > h2, #bagian-cl > .petunjuk, #btn-semua, #checklist"),
      function (el) { el.hidden = !adaItem; });
  }

  function gantiKategori(k) {
    var lama = kategori;
    if (lama && lama !== k && cl.nilai().terisi > 0) {
      PC.tanya("Ganti kategori?", "Jawaban checklist " + lama + " akan dihapus karena itemnya berbeda.", "Ganti", "Batal")
        .then(function (ya) {
          if (ya) { tampilkanKategori(k); ubah(); return; }
          var asal = document.querySelector('input[name="kategori"][value="' + lama + '"]');
          if (asal) asal.checked = true;
        });
      return;
    }
    tampilkanKategori(k);
    ubah();
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
    if (!kategori) return;
    try {
      localStorage.setItem(KUNCI_DRAFT, JSON.stringify({
        t: Date.now(), kategori: kategori, tenant: cbTenant.nilai(), lantai: lantai, cl: cl.ekspor(), tingkat: tingkat,
        catatan: $("catatan").value
      }));
    } catch (e) { /* abaikan */ }
  }

  /* ------------------------------------------------ status form */
  // Foto tenant: wajib bila ada temuan, atau bila admin memilih "selalu" di Pengaturan.
  function fotoWajib() {
    return !!(cl && cl.nilai().adaTemuan) || !!(master && master.fotoTenant === "selalu");
  }

  function kekurangan() {
    var k = [], c = cl.nilai();
    if (!kategori) { k.push("buka atau tutup"); return k; }
    if (!cbTenant.nilai()) k.push("tenant");
    if (perluShift()) {
      if (!shiftDipilih) k.push("shift");
    }
    if (!cbNama.nilai()) k.push("nama petugas");
    if (!c.lengkap) k.push("checklist (" + c.terisi + "/" + c.total + ")");
    if (c.adaTemuan) {
      if (!tingkat) k.push("tingkat temuan");
    }
    if (fotoWajib() && !foto.daftar().length) k.push("foto");
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
    $("jml-foto").textContent = foto.daftar().length + " dari 3" + (fotoWajib() ? "" : " (opsional)");
    if (kategori) $("petunjuk-foto").textContent = PETUNJUK_FOTO[kategori] + " Tanggal, jam, tenant, petugas, dan GPS tercetak otomatis." +
      (fotoWajib() ? "" : " Foto tidak wajib bila tidak ada temuan.");
    var siapFoto = !!kategori && !!cbTenant.nilai() && !!cbNama.nilai();
    $("btn-foto").disabled = !siapFoto || foto.penuh();
    $("btn-foto-teks").textContent = foto.penuh() ? "Foto sudah 3 (maksimal)" : (foto.daftar().length ? "Tambah foto" : "Ambil foto");
    $("hint-foto").textContent = siapFoto ? "" : "Pilih tenant dan nama petugas dulu. Keduanya dicetak pada foto.";
    $("kurang").textContent = k.length ? "Lengkapi: " + k.join(", ") : "Semua isian lengkap. Siap dikirim.";
    $("kurang").className = "kurang" + (k.length ? "" : " siap");
    $("btn-kirim").disabled = mengirim || k.length > 0;
    $("b-jenis").classList.toggle("selesai", !!kategori);
    $("b-tenant").classList.toggle("selesai", !!cbTenant.nilai());
    $("b-nama").classList.toggle("selesai", !!cbNama.nilai());
    $("bagian-cl").classList.toggle("selesai", c.lengkap && (!c.adaTemuan || (!c.catatanKurang && !!tingkat)));
    $("bagian-foto").classList.toggle("selesai", foto.daftar().length > 0);
    clearTimeout(timerDraft);
    timerDraft = setTimeout(simpanDraft, 500);
  }

  /* ------------------------------------------------ foto */
  function ambilFoto() {
    PC.Kamera.buka({
      baris: function (now) {
        var f = PC.fmtWIB(now), t = cbTenant.nilai(), u = unitTenant(t);
        return [f.tgl + "  " + f.jam + " WIB", kategori + ": " + (t || "-") + (u ? " (" + u + ")" : ""),
          "Petugas: " + (cbNama.nilai() || "-"), PC.teksGps()];
      },
      onFoto: function (f) { foto.tambah(f); }
    });
  }

  /* ------------------------------------------------ kirim */
  function setMengirim(v) {
    mengirim = v;
    $("btn-kirim").textContent = v ? "Mengirim..." : "Kirim checklist";
    ubah();
  }

  function reset() {
    $("tenant").value = ""; tampilPlakat(""); $("catatan").value = "";
    cl.set(master.checklist[kategori]);
    tingkat = "";
    foto.kosongkan();
    idLaporan = PC.buatId();
    try { localStorage.removeItem(KUNCI_DRAFT); } catch (e) { /* abaikan */ }
    window.scrollTo({ top: 0, behavior: "smooth" });
    ubah();
  }

  function susunPayload() {
    var c = cl.nilai(), gps = PC.Lokasi.saatIni();
    return {
      id: idLaporan, kategori: kategori, tenant: cbTenant.nilai(), nama: cbNama.nilai(),
      checklist: c.daftar, tingkat: c.adaTemuan ? tingkat : "", catatan: $("catatan").value.trim(),
      lat: gps ? gps.lat : null, lng: gps ? gps.lng : null, akurasi: gps ? gps.akurasi : null,
      fotos: foto.daftar().map(function (f) { return { b64: f.b64, t: f.t, sumber: f.sumber }; }),
      jamPerangkat: !PC.Jam.terpercaya(), durasiDetik: cl.durasiDetik()
    };
  }

  function kirim() {
    var k = kekurangan();
    if (mengirim || k.length) { if (k.length) PC.toast("Lengkapi: " + k.join(", "), "bad"); return; }
    kirimPayload(susunPayload());
  }

  function kirimPayload(payload) {
    var label = payload.kategori + " " + payload.tenant;
    var ulangi = false;
    setMengirim(true);
    PC.api("simpanTenant", { payload: payload }).then(function (r) {
      if (r.status === "SUCCESS") {
        var hasil = $("hasil");
        hasil.textContent = "Checklist " + payload.kategori + " tercatat" + (r.waktu ? " pukul " + r.waktu + " WIB" : "") +
          ". Tenant: " + payload.tenant + ".";
        hasil.hidden = false;
        PC.toast("Checklist tersimpan.", "ok");
        PC.Riwayat.catat({ id: payload.id, jenis: payload.kategori, judul: payload.tenant, temuan: !!(payload.tingkat), status: "terkirim" });
        reset();
        return;
      }
      if (r.status === "KONFIRMASI") {
        return PC.tanya("Laporan sudah ada", r.message, "Kirim lagi", "Batal").then(function (ya) { ulangi = !!ya; });
      }
      PC.toast(r.message || "Laporan ditolak.", "bad");
      if (r.kode === "FORM_OFF") PC.formTutup("checklist tenant", r.message);
      if (r.kode === "NAMA") {
        var g = $("g-nama");
        g.textContent = r.message; g.hidden = false;
        $("nama").classList.add("invalid"); $("nama").focus();
      }
    }).catch(function (e) {
      if (!e.jaringan) { PC.toast("Gagal mengirim. Coba lagi.", "bad"); return; }
      PC.Antrean.simpan({ id: payload.id, aksi: "simpanTenant", payload: payload, dibuat: Date.now(),
        status: "menunggu", label: label }).then(function () {
        PC.Riwayat.catat({ id: payload.id, jenis: payload.kategori, judul: payload.tenant, temuan: !!(payload.tingkat), status: "menunggu" });
        PC.toast("Tidak ada sinyal. Laporan disimpan di perangkat dan dikirim otomatis nanti.", "ok");
        $("hasil").hidden = true;
        reset();
        antrean.segarkan();
      }).catch(function () {
        PC.toast("Tidak ada sinyal dan penyimpanan perangkat gagal. Isian tetap di layar, coba kirim lagi.", "bad");
      });
    }).then(function () {
      setMengirim(false);
      if (ulangi) { payload.konfirmasiUlang = true; kirimPayload(payload); }
    });
  }

  muat();
})();
