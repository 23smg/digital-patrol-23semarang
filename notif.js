/* notif.js - lonceng notifikasi di dashboard admin. Satu-satunya tempat peringatan: tidak ada email atau Telegram.
   Daftar dihitung di browser dari data pantauan (temuan tinggi, zona terlambat, laporan di luar area).
   Status "sudah dibaca" disimpan di perangkat ini saja. */
(function () {
  "use strict";
  var DB = window.DB, PC = window.PC, h = PC.h, $ = DB.$;
  var KUNCI = "dp_notif_baca";
  var daftar = [], sudahToast = {}, awal = true;

  function baca() { try { return JSON.parse(localStorage.getItem(KUNCI)) || {}; } catch (e) { return {}; } }
  function simpan(o) { try { localStorage.setItem(KUNCI, JSON.stringify(o)); } catch (e) { /* abaikan */ } }

  function turunkan(d) {
    var out = [];
    var st = function (x) { var t = d.tindak[x.id]; return t && t.status ? t.status : "BARU"; };
    ["patroli", "tenant"].forEach(function (j) {
      (d.terbuka[j] || []).forEach(function (x) {
        if (x.tingkat !== "Tinggi" || !x.id || st(x) === "SELESAI") return;
        out.push({ key: "t|" + x.id, jenis: "bad", tautan: "laporan",
          judul: "Temuan tingkat tinggi: " + (x.zona || x.tenant),
          rincian: (x.catatan || x.ringkasan || "").slice(0, 110) + (x.ts ? " (" + x.ts + ")" : "") });
      });
    });
    var c = d.cakupan;
    if (c && c.jamAktif && DB.hitungPerhatian) {
      var belum = 0, telat = 0;
      c.zona.forEach(function (z) { if (z.status === "belum") belum++; });
      var perlu = DB.hitungPerhatian();
      telat = Math.max(0, perlu - belum);
      if (perlu) {
        var jam = PC.fmtWIB(new Date()).jam.slice(0, 2);
        out.push({ key: "z|" + d.hariIni + "|" + jam, jenis: "warn", tautan: "cakupan",
          judul: perlu + " zona perlu dipatroli",
          rincian: (belum ? belum + " belum dipatroli" : "") + (belum && telat ? ", " : "") + (telat ? telat + " terlambat" : "") + " (target tiap " + c.interval + " menit)" });
      }
    }
    var luar = (d.patroli || []).concat(d.tenant || []).filter(function (x) {
      return x.tgl === d.hariIni && /DI_LUAR_AREA/.test(x.flag || "");
    }).slice(0, 5);
    luar.forEach(function (x) {
      out.push({ key: "g|" + (x.id || x.ts), jenis: "warn", tautan: "laporan",
        judul: "Laporan di luar area mall: " + (x.zona || x.tenant), rincian: (x.nama || x.petugas || "") + ", " + x.ts });
    });
    out.sort(function (a, b) { return (a.jenis === "bad" ? 0 : 1) - (b.jenis === "bad" ? 0 : 1); });
    return out;
  }

  function perbarui(d) {
    if (!d) return;
    daftar = turunkan(d);
    var baca0 = baca(), aktifKey = {}, tulis = {};
    daftar.forEach(function (x) { aktifKey[x.key] = 1; if (baca0[x.key]) tulis[x.key] = baca0[x.key]; });
    simpan(tulis);          // buang catatan baca untuk notifikasi yang sudah tidak berlaku
    var belumBaca = daftar.filter(function (x) { return !tulis[x.key]; });
    var n = $("notif-n");
    n.hidden = !belumBaca.length;
    n.textContent = belumBaca.length > 99 ? "99+" : String(belumBaca.length);
    $("btn-notif").setAttribute("aria-label", belumBaca.length ? "Notifikasi, " + belumBaca.length + " belum dibaca" : "Notifikasi");
    $("btn-notif").classList.toggle("ada", belumBaca.length > 0);
    // Pemberitahuan singkat untuk peringatan baru (kecuali temuan, yang sudah punya toast di laporan.js).
    belumBaca.forEach(function (x) {
      if (!awal && !sudahToast[x.key] && x.key.charAt(0) !== "t") PC.toast(x.judul, "bad");
      sudahToast[x.key] = 1;
    });
    awal = false;
    if (!$("panel-notif").hidden) isiPanel();
  }

  function isiPanel() {
    var p = $("panel-notif"), b = baca();
    PC.kosongkan(p);
    var belum = daftar.filter(function (x) { return !b[x.key]; }).length;
    p.appendChild(h("div", { class: "notif-kepala" }, h("b", { text: "Notifikasi" }),
      h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Tandai semua dibaca", disabled: !belum,
        onclick: function () { var o = baca(); daftar.forEach(function (x) { o[x.key] = Date.now(); }); simpan(o); perbarui(DB.data); isiPanel(); } })));
    if (!daftar.length) { p.appendChild(h("div", { class: "kosong-info", text: "Tidak ada peringatan saat ini." })); return; }
    var ul = h("ul", { class: "notif-daftar" });
    daftar.forEach(function (x) {
      ul.appendChild(h("li", null, h("button", { type: "button", class: "notif-item " + x.jenis + (b[x.key] ? " dibaca" : ""),
        onclick: function () {
          var o = baca(); o[x.key] = Date.now(); simpan(o); tutup(); perbarui(DB.data); DB.buka(x.tautan);
        } },
        h("span", { class: "notif-titik", "aria-hidden": "true" }),
        h("span", { class: "notif-teks" }, h("b", { text: x.judul }), h("span", { text: x.rincian })))));
    });
    p.appendChild(ul);
  }

  function buka() { isiPanel(); $("panel-notif").hidden = false; $("btn-notif").setAttribute("aria-expanded", "true"); }
  function tutup() { $("panel-notif").hidden = true; $("btn-notif").setAttribute("aria-expanded", "false"); }
  $("btn-notif").addEventListener("click", function (e) { e.stopPropagation(); if ($("panel-notif").hidden) buka(); else tutup(); });
  document.addEventListener("click", function (e) { if (!$("notif").contains(e.target)) tutup(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") tutup(); });

  DB.saatData(perbarui);
  var sebelum = DB.setelahKeluar;
  DB.setelahKeluar = function () {
    if (sebelum) sebelum();
    daftar = []; sudahToast = {}; awal = true;
    $("notif-n").hidden = true; tutup();
  };
})();
