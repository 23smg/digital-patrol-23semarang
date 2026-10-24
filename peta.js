/* peta.js - halaman Denah zona.
   Admin menaruh titik tiap zona (lokasi QR patroli) di gambar denah. Warna titik mengikuti status zona
   pada sesi berjalan (hitungan yang sama dengan Cakupan zona), jadi begitu petugas memindai QR di titik itu
   dan laporan masuk, titiknya berubah hijau di dashboard. */
(function () {
  "use strict";
  var DB = window.DB, PC = window.PC, h = PC.h, $ = DB.$;
  var JUMLAH = 4;
  var S = { tampil: false, denah: null, aktif: 0, edit: false, pilih: "", sel: "", info: "", lantai: {}, kotor: {}, seret: false, menyimpan: false, galat: "" };
  var LABEL = { ok: "Sudah sesi ini", belum: "Belum", mepet: "Segera", tanpa: "Tanpa petugas" };
  var timer = null;

  function boleh() { return !!(DB.S.user && DB.S.user.bisaUbah); }
  function pendek(z) { var p = String(z).split(" - "); var t = p[p.length - 1]; return t.length > 5 ? t.slice(0, 5) : t; }
  function berlalu() { return DB.data && DB.data.waktu ? Math.floor((Date.now() - DB.data.waktu) / 60000) : 0; }
  function cur() { return S.denah ? S.denah[S.aktif] : null; }

  function muat() {
    S.galat = "";
    return DB.panggil("petaZonaAmbil", {}, 30000).then(function (r) {
      S.denah = (r.denah || []).map(function (d) { return { id: d.id, lantai: d.lantai || "", pin: d.pin || {} }; });
      render();
    }).catch(function (e) { S.galat = (e && e.message) || "Gagal memuat denah."; render(); });
  }

  function daftarLantai(zona) {
    var u = {};
    zona.forEach(function (z) { if (z.lantai) u[z.lantai] = 1; });
    return Object.keys(u).sort(function (a, b) { return a.localeCompare(b, "id", { numeric: true }); });
  }

  function simpan() {
    var d = cur();
    if (!d || S.menyimpan) return;
    S.menyimpan = true; render();
    DB.panggil("petaZonaSimpan", { denah: d.id, lantai: d.lantai, pin: d.pin }, 40000).then(function (r) {
      S.denah[S.aktif] = { id: r.denah.id, lantai: r.denah.lantai, pin: r.denah.pin };
      S.kotor[d.id] = false; S.menyimpan = false; S.sel = "";
      PC.toast("Titik denah tersimpan.", "ok"); render();
    }).catch(function (e) {
      S.menyimpan = false; PC.toast((e && e.message) || "Gagal menyimpan titik.", "bad"); render();
    });
  }

  function batal() {
    var d = cur();
    if (!d) return;
    S.kotor[d.id] = false; S.sel = ""; S.pilih = "";
    S.denah = null; render(); muat();
  }

  function posisi(ev, bidang) {
    var r = bidang.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))];
  }

  function belumBertitik(d, zona) {
    return zona.filter(function (z) { return !d.pin[z.zona] && (!d.lantai || z.lantai === d.lantai); });
  }

  function pasangTitik(d, bidang, zona, status) {
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
          var q = posisi(ev, bidang);
          el.style.left = (q[0] * 100) + "%"; el.style.top = (q[1] * 100) + "%";
          d.pin[nama] = [Math.round(q[0] * 10000) / 10000, Math.round(q[1] * 10000) / 10000];
        });
        el.addEventListener("pointerup", function () {
          if (!S.seret) return;
          S.seret = false;
          if (gerak) S.kotor[d.id] = true;
          S.sel = nama; S.pilih = "";
          render();
        });
      } else {
        el.addEventListener("click", function (ev) { ev.stopPropagation(); S.info = S.info === nama ? "" : nama; render(); });
      }
      bidang.appendChild(el);
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
        text: (x.lantai ? "Lantai " + x.lantai : "Denah " + (i + 1)) + (S.kotor[x.id] ? " *" : ""),
        onclick: function () { S.aktif = i; S.sel = ""; S.info = ""; S.pilih = ""; render(); } }));
    });
    var kanan = h("div", { class: "rapat" });
    if (boleh()) kanan.appendChild(h("button", { type: "button", class: "btn btn-kecil " + (editAktif ? "" : "btn-garis"), text: editAktif ? "Selesai mengatur" : "Atur titik",
      onclick: function () { S.edit = !S.edit; S.sel = ""; S.pilih = ""; S.info = ""; render(); } }));
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

    // Gambar denah + titik
    var bidang = h("div", { class: "peta-bidang" + (editAktif && S.pilih ? " menaruh" : "") });
    bidang.appendChild(h("img", { class: "peta-gambar", src: "denah/d" + (S.aktif + 1) + ".jpg", alt: "Denah " + (S.aktif + 1), draggable: "false" }));
    if (editAktif) {
      bidang.addEventListener("click", function (ev) {
        if (!S.pilih || ev.target.classList.contains("peta-titik")) return;
        var q = posisi(ev, bidang);
        d.pin[S.pilih] = [Math.round(q[0] * 10000) / 10000, Math.round(q[1] * 10000) / 10000];
        S.kotor[d.id] = true; S.sel = S.pilih;
        var sisa = belumBertitik(d, zona);
        S.pilih = sisa.length ? sisa[0].zona : "";
        render();
      });
    }
    pasangTitik(d, bidang, zona, status);
    w.appendChild(bidang);

    // Rincian zona yang diketuk (mode lihat)
    if (!editAktif && S.info && status && status[S.info]) {
      var st = status[S.info];
      w.appendChild(h("div", { class: "peta-info s-" + st.s },
        h("b", { text: S.info }), h("span", { class: "lencana " + ({ ok: "l-ok", belum: "l-warn", mepet: "l-bad", tanpa: "l-abu" })[st.s], text: LABEL[st.s] }),
        h("span", { class: "oleh", text: st.info + " · hari ini " + st.z.hariIni + " kali" })));
    }

    if (editAktif) w.appendChild(panelAtur(d, zona));
    else if (!Object.keys(d.pin).length) {
      w.appendChild(h("div", { class: "pengantar", text: boleh()
        ? "Denah ini belum punya titik. Klik \"Atur titik\" untuk menaruh lokasi QR zona di gambar."
        : "Denah ini belum punya titik. Minta admin untuk mengaturnya." }));
    }
  }

  function panelAtur(d, zona) {
    var lantai = daftarLantai(zona);
    var pilih = h("select", { class: "input", "aria-label": "Lantai denah", onchange: function (ev) { d.lantai = ev.target.value; S.kotor[d.id] = true; S.pilih = ""; render(); } },
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
      h("button", { type: "button", class: "btn btn-kecil", text: S.menyimpan ? "Menyimpan..." : "Simpan titik", disabled: !S.kotor[d.id] || S.menyimpan, onclick: simpan }),
      h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Batalkan perubahan", disabled: !S.kotor[d.id] || S.menyimpan, onclick: batal }));
    if (S.sel && d.pin[S.sel]) {
      aksi.appendChild(h("button", { type: "button", class: "btn btn-kecil btn-garis", text: "Hapus titik " + S.sel,
        onclick: function () { delete d.pin[S.sel]; S.sel = ""; S.kotor[d.id] = true; render(); } }));
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
