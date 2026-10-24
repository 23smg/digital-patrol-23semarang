/* versi.js - satu-satunya tempat nomor versi aplikasi.
   Diubah setiap ada pembaruan atau perubahan fitur. Service worker (sw.js) memakai nomor ini sebagai nama cache,
   jadi versi baru otomatis memuat ulang semua berkas di HP petugas, dan nomornya tampil otomatis di halaman. */
self.APP_VERSI = "2.6.0";
self.APP_TANGGAL = "25 Okt 2026";
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  function isi() {
    var el = document.querySelectorAll("[data-versi]");
    for (var i = 0; i < el.length; i++) el[i].textContent = "Versi " + self.APP_VERSI + " \u00b7 " + self.APP_TANGGAL;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", isi); else isi();
})();
