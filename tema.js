/* tema.js - dimuat di <head> agar tema terpasang sebelum halaman digambar (tanpa kedip). */
(function () {
  var t = "";
  try { t = localStorage.getItem("dp_tema") || ""; } catch (e) { /* abaikan */ }
  if (t !== "gelap" && t !== "terang") t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "gelap" : "terang";
  document.documentElement.setAttribute("data-tema", t);
})();
