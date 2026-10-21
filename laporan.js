/* laporan.js - halaman Laporan: ringkasan, tindak lanjut temuan, log patroli, log tenant, rekap tenant hari ini. */
(function () {
  "use strict";
  var DB = window.DB, PC = window.PC, h = PC.h, $ = DB.$;
  var PER_HALAMAN = 15;

  var S = {
    hariIni: "", patroli: [], tenant: [], master: { tenant: [], zona: [], petugas: 0 },
    tab: "patroli", hanyaTemuan: false, halaman: 1, sudahMuat: false, terlihat: {},
    timer: null, memuat: false, tindak: {}, terbuka: { patroli: [], tenant: [] },
    tlSemua: false, rincianAktif: null, aksiStatus: null, dari: "", sampai: "", cari: "", rentang: "hari", otoDetik: 30, tampil: false
  };
  var STATUS_LABEL = { BARU: "Baru", DITANGANI: "Diproses", SELESAI: "Selesai" };
  var STATUS_KLS = { BARU: "l-baru", DITANGANI: "l-proses", SELESAI: "l-ok" };
  var RANK_TINGKAT = { Tinggi: 0, Sedang: 1, Rendah: 2 };
  var RANK_STATUS = { BARU: 0, DITANGANI: 1 };
  var LABEL_FLAG = {
    WAKTU_TIDAK_SINKRON: "Jam foto tidak sinkron dengan server",
    DI_LUAR_AREA: "Di luar area mall",
    GPS_TIDAK_ADA: "Tanpa GPS",
    AKURASI_RENDAH: "GPS kurang akurat",
    FOTO_DARI_BERKAS: "Foto bukan dari kamera langsung",
    KIRIM_TERTUNDA: "Dikirim setelah offline",
    JAM_PERANGKAT: "Jam dari perangkat",
    ULANG_HARI_INI: "Laporan ulang hari ini",
    ZONA_QR: "Zona dipilih lewat QR di lokasi",
    ZONA_MANUAL: "Zona dipilih manual dari daftar (tanpa scan QR)",
    ISI_TERLALU_CEPAT: "Checklist diisi sangat cepat, periksa kemungkinan asal tandai"
  };
  var FLAG_PENTING = { WAKTU_TIDAK_SINKRON: 1, DI_LUAR_AREA: 1, FOTO_DARI_BERKAS: 1 };

  /* ---------------------------------------------------------- util */
  function tglWIB() { return PC.fmtWIB(new Date()).tgl.split("/").reverse().join("-"); }
  function geserHari(tgl, n) {
    var p = tgl.split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + d.getUTCDate()).slice(-2);
  }
  function isTemuan(x) { return /temuan/i.test(x.kondisi || x.hasil || ""); }
  // Foto bersifat privat di Drive: hanya ID yang dipakai, gambar dimuat lewat server dengan token sesi.
  function fotoList(s) {
    return String(s || "").split("|").map(function (u) { return u.trim(); }).map(function (u) {
      var m = u.match(/\/d\/([A-Za-z0-9_-]+)/) || u.match(/[?&]id=([A-Za-z0-9_-]+)/);
      return m ? { id: m[1] } : null;
    }).filter(Boolean);
  }
  var FOTO = { cache: {}, janji: {}, antre: { thumb: [], besar: [] }, timer: null, aktif: 0, MAKS_SERENTAK: 2, GRUP: 6 };
  function ambilFotoPrivat(id, ukuran) {
    var k = ukuran + ":" + id;
    if (FOTO.cache[k]) return Promise.resolve(FOTO.cache[k]);
    if (FOTO.janji[k]) return FOTO.janji[k];
    var p = new Promise(function (ok) { FOTO.antre[ukuran].push({ id: id, ok: ok, k: k }); });
    FOTO.janji[k] = p;
    if (!FOTO.timer) FOTO.timer = setTimeout(function () { FOTO.timer = null; jalankanFoto(); }, 40);
    return p;
  }
  function jalankanFoto() {
    ["thumb", "besar"].forEach(function (u) {
      while (FOTO.antre[u].length && FOTO.aktif < FOTO.MAKS_SERENTAK) {
        kirimGrupFoto(u, FOTO.antre[u].splice(0, FOTO.GRUP));
      }
    });
  }
  function kirimGrupFoto(ukuran, grup) {
    FOTO.aktif++;
    DB.panggil("ambilFoto", { ids: grup.map(function (g) { return g.id; }), ukuran: ukuran }, 90000).then(function (r) {
      grup.forEach(function (g) {
        var d = r && r.status === "SUCCESS" && r.foto ? r.foto[g.id] : null;
        if (d) FOTO.cache[g.k] = d;
        delete FOTO.janji[g.k];
        g.ok(d || "");
      });
    }).catch(function () {
      grup.forEach(function (g) { delete FOTO.janji[g.k]; g.ok(""); });
    }).then(function () { FOTO.aktif--; jalankanFoto(); });
  }
  // Pasang gambar ke <img>; dimuat saat mulai terlihat supaya satu halaman tabel tidak memuat semuanya sekaligus.
  function pasangFoto(img, id, ukuran) {
    img.classList.add("memuat");
    function muat() {
      ambilFotoPrivat(id, ukuran).then(function (d) {
        if (d) { img.src = d; img.classList.remove("memuat"); }
        else { img.classList.remove("memuat"); img.classList.add("gagal"); img.alt = "Foto tidak tersedia"; }
      });
    }
    if (!("IntersectionObserver" in window)) { muat(); return img; }
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); muat(); }
    }, { rootMargin: "120px" });
    io.observe(img);
    return img;
  }
  function flags(s) { return String(s || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); }
  function lencana(teks, kls) { return h("span", { class: "lencana " + kls, text: teks }); }
  function lencanaTingkat(t) {
    if (!t || t === "-") return h("span", { class: "oleh", text: "-" });
    return lencana(t, { Tinggi: "l-tinggi", Sedang: "l-sedang", Rendah: "l-rendah" }[t] || "l-abu");
  }
  function lencanaFlag(arr) {
    var penting = arr.filter(function (f) { return FLAG_PENTING[f]; });
    if (!arr.length) return h("span", { class: "oleh", text: "-" });
    return h("span", { class: "lencana " + (penting.length ? "l-warn" : "l-abu"),
      title: arr.map(function (f) { return LABEL_FLAG[f] || f; }).join("\n"), text: arr.length + " catatan" });
  }
  function peta(lat, lng) {
    var a = parseFloat(lat), b = parseFloat(lng);
    return isFinite(a) && isFinite(b) ? "https://www.google.com/maps?q=" + a + "," + b : "";
  }
  function epoch(ts) {
    var m = String(ts || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] - 7, +m[5], +m[6]) : 0;
  }
  function umur(ts) {
    var e = epoch(ts);
    if (!e) return "-";
    var d = Math.max(0, Math.round((Date.now() - e) / 1000));
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + " menit lalu";
    if (d < 86400) return Math.floor(d / 3600) + " jam lalu";
    return Math.floor(d / 86400) + " hari lalu";
  }
  function statusTL(x) {
    if (!x.id) return "";
    var t = S.tindak[x.id];
    return t && t.status ? t.status : "BARU";
  }
  function bisaUbah() { return !!(DB.S.user && DB.S.user.bisaUbah); }
  function lencanaStatus(st) { return lencana(STATUS_LABEL[st], STATUS_KLS[st]); }
  function semuaTerbuka() {
    var a = (S.terbuka.patroli || []).map(function (x) { return { x: x, jenis: "patroli" }; })
      .concat((S.terbuka.tenant || []).map(function (x) { return { x: x, jenis: "tenant" }; }));
    return a.filter(function (o) { return statusTL(o.x) && statusTL(o.x) !== "SELESAI"; })
      .sort(function (p, q) {
        var rp = RANK_TINGKAT[p.x.tingkat] === undefined ? 3 : RANK_TINGKAT[p.x.tingkat];
        var rq = RANK_TINGKAT[q.x.tingkat] === undefined ? 3 : RANK_TINGKAT[q.x.tingkat];
        return rp - rq || RANK_STATUS[statusTL(p.x)] - RANK_STATUS[statusTL(q.x)] || epoch(q.x.ts) - epoch(p.x.ts);
      });
  }
  function dalamRentang(x) { return x.tgl >= S.dari && x.tgl <= S.sampai; }
  function cocokCari(vals) {
    var q = S.cari.toLowerCase().trim();
    return !q || vals.join(" ").toLowerCase().indexOf(q) >= 0;
  }
  function dataPatroli() {
    return S.patroli.filter(function (x) {
      return dalamRentang(x) && (!S.hanyaTemuan || isTemuan(x)) && cocokCari([x.nama, x.zona, x.kondisi, x.catatan, x.tingkat, x.flag]);
    });
  }
  function dataTenant() {
    return S.tenant.filter(function (x) {
      return dalamRentang(x) && (!S.hanyaTemuan || isTemuan(x)) &&
        cocokCari([x.tenant, x.petugas, x.kategori, x.hasil, x.ringkasan, x.catatan, x.tingkat, x.flag]);
    });
  }

  function kunciBaris(x) { return x.id || (x.ts + "|" + (x.nama || x.petugas) + "|" + (x.zona || x.tenant)); }
  function deteksiBaru(semua) {
    var baru = [];
    semua.forEach(function (x) {
      var k = kunciBaris(x);
      if (!S.terlihat[k]) { S.terlihat[k] = 1; if (S.sudahMuat && isTemuan(x)) baru.push(x); }
    });
    S.sudahMuat = true;
    if (baru.length) {
      var x = baru[0];
      PC.toast("Temuan baru: " + (x.zona || x.tenant) + (x.tingkat && x.tingkat !== "-" ? " (" + x.tingkat + ")" : ""), "bad");
    }
  }

  /* ---------------------------------------------------------- data */
  function setRentang(jenis) {
    var hari = tglWIB(), awal = hari;
    if (jenis === "7") awal = geserHari(hari, -6);
    else if (jenis === "90") awal = geserHari(hari, -89);
    else if (jenis === "bulan") awal = hari.slice(0, 8) + "01";
    S.rentang = jenis; S.dari = awal; S.sampai = hari;
  }

  function muatData(latar) {
    if (S.memuat || !DB.S.token) return;
    S.memuat = true;
    var st = $("status-muat");
    if (!latar && st) st.textContent = "Memuat...";
    var hari = tglWIB();
    var dari = S.dari < hari ? S.dari : hari;
    var sampai = S.sampai > hari ? S.sampai : hari;
    DB.panggil("ambilData", { dari: dari, sampai: sampai }, 60000).then(function (r) {
      var st2 = $("status-muat");
      if (r.status !== "SUCCESS") { if (st2 && r.kode !== "SESI") st2.textContent = r.message || "Gagal memuat."; return; }
      S.hariIni = r.hariIni; S.patroli = r.patroli; S.tenant = r.tenant; S.master = r.master;
      S.tindak = r.tindak || {}; S.terbuka = r.terbuka || { patroli: [], tenant: [] };
      S.tren = r.tren || [];
      DB.data = { hariIni: r.hariIni, cakupan: r.cakupan, tren: r.tren || [], pengaturan: r.pengaturan, terbuka: S.terbuka,
        tindak: S.tindak, patroli: r.patroli, tenant: r.tenant, master: r.master, waktu: Date.now() };
      if (r.user) { DB.S.user = r.user; DB.simpanSesi(); }
      deteksiBaru(r.patroli.concat(r.tenant));
      DB.info("Diperbarui " + PC.fmtWIB(new Date()).jam + " WIB");
      var buka = semuaTerbuka();
      DB.badge("laporan", buka.length || null, buka.length > 0);
      DB.umumkanData();
      if (S.tampil) render();
    }).then(function () { S.memuat = false; if (S.tampil && $("status-muat")) $("status-muat").textContent = ""; });
  }

  function atur() {
    clearInterval(S.timer);
    if (S.otoDetik > 0) S.timer = setInterval(function () { muatData(true); }, S.otoDetik * 1000);
    muatData(false);
  }

  /* ---------------------------------------------------------- kerangka halaman */
  function tampil(wadah) {
    S.tampil = true;
    if (!S.dari) setRentang("hari");
    function rentangBtn(id, teks) {
      return h("button", { type: "button", class: "btn btn-pilih", "data-rentang": id, text: teks,
        "aria-pressed": S.rentang === id ? "true" : "false",
        onclick: function () { setRentang(id); $("dari").value = S.dari; $("sampai").value = S.sampai; segarRentang(); S.halaman = 1; muatData(false); } });
    }
    function segarRentang() {
      Array.prototype.forEach.call(document.querySelectorAll("[data-rentang]"), function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-rentang") === S.rentang ? "true" : "false");
      });
    }
    var inDari = h("input", { id: "dari", type: "date", class: "input" });
    var inSampai = h("input", { id: "sampai", type: "date", class: "input" });
    inDari.value = S.dari; inSampai.value = S.sampai;
    [inDari, inSampai].forEach(function (el) {
      el.addEventListener("change", function () {
        S.dari = inDari.value || S.dari; S.sampai = inSampai.value || S.sampai; S.rentang = "";
        segarRentang(); S.halaman = 1; muatData(false);
      });
    });
    var cari = h("input", { id: "cari", type: "search", class: "input", placeholder: "Nama, zona, tenant, temuan", style: { width: "100%" } });
    cari.value = S.cari;
    cari.addEventListener("input", function () { S.cari = cari.value; S.halaman = 1; render(); });
    var oto = h("select", { id: "oto", class: "input", "aria-label": "Muat ulang otomatis" },
      [["0", "Manual"], ["15", "15 detik"], ["30", "30 detik"], ["60", "1 menit"], ["300", "5 menit"]].map(function (p) {
        return h("option", { value: p[0], text: p[1], selected: String(S.otoDetik) === p[0] });
      }));
    oto.addEventListener("change", function () { S.otoDetik = parseInt(oto.value, 10) || 0; atur(); });

    var btnTemuan = h("button", { type: "button", class: "btn btn-pilih bahaya", id: "btn-temuan", text: "Hanya temuan",
      "aria-pressed": S.hanyaTemuan ? "true" : "false",
      onclick: function () { S.hanyaTemuan = !S.hanyaTemuan; btnTemuan.setAttribute("aria-pressed", S.hanyaTemuan ? "true" : "false"); S.halaman = 1; render(); } });
    wadah.appendChild(h("div", { class: "filter" },
      h("div", { class: "grup" }, h("div", null, h("label", { for: "dari", text: "Dari" }), inDari), h("div", null, h("label", { for: "sampai", text: "Sampai" }), inSampai)),
      h("div", { class: "grup" }, rentangBtn("hari", "Hari ini"), rentangBtn("7", "7 hari"), rentangBtn("bulan", "Bulan ini"), rentangBtn("90", "90 hari")),
      h("div", { style: { flex: "1", minWidth: "200px", maxWidth: "340px" } }, h("label", { for: "cari", text: "Cari" }), cari),
      h("div", null, h("label", { for: "oto", text: "Muat ulang" }), oto),
      h("div", { class: "grup" }, btnTemuan,
        h("button", { type: "button", class: "btn btn-utama btn-pilih", id: "btn-segarkan", text: "Muat ulang", onclick: function () { muatData(false); } })),
      h("span", { class: "status-muat", id: "status-muat" })));
    wadah.appendChild(h("div", { class: "ringkas", id: "ringkas" }));
    wadah.appendChild(h("section", { class: "panel tl", id: "tl", "aria-labelledby": "tl-judul" }));
    wadah.appendChild(h("section", { class: "panel" }, h("h2", { text: "Tren 14 hari terakhir" }), h("div", { class: "panel-isi", id: "tren" })));
    wadah.appendChild(h("div", { class: "dua-kolom" },
      h("div", { class: "panel" }, h("h2", { text: "Sesuai dan temuan" }), h("div", { class: "panel-isi", id: "donat" })),
      h("div", { class: "panel" }, h("h2", { text: "Lokasi dengan temuan terbanyak" }), h("div", { class: "panel-isi", id: "top" }))));
    function tabBtn(id, teks, n) {
      return h("button", { type: "button", role: "tab", id: "tab-" + id, "data-tab": id, "aria-selected": "false",
        onclick: function () { S.tab = id; S.halaman = 1; renderPanel(); } }, teks, n ? h("span", { class: "n", id: n, text: "0" }) : null);
    }
    wadah.appendChild(h("div", { class: "tab", role: "tablist", id: "tab" },
      tabBtn("patroli", "Patroli", "n-patroli"), tabBtn("tenant", "Checklist tenant", "n-tenant"), tabBtn("rekap", "Rekap hari ini")));
    wadah.appendChild(h("div", { class: "tabel-wrap", id: "panel" }));

    if (S.hariIni) render();
    atur();
  }

  // Pemuatan data jalan terus di latar selama sesi (untuk lonceng notifikasi dan halaman Cakupan).
  DB.saatMulaiApp = function () { if (!S.dari) setRentang("hari"); atur(); };
  DB.muatUlang = function () { muatData(true); };

  function tinggalkan() {
    S.tampil = false;
    DB.tutupLapisan();
    S.rincianAktif = null;
  }
  DB.setelahKeluar = function () {
    clearInterval(S.timer); S.tampil = false; S.sudahMuat = false; S.terlihat = {};
    S.tren = [];
    S.patroli = []; S.tenant = []; S.tindak = {}; S.terbuka = { patroli: [], tenant: [] }; S.hariIni = "";
    DB.lencana = {};
  };

  /* ---------------------------------------------------------- render */
  function render() {
    if (!$("ringkas")) return;
    renderRingkas();
    renderTL();
    renderTren();
    renderGrafik();
    renderPanel();
  }

  function renderRingkas() {
    var p = dataPatroli(), t = dataTenant();
    var tp = p.filter(isTemuan).length, tt = t.filter(isTemuan).length;
    var total = S.master.tenant.filter(function (x) { return x.aktif !== false; }).length || S.master.tenant.length;
    function hariIni(kat) {
      var set = {};
      S.tenant.forEach(function (x) { if (x.tgl === S.hariIni && x.kategori === kat) set[x.tenant] = 1; });
      return Object.keys(set).length;
    }
    var buka = hariIni("BUKA"), tutup = hariIni("TUTUP");
    function sel(angka, ket, kls, persen) {
      return h("div", { class: kls || "" },
        h("div", { class: "angka" }, angka),
        h("div", { class: "ket", text: ket }),
        persen === undefined ? null : h("div", { class: "bar-mini " + (kls || "") }, h("i", { style: { width: Math.min(100, persen) + "%" } })));
    }
    var w = $("ringkas");
    PC.kosongkan(w);
    w.appendChild(sel(String(p.length), "Total laporan patroli"));
    var terbuka = semuaTerbuka();
    var tinggi = terbuka.filter(function (o) { return o.x.tingkat === "Tinggi"; }).length;
    w.appendChild(sel(String(terbuka.length), "Temuan belum selesai" + (tinggi ? " (" + tinggi + " tinggi)" : ""), terbuka.length ? "bad" : ""));
    w.appendChild(sel([String(buka), h("small", { text: " / " + total })], "Tenant buka hari ini", "buka", total ? Math.round(buka * 100 / total) : 0));
    w.appendChild(sel([String(tutup), h("small", { text: " / " + total })], "Tenant tutup hari ini", "", total ? Math.round(tutup * 100 / total) : 0));
    var np = $("n-patroli"), nt = $("n-tenant");
    if (np) { np.textContent = p.length; np.className = "n" + (tp ? " bad" : ""); }
    if (nt) { nt.textContent = t.length; nt.className = "n" + (tt ? " bad" : ""); }
  }

  function kontrolStatus(x, jenis) {
    if (!bisaUbah() || !x.id) return null;
    var st = statusTL(x);
    function tombol(label, baru, kls) {
      return h("button", { type: "button", class: "btn btn-kecil " + (kls || ""), text: label,
        onclick: function (e) { e.stopPropagation(); bukaStatus(x, jenis, baru); } });
    }
    if (st === "BARU") return [tombol("Proses", "DITANGANI"), tombol("Selesai", "SELESAI", "btn-utama")];
    if (st === "DITANGANI") return [tombol("Selesai", "SELESAI", "btn-utama")];
    return [tombol("Buka kembali", "BARU")];
  }

  function barisTL(o) {
    var x = o.x, jenis = o.jenis, st = statusTL(x);
    var lokasi = jenis === "patroli" ? x.zona : x.tenant;
    var judul = jenis === "patroli" ? "Patroli" : "Tenant " + String(x.kategori || "").toLowerCase();
    var oleh = jenis === "patroli" ? x.nama : x.petugas;
    var ringkas = jenis === "patroli" ? x.catatan : x.ringkasan;
    return h("div", { class: "tl-baris", tabindex: "0", onclick: function () { rincian(x, jenis); },
        onkeydown: function (e) { if (e.key === "Enter" && e.target === e.currentTarget) rincian(x, jenis); } },
      h("div", null, lencanaTingkat(x.tingkat)),
      h("div", null, h("div", { class: "tl-lokasi", text: lokasi }), h("div", { class: "oleh", text: judul + ", " + oleh })),
      h("div", { class: "tl-ringkas", title: ringkas, text: ringkas }),
      h("div", { class: "oleh", text: umur(x.ts) }),
      h("div", null, lencanaStatus(st)),
      h("div", { class: "tl-aksi" }, kontrolStatus(x, jenis)));
  }

  function renderTL() {
    var w = $("tl");
    PC.kosongkan(w);
    var daftar = semuaTerbuka();
    var tinggi = daftar.filter(function (o) { return o.x.tingkat === "Tinggi"; }).length;
    w.appendChild(h("div", { class: "tl-kepala" },
      h("h2", { id: "tl-judul", text: "Temuan belum selesai" }),
      h("span", { class: "tl-hitung" + (daftar.length ? " bad" : ""),
        text: daftar.length ? daftar.length + " terbuka" + (tinggi ? ", " + tinggi + " tingkat tinggi" : "") : "Semua selesai" }),
      h("span", { class: "oleh", text: "Temuan 30 hari terakhir yang belum ditandai selesai, apa pun filter tanggalnya" })));
    if (!daftar.length) { w.appendChild(h("div", { class: "kosong-info", text: "Tidak ada temuan terbuka." })); return; }
    (S.tlSemua ? daftar : daftar.slice(0, 6)).forEach(function (o) { w.appendChild(barisTL(o)); });
    if (daftar.length > 6) {
      w.appendChild(h("button", { type: "button", class: "btn btn-garis btn-kecil",
        text: S.tlSemua ? "Tampilkan lebih sedikit" : "Lihat semua (" + daftar.length + ")",
        onclick: function () { S.tlSemua = !S.tlSemua; renderTL(); } }));
    }
  }

  /* ---------------------------------------------------------- ubah status temuan */
  var dlgS = $("dlg-status");
  function bukaStatus(x, jenis, baru) {
    S.aksiStatus = { x: x, jenis: jenis, baru: baru };
    $("st-judul").textContent = { DITANGANI: "Tandai sedang diproses", SELESAI: "Tandai selesai", BARU: "Buka kembali temuan" }[baru];
    $("st-info").textContent = (jenis === "patroli" ? x.zona : x.tenant) + ", " + x.ts;
    $("st-label").textContent = baru === "SELESAI" ? "Tindakan yang dilakukan (wajib)"
      : (baru === "DITANGANI" ? "Catatan, misalnya siapa yang memproses (opsional)" : "Alasan dibuka kembali (opsional)");
    $("st-catatan").value = "";
    $("g-status").hidden = true;
    if (dlgS.showModal) dlgS.showModal(); else dlgS.setAttribute("open", "");
    $("st-catatan").focus();
  }
  $("st-batal").addEventListener("click", function () { dlgS.close(); });
  $("form-status").addEventListener("submit", function (e) {
    e.preventDefault();
    var a = S.aksiStatus;
    if (!a) return;
    var cat = $("st-catatan").value.trim(), g = $("g-status"), btn = $("st-simpan");
    if (a.baru === "SELESAI" && cat.length < 3) { g.textContent = "Tuliskan tindakan yang dilakukan."; g.hidden = false; return; }
    btn.disabled = true;
    DB.panggil("ubahStatus", { id: a.x.id, jenis: a.jenis.toUpperCase(), status: a.baru, catatan: cat }, 30000).then(function (r) {
      if (r.status === "SUCCESS") {
        S.tindak[r.tindak.id] = r.tindak;
        dlgS.close();
        PC.toast("Status diperbarui: " + STATUS_LABEL[r.tindak.status] + ".", "ok");
        var buka = semuaTerbuka();
        DB.badge("laporan", buka.length || null, buka.length > 0);
        render();
        if (S.rincianAktif) rincian(S.rincianAktif.x, S.rincianAktif.jenis);
        muatData(true);
      } else if (r.kode !== "SESI") {
        g.textContent = r.message || "Gagal menyimpan status."; g.hidden = false;
      }
    }).then(function () { btn.disabled = false; });
  });

  /* ---------------------------------------------------------- tren harian (SVG polos)
     Batang = jumlah laporan (patroli + tenant), garis = jumlah temuan. Satu sumbu, label seperlunya. */
  var NS = "http://www.w3.org/2000/svg";
  function se(tag, a) {
    var e = document.createElementNS(NS, tag);
    Object.keys(a || {}).forEach(function (k) { e.setAttribute(k, a[k]); });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) e.appendChild(arguments[i]);
    return e;
  }
  function renderTren() {
    var w = $("tren");
    if (!w) return;
    PC.kosongkan(w);
    var d = S.tren || [];
    var total = d.reduce(function (a, x) { return a + x.patroli + x.tenant; }, 0);
    if (!d.length || !total) { w.appendChild(h("div", { class: "kosong-info", text: "Belum ada laporan dalam 14 hari terakhir." })); return; }
    var W = 700, H = 210, L = 34, R = 10, T = 12, B = 28, pw = W - L - R, ph = H - T - B;
    var maks = Math.max.apply(null, d.map(function (x) { return x.patroli + x.tenant; }).concat(d.map(function (x) { return x.temuan; })));
    var langkah = maks <= 5 ? 1 : (maks <= 12 ? 2 : (maks <= 30 ? 5 : (maks <= 80 ? 10 : (maks <= 200 ? 25 : 50))));
    var atas = Math.ceil(maks / langkah) * langkah || 1;
    function y(v) { return T + ph - (v / atas) * ph; }
    var bw = pw / d.length, g = se("g");
    for (var v = 0; v <= atas; v += langkah) {
      g.appendChild(se("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "#E3E8ED", "stroke-width": 1 }));
      var t = se("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "#6C757D" }); t.textContent = String(v);
      g.appendChild(t);
    }
    var pts = [];
    d.forEach(function (x, i) {
      var n = x.patroli + x.tenant, cx = L + bw * i + bw / 2, tinggi = (n / atas) * ph;
      var bar = se("rect", { x: L + bw * i + bw * 0.2, y: T + ph - tinggi, width: bw * 0.6, height: Math.max(tinggi, 0), rx: 3, fill: "#3F6AD8", opacity: 0.85 });
      var tip = se("title"); tip.textContent = x.tgl.split("-").reverse().join("/") + ": " + n + " laporan (" + x.patroli + " patroli, " + x.tenant + " tenant), " + x.temuan + " temuan";
      var kolom = se("g", {}, se("rect", { x: L + bw * i, y: T, width: bw, height: ph, fill: "transparent" }), bar, tip);
      g.appendChild(kolom);
      pts.push([cx, y(x.temuan)]);
      if (i % 2 === (d.length - 1) % 2) {
        var lb = se("text", { x: cx, y: H - 9, "text-anchor": "middle", "font-size": 11, fill: "#6C757D" });
        lb.textContent = x.tgl.slice(8, 10) + "/" + x.tgl.slice(5, 7);
        g.appendChild(lb);
      }
    });
    g.appendChild(se("polyline", { points: pts.map(function (p) { return p.join(","); }).join(" "), fill: "none", stroke: "#D92550", "stroke-width": 2, "stroke-linejoin": "round" }));
    pts.forEach(function (p, i) {
      if (d[i].temuan) g.appendChild(se("circle", { cx: p[0], cy: p[1], r: 4, fill: "#D92550", stroke: "#fff", "stroke-width": 2 }));
    });
    var totalTemuan = d.reduce(function (a, x) { return a + x.temuan; }, 0);
    w.appendChild(h("div", { class: "legenda tren-legenda" },
      h("div", null, h("i", { style: { background: "#3F6AD8", borderRadius: "2px" } }), "Laporan per hari: " + total + " selama 14 hari"),
      h("div", null, h("i", { style: { background: "#D92550", height: "3px", borderRadius: "2px", verticalAlign: "3px" } }), "Temuan per hari: " + totalTemuan)));
    w.appendChild(se("svg", { viewBox: "0 0 " + W + " " + H, class: "tren-svg", role: "img",
      "aria-label": "Grafik tren 14 hari: " + total + " laporan, " + totalTemuan + " temuan. Arahkan kursor ke batang untuk rincian harian." }, g));
  }

  /* ---------------------------------------------------------- grafik */
  function renderGrafik() {
    var semua = dataPatroli().map(function (x) { return { t: isTemuan(x), lok: x.zona }; })
      .concat(dataTenant().map(function (x) { return { t: isTemuan(x), lok: x.tenant }; }));
    var temuan = semua.filter(function (x) { return x.t; }), aman = semua.length - temuan.length;
    var d = $("donat"); PC.kosongkan(d);
    if (!semua.length) d.appendChild(h("div", { class: "kosong-info", text: "Belum ada data pada periode ini." }));
    else {
      var pa = Math.round(aman * 360 / semua.length);
      d.appendChild(h("div", { class: "donat-wrap" },
        h("div", { class: "donat", role: "img", "aria-label": aman + " sesuai, " + temuan.length + " temuan",
          style: { background: "conic-gradient(#3AC47D 0 " + pa + "deg, #D92550 " + pa + "deg 360deg)" } }),
        h("div", { class: "legenda" },
          h("div", null, h("i", { style: { background: "#3AC47D" } }), "Sesuai: " + aman),
          h("div", null, h("i", { style: { background: "#D92550" } }), "Temuan: " + temuan.length))));
    }
    var hitung = {};
    temuan.forEach(function (x) { hitung[x.lok] = (hitung[x.lok] || 0) + 1; });
    var urut = Object.keys(hitung).map(function (k) { return { k: k, n: hitung[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
    var t = $("top"); PC.kosongkan(t);
    if (!urut.length) { t.appendChild(h("div", { class: "kosong-info", text: "Tidak ada temuan pada periode ini." })); return; }
    var maks = urut[0].n;
    urut.forEach(function (u) {
      t.appendChild(h("div", { class: "baris-bar" },
        h("div", { class: "nama", title: u.k, text: u.k }),
        h("div", null, h("div", { class: "batang", style: { width: Math.max(6, Math.round(u.n * 100 / maks)) + "%" } })),
        h("div", { class: "n", text: u.n })));
    });
  }

  /* ---------------------------------------------------------- tabel */
  function celTL(x) {
    var st = isTemuan(x) ? statusTL(x) : "";
    return h("td", null, st ? lencanaStatus(st) : h("span", { class: "oleh", text: "-" }));
  }

  function renderPanel() {
    Array.prototype.forEach.call(document.querySelectorAll("#tab button"), function (b) {
      b.setAttribute("aria-selected", b.getAttribute("data-tab") === S.tab ? "true" : "false");
    });
    var panel = $("panel");
    if (!panel) return;
    PC.kosongkan(panel);
    if (S.tab === "rekap") { panel.appendChild(buatRekap()); return; }
    var baris = S.tab === "patroli" ? dataPatroli() : dataTenant();
    var total = baris.length, halaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
    if (S.halaman > halaman) S.halaman = halaman;
    var mulai = (S.halaman - 1) * PER_HALAMAN, potong = baris.slice(mulai, mulai + PER_HALAMAN);

    panel.appendChild(h("div", { class: "tools" }, h("span", { text: total + " laporan" }),
      h("div", { class: "rapat" }, h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Ekspor CSV", onclick: function () { ekspor(baris); } }))));
    if (!total) { panel.appendChild(h("div", { class: "kosong-tabel", text: "Tidak ada laporan untuk filter ini." })); return; }

    var kolom = S.tab === "patroli"
      ? ["Waktu", "Petugas", "Zona", "Kondisi", "Tingkat", "Tindak lanjut", "Temuan", "Foto", "Catatan sistem"]
      : ["Waktu", "Kategori", "Tenant", "Petugas", "Hasil", "Tingkat", "Tindak lanjut", "Temuan", "Foto", "Catatan sistem"];
    var tbody = h("tbody");
    potong.forEach(function (x) {
      var f = fotoList(x.foto), fl = flags(x.flag);
      var thumb = f.length ? pasangFoto(h("img", { class: "thumb", alt: "Foto " + (x.zona || x.tenant) }), f[0].id, "thumb")
        : h("span", { class: "oleh", text: "-" });
      var sel;
      if (S.tab === "patroli") {
        sel = [h("td", { class: "waktu", text: x.ts }), h("td", { text: x.nama }), h("td", { text: x.zona }),
          h("td", null, lencana(isTemuan(x) ? "Ada temuan" : "Aman", isTemuan(x) ? "l-bad" : "l-ok")),
          h("td", null, lencanaTingkat(x.tingkat)), celTL(x),
          h("td", { class: "ket", title: x.catatan, text: x.catatan }), h("td", null, thumb), h("td", null, lencanaFlag(fl))];
      } else {
        sel = [h("td", { class: "waktu", text: x.ts }),
          h("td", null, lencana(x.kategori, x.kategori === "BUKA" ? "l-buka" : "l-tutup")),
          h("td", { text: x.tenant }), h("td", { text: x.petugas }),
          h("td", null, lencana(isTemuan(x) ? "Ada temuan" : "Sesuai", isTemuan(x) ? "l-bad" : "l-ok")),
          h("td", null, lencanaTingkat(x.tingkat)), celTL(x),
          h("td", { class: "ket", title: x.ringkasan, text: x.ringkasan }), h("td", null, thumb), h("td", null, lencanaFlag(fl))];
      }
      tbody.appendChild(h("tr", { tabindex: "0", onclick: function () { rincian(x, S.tab); },
        onkeydown: function (e) { if (e.key === "Enter") rincian(x, S.tab); } }, sel));
    });
    panel.appendChild(h("table", null, h("thead", null, h("tr", null, kolom.map(function (k) { return h("th", { text: k }); }))), tbody));
    panel.appendChild(h("div", { class: "halaman" },
      h("span", { text: "Menampilkan " + (mulai + 1) + "-" + (mulai + potong.length) + " dari " + total }),
      h("div", { class: "grup", style: { alignItems: "center" } },
        h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Sebelumnya", disabled: S.halaman <= 1, onclick: function () { S.halaman--; renderPanel(); } }),
        h("span", { text: S.halaman + " / " + halaman }),
        h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Berikutnya", disabled: S.halaman >= halaman, onclick: function () { S.halaman++; renderPanel(); } }))));
  }

  function buatRekap() {
    var pt = {};
    S.tenant.forEach(function (x) {
      if (x.tgl !== S.hariIni) return;
      var k = x.tenant + "|" + x.kategori;
      if (!pt[k] || x.ts > pt[k].ts) pt[k] = x;
    });
    function sel(tenant, kat) {
      var x = pt[tenant + "|" + kat];
      if (!x) return h("td", { class: "sel" }, h("span", { class: "belum", text: "Belum dilaporkan" }));
      return h("td", { class: "sel" },
        h("div", null, h("span", { class: "jam", text: String(x.ts).slice(11, 16) }), " ", lencana(isTemuan(x) ? "Temuan" : "Sesuai", isTemuan(x) ? "l-bad" : "l-ok")),
        h("div", { class: "oleh", text: x.petugas }));
    }
    var daftar = S.master.tenant.slice().sort(function (a, b) {
      function skor(t) { return (pt[t.n + "|BUKA"] ? 1 : 0) + (pt[t.n + "|TUTUP"] ? 1 : 0); }
      return skor(a) - skor(b) || a.n.localeCompare(b.n);
    });
    var wadah = h("div");
    wadah.appendChild(h("div", { class: "tools" }, h("span", { text: "Tenant yang belum lengkap tampil paling atas. Data hari ini: " + S.hariIni })));
    if (!daftar.length) {
      wadah.appendChild(h("div", { class: "kosong-tabel", text: "Daftar tenant masih kosong. Isi lewat menu Tenant." }));
      return wadah;
    }
    wadah.appendChild(h("table", { class: "rekap" },
      h("thead", null, h("tr", null, ["Tenant", "Unit", "Buka", "Tutup"].map(function (k) { return h("th", { text: k }); }))),
      h("tbody", null, daftar.map(function (t) {
        return h("tr", null, h("td", { class: "nama", text: t.n }), h("td", { class: "unit", text: t.l || "-" }), sel(t.n, "BUKA"), sel(t.n, "TUTUP"));
      }))));
    return wadah;
  }

  /* ---------------------------------------------------------- rincian */
  function tutupRincian() { S.rincianAktif = null; DB.tutupLapisan(); }

  function rincian(x, jenis) {
    var fl = flags(x.flag), foto = fotoList(x.foto), detail = [];
    try { detail = JSON.parse(x.detail || "[]"); } catch (e) { detail = []; }
    S.rincianAktif = { x: x, jenis: jenis };
    var judul = jenis === "patroli" ? x.zona : (x.kategori + " - " + x.tenant);
    var petugas = jenis === "patroli" ? x.nama : x.petugas;
    var link = peta(x.lat, x.lng);

    var meta = [["Waktu server", x.ts], ["Waktu foto", x.waktuFoto || "-"], ["Petugas", petugas],
      ["Hasil", isTemuan(x) ? "Ada temuan" : "Sesuai"], ["Tingkat", x.tingkat || "-"],
      ["Akurasi GPS", x.akurasi ? "±" + x.akurasi + " m" : "-"], ["ID laporan", x.id || "-"]];
    var dl = h("dl", { class: "meta" });
    meta.forEach(function (m) { dl.appendChild(h("dt", { text: m[0] })); dl.appendChild(h("dd", { text: m[1] })); });

    var cl = h("ul", { class: "cl-hasil" });
    detail.forEach(function (d) {
      var st = d.s === "OK" ? ["Sesuai", "l-ok"] : (d.s === "TEMUAN" ? ["Temuan", "l-bad"] : ["N/A", "l-abu"]);
      cl.appendChild(h("li", null, h("span", { text: d.i }), lencana(st[0], st[1]), d.c ? h("div", { class: "cat", text: d.c }) : null));
    });

    var isi = h("div", { class: "rincian-isi" });
    isi.appendChild(h("h3", { text: "Ringkasan" }));
    isi.appendChild(dl);
    if (isTemuan(x)) {
      isi.appendChild(h("h3", { text: "Tindak lanjut" }));
      var stx = statusTL(x), tl = S.tindak[x.id] || {};
      if (!stx) isi.appendChild(h("div", { class: "oleh", text: "Laporan lama tanpa ID, tidak bisa dilacak." }));
      else {
        isi.appendChild(h("div", { class: "tl-drawer" }, lencanaStatus(stx),
          tl.oleh ? h("span", { class: "oleh", text: tl.oleh + ", " + tl.waktu }) : h("span", { class: "oleh", text: "Belum ada tindakan" })));
        if (tl.catatan) isi.appendChild(h("div", { style: { marginTop: "6px" }, text: tl.catatan }));
        var kk = kontrolStatus(x, jenis);
        if (kk) isi.appendChild(h("div", { class: "tl-aksi", style: { marginTop: "10px", justifyContent: "flex-start" } }, kk));
      }
    }
    if (x.catatan) { isi.appendChild(h("h3", { text: jenis === "patroli" ? "Temuan dan catatan" : "Catatan petugas" })); isi.appendChild(h("div", { text: x.catatan })); }
    if (detail.length) { isi.appendChild(h("h3", { text: "Checklist" })); isi.appendChild(cl); }
    if (fl.length) {
      isi.appendChild(h("h3", { text: "Catatan sistem" }));
      isi.appendChild(h("div", { class: "flags" }, fl.map(function (f) { return lencana(LABEL_FLAG[f] || f, FLAG_PENTING[f] ? "l-warn" : "l-abu"); })));
    }
    isi.appendChild(h("h3", { text: "Foto (" + foto.length + ")" }));
    if (foto.length) {
      isi.appendChild(h("div", { class: "foto-besar" }, foto.map(function (f, i) {
        return h("button", { type: "button", "aria-label": "Perbesar foto " + (i + 1), onclick: function () { lightbox(f); } },
          pasangFoto(h("img", { alt: "Foto " + (i + 1) }), f.id, "thumb"));
      })));
    } else isi.appendChild(h("div", { class: "oleh", text: "Tidak ada foto." }));
    if (link) {
      isi.appendChild(h("h3", { text: "Lokasi" }));
      isi.appendChild(h("a", { class: "btn btn-utama", href: link, target: "_blank", rel: "noopener noreferrer", text: "Buka di Google Maps" }));
    }

    var lap = $("lapisan");
    PC.kosongkan(lap);
    lap.appendChild(h("div", { class: "tirai", onclick: tutupRincian }));
    lap.appendChild(h("aside", { class: "rincian", role: "dialog", "aria-modal": "true", "aria-label": "Detail laporan" },
      h("div", { class: "rincian-kepala" },
        h("div", null, h("h2", { text: judul }), h("div", { class: "sub", text: x.ts })),
        h("button", { type: "button", class: "btn btn-kecil btn-garis-terang", text: "Tutup", onclick: tutupRincian })),
      isi));
  }

  function lightbox(f) {
    var img = h("img", { alt: "Foto diperbesar" });
    var teks = h("div", { class: "lightbox-teks", text: "Memuat foto..." });
    var lb = h("div", { class: "lightbox", role: "dialog", "aria-modal": "true", onclick: function () { lb.remove(); } },
      img, teks,
      h("button", { type: "button", class: "btn btn-kuning", text: "Tutup", onclick: function () { lb.remove(); } }));
    document.body.appendChild(lb);
    ambilFotoPrivat(f.id, "besar").then(function (d) {
      if (!lb.isConnected) return;
      if (d) { img.src = d; teks.hidden = true; } else { teks.textContent = "Foto tidak bisa dimuat."; }
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var lb = document.querySelector(".lightbox");
    if (lb) lb.remove(); else if (S.rincianAktif) tutupRincian();
  });

  /* ---------------------------------------------------------- ekspor */
  function selCsv(v) {
    v = String(v === null || v === undefined ? "" : v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;      // cegah formula injection di Excel
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function ekspor(baris0) {
    var baris = baris0.map(function (x) {
      var t = S.tindak[x.id] || {};
      return Object.assign({}, x, {
        tlStatus: isTemuan(x) && x.id ? STATUS_LABEL[statusTL(x)] : "", tlCatatan: t.catatan || "", tlOleh: t.oleh || "", tlWaktu: t.waktu || ""
      });
    });
    var kolom = S.tab === "patroli"
      ? [["Waktu", "ts"], ["Petugas", "nama"], ["Zona", "zona"], ["Kondisi", "kondisi"], ["Tingkat", "tingkat"],
        ["Temuan", "catatan"], ["Latitude", "lat"], ["Longitude", "lng"], ["Akurasi (m)", "akurasi"], ["Waktu foto", "waktuFoto"],
        ["Catatan sistem", "flag"], ["Status tindak lanjut", "tlStatus"], ["Catatan tindak lanjut", "tlCatatan"],
        ["Diubah oleh", "tlOleh"], ["Diubah pada", "tlWaktu"], ["Tautan foto", "foto"], ["ID", "id"]]
      : [["Waktu", "ts"], ["Kategori", "kategori"], ["Tenant", "tenant"], ["Petugas", "petugas"], ["Hasil", "hasil"],
        ["Tingkat", "tingkat"], ["Temuan", "ringkasan"], ["Catatan", "catatan"], ["Latitude", "lat"], ["Longitude", "lng"],
        ["Akurasi (m)", "akurasi"], ["Waktu foto", "waktuFoto"], ["Catatan sistem", "flag"], ["Status tindak lanjut", "tlStatus"],
        ["Catatan tindak lanjut", "tlCatatan"], ["Diubah oleh", "tlOleh"], ["Diubah pada", "tlWaktu"], ["Tautan foto", "foto"], ["ID", "id"]];
    var csv = [kolom.map(function (k) { return selCsv(k[0]); }).join(",")]
      .concat(baris.map(function (x) { return kolom.map(function (k) { return selCsv(x[k[1]]); }).join(","); })).join("\r\n");
    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    var a = h("a", { href: URL.createObjectURL(blob), download: "log-" + S.tab + "-" + S.dari + "_" + S.sampai + ".csv" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  DB.daftar({ id: "laporan", judul: "Laporan", grup: "pantau", izin: "semua", tampil: tampil, tinggalkan: tinggalkan });
})();
