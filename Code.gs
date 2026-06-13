// ====================================================================
// 1. JALUR UTAMA API GITHUB (doPost & doGet)
// ====================================================================

function doPost(e) {
  // Mengizinkan Cross-Origin Resource Sharing (CORS) agar GitHub bisa mengakses script Google
  var output = ContentService.createTextOutput();
  
  try {
    var dataJSON = JSON.parse(e.postData.contents);
    
    // Aksi 1: GitHub meminta data riwayat laporan untuk Dashboard
    if (dataJSON.aksi === "ambilData") {
      var dataExcel = ambilRiwayatLaporanPatroli();
      return ContentService.createTextOutput(JSON.stringify(dataExcel))
             .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Aksi 2: GitHub mengirimkan laporan patroli baru dari Satpam
    if (dataJSON.aksi === "simpanData") {
      var hasilSimpan = simpanDataPatroli(dataJSON.payload);
      return ContentService.createTextOutput(JSON.stringify(hasilSimpan))
             .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Aksi 3: GitHub meminta daftar dropdown nama satpam & zona
    if (dataJSON.aksi === "ambilDropdown") {
      var dataDropdown = getDaftarPetugasDanZona();
      return ContentService.createTextOutput(JSON.stringify(dataDropdown))
             .setMimeType(ContentService.MimeType.JSON);
    }

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "ERROR", message: error.toString() }))
           .setMimeType(ContentService.MimeType.JSON);
  }
}

// Tetap pertahankan doGet jika Anda sewaktu-waktu ingin membuka via link Google Script langsung
function doGet(e) {
  if (e && e.parameter && e.parameter.page === 'admin') {
    return HtmlService.createTemplateFromFile('Dashboard').evaluate().setTitle('Dashboard Admin Patroli 23Semarang');
  }
  return HtmlService.createTemplateFromFile('Index').evaluate().setTitle('Digital Patrol Log - Mall 23Semarang');
}

// ====================================================================
// 2. LOGIKA UTAMA: AMBIL DATA & SIMPAN DATA SPREADSHEET
// ====================================================================

function ambilRiwayatLaporanPatroli() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheets()[0]; 
    var lastRow = sheet.getLastRow();
    
    if (lastRow <= 1) return { logData: [], statTotal: 0, statPetugas: 0, statZona: 0 }; 
    
    var dataMentah = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    var hasilDanObjek = [];
    
    for (var i = dataMentah.length - 1; i >= 0; i--) {
      if (!dataMentah[i][0] && !dataMentah[i][1]) continue;
      
      var latitude = dataMentah[i][5] ? dataMentah[i][5].toString().trim() : "";
      var longitude = dataMentah[i][6] ? dataMentah[i][6].toString().trim() : "";
      var urlFotoMentah = dataMentah[i][4] ? dataMentah[i][4].toString().trim() : "";
      var alamatText = "Alamat tidak terlacak";
      
      if (latitude && longitude && latitude !== "-" && latitude !== "") {
        try {
          var response = Maps.newGeocoder().reverseGeocode(latitude, longitude);
          if (response.status === 'OK' && response.results.length > 0) {
            alamatText = response.results[0].formatted_address.replace(/,/g, ' '); 
            if(alamatText.length > 60) alamatText = alamatText.substring(0, 57) + "...";
          }
        } catch (errMaps) {
          alamatText = "Koordinat Lokasi Terkunci";
        }
      }
      
      var waktuLog = dataMentah[i][0];
      if (waktuLog instanceof Date) {
        waktuLog = Utilities.formatDate(waktuLog, "GMT+7", "dd/MM/yyyy HH:mm");
      } else {
        waktuLog = waktuLog.toString();
      }
      
      var urlFotoFinal = "Tidak ada foto";
      if (urlFotoMentah && urlFotoMentah.includes("drive.google.com")) {
        var fileId = "";
        var match = urlFotoMentah.match(/\/d\/([a-zA-Z0-9-_]+)/) || urlFotoMentah.match(/id=([a-zA-Z0-9-_]+)/);
        if (match && match[1]) {
          fileId = match[1];
          urlFotoFinal = "https://docs.google.com/uc?export=view&id=" + fileId;
        } else {
          urlFotoFinal = urlFotoMentah;
        }
      }

      hasilDanObjek.push({
        "timestamp": waktuLog,
        "nama": dataMentah[i][1] ? dataMentah[i][1].toString() : "-",
        "zona": dataMentah[i][2] ? dataMentah[i][2].toString() : "-",
        "kondisi": dataMentah[i][3] ? dataMentah[i][3].toString() : "-",
        "urlFoto": urlFotoFinal,
        "lat": latitude,
        "lng": longitude,
        "alamat": alamatText 
      });
    }
    
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
    return { logData: [], statTotal: 0, statPetugas: 0, statZona: 0 };
  }
}

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
      var blob = Utilities.newBlob(bytes, data.fotoMime || "image/jpeg", namaFile);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urlFoto = file.getUrl();
    }
    
    sheet.appendRow([new Date(), data.nama, data.zona, data.kondisi, urlFoto, data.lat, data.lng]);
    return { status: "SUCCESS", message: "Laporan berhasil disimpan!" };
  } catch (error) {
    return { status: "ERROR", message: "Gagal: " + error.toString() };
  }
}

function getDaftarPetugasDanZona() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Petugas");
    if (!sheet) return { daftarNama: ["Budi"], daftarZona: ["Main Atrium"], daftarKondisi: ["Aman"] };
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { daftarNama: [], daftarZona: [], daftarKondisi: [] };
    var dataMentah = sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues();
    var dNama = [], dZona = [], dKondisi = [];
    for (var i = 0; i < dataMentah.length; i++) {
      if (dataMentah[i][0] !== "") dNama.push(dataMentah[i][0].toString().trim());
      if (dataMentah[i][1] !== "") dZona.push(dataMentah[i][1].toString().trim());
      if (dataMentah[i][2] !== "") dKondisi.push(dataMentah[i][2].toString().trim());
    }
    return { daftarNama: dNama, daftarZona: dZona, daftarKondisi: dKondisi };
  } catch (e) {
    return { daftarNama: [], daftarZona: [], daftarKondisi: [] };
  }
}