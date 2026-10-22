/* kelola.js - menu Data master di dashboard: tenant, petugas, zona, item checklist, akun admin, area patroli, riwayat.
   Semua perubahan lewat API kelolaSimpan / akunSimpan / pengaturanSimpan, jadi tidak ada lagi input manual ke sheet.
   Izin dicek ulang di server; tombol yang tidak boleh dipakai hanya disembunyikan di sini. */
(function () {
  "use strict";
  var DB = window.DB, PC = window.PC, h = PC.h, $ = DB.$;
  var PER_HALAMAN = 50;
  var K = { data: null, waktu: 0, memuat: null };
  var KUNCI = { TENANT: "tenant", PETUGAS: "petugas", ZONA: "zona", ITEM: "item" };
  var NAMA_KATEGORI = { PATROLI: "Patroli", BUKA: "Buka toko", TUTUP: "Tutup toko" };
  var URUT_KATEGORI = ["PATROLI", "BUKA", "TUTUP"];

  /* ---------------------------------------------------------- data bersama */
  function muatKelola(paksa) {
    if (K.memuat) return K.memuat;
    if (K.data && !paksa && Date.now() - K.waktu < 60000) return Promise.resolve({ status: "SUCCESS" });
    K.memuat = DB.panggil("kelolaAmbil", {}, 60000).then(function (r) {
      if (r.status === "SUCCESS") { K.data = r; K.waktu = Date.now(); lencanaMenu(); }
      return r;
    }).then(function (r) { K.memuat = null; return r; });
    return K.memuat;
  }

  function aktifSaja(daftar) { return (daftar || []).filter(function (o) { return o.aktif; }); }
  function lencanaMenu() {
    if (!K.data) return;
    DB.badge("tenant", aktifSaja(K.data.tenant).length);
    DB.badge("petugas", aktifSaja(K.data.petugas).length);
    DB.badge("zona", aktifSaja(K.data.zona).length);
  }
  var sebelum = DB.setelahKeluar;
  DB.setelahKeluar = function () { if (sebelum) sebelum(); K.data = null; K.waktu = 0; };

  function lamaDari(jenis, o) { return jenis === "ITEM" ? { k: o.k, i: o.i } : { n: o.n }; }

  // Mengirim satu operasi ke kelolaSimpan lalu menyimpan daftar terbaru dari server.
  function kirimMaster(jenis, badan) {
    return DB.panggil("kelolaSimpan", Object.assign({ jenis: jenis }, badan), 60000).then(function (r) {
      if (r.status === "SUCCESS") {
        K.data[KUNCI[jenis]] = r.daftar;
        if (r.riwayat) K.data.riwayat = r.riwayat;
        lencanaMenu();
      }
      return r;
    });
  }

  function ringkasImpor(r) {
    var bagian = [];
    if (r.ditambah) bagian.push(r.ditambah + " baru");
    if (r.diperbarui) bagian.push(r.diperbarui + " diperbarui");
    if (r.sama) bagian.push(r.sama + " sudah ada");
    if (r.jumlahGalat) bagian.push(r.jumlahGalat + " ditolak");
    return bagian.length ? bagian.join(", ") : "tidak ada perubahan";
  }

  function tampilGalatImpor(galat, jumlah) {
    DB.form({
      judul: "Baris yang ditolak", tanpaSimpan: true,
      info: jumlah + " baris tidak bisa diimpor. Perbaiki lalu impor ulang, baris yang sudah masuk tidak akan dobel.",
      bidang: [{ kustom: h("ul", { class: "hasil-impor" }, galat.slice(0, 30).map(function (g) {
        return h("li", { text: "Baris " + g.baris + ": " + g.pesan });
      })) }]
    });
  }

  function kotakMuat(wadah, pesan) {
    PC.kosongkan(wadah);
    wadah.appendChild(h("div", { class: "panel" }, h("div", { class: "kosong-info", text: pesan || "Memuat data..." })));
  }
  function kotakGalat(wadah, r, ulang) {
    PC.kosongkan(wadah);
    wadah.appendChild(h("div", { class: "panel" }, h("div", { class: "kosong-info" },
      h("p", { text: r.message || "Gagal memuat data." }),
      r.kode === "SESI" ? null : h("button", { type: "button", class: "btn btn-utama", text: "Coba lagi", onclick: ulang }))));
  }

  // Membungkus halaman: tampilkan "memuat" bila belum ada data, lalu panggil render(wadah).
  /* Tombol aksi berbentuk ikon (hemat ruang). Teksnya ada di tooltip dan label aksesibilitas. */
  function btnIkon(nama, label, kls, fn) {
    return h("button", { type: "button", class: "btn-ikon " + (kls || ""), title: label, "aria-label": label, onclick: fn }, PC.ikon(nama));
  }

  function denganData(wadah, render) {
    if (K.data) { render(wadah); return; }
    kotakMuat(wadah);
    muatKelola(true).then(function (r) {
      if (r.status !== "SUCCESS") { kotakGalat(wadah, r, function () { denganData(wadah, render); }); return; }
      if (wadah.isConnected) render(wadah);
    });
  }

  function lencana(teks, kls) { return h("span", { class: "lencana " + kls, text: teks }); }
  function lencanaAktif(a) { return a ? lencana("Aktif", "l-ok") : lencana("Nonaktif", "l-nonaktif"); }

  /* ---------------------------------------------------------- penguraian tempelan Excel */
  function pisahBaris(teks) {
    return String(teks || "").split(/\r?\n/).map(function (l) { return l.replace(/ /g, " "); })
      .filter(function (l) { return l.trim(); });
  }
  function pemisah(baris) {
    var s = baris.join("\n");
    if (s.indexOf("\t") >= 0) return "\t";
    if (s.indexOf(";") >= 0) return ";";
    if (s.indexOf("|") >= 0) return "|";
    return null;
  }
  // Nama, Unit, Lantai. Baris judul (Nama Tenant / Unit / Lantai) dilewati otomatis.
  function uraiTenant(teks) {
    var baris = pisahBaris(teks), sep = pemisah(baris), hasil = [], abaikan = 0;
    baris.forEach(function (l, i) {
      var c = sep ? l.split(sep) : [l];
      c = c.map(function (x) { return x.replace(/\s+/g, " ").trim(); });
      if (i === 0 && /^(nama|tenant)/i.test(c[0]) && (c.length === 1 || /unit|lantai/i.test(c.slice(1).join(" ")))) { abaikan++; return; }
      if (!c[0]) { abaikan++; return; }
      hasil.push({ n: c[0], l: c[1] || "", f: (c[2] || "").toUpperCase() });
    });
    return { baris: hasil, abaikan: abaikan };
  }
  function uraiNama(teks) {
    var lihat = {}, hasil = [];
    pisahBaris(teks).forEach(function (l) {
      var n = l.replace(/\s+/g, " ").trim();
      if (n && !lihat[n.toLowerCase()]) { lihat[n.toLowerCase()] = 1; hasil.push(n); }
    });
    return hasil;
  }

  /* ---------------------------------------------------------- pembangun daftar (tenant, petugas, zona) */
  function bangunDaftar(cfg) {
    var st = { q: "", lantai: "", hanyaAktif: false, hal: 1 };

    return function tampil(wadah) {
      denganData(wadah, function () {
        PC.kosongkan(wadah);
        var chipWadah = h("div", { class: "chip-baris", hidden: !cfg.chip });
        var tabelWadah = h("div");
        var hitung = h("span");
        var cari = h("input", { type: "search", class: "input", placeholder: cfg.cariHint, "aria-label": "Cari" });
        cari.value = st.q;
        cari.addEventListener("input", function () { st.q = cari.value; st.hal = 1; isi(); });

        var btnAktif = h("button", { type: "button", class: "btn btn-pilih", text: "Hanya yang aktif", "aria-pressed": st.hanyaAktif ? "true" : "false",
          onclick: function () { st.hanyaAktif = !st.hanyaAktif; btnAktif.setAttribute("aria-pressed", st.hanyaAktif ? "true" : "false"); st.hal = 1; isi(); } });

        var rapat = h("div", { class: "rapat" }, btnAktif,
          h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Muat ulang", onclick: function () {
            muatKelola(true).then(function (r) { if (r.status === "SUCCESS") { isi(); PC.toast("Data dimuat ulang.", "ok"); } else PC.toast(r.message, "bad"); });
          } }));
        if (cfg.impor) rapat.appendChild(h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Impor dari Excel", onclick: cfg.impor }));
        rapat.appendChild(h("button", { type: "button", class: "btn btn-kecil btn-utama", text: cfg.tambahLabel, onclick: function () { cfg.formTambah(isi); } }));

        var panel = h("div", { class: "panel" },
          h("div", { class: "panel-kepala" }, h("h2", { text: cfg.judulPanel }), h("span", { class: "oleh" }, hitung)),
          h("div", { class: "tools" }, cari, rapat), chipWadah, tabelWadah);
        if (cfg.pengantar) wadah.appendChild(h("div", { class: "pengantar" }, cfg.pengantar));
        wadah.appendChild(panel);

        function semua() { return K.data[cfg.kunci] || []; }
        function terfilter() {
          var q = st.q.toLowerCase().trim();
          return semua().filter(function (o) {
            if (st.hanyaAktif && !o.aktif) return false;
            if (cfg.chip && st.lantai && o.f !== st.lantai) return false;
            return !q || cfg.teksCari(o).toLowerCase().indexOf(q) >= 0;
          });
        }

        function isiChip() {
          if (!cfg.chip) return;
          PC.kosongkan(chipWadah);
          var cnt = {}, urut = [];
          semua().forEach(function (o) { var f = o.f || "?"; if (!cnt[f]) { cnt[f] = 0; urut.push(f); } cnt[f]++; });
          function chip(nilai, label, n) {
            return h("button", { type: "button", class: "chip", "aria-pressed": st.lantai === nilai ? "true" : "false",
              onclick: function () { st.lantai = nilai; st.hal = 1; isi(); } }, label, h("small", { text: String(n) }));
          }
          chipWadah.appendChild(chip("", "Semua", semua().length));
          urut.forEach(function (f) { chipWadah.appendChild(chip(f === "?" ? "" : f, f === "?" ? "Tanpa lantai" : f, cnt[f])); });
          chipWadah.hidden = urut.length < 2;
        }

        function isi() {
          isiChip();
          PC.kosongkan(tabelWadah);
          var daftar = terfilter(), total = daftar.length, nAktif = aktifSaja(semua()).length;
          hitung.textContent = nAktif + " aktif dari " + semua().length + (total !== semua().length ? " · " + total + " cocok" : "");
          if (!semua().length) {
            tabelWadah.appendChild(h("div", { class: "kosong-tabel" },
              h("p", { text: cfg.kosong }),
              cfg.impor ? h("button", { type: "button", class: "btn btn-utama", text: "Impor dari Excel", onclick: cfg.impor }) : null));
            return;
          }
          if (!total) { tabelWadah.appendChild(h("div", { class: "kosong-tabel", text: "Tidak ada yang cocok dengan pencarian." })); return; }
          var halaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
          if (st.hal > halaman) st.hal = halaman;
          var mulai = (st.hal - 1) * PER_HALAMAN, potong = daftar.slice(mulai, mulai + PER_HALAMAN);
          var tbody = h("tbody");
          potong.forEach(function (o) {
            tbody.appendChild(h("tr", { class: o.aktif ? "" : "nonaktif" },
              cfg.sel(o).concat([
                h("td", null, lencanaAktif(o.aktif)),
                h("td", { class: "aksi" },
                  btnIkon("PENSIL", "Ubah", "", function () { cfg.formUbah(o, isi); }),
                  btnIkon("SAKLAR", o.aktif ? "Nonaktifkan" : "Aktifkan", o.aktif ? "aktif" : "mati", function () { alihAktif(cfg.jenis, o, isi); }),
                  btnIkon("SAMPAH", "Hapus", "bahaya", function () { hapus(cfg, o, isi); }))
              ])));
          });
          tabelWadah.appendChild(h("div", { class: "tabel-wrap penuh", style: { border: "0", borderRadius: "0", marginBottom: "0" } },
            h("table", null, h("thead", null, h("tr", null, cfg.kolom.concat(["Status", ""]).map(function (k) { return h("th", { text: k }); }))), tbody)));
          tabelWadah.appendChild(h("div", { class: "halaman" },
            h("span", { text: "Menampilkan " + (mulai + 1) + "-" + (mulai + potong.length) + " dari " + total }),
            h("div", { class: "grup", style: { alignItems: "center" } },
              h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Sebelumnya", disabled: st.hal <= 1, onclick: function () { st.hal--; isi(); } }),
              h("span", { text: st.hal + " / " + halaman }),
              h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Berikutnya", disabled: st.hal >= halaman, onclick: function () { st.hal++; isi(); } }))));
        }
        isi();
      });
    };
  }

  function alihAktif(jenis, o, segar) {
    kirimMaster(jenis, { op: "aktif", lama: lamaDari(jenis, o), aktif: !o.aktif }).then(function (r) {
      if (r.status === "SUCCESS") { PC.toast((o.aktif ? "Dinonaktifkan: " : "Diaktifkan: ") + (o.n || o.i), "ok"); segar(); }
      else if (r.kode !== "SESI") PC.toast(r.message, "bad");
    });
  }

  function hapus(cfg, o, segar) {
    var nama = o.n || o.i;
    PC.tanya("Hapus " + cfg.satu + "?", "\"" + nama + "\" dihapus permanen dari daftar. Laporan yang sudah masuk tidak berubah. " +
      "Kalau hanya tidak dipakai sementara, pilih Nonaktifkan.", "Hapus", "Batal").then(function (ya) {
      if (!ya) return;
      kirimMaster(cfg.jenis, { op: "hapus", lama: lamaDari(cfg.jenis, o) }).then(function (r) {
        if (r.status === "SUCCESS") { PC.toast("Dihapus: " + nama, "ok"); segar(); }
        else if (r.kode !== "SESI") PC.toast(r.message, "bad");
      });
    });
  }

  /* ---------------------------------------------------------- TENANT */
  function opsiLantai(saatIni) {
    var set = {}, urut = [];
    ["LG", "L1", "L2", "L3"].concat((K.data.tenant || []).map(function (o) { return o.f; })).concat([saatIni || ""]).forEach(function (f) {
      if (f && !set[f]) { set[f] = 1; urut.push(f); }
    });
    var pilihan = [["", "Otomatis dari nomor unit"]];
    urut.forEach(function (f) { pilihan.push([f, f]); });
    return pilihan;
  }

  function formTenant(o, segar) {
    var ubah = !!o;
    DB.form({
      judul: ubah ? "Ubah tenant" : "Tambah tenant",
      info: ubah ? "Mengubah nama tenant tidak mengubah laporan lama." : "Tenant baru langsung muncul di form petugas.",
      simpan: ubah ? "Simpan perubahan" : "Tambah tenant",
      bidang: [
        { id: "n", label: "Nama tenant", nilai: ubah ? o.n : "", maks: 80, placeholder: "Contoh: Kopi Kenangan" },
        { id: "l", label: "Nomor unit", nilai: ubah ? o.l : "", maks: 60, separuh: true, placeholder: "Contoh: L1 12-13", bantuan: "Boleh kosong." },
        { id: "f", label: "Lantai", tipe: "select", nilai: ubah ? o.f : "", pilihan: opsiLantai(ubah ? o.f : ""), separuh: true, bantuan: "Kode lantai dibaca dari nomor unit bila dikosongkan." }
      ],
      periksa: function (v) { return v.n.trim() ? "" : "Nama tenant wajib diisi."; },
      kirim: function (v) {
        return kirimMaster("TENANT", ubah
          ? { op: "ubah", lama: { n: o.n }, data: { n: v.n, l: v.l, f: v.f } }
          : { op: "tambah", data: { n: v.n, l: v.l, f: v.f } });
      },
      selesai: function () { PC.toast(ubah ? "Tenant diperbarui." : "Tenant ditambahkan.", "ok"); segar(); }
    });
  }

  function teksBawaan() {
    var baris = ["Nama Tenant\tUnit\tLantai"];
    (window.TENANT_AWAL || []).forEach(function (r) { baris.push(r.join("\t")); });
    return baris.join("\n");
  }

  function imporTenant(segar) {
    var area = h("textarea", { id: "fm-impor", class: "input mono", rows: 8, spellcheck: "false",
      placeholder: "Nama Tenant\tUnit\tLantai\nKopi Kenangan\tL1 12-13\tL1" });
    var pratinjau = h("div");
    var ada = !!(window.TENANT_AWAL && window.TENANT_AWAL.length);
    var jumlahSaatIni = (K.data.tenant || []).length;
    function perbarui() {
      PC.kosongkan(pratinjau);
      var u = uraiTenant(area.value);
      if (!u.baris.length) {
        pratinjau.appendChild(h("p", { class: "oleh", text: "Belum ada baris terbaca." }));
        return u;
      }
      var tbody = h("tbody", null, u.baris.slice(0, 6).map(function (r) {
        return h("tr", null, h("td", { text: r.n }), h("td", { text: r.l || "-" }), h("td", { text: r.f || "otomatis" }));
      }));
      pratinjau.appendChild(h("p", { class: "oleh", style: { margin: "0 0 6px" }, text: u.baris.length + " tenant terbaca" +
        (u.baris.length > 6 ? ", 6 pertama ditampilkan" : "") + ". Nama yang sudah ada tidak dobel; unit dan lantainya diperbarui." }));
      pratinjau.appendChild(h("div", { class: "pratinjau" }, h("table", null,
        h("thead", null, h("tr", null, ["Nama", "Unit", "Lantai"].map(function (k) { return h("th", { text: k }); }))), tbody)));
      return u;
    }
    area.addEventListener("input", perbarui);
    var kustom = h("div", { class: "medan" },
      h("label", { for: "fm-impor", text: "Tempel dari Excel" }),
      area,
      h("p", { class: "bantuan", text: "Blok kolom Nama, Unit, Lantai di Excel, salin, lalu tempel di sini. Lantai boleh kosong. Maksimal 600 baris sekali impor, lebih dari itu dikirim bertahap otomatis." }),
      ada ? h("div", { style: { margin: "10px 0" } }, h("button", { type: "button", class: "btn btn-kecil btn-kuning",
        text: "Isi dengan daftar tenant dari Excel 13 Okt 2026 (" + window.TENANT_AWAL.length + " tenant)",
        onclick: function () { area.value = teksBawaan(); perbarui(); } })) : null,
      pratinjau);
    DB.form({
      judul: "Impor tenant", simpan: "Impor", bidang: [{ kustom: kustom }],
      info: jumlahSaatIni ? "Sudah ada " + jumlahSaatIni + " tenant. Impor hanya menambah yang baru dan memperbarui unit/lantai." : "Daftar tenant masih kosong.",
      periksa: function () { return uraiTenant(area.value).baris.length ? "" : "Tidak ada baris yang bisa diimpor."; },
      kirim: function () {
        var baris = uraiTenant(area.value).baris, total = { ditambah: 0, diperbarui: 0, sama: 0, jumlahGalat: 0 }, galat = [], terkirim = 0;
        var potong = [];
        for (var i = 0; i < baris.length; i += 600) potong.push(baris.slice(i, i + 600));
        var p = Promise.resolve({ status: "SUCCESS" });
        potong.forEach(function (bagian, idx) {
          p = p.then(function (prev) {
            if (prev.status !== "SUCCESS") return prev;
            return kirimMaster("TENANT", { op: "impor", baris: bagian }).then(function (r) {
              if (r.status !== "SUCCESS") {
                if (terkirim) r.message = "Berhenti di tengah jalan. " + terkirim + " baris sudah tersimpan. " + r.message;
                return r;
              }
              terkirim += bagian.length;
              ["ditambah", "diperbarui", "sama", "jumlahGalat"].forEach(function (k) { total[k] += r[k] || 0; });
              (r.galat || []).forEach(function (g) { galat.push({ baris: g.baris + idx * 600, pesan: g.pesan }); });
              return r;
            });
          });
        });
        return p.then(function (r) { if (r.status === "SUCCESS") r.ringkas = total; r.galatAll = galat; return r; });
      },
      selesai: function (r) {
        PC.toast("Impor tenant selesai: " + ringkasImpor(r.ringkas), "ok");
        segar();
        if (r.galatAll && r.galatAll.length) tampilGalatImpor(r.galatAll, r.ringkas.jumlahGalat);
      }
    });
    perbarui();
  }

  var tampilTenant = bangunDaftar({
    jenis: "TENANT", kunci: "tenant", satu: "tenant", judulPanel: "Daftar tenant", cariHint: "Cari nama tenant atau unit",
    teksCari: function (o) { return o.n + " " + o.l + " " + o.f; },
    chip: true, tambahLabel: "Tambah tenant",
    kolom: ["Tenant", "Unit", "Lantai"],
    sel: function (o) { return [h("td", { class: "nama", text: o.n }), h("td", { class: "unit", text: o.l || "-" }), h("td", null, h("span", { class: "lencana l-abu", text: o.f || "-" }))]; },
    pengantar: [h("b", { text: "Daftar ini yang muncul di form petugas. " }), "Tenant yang dinonaktifkan tidak muncul di form, tetapi laporan lamanya tetap tersimpan. Perubahan berlaku di HP petugas begitu mereka membuka ulang form."],
    kosong: "Daftar tenant masih kosong. Impor dari Excel atau tambah satu per satu.",
    formTambah: function (segar) { formTenant(null, segar); },
    formUbah: function (o, segar) { formTenant(o, segar); },
    impor: function () { imporTenant(function () { DB.buka("tenant"); }); }
  });

  /* ---------------------------------------------------------- PETUGAS dan ZONA */
  function formNama(cfg, o, segar) {
    var ubah = !!o;
    DB.form({
      judul: ubah ? "Ubah " + cfg.satu : "Tambah " + cfg.satu,
      info: ubah ? cfg.infoUbah : cfg.infoTambah,
      simpan: ubah ? "Simpan perubahan" : "Tambah",
      bidang: [ubah
        ? { id: "n", label: cfg.labelNama, nilai: o.n, maks: 80 }
        : { id: "n", label: cfg.labelNama + " (satu per baris)", tipe: "textarea", rows: 5, nilai: "", placeholder: cfg.contoh, bantuan: "Boleh tempel banyak nama sekaligus." }],
      periksa: function (v) { return (ubah ? v.n.trim() : uraiNama(v.n).length) ? "" : "Isi " + cfg.labelNama.toLowerCase() + " dulu."; },
      kirim: function (v) {
        if (ubah) return kirimMaster(cfg.jenis, { op: "ubah", lama: { n: o.n }, data: { n: v.n } });
        var nama = uraiNama(v.n);
        if (nama.length === 1) return kirimMaster(cfg.jenis, { op: "tambah", data: { n: nama[0] } });
        return kirimMaster(cfg.jenis, { op: "impor", baris: nama.map(function (n) { return { n: n }; }) });
      },
      selesai: function (r) {
        if (r.op === "impor") {
          PC.toast(cfg.judulPanel + ": " + ringkasImpor(r), "ok");
          if (r.galat && r.galat.length) tampilGalatImpor(r.galat, r.jumlahGalat);
        } else PC.toast(ubah ? "Diperbarui." : "Ditambahkan.", "ok");
        segar();
      }
    });
  }

  var CFG_PETUGAS = {
    jenis: "PETUGAS", kunci: "petugas", satu: "petugas", judulPanel: "Daftar petugas", labelNama: "Nama petugas", cariHint: "Cari nama petugas",
    contoh: "Budi Santoso\nSiti Aminah", tambahLabel: "Tambah petugas",
    infoTambah: "Petugas memilih namanya dari daftar ini saat mengisi form. Tanpa PIN, jadi pastikan nama ditulis jelas dan tidak kembar.",
    infoUbah: "Nama di laporan lama tidak ikut berubah.",
    teksCari: function (o) { return o.n; }, kolom: ["Nama petugas"],
    sel: function (o) { return [h("td", { class: "nama", text: o.n })]; },
    pengantar: [h("b", { text: "Tanpa PIN. " }), "Petugas cukup memilih namanya dari daftar aktif. Saat ada petugas berhenti, nonaktifkan namanya agar tidak bisa dipakai lagi. Satu nama dibatasi jumlah laporan per jam sebagai pengaman."],
    kosong: "Belum ada petugas. Tambahkan nama-nama petugas, boleh banyak sekaligus."
  };
  CFG_PETUGAS.formTambah = function (segar) { formNama(CFG_PETUGAS, null, segar); };
  CFG_PETUGAS.formUbah = function (o, segar) { formNama(CFG_PETUGAS, o, segar); };
  var tampilPetugas = bangunDaftar(CFG_PETUGAS);

  var CFG_ZONA = {
    jenis: "ZONA", kunci: "zona", satu: "zona", judulPanel: "Daftar zona", labelNama: "Nama zona", cariHint: "Cari zona",
    contoh: "Basement LG\nLobby Utama", tambahLabel: "Tambah zona",
    infoTambah: "Zona tampil di form patroli. Beri nama berpola \"L4 - 1\" agar petugas bisa memilih per lantai, lalu titiknya.", infoUbah: "Nama zona di laporan lama tidak ikut berubah.",
    teksCari: function (o) { return o.n; }, kolom: ["Zona"],
    sel: function (o) { return [h("td", { class: "nama", text: o.n }) ]; },
    pengantar: [h("b", { text: "Zona = area yang dipatroli. " }), "Minimal satu zona harus tetap aktif. Beri nama yang singkat karena tampil sebagai tombol di HP petugas."],
    kosong: "Belum ada zona. Tambahkan minimal satu."
  };
  CFG_ZONA.formTambah = function (segar) { formNama(CFG_ZONA, null, segar); };
  CFG_ZONA.formUbah = function (o, segar) { formNama(CFG_ZONA, o, segar); };
  var tampilZona = bangunDaftar(CFG_ZONA);

  /* ---------------------------------------------------------- ITEM CHECKLIST */
  function formItem(o, kategori, segar) {
    var ubah = !!o;
    DB.form({
      judul: ubah ? "Ubah item checklist" : "Tambah item checklist",
      info: "Perubahan berlaku untuk laporan berikutnya. Laporan lama menyimpan teks item saat itu.",
      simpan: ubah ? "Simpan perubahan" : "Tambah item",
      bidang: [
        { id: "k", label: "Dipakai di", tipe: "select", nilai: ubah ? o.k : kategori,
          pilihan: URUT_KATEGORI.map(function (k) { return [k, NAMA_KATEGORI[k]]; }) },
        { id: "i", label: "Teks item", tipe: "textarea", rows: 2, nilai: ubah ? o.i : "", maks: 120, placeholder: "Contoh: Pintu darurat tidak terhalang" }
      ],
      periksa: function (v) { return v.i.trim() ? "" : "Teks item wajib diisi."; },
      kirim: function (v) {
        return kirimMaster("ITEM", ubah
          ? { op: "ubah", lama: lamaDari("ITEM", o), data: { k: v.k, i: v.i } }
          : { op: "tambah", data: { k: v.k, i: v.i } });
      },
      selesai: function () { PC.toast(ubah ? "Item diperbarui." : "Item ditambahkan.", "ok"); segar(); }
    });
  }

  function tampilItem(wadah) {
    denganData(wadah, function () {
      PC.kosongkan(wadah);
      wadah.appendChild(h("div", { class: "pengantar" }, h("b", { text: "Ini daftar pertanyaan di form petugas. " }),
        "Setiap item dijawab petugas dengan Sesuai, Temuan, atau N/A. Patroli tampil di form Patroli; Buka toko dan Tutup toko tampil di form Tenant. Tambah, ubah, atau matikan item di sini. Kalau semua item satu kategori dimatikan, bagian checklist kategori itu hilang dari form petugas. Perubahan langsung muncul di HP petugas saat form dibuka lagi."));
      var grid = h("div", { class: "kartu-item" });
      wadah.appendChild(grid);

      function isi() {
        PC.kosongkan(grid);
        URUT_KATEGORI.forEach(function (kat) {
          var daftar = (K.data.item || []).filter(function (o) { return o.k === kat; });
          var panel = h("div", { class: "panel" },
            h("div", { class: "panel-kepala" }, h("h2", { text: NAMA_KATEGORI[kat] }),
              h("span", { class: "oleh", text: aktifSaja(daftar).length + " aktif" })));
          if (!daftar.length) panel.appendChild(h("div", { class: "kosong-info", text: "Belum ada item." }));
          daftar.forEach(function (o) {
            panel.appendChild(h("div", { class: "item-baris" + (o.aktif ? "" : " nonaktif") },
              h("div", { class: "teks", text: o.i }),
              h("div", { class: "item-aksi" },
                btnIkon("PENSIL", "Ubah", "", function () { formItem(o, kat, isi); }),
                btnIkon("SAKLAR", o.aktif ? "Nonaktifkan" : "Aktifkan", o.aktif ? "aktif" : "mati", function () { alihAktif("ITEM", o, isi); }),
                btnIkon("SAMPAH", "Hapus", "bahaya", function () { hapus({ jenis: "ITEM", satu: "item checklist" }, o, isi); }))));
          });
          panel.appendChild(h("div", { class: "panel-isi" },
            h("button", { type: "button", class: "btn btn-kecil btn-utama", text: "Tambah item", onclick: function () { formItem(null, kat, isi); } })));
          grid.appendChild(panel);
        });
      }
      isi();
    });
  }

  /* ---------------------------------------------------------- AKUN ADMIN */
  function sandiAcak() {
    var abjad = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", a = new Uint8Array(12), s = "";
    window.crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += abjad[a[i] % abjad.length];
    return s;
  }

  function formAkun(o, segar) {
    var ubah = !!o, role = (K.data.roleTersedia || ["Admin", "Super Admin", "Supervisor", "Manager", "Viewer"]);
    var bidang = [];
    if (!ubah) bidang.push({ id: "username", label: "Nama pengguna", maks: 40, placeholder: "huruf kecil, angka, titik, strip", mode: "text", bantuan: "Dipakai untuk masuk. 3 sampai 40 karakter." });
    bidang.push({ id: "nama", label: "Nama lengkap", nilai: ubah ? o.nama : "", maks: 60, separuh: true });
    bidang.push({ id: "role", label: "Peran", tipe: "select", nilai: ubah ? o.role : "Supervisor", separuh: true, pilihan: role.map(function (r) { return [r, r]; }) });
    if (!ubah) bidang.push({ id: "password", label: "Kata sandi awal", maks: 100, tombol: { teks: "Buat otomatis", klik: function (el) { el.value = sandiAcak(); } },
      bantuan: "Minimal 8 karakter. Catat dan berikan langsung ke orangnya, setelah disimpan tidak bisa dilihat lagi." });
    DB.form({
      judul: ubah ? "Ubah akun " + o.username : "Tambah pengguna",
      info: ubah ? "Mengubah peran akan mengeluarkan akun itu dari sesi yang sedang aktif." : null,
      simpan: ubah ? "Simpan perubahan" : "Buat akun", bidang: bidang,
      periksa: function (v) {
        if (!ubah && !v.username.trim()) return "Nama pengguna wajib diisi.";
        if (!v.nama.trim()) return "Nama wajib diisi.";
        if (!ubah && v.password.length < 8) return "Kata sandi minimal 8 karakter.";
        return "";
      },
      kirim: function (v) {
        return DB.panggil("akunSimpan", ubah
          ? { op: "ubah", username: o.username, nama: v.nama, role: v.role }
          : { op: "tambah", username: v.username, nama: v.nama, role: v.role, password: v.password }, 40000).then(function (r) {
          if (r.status === "SUCCESS") { K.data.akun = r.akun; if (r.riwayat) K.data.riwayat = r.riwayat; }
          return r;
        });
      },
      selesai: function () { PC.toast(ubah ? "Akun diperbarui." : "Akun dibuat.", "ok"); segar(); }
    });
  }

  function formResetSandi(o, segar) {
    DB.form({
      judul: "Atur ulang kata sandi " + o.username, info: "Akun ini akan dikeluarkan dari semua sesi dan harus masuk dengan kata sandi baru.",
      simpan: "Atur ulang kata sandi",
      bidang: [{ id: "password", label: "Kata sandi baru", maks: 100, tombol: { teks: "Buat otomatis", klik: function (el) { el.value = sandiAcak(); } }, bantuan: "Minimal 8 karakter. Catat sebelum menyimpan." }],
      periksa: function (v) { return v.password.length >= 8 ? "" : "Kata sandi minimal 8 karakter."; },
      kirim: function (v) { return DB.panggil("akunSimpan", { op: "reset", username: o.username, password: v.password }, 40000); },
      selesai: function () { PC.toast("Kata sandi diatur ulang.", "ok"); segar(); }
    });
  }

  function tampilAkun(wadah) {
    denganData(wadah, function () {
      PC.kosongkan(wadah);
      wadah.appendChild(h("div", { class: "pengantar" }, h("b", { text: "Akun ini hanya untuk dashboard, bukan untuk petugas. " }),
        "Admin: semua fitur termasuk akun dan area. Supervisor dan Manager: kelola data tenant, petugas, zona, checklist serta tindak lanjut temuan. Viewer: hanya melihat laporan."));
      var tbodyWadah = h("div", { class: "tabel-wrap penuh", style: { border: "0", borderRadius: "0", marginBottom: "0" } });
      var panel = h("div", { class: "panel" },
        h("div", { class: "panel-kepala" }, h("h2", { text: "Akun dashboard" })),
        h("div", { class: "tools" }, h("div", { class: "rapat", style: { marginLeft: "0" } },
          h("button", { type: "button", class: "btn btn-kecil btn-utama", text: "Tambah akun", onclick: function () { formAkun(null, isi); } }))),
        tbodyWadah);
      wadah.appendChild(panel);
      var diri = String(DB.S.user.username).toLowerCase();

      function isi() {
        PC.kosongkan(tbodyWadah);
        var tbody = h("tbody");
        (K.data.akun || []).forEach(function (o) {
          var saya = o.username.toLowerCase() === diri;
          tbody.appendChild(h("tr", null,
            h("td", { class: "nama" }, o.username, saya ? h("span", { class: "lencana l-rendah", style: { marginLeft: "8px" }, text: "Anda" }) : null),
            h("td", { text: o.nama }), h("td", null, lencana(o.role, /^admin$/i.test(o.role) ? "l-proses" : "l-abu")),
            h("td", { class: "aksi" },
              btnIkon("PENSIL", "Ubah", "", function () { formAkun(o, isi); }),
              saya ? null : btnIkon("KUNCI", "Atur ulang kata sandi", "", function () { formResetSandi(o, isi); }),
              saya ? null : btnIkon("SAMPAH", "Hapus", "bahaya", function () {
                PC.tanya("Hapus akun?", "Akun \"" + o.username + "\" dihapus dan langsung dikeluarkan dari dashboard.", "Hapus", "Batal").then(function (ya) {
                  if (!ya) return;
                  DB.panggil("akunSimpan", { op: "hapus", username: o.username }, 40000).then(function (r) {
                    if (r.status === "SUCCESS") { K.data.akun = r.akun; if (r.riwayat) K.data.riwayat = r.riwayat; PC.toast("Akun dihapus.", "ok"); isi(); }
                    else if (r.kode !== "SESI") PC.toast(r.message, "bad");
                  });
                });
              }))));
        });
        tbodyWadah.appendChild(h("table", null, h("thead", null, h("tr", null, ["Nama pengguna", "Nama", "Peran", ""].map(function (k) { return h("th", { text: k }); }))), tbody));
      }
      isi();
    });
  }

  /* ---------------------------------------------------------- AREA PATROLI (geofence) */
  function isiArea(wadah) {
    {
      var g = K.data.geo || {};
      wadah.appendChild(h("div", { class: "pengantar" }, h("b", { text: "Batas area mall. " }),
        "Laporan yang dikirim dari luar lingkaran ini tetap tersimpan tetapi diberi catatan \"Di luar area mall\" di dashboard. Kosongkan semua isian untuk menonaktifkan pemeriksaan."));
      var lat = h("input", { id: "g-lat", class: "input", inputmode: "decimal", autocomplete: "off", placeholder: "-6.9932" });
      var lng = h("input", { id: "g-lng", class: "input", inputmode: "decimal", autocomplete: "off", placeholder: "110.4203" });
      var rad = h("input", { id: "g-rad", class: "input", inputmode: "numeric", autocomplete: "off", placeholder: "300" });
      lat.value = g.lat || ""; lng.value = g.lng || ""; rad.value = g.radius || "";
      var galat = h("p", { class: "galat", role: "alert", hidden: true });
      var status = h("p", { class: "oleh" });
      function segarStatus() {
        var gg = K.data.geo || {};
        PC.kosongkan(status);
        if (gg.lat && gg.lng && gg.radius) {
          status.appendChild(document.createTextNode("Aktif: " + gg.lat + ", " + gg.lng + " radius " + gg.radius + " meter. "));
          status.appendChild(h("a", { href: "https://www.google.com/maps?q=" + encodeURIComponent(gg.lat + "," + gg.lng), target: "_blank", rel: "noopener noreferrer", text: "Lihat di peta" }));
        } else status.appendChild(document.createTextNode("Belum diatur. Semua laporan dianggap berada di dalam area."));
      }
      segarStatus();

      function simpan(kosong) {
        galat.hidden = true;
        var geo = kosong ? { lat: "", lng: "", radius: "" } : { lat: lat.value.trim().replace(",", "."), lng: lng.value.trim().replace(",", "."), radius: rad.value.trim() };
        DB.panggil("pengaturanSimpan", { geo: geo }, 40000).then(function (r) {
          if (r.status === "SUCCESS") {
            K.data.geo = r.geo; if (r.riwayat) K.data.riwayat = r.riwayat;
            lat.value = r.geo.lat || ""; lng.value = r.geo.lng || ""; rad.value = r.geo.radius || "";
            segarStatus(); PC.toast(kosong ? "Batas area dinonaktifkan." : "Batas area disimpan.", "ok");
          } else if (r.kode !== "SESI") { galat.textContent = r.message || "Gagal menyimpan."; galat.hidden = false; }
        });
      }
      var btnLokasi = h("button", { type: "button", class: "btn btn-kuning", text: "Gunakan lokasi saat ini", onclick: function () {
        if (!navigator.geolocation) { galat.textContent = "Perangkat ini tidak mendukung lokasi."; galat.hidden = false; return; }
        btnLokasi.disabled = true; btnLokasi.textContent = "Mencari lokasi...";
        navigator.geolocation.getCurrentPosition(function (p) {
          lat.value = p.coords.latitude.toFixed(6); lng.value = p.coords.longitude.toFixed(6);
          if (!rad.value) rad.value = "300";
          btnLokasi.disabled = false; btnLokasi.textContent = "Gunakan lokasi saat ini";
          galat.hidden = true;
        }, function () {
          btnLokasi.disabled = false; btnLokasi.textContent = "Gunakan lokasi saat ini";
          galat.textContent = "Lokasi tidak bisa dibaca. Izinkan akses lokasi di browser, atau isi koordinat manual."; galat.hidden = false;
        }, { enableHighAccuracy: true, timeout: 20000 });
      } });

      wadah.appendChild(h("div", { class: "panel" },
        h("div", { class: "panel-kepala" }, h("h2", { text: "Titik pusat dan radius" })),
        h("div", { class: "panel-isi" },
          status,
          h("div", { style: { margin: "12px 0" } }, btnLokasi,
            h("p", { class: "bantuan oleh", style: { marginTop: "6px" }, text: "Berdiri di tengah mall lalu tekan tombol ini, atau salin koordinat dari Google Maps." })),
          h("div", { class: "peta-isian" },
            h("div", { class: "medan" }, h("label", { for: "g-lat", text: "Lintang (latitude)" }), lat),
            h("div", { class: "medan" }, h("label", { for: "g-lng", text: "Bujur (longitude)" }), lng),
            h("div", { class: "medan" }, h("label", { for: "g-rad", text: "Radius (meter)" }), rad, h("p", { class: "bantuan", text: "20 sampai 5000." }))),
          galat,
          h("div", { class: "grup" },
            h("button", { type: "button", class: "btn btn-utama", text: "Simpan batas area", onclick: function () { simpan(false); } }),
            h("button", { type: "button", class: "btn btn-bahaya", text: "Nonaktifkan pemeriksaan", onclick: function () { simpan(true); } })))));
    }
  }

  /* ---------------------------------------------------------- PENGATURAN: target patroli, area, pemeriksaan sistem */
  function panelPatroli() {
    var p = K.data.pengaturan || { interval: 60, jamMulai: 7, jamSelesai: 22, fotoTenant: "temuan" };
    var inInterval = h("input", { id: "p-int", class: "input", type: "number", min: "15", max: "480", inputmode: "numeric" });
    var inMulai = h("input", { id: "p-mulai", class: "input", type: "number", min: "0", max: "23", inputmode: "numeric" });
    var inSelesai = h("input", { id: "p-selesai", class: "input", type: "number", min: "1", max: "24", inputmode: "numeric" });
    var foto = h("select", { id: "p-foto", class: "input" },
      h("option", { value: "temuan", text: "Wajib hanya bila ada temuan", selected: p.fotoTenant !== "selalu" }),
      h("option", { value: "selalu", text: "Selalu wajib", selected: p.fotoTenant === "selalu" }));
    inInterval.value = p.interval; inMulai.value = p.jamMulai; inSelesai.value = p.jamSelesai;
    var galat = h("p", { class: "galat", role: "alert", hidden: true });
    function simpan() {
      galat.hidden = true;
      DB.panggil("pengaturanPatroli", { patroli: { interval: Number(inInterval.value), jamMulai: Number(inMulai.value),
        jamSelesai: Number(inSelesai.value), fotoTenant: foto.value } }, 40000).then(function (r) {
        if (r.status === "SUCCESS") {
          K.data.pengaturan = r.pengaturan; if (r.riwayat) K.data.riwayat = r.riwayat;
          PC.toast("Pengaturan patroli disimpan.", "ok");
          if (DB.muatUlang) DB.muatUlang();
        } else if (r.kode !== "SESI") { galat.textContent = r.message || "Gagal menyimpan."; galat.hidden = false; }
      });
    }
    return h("div", { class: "panel" },
      h("div", { class: "panel-kepala" }, h("h2", { text: "Target patroli" })),
      h("div", { class: "panel-isi" },
        h("p", { class: "oleh", style: { marginTop: "0" }, text: "Dipakai halaman Cakupan zona dan notifikasi. Zona dianggap terlambat bila belum dipatroli lebih lama dari target pada jam operasional." }),
        h("div", { class: "peta-isian" },
          h("div", { class: "medan" }, h("label", { for: "p-int", text: "Target interval (menit)" }), inInterval, h("p", { class: "bantuan", text: "15 sampai 480." })),
          h("div", { class: "medan" }, h("label", { for: "p-mulai", text: "Jam mulai" }), inMulai, h("p", { class: "bantuan", text: "0 sampai 23, WIB." })),
          h("div", { class: "medan" }, h("label", { for: "p-selesai", text: "Jam selesai" }), inSelesai, h("p", { class: "bantuan", text: "1 sampai 24, WIB." }))),
        h("div", { class: "medan" }, h("label", { for: "p-foto", text: "Foto pada checklist tenant" }), foto,
          h("p", { class: "bantuan", text: "Foto patroli tetap wajib. Untuk tenant, foto bisa dilewati bila semua item sesuai." })),
        galat,
        h("button", { type: "button", class: "btn btn-utama", text: "Simpan target patroli", onclick: simpan })));
  }

  function panelSistem() {
    var wadah = h("div", { class: "panel" });
    function jalankan(op, konfirmasi) {
      function lakukan() {
        DB.panggil("sistemJalankan", { op: op }, 120000).then(function (r) {
          if (r.status === "SUCCESS") {
            K.data.sistem = r.sistem; if (r.riwayat) K.data.riwayat = r.riwayat;
            PC.toast(r.pesan, "ok"); isi();
          } else if (r.kode !== "SESI") PC.toast(r.message || "Gagal.", "bad");
        });
      }
      if (!konfirmasi) { lakukan(); return; }
      PC.tanya(konfirmasi[0], konfirmasi[1], "Lanjut", "Batal").then(function (ya) { if (ya) lakukan(); });
    }
    function baris(ok, judul, ket, aksi) {
      return h("div", { class: "periksa" },
        h("span", { class: "lencana " + (ok === null ? "l-abu" : (ok ? "l-ok" : "l-warn")), text: ok === null ? "Info" : (ok ? "Baik" : "Perlu tindakan") }),
        h("div", { class: "periksa-teks" }, h("b", { text: judul }), h("span", { text: ket })),
        aksi || null);
    }
    function isi() {
      PC.kosongkan(wadah);
      var s = K.data.sistem || {};
      wadah.appendChild(h("div", { class: "panel-kepala" }, h("h2", { text: "Pemeriksaan sistem" })));
      var daftar = h("div", { class: "panel-isi periksa-daftar" });
      daftar.appendChild(baris(s.adminPenuh >= 2, "Jumlah akun admin",
        s.adminPenuh >= 2 ? s.adminPenuh + " akun admin aktif." : "Hanya " + s.adminPenuh + " akun admin. Tambahkan satu lagi di menu Pengguna agar tidak terkunci bila satu lupa kata sandi."));
      daftar.appendChild(baris(!s.adminBawaan, "Nama pengguna bawaan",
        s.adminBawaan ? "Akun \"admin\" bawaan masih ada dan mudah ditebak. Buat akun admin baru dengan nama lain, masuk dengannya, lalu hapus akun \"admin\"." : "Tidak ada akun dengan nama pengguna bawaan."));
      daftar.appendChild(baris(!!s.geoDiatur, "Batas area patroli",
        s.geoDiatur ? "Aktif. Laporan dari luar area diberi catatan." : "Belum diatur. Atur di bagian Area patroli di bawah."));
      daftar.appendChild(baris(s.pemicu === null ? null : !!s.pemicu, "Cadangan dan arsip mingguan",
        s.pemicu === null ? "Status jadwal tidak bisa dibaca. Berikan izin baru saat membuat versi deployment, lalu muat ulang halaman ini."
          : (s.pemicu ? "Jadwal aktif: setiap Senin dini hari." : "Belum dijadwalkan."),
        h("button", { type: "button", class: "btn btn-kecil " + (s.pemicu ? "btn-garis" : "btn-utama"), text: s.pemicu ? "Pasang ulang" : "Pasang jadwal",
          onclick: function () { jalankan("pemicu"); } })));
      daftar.appendChild(baris(null, "Cadangan terakhir", s.cadangan || "Belum pernah. Salinan disimpan di folder Cadangan_Digital_Patrol di Google Drive (8 terbaru).",
        h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Buat sekarang", onclick: function () { jalankan("cadangan"); } })));
      daftar.appendChild(baris(null, "Arsip log terakhir", s.arsip || "Belum pernah. Log lebih tua dari 180 hari dipindah ke spreadsheet arsip agar sheet tetap cepat.",
        h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Arsipkan sekarang",
          onclick: function () { jalankan("arsip", ["Arsipkan log lama?", "Baris log yang lebih tua dari 180 hari dipindah ke spreadsheet arsip, lalu dihapus dari sheet utama. Tindak lanjut dan laporan terbaru tidak terpengaruh."]); } })));
      wadah.appendChild(daftar);
    }
    isi();
    return wadah;
  }

  function tampilPengaturan(wadah) {
    denganData(wadah, function () {
      PC.kosongkan(wadah);
      wadah.appendChild(panelPatroli());
      var area = h("div");
      wadah.appendChild(area);
      isiArea(area);
      wadah.appendChild(panelSistem());
    });
  }

  /* ---------------------------------------------------------- RIWAYAT */
  function tampilRiwayat(wadah) {
    denganData(wadah, function () {
      PC.kosongkan(wadah);
      wadah.appendChild(h("div", { class: "pengantar" }, h("b", { text: "Catatan audit. " }), "Setiap perubahan data master, akun, dan batas area tercatat di sini beserta pelakunya. Kata sandi tidak pernah dicatat. Menampilkan 100 perubahan terakhir."));
      var tabel = h("div", { class: "tabel-wrap penuh", style: { border: "0", borderRadius: "0", marginBottom: "0" } });
      var hitung = h("span");
      var cari = h("input", { type: "search", class: "input", placeholder: "Cari pengguna, jenis, atau isi", "aria-label": "Cari riwayat" });
      var panel = h("div", { class: "panel" }, h("div", { class: "panel-kepala" }, h("h2", { text: "Riwayat perubahan" }), h("span", { class: "oleh" }, hitung)),
        h("div", { class: "tools" }, cari, h("div", { class: "rapat" }, h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Muat ulang", onclick: function () {
          muatKelola(true).then(function (r) { if (r.status === "SUCCESS") isi(); else PC.toast(r.message, "bad"); });
        } }))), tabel);
      wadah.appendChild(panel);
      function isi() {
        PC.kosongkan(tabel);
        var q = cari.value.toLowerCase().trim();
        var daftar = (K.data.riwayat || []).filter(function (o) { return !q || [o.ts, o.oleh, o.jenis, o.aksi, o.rincian].join(" ").toLowerCase().indexOf(q) >= 0; });
        hitung.textContent = daftar.length + " catatan";
        if (!daftar.length) { tabel.appendChild(h("div", { class: "kosong-tabel", text: "Belum ada perubahan tercatat." })); return; }
        tabel.appendChild(h("table", null, h("thead", null, h("tr", null, ["Waktu", "Oleh", "Data", "Aksi", "Rincian"].map(function (k) { return h("th", { text: k }); }))),
          h("tbody", null, daftar.map(function (o) {
            return h("tr", null, h("td", { class: "waktu", text: o.ts }), h("td", { text: o.oleh }), h("td", { text: o.jenis }),
              h("td", null, lencana(o.aksi, /hapus/.test(o.aksi) ? "l-bad" : "l-abu")), h("td", { text: o.rincian }));
          }))));
      }
      cari.addEventListener("input", isi);
      isi();
    });
  }

  /* ---------------------------------------------------------- SHIFT dan PENUGASAN LANTAI */
  function paketShift() { return (K.data && K.data.shift) || { shift: [], tugas: [], rondeJam: 3, lantai: [], status: {} }; }

  function kirimShift(badan) {
    return DB.panggil("shiftSimpan", badan, 60000).then(function (r) {
      if (r.status === "SUCCESS") { K.data.shift = r.shift; if (r.riwayat) K.data.riwayat = r.riwayat; }
      return r;
    });
  }

  function menitJam(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
  }
  function jamMenit(m) { m = ((m % 1440) + 1440) % 1440; return ("0" + Math.floor(m / 60)).slice(-2) + "." + ("0" + (m % 60)).slice(-2); }

  // Pratinjau jam ronde: dihitung dari jam mulai shift, ronde terakhir dipotong di jam selesai.
  function jadwalRonde(mulai, selesai, jam) {
    var m = menitJam(mulai), e = menitJam(selesai), R = Math.round(Number(jam) * 60);
    if (m < 0 || e < 0 || m === e || !(R > 0)) return "";
    var total = e > m ? e - m : e + 1440 - m, out = [];
    for (var t = 0; t < total; t += R) out.push(jamMenit(m + t) + "-" + jamMenit(m + Math.min(t + R, total)));
    return "Ronde: " + out.join("  \u00b7  ");
  }

  function peringkatLantaiAdmin(f) {
    if (f === "LG") return 0;
    var m = /^L(\d+)$/.exec(f);
    return m ? 1 + Number(m[1]) : 100;
  }

  function panelShiftJam() {
    var p = paketShift();
    var baris = p.shift.map(function (x) { return { lama: x.nama, nama: x.nama, mulai: x.mulai, selesai: x.selesai, aktif: x.aktif }; });
    var inRonde = h("input", { id: "sh-ronde", class: "input", type: "number", min: "1", max: "12", step: "0.5", inputmode: "decimal" });
    inRonde.value = p.rondeJam;
    var daftar = h("div");
    var galat = h("p", { class: "galat", role: "alert", hidden: true });

    function gambar() {
      PC.kosongkan(daftar);
      baris.forEach(function (x, i) {
        var nama = h("input", { class: "input", type: "text", maxlength: "30", "aria-label": "Nama shift" });
        var mulai = h("input", { class: "input", type: "time", "aria-label": "Jam mulai" });
        var selesai = h("input", { class: "input", type: "time", "aria-label": "Jam selesai" });
        var aktif = h("select", { class: "input", "aria-label": "Status" },
          h("option", { value: "ya", text: "Aktif", selected: x.aktif }), h("option", { value: "tidak", text: "Nonaktif", selected: !x.aktif }));
        nama.value = x.nama; mulai.value = x.mulai; selesai.value = x.selesai;
        var jadwal = h("p", { class: "jadwal" });
        function segar() {
          x.nama = nama.value; x.mulai = mulai.value; x.selesai = selesai.value; x.aktif = aktif.value === "ya";
          jadwal.textContent = jadwalRonde(x.mulai, x.selesai, inRonde.value) + (menitJam(x.selesai) >= 0 && menitJam(x.mulai) > menitJam(x.selesai) ? "  (melewati tengah malam)" : "");
        }
        [nama, mulai, selesai].forEach(function (el) { el.addEventListener("input", segar); });
        aktif.addEventListener("change", segar);
        inRonde.addEventListener("input", segar);
        segar();
        daftar.appendChild(h("div", { class: "shift-baris" },
          h("div", { class: "medan", style: { margin: "0" } }, h("label", { text: i === 0 ? "Nama shift" : "\u00a0" }), nama),
          h("div", { class: "medan", style: { margin: "0" } }, h("label", { text: i === 0 ? "Mulai" : "\u00a0" }), mulai),
          h("div", { class: "medan", style: { margin: "0" } }, h("label", { text: i === 0 ? "Selesai" : "\u00a0" }), selesai),
          h("div", { class: "medan", style: { margin: "0" } }, h("label", { text: i === 0 ? "Status" : "\u00a0" }), aktif),
          jadwal));
      });
    }
    gambar();

    function simpan() {
      galat.hidden = true;
      kirimShift({ op: "shift", rondeJam: Number(inRonde.value), shift: baris.map(function (x) {
        return { lama: x.lama, nama: x.nama, mulai: x.mulai, selesai: x.selesai, aktif: x.aktif };
      }) }).then(function (r) {
        if (r.status === "SUCCESS") { PC.toast("Shift disimpan.", "ok"); DB.buka("shift"); }
        else if (r.kode !== "SESI") { galat.textContent = r.message || "Gagal menyimpan."; galat.hidden = false; }
      });
    }

    return h("div", { class: "panel" },
      h("div", { class: "panel-kepala" }, h("h2", { text: "Shift dan durasi ronde" })),
      h("div", { class: "panel-isi" },
        h("div", { class: "pengantar" }, h("b", { text: "Ronde dihitung dari jam mulai shift. " }),
          "Dalam satu ronde, petugas wajib mendatangi semua zona di lantai tugasnya (zona berpola \"LG - 85\" milik lantai LG). Saat ronde berganti, progres kembali ke nol. Shift yang selesai lebih pagi dari jam mulainya dianggap melewati tengah malam. Petugas memilih shift sendiri di form Patroli; HP mengunci nama dan shift itu sampai shift berakhir."),
        h("div", { class: "medan", style: { maxWidth: "220px" } }, h("label", { for: "sh-ronde", text: "Durasi ronde (jam)" }), inRonde,
          h("p", { class: "bantuan", text: "1 sampai 12, kelipatan 0,5." })),
        daftar,
        h("div", { class: "grup", style: { marginBottom: "10px" } },
          h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Tambah shift", disabled: baris.length >= 8, onclick: function () {
            baris.push({ lama: "", nama: "", mulai: "08:00", selesai: "16:00", aktif: true }); gambar();
          } })),
        galat,
        h("div", { class: "grup" },
          h("button", { type: "button", class: "btn btn-utama", text: "Simpan shift", onclick: simpan }),
          h("button", { type: "button", class: "btn btn-garis", text: "Buka kunci semua petugas", onclick: function () {
            PC.tanya("Buka kunci semua petugas?", "Semua HP petugas akan melepas kunci nama dan shift saat form patroli dibuka berikutnya. Petugas memilih lagi.", "Buka kunci", "Batal").then(function (ya) {
              if (!ya) return;
              kirimShift({ op: "bukaKunci" }).then(function (r) {
                if (r.status === "SUCCESS") PC.toast("Kunci dibuka untuk semua petugas.", "ok");
                else if (r.kode !== "SESI") PC.toast(r.message || "Gagal.", "bad");
              });
            });
          } }))));
  }

  function panelTugas() {
    var p = paketShift();
    var wadah = h("div", { class: "panel" });
    var petugas = aktifSaja(K.data.petugas);
    var shiftAktif = p.shift.filter(function (x) { return x.aktif; });
    var lantai = p.lantai.slice().sort(function (a, b) { return peringkatLantaiAdmin(a) - peringkatLantaiAdmin(b) || a.localeCompare(b); });
    var tugas = {};
    p.tugas.forEach(function (t) { if (t.aktif) tugas[t.n.toLowerCase()] = t; });

    wadah.appendChild(h("div", { class: "panel-kepala" }, h("h2", { text: "Penugasan lantai" }),
      h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Muat ulang status", onclick: function () {
        muatKelola(true).then(function (r) { if (r.status === "SUCCESS") DB.buka("shift"); else PC.toast(r.message, "bad"); });
      } })));
    var isi = h("div", { class: "panel-isi" });
    wadah.appendChild(isi);
    isi.appendChild(h("div", { class: "pengantar" }, h("b", { text: "Satu petugas, satu lantai, satu shift. " }),
      "Petugas yang ditugaskan melihat progres ronde lantainya di form Patroli, dan daftar zonanya difokuskan ke lantai itu. Petugas tanpa penugasan tetap memakai form seperti biasa."));

    if (!petugas.length) { isi.appendChild(h("div", { class: "kosong-tabel", text: "Belum ada petugas aktif. Tambahkan di menu Petugas." })); return wadah; }
    if (!shiftAktif.length) { isi.appendChild(h("div", { class: "kosong-tabel", text: "Belum ada shift aktif. Aktifkan minimal satu shift di atas." })); return wadah; }

    var tbody = h("tbody");
    petugas.forEach(function (o) {
      var ada = tugas[o.n.toLowerCase()];
      var pilihShift = ada && shiftAktif.some(function (x) { return x.nama === ada.shift; }) ? ada.shift : shiftAktif[0].nama;
      var dipilih = (ada ? ada.lantai : []).slice();
      var sel = h("select", { class: "input", "aria-label": "Shift " + o.n });
      shiftAktif.forEach(function (x) { sel.appendChild(h("option", { value: x.nama, text: x.nama + " (" + x.mulai.replace(":", ".") + "-" + x.selesai.replace(":", ".") + ")", selected: x.nama === pilihShift })); });
      var chipWadah = h("div", { class: "tugas-lantai" });
      lantai.forEach(function (f) {
        var chip = h("button", { type: "button", class: "chip", "aria-pressed": dipilih.indexOf(f) >= 0 ? "true" : "false", text: f, onclick: function () {
          var i = dipilih.indexOf(f);
          if (i >= 0) dipilih.splice(i, 1); else dipilih.push(f);
          chip.setAttribute("aria-pressed", i >= 0 ? "false" : "true");
        } });
        chipWadah.appendChild(chip);
      });
      var st = ada && p.status[o.n];
      var ketStatus;
      if (!ada) ketStatus = lencana("Belum ditugaskan", "l-abu");
      else if (!st || !st.aktif) ketStatus = h("span", { class: "tugas-prog", text: st && st.alasan ? st.alasan : "-" });
      else ketStatus = h("span", null, lencana(st.lengkap ? "Selesai" : "Berjalan", st.lengkap ? "l-ok" : "l-warn"),
        h("div", { class: "tugas-prog", text: "Ronde " + st.ronde + "/" + st.totalRonde + " \u00b7 " + st.selesaiJml + "/" + st.total + " zona" }));
      var btnSimpan = h("button", { type: "button", class: "btn btn-kecil btn-utama", text: "Simpan", onclick: function () {
        if (!dipilih.length) { PC.toast("Pilih minimal satu lantai untuk " + o.n + ".", "bad"); return; }
        btnSimpan.disabled = true;
        kirimShift({ op: "tugas", petugas: o.n, shift: sel.value, lantai: dipilih }).then(function (r) {
          btnSimpan.disabled = false;
          if (r.status === "SUCCESS") { PC.toast("Penugasan " + o.n + " disimpan.", "ok"); DB.buka("shift"); }
          else if (r.kode !== "SESI") PC.toast(r.message || "Gagal menyimpan.", "bad");
        });
      } });
      var aksi = [btnSimpan];
      if (ada) aksi.push(btnIkon("SAMPAH", "Hapus penugasan", "bahaya", function () {
        PC.tanya("Hapus penugasan?", o.n + " tidak lagi dibatasi ke lantai tertentu.", "Hapus", "Batal").then(function (ya) {
          if (!ya) return;
          kirimShift({ op: "tugasHapus", petugas: o.n }).then(function (r) {
            if (r.status === "SUCCESS") { PC.toast("Penugasan dihapus.", "ok"); DB.buka("shift"); }
            else if (r.kode !== "SESI") PC.toast(r.message || "Gagal menghapus.", "bad");
          });
        });
      }));
      tbody.appendChild(h("tr", null, h("td", { class: "nama", text: o.n }), h("td", null, sel), h("td", null, chipWadah), h("td", null, ketStatus),
        h("td", null, h("div", { class: "grup", style: { alignItems: "center" } }, aksi))));
    });
    isi.appendChild(h("div", { class: "tabel-wrap penuh", style: { border: "0" } },
      h("table", { class: "tugas-tabel" }, h("thead", null, h("tr", null, ["Petugas", "Shift utama", "Lantai", "Ronde sekarang", ""].map(function (k) { return h("th", { text: k }); }))), tbody)));
    return wadah;
  }

  function tampilShift(wadah) {
    denganData(wadah, function () {
      PC.kosongkan(wadah);
      wadah.appendChild(panelShiftJam());
      wadah.appendChild(panelTugas());
    });
  }

  /* ---------------------------------------------------------- daftar halaman */
  DB.daftar({ id: "tenant", judul: "Tenant", grup: "data", izin: "editor", tampil: tampilTenant });
  DB.daftar({ id: "petugas", judul: "Petugas", grup: "data", izin: "editor", tampil: tampilPetugas });
  DB.daftar({ id: "zona", judul: "Zona", grup: "data", izin: "editor", tampil: tampilZona });
  DB.daftar({ id: "item", judul: "Checklist", grup: "data", izin: "editor", tampil: tampilItem });
  DB.daftar({ id: "shift", judul: "Shift & Tugas", grup: "data", izin: "editor", tampil: tampilShift });
  DB.daftar({ id: "akun", judul: "Pengguna", grup: "sistem", izin: "penuh", tampil: tampilAkun });
  DB.daftar({ id: "pengaturan", judul: "Pengaturan", grup: "sistem", izin: "penuh", tampil: tampilPengaturan });
  DB.daftar({ id: "riwayat", judul: "Riwayat perubahan", grup: "sistem", izin: "editor", tampil: tampilRiwayat });

  // Setelah masuk, muat jumlah data master di latar agar angka di menu langsung terisi.
  var mulaiApp = DB.mulaiApp;
  DB.mulaiApp = function () {
    mulaiApp();
    if (DB.S.user && DB.S.user.bisaUbah) muatKelola(true);
  };
})();
