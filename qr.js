/* qr.js - halaman QR zona: cetak kode QR per zona. Petugas memindai QR di lokasi, form patroli terbuka dengan zona terpilih.
   QR hanya mempermudah memilih zona. Ia bukan bukti kehadiran (bisa difoto orang lain); keaslian tetap dari GPS dan foto. */
(function () {
  "use strict";
  var DB = window.DB, PC = window.PC, h = PC.h, $ = DB.$;
  var KUNCI = "dp_qr_dasar";
  var NS = "http://www.w3.org/2000/svg";
  var S = { cari: "" };

  function alamatDasar() {
    try { var t = localStorage.getItem(KUNCI); if (t) return t; } catch (e) { /* abaikan */ }
    try { return new URL("index.html", location.href).href; } catch (e) { return "index.html"; }
  }
  function urlZona(dasar, zona) { return dasar + (dasar.indexOf("?") >= 0 ? "&" : "?") + "zona=" + encodeURIComponent(zona); }

  function gambarQR(teks) {
    var q = window.QRKode.buat(teks), n = q.n, tepi = 4, d = "";
    for (var r = 0; r < n; r++) {
      var c = 0;
      while (c < n) {
        if (!q.gelap(r, c)) { c++; continue; }
        var mulai = c;
        while (c < n && q.gelap(r, c)) c++;
        d += "M" + (mulai + tepi) + " " + (r + tepi) + "h" + (c - mulai) + "v1h-" + (c - mulai) + "z";
      }
    }
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + (n + tepi * 2) + " " + (n + tepi * 2));
    svg.setAttribute("class", "qr-svg");
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("role", "img");
    var bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", n + tepi * 2); bg.setAttribute("height", n + tepi * 2); bg.setAttribute("fill", "#fff");
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", d); p.setAttribute("fill", "#000");
    svg.appendChild(bg); svg.appendChild(p);
    return svg;
  }

  function tampil(wadah) {
    var dasar = alamatDasar();
    wadah.appendChild(h("div", { class: "pengantar qr-alat" }, h("b", { text: "QR zona. " }),
      "Tempel QR di tiap titik patroli. Petugas memindai dengan kamera HP, form patroli terbuka dengan zona sudah terpilih. " +
      "QR hanya mempermudah memilih zona dan bukan bukti kehadiran: keaslian laporan tetap dinilai dari GPS dan foto. " +
      "Laporan yang zonanya dipilih lewat QR diberi catatan \"Zona dipilih lewat QR\"."));
    var inDasar = h("input", { class: "input", type: "url", "aria-label": "Alamat form petugas", spellcheck: "false" });
    inDasar.value = dasar;
    var cari = h("input", { class: "input", type: "search", placeholder: "Cari zona", "aria-label": "Cari zona" });
    cari.value = S.cari;
    var grid = h("div", { class: "qr-grid", id: "qr-cetak" });
    var hitung = h("span");
    function zonaAktif() { return (DB.data && DB.data.master && DB.data.master.zona) || []; }
    function kunci(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
    function isi() {
      PC.kosongkan(grid);
      if (!DB.data) { grid.appendChild(h("div", { class: "kosong-info", text: "Memuat daftar zona..." })); return; }
      var q = kunci(S.cari);
      var daftar = zonaAktif().filter(function (z) { return !q || kunci(z).indexOf(q) >= 0; });
      hitung.textContent = daftar.length + " zona";
      if (!daftar.length) { grid.appendChild(h("div", { class: "kosong-info", text: zonaAktif().length ? "Tidak ada zona yang cocok." : "Belum ada zona aktif. Tambahkan di menu Zona." })); return; }
      var dasarKini = inDasar.value.trim() || dasar;
      daftar.forEach(function (z) {
        grid.appendChild(h("figure", { class: "qr-kartu" }, gambarQR(urlZona(dasarKini, z)),
          h("figcaption", null, h("b", { text: z }), h("span", { text: "Pindai untuk mulai patroli" }))));
      });
    }
    inDasar.addEventListener("change", function () {
      try { localStorage.setItem(KUNCI, inDasar.value.trim()); } catch (e) { /* abaikan */ }
      isi();
    });
    cari.addEventListener("input", function () { S.cari = cari.value; isi(); });
    function cetak() {
      document.body.classList.add("cetak-qr");
      var bersih = function () { document.body.classList.remove("cetak-qr"); window.removeEventListener("afterprint", bersih); };
      window.addEventListener("afterprint", bersih);
      window.print();
      setTimeout(bersih, 1500);
    }
    wadah.appendChild(h("div", { class: "panel qr-alat" },
      h("div", { class: "panel-kepala" }, h("h2", { text: "Pengaturan cetak" }), h("span", { class: "oleh" }, hitung)),
      h("div", { class: "panel-isi" },
        h("div", { class: "medan" }, h("label", { text: "Alamat form petugas" }), inDasar,
          h("p", { class: "bantuan", text: "Dibuat otomatis dari alamat dashboard ini. Ubah hanya jika form petugas ada di alamat lain." })),
        h("div", { class: "grup" }, cari, h("button", { type: "button", class: "btn btn-utama", text: "Cetak QR", onclick: cetak })))));
    wadah.appendChild(grid);
    isi();
    DB.qrSegar = isi;
  }
  function tinggalkan() { DB.qrSegar = null; }
  DB.saatData(function () { if (DB.qrSegar) DB.qrSegar(); });
  DB.daftar({ id: "qr", judul: "QR zona", grup: "data", izin: "editor", tampil: tampil, tinggalkan: tinggalkan });
})();
