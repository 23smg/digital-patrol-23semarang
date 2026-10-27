/* xlsx.js - membuat berkas Excel (.xlsx) sungguhan di peramban tanpa pustaka luar.
   Dipakai untuk ekspor laporan: kolom lebar pas, judul tebal berwarna, baris judul dibekukan, ada filter.
   Window.Xlsx.buat(namaSheet, kolom, baris) -> Blob.
   kolom: [{ j: "Judul", w: lebarKarakter, n: true bila angka }]; baris: array berisi array nilai. */
(function (w) {
  "use strict";

  var TABEL = (function () {
    var t = [], c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(b) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++) c = TABEL[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(a, v) { a.push(v & 255, (v >>> 8) & 255); }
  function u32(a, v) { a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }

  // ZIP tanpa kompresi (cukup untuk .xlsx; berkas tetap kecil karena isinya teks pendek).
  function zip(berkas) {
    var enc = new TextEncoder(), bagian = [], pusat = [], offset = 0, now = new Date();
    var dosJam = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosTgl = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    berkas.forEach(function (f) {
      var nama = enc.encode(f.n), data = enc.encode(f.d), crc = crc32(data), h = [];
      u32(h, 0x04034B50); u16(h, 20); u16(h, 0x0800); u16(h, 0); u16(h, dosJam); u16(h, dosTgl);
      u32(h, crc); u32(h, data.length); u32(h, data.length); u16(h, nama.length); u16(h, 0);
      bagian.push(new Uint8Array(h), nama, data);
      var c = [];
      u32(c, 0x02014B50); u16(c, 20); u16(c, 20); u16(c, 0x0800); u16(c, 0); u16(c, dosJam); u16(c, dosTgl);
      u32(c, crc); u32(c, data.length); u32(c, data.length); u16(c, nama.length); u16(c, 0); u16(c, 0);
      u16(c, 0); u16(c, 0); u32(c, 0); u32(c, offset);
      pusat.push(new Uint8Array(c), nama);
      offset += h.length + nama.length + data.length;
    });
    var ukuranPusat = 0;
    pusat.forEach(function (p) { ukuranPusat += p.length; });
    var akhir = [];
    u32(akhir, 0x06054B50); u16(akhir, 0); u16(akhir, 0); u16(akhir, berkas.length); u16(akhir, berkas.length);
    u32(akhir, ukuranPusat); u32(akhir, offset); u16(akhir, 0);
    return new Blob(bagian.concat(pusat, [new Uint8Array(akhir)]),
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function huruf(i) {
    var s = "";
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  function namaSheet(n) { return String(n || "Data").replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31) || "Data"; }

  function buat(nama, kolom, baris) {
    var xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
      '<sheetFormatPr defaultRowHeight="16"/>', "<cols>"];
    kolom.forEach(function (k, i) {
      xml.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (k.w || 16) + '" customWidth="1"/>');
    });
    xml.push("</cols><sheetData>");
    xml.push('<row r="1" ht="24" customHeight="1">');
    kolom.forEach(function (k, i) { xml.push('<c r="' + huruf(i) + '1" s="1" t="inlineStr"><is><t>' + esc(k.j) + "</t></is></c>"); });
    xml.push("</row>");
    baris.forEach(function (b, r) {
      var no = r + 2;
      xml.push('<row r="' + no + '">');
      kolom.forEach(function (k, i) {
        var v = b[i], ref = huruf(i) + no;
        if (v === null || v === undefined || v === "") return;
        if (k.n && isFinite(Number(v))) xml.push('<c r="' + ref + '" s="3"><v>' + Number(v) + "</v></c>");
        else xml.push('<c r="' + ref + '" s="2" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + "</t></is></c>");
      });
      xml.push("</row>");
    });
    xml.push("</sheetData>");
    if (baris.length) xml.push('<autoFilter ref="A1:' + huruf(kolom.length - 1) + (baris.length + 1) + '"/>');
    xml.push('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape"/></worksheet>');

    var nm = esc(namaSheet(nama));
    var gaya = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF0E6B5C"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD5E1DD"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="right"/></xf></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

    return zip([
      { n: "[Content_Types].xml", d: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { n: "_rels/.rels", d: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { n: "xl/workbook.xml", d: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + nm + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { n: "xl/_rels/workbook.xml.rels", d: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { n: "xl/styles.xml", d: gaya },
      { n: "xl/worksheets/sheet1.xml", d: xml.join("") }
    ]);
  }

  w.Xlsx = { buat: buat };
})(window);
