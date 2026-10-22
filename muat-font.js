/* Memuat font tanpa menahan tampilan halaman (stylesheet Google Fonts bersifat render-blocking bila ditaruh di <head>). */
(function () {
  var l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap";
  document.head.appendChild(l);
})();
