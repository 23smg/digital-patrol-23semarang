/* jsqr.js - Pembaca QR ringkas tanpa dependensi.
 * Pakai: var hasil = window.jsQR(imageData.data, lebar, tinggi);  // {data: "teks"} atau null
 * Mendukung QR Model 2 versi 1-15 (semua level koreksi), mode Numeric/Alphanumeric/Byte(UTF-8),
 * QR miring/terputar/perspektif, dan QR terbalik (putih di atas hitam).
 */
(function (g) {
  "use strict";

  /* ---------- GF(256) & Reed-Solomon ---------- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1, i;
    for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function gdiv(a, b) { return a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0; }

  // msg = [data..., ec...] (diubah di tempat). true bila valid / berhasil diperbaiki.
  function rsDecode(msg, nsym) {
    var n = msg.length, synd = [], bad = false, i, j, k;
    for (i = 0; i < nsym; i++) {
      var s = 0;
      for (j = 0; j < n; j++) s = gmul(s, EXP[i]) ^ msg[j];
      synd.push(s); if (s) bad = true;
    }
    if (!bad) return true;
    // Berlekamp-Massey
    var C = [1], B = [1], L = 0, m = 1, b = 1, T, d, coef;
    for (var r = 0; r < nsym; r++) {
      d = synd[r];
      for (i = 1; i <= L; i++) d ^= gmul(C[i] || 0, synd[r - i]);
      if (d === 0) { m++; continue; }
      coef = gdiv(d, b);
      if (2 * L <= r) {
        T = C.slice();
        while (C.length < B.length + m) C.push(0);
        for (i = 0; i < B.length; i++) C[i + m] ^= gmul(coef, B[i]);
        L = r + 1 - L; B = T; b = d; m = 1;
      } else {
        while (C.length < B.length + m) C.push(0);
        for (i = 0; i < B.length; i++) C[i + m] ^= gmul(coef, B[i]);
        m++;
      }
    }
    if (2 * L > nsym) return false;
    // Chien search
    var pos = [], xs = [];
    for (j = 0; j < n; j++) {
      var deg = n - 1 - j, xinv = EXP[(255 - deg) % 255], v = 0;
      for (k = C.length - 1; k >= 0; k--) v = gmul(v, xinv) ^ C[k];
      if (v === 0) { pos.push(j); xs.push(EXP[deg % 255]); }
    }
    if (pos.length !== L) return false;
    // Forney: omega = (S(x) * C(x)) mod x^nsym
    var omega = [];
    for (i = 0; i < nsym; i++) {
      var o = 0;
      for (j = 0; j <= i && j < C.length; j++) o ^= gmul(C[j], synd[i - j]);
      omega.push(o);
    }
    for (i = 0; i < pos.length; i++) {
      var X = xs[i], Xi = gdiv(1, X), num = 0, den = 0;
      for (k = omega.length - 1; k >= 0; k--) num = gmul(num, Xi) ^ omega[k];
      for (k = 1; k < C.length; k += 2) { // turunan formal: suku ganjil
        var pw = 1, q;
        for (q = 0; q < k - 1; q++) pw = gmul(pw, Xi);
        den ^= gmul(C[k], pw);
      }
      if (den === 0) return false;
      msg[pos[i]] ^= gmul(X, gdiv(num, den));
    }
    for (i = 0; i < nsym; i++) { // verifikasi
      var s2 = 0;
      for (j = 0; j < n; j++) s2 = gmul(s2, EXP[i]) ^ msg[j];
      if (s2) return false;
    }
    return true;
  }

  /* ---------- Tabel QR ---------- */
  // [ec per blok, jumlah blok] untuk level L, M, Q, H; versi 1..15
  var BLK = [null,
    [[7,1],[10,1],[13,1],[17,1]], [[10,1],[16,1],[22,1],[28,1]], [[15,1],[26,1],[18,2],[22,2]],
    [[20,1],[18,2],[26,2],[16,4]], [[26,1],[24,2],[18,4],[22,4]], [[18,2],[16,4],[24,4],[28,4]],
    [[20,2],[18,4],[18,6],[26,5]], [[24,2],[22,4],[22,6],[26,6]], [[30,2],[22,5],[20,8],[24,8]],
    [[18,4],[26,5],[24,8],[28,8]], [[20,4],[30,5],[28,8],[24,11]], [[24,4],[22,8],[26,10],[28,11]],
    [[26,4],[22,9],[24,12],[22,16]], [[30,4],[24,9],[20,16],[24,16]], [[22,6],[24,10],[30,12],[24,18]]
  ];
  var ALIGN = [null, [], [6,18], [6,22], [6,26], [6,30], [6,34], [6,22,38], [6,24,42], [6,26,46],
    [6,28,50], [6,30,54], [6,32,58], [6,34,62], [6,26,46,66], [6,26,48,70]];
  var MAXV = 15;

  function totalCW(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) { var na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; }
    return Math.floor(r / 8);
  }

  // Kode format (15 bit) -> data 5 bit
  var FMT = [];
  (function () {
    for (var d = 0; d < 32; d++) {
      var r = d << 10;
      for (var i = 14; i >= 10; i--) if ((r >> i) & 1) r ^= 0x537 << (i - 10);
      FMT.push({ bits: ((d << 10) | r) ^ 0x5412, data: d });
    }
  })();
  function popcount(x) { var c = 0; while (x) { c += x & 1; x >>= 1; } return c; }
  function fmtLookup(bits) {
    var best = null, bd = 99;
    for (var i = 0; i < 32; i++) { var d = popcount(bits ^ FMT[i].bits); if (d < bd) { bd = d; best = FMT[i].data; } }
    return bd <= 3 ? best : -1;
  }

  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (((i / 2) | 0) + ((j / 3) | 0)) % 2 === 0; },
    function (i, j) { return ((i * j) % 2) + ((i * j) % 3) === 0; },
    function (i, j) { return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0; },
    function (i, j) { return ((((i + j) % 2) + ((i * j) % 3)) % 2) === 0; }
  ];

  function funcMap(dim, v) {
    var f = new Uint8Array(dim * dim), x, y;
    function box(x0, y0, x1, y1) { for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < dim && y < dim) f[y * dim + x] = 1; }
    box(0, 0, 8, 8); box(dim - 8, 0, dim - 1, 8); box(0, dim - 8, 8, dim - 1);
    for (x = 0; x < dim; x++) { f[6 * dim + x] = 1; f[x * dim + 6] = 1; }
    var a = ALIGN[v], i, j;
    for (i = 0; i < a.length; i++) for (j = 0; j < a.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === a.length - 1) || (i === a.length - 1 && j === 0)) continue;
      box(a[i] - 2, a[j] - 2, a[i] + 2, a[j] + 2);
    }
    if (v >= 7) { box(dim - 11, 0, dim - 9, 5); box(0, dim - 11, 5, dim - 9); }
    return f;
  }

  /* ---------- Decode matriks -> teks ---------- */
  var ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

  function utf8(bytes) {
    try { if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)); } catch (e) {}
    var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s;
  }

  function parseBits(data, v) {
    var pos = 0, total = data.length * 8, out = "";
    function read(n) {
      if (pos + n > total) return -1;
      var r = 0;
      for (var i = 0; i < n; i++, pos++) r = (r << 1) | ((data[pos >> 3] >> (7 - (pos & 7))) & 1);
      return r;
    }
    var cb = v <= 9 ? [10, 9, 8] : [12, 11, 16];
    while (total - pos >= 4) {
      var mode = read(4), n, i;
      if (mode <= 0) break;
      if (mode === 1) {
        n = read(cb[0]); if (n < 0) return null;
        while (n >= 3) { i = read(10); if (i < 0 || i > 999) return null; out += ("00" + i).slice(-3); n -= 3; }
        if (n === 2) { i = read(7); if (i < 0 || i > 99) return null; out += ("0" + i).slice(-2); }
        else if (n === 1) { i = read(4); if (i < 0 || i > 9) return null; out += i; }
      } else if (mode === 2) {
        n = read(cb[1]); if (n < 0) return null;
        while (n >= 2) { i = read(11); if (i < 0 || i >= 45 * 45) return null; out += ALNUM[(i / 45) | 0] + ALNUM[i % 45]; n -= 2; }
        if (n === 1) { i = read(6); if (i < 0 || i >= 45) return null; out += ALNUM[i]; }
      } else if (mode === 4) {
        n = read(cb[2]); if (n < 0) return null;
        var bytes = [];
        for (i = 0; i < n; i++) { var b = read(8); if (b < 0) return null; bytes.push(b); }
        out += utf8(bytes);
      } else if (mode === 7) {
        var e = read(8); if (e < 0) return null;
        if ((e & 0xc0) === 0x80) read(8); else if ((e & 0xe0) === 0xc0) read(16);
      } else if (mode === 3) { read(16); }
      else if (mode === 5) { /* FNC1 */ }
      else if (mode === 9) { read(8); }
      else return null; // Kanji / lainnya tidak didukung
    }
    return out;
  }

  function decodeWithFormat(m, dim, v, fmt) {
    // bit level koreksi di format: 1=L, 0=M, 3=Q, 2=H -> indeks tabel (L=0, M=1, Q=2, H=3)
    var ecIdx = { 1: 0, 0: 1, 3: 2, 2: 3 }[fmt >> 3];
    var mask = MASKS[fmt & 7], f = funcMap(dim, v), bytes = [], cur = 0, nb = 0, up = true, x, k, c, y;
    for (x = dim - 1; x > 0; x -= 2) {
      if (x === 6) x = 5;
      for (k = 0; k < dim; k++) {
        y = up ? dim - 1 - k : k;
        for (c = 0; c < 2; c++) {
          var xx = x - c;
          if (!f[y * dim + xx]) {
            var bit = m[y * dim + xx] ^ (mask(y, xx) ? 1 : 0);
            cur = (cur << 1) | bit; nb++;
            if (nb === 8) { bytes.push(cur); cur = 0; nb = 0; }
          }
        }
      }
      up = !up;
    }
    var total = totalCW(v);
    if (bytes.length < total) return null;
    var be = BLK[v][ecIdx], ec = be[0], nBlk = be[1];
    var totalData = total - ec * nBlk, shortLen = Math.floor(totalData / nBlk), nLong = totalData % nBlk;
    var blocks = [], lens = [], b, i;
    for (b = 0; b < nBlk; b++) { lens.push(shortLen + (b >= nBlk - nLong ? 1 : 0)); blocks.push([]); }
    var p = 0, maxLen = shortLen + (nLong ? 1 : 0);
    for (i = 0; i < maxLen; i++) for (b = 0; b < nBlk; b++) if (i < lens[b]) blocks[b].push(bytes[p++]);
    var eccs = [];
    for (b = 0; b < nBlk; b++) eccs.push([]);
    for (i = 0; i < ec; i++) for (b = 0; b < nBlk; b++) eccs[b].push(bytes[p++]);
    var data = [];
    for (b = 0; b < nBlk; b++) {
      var msg = blocks[b].concat(eccs[b]);
      if (!rsDecode(msg, ec)) return null;
      for (i = 0; i < lens[b]; i++) data.push(msg[i]);
    }
    return parseBits(data, v);
  }

  function decodeMatrix(m, dim) {
    var v = (dim - 17) / 4;
    if (v < 1 || v > MAXV || v !== Math.floor(v)) return null;
    function bit(x, y) { return m[y * dim + x] ? 1 : 0; }
    var b1 = 0, b2 = 0, i, j;
    for (i = 0; i < 6; i++) b1 = (b1 << 1) | bit(i, 8);
    b1 = (b1 << 1) | bit(7, 8); b1 = (b1 << 1) | bit(8, 8); b1 = (b1 << 1) | bit(8, 7);
    for (j = 5; j >= 0; j--) b1 = (b1 << 1) | bit(8, j);
    for (j = dim - 1; j >= dim - 7; j--) b2 = (b2 << 1) | bit(8, j);
    for (i = dim - 8; i < dim; i++) b2 = (b2 << 1) | bit(i, 8);
    var cands = [], f1 = fmtLookup(b1), f2 = fmtLookup(b2);
    if (f1 >= 0) cands.push(f1);
    if (f2 >= 0 && f2 !== f1) cands.push(f2);
    for (i = 0; i < cands.length; i++) {
      var r = decodeWithFormat(m, dim, v, cands[i]);
      if (r !== null && r !== undefined) return r;
    }
    return null;
  }

  /* ---------- Binarisasi lokal ---------- */
  function binarize(lum, w, h) {
    if (w < 40 || h < 40) return null;
    var B = 8, sw = Math.ceil(w / B), sh = Math.ceil(h / B), bp = new Float32Array(sw * sh), x, y, xx, yy;
    for (y = 0; y < sh; y++) {
      var yo = Math.min(y * B, h - B);
      for (x = 0; x < sw; x++) {
        var xo = Math.min(x * B, w - B), sum = 0, mn = 255, mx = 0;
        for (yy = 0; yy < B; yy++) {
          var off = (yo + yy) * w + xo;
          for (xx = 0; xx < B; xx++) { var p = lum[off + xx]; sum += p; if (p < mn) mn = p; if (p > mx) mx = p; }
        }
        var avg = sum / 64;
        if (mx - mn <= 24) {
          avg = mn / 2;
          if (y > 0 && x > 0) {
            var nbr = (bp[(y - 1) * sw + x] + 2 * bp[y * sw + x - 1] + bp[(y - 1) * sw + x - 1]) / 4;
            if (mn < nbr) avg = nbr;
          }
        }
        bp[y * sw + x] = avg;
      }
    }
    var bin = new Uint8Array(w * h);
    for (y = 0; y < sh; y++) {
      var top = Math.min(Math.max(y, 2), sh - 3);
      for (x = 0; x < sw; x++) {
        var left = Math.min(Math.max(x, 2), sw - 3), s2 = 0, dy, dx;
        for (dy = -2; dy <= 2; dy++) for (dx = -2; dx <= 2; dx++) s2 += bp[(top + dy) * sw + left + dx];
        var th = s2 / 25, yo2 = Math.min(y * B, h - B), xo2 = Math.min(x * B, w - B);
        for (yy = 0; yy < B; yy++) {
          var o2 = (yo2 + yy) * w + xo2;
          for (xx = 0; xx < B; xx++) if (lum[o2 + xx] <= th) bin[o2 + xx] = 1;
        }
      }
    }
    return bin;
  }

  /* ---------- Deteksi pola finder ---------- */
  function foundCross(st) {
    var total = st[0] + st[1] + st[2] + st[3] + st[4];
    if (total < 7) return false;
    var ms = total / 7, mv = ms / 2;
    return Math.abs(ms - st[0]) < mv && Math.abs(ms - st[1]) < mv && Math.abs(3 * ms - st[2]) < 3 * mv &&
      Math.abs(ms - st[3]) < mv && Math.abs(ms - st[4]) < mv;
  }

  function crossCheck(bin, w, h, fx, fy, vert, maxCount, orig) {
    var st = [0, 0, 0, 0, 0], len = vert ? h : w, start = vert ? fy : fx, i = start;
    function b(k) { return vert ? bin[k * w + fx] : bin[fy * w + k]; }
    if (fx < 0 || fy < 0 || fx >= w || fy >= h) return NaN;
    while (i >= 0 && b(i)) { st[2]++; i--; }
    if (i < 0) return NaN;
    while (i >= 0 && !b(i) && st[1] <= maxCount) { st[1]++; i--; }
    if (i < 0 || st[1] > maxCount) return NaN;
    while (i >= 0 && b(i) && st[0] <= maxCount) { st[0]++; i--; }
    if (st[0] > maxCount) return NaN;
    i = start + 1;
    while (i < len && b(i)) { st[2]++; i++; }
    if (i === len) return NaN;
    while (i < len && !b(i) && st[3] < maxCount) { st[3]++; i++; }
    if (i === len || st[3] >= maxCount) return NaN;
    while (i < len && b(i) && st[4] < maxCount) { st[4]++; i++; }
    if (st[4] >= maxCount) return NaN;
    var tot = st[0] + st[1] + st[2] + st[3] + st[4];
    if (5 * Math.abs(tot - orig) >= (vert ? 2 : 1) * orig) return NaN;
    return foundCross(st) ? (i - st[4] - st[3]) - st[2] / 2 : NaN;
  }

  function findFinders(bin, w, h) {
    var cands = [], skip = Math.max(1, Math.floor(h / 150)), y, x;
    function handle(st, row, endX) {
      var tot = st[0] + st[1] + st[2] + st[3] + st[4];
      var cx = (endX - st[4] - st[3]) - st[2] / 2;
      var cy = crossCheck(bin, w, h, Math.floor(cx), row, true, st[2], tot);
      if (isNaN(cy)) return;
      cx = crossCheck(bin, w, h, Math.floor(cx), Math.floor(cy), false, st[2], tot);
      if (isNaN(cx)) return;
      var size = tot / 7, k;
      for (k = 0; k < cands.length; k++) {
        var c = cands[k];
        if (Math.abs(cy - c.y) <= size && Math.abs(cx - c.x) <= size) {
          var df = Math.abs(size - c.size);
          if (df <= 1 || df <= c.size) {
            c.x = (c.count * c.x + cx) / (c.count + 1); c.y = (c.count * c.y + cy) / (c.count + 1);
            c.size = (c.count * c.size + size) / (c.count + 1); c.count++;
            return;
          }
        }
      }
      cands.push({ x: cx, y: cy, size: size, count: 1 });
    }
    for (y = skip - 1; y < h; y += skip) {
      var st = [0, 0, 0, 0, 0], cs = 0, off = y * w;
      for (x = 0; x < w; x++) {
        if (bin[off + x]) {
          if (cs & 1) cs++;
          st[cs]++;
        } else if (!(cs & 1)) {
          if (cs === 4) {
            if (foundCross(st)) handle(st, y, x);
            st[0] = st[2]; st[1] = st[3]; st[2] = st[4]; st[3] = 1; st[4] = 0; cs = 3;
          } else st[++cs]++;
        } else st[cs]++;
      }
      if (cs === 4 && foundCross(st)) handle(st, y, w);
    }
    return cands;
  }

  function bestTriples(cands) {
    var good = cands.filter(function (c) { return c.count >= 2; });
    if (good.length < 3) good = cands.slice();
    good.sort(function (a, b) { return b.count - a.count; });
    good = good.slice(0, 10);
    var res = [], i, j, k;
    for (i = 0; i < good.length; i++) for (j = i + 1; j < good.length; j++) for (k = j + 1; k < good.length; k++) {
      var P = [good[i], good[j], good[k]];
      var sz = [P[0].size, P[1].size, P[2].size], mn = Math.min.apply(null, sz), mx = Math.max.apply(null, sz);
      if (mx / mn > 1.6) continue;
      var d = [dist(P[1], P[2]), dist(P[0], P[2]), dist(P[0], P[1])]; // sisi di seberang titik i
      var order = [0, 1, 2].sort(function (a, b) { return d[a] - d[b]; });
      var s1 = d[order[0]], s2 = d[order[1]], s3 = d[order[2]];
      var avgSize = (sz[0] + sz[1] + sz[2]) / 3;
      if (s1 / avgSize < 9) continue;
      var e1 = Math.abs(s1 - s2) / Math.max(s1, s2), e2 = Math.abs(s3 - Math.sqrt(s1 * s1 + s2 * s2)) / s3;
      if (e1 > 0.3 || e2 > 0.2) continue;
      var tl = P[order[2]]; // titik di seberang sisi terpanjang
      var o = [P[0], P[1], P[2]].filter(function (p) { return p !== tl; });
      var tr = o[0], bl = o[1];
      var cross = (tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x);
      if (cross < 0) { var t = tr; tr = bl; bl = t; }
      res.push({ score: e1 + e2 + (mx / mn - 1) * 0.3 - (P[0].count + P[1].count + P[2].count) * 0.01, tl: tl, tr: tr, bl: bl });
    }
    res.sort(function (a, b) { return a.score - b.score; });
    return res.slice(0, 4);
  }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

  /* ---------- Pola alignment, homografi, sampling ---------- */
  function px(bin, w, h, x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return -1;
    return bin[iy * w + ix];
  }

  function findAlign(bin, w, h, ex, ey, ux, uy, vx, vy) {
    var allow = [4, 8, 16], ai, a, dx, dy;
    function score(cx, cy) {
      var s = 0, i, j;
      for (j = -2; j <= 2; j++) for (i = -2; i <= 2; i++) {
        var want = (Math.max(Math.abs(i), Math.abs(j)) === 2 || (i === 0 && j === 0)) ? 1 : 0;
        if (px(bin, w, h, cx + i * ux + j * vx, cy + i * uy + j * vy) === want) s++;
      }
      return s;
    }
    for (ai = 0; ai < allow.length; ai++) {
      a = allow[ai];
      var best = -1, bx = 0, by = 0, bd = 1e9;
      for (dy = -a; dy <= a; dy += 0.5) for (dx = -a; dx <= a; dx += 0.5) {
        var cx = ex + dx * ux + dy * vx, cy = ey + dx * uy + dy * vy, s = score(cx, cy), dd = dx * dx + dy * dy;
        if (s > best || (s === best && dd < bd)) { best = s; bx = cx; by = cy; bd = dd; }
      }
      if (best >= 21) {
        var rb = best, rx = bx, ry = by;
        for (dy = -0.5; dy <= 0.5; dy += 0.25) for (dx = -0.5; dx <= 0.5; dx += 0.25) {
          var x2 = bx + dx * ux + dy * vx, y2 = by + dx * uy + dy * vy, s2 = score(x2, y2);
          if (s2 > rb) { rb = s2; rx = x2; ry = y2; }
        }
        return { x: rx, y: ry };
      }
    }
    return null;
  }

  function homog(src, dst) {
    var A = [], i, j, k;
    for (i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (i = 0; i < 8; i++) {
      var piv = i;
      for (j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      if (Math.abs(A[piv][i]) < 1e-12) return null;
      var t = A[i]; A[i] = A[piv]; A[piv] = t;
      for (j = 0; j < 8; j++) {
        if (j === i) continue;
        var f = A[j][i] / A[i][i];
        for (k = i; k < 9; k++) A[j][k] -= f * A[i][k];
      }
    }
    var h = [];
    for (i = 0; i < 8; i++) h.push(A[i][8] / A[i][i]);
    return h;
  }
  function mapPt(H, x, y) {
    var d = H[6] * x + H[7] * y + 1;
    return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
  }

  function sampleGrid(bin, w, h, H, dim) {
    var m = new Uint8Array(dim * dim), offs = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]], i, j, k;
    for (j = 0; j < dim; j++) for (i = 0; i < dim; i++) {
      var vt = 0;
      for (k = 0; k < 5; k++) {
        var p = mapPt(H, i + offs[k][0], j + offs[k][1]), s = px(bin, w, h, p[0], p[1]);
        if (s === 1) vt++;
      }
      m[j * dim + i] = vt >= 3 ? 1 : 0;
    }
    return m;
  }

  function tryTriple(bin, w, h, t) {
    var tl = t.tl, tr = t.tr, bl = t.bl, ms = (tl.size + tr.size + bl.size) / 3;
    // ukuran modul dihitung per sisi (perspektif membuat ukurannya berbeda)
    var d1 = dist(tl, tr) / ((tl.size + tr.size) / 2), d2 = dist(tl, bl) / ((tl.size + bl.size) / 2);
    var est = Math.round((d1 + d2) / 2) + 7, base = 1 + 4 * Math.round((est - 1) / 4);
    var dims = [base, base - 4, base + 4], n, r;
    for (n = 0; n < dims.length; n++) {
      var dim = dims[n];
      if (dim < 21 || dim > 17 + 4 * MAXV) continue;
      var span = dim - 7;
      var ux = (tr.x - tl.x) / span, uy = (tr.y - tl.y) / span, vx = (bl.x - tl.x) / span, vy = (bl.y - tl.y) / span;
      var brx = tr.x - tl.x + bl.x, bry = tr.y - tl.y + bl.y;
      var src = [[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5]], dst = [[tl.x, tl.y], [tr.x, tr.y], [bl.x, bl.y]];
      var H = null;
      if (dim >= 25) {
        var corr = 1 - 3 / (dim - 7), ex = tl.x + corr * (brx - tl.x), ey = tl.y + corr * (bry - tl.y);
        // ukuran modul di dekat sudut kanan-bawah (diekstrapolasi dari ketiga finder)
        var mbr = Math.max(0.6 * ms, Math.min(1.6 * ms, tr.size + bl.size - tl.size));
        var lu = Math.sqrt(ux * ux + uy * uy), lv = Math.sqrt(vx * vx + vy * vy);
        var ap = findAlign(bin, w, h, ex, ey, ux / lu * mbr, uy / lu * mbr, vx / lv * mbr, vy / lv * mbr);
        if (ap) H = homog(src.concat([[dim - 6.5, dim - 6.5]]), dst.concat([[ap.x, ap.y]]));
      }
      var Hs = [];
      if (H) Hs.push(H);
      // cadangan: titik kanan-bawah perkiraan = TR + BL - TL (pusat finder virtual)
      var Haff = homog(src.concat([[dim - 3.5, dim - 3.5]]), dst.concat([[brx, bry]]));
      if (Haff) Hs.push(Haff);
      for (var q = 0; q < Hs.length; q++) {
        var m = sampleGrid(bin, w, h, Hs[q], dim);
        r = decodeMatrix(m, dim);
        if (r !== null && r !== undefined) return r;
      }
      // Cadangan untuk foto kamera HP: perspektif membuat titik kanan-bawah meleset (terutama QR kecil versi 1-2
      // yang tanpa pola alignment). Geser titik itu sedikit demi sedikit; hasil sah bila lolos Reed-Solomon.
      r = searchCorner(bin, w, h, src, dst, dim, ap, brx, bry, ms);
      if (r !== null) return r;
    }
    return null;
  }

  var T_AKHIR = 0;
  function searchCorner(bin, w, h, src, dst, dim, ap, brx, by0, ms) {
    var useAlign = !!ap, bx = useAlign ? ap.x : brx, by = useAlign ? ap.y : by0;
    var target = useAlign ? [dim - 6.5, dim - 6.5] : [dim - 3.5, dim - 3.5];
    var step = Math.max(0.5, ms * 0.45), rad = ms * (useAlign ? 1.4 : 3), list = [], a, b;
    for (a = -rad; a <= rad + 1e-6; a += step) for (b = -rad; b <= rad + 1e-6; b += step) {
      if (a === 0 && b === 0) continue;
      list.push([a, b, a * a + b * b]);
    }
    list.sort(function (p, q) { return p[2] - q[2]; });
    var t0 = Date.now(), i;
    for (i = 0; i < list.length; i++) {
      if (Date.now() - t0 > 90) break;   // batasi waktu per kandidat agar kamera tetap lancar
      var H = homog(src.concat([target]), dst.concat([[bx + list[i][0], by + list[i][1]]]));
      if (!H) continue;
      var r = decodeMatrix(sampleGrid(bin, w, h, H, dim), dim);
      if (r !== null && r !== undefined) return r;
    }
    return null;
  }

  function scan(bin, w, h) {
    var c = findFinders(bin, w, h);
    if (c.length < 3) return null;
    var ts = bestTriples(c), i;
    for (i = 0; i < ts.length; i++) {
      var r = tryTriple(bin, w, h, ts[i]);
      if (r !== null) return r;
    }
    return null;
  }

  /* ---------- API ---------- */
  g.jsQR = function (data, width, height) {
    var w = width, h = height, n = w * h, lum = new Uint8Array(n), i;
    for (i = 0; i < n; i++) lum[i] = (data[4 * i] * 306 + data[4 * i + 1] * 601 + data[4 * i + 2] * 117) >> 10;
    var f = Math.ceil(Math.max(w, h) / 960);
    if (f > 1) { // perkecil agar cepat
      var nw = Math.floor(w / f), nh = Math.floor(h / f), s = new Uint8Array(nw * nh), x, y, a, b;
      for (y = 0; y < nh; y++) for (x = 0; x < nw; x++) {
        var sum = 0;
        for (b = 0; b < f; b++) for (a = 0; a < f; a++) sum += lum[(y * f + b) * w + x * f + a];
        s[y * nw + x] = (sum / (f * f)) | 0;
      }
      lum = s; w = nw; h = nh;
    }
    var bin = binarize(lum, w, h);
    if (!bin) return null;
    var r = scan(bin, w, h);
    if (r === null) {
      for (i = 0; i < bin.length; i++) bin[i] ^= 1;
      r = scan(bin, w, h);
    }
    return r === null ? null : { data: r };
  };
})(typeof window !== "undefined" ? window : this);
