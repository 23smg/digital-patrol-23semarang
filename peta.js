/* peta.js - halaman Denah zona.
   Admin menaruh titik tiap zona (lokasi QR patroli) di gambar denah. Warna titik mengikuti status zona
   pada sesi berjalan (hitungan yang sama dengan Cakupan zona), jadi begitu petugas memindai QR di titik itu
   dan laporan masuk, titiknya berubah hijau di dashboard. */
(function () {
  "use strict";
  var DB = window.DB, PC = window.PC, h = PC.h, $ = DB.$;
  var S = { tampil: false, denah: null, aktif: 0, edit: false, pilih: "", sel: "", info: "", lantai: {}, kotor: {}, kotorDaftar: false, seret: false, menyimpan: false, galat: "", tampilan: {}, rasio: {}, tmr: null, gagal: {}, cak: null, cakWaktu: 0, sibukStatus: false, gestur: false };
  var LABEL = { ok: "Sudah sesi ini", belum: "Belum", mepet: "Segera", tanpa: "Tanpa petugas" };
  var timer = null;

  function boleh() { return !!(DB.S.user && DB.S.user.bisaUbah); }
  function pendek(z) { var p = String(z).split(" - "); var t = p[p.length - 1]; return t.length > 5 ? t.slice(0, 5) : t; }
  function berlalu() { return DB.data && DB.data.waktu ? Math.floor((Date.now() - DB.data.waktu) / 60000) : 0; }
  function cur() { return S.denah ? S.denah[S.aktif] : null; }

  // Pesan galat yang jelas; paling sering penyebabnya Code.gs di Apps Script belum diperbarui.
  function pesanGalat(r) {
    var m = (r && r.message) || "Gagal memuat denah.";
    if (/tidak dikenali/i.test(m)) m = "Server belum diperbarui: salin Code.gs terbaru ke Apps Script, lalu buat versi deployment baru. (" + m + ")";
    return m;
  }
  function terapkanDenah(list) {
    S.denah = list.map(function (d, i) {
      return { id: d.id, nama: d.nama || "", berkas: d.berkas || ("d" + (i + 1) + ".jpg"), lantai: d.lantai || "", pin: d.pin || {} };
    });
    if (S.aktif >= S.denah.length) S.aktif = 0;
  }

  // Satu panggilan: daftar denah + status zona. Bila server masih versi lama, jatuh ke panggilan lama.
  var KUNCI_CACHE_P = "dp_peta_cache";
  function bacaCacheP() {
    try {
      var c = JSON.parse(sessionStorage.getItem(KUNCI_CACHE_P));
      if (c && Array.isArray(c.denah) && c.denah.length) { terapkanDenah(c.denah); S.cak = c.cak || null; S.cakWaktu = c.w || 0; return true; }
    } catch (e) { /* abaikan */ }
    return false;
  }
  function simpanCacheP(r) {
    try { sessionStorage.setItem(KUNCI_CACHE_P, JSON.stringify({ denah: r.denah, cak: S.cak, w: S.cakWaktu })); } catch (e) { /* abaikan */ }
  }

  // Satu panggilan: daftar denah + status zona. Bila server masih versi lama, jatuh ke panggilan lama.
  // Bila ada salinan dari kunjungan sebelumnya, denah langsung tampil dan pembaruan berjalan diam-diam.
  function muat() {
    S.galat = "";
    var ada = !S.denah && bacaCacheP();
    if (ada) render();
    var senyap = !!S.denah;
    return DB.panggil("petaAmbil", {}, 60000, senyap).then(function (r) {
      if (r && r.status === "SUCCESS") { S.cak = r.cakupan || null; S.cakWaktu = Date.now(); return r; }
      if (r && /tidak dikenali/i.test(r.message || "")) return DB.panggil("petaZonaAmbil", {}, 30000, senyap);
      return r;
    }).then(function (r) {
      if (!r || r.status !== "SUCCESS" || !Array.isArray(r.denah) || !r.denah.length) {
        if (S.denah) return;    // tetap pakai salinan lama bila pembaruan gagal
        S.denah = null; S.galat = pesanGalat(r); render(); return;
      }
      if (!S.edit && !S.seret && !S.gestur) terapkanDenah(r.denah);
      simpanCacheP(r);
      if (S.tampil && !S.edit && !S.seret && !S.gestur) render();
    });
  }

  // Penyegaran berkala: hanya status zona (ringan, di-cache server 25 detik).
  function segarStatus(paksa) {
    if (S.sibukStatus || !S.tampil || !S.denah) return;
    if (!paksa && (document.hidden || S.edit || S.gestur || S.seret)) return;
    S.sibukStatus = true;
    DB.panggil("petaStatus", {}, 30000, true).then(function (r) {
      S.sibukStatus = false;
      if (r && r.status === "SUCCESS" && r.cakupan) {
        S.cak = r.cakupan; S.cakWaktu = Date.now();
        if (S.tampil && !S.seret && !S.gestur) render();
      } else if (paksa && r && !r.jaringan && !/tidak dikenali/i.test(r.message || "")) {
        PC.toast(pesanGalat(r), "bad");
      }
    });
  }

  function daftarLantai(zona) {
    var u = {};
    zona.forEach(function (z) { if (z.lantai) u[z.lantai] = 1; });
    return Object.keys(u).sort(function (a, b) { return a.localeCompare(b, "id", { numeric: true }); });
  }

  // Simpan titik satu denah. Dipanggil otomatis 1,2 detik setelah perubahan terakhir, atau lewat tombol.
  function simpan(id) {
    var d = typeof id === "string" ? S.denah && S.denah.filter(function (x) { return x.id === id; })[0] : cur();
    if (!d || !d.id) return;
    if (S.menyimpan) { jadwalSimpan(d); return; }
    clearTimeout(S.tmr);
    var kirim = { denah: d.id, lantai: d.lantai, pin: JSON.parse(JSON.stringify(d.pin)) };
    S.menyimpan = true; render();
    DB.panggil("petaZonaSimpan", kirim, 40000).then(function (r) {
      S.menyimpan = false;
      if (!r || r.status !== "SUCCESS" || !r.denah) {
        PC.toast(pesanGalat(r) + " Titik BELUM tersimpan; tekan Simpan sekarang untuk mencoba lagi.", "bad");
        S.gagal[d.id] = true; render(); return;
      }
      // Bila selama menyimpan ada perubahan baru, biarkan ditandai kotor dan simpan lagi.
      var berubah = JSON.stringify(d.pin) !== JSON.stringify(kirim.pin) || d.lantai !== kirim.lantai;
      if (berubah) { jadwalSimpan(d); } else { S.gagal[d.id] = false; S.kotor[d.id] = false; d.lantai = r.denah.lantai; d.pin = r.denah.pin; S.sel = ""; PC.toast("Titik denah tersimpan.", "ok"); simpanCacheP({ denah: S.denah }); }
      render();
    });
  }
  function jadwalSimpan(d) {
    if (!d || !d.id) return;
    clearTimeout(S.tmr);
    S.tmr = setTimeout(function () { simpan(d.id); }, 1200);
  }
  function tandaiKotor(d) { S.kotor[d.id] = true; S.gagal[d.id] = false; jadwalSimpan(d); }
  window.addEventListener("beforeunload", function (ev) {
    var ada = Object.keys(S.kotor).some(function (k) { return S.kotor[k]; });
    if (ada) { ev.preventDefault(); ev.returnValue = ""; }
  });

  function batal() {
    var d = cur();
    if (!d) return;
    S.kotor[d.id] = false; S.sel = ""; S.pilih = "";
    S.denah = null; S.tampilan = {}; render(); muat();
  }

  function posisi(ev, plat) {
    var r = plat.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))];
  }

  function belumBertitik(d, zona) {
    return zona.filter(function (z) { return !d.pin[z.zona] && (!d.lantai || z.lantai === d.lantai); });
  }

  function pasangTitik(d, plat, zona, status) {
    Object.keys(d.pin).forEach(function (nama) {
      var st = status && status[nama];
      var s = st ? st.s : "tanpa";
      var baru = st && st.z.menit !== null && st.z.menit !== undefined && st.z.menit + berlalu() <= 10 && s === "ok";
      var p = d.pin[nama];
      var el = h("div", { class: "peta-titik s-" + s + (baru ? " baru" : "") + (S.sel === nama || S.info === nama ? " dipilih" : ""),
        tabindex: "0", role: "button",
        title: nama + " - " + LABEL[s] + (st ? "\n" + st.info + "\nHari ini: " + st.z.hariIni + " kali" : ""),
        text: pendek(nama), style: { left: (p[0] * 100) + "%", top: (p[1] * 100) + "%" } });
      if (S.edit && boleh()) {
        var mulaiX = 0, mulaiY = 0, gerak = false;
        el.addEventListener("pointerdown", function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          mulaiX = ev.clientX; mulaiY = ev.clientY; gerak = false; S.seret = true;
          try { el.setPointerCapture(ev.pointerId); } catch (x) { /* abaikan */ }
        });
        el.addEventListener("pointermove", function (ev) {
          if (!S.seret) return;
          if (Math.abs(ev.clientX - mulaiX) + Math.abs(ev.clientY - mulaiY) > 4) gerak = true;
          if (!gerak) return;
          var q = posisi(ev, plat);
          el.style.left = (q[0] * 100) + "%"; el.style.top = (q[1] * 100) + "%";
          d.pin[nama] = [Math.round(q[0] * 10000) / 10000, Math.round(q[1] * 10000) / 10000];
        });
        el.addEventListener("pointerup", function () {
          if (!S.seret) return;
          S.seret = false;
          if (gerak) tandaiKotor(d);
          S.sel = nama; S.pilih = "";
          render();
        });
      } else {
        el.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
        el.addEventListener("click", function (ev) { ev.stopPropagation(); S.info = S.info === nama ? "" : nama; render(); });
      }
      plat.appendChild(el);
    });
  }

  function render() {
    var w = $("peta-isi");
    if (!w) return;
    if (S.hapusMesin) { S.hapusMesin(); S.hapusMesin = null; }
    PC.kosongkan(w);
    if (S.galat) { w.appendChild(h("div", { class: "panel" }, h("div", { class: "kosong-info", text: S.galat }), h("div", { class: "panel-isi" }, h("button", { type: "button", class: "btn btn-kecil", text: "Coba lagi", onclick: function () { S.galat = ""; S.denah = null; render(); muat(); } })))); return; }
    var data = DB.data, cc = S.cak || (data && data.cakupan);
    if (!S.denah) { w.appendChild(h("div", { class: "panel" }, h("div", { class: "kosong-info", text: "Memuat denah..." }))); return; }
    var zona = (cc && cc.zona) || [], status = DB.statusZonaPeta ? (S.cak ? DB.statusZonaPeta(S.cak, S.cakWaktu) : DB.statusZonaPeta()) : null;
    var d = cur(), editAktif = S.edit && boleh();

    // Tab denah + tombol atur
    var tab = h("div", { class: "rapat" });
    S.denah.forEach(function (x, i) {
      tab.appendChild(h("button", { type: "button", class: "btn btn-pilih", "aria-pressed": i === S.aktif ? "true" : "false",
        text: (x.nama || (x.lantai ? "Lantai " + x.lantai : "Denah " + (i + 1))) + (S.kotor[x.id] ? " *" : ""),
        onclick: function () { S.aktif = i; S.sel = ""; S.info = ""; S.pilih = ""; render(); } }));
    });
    var kanan = h("div", { class: "rapat" });
    if (boleh()) kanan.appendChild(h("button", { type: "button", class: "btn btn-kecil " + (editAktif ? "" : "btn-garis"), text: editAktif ? "Selesai mengatur" : "Atur titik",
      onclick: function () { if (S.edit && d.id && S.kotor[d.id]) simpan(d.id); S.edit = !S.edit; S.sel = ""; S.pilih = ""; S.info = ""; render(); } }));
    kanan.appendChild(h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Muat ulang", onclick: function () { segarStatus(true); } }));
    w.appendChild(h("div", { class: "tools tools-lepas" }, tab, kanan));

    // Ringkasan status pada denah ini
    var n = { ok: 0, belum: 0, mepet: 0, tanpa: 0 };
    Object.keys(d.pin).forEach(function (nm) { var st = status && status[nm]; n[st ? st.s : "tanpa"]++; });
    var legenda = h("div", { class: "peta-legenda" },
      h("span", { class: "lencana l-ok", text: "Sudah " + n.ok }),
      h("span", { class: "lencana l-warn", text: "Belum " + n.belum }),
      h("span", { class: "lencana l-bad", text: "Segera " + n.mepet }),
      h("span", { class: "lencana l-abu", text: "Tanpa petugas " + n.tanpa }),
      h("span", { class: "oleh", text: Object.keys(d.pin).length + " titik di denah ini" + (S.cakWaktu || data ? " · diperbarui " + PC.fmtWIB(new Date(S.cakWaktu || data.waktu)).jam + " WIB" : "") }));
    w.appendChild(legenda);

    // Banner perubahan belum tersimpan (terlihat juga di luar mode atur)
    if (d.id && S.kotor[d.id]) {
      w.appendChild(h("div", { class: "peta-belum" }, h("span", { text: S.menyimpan ? "Menyimpan titik..." : (S.gagal[d.id] ? "Gagal menyimpan. Titik belum tersimpan di server." : "Perubahan titik belum disimpan (otomatis tersimpan sebentar lagi).") }),
        h("button", { type: "button", class: "btn btn-kecil", text: "Simpan sekarang", disabled: S.menyimpan, onclick: function () { simpan(d.id); } })));
    }

    // Gambar denah + titik. Mesin Denah3D: geser, zoom halus, putar, dan miring (3D).
    // Mode atur titik selalu datar supaya penempatan titik akurat.
    var bidang = h("div", { class: "peta-bidang" + (editAktif && S.pilih ? " menaruh" : "") });
    var plat = h("div", { class: "peta-plat" });
    bidang.appendChild(plat);
    var v = S.tampilan[d.id] || (S.tampilan[d.id] = { s: 1, tx: 0, ty: 0, rot: 0, tilt: 0, tiga: false });
    if (editAktif) { v.tiga = false; v.rot = 0; v.tilt = 0; }
    var eng = null, btn3 = null;
    if (d.berkas) {
      var gbr = h("img", { class: "peta-gambar", src: "denah/" + encodeURIComponent(d.berkas), alt: "Denah " + (d.nama || S.aktif + 1), draggable: "false" });
      if (S.rasio[d.berkas]) bidang.style.aspectRatio = S.rasio[d.berkas];
      gbr.addEventListener("load", function () {
        S.rasio[d.berkas] = gbr.naturalWidth + " / " + gbr.naturalHeight;
        bidang.style.aspectRatio = S.rasio[d.berkas]; if (eng) eng.terapkan();
      });
      gbr.addEventListener("error", function () {
        gbr.hidden = true;
        bidang.appendChild(h("div", { class: "peta-galat", text: "Gambar denah tidak ditemukan: denah/" + d.berkas + ". Unggah file itu ke folder denah di GitHub." }));
      });
      plat.appendChild(gbr);
    } else {
      bidang.appendChild(h("div", { class: "peta-galat", text: "Denah ini belum punya gambar. Isi nama berkas di bawah, lalu Simpan denah." }));
    }
    pasangTitik(d, plat, zona, status);

    function taruhTitik(ev) {
      if (!(editAktif && S.pilih && d.id)) return;
      var q = posisi(ev, plat);
      d.pin[S.pilih] = [Math.round(q[0] * 10000) / 10000, Math.round(q[1] * 10000) / 10000];
      S.sel = S.pilih; tandaiKotor(d);
      var sisa = belumBertitik(d, zona);
      S.pilih = sisa.length ? sisa[0].zona : "";
      render();
    }
    eng = window.Denah3D.buat({
      bidang: bidang, plat: plat, v: v, maks: 8, min: 1, tilt: 58,
      datar: function () { return editAktif; },
      gestur: function (b) { S.gestur = b; },
      ketuk: taruhTitik,
      tahanKlikGanda: function (ev) { return !!(ev.target.closest && ev.target.closest(".peta-titik")); },
      ubahMode: function (t) { if (btn3) btn3.setAttribute("aria-pressed", t ? "true" : "false"); }
    });
    var tengahX = function () { return bidang.clientWidth / 2; }, tengahY = function () { return bidang.clientHeight / 2; };
    var kontrol = h("div", { class: "peta-zoomkontrol" },
      h("button", { type: "button", "aria-label": "Perbesar", title: "Perbesar", text: "+", onclick: function () { eng.zoomDi(tengahX(), tengahY(), v.s * 1.6, true); } }),
      h("button", { type: "button", "aria-label": "Perkecil", title: "Perkecil", text: "\u2212", onclick: function () { eng.zoomDi(tengahX(), tengahY(), v.s / 1.6, true); } }));
    if (!editAktif) {
      btn3 = h("button", { type: "button", class: "tombol-3d", title: "Tampilan 3D: putar dan miringkan denah", "aria-label": "Tampilan 3D", "aria-pressed": v.tiga ? "true" : "false", text: "3D",
        onclick: function () { eng.tiga(!v.tiga); } });
      kontrol.appendChild(btn3);
    }
    kontrol.appendChild(h("button", { type: "button", "aria-label": "Ukuran awal", title: "Kembali ke tampilan awal", text: "\u21BA", onclick: function () { eng.reset(); } }));
    ["pointerdown", "dblclick", "wheel"].forEach(function (nm) { kontrol.addEventListener(nm, function (ev) { ev.stopPropagation(); }); });
    bidang.appendChild(kontrol);
    w.appendChild(bidang);
    w.appendChild(h("div", { class: "peta-bantu", text: editAktif
      ? "Mode atur titik: tampilan datar. Seret untuk menggeser, cubit atau roda mouse untuk zoom."
      : "Seret untuk menggeser \u00B7 cubit atau roda mouse untuk zoom \u00B7 tombol 3D untuk memutar dan memiringkan denah (Shift + roda = putar)." }));
    eng.terapkan();
    S.hapusMesin = eng.hapus;

    // Rincian zona yang diketuk (mode lihat)
    if (!editAktif && S.info && status && status[S.info]) {
      var st = status[S.info];
      w.appendChild(h("div", { class: "peta-info s-" + st.s },
        h("b", { text: S.info }), h("span", { class: "lencana " + ({ ok: "l-ok", belum: "l-warn", mepet: "l-bad", tanpa: "l-abu" })[st.s], text: LABEL[st.s] }),
        h("span", { class: "oleh", text: st.info + " · hari ini " + st.z.hariIni + " kali" })));
    }

    if (editAktif) { w.appendChild(panelBerkas(d)); if (d.id) w.appendChild(panelAtur(d, zona)); }
    else if (!Object.keys(d.pin).length) {
      w.appendChild(h("div", { class: "pengantar", text: boleh()
        ? "Denah ini belum punya titik. Klik \"Atur titik\" untuk menaruh lokasi QR zona di gambar."
        : "Denah ini belum punya titik. Minta admin untuk mengaturnya." }));
    }
  }

  function simpanDaftar() {
    if (S.menyimpan) return;
    var lokal = {};
    S.denah.forEach(function (x) { if (x.id) lokal[x.id] = x; });
    var aktifId = cur() ? cur().id : "", idx = S.aktif;
    S.menyimpan = true; render();
    DB.panggil("petaDenahDaftar", { daftar: S.denah.map(function (x) { return { id: x.id, nama: x.nama, berkas: x.berkas }; }) }, 40000).then(function (r) {
      if (!r || r.status !== "SUCCESS" || !Array.isArray(r.denah)) { S.menyimpan = false; PC.toast(pesanGalat(r), "bad"); render(); return; }
      S.denah = (r.denah || []).map(function (d) {
        var l = lokal[d.id];
        // Titik yang belum disimpan di denah lain tetap dipertahankan.
        return { id: d.id, nama: d.nama || "", berkas: d.berkas || "", lantai: l && S.kotor[d.id] ? l.lantai : (d.lantai || ""), pin: l && S.kotor[d.id] ? l.pin : (d.pin || {}) };
      });
      S.aktif = Math.min(idx, S.denah.length - 1); if (S.aktif < 0) S.aktif = 0;
      S.kotorDaftar = false; S.menyimpan = false; S.sel = ""; S.pilih = ""; try { simpanCacheP({ denah: S.denah }); } catch (e) { /* abaikan */ }
      PC.toast("Daftar denah tersimpan.", "ok"); render();
    }).catch(function (e) {
      S.menyimpan = false; PC.toast((e && e.message) || "Gagal menyimpan daftar denah.", "bad"); render();
    });
  }

  function panelBerkas(d) {
    var nama = h("input", { type: "text", class: "input", maxlength: "40", value: d.nama, placeholder: "Contoh: Lantai LG", "aria-label": "Nama denah",
      oninput: function (ev) { d.nama = ev.target.value; S.kotorDaftar = true; } });
    var berkas = h("input", { type: "text", class: "input", maxlength: "64", value: d.berkas, placeholder: "contoh: denah-lg.jpg", "aria-label": "Nama berkas gambar",
      oninput: function (ev) { d.berkas = ev.target.value.trim(); S.kotorDaftar = true; } });
    var aksi = h("div", { class: "rapat" },
      h("button", { type: "button", class: "btn btn-kecil", text: S.menyimpan ? "Menyimpan..." : "Simpan denah", disabled: S.menyimpan, onclick: simpanDaftar }),
      h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Tambah denah", disabled: S.menyimpan || S.denah.length >= 40,
        onclick: function () { S.denah.push({ id: "", nama: "", berkas: "", lantai: "", pin: {} }); S.aktif = S.denah.length - 1; S.kotorDaftar = true; S.sel = ""; S.pilih = ""; render(); } }),
      h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Hapus denah ini", disabled: S.menyimpan || S.denah.length <= 1,
        onclick: function () {
          if (!window.confirm("Hapus denah ini beserta semua titiknya?")) return;
          S.denah.splice(S.aktif, 1); S.aktif = Math.max(0, S.aktif - 1); S.sel = ""; S.pilih = "";
          if (d.id) simpanDaftar(); else render();
        } }));
    return h("div", { class: "panel" },
      h("div", { class: "panel-kepala" }, h("h2", { text: "Gambar denah" })),
      h("div", { class: "panel-isi" },
        h("div", { class: "pengantar", text: "Gambar denah adalah file di folder denah pada GitHub. Unggah filenya dulu (JPG, lebar sekitar 1500 px), lalu tulis nama berkasnya di sini. Denah baru bisa ditambah kapan saja." }),
        h("div", { class: "peta-isian" }, h("label", null, h("span", { class: "label", text: "Nama denah" }), nama), h("label", null, h("span", { class: "label", text: "Nama berkas" }), berkas)),
        aksi,
        d.id ? null : h("div", { class: "oleh", text: "Simpan denah dulu sebelum menaruh titik." })));
  }

  function panelAtur(d, zona) {
    var lantai = daftarLantai(zona);
    var pilih = h("select", { class: "input", "aria-label": "Lantai denah", onchange: function (ev) { d.lantai = ev.target.value; tandaiKotor(d); S.pilih = ""; render(); } },
      h("option", { value: "", text: "Semua lantai" }));
    lantai.forEach(function (f) { var o = h("option", { value: f, text: "Lantai " + f }); if (f === d.lantai) o.selected = true; pilih.appendChild(o); });

    var sisa = belumBertitik(d, zona);
    sisa.sort(function (a, b) { return a.zona.localeCompare(b.zona, "id", { numeric: true }); });
    var chip = h("div", { class: "chip-wadah peta-sisa" });
    if (!sisa.length) chip.appendChild(h("span", { class: "oleh", text: "Semua zona sudah bertitik di denah ini." }));
    sisa.forEach(function (z) {
      chip.appendChild(h("button", { type: "button", class: "btn btn-kecil btn-garis" + (S.pilih === z.zona ? " dipilih" : ""), text: z.zona,
        onclick: function () { S.pilih = S.pilih === z.zona ? "" : z.zona; S.sel = ""; render(); } }));
    });

    var aksi = h("div", { class: "rapat" },
      h("button", { type: "button", class: "btn btn-kecil", text: S.menyimpan ? "Menyimpan..." : "Simpan titik", disabled: !S.kotor[d.id] || S.menyimpan, onclick: function () { simpan(d.id); } }),
      h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Batalkan perubahan", disabled: !S.kotor[d.id] || S.menyimpan, onclick: batal }));
    if (S.sel && d.pin[S.sel]) {
      aksi.appendChild(h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Hapus titik " + S.sel,
        onclick: function () { delete d.pin[S.sel]; S.sel = ""; tandaiKotor(d); render(); } }));
    }
    var petunjuk = S.pilih
      ? "Klik di denah untuk menaruh titik " + S.pilih + "."
      : "Pilih zona di bawah, lalu klik letaknya di denah. Titik yang sudah ada bisa digeser; ketuk titik lalu \"Hapus titik\" untuk membuangnya.";
    return h("div", { class: "panel" },
      h("div", { class: "panel-kepala" }, h("h2", { text: "Atur titik denah" }), pilih),
      h("div", { class: "panel-isi" },
        h("div", { class: "pengantar", text: petunjuk }),
        h("div", { class: "oleh", text: sisa.length + " zona belum bertitik" + (d.lantai ? " di lantai " + d.lantai : "") }),
        chip, aksi));
  }

  function tampil(wadah) {
    S.tampil = true; S.info = ""; S.pilih = ""; S.sel = "";
    wadah.appendChild(h("div", { id: "peta-isi" }));
    render();
    if (!S.denah) muat(); else segarStatus(true);
    // Status disegarkan tiap 45 detik lewat panggilan ringan; berhenti saat tab tersembunyi atau sedang mengatur.
    if (timer) clearInterval(timer);
    timer = setInterval(function () { segarStatus(false); }, 45000);
  }
  function tinggalkan() { S.tampil = false; S.edit = false; if (timer) { clearInterval(timer); timer = null; } }

  // Muat denah di latar sesaat setelah masuk supaya menu Denah zona langsung tampil saat dibuka.
  var sebelumMulai = DB.saatMulaiApp;
  DB.saatMulaiApp = function () {
    if (sebelumMulai) sebelumMulai();
    setTimeout(function () { if (!S.denah && DB.S.token) muat(); }, 1500);
  };
  var sebelumKeluar = DB.setelahKeluar;
  DB.setelahKeluar = function () { if (sebelumKeluar) sebelumKeluar(); S.denah = null; S.cak = null; try { sessionStorage.removeItem(KUNCI_CACHE_P); } catch (e) { /* abaikan */ } };
  DB.saatData(function () { if (S.tampil && !S.seret && !S.gestur && !S.cak) render(); });
  DB.daftar({ id: "denah", judul: "Denah zona", grup: "pantau", izin: "semua", tampil: tampil, tinggalkan: tinggalkan });
})();
