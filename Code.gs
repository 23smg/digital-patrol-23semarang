// =========================================================================
// 1. UTAMA: JALUR NAVIGASI (ROUTING) PETUGAS, ADMIN, DAN INTEGRASI EXCEL
// =========================================================================
function doGet(e) {
  // JALUR 1: Jika dipanggil oleh Microsoft Excel (?export=excel)
  if (e && e.parameter && e.parameter.export === "excel") {
    var dataExcel = ambilRiwayatLaporanPatroli();
    return ContentService.createTextOutput(JSON.stringify(dataExcel))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  
  // JALUR 2: Jika diakses oleh Admin untuk Monitoring (?page=admin)
  if (e && e.parameter && e.parameter.page === 'admin') {
    return HtmlService.createTemplateFromFile('Dashboard')
        .evaluate()
        .setTitle('Dashboard Admin Patroli 23Semarang')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  // JALUR 3: Jalur Utama Petugas Lapangan / Satpam (Membuka Form Input Index)
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('Digital Patrol Log - Mall 23Semarang')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =========================================================================
// 2. LOGIKA UTAMA: SINKRONISASI DATA KE DASHBOARD WEB & EXCEL
// =========================================================================
function ambilRiwayatLaporanPatroli() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheets()[0]; // Mengambil sheet database log pertama
    var lastRow = sheet.getLastRow();
    
    if (lastRow <= 1) return { logData: [], statTotal: 0, statPetugas: 0, statZona: 0 }; 
    
    // Ambil data range dari kolom A sampai G (7 Kolom Utama sesuai gambar)
    var dataMentah = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    var hasilDanObjek = [];
    
    // Looping data terbalik (dari baris paling bawah ke atas) agar data terbaru di atas
    for (var i = dataMentah.length - 1; i >= 0; i--) {
      if (!dataMentah[i][0] && !dataMentah[i][1]) continue; // Lewati jika baris kosong
      
      var latitude = dataMentah[i][5] ? dataMentah[i][5].toString().trim() : ""; // Kolom F
      var longitude = dataMentah[i][6] ? dataMentah[i][6].toString().trim() : ""; // Kolom G
      var urlFotoMentah = dataMentah[i][4] ? dataMentah[i][4].toString().trim() : ""; // Kolom E
      var alamatText = "Alamat tidak terlacak";
      
      // Geocoder Maps Tracker Lokasi Balik
      if (latitude && longitude && latitude !== "-" && latitude !== "") {
        try {
          var response = Maps.newGeocoder().reverseGeocode(latitude, longitude);
          if (response.status === 'OK' && response.results.length > 0) {
            alamatText = response.results[0].formatted_address;
            if(alamatText.length > 60) {
              alamatText = alamatText.substring(0, 57) + "...";
            }
          }
        } catch (errMaps) {
          alamatText = "Gagal memuat koordinat lokasi mall";
        }
      }
      
      // Formatting Tanggal Waktu Tampilan
      var waktuLog = dataMentah[i][0];
      if (waktuLog instanceof Date) {
        waktuLog = Utilities.formatDate(waktuLog, "GMT+7", "dd/MM/yyyy HH:mm");
      } else {
        waktuLog = waktuLog.toString();
      }
      
      // PERBAIKAN LINK RENDER GAMBAR (Menggunakan Format Googleusercontent Engine)
      var urlFotoFinal = "Tidak ada foto";
      if (urlFotoMentah && urlFotoMentah.includes("drive.google.com")) {
        var fileId = "";
        var match = urlFotoMentah.match(/\/d\/([a-zA-Z0-9-_]+)/) || urlFotoMentah.match(/id=([a-zA-Z0-9-_]+)/);
        if (match && match[1]) {
          fileId = match[1];
          // URL render direct gambar resolusi tinggi tanpa login akun Google
          urlFotoFinal = "https://lh3.googleusercontent.com/d/" + fileId;
        } else {
          urlFotoFinal = urlFotoMentah;
        }
      }

      hasilDanObjek.push({
        "timestamp": waktuLog,
        "nama": dataMentah[i][1] ? dataMentah[i][1].toString() : "-",
        "zona": dataMentah[i][2] ? dataMentah[i][2].toString() : "-",
        "kondisi": dataMentah[i][3] ? dataMentah[i][3].toString() : "-",
        "urlFoto": urlFotoFinal, // Dikembalikan sebagai urlFoto agar sinkron dengan HTML
        "lat": latitude,
        "lng": longitude,
        "alamat": alamatText 
      });
    }
    
    // Hitung Statistik Ringkas untuk Dashboard Atas
    var totalLog = hasilDanObjek.length;
    var petugasUnik = [];
    var zonaUnik = [];
    
    hasilDanObjek.forEach(function(item) {
      if(!petugasUnik.includes(item.nama) && item.nama !== "-") petugasUnik.push(item.nama);
      if(!zonaUnik.includes(item.zona) && item.zona !== "-") zonaUnik.push(item.zona);
    });
    
    return {
      logData: hasilDanObjek,
      statTotal: totalLog,
      statPetugas: petugasUnik.length,
      statZona: zonaUnik.length
    };
    
  } catch (e) {
    console.error("Gagal memuat database: " + e.toString());
    return { logData: [], statTotal: 0, statPetugas: 0, statZona: 0 };
  }
}

// Shortcut kompatibilitas jika frontend memanggil fungsi lama
function ambilDataPatroliTerkini() {
  return ambilRiwayatLaporanPatroli();
}

// =========================================================================
// 3. LOGIKA INPUT DATA: MENERIMA LOG BARU DARI FORM SECURITY/PETUGAS
// =========================================================================
function simpanDataPatroli(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheets()[0]; 
    var urlFoto = "Tidak Ada Foto";
    
    if (data.fotoBase64 && data.fotoBase64.length > 0) {
      var namaFile = "Patroli_" + data.zona.replace(/\s+/g, '_') + "_" + new Date().getTime() + ".jpg";
      var folderName = "Foto_Patroli_Satpam";
      var folders = DriveApp.getFoldersByName(folderName);
      var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
      
      var bytes = Utilities.base64Decode(data.fotoBase64);
      var mimeType = data.fotoMime || "image/jpeg";
      var blob = Utilities.newBlob(bytes, mimeType, namaFile);
      
      var file = folder.createFile(blob);
      // Membuka akses file otomatis agar dashboard bisa memuat gambarnya tanpa restriksi login akun
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urlFoto = file.getUrl();
    }
    
    sheet.appendRow([new Date(), data.nama, data.zona, data.kondisi, urlFoto, data.lat, data.lng]);
    return { status: "SUCCESS", message: "Laporan berhasil disimpan!" };
  } catch (error) {
    return { status: "ERROR", message: "Gagal menyimpan: " + error.toString() };
  }
}

// =========================================================================
// 4. LOGIKA PENGAMBIL DATA DROPDOWN FILTER ACUAN FORM PETUGAS
// =========================================================================
function getDaftarPetugasDanZona() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Petugas");
    
    if (!sheet) {
      sheet = ss.insertSheet("Petugas");
      sheet.getRange("A1").setValue("Nama");
      sheet.getRange("B1").setValue("Zona");
      sheet.getRange("C1").setValue("Kondisi");
      sheet.getRange("A2").setValue("Budi");
      sheet.getRange("B2").setValue("Lantai G - Main Atrium");
      sheet.getRange("C2").setValue("Aman & Kondusif");
      return { daftarNama: ["Budi"], daftarZona: ["Lantai G - Main Atrium"], daftarKondisi: ["Aman & Kondusif"] };
    }
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { daftarNama: [], daftarZona: [], daftarKondisi: [] };
    
    var dataMentah = sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues();
    var daftarNama = [];
    var daftarZona = [];
    var daftarKondisi = [];
    
    for (var i = 0; i < dataMentah.length; i++) {
      var namaClean = dataMentah[i][0].toString().trim();
      var zonaClean = dataMentah[i][1].toString().trim();
      var kondisiClean = dataMentah[i][2].toString().trim();
      
      if (namaClean !== "" && namaClean.indexOf("GMT") === -1 && namaClean.indexOf("WIB") === -1) {
        daftarNama.push(namaClean);
      }
      if (zonaClean !== "") {
        daftarZona.push(zonaClean);
      }
      if (kondisiClean !== "") {
        daftarKondisi.push(kondisiClean);
      }
    }
    
    return { daftarNama: daftarNama, daftarZona: daftarZona, daftarKondisi: daftarKondisi };
  } catch (e) {
    return { daftarNama: [], daftarZona: [], daftarKondisi: [] };
  }
}