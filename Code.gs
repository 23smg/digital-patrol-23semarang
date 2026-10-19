/* ======================================================================
   DIGITAL PATROL - Mall 23Semarang
   Backend Google Apps Script (Web App, terikat ke Spreadsheet)

   Prinsip keamanan:
   - Semua aksi lewat POST (isi JSON). Tidak ada kredensial di URL.
   - Petugas TIDAK memakai PIN: cukup memilih nama dari daftar aktif.
     Karena itu nama bukan bukti identitas. Pengamannya: validasi daftar
     master, batas kirim per nama per jam, flag GPS / waktu / sumber foto,
     dan geofence (diatur dari dashboard > Pengaturan).
   - Hard Geofence: Pengiriman laporan DITOLAK di tingkat server jika
     petugas terdeteksi di luar radius area Mall atau GPS dimatikan.
   - Aksi admin wajib token sesi. Mengubah data master (tenant, petugas,
     zona, checklist) dan status temuan butuh role di ROLE_BOLEH_UBAH.
     Akun admin dan pengaturan hanya untuk role "admin" dan "super admin".
   - Password admin disimpan sebagai hash bersalt. Ganti / reset password,
     ubah role, atau hapus akun otomatis mencabut sesi lama akun itu.
   - Semua input divalidasi ulang di server (daftar master, checklist,
     foto JPEG, ukuran, koordinat, ID unik anti-duplikat).
   - Percobaan login dibatasi, lalu dikunci 15 menit.
   - Teks yang masuk ke sheet dinetralkan dari formula injection.
   - Perubahan data master dicatat di sheet Log_Perubahan.
   - Temuan punya siklus tindak lanjut (BARU > DITANGANI > SELESAI) yang
     dicatat di sheet Tindak_Lanjut.

   Berkas lain di proyek ini: Kelola.gs (kelola data dari dashboard) dan
   DataTenantAwal.gs (daftar tenant awal). Semuanya berbagi satu lingkup.
   Jalankan sekali dari menu "Digital Patrol > Setup awal".
   ====================================================================== */

var SHEET = {
  PATROLI: "Log_Patroli",
  TENANT: "Log_Tenant",
  PETUGAS: "Petugas",
  ADMIN: "User_Admin",
  MASTER_TENANT: "Tenant",
  ITEM: "Checklist_Item",
  TINDAK: "Tindak_Lanjut",
  ZONA: "Zona",
  RIWAYAT: "Log_Perubahan"
};

var TZ = "Asia/Jakarta";
var TOKEN_TTL_DETIK = 21600;     // sesi admin maks 6 jam (batas CacheService)
var BATAS_GAGAL = 5;             // salah login berturut-turut
var BATAS_KIRIM_JAM = 150;       // laporan maks per nama petugas per jam (pengaman tanpa PIN)
var DURASI_KUNCI = 900;          // detik (15 menit)
var HASH_RONDE = 200;
var MAKS_FOTO = 3;
var MAKS_B64 = 1700000;          // panjang string base64 per foto
var MAKS_BYTE_FOTO = 1250000;    // byte hasil decode per foto
var MAKS_BODY = 6500000;
var TOLERANSI_WAKTU_MENIT = 10;  // selisih jam foto vs jam server
var MAKS_BARIS_BACA = 12000;     // baris terbawah yang dibaca per sheet (dibatasi lagi oleh rentang tanggal)
var MAKS_BARIS_KIRIM = 2000;     // baris maks per log yang dikirim ke dashboard

var ROLE_BOLEH_UBAH = ["admin", "super admin", "supervisor", "manager"];
var ROLE_PENUH = ["admin", "super admin"];   // boleh mengelola akun dan pengaturan

var KOLOM_TENANT_MASTER = ["Nama Tenant", "Lokasi / Unit", "Aktif (YA/TIDAK)", "Lantai"];
var KOLOM_PETUGAS = ["Nama Petugas", "(tidak dipakai)", "Aktif (YA/TIDAK)", "(tidak dipakai)"];
var KOLOM_ZONA = ["Nama Zona", "Aktif (YA/TIDAK)"];
var KOLOM_ITEM = ["Kategori", "Item", "Aktif (YA/TIDAK)"];
var KOLOM_RIWAYAT = ["Waktu", "Oleh", "Jenis", "Aksi", "Rincian"];

var KOLOM_PATROLI = ["Timestamp", "Nama Satpam", "Titik Patroli (Zona)", "Kondisi", "Temuan Lapangan",
  "Latitude", "Longitude", "Link Foto", "Alamat", "ID", "Akurasi GPS (m)", "Waktu Foto", "Tingkat", "Flag",
  "Detail Checklist (JSON)"];
var KUNCI_PATROLI = ["ts", "nama", "zona", "kondisi", "catatan", "lat", "lng", "foto", "alamat", "id", "akurasi",
  "waktuFoto", "tingkat", "flag", "detail"];
var KOLOM_ID_PATROLI = 10;

var KOLOM_TENANT = ["Timestamp", "Kategori", "Tenant", "Petugas", "Hasil", "Ringkasan", "Catatan", "Latitude",
  "Longitude", "Link Foto", "ID", "Akurasi GPS (m)", "Waktu Foto", "Tingkat", "Flag", "Detail Checklist (JSON)"];
var KUNCI_TENANT = ["ts", "kategori", "tenant", "petugas", "hasil", "ringkasan", "catatan", "lat", "lng", "foto",
  "id", "akurasi", "waktuFoto", "tingkat", "flag", "detail"];
var KOLOM_ID_TENANT = 11;

var KOLOM_TINDAK = ["ID Laporan", "Jenis", "Status", "Catatan", "Diubah Oleh", "Diubah Pada", "Lokasi"];

var ITEM_DEFAULT = {
  PATROLI: ["Pintu tangga darurat", "Lantai", "Dinding", "Penerangan", "Kebersihan",
    "Safety equipment (APAR / hydrant)"],
  BUKA: ["Pintu / rolling door terbuka dan berfungsi", "Lampu dan penerangan menyala",
    "Etalase dan display tertata", "Area depan tenant bersih", "Staf hadir dan berseragam",
    "AC / ventilasi normal", "Tidak ada kerusakan atau kebocoran",
    "APAR terlihat dan jalur evakuasi tidak terhalang"],
  TUTUP: ["Seluruh pengunjung sudah keluar", "Pintu / rolling door terkunci",
    "Lampu non-esensial dimatikan", "Peralatan listrik dan gas dimatikan",
    "Tidak ada kebocoran air atau bau gas", "Kasir dan barang berharga diamankan",
    "Sampah sudah dirapikan", "APAR terjangkau dan jalur evakuasi tidak terhalang"]
};

/* ======================================================================
   1. TITIK MASUK
   ====================================================================== */

function doGet() {
  return ContentService.createTextOutput("API Digital Patrol Mall 23Semarang aktif.")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    var b = bacaBody_(e);
    var aksi = String(b.aksi || "");
    var hasil;
    switch (aksi) {
      case "ping":          hasil = { waktuServer: Date.now() }; break;
      case "ambilDropdown": hasil = ambilDropdown_(); break;
      case "simpanPatroli": hasil = simpanPatroli_(b.payload); break;
      case "simpanTenant":  hasil = simpanTenant_(b.payload); break;
      case "login":         hasil = login_(b); break;
      case "logout":        hasil = logout_(b); break;
      case "gantiPassword": hasil = gantiPassword_(b); break;
      case "ambilData":     hasil = ambilData_(b); break;
      case "ubahStatus":    hasil = ubahStatus_(b); break;
      case "kelolaAmbil":       hasil = kelolaAmbil_(b); break;
      case "kelolaSimpan":      hasil = kelolaSimpan_(b); break;
      case "akunSimpan":        hasil = akunSimpan_(b); break;
      case "pengaturanSimpan":  hasil = pengaturanSimpan_(b); break;
      case "pengaturanPatroli": hasil = pengaturanPatroliSimpan_(b); break;
      case "sistemJalankan":    hasil = sistemJalankan_(b); break;
      default: tolak_("Aksi tidak dikenali.", "AKSI");
    }
    if (!hasil.status) hasil.status = "SUCCESS";
    return json_(hasil);
  } catch (err) {
    if (err && err.ap) return json_({ status: "ERROR", kode: err.kode, message: err.pesan });
    console.error(err && err.stack ? err.stack : String(err));
    return json_({ status: "ERROR", kode: "SERVER", message: "Terjadi kesalahan di server. Coba lagi." });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function tolak_(pesan, kode) {
  throw { ap: true, pesan: pesan, kode: kode || "TOLAK" };
}

function bacaBody_(e) {
  if (!e || !e.postData || !e.postData.contents) tolak_("Permintaan kosong.", "BODY");
  var c = e.postData.contents;
  if (c.length > MAKS_BODY) tolak_("Data terlalu besar.", "BODY");
  var o;
  try { o = JSON.parse(c); } catch (x) { tolak_("Format data tidak valid.", "BODY"); }
  if (!o || typeof o !== "object") tolak_("Format data tidak valid.", "BODY");
  return o;
}

/* ======================================================================
   2. UTILITAS UMUM
   ====================================================================== */

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function bersih_(v, maks) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim().slice(0, maks || 200);
}

function aman_(v, maks) {
  var s = bersih_(v, maks);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function namaLogPatroli_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET.PATROLI)) return SHEET.PATROLI;
  if (ss.getSheetByName("Laporan")) return "Laporan";
  return SHEET.PATROLI;
}

function sheet_(nama) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nama);
  if (!sh) tolak_("Sheet '" + nama + "' belum ada. Jalankan menu Digital Patrol > Setup awal.", "SETUP");
  return sh;
}

function ymd_(s) {
  s = String(s || "");
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : "";
}

function jarakM_(lat1, lng1, lat2, lng2) {
  var R = 6371000, rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ======================================================================
   3. HASH SANDI, TOKEN, PEMBATASAN PERCOBAAN
   ====================================================================== */

function toHex_(bytes) {
  return bytes.map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}

function hashSandi_(plain, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, "").slice(0, 16);
  var pepper = prop_("PASS_PEPPER") || "";
  var h = salt + "|" + plain + "|" + pepper;
  for (var i = 0; i < HASH_RONDE; i++) {
    h = toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return "h1$" + salt + "$" + h;
}

function samaAman_(a, b) {
  a = String(a); b = String(b);
  var selisih = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) selisih |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return selisih === 0;
}

function cocokSandi_(tersimpan, input) {
  tersimpan = String(tersimpan);
  if (tersimpan.indexOf("h1$") === 0) {
    var bagian = tersimpan.split("$");
    if (bagian.length !== 3) return false;
    return samaAman_(hashSandi_(input, bagian[1]), tersimpan);
  }
  return tersimpan !== "" && samaAman_(tersimpan, input);
}

function hitungGagal_(kunci) {
  var c = CacheService.getScriptCache();
  c.put(kunci, String(Number(c.get(kunci) || 0) + 1), DURASI_KUNCI);
}
function terkunci_(kunci) {
  return Number(CacheService.getScriptCache().get(kunci) || 0) >= BATAS_GAGAL;
}

function kunciRole_(role) { return String(role || "").trim().toLowerCase().replace(/[\s_-]+/g, " "); }
function bolehUbah_(role) { return ROLE_BOLEH_UBAH.indexOf(kunciRole_(role)) >= 0; }
function penuh_(role) { return ROLE_PENUH.indexOf(kunciRole_(role)) >= 0; }

function infoUser_(user) {
  return { username: user.username, nama: user.nama, role: user.role,
    bisaUbah: bolehUbah_(user.role), penuh: penuh_(user.role) };
}

function buatToken_(user) {
  var t = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  var simpan = { username: user.username, nama: user.nama, role: user.role, iat: Date.now() };
  CacheService.getScriptCache().put("tok_" + t, JSON.stringify(simpan), TOKEN_TTL_DETIK);
  return t;
}

function cabutSesi_(username) {
  PropertiesService.getScriptProperties().setProperty("sv_" + String(username).toLowerCase(), String(Date.now()));
}

function wajibAdmin_(token) {
  token = String(token || "");
  if (!/^[a-f0-9]{64}$/.test(token)) tolak_("Sesi berakhir. Silakan masuk kembali.", "SESI");
  var s = CacheService.getScriptCache().get("tok_" + token);
  if (!s) tolak_("Sesi berakhir. Silakan masuk kembali.", "SESI");
  var u = JSON.parse(s);
  var sv = Number(prop_("sv_" + String(u.username).toLowerCase()) || 0);
  if (sv && Number(u.iat || 0) < sv) tolak_("Sesi berakhir. Silakan masuk kembali.", "SESI");
  return u;
}

function wajibEditor_(token) {
  var u = wajibAdmin_(token);
  if (!bolehUbah_(u.role)) tolak_("Akun ini hanya bisa melihat data.", "IZIN");
  return u;
}

function wajibPenuh_(token) {
  var u = wajibAdmin_(token);
  if (!penuh_(u.role)) tolak_("Hanya akun admin yang boleh melakukan ini.", "IZIN");
  return u;
}

/* ======================================================================
   4. ADMIN: LOGIN, LOGOUT, GANTI PASSWORD
   ====================================================================== */

function login_(b) {
  var u = bersih_(b.username, 60).toLowerCase();
  var p = String(b.password || "");
  if (!u || !p || p.length > 200) tolak_("Nama pengguna atau kata sandi salah.", "LOGIN");
  var kunci = "gagal_adm_" + u;
  if (terkunci_(kunci)) tolak_("Terlalu banyak percobaan. Coba lagi dalam 15 menit.", "TERKUNCI");

  var sh = sheet_(SHEET.ADMIN);
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][0]).trim().toLowerCase() !== u) continue;
    if (cocokSandi_(d[i][1], p)) {
      if (String(d[i][1]).indexOf("h1$") !== 0) {
        sh.getRange(i + 1, 2).setNumberFormat("@").setValue(hashSandi_(p));
      }
      CacheService.getScriptCache().remove(kunci);
      var user = {
        username: String(d[i][0]).trim(),
        nama: String(d[i][2] || "Admin").trim(),
        role: String(d[i][3] || "Admin").trim()
      };
      return { token: buatToken_(user), user: infoUser_(user) };
    }
    break;
  }
  hitungGagal_(kunci);
  Utilities.sleep(400);
  tolak_("Nama pengguna atau kata sandi salah.", "LOGIN");
}

function logout_(b) {
  var t = String(b.token || "");
  if (/^[a-f0-9]{64}$/.test(t)) CacheService.getScriptCache().remove("tok_" + t);
  return { message: "Keluar berhasil." };
}

function gantiPassword_(b) {
  var user = wajibAdmin_(b.token);
  var lama = String(b.passLama || ""), baru = String(b.passBaru || "");
  if (baru.length < 8 || baru.length > 100) tolak_("Kata sandi baru minimal 8 karakter.", "PASS");
  if (baru === lama) tolak_("Kata sandi baru harus berbeda dari yang lama.", "PASS");
  var kunci = "gagal_gp_" + user.username.toLowerCase();
  if (terkunci_(kunci)) tolak_("Terlalu banyak percobaan. Coba lagi dalam 15 menit.", "TERKUNCI");

  var sh = sheet_(SHEET.ADMIN);
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][0]).trim().toLowerCase() !== user.username.toLowerCase()) continue;
    if (!cocokSandi_(d[i][1], lama)) {
      hitungGagal_(kunci);
      tolak_("Kata sandi lama tidak sesuai.", "PASS");
    }
    sh.getRange(i + 1, 2).setNumberFormat("@").setValue(hashSandi_(baru));
    CacheService.getScriptCache().remove(kunci);
    cabutSesi_(user.username);
    CacheService.getScriptCache().remove("tok_" + String(b.token));
    return { message: "Kata sandi berhasil diperbarui. Sesi di perangkat lain dikeluarkan.", token: buatToken_(user) };
  }
  tolak_("Akun tidak ditemukan.", "PASS");
}

/* ======================================================================
   5. MASTER DATA (petugas, zona, tenant, item checklist)
   ====================================================================== */

function daftarChecklist_() {
  var hasil = { PATROLI: [], BUKA: [], TUTUP: [] };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.ITEM);
  if (sh && sh.getLastRow() > 1) {
    var d = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues();
    d.forEach(function (r) {
      var k = String(r[0]).trim().toUpperCase();
      var it = bersih_(r[1], 120);
      var aktif = String(r[2]).trim().toUpperCase();
      if (hasil[k] && it && aktif !== "TIDAK" && hasil[k].indexOf(it) < 0) hasil[k].push(it);
    });
  }
  Object.keys(hasil).forEach(function (k) {
    if (!hasil[k].length) hasil[k] = ITEM_DEFAULT[k].slice();
  });
  return hasil;
}

function ambilMaster_() {
  var cache = CacheService.getScriptCache();
  var ada = cache.get(KUNCI_CACHE_MASTER);
  if (ada) { try { return JSON.parse(ada); } catch (x) { /* lanjut baca ulang */ } }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var m = { daftarNama: [], daftarZona: [], daftarTenant: [], checklist: daftarChecklist_() };

  var zonaLama = [];
  var sp = ss.getSheetByName(SHEET.PETUGAS);
  if (sp && sp.getLastRow() > 1) {
    sp.getRange(2, 1, sp.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
      var n = bersih_(r[0], 80), z = bersih_(r[1], 80), aktif = String(r[2]).trim().toUpperCase();
      if (n && aktif !== "TIDAK" && m.daftarNama.indexOf(n) < 0) m.daftarNama.push(n);
      if (z && zonaLama.indexOf(z) < 0) zonaLama.push(z);
    });
  }
  var sz = ss.getSheetByName(SHEET.ZONA);
  if (sz && sz.getLastRow() > 1) {
    sz.getRange(2, 1, sz.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
      var n = bersih_(r[0], 80), aktif = String(r[1]).trim().toUpperCase();
      if (n && aktif !== "TIDAK" && m.daftarZona.indexOf(n) < 0) m.daftarZona.push(n);
    });
  }
  if (!m.daftarZona.length) m.daftarZona = zonaLama;

  var st = ss.getSheetByName(SHEET.MASTER_TENANT);
  if (st && st.getLastRow() > 1) {
    var ada2 = {};
    st.getRange(2, 1, st.getLastRow() - 1, Math.min(4, st.getMaxColumns())).getDisplayValues().forEach(function (r) {
      var n = bersih_(r[0], 80), l = bersih_(r[1], 60), aktif = String(r[2]).trim().toUpperCase();
      if (!n || aktif === "TIDAK" || ada2[n]) return;
      ada2[n] = 1;
      m.daftarTenant.push({ n: n, l: l, f: lantaiTenant_(r[3], l) });
    });
  }
  try { cache.put(KUNCI_CACHE_MASTER, JSON.stringify(m), 60); } catch (x) { /* tanpa cache */ }
  return m;
}

var KUNCI_CACHE_MASTER = "master_v2";

function lantaiTenant_(lantai, unit) {
  var f = bersih_(lantai, 10).toUpperCase();
  if (f) return f;
  var m = String(unit || "").trim().toUpperCase().match(/^(LG|UG|GF|B\d|L\d{1,2})\b/);
  return m ? m[1] : "";
}

function ambilDropdown_() {
  var m = ambilMaster_();
  return {
    daftarNama: m.daftarNama,
    daftarZona: m.daftarZona,
    daftarTenant: m.daftarTenant,
    checklist: m.checklist,
    fotoTenant: ambilPengaturan_().fotoTenant,
    geo: {
      lat: prop_("GEO_LAT") || "",
      lng: prop_("GEO_LNG") || "",
      radius: prop_("GEO_RADIUS_M") || ""
    },
    waktuServer: Date.now()
  };
}

/* ======================================================================
   6. VALIDASI INPUT PETUGAS
   ====================================================================== */

function verifikasiPetugas_(nama) {
  nama = bersih_(nama, 80);
  if (!nama) tolak_("Pilih nama petugas.", "NAMA");
  var daftar = ambilMaster_().daftarNama;
  var kecil = nama.toLowerCase();
  for (var i = 0; i < daftar.length; i++) if (daftar[i].toLowerCase() === kecil) return daftar[i];
  tolak_("Nama petugas tidak terdaftar atau sudah dinonaktifkan. Hubungi admin.", "NAMA");
}

function periksaBatasKirim_(nama) {
  var c = CacheService.getScriptCache();
  var k = "kirim_" + nama.toLowerCase() + "_" + Utilities.formatDate(new Date(), TZ, "yyyyMMddHH");
  var n = Number(c.get(k) || 0);
  if (n >= BATAS_KIRIM_JAM) tolak_("Terlalu banyak laporan dari nama ini dalam 1 jam. Hubungi admin bila ini wajar.", "BATAS");
  return function () { c.put(k, String(n + 1), 3700); };
}

function validasiId_(id) {
  id = String(id || "");
  if (!/^[A-Za-z0-9-]{16,64}$/.test(id)) tolak_("ID laporan tidak valid. Muat ulang halaman.", "ID");
  return id;
}

function idSudahAda_(sh, kolomId, id) {
  if (CacheService.getScriptCache().get("id_" + id)) return true;
  var last = sh.getLastRow();
  if (last < 2) return false;
  var n = Math.min(300, last - 1);
  var v = sh.getRange(last - n + 1, kolomId, n, 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === id) return true;
  return false;
}

function validasiChecklist_(kategori, kiriman, master) {
  var item = master[kategori];
  if (!Array.isArray(kiriman)) tolak_("Checklist belum diisi.", "CHECKLIST");
  var peta = {};
  kiriman.forEach(function (x) { if (x && typeof x.i === "string") peta[x.i] = x; });
  var hasil = [], adaTemuan = false;
  for (var n = 0; n < item.length; n++) {
    var x = peta[item[n]];
    if (!x) tolak_("Daftar checklist berubah. Muat ulang halaman lalu isi kembali.", "CHECKLIST");
    var s = String(x.s || "").toUpperCase();
    if (["OK", "TEMUAN", "NA"].indexOf(s) < 0) tolak_("Item belum dijawab: " + item[n] + ".", "CHECKLIST");
    var c = bersih_(x.c, 200);
    if (s === "TEMUAN") adaTemuan = true;   // keterangan per item tidak lagi wajib (opsional, boleh kosong)
    hasil.push({ i: item[n], s: s, c: s === "TEMUAN" ? c : "" });
  }
  return { daftar: hasil, adaTemuan: adaTemuan };
}

function validasiTingkat_(adaTemuan, t) {
  if (!adaTemuan) return "-";
  t = String(t || "");
  if (["Rendah", "Sedang", "Tinggi"].indexOf(t) < 0) tolak_("Pilih tingkat temuan (Rendah / Sedang / Tinggi).", "TINGKAT");
  return t;
}

function ringkasChecklist_(daftar) {
  var temuan = daftar.filter(function (x) { return x.s === "TEMUAN"; })
    .map(function (x) { return x.c ? x.i + ": " + x.c : x.i; });
  return temuan.length ? temuan.join("; ") : "Semua item sesuai";
}

function validasiGeo_(p) {
  var kosong = p.lat === null || p.lat === undefined || p.lat === "" || p.lat === "-" ||
    p.lng === null || p.lng === undefined || p.lng === "" || p.lng === "-";
  var lat = Number(p.lat), lng = Number(p.lng);
  var ada = !kosong && isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);
  if (!ada) return { lat: "-", lng: "-", akurasi: "", flag: ["GPS_TIDAK_ADA"] };

  var ak = Number(p.akurasi);
  ak = (p.akurasi !== null && p.akurasi !== undefined && p.akurasi !== "" && isFinite(ak) && ak >= 0) ? Math.round(ak) : "";
  var flag = [];
  if (ak !== "" && ak > 100) flag.push("AKURASI_RENDAH");
  var gl = prop_("GEO_LAT"), gn = prop_("GEO_LNG"), gr = Number(prop_("GEO_RADIUS_M"));
  if (gl && gn && gr > 0 && jarakM_(lat, lng, Number(gl), Number(gn)) > gr) flag.push("DI_LUAR_AREA");
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, akurasi: ak, flag: flag };
}

function periksaFoto_(fotos, wajib) {
  if (wajib === false && (!Array.isArray(fotos) || fotos.length === 0)) return [];
  if (!Array.isArray(fotos) || fotos.length < 1) tolak_("Foto bukti wajib diambil.", "FOTO");
  if (fotos.length > MAKS_FOTO) tolak_("Maksimal " + MAKS_FOTO + " foto.", "FOTO");
  return fotos.map(function (f) {
    var b64 = f && typeof f.b64 === "string" ? f.b64 : "";
    if (b64.length < 1000 || b64.length > MAKS_B64 || !/^[A-Za-z0-9+\/]+={0,2}$/.test(b64)) {
      tolak_("Ukuran atau format foto tidak valid.", "FOTO");
    }
    var bytes;
    try { bytes = Utilities.base64Decode(b64); } catch (x) { tolak_("Foto rusak. Ambil ulang.", "FOTO"); }
    if (bytes.length > MAKS_BYTE_FOTO) tolak_("Foto terlalu besar.", "FOTO");
    if (!(bytes[0] === -1 && bytes[1] === -40 && bytes[2] === -1)) tolak_("Foto harus berformat JPEG.", "FOTO");
    var t = Date.parse(f.t);
    return { bytes: bytes, t: isNaN(t) ? null : t, sumber: f.sumber === "berkas" ? "berkas" : "kamera" };
  });
}

function flagWaktu_(metas, p, nowMs) {
  var flag = [];
  var batas = TOLERANSI_WAKTU_MENIT * 60000;
  var ts = metas.map(function (m) { return m.t; }).filter(function (t) { return t !== null; });
  if (!metas.length) {
    if (p.tertunda === true) flag.push("KIRIM_TERTUNDA");
  } else if (!ts.length) {
    flag.push("WAKTU_TIDAK_SINKRON");
  } else if (p.tertunda === true) {
    flag.push("KIRIM_TERTUNDA");
    if (ts.some(function (t) { return t - nowMs > batas; })) flag.push("WAKTU_TIDAK_SINKRON");
  } else if (ts.some(function (t) { return Math.abs(nowMs - t) > batas; })) {
    flag.push("WAKTU_TIDAK_SINKRON");
  }
  if (p.jamPerangkat === true) flag.push("JAM_PERANGKAT");
  if (metas.some(function (m) { return m.sumber === "berkas"; })) flag.push("FOTO_DARI_BERKAS");
  return flag;
}

function flagDurasi_(p) {
  var d = Number(p.durasiDetik);
  var ada = p.durasiDetik !== undefined && p.durasiDetik !== null && p.durasiDetik !== "" && isFinite(d);
  return (ada && d >= 0 && d < 15) ? ["ISI_TERLALU_CEPAT"] : [];
}

function teksWaktuFoto_(metas) {
  var ts = metas.map(function (m) { return m.t; }).filter(function (t) { return t !== null; });
  if (!ts.length) return "-";
  return Utilities.formatDate(new Date(Math.min.apply(null, ts)), TZ, "dd/MM/yyyy HH:mm:ss");
}

/* ======================================================================
   7. FOTO KE DRIVE
   ====================================================================== */

function subFolder_(induk, nama) {
  var it = induk.getFoldersByName(nama);
  return it.hasNext() ? it.next() : induk.createFolder(nama);
}

function folderFoto_(jenis, now) {
  var root;
  var id = prop_("FOLDER_FOTO_ID");
  if (id) {
    try { root = DriveApp.getFolderById(id); } catch (x) { root = null; }
  }
  if (!root) {
    var it = DriveApp.getFoldersByName("Foto_Patroli_Satpam");
    root = it.hasNext() ? it.next() : DriveApp.createFolder("Foto_Patroli_Satpam");
  }
  return subFolder_(subFolder_(root, jenis), Utilities.formatDate(now, TZ, "yyyy-MM"));
}

function simpanFoto_(metas, jenis, awalan, now) {
  var folder = folderFoto_(jenis, now);
  var stamp = Utilities.formatDate(now, TZ, "yyyyMMdd_HHmmss");
  var pre = String(awalan).replace(/[^A-Za-z0-9]+/g, "_").slice(0, 30);
  return metas.map(function (m, i) {
    var nama = pre + "_" + stamp + "_" + (i + 1) + "_" + Utilities.getUuid().slice(0, 6) + ".jpg";
    var file = folder.createFile(Utilities.newBlob(m.bytes, "image/jpeg", nama));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  });
}

function tulisBaris_(sh, baris) {
  var r = sh.getLastRow() + 1;
  var rng = sh.getRange(r, 1, 1, baris.length);
  rng.setNumberFormat("@");
  rng.setValues([baris]);
}

/* ======================================================================
   8. SIMPAN LAPORAN PATROLI (DENGAN HARD GEOFENCE)
   ====================================================================== */

function simpanPatroli_(p) {
  p = p || {};
  var petugas = verifikasiPetugas_(p.nama);
  var master = ambilMaster_();
  var zona = bersih_(p.zona, 80);
  if (master.daftarZona.indexOf(zona) < 0) tolak_("Zona tidak terdaftar.", "ZONA");

  var cl = validasiChecklist_("PATROLI", p.checklist, master.checklist);
  var tingkat = validasiTingkat_(cl.adaTemuan, p.tingkat);
  var catatan = bersih_(p.catatan, 500);
  var id = validasiId_(p.id);
  var geo = validasiGeo_(p);

  // === VALIDASI HARD GEOFENCE DIBATASI SERVER ===
  if (geo.flag.indexOf("DI_LUAR_AREA") >= 0) {
    tolak_("Pengiriman ditolak: Posisi Anda berada di luar jangkauan area Mall.", "GEOFENCE_BLOCK");
  }
  if (geo.flag.indexOf("GPS_TIDAK_ADA") >= 0) {
    tolak_("Pengiriman ditolak: Sinyal / Lokasi GPS wajib aktif saat mengirim laporan.", "GPS_REQUIRED");
  }

  var metas = periksaFoto_(p.fotos);

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (x) { tolak_("Server sedang sibuk. Coba lagi sebentar.", "SIBUK"); }
  try {
    var sh = sheet_(namaLogPatroli_());
    if (idSudahAda_(sh, KOLOM_ID_PATROLI, id)) return { message: "Laporan sudah tercatat.", duplikat: true };
    var catat = periksaBatasKirim_(petugas);

    var now = new Date();
    var flag = geo.flag.concat(flagWaktu_(metas, p, now.getTime()), flagDurasi_(p));
    if (p.qr === true) flag.push("ZONA_QR");
    var urls = simpanFoto_(metas, "Patroli", "Patroli_" + zona, now);
    var ringkas = ringkasChecklist_(cl.daftar);
    var ket = ringkas + (catatan ? " | Catatan: " + catatan : "");

    tulisBaris_(sh, [
      Utilities.formatDate(now, TZ, "dd/MM/yyyy HH:mm:ss"),
      aman_(petugas, 80), aman_(zona, 80),
      cl.adaTemuan ? "Ada Temuan" : "Aman",
      aman_(ket, 900),
      geo.lat, geo.lng, urls.join(" | "), "-", id, geo.akurasi,
      teksWaktuFoto_(metas), tingkat, flag.join(", "), JSON.stringify(cl.daftar)
    ]);
    CacheService.getScriptCache().put("id_" + id, "1", 21600);
    catat();
    return { message: "Laporan patroli tersimpan.", waktu: Utilities.formatDate(now, TZ, "HH:mm:ss") };
  } finally {
    lock.releaseLock();
  }
}

/* ======================================================================
   9. SIMPAN CHECKLIST TENANT (BUKA / TUTUP - DENGAN HARD GEOFENCE)
   ====================================================================== */

function cariTenantHariIni_(sh, tenant, kategori, tgl) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var n = Math.min(900, last - 1);
  var v = sh.getRange(last - n + 1, 1, n, 4).getDisplayValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (ymd_(v[i][0]) === tgl && v[i][1] === kategori && v[i][2] === tenant) {
      return { jam: String(v[i][0]).slice(11, 16), petugas: v[i][3] };
    }
  }
  return null;
}

function simpanTenant_(p) {
  p = p || {};
  var kategori = String(p.kategori || "").toUpperCase();
  if (kategori !== "BUKA" && kategori !== "TUTUP") tolak_("Pilih kategori BUKA atau TUTUP.", "KATEGORI");
  var petugas = verifikasiPetugas_(p.nama);
  var master = ambilMaster_();
  var tenant = bersih_(p.tenant, 80);
  if (!master.daftarTenant.some(function (t) { return t.n === tenant; })) tolak_("Tenant tidak terdaftar.", "TENANT");

  var cl = validasiChecklist_(kategori, p.checklist, master.checklist);
  var tingkat = validasiTingkat_(cl.adaTemuan, p.tingkat);
  var catatan = bersih_(p.catatan, 500);
  var id = validasiId_(p.id);
  var geo = validasiGeo_(p);

  // === VALIDASI HARD GEOFENCE DIBATASI SERVER ===
  if (geo.flag.indexOf("DI_LUAR_AREA") >= 0) {
    tolak_("Pengiriman ditolak: Posisi Anda berada di luar jangkauan area Mall.", "GEOFENCE_BLOCK");
  }
  if (geo.flag.indexOf("GPS_TIDAK_ADA") >= 0) {
    tolak_("Pengiriman ditolak: Sinyal / Lokasi GPS wajib aktif saat mengirim laporan.", "GPS_REQUIRED");
  }

  var wajibFoto = cl.adaTemuan || ambilPengaturan_().fotoTenant === "selalu";
  var metas = periksaFoto_(p.fotos, wajibFoto);
  if (wajibFoto && !metas.length) tolak_("Foto bukti wajib diambil.", "FOTO");

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (x) { tolak_("Server sedang sibuk. Coba lagi sebentar.", "SIBUK"); }
  try {
    var sh = sheet_(SHEET.TENANT);
    if (idSudahAda_(sh, KOLOM_ID_TENANT, id)) return { message: "Laporan sudah tercatat.", duplikat: true };
    var catat = periksaBatasKirim_(petugas);

    var now = new Date();
    var hari = Utilities.formatDate(now, TZ, "yyyy-MM-dd");
    var ulang = false;
    var sebelumnya = cariTenantHariIni_(sh, tenant, kategori, hari);
    if (sebelumnya) {
      if (p.konfirmasiUlang !== true) {
        return {
          status: "KONFIRMASI",
          message: tenant + " sudah dilaporkan " + kategori + " hari ini pukul " + sebelumnya.jam +
            " oleh " + sebelumnya.petugas + ". Kirim laporan baru?"
        };
      }
      ulang = true;
    }

    var flag = geo.flag.concat(flagWaktu_(metas, p, now.getTime()), flagDurasi_(p));
    if (ulang) flag.push("ULANG_HARI_INI");
    var urls = simpanFoto_(metas, "Tenant", kategori + "_" + tenant, now);

    tulisBaris_(sh, [
      Utilities.formatDate(now, TZ, "dd/MM/yyyy HH:mm:ss"),
      kategori, aman_(tenant, 80), aman_(petugas, 80),
      cl.adaTemuan ? "ADA TEMUAN" : "SESUAI",
      aman_(ringkasChecklist_(cl.daftar), 900), aman_(catatan, 500),
      geo.lat, geo.lng, urls.join(" | "), id, geo.akurasi,
      teksWaktuFoto_(metas), tingkat, flag.join(", "), JSON.stringify(cl.daftar)
    ]);
    CacheService.getScriptCache().put("id_" + id, "1", 21600);
    catat();
    return { message: "Checklist " + kategori + " tersimpan.", waktu: Utilities.formatDate(now, TZ, "HH:mm:ss") };
  } finally {
    lock.releaseLock();
  }
}

/* ======================================================================
   10. DATA UNTUK DASHBOARD ADMIN + TINDAK LANJUT TEMUAN (wajib token)
   ====================================================================== */

function nilaiWaktu_(v, tz) {
  function p2(n) { return ("0" + n).slice(-2); }
  function rakit(y, mo, d, h, mi, s) {
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
    return { ts: p2(d) + "/" + p2(mo) + "/" + y + " " + p2(h) + ":" + p2(mi) + ":" + p2(s), tgl: y + "-" + p2(mo) + "-" + p2(d) };
  }
  if (Object.prototype.toString.call(v) === "[object Date]") {
    if (isNaN(v.getTime())) return null;
    return { ts: Utilities.formatDate(v, tz, "dd/MM/yyyy HH:mm:ss"), tgl: Utilities.formatDate(v, tz, "yyyy-MM-dd") };
  }
  var s = String(v === null || v === undefined ? "" : v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    var a = +m[1], b = +m[2];
    var hari = b > 12 ? b : a, bulan = b > 12 ? a : b;
    return rakit(+m[3], bulan, hari, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  return m ? rakit(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null;
}

function bacaSemua_(nama, kunci, tglMulai) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(nama);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var tz = ss.getSpreadsheetTimeZone() || TZ;
  var lebar = Math.min(kunci.length, sh.getMaxColumns());
  var jelajah = Math.min(last - 1, MAKS_BARIS_BACA * 2);
  var awalJelajah = last - jelajah + 1;
  var kolA = sh.getRange(awalJelajah, 1, jelajah, 1).getValues();
  var awal = awalJelajah;
  if (tglMulai) {
    for (var j = kolA.length - 1; j >= 0; j--) {
      var w0 = nilaiWaktu_(kolA[j][0], tz);
      if (w0 && w0.tgl < tglMulai) { awal = awalJelajah + j + 1; break; }
    }
  }
  var n = Math.min(MAKS_BARIS_BACA, last - awal + 1);
  if (n <= 0) return [];
  awal = last - n + 1;
  var d = sh.getRange(awal, 1, n, lebar).getDisplayValues();
  var asli = kolA.slice(awal - awalJelajah);
  var out = [];
  for (var i = d.length - 1; i >= 0; i--) {
    var w = nilaiWaktu_(asli[i][0], tz) || nilaiWaktu_(d[i][0], tz);
    if (!w) continue;
    var o = {};
    for (var k = 0; k < kunci.length; k++) o[kunci[k]] = k < lebar ? d[i][k] : "";
    o.ts = w.ts;
    o.tgl = w.tgl;
    out.push(o);
  }
  return out;
}

function saring_(rows, fn, maks) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (fn(rows[i])) { out.push(rows[i]); if (out.length >= maks) break; }
  }
  return out;
}

function adaTemuan_(o) { return /temuan/i.test(o.kondisi || o.hasil || ""); }

function bacaTindak_() {
  var peta = {};
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.TINDAK);
  if (!sh || sh.getLastRow() < 2) return peta;
  var last = sh.getLastRow();
  var n = Math.min(MAKS_BARIS_BACA, last - 1);
  sh.getRange(last - n + 1, 1, n, 6).getDisplayValues().forEach(function (r) {
    if (r[0]) peta[r[0]] = { id: r[0], jenis: r[1], status: r[2], catatan: r[3], oleh: r[4], waktu: r[5] };
  });
  return peta;
}

function ambilData_(b) {
  var user = wajibAdmin_(b.token);
  var hariIni = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
  var re = /^\d{4}-\d{2}-\d{2}$/;
  var dari = re.test(b.dari || "") ? b.dari : hariIni;
  var sampai = re.test(b.sampai || "") ? b.sampai : hariIni;
  if (dari > sampai) { var t = dari; dari = sampai; sampai = t; }

  var dari30 = Utilities.formatDate(new Date(Date.now() - 30 * 86400000), TZ, "yyyy-MM-dd");
  var mulai = dari < dari30 ? dari : dari30;
  var patroliSemua = bacaSemua_(namaLogPatroli_(), KUNCI_PATROLI, mulai);
  var tenantSemua = bacaSemua_(SHEET.TENANT, KUNCI_TENANT, mulai);
  var tindak = bacaTindak_();

  function rentang(rows) {
    return saring_(rows, function (o) { return o.tgl >= dari && o.tgl <= sampai; }, MAKS_BARIS_KIRIM);
  }
  function terbuka(rows) {
    return saring_(rows, function (o) {
      var st = o.id && tindak[o.id];
      return o.id && o.tgl >= dari30 && adaTemuan_(o) && !(st && st.status === "SELESAI");
    }, 200);
  }

  var m = ambilMaster_();
  var pg = ambilPengaturan_();
  var hasil = {
    user: infoUser_(user),
    pengaturan: pg,
    cakupan: hitungCakupan_(patroliSemua, hariIni, m.daftarZona, pg, Date.now()),
    tren: hitungTren_(patroliSemua, tenantSemua),
    hariIni: hariIni,
    patroli: rentang(patroliSemua),
    tenant: rentang(tenantSemua),
    terbuka: { patroli: terbuka(patroliSemua), tenant: terbuka(tenantSemua) },
    master: { tenant: m.daftarTenant, zona: m.daftarZona, petugas: m.daftarNama.length },
    waktuServer: Date.now()
  };
  var perlu = {};
  [hasil.patroli, hasil.tenant, hasil.terbuka.patroli, hasil.terbuka.tenant].forEach(function (arr) {
    arr.forEach(function (o) { if (o.id && tindak[o.id]) perlu[o.id] = tindak[o.id]; });
  });
  hasil.tindak = perlu;
  return hasil;
}

function lokasiLaporan_(sh, kolomId, id) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var n = Math.min(MAKS_BARIS_BACA, last - 1);
  var d = sh.getRange(last - n + 1, 1, n, kolomId).getDisplayValues();
  for (var i = d.length - 1; i >= 0; i--) if (d[i][kolomId - 1] === id) return String(d[i][2]);
  return null;
}

function ubahStatus_(b) {
  var user = wajibEditor_(b.token);
  var id = validasiId_(b.id);
  var jenis = String(b.jenis || "").toUpperCase();
  if (jenis !== "PATROLI" && jenis !== "TENANT") tolak_("Jenis laporan tidak valid.", "JENIS");
  var status = String(b.status || "").toUpperCase();
  if (["BARU", "DITANGANI", "SELESAI"].indexOf(status) < 0) tolak_("Status tidak valid.", "STATUS");
  var catatan = bersih_(b.catatan, 300);
  if (status === "SELESAI" && catatan.length < 3) tolak_("Tuliskan tindakan yang dilakukan sebelum menandai selesai.", "CATATAN");

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (x) { tolak_("Server sedang sibuk. Coba lagi sebentar.", "SIBUK"); }
  try {
    var log = sheet_(jenis === "PATROLI" ? namaLogPatroli_() : SHEET.TENANT);
    var lokasi = lokasiLaporan_(log, jenis === "PATROLI" ? KOLOM_ID_PATROLI : KOLOM_ID_TENANT, id);
    if (lokasi === null) tolak_("Laporan tidak ditemukan.", "TIDAK_ADA");

    var sh = sheet_(SHEET.TINDAK);
    var waktu = Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm:ss");
    var baris = [id, jenis, status, aman_(catatan, 300), aman_(user.nama, 80), waktu, aman_(lokasi, 120)];
    var last = sh.getLastRow(), idx = 0;
    if (last >= 2) {
      var ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
      for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) { idx = i + 2; break; }
    }
    if (idx) {
      var rng = sh.getRange(idx, 1, 1, baris.length);
      rng.setNumberFormat("@");
      rng.setValues([baris]);
    } else {
      tulisBaris_(sh, baris);
    }
    return { tindak: { id: id, jenis: jenis, status: status, catatan: catatan, oleh: user.nama, waktu: waktu } };
  } finally {
    lock.releaseLock();
  }
}

/* ======================================================================
   11. SETUP & PERAWATAN (dijalankan manual dari menu spreadsheet)
   ====================================================================== */

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu("Digital Patrol")
      .addItem("Setup awal (sekali)", "setupAwal")
      .addItem("Isi daftar tenant awal (193 tenant)", "isiTenantAwal")
      .addItem("Amankan sandi admin (hash)", "migrasiSandi")
      .addItem("Cek konfigurasi", "cekKonfigurasi")
      .addItem("Pasang cadangan & arsip mingguan", "jalankanPasangPemicu")
      .addItem("Buat cadangan sekarang", "jalankanCadangan")
      .addItem("Arsipkan log lama sekarang", "jalankanArsip")
      .addToUi();
  } catch (e) { /* tidak ada UI */ }
}

function tampil_(pesan) {
  try { SpreadsheetApp.getUi().alert(pesan); } catch (e) { Logger.log(pesan); }
}

function siapkanSheet_(ss, nama, kepala) {
  var sh = ss.getSheetByName(nama) || ss.insertSheet(nama);
  if (sh.getMaxColumns() < kepala.length) sh.insertColumnsAfter(sh.getMaxColumns(), kepala.length - sh.getMaxColumns());
  var baris1 = sh.getRange(1, 1, 1, kepala.length).getValues()[0];
  for (var i = 0; i < kepala.length; i++) {
    if (!String(baris1[i]).trim()) sh.getRange(1, i + 1).setValue(kepala[i]);
  }
  sh.getRange(1, 1, 1, kepala.length).setFontWeight("bold");
  sh.setFrozenRows(1);
  return sh;
}

function setupAwal() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("PASS_PEPPER")) {
    props.setProperty("PASS_PEPPER", Utilities.getUuid() + Utilities.getUuid());
  }
  siapkanSheet_(ss, namaLogPatroli_(), KOLOM_PATROLI);
  siapkanSheet_(ss, SHEET.TENANT, KOLOM_TENANT);
  var sp = siapkanSheet_(ss, SHEET.PETUGAS, KOLOM_PETUGAS);
  sp.getRange("A2:C").setNumberFormat("@");
  var sa = siapkanSheet_(ss, SHEET.ADMIN, ["Username", "Password", "Nama", "Role"]);
  sa.getRange("B2:B").setNumberFormat("@");
  var stn = siapkanSheet_(ss, SHEET.MASTER_TENANT, KOLOM_TENANT_MASTER);
  stn.getRange("A2:D").setNumberFormat("@");
  var sz = siapkanSheet_(ss, SHEET.ZONA, KOLOM_ZONA);
  sz.getRange("A2:B").setNumberFormat("@");
  siapkanSheet_(ss, SHEET.TINDAK, KOLOM_TINDAK);
  siapkanSheet_(ss, SHEET.RIWAYAT, KOLOM_RIWAYAT);
  var si = siapkanSheet_(ss, SHEET.ITEM, KOLOM_ITEM);
  si.getRange("A2:C").setNumberFormat("@");
  if (si.getLastRow() < 2) {
    var baris = [];
    Object.keys(ITEM_DEFAULT).forEach(function (k) {
      ITEM_DEFAULT[k].forEach(function (it) { baris.push([k, it, "YA"]); });
    });
    si.getRange(2, 1, baris.length, 3).setValues(baris);
  }
  var migrasi = migrasiZonaLama_();

  var pesanAkun = "";
  if (sa.getLastRow() < 2) {
    var sandi = Utilities.getUuid().replace(/-/g, "").slice(0, 10);
    sa.getRange(2, 1, 1, 4).setNumberFormat("@").setValues([["admin", hashSandi_(sandi), "Administrator", "Admin"]]);
    pesanAkun = "\n\nAKUN ADMIN PERTAMA\nNama pengguna: admin\nKata sandi: " + sandi +
      "\nCatat sekarang, password ini tidak ditampilkan lagi. Ganti setelah masuk ke dashboard.";
  }
  tampil_("Setup selesai." + (migrasi ? "\n" + migrasi + " zona dari sheet Petugas dipindah ke sheet Zona." : "") +
    pesanAkun + "\n\nLangkah berikut:\n1) Menu 'Isi daftar tenant awal' (sekali).\n" +
    "2) Buka dashboard, masuk sebagai admin, lalu isi petugas dan zona dari menu Kelola.\n" +
    "3) Atur batas area patroli di dashboard > Pengaturan.");
}

function migrasiZonaLama_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sz = ss.getSheetByName(SHEET.ZONA), sp = ss.getSheetByName(SHEET.PETUGAS);
  if (!sz || !sp || sz.getLastRow() > 1 || sp.getLastRow() < 2) return 0;
  var zona = [];
  sp.getRange(2, 2, sp.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
    var z = bersih_(r[0], 80);
    if (z && !/^\(/.test(z) && zona.indexOf(z) < 0) zona.push(z);
  });
  if (!zona.length) return 0;
  var rng = sz.getRange(2, 1, zona.length, 2);
  rng.setNumberFormat("@");
  rng.setValues(zona.map(function (z) { return [z, "YA"]; }));
  CacheService.getScriptCache().remove(KUNCI_CACHE_MASTER);
  return zona.length;
}

function migrasiSandi() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var total = 0;
  var sa = ss.getSheetByName(SHEET.ADMIN);
  if (sa && sa.getLastRow() > 1) {
    var da = sa.getRange(2, 2, sa.getLastRow() - 1, 1).getValues();
    da.forEach(function (r, i) {
      var v = String(r[0]).trim();
      if (v && v.indexOf("h1$") !== 0) { sa.getRange(i + 2, 2).setNumberFormat("@").setValue(hashSandi_(v)); total++; }
    });
  }
  tampil_(total + " password admin berhasil di-hash. Jangan ubah script property PASS_PEPPER setelah ini.");
}

function cekKonfigurasi() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var baris = [];
  [namaLogPatroli_(), SHEET.TENANT, SHEET.PETUGAS, SHEET.ADMIN, SHEET.MASTER_TENANT, SHEET.ZONA, SHEET.ITEM,
    SHEET.TINDAK, SHEET.RIWAYAT].forEach(function (n) {
    baris.push((ss.getSheetByName(n) ? "OK     " : "HILANG ") + "sheet " + n);
  });
  baris.push((prop_("PASS_PEPPER") ? "OK     " : "HILANG ") + "PASS_PEPPER (jalankan Setup awal)");
  baris.push((prop_("FOLDER_FOTO_ID") ? "OK     " : "info   ") + "FOLDER_FOTO_ID (kosong = folder otomatis Foto_Patroli_Satpam)");
  baris.push((prop_("GEO_RADIUS_M") ? "OK     " : "PERLU  ") + "Batas area patroli (dashboard > Pengaturan). Tanpa PIN, ini penanda utama laporan dari luar mall");
  var m = ambilMaster_();
  baris.push((m.daftarNama.length ? "OK     " : "PERLU  ") + m.daftarNama.length + " petugas aktif");
  baris.push((m.daftarZona.length ? "OK     " : "PERLU  ") + m.daftarZona.length + " zona aktif");
  baris.push((m.daftarTenant.length ? "OK     " : "PERLU  ") + m.daftarTenant.length + " tenant aktif");
  var sa = ss.getSheetByName(SHEET.ADMIN);
  if (sa && sa.getLastRow() > 1) {
    var da = sa.getRange(2, 2, sa.getLastRow() - 1, 1).getValues();
    var polosA = da.filter(function (r) { var v = String(r[0]).trim(); return v && v.indexOf("h1$") !== 0; }).length;
    baris.push((polosA ? "PERLU  " : "OK     ") + polosA + " password admin masih teks biasa");
  }
  tampil_(baris.join("\n"));
}