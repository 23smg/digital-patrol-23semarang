/* dashboard.js - kerangka dashboard admin: sesi, menu, dialog form serbaguna, ganti password.
   Halaman-halamannya didaftarkan oleh laporan.js dan kelola.js lewat DB.daftar(). */
(function () {
  "use strict";
  var PC = window.PC, h = PC.h;
  var $ = function (id) { return document.getElementById(id); };
  var KUNCI_SESI = "dp_admin_sesi";

  var DB = window.DB = {
    S: { token: "", user: null },
    views: {}, urutan: [], aktif: null, lencana: {},
    data: null, pendengar: [],
    $: $
  };

  // Data pantauan terbaru (diisi laporan.js tiap muat). Halaman lain dan lonceng notifikasi berlangganan di sini.
  DB.saatData = function (fn) { DB.pendengar.push(fn); };
  DB.umumkanData = function () {
    DB.pendengar.forEach(function (fn) { try { fn(DB.data); } catch (e) { console.error(e); } });
  };

  /* ------------------------------------------------------------ util dipakai halaman */
  DB.izin = function (v) {
    var u = DB.S.user;
    if (!u) return false;
    if (v.izin === "penuh") return !!u.penuh;
    if (v.izin === "editor") return !!u.bisaUbah;
    return true;
  };

  DB.daftar = function (v) { DB.views[v.id] = v; DB.urutan.push(v.id); };
  DB.info = function (teks) { $("atas-info").textContent = teks || ""; };

  // Semua panggilan admin lewat sini: token ditambahkan, sesi habis ditangani sekali di satu tempat,
  // galat jaringan dikembalikan sebagai objek biasa supaya halaman cukup memeriksa r.status.
  DB.panggil = function (aksi, data, ms) {
    return PC.api(aksi, Object.assign({ token: DB.S.token }, data || {}), ms || 40000).then(function (r) {
      if (r && r.status !== "SUCCESS" && r.kode === "SESI") { DB.keluar(r.message); }
      return r;
    }, function () {
      return { status: "ERROR", message: "Tidak dapat terhubung ke server. Periksa sinyal lalu coba lagi.", jaringan: true };
    });
  };

  /* ------------------------------------------------------------ sesi */
  function simpanSesi() { try { sessionStorage.setItem(KUNCI_SESI, JSON.stringify({ token: DB.S.token, user: DB.S.user })); } catch (e) { /* abaikan */ } }
  function hapusSesi() { try { sessionStorage.removeItem(KUNCI_SESI); } catch (e) { /* abaikan */ } }

  DB.keluar = function (pesan, panggilServer) {
    var t = DB.S.token;
    hapusSesi();
    if (panggilServer && t) PC.api("logout", { token: t }, 8000).catch(function () { /* abaikan */ });
    DB.S.token = ""; DB.S.user = null; DB.data = null;
    if (DB.aktif && DB.views[DB.aktif] && DB.views[DB.aktif].tinggalkan) DB.views[DB.aktif].tinggalkan();
    DB.aktif = null;
    DB.tutupLapisan();
    ["dlg-sandi", "dlg-status", "dlg-form"].forEach(function (id) { var d = $(id); if (d && d.open) d.close(); });
    $("app").hidden = true; $("masuk").hidden = false;
    $("app").classList.remove("menu-buka");
    var g = $("g-masuk");
    g.hidden = !pesan; g.textContent = pesan || "";
    $("p").value = "";
    if (DB.setelahKeluar) DB.setelahKeluar();
  };

  DB.tutupLapisan = function () { PC.kosongkan($("lapisan")); };

  $("form-masuk").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("btn-masuk");
    btn.disabled = true; btn.textContent = "Memeriksa...";
    PC.api("login", { username: $("u").value, password: $("p").value }, 25000).then(function (r) {
      if (r.status === "SUCCESS") {
        DB.S.token = r.token; DB.S.user = r.user;
        simpanSesi(); DB.mulaiApp();
      } else {
        DB.keluar(r.message || "Gagal masuk.");
      }
    }).catch(function () { DB.keluar("Tidak dapat terhubung ke server."); })
      .then(function () { btn.disabled = false; btn.textContent = "Masuk"; });
  });
  $("btn-keluar").addEventListener("click", function () { DB.keluar("", true); });

  /* ------------------------------------------------------------ menu */
  var GRUP = { pantau: "Pemantauan", data: "Data master", sistem: "Sistem" };

  function bangunMenu() {
    var m = $("menu");
    PC.kosongkan(m);
    var grupTerakhir = "";
    var RANK = { pantau: 0, data: 1, sistem: 2 };
    DB.urutan = DB.urutan.map(function (id, i) { return { id: id, i: i }; }).sort(function (a, b) {
      return (RANK[DB.views[a.id].grup] || 0) - (RANK[DB.views[b.id].grup] || 0) || a.i - b.i;
    }).map(function (x) { return x.id; });
    DB.urutan.forEach(function (id) {
      var v = DB.views[id];
      if (!DB.izin(v)) return;
      if (v.grup !== grupTerakhir) {
        grupTerakhir = v.grup;
        m.appendChild(h("div", { class: "menu-grup", text: GRUP[v.grup] || v.grup }));
      }
      var jml = h("span", { class: "jml", id: "jml-" + id, hidden: true });
      m.appendChild(h("a", { href: "#" + id, "data-view": id }, v.judul, jml));
    });
    Object.keys(DB.lencana).forEach(function (id) { DB.badge(id, DB.lencana[id].n, DB.lencana[id].bad); });
  }

  DB.badge = function (id, n, bad) {
    DB.lencana[id] = { n: n, bad: bad };
    var el = $("jml-" + id);
    if (!el) return;
    el.hidden = n === null || n === undefined;
    el.textContent = String(n);
    el.className = "jml" + (bad ? " bad" : "");
  };

  DB.buka = function (id) {
    var v = DB.views[id];
    if (!v || !DB.izin(v)) {
      id = DB.urutan.filter(function (x) { return DB.izin(DB.views[x]); })[0];
      v = DB.views[id];
    }
    if (!v) return;
    if (DB.aktif && DB.aktif !== id && DB.views[DB.aktif].tinggalkan) DB.views[DB.aktif].tinggalkan();
    DB.aktif = id;
    Array.prototype.forEach.call(document.querySelectorAll("#menu a"), function (a) {
      if (a.getAttribute("data-view") === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("judul-halaman").textContent = v.judul;
    DB.info("");
    var isi = $("isi");
    PC.kosongkan(isi);
    $("app").classList.remove("menu-buka");
    $("btn-menu").setAttribute("aria-expanded", "false");
    window.scrollTo(0, 0);
    v.tampil(isi);
    if (location.hash !== "#" + id) { try { history.replaceState(null, "", "#" + id); } catch (e) { /* abaikan */ } }
  };

  window.addEventListener("hashchange", function () {
    if (!DB.S.token) return;
    var id = location.hash.replace("#", "");
    if (id !== DB.aktif) DB.buka(id);
  });

  /* Menu samping: di layar lebar bisa diminimalkan (ingat pilihan), di HP berupa laci. */
  var KUNCI_SISI = "dp_sisi_tutup";
  function layarSempit() { return window.matchMedia("(max-width: 860px)").matches; }
  function setSisiTutup(t, simpan) {
    $("app").classList.toggle("sisi-tutup", t);
    if (!layarSempit()) $("btn-menu").setAttribute("aria-expanded", t ? "false" : "true");
    $("btn-menu").setAttribute("aria-label", t ? "Tampilkan menu" : "Sembunyikan menu");
    if (simpan) { try { localStorage.setItem(KUNCI_SISI, t ? "1" : "0"); } catch (e) { /* abaikan */ } }
  }
  // Bawaan: menu tertutup. Hanya terbuka bila admin pernah membukanya sendiri ("0").
  function sisiTutupTersimpan() { try { return localStorage.getItem(KUNCI_SISI) !== "0"; } catch (e) { return true; } }
  setSisiTutup(sisiTutupTersimpan(), false);
  $("btn-menu").addEventListener("click", function () {
    if (layarSempit()) {
      var buka = !$("app").classList.contains("menu-buka");
      $("app").classList.toggle("menu-buka", buka);
      $("btn-menu").setAttribute("aria-expanded", buka ? "true" : "false");
    } else {
      setSisiTutup(!$("app").classList.contains("sisi-tutup"), true);
    }
  });
  $("btn-sisi-tutup").addEventListener("click", function () {
    if (layarSempit()) { $("app").classList.remove("menu-buka"); $("btn-menu").setAttribute("aria-expanded", "false"); }
    else setSisiTutup(true, true);
  });
  $("tirai-menu").addEventListener("click", function () {
    $("app").classList.remove("menu-buka");
    $("btn-menu").setAttribute("aria-expanded", "false");
  });

  /* Layar kontrol penuh: menu disembunyikan dan browser masuk mode layar penuh (untuk monitor di pos keamanan). */
  $("btn-penuh").addEventListener("click", function () {
    var el = document.documentElement;
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (el.requestFullscreen) el.requestFullscreen().catch(function () { PC.toast("Browser menolak mode layar penuh.", "bad"); });
    setSisiTutup(true, false);
  });
  document.addEventListener("fullscreenchange", function () {
    var p = !!document.fullscreenElement;
    $("btn-penuh").setAttribute("aria-pressed", p ? "true" : "false");
    $("btn-penuh").title = p ? "Keluar dari layar penuh" : "Layar penuh";
    if (!p) setSisiTutup(sisiTutupTersimpan(), false);
  });

  DB.mulaiApp = function () {
    var u = DB.S.user;
    $("masuk").hidden = true; $("app").hidden = false;
    var p = $("pengguna");
    PC.kosongkan(p);
    p.appendChild(h("b", { text: u.nama }));
    p.appendChild(h("span", { text: u.role + (u.bisaUbah ? "" : " (hanya lihat)") }));
    bangunMenu();
    if (DB.saatMulaiApp) DB.saatMulaiApp();
    DB.buka(location.hash.replace("#", "") || "laporan");
  };

  /* ------------------------------------------------------------ dialog form serbaguna */
  var dlgForm = $("dlg-form"), formAktif = null, refBidang = {};

  function bukaDlg(d) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }

  function buatBidang(b) {
    if (b.kustom) return b.kustom;
    var el, id = "fm-" + b.id;
    if (b.tipe === "select") {
      el = h("select", { id: id, class: "input" }, (b.pilihan || []).map(function (p) {
        return h("option", { value: p[0], text: p[1], selected: String(p[0]) === String(b.nilai === undefined ? "" : b.nilai) });
      }));
    } else if (b.tipe === "textarea") {
      el = h("textarea", { id: id, class: "input" + (b.mono ? " mono" : ""), rows: b.rows || 4, placeholder: b.placeholder || "", maxlength: b.maks || null });
      el.value = b.nilai || "";
    } else {
      el = h("input", { id: id, class: "input", type: b.tipe || "text", placeholder: b.placeholder || "", maxlength: b.maks || null,
        autocomplete: b.tipe === "password" ? "new-password" : "off", inputmode: b.mode || null, spellcheck: "false" });
      el.value = b.nilai === undefined || b.nilai === null ? "" : String(b.nilai);
    }
    refBidang[b.id] = el;
    var kiri = el;
    if (b.tombol) {
      kiri = h("div", { class: "kunci-sandi" }, el, h("button", { type: "button", class: "btn btn-kecil btn-garis", text: b.tombol.teks,
        onclick: function () { b.tombol.klik(el); } }));
    }
    return h("div", { class: "medan" }, h("label", { for: id, text: b.label }), kiri,
      b.bantuan ? h("p", { class: "bantuan", text: b.bantuan }) : null);
  }

  // o: { judul, info, bidang:[...], simpan, bahaya, kirim(nilai) -> Promise<respons API>, selesai(respons), lebar }
  DB.form = function (o) {
    formAktif = o;
    refBidang = {};
    $("fm-judul").textContent = o.judul;
    var info = $("fm-info");
    info.hidden = !o.info; info.textContent = o.info || "";
    var isi = $("fm-isi");
    PC.kosongkan(isi);
    var baris = null;
    (o.bidang || []).forEach(function (b) {
      var el = buatBidang(b);
      if (b.separuh) {
        if (!baris) { baris = h("div", { class: "baris-medan" }); isi.appendChild(baris); }
        baris.appendChild(el);
        if (baris.children.length === 2) baris = null;
      } else { baris = null; isi.appendChild(el); }
    });
    $("g-form").hidden = true;
    var s = $("fm-simpan");
    s.textContent = o.simpan || "Simpan";
    s.className = "btn " + (o.bahaya ? "btn-bahaya" : "btn-utama");
    s.hidden = o.tanpaSimpan === true;
    s.disabled = false;
    $("fm-batal").textContent = o.tanpaSimpan ? "Tutup" : "Batal";
    bukaDlg(dlgForm);
    var pertama = isi.querySelector("input, select, textarea");
    if (pertama) pertama.focus();
  };
  DB.nilaiForm = function () {
    var v = {};
    Object.keys(refBidang).forEach(function (k) { v[k] = refBidang[k].value; });
    return v;
  };
  DB.galatForm = function (pesan) {
    var g = $("g-form");
    g.textContent = pesan; g.hidden = !pesan;
  };
  DB.tutupForm = function () { if (dlgForm.open) dlgForm.close(); formAktif = null; };
  $("fm-batal").addEventListener("click", DB.tutupForm);
  $("form-umum").addEventListener("submit", function (e) {
    e.preventDefault();
    var o = formAktif;
    if (!o || !o.kirim) return;
    var btn = $("fm-simpan");
    btn.disabled = true;
    DB.galatForm("");
    var pesanLokal = o.periksa ? o.periksa(DB.nilaiForm()) : "";
    if (pesanLokal) { DB.galatForm(pesanLokal); btn.disabled = false; return; }
    Promise.resolve(o.kirim(DB.nilaiForm())).then(function (r) {
      if (r && r.status === "SUCCESS") {
        if (!o.tetapBuka) DB.tutupForm();
        if (o.selesai) o.selesai(r);
      } else if (r && r.kode !== "SESI") {
        DB.galatForm((r && r.message) || "Gagal menyimpan.");
      }
    }).then(function () { btn.disabled = false; });
  });

  /* ------------------------------------------------------------ ganti password */
  var dlgSandi = $("dlg-sandi");
  $("btn-sandi").addEventListener("click", function () {
    $("form-sandi").reset(); $("g-sandi").hidden = true;
    bukaDlg(dlgSandi);
  });
  $("s-batal").addEventListener("click", function () { dlgSandi.close(); });
  $("form-sandi").addEventListener("submit", function (e) {
    e.preventDefault();
    var g = $("g-sandi");
    if ($("s-baru").value !== $("s-konf").value) { g.textContent = "Konfirmasi kata sandi tidak cocok."; g.hidden = false; return; }
    var btn = $("s-simpan"); btn.disabled = true;
    DB.panggil("gantiPassword", { passLama: $("s-lama").value, passBaru: $("s-baru").value }, 25000).then(function (r) {
      if (r.status === "SUCCESS") {
        // Server mencabut semua sesi lama dan memberi token baru untuk sesi ini.
        if (r.token) { DB.S.token = r.token; simpanSesi(); }
        dlgSandi.close(); PC.toast("Kata sandi diperbarui. Sesi di perangkat lain dikeluarkan.", "ok");
      } else if (r.kode !== "SESI") {
        g.textContent = r.message || "Gagal mengganti kata sandi."; g.hidden = false;
      }
    }).then(function () { btn.disabled = false; });
  });

  /* ------------------------------------------------------------ pulihkan sesi */
  DB.pulihkan = function () {
    var sesi = null;
    try { sesi = JSON.parse(sessionStorage.getItem(KUNCI_SESI)); } catch (e) { /* abaikan */ }
    if (sesi && sesi.token && sesi.user) { DB.S.token = sesi.token; DB.S.user = sesi.user; DB.mulaiApp(); }
  };
  DB.simpanSesi = simpanSesi;
})();
