/* cakupan.js - halaman Cakupan zona: zona mana yang sudah dipatroli sesuai target dan mana yang terlambat.
   Datanya dihitung server (ambilData) dan dimuat di latar oleh laporan.js; di sini hanya ditampilkan. */
(function () {
  "use strict";
  var DB = window.DB, PC = window.PC, h = PC.h, $ = DB.$;
  var S = { tampil: false, hanyaMasalah: false };
  var LABEL = { ok: "Sesuai target", terlambat: "Terlambat", belum: "Belum dipatroli", "luar-jam": "Di luar jam" };
  var KLS = { ok: "l-ok", terlambat: "l-warn", belum: "l-bad", "luar-jam": "l-abu" };
  var URUT = { belum: 0, terlambat: 1, ok: 2, "luar-jam": 3 };

  function teksMenit(m) {
    if (m === null || m === undefined) return "Belum ada patroli";
    if (m < 1) return "Baru saja";
    if (m < 60) return m + " menit lalu";
    return Math.floor(m / 60) + " jam " + (m % 60) + " menit lalu";
  }
  function pad(n) { return ("0" + n).slice(-2); }

  // Menit sejak patroli terakhir, disegarkan memakai jam lokal sejak data dimuat.
  function menitKini(z) {
    if (z.menit === null || z.menit === undefined) return null;
    var selisih = DB.data && DB.data.waktu ? Math.floor((Date.now() - DB.data.waktu) / 60000) : 0;
    return z.menit + Math.max(0, selisih);
  }

  function statusKini(z, c) {
    if (!c.jamAktif) return "luar-jam";
    var m = menitKini(z);
    if (z.status === "belum" || m === null) return "belum";
    return m > c.interval ? "terlambat" : "ok";
  }

  function hitungPerhatian() {
    var c = DB.data && DB.data.cakupan;
    if (!c || !c.jamAktif) return 0;
    return c.zona.filter(function (z) { var s = statusKini(z, c); return s === "belum" || s === "terlambat"; }).length;
  }
  DB.hitungPerhatian = hitungPerhatian;

  function render() {
    var w = $("cakupan-isi");
    if (!w) return;
    PC.kosongkan(w);
    var d = DB.data, c = d && d.cakupan;
    if (!c) { w.appendChild(h("div", { class: "panel" }, h("div", { class: "kosong-info", text: "Memuat data cakupan..." }))); return; }
    var daftar = c.zona.map(function (z) { return { z: z, s: statusKini(z, c) }; });
    var n = { ok: 0, terlambat: 0, belum: 0, "luar-jam": 0 };
    daftar.forEach(function (x) { n[x.s]++; });
    var total = daftar.length;

    var jam = pad(c.jamMulai) + ".00 sampai " + pad(c.jamSelesai) + ".00 WIB";
    w.appendChild(h("div", { class: "pengantar" }, h("b", { text: "Target: " }),
      "setiap zona dipatroli paling lama " + c.interval + " menit sekali pada jam operasional (" + jam + "). " +
      (c.jamAktif ? "Saat ini jam operasional." : "Saat ini di luar jam operasional, jadi tidak ada zona yang dihitung terlambat.") +
      " Target dan jam diubah di menu Pengaturan."));

    var sel = function (angka, ket, kls) {
      return h("div", { class: kls || "" }, h("div", { class: "angka" }, angka), h("div", { class: "ket", text: ket }));
    };
    w.appendChild(h("div", { class: "ringkas ringkas-zona" },
      sel(String(total), "Zona aktif"),
      sel(String(n.ok), "Sesuai target", "buka"),
      sel(String(n.terlambat), "Terlambat", "kuning"),
      sel(String(n.belum), "Belum dipatroli", n.belum ? "bad" : "")));

    var tampilkan = daftar.filter(function (x) { return !S.hanyaMasalah || x.s === "belum" || x.s === "terlambat"; });
    tampilkan.sort(function (a, b) { return URUT[a.s] - URUT[b.s] || a.z.zona.localeCompare(b.z.zona, "id", { numeric: true }); });

    var btn = h("button", { type: "button", class: "btn btn-pilih", "aria-pressed": S.hanyaMasalah ? "true" : "false", text: "Hanya yang perlu perhatian",
      onclick: function () { S.hanyaMasalah = !S.hanyaMasalah; render(); } });
    var kepala = h("div", { class: "panel-kepala" }, h("h2", { text: "Status zona" }),
      h("span", { class: "oleh", text: "Diperbarui " + PC.fmtWIB(new Date(d.waktu)).jam + " WIB" }));
    var alat = h("div", { class: "tools" }, h("span", { text: tampilkan.length + " dari " + total + " zona" }),
      h("div", { class: "rapat" }, btn,
        h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Muat ulang", onclick: function () { if (DB.muatUlang) DB.muatUlang(); } })));
    var grid = h("div", { class: "zona-grid" });
    if (!tampilkan.length) grid.appendChild(h("div", { class: "kosong-info", text: total ? "Semua zona sesuai target." : "Belum ada zona aktif. Tambahkan di menu Zona." }));
    tampilkan.forEach(function (x) {
      var m = menitKini(x.z);
      grid.appendChild(h("div", { class: "zona-kartu s-" + x.s },
        h("div", { class: "zona-nama", title: x.z.zona, text: x.z.zona }),
        h("div", null, h("span", { class: "lencana " + KLS[x.s], text: LABEL[x.s] })),
        h("div", { class: "oleh", text: x.z.hariIni === 0 && x.z.terakhir ? "Terakhir " + x.z.terakhir.slice(0, 16) : teksMenit(m) }),
        h("div", { class: "oleh", text: "Hari ini: " + x.z.hariIni + " kali" })));
    });
    w.appendChild(h("div", { class: "panel" }, kepala, alat, h("div", { class: "panel-isi" }, grid)));
  }

  function tampil(wadah) {
    S.tampil = true;
    wadah.appendChild(h("div", { id: "cakupan-isi" }));
    render();
    if (DB.muatUlang) DB.muatUlang();
  }
  function tinggalkan() { S.tampil = false; }

  // Menyegarkan tampilan tiap menit agar "N menit lalu" tidak basi di layar kontrol yang dibiarkan menyala.
  setInterval(function () { if (S.tampil) render(); lencana(); }, 60000);

  function lencana() {
    if (!DB.data || !DB.S.token) return;
    var n = hitungPerhatian();
    DB.badge("cakupan", n || null, n > 0);
  }
  DB.saatData(function () { lencana(); if (S.tampil) render(); });

  DB.daftar({ id: "cakupan", judul: "Cakupan zona", grup: "pantau", izin: "semua", tampil: tampil, tinggalkan: tinggalkan });
})();
