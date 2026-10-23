/* cakupan.js - halaman Cakupan zona: status zona per sesi dan per lantai.
   Lantai yang punya petugas bertugas (shift aktif) wajib dipatroli semua zonanya pada tiap sesi.
   Datanya dihitung server (ambilData) dan dimuat di latar oleh laporan.js; di sini hanya ditampilkan. */
(function () {
  "use strict";
  var DB = window.DB, PC = window.PC, h = PC.h, $ = DB.$;
  var S = { tampil: false, hanyaMasalah: false };
  var LABEL = { ok: "Sudah sesi ini", belum: "Belum", mepet: "Segera", tanpa: "Tanpa petugas" };
  var KLS = { ok: "l-ok", belum: "l-warn", mepet: "l-bad", tanpa: "l-abu" };
  var URUT = { mepet: 0, belum: 1, ok: 2, tanpa: 3 };

  function pad(n) { return ("0" + n).slice(-2); }
  function teksSisa(m) {
    if (m <= 0) return "waktu habis";
    if (m < 60) return m + " mnt";
    return Math.floor(m / 60) + " j " + pad(m % 60) + " mnt";
  }
  function jamTitik(s) { return String(s || "").replace(":", "."); }
  function teksTerakhir(x) {
    if (!x.terakhir) return "Belum ada patroli";
    var jam = x.terakhir.slice(11, 16), tgl = x.terakhir.slice(0, 10);
    var hari = DB.data && DB.data.hariIni ? DB.data.hariIni.split("-").reverse().join("/") : "";
    return "Terakhir " + (tgl === hari ? jam : tgl + " " + jam) + (x.oleh ? " oleh " + x.oleh : "");
  }

  // Sisa waktu sesi disegarkan memakai jam lokal sejak data dimuat.
  function berlalu() { return DB.data && DB.data.waktu ? Math.floor((Date.now() - DB.data.waktu) / 60000) : 0; }
  function sisaKini(L) { return Math.max(0, L.sisaMenit - berlalu()); }

  function peta(c) {
    var p = {};
    (c.lantai || []).forEach(function (L) { p[L.f] = L; });
    return p;
  }
  function statusKini(z, pl, batas) {
    if (z.status !== "belum" && z.status !== "mepet") return z.status;
    var L = pl[z.lantai];
    return L && sisaKini(L) <= batas ? "mepet" : "belum";
  }

  function hitungPerhatian() {
    var c = DB.data && DB.data.cakupan;
    if (!c || !c.zona) return 0;
    var pl = peta(c), batas = Math.max(20, (c.rondeJam || 3) * 60 * 0.2);
    return c.zona.filter(function (z) { return statusKini(z, pl, batas) === "mepet"; }).length;
  }
  DB.hitungPerhatian = hitungPerhatian;

  function render() {
    var w = $("cakupan-isi");
    if (!w) return;
    PC.kosongkan(w);
    var d = DB.data, c = d && d.cakupan;
    if (!c) { w.appendChild(h("div", { class: "panel" }, h("div", { class: "kosong-info", text: "Memuat data cakupan..." }))); return; }
    var jamRonde = c.rondeJam || 3, batas = Math.max(20, jamRonde * 60 * 0.2), pl = peta(c);
    var daftar = (c.zona || []).map(function (z) { return { z: z, s: statusKini(z, pl, batas) }; });
    var n = { ok: 0, belum: 0, mepet: 0, tanpa: 0 };
    daftar.forEach(function (x) { n[x.s]++; });

    w.appendChild(h("div", { class: "pengantar" }, h("b", { text: "Cara membaca: " }),
      "tiap lantai yang punya petugas bertugas wajib dipatroli semua zonanya dalam satu sesi (" + jamRonde + " jam, diatur di Shift & Tugas). " +
      "Saat sesi berganti, status kembali ke \"Belum\". \"Segera\" berarti sisa waktu sesi tinggal sedikit. Lantai tanpa petugas bertugas tidak dihitung."));

    var sel = function (angka, ket, kls) {
      return h("div", { class: kls || "" }, h("div", { class: "angka" }, angka), h("div", { class: "ket", text: ket }));
    };
    w.appendChild(h("div", { class: "ringkas ringkas-zona" },
      sel(String((c.lantai || []).length), "Lantai bertugas"),
      sel(String(n.ok), "Sudah sesi ini", "buka"),
      sel(String(n.belum), "Belum sesi ini", "kuning"),
      sel(String(n.mepet), "Segera didatangi", n.mepet ? "bad" : "")));

    var btn = h("button", { type: "button", class: "btn btn-pilih", "aria-pressed": S.hanyaMasalah ? "true" : "false", text: "Hanya yang belum",
      onclick: function () { S.hanyaMasalah = !S.hanyaMasalah; render(); } });
    w.appendChild(h("div", { class: "tools tools-lepas" },
      h("span", { class: "oleh", text: "Diperbarui " + PC.fmtWIB(new Date(d.waktu)).jam + " WIB" }),
      h("div", { class: "rapat" }, btn,
        h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Muat ulang", onclick: function () { if (DB.muatUlang) DB.muatUlang(); } }))));

    var lantaiAktif = (c.lantai || []).slice().sort(function (a, b) {
      var ma = daftar.filter(function (x) { return x.z.lantai === a.f && x.s === "mepet"; }).length;
      var mb = daftar.filter(function (x) { return x.z.lantai === b.f && x.s === "mepet"; }).length;
      return mb - ma || a.f.localeCompare(b.f, "id", { numeric: true });
    });
    if (!lantaiAktif.length) {
      w.appendChild(h("div", { class: "panel" }, h("div", { class: "kosong-info",
        text: "Belum ada petugas yang bertugas saat ini. Petugas mengunci shift dan lantainya di HP, lalu lantai itu muncul di sini." })));
    }
    lantaiAktif.forEach(function (L) {
      var zonaL = daftar.filter(function (x) { return x.z.lantai === L.f; });
      var tampil = zonaL.filter(function (x) { return !S.hanyaMasalah || x.s === "belum" || x.s === "mepet"; });
      if (S.hanyaMasalah && !tampil.length) return;
      tampil.sort(function (a, b) { return URUT[a.s] - URUT[b.s] || a.z.zona.localeCompare(b.z.zona, "id", { numeric: true }); });
      var sudah = zonaL.filter(function (x) { return x.s === "ok"; }).length;
      var persen = zonaL.length ? Math.round(sudah * 100 / zonaL.length) : 0;
      var kepala = h("div", { class: "panel-kepala" }, h("h2", { text: "Lantai " + L.f }),
        h("span", { class: "oleh", text: sudah + " dari " + zonaL.length + " zona" }));
      var info = h("div", { class: "lantai-info" },
        h("span", null, h("b", { text: "Sesi " + L.ronde + "/" + L.totalRonde }), "  " + jamTitik(L.mulai) + "–" + jamTitik(L.selesai)),
        h("span", { text: "Sisa " + teksSisa(sisaKini(L)) }),
        h("span", { text: "Petugas: " + L.petugas.join(", ") }));
      var bar = h("div", { class: "bar-lantai" }, h("i", { style: { width: persen + "%" } }));
      var grid = h("div", { class: "zona-grid" });
      if (!tampil.length) grid.appendChild(h("div", { class: "kosong-info", text: "Semua zona di lantai ini sudah dipatroli pada sesi ini." }));
      tampil.forEach(function (x) {
        grid.appendChild(h("div", { class: "zona-kartu s-" + x.s },
          h("div", { class: "zona-nama", title: x.z.zona, text: x.z.zona }),
          h("div", null, h("span", { class: "lencana " + KLS[x.s], text: LABEL[x.s] })),
          h("div", { class: "oleh", text: teksTerakhir(x.z) }),
          h("div", { class: "oleh", text: "Hari ini: " + x.z.hariIni + " kali" })));
      });
      w.appendChild(h("div", { class: "panel" }, kepala, h("div", { class: "panel-isi" }, info, bar, grid)));
    });

    // Lantai yang tidak ada petugas bertugas: ringkas saja.
    var tanpa = {};
    daftar.forEach(function (x) { if (x.s === "tanpa") tanpa[x.z.lantai] = (tanpa[x.z.lantai] || 0) + 1; });
    var kunciTanpa = Object.keys(tanpa).sort(function (a, b) { return a.localeCompare(b, "id", { numeric: true }); });
    if (kunciTanpa.length) {
      w.appendChild(h("div", { class: "panel" },
        h("div", { class: "panel-kepala" }, h("h2", { text: "Lantai tanpa petugas bertugas" }), h("span", { class: "oleh", text: kunciTanpa.length + " lantai" })),
        h("div", { class: "panel-isi" },
          h("div", { class: "chip-wadah" }, kunciTanpa.map(function (f) { return h("span", { class: "lencana l-abu", text: f + " · " + tanpa[f] + " zona" }); })))));
    }
  }

  function tampil(wadah) {
    S.tampil = true;
    wadah.appendChild(h("div", { id: "cakupan-isi" }));
    render();
    if (DB.muatUlang) DB.muatUlang();
  }
  function tinggalkan() { S.tampil = false; }

  // Menyegarkan tampilan tiap menit agar sisa waktu sesi tidak basi di layar kontrol yang dibiarkan menyala.
  setInterval(function () { if (S.tampil) render(); lencana(); }, 60000);

  function lencana() {
    if (!DB.data || !DB.S.token) return;
    var n = hitungPerhatian();
    DB.badge("cakupan", n || null, n > 0);
  }
  DB.saatData(function () { lencana(); if (S.tampil) render(); });

  DB.daftar({ id: "cakupan", judul: "Cakupan zona", grup: "pantau", izin: "semua", tampil: tampil, tinggalkan: tinggalkan });
})();
