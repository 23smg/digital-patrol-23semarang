/* peta.js - halaman Denah zona.
   Admin menaruh titik tiap zona (lokasi QR patroli) di gambar denah. Warna titik mengikuti status zona
   pada sesi berjalan (hitungan yang sama dengan Cakupan zona), jadi begitu petugas memindai QR di titik itu
   dan laporan masuk, titiknya berubah hijau di dashboard. */
(function () {
  "use strict";
  var DB = window.DB, PC = window.PC, h = PC.h, $ = DB.$;
  var S = { tampil: false, denah: null, aktif: 0, edit: false, pilih: "", sel: "", info: "", lantai: {}, kotor: {}, kotorDaftar: false, seret: false, menyimpan: false, galat: "", tampilan: {}, rasio: {}, tmr: null };
  var LABEL = { ok: "Sudah sesi ini", belum: "Belum", mepet: "Segera", tanpa: "Tanpa petugas" };
  var timer = null;

  function boleh() { return !!(DB.S.user && DB.S.user.bisaUbah); }
  function pendek(z) { var p = String(z).split(" - "); var t = p[p.length - 1]; return t.length > 5 ? t.slice(0, 5) : t; }
  function berlalu() { return DB.data && DB.data.waktu ? Math.floor((Date.now() - DB.data.waktu) / 60000) : 0; }
  function cur() { return S.denah ? S.denah[S.aktif] : null; }

  function muat() {
    S.galat = "";
    return DB.panggil("petaZonaAmbil", {}, 30000).then(function (r) {
      S.denah = (r.denah || []).map(function (d) { return { id: d.id, nama: d.nama || "", berkas: d.berkas || "", lantai: d.lantai || "", pin: d.pin || {} }; });
      if (S.aktif >= S.denah.length) S.aktif = 0;
      render();
    }).catch(function (e) { S.galat = (e && e.message) || "Gagal memuat denah."; render(); });
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
      // Bila selama menyimpan ada perubahan baru, biarkan ditandai kotor dan simpan lagi.
      var berubah = JSON.stringify(d.pin) !== JSON.stringify(kirim.pin) || d.lantai !== kirim.lantai;
      if (berubah) { jadwalSimpan(d); } else { S.kotor[d.id] = false; d.lantai = r.denah.lantai; d.pin = r.denah.pin; S.sel = ""; PC.toast("Titik denah tersimpan.", "ok"); }
      render();
    }).catch(function (e) {
      S.menyimpan = false;
      PC.toast(((e && e.message) || "Gagal menyimpan titik.") + " Titik belum tersimpan di server; tekan Simpan sekarang untuk mencoba lagi.", "bad");
      render();
    });
  }
  function jadwalSimpan(d) {
    if (!d || !d.id) return;
    clearTimeout(S.tmr);
    S.tmr = setTimeout(function () { simpan(d.id); }, 1200);
  }
  function tandaiKotor(d) { S.kotor[d.id] = true; jadwalSimpan(d); }
  window.addEventListener("beforeunload", function (ev) {
    var ada = Object.keys(S.kotor).some(function (k) { return S.kotor[k]; });
    if (ada) { ev.preventDefault(); ev.returnValue = ""; }
  });

  function batal() {
    var d = cur();
    if (!d) return;
    S.kotor[d.id] = false; S.sel = ""; S.pilih = "";
    S.denah = null; render(); muat();
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
    PC.kosongkan(w);
    if (S.galat) { w.appendChild(h("div", { class: "panel" }, h("div", { class: "kosong-info", text: S.galat }))); return; }
    var data = DB.data, cc = data && data.cakupan;
    if (!S.denah) { w.appendChild(h("div", { class: "panel" }, h("div", { class: "kosong-info", text: "Memuat denah..." }))); return; }
    var zona = (cc && cc.zona) || [], status = DB.statusZonaPeta ? DB.statusZonaPeta() : null;
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
    kanan.appendChild(h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Muat ulang", onclick: function () { if (DB.muatUlang) DB.muatUlang(); } }));
    w.appendChild(h("div", { class: "tools tools-lepas" }, tab, kanan));

    // Ringkasan status pada denah ini
    var n = { ok: 0, belum: 0, mepet: 0, tanpa: 0 };
    Object.keys(d.pin).forEach(function (nm) { var st = status && status[nm]; n[st ? st.s : "tanpa"]++; });
    var legenda = h("div", { class: "peta-legenda" },
      h("span", { class: "lencana l-ok", text: "Sudah " + n.ok }),
      h("span", { class: "lencana l-warn", text: "Belum " + n.belum }),
      h("span", { class: "lencana l-bad", text: "Segera " + n.mepet }),
      h("span", { class: "lencana l-abu", text: "Tanpa petugas " + n.tanpa }),
      h("span", { class: "oleh", text: Object.keys(d.pin).length + " titik di denah ini" + (data ? " · diperbarui " + PC.fmtWIB(new Date(data.waktu)).jam + " WIB" : "") }));
    w.appendChild(legenda);

    // Banner perubahan belum tersimpan (terlihat juga di luar mode atur)
    if (d.id && S.kotor[d.id]) {
      w.appendChild(h("div", { class: "peta-belum" }, h("span", { text: S.menyimpan ? "Menyimpan titik..." : "Perubahan titik belum disimpan (otomatis tersimpan sebentar lagi)." }),
        h("button", { type: "button", class: "btn btn-kecil", text: "Simpan sekarang", disabled: S.menyimpan, onclick: function () { simpan(d.id); } })));
    }

    // Gambar denah + titik, bisa di-zoom (roda mouse / cubit / tombol) dan digeser
    var bidang = h("div", { class: "peta-bidang" + (editAktif && S.pilih ? " menaruh" : "") });
    var plat = h("div", { class: "peta-plat" });
    bidang.appendChild(plat);
    var v = S.tampilan[d.id] || (S.tampilan[d.id] = { s: 1, tx: 0, ty: 0 });
    function terapkan() {
      var W = bidang.clientWidth, H = bidang.clientHeight;
      if (W && H) { v.tx = Math.min(0, Math.max(W - W * v.s, v.tx)); v.ty = Math.min(0, Math.max(H - H * v.s, v.ty)); }
      plat.style.transform = "translate(" + v.tx + "px," + v.ty + "px) scale(" + v.s + ")";
      plat.style.setProperty("--inv", String(1 / v.s));
    }
    function zoomDi(px, py, ns) {
      ns = Math.min(8, Math.max(1, ns));
      var px0 = (px - v.tx) / v.s, py0 = (py - v.ty) / v.s;
      v.s = ns; v.tx = px - px0 * ns; v.ty = py - py0 * ns; terapkan();
    }
    if (d.berkas) {
      var gbr = h("img", { class: "peta-gambar", src: "denah/" + encodeURIComponent(d.berkas), alt: "Denah " + (d.nama || S.aktif + 1), draggable: "false" });
      if (S.rasio[d.berkas]) bidang.style.aspectRatio = S.rasio[d.berkas];
      gbr.addEventListener("load", function () {
        S.rasio[d.berkas] = gbr.naturalWidth + " / " + gbr.naturalHeight;
        bidang.style.aspectRatio = S.rasio[d.berkas]; terapkan();
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

    // Gestur: seret = geser, cubit / roda = zoom, ketuk (tanpa geser) = taruh titik di mode atur
    var ptr = {}, awal = null, bergeser = false, mulai = null;
    function pt(ev) { var r = bidang.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
    function ukur() { var k = Object.keys(ptr); return { d: Math.hypot(ptr[k[0]].x - ptr[k[1]].x, ptr[k[0]].y - ptr[k[1]].y), x: (ptr[k[0]].x + ptr[k[1]].x) / 2, y: (ptr[k[0]].y + ptr[k[1]].y) / 2 }; }
    bidang.addEventListener("pointerdown", function (ev) {
      if (ev.button > 0) return;
      ptr[ev.pointerId] = pt(ev); mulai = { x: ev.clientX, y: ev.clientY }; bergeser = false;
      try { bidang.setPointerCapture(ev.pointerId); } catch (x) { /* abaikan */ }
      if (Object.keys(ptr).length === 2) { var m = ukur(); awal = { d: m.d, s: v.s, ax: (m.x - v.tx) / v.s, ay: (m.y - v.ty) / v.s }; bergeser = true; }
    });
    bidang.addEventListener("pointermove", function (ev) {
      if (!ptr[ev.pointerId]) return;
      var q = pt(ev), n = Object.keys(ptr).length, lama = ptr[ev.pointerId];
      if (n >= 2 && awal) {
        ptr[ev.pointerId] = q; var m = ukur();
        if (!m.d || !awal.d) return;
        v.s = Math.min(8, Math.max(1, awal.s * m.d / awal.d)); v.tx = m.x - awal.ax * v.s; v.ty = m.y - awal.ay * v.s; terapkan();
      } else {
        if (!bergeser && mulai && Math.abs(ev.clientX - mulai.x) + Math.abs(ev.clientY - mulai.y) > 5) bergeser = true;
        if (bergeser) { v.tx += q.x - lama.x; v.ty += q.y - lama.y; terapkan(); }
        ptr[ev.pointerId] = q;
      }
    });
    function lepas(ev, batal) {
      var tadiSatu = Object.keys(ptr).length === 1;
      delete ptr[ev.pointerId]; awal = null;
      if (!batal && tadiSatu && !bergeser && editAktif && S.pilih && d.id) {
        var q = posisi(ev, plat);
        d.pin[S.pilih] = [Math.round(q[0] * 10000) / 10000, Math.round(q[1] * 10000) / 10000];
        S.sel = S.pilih; tandaiKotor(d);
        var sisa = belumBertitik(d, zona);
        S.pilih = sisa.length ? sisa[0].zona : "";
        render();
      }
    }
    bidang.addEventListener("pointerup", function (ev) { lepas(ev, false); });
    bidang.addEventListener("pointercancel", function (ev) { lepas(ev, true); });
    bidang.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      var q = pt(ev); zoomDi(q.x, q.y, v.s * Math.exp(-ev.deltaY * 0.0015));
    }, { passive: false });
    bidang.addEventListener("dblclick", function (ev) {
      if (ev.target.classList.contains("peta-titik")) return;
      var q = pt(ev); if (v.s > 1.5) { v.s = 1; v.tx = 0; v.ty = 0; terapkan(); } else zoomDi(q.x, q.y, 3);
    });
    var kontrol = h("div", { class: "peta-zoomkontrol" },
      h("button", { type: "button", "aria-label": "Perbesar", title: "Perbesar", text: "+", onclick: function (ev) { ev.stopPropagation(); zoomDi(bidang.clientWidth / 2, bidang.clientHeight / 2, v.s * 1.5); } }),
      h("button", { type: "button", "aria-label": "Perkecil", title: "Perkecil", text: "\u2212", onclick: function (ev) { ev.stopPropagation(); zoomDi(bidang.clientWidth / 2, bidang.clientHeight / 2, v.s / 1.5); } }),
      h("button", { type: "button", "aria-label": "Ukuran awal", title: "Ukuran awal", text: "1:1", onclick: function (ev) { ev.stopPropagation(); v.s = 1; v.tx = 0; v.ty = 0; terapkan(); } }));
    ["pointerdown", "dblclick"].forEach(function (nm) { kontrol.addEventListener(nm, function (ev) { ev.stopPropagation(); }); });
    bidang.appendChild(kontrol);
    w.appendChild(bidang);
    terapkan();

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
      S.denah = (r.denah || []).map(function (d) {
        var l = lokal[d.id];
        // Titik yang belum disimpan di denah lain tetap dipertahankan.
        return { id: d.id, nama: d.nama || "", berkas: d.berkas || "", lantai: l && S.kotor[d.id] ? l.lantai : (d.lantai || ""), pin: l && S.kotor[d.id] ? l.pin : (d.pin || {}) };
      });
      S.aktif = Math.min(idx, S.denah.length - 1); if (S.aktif < 0) S.aktif = 0;
      S.kotorDaftar = false; S.menyimpan = false; S.sel = ""; S.pilih = "";
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
    if (DB.muatUlang) DB.muatUlang();
    if (!S.denah) muat();
    // Data status disegarkan tiap 30 detik agar titik berubah warna begitu petugas selesai memindai.
    if (timer) clearInterval(timer);
    timer = setInterval(function () { if (S.tampil && !S.edit && !document.hidden && DB.muatUlang) DB.muatUlang(); }, 30000);
  }
  function tinggalkan() { S.tampil = false; S.edit = false; if (timer) { clearInterval(timer); timer = null; } }

  DB.saatData(function () { if (S.tampil && !S.seret) render(); });
  DB.daftar({ id: "denah", judul: "Denah zona", grup: "pantau", izin: "semua", tampil: tampil, tinggalkan: tinggalkan });
})();
