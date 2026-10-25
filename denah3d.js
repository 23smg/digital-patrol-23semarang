/* Mesin tampilan denah: geser, zoom, putar, dan miring (3D) dengan animasi halus.
   Dipakai bersama oleh dashboard admin (peta.js) dan form petugas (index.js).
   Tanpa gaya inline: hanya CSSOM (el.style), jadi aman untuk CSP 'self'.

   Gestur
   - Satu jari / klik kiri : geser (mode 3D: putar dan miringkan)
   - Dua jari              : cubit = zoom, memutar jari = putar denah, geser = geser (mode 3D: geser)
   - Klik kanan / Shift    : kebalikan dari satu jari (putar saat datar, geser saat 3D)
   - Roda mouse            : zoom; Shift + roda = putar
   - Klik dua kali         : zoom masuk / keluar
*/
(function () {
  "use strict";
  var RAD = Math.PI / 180;
  function jepit(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function mudahkan(t) { return 1 - Math.pow(1 - t, 3); }
  function kurangiGerak() { try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function sudutDekat(dari, ke) { var d = ((ke - dari) % 360 + 540) % 360 - 180; return dari + d; }

  function buat(o) {
    var bidang = o.bidang, plat = o.plat, v = o.v;
    var MAKS = o.maks || 8, MIN = o.min || 1, TILT = o.tilt || 58;
    var ptr = {}, mode1 = "geser", sebelum = null, bergeser = false, mulai = null, anim = null, inersia = null, laju = { x: 0, y: 0, t: 0 }, hidup = true;
    if (typeof v.s !== "number") v.s = 1;
    ["tx", "ty", "rot", "tilt"].forEach(function (k) { if (typeof v[k] !== "number") v[k] = 0; });

    function datarSaja() { return !!(o.datar && o.datar()); }
    function gestur(b) { if (o.gestur) o.gestur(b); }

    function terapkan() {
      var W = bidang.clientWidth, H = bidang.clientHeight;
      v.s = jepit(v.s, MIN, MAKS);
      v.tilt = jepit(v.tilt, 0, 66);
      v.rot = ((v.rot % 360) + 540) % 360 - 180;
      if (W && H) {
        var datar = Math.abs(v.rot) < 0.5 && v.tilt < 0.5;
        var lx = datar ? (v.s - 1) * W / 2 : v.s * W * 0.45, ly = datar ? (v.s - 1) * H / 2 : v.s * H * 0.45;
        v.tx = jepit(v.tx, -lx, lx); v.ty = jepit(v.ty, -ly, ly);
      }
      plat.style.transform = "translate(" + v.tx + "px," + v.ty + "px) rotateX(" + v.tilt + "deg) rotateZ(" + v.rot + "deg) scale(" + v.s + ")";
      plat.style.setProperty("--inv", String(1 / v.s));
      plat.style.setProperty("--rz", (-v.rot) + "deg");
      plat.style.setProperty("--rx", (-v.tilt) + "deg");
      plat.style.setProperty("--angkat", ((o.angkat || 14) * Math.sin(v.tilt * RAD)) + "px");
      bidang.classList.toggle("miring", v.tilt > 0.5);
      if (o.siTerapkan) o.siTerapkan(v);
    }

    function henti() {
      if (anim) { cancelAnimationFrame(anim.id); anim = null; gestur(false); }
      if (inersia) { cancelAnimationFrame(inersia); inersia = null; }
    }

    // Animasi halus ke keadaan tujuan (s, tx, ty, rot, tilt)
    function animasi(tujuan, ms) {
      henti();
      var dari = { s: v.s, tx: v.tx, ty: v.ty, rot: v.rot, tilt: v.tilt };
      var ke = {};
      ["s", "tx", "ty", "rot", "tilt"].forEach(function (k) { ke[k] = typeof tujuan[k] === "number" ? tujuan[k] : dari[k]; });
      ke.rot = sudutDekat(dari.rot, ke.rot);
      ms = kurangiGerak() ? 0 : (ms || 380);
      if (!ms) { Object.keys(ke).forEach(function (k) { v[k] = ke[k]; }); terapkan(); return; }
      var t0 = performance.now();
      gestur(true);
      anim = { id: 0 };
      (function langkah(now) {
        if (!hidup) return;
        var p = Math.min(1, (now - t0) / ms), e = mudahkan(p);
        Object.keys(ke).forEach(function (k) { v[k] = dari[k] + (ke[k] - dari[k]) * e; });
        terapkan();
        if (p < 1) anim.id = requestAnimationFrame(langkah);
        else { anim = null; gestur(false); }
      })(t0);
    }

    // Zoom ke ns dengan titik (px,py) (koordinat bidang) tetap di bawah jari/kursor.
    function zoomRel(px, py, ns) {
      ns = jepit(ns, MIN, MAKS);
      var cx = bidang.clientWidth / 2, cy = bidang.clientHeight / 2, r = ns / v.s;
      v.tx = (px - cx) - r * ((px - cx) - v.tx);
      v.ty = (py - cy) - r * ((py - cy) - v.ty);
      v.s = ns;
    }
    function zoomDi(px, py, ns, animasikan) {
      ns = jepit(ns, MIN, MAKS);
      var cx = bidang.clientWidth / 2, cy = bidang.clientHeight / 2, r = ns / v.s;
      var tujuan = { s: ns, tx: (px - cx) - r * ((px - cx) - v.tx), ty: (py - cy) - r * ((py - cy) - v.ty) };
      if (animasikan) animasi(tujuan, 260); else { v.s = tujuan.s; v.tx = tujuan.tx; v.ty = tujuan.ty; terapkan(); }
    }
    // Putar di sekitar titik (px,py) sebesar d derajat (searah jarum jam positif).
    function putarDi(px, py, d) {
      var cx = bidang.clientWidth / 2, cy = bidang.clientHeight / 2;
      var ux = (px - cx) - v.tx, uy = (py - cy) - v.ty, c = Math.cos(d * RAD), s = Math.sin(d * RAD);
      v.tx = (px - cx) - (ux * c - uy * s); v.ty = (py - cy) - (ux * s + uy * c); v.rot += d;
    }

    // Posisi geser agar titik fokus (pecahan 0..1 pada denah) tetap di tengah setelah diputar dan dimiringkan.
    function geserFokus(rot, tilt, s) {
      var f = o.fokus && o.fokus();
      if (!f) return {};
      var ux = (f.x - 0.5) * plat.clientWidth * s, uy = (f.y - 0.5) * plat.clientHeight * s;
      var c = Math.cos(rot * RAD), sn = Math.sin(rot * RAD);
      return { tx: -(ux * c - uy * sn), ty: -((ux * sn + uy * c) * Math.cos(tilt * RAD)) };
    }
    function tiga(aktif) {
      if (aktif && datarSaja()) return;
      v.tiga = !!aktif;
      var t;
      if (aktif) {
        var rot = Math.abs(v.rot) < 1 ? -22 : v.rot;
        t = geserFokus(rot, TILT, v.s); t.tilt = TILT; t.rot = rot;
        animasi(t, 560);
      } else {
        var sk = Math.max(1, v.s);
        t = o.fokus ? geserFokus(0, 0, sk) : { tx: 0, ty: 0 }; t.tilt = 0; t.rot = 0; t.s = sk;
        animasi(t, 480);
      }
      if (o.ubahMode) o.ubahMode(v.tiga);
    }
    function reset() {
      v.tiga = false;
      animasi({ s: o.sAwal || 1, tx: o.txAwal || 0, ty: o.tyAwal || 0, rot: 0, tilt: 0 }, 460);
      if (o.ubahMode) o.ubahMode(false);
    }

    function pt(ev) { var r = bidang.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
    function ukur() {
      var k = Object.keys(ptr), a = ptr[k[0]], b = ptr[k[1]];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) / RAD, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    function jumlah() { return Object.keys(ptr).length; }

    bidang.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    bidang.addEventListener("pointerdown", function (ev) {
      if (!hidup) return;
      henti();
      ptr[ev.pointerId] = pt(ev);
      try { bidang.setPointerCapture(ev.pointerId); } catch (x) { /* abaikan */ }
      gestur(true);
      if (jumlah() === 1) {
        mulai = { x: ev.clientX, y: ev.clientY }; bergeser = false; laju = { x: 0, y: 0, t: 0 };
        var dasar = v.tiga ? "putar" : "geser", balik = ev.button > 0 || ev.shiftKey;
        mode1 = balik ? (dasar === "putar" ? "geser" : "putar") : dasar;
        if (datarSaja() && mode1 === "putar") mode1 = "geser";
        bidang.classList.toggle("memutar", mode1 === "putar");
      } else if (jumlah() === 2) { sebelum = ukur(); bergeser = true; }
    });
    bidang.addEventListener("pointermove", function (ev) {
      if (!ptr[ev.pointerId]) return;
      var q = pt(ev), lama = ptr[ev.pointerId];
      if (jumlah() >= 2 && sebelum) {
        ptr[ev.pointerId] = q;
        var m = ukur();
        if (!m.d || !sebelum.d) return;
        zoomRel(m.x, m.y, v.s * m.d / sebelum.d);
        if (!datarSaja()) putarDi(m.x, m.y, ((m.ang - sebelum.ang + 540) % 360) - 180);
        v.tx += m.x - sebelum.x; v.ty += m.y - sebelum.y;
        sebelum = m; terapkan();
        return;
      }
      if (!bergeser && mulai && Math.abs(ev.clientX - mulai.x) + Math.abs(ev.clientY - mulai.y) > 5) bergeser = true;
      if (bergeser) {
        var dx = q.x - lama.x, dy = q.y - lama.y;
        if (mode1 === "putar") { v.rot += dx * 0.45; v.tilt -= dy * 0.3; if (v.tilt > 0.5) v.tiga = v.tiga || false; }
        else {
          v.tx += dx; v.ty += dy;
          var t = performance.now(); laju = { x: dx, y: dy, t: t };
        }
        terapkan();
      }
      ptr[ev.pointerId] = q;
    });
    function lepas(ev, batal) {
      if (!ptr[ev.pointerId]) return;
      var tadiSatu = jumlah() === 1;
      delete ptr[ev.pointerId]; sebelum = null;
      if (jumlah() === 1) { var k = Object.keys(ptr)[0]; mulai = { x: ev.clientX, y: ev.clientY }; ptr[k] = ptr[k]; mode1 = "geser"; bidang.classList.remove("memutar"); }
      if (jumlah() === 0) {
        bidang.classList.remove("memutar");
        var ketuk = !batal && tadiSatu && !bergeser;
        if (ketuk && o.ketuk) o.ketuk(ev);
        var sisa = performance.now() - laju.t;
        if (!batal && tadiSatu && bergeser && mode1 === "geser" && laju.t && sisa < 80 && Math.hypot(laju.x, laju.y) > 2 && !kurangiGerak()) {
          var vx = laju.x, vy = laju.y;
          gestur(true);
          (function luncur() {
            vx *= 0.92; vy *= 0.92;
            if (!hidup || Math.hypot(vx, vy) < 0.4 || jumlah()) { inersia = null; if (!jumlah()) gestur(false); return; }
            v.tx += vx; v.ty += vy; terapkan();
            inersia = requestAnimationFrame(luncur);
          })();
        } else gestur(false);
        mode1 = "geser";
      }
    }
    bidang.addEventListener("pointerup", function (ev) { lepas(ev, false); });
    bidang.addEventListener("pointercancel", function (ev) { lepas(ev, true); });
    bidang.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      henti();
      var q = pt(ev);
      if (ev.shiftKey && !datarSaja()) { v.rot += (ev.deltaY || ev.deltaX) * 0.15; terapkan(); return; }
      zoomRel(q.x, q.y, v.s * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)));
      terapkan();
    }, { passive: false });
    bidang.addEventListener("dblclick", function (ev) {
      if (o.tahanKlikGanda && o.tahanKlikGanda(ev)) return;
      var q = pt(ev);
      if (v.s > 1.5) animasi({ s: o.sAwal || 1, tx: o.txAwal || 0, ty: o.tyAwal || 0 }, 320); else zoomDi(q.x, q.y, Math.max(3, (o.sAwal || 1)), true);
    });

    terapkan();
    return {
      v: v, terapkan: terapkan, zoomDi: zoomDi, animasi: animasi, tiga: tiga, reset: reset, henti: henti,
      hapus: function () { hidup = false; henti(); }
    };
  }

  window.Denah3D = { buat: buat };
})();
