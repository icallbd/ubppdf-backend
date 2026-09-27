require("dotenv").config(); // Memuat environment variable dari file .env
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const port = 3000;

app.use(cors({ origin: "*" }));
// MENINGKATKAN LIMIT MEMORI UNTUK PDF TEBAL (50MB)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const translate = require("google-translate-api-x");

const uploadDir = path.join(__dirname, "temp");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// =========================================================================
// 1. KONFIGURASI & ENDPOINT: LIBREOFFICE (WORD, EXCEL, PPT, DLL TO PDF)
// =========================================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "temp/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || ".xlsx";
    cb(null, uniqueSuffix + ext);
  },
});
const upload = multer({ storage: storage });

app.post("/api/convert-to-pdf", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Tidak ada file yang diunggah." });
  }

  const inputPath = req.file.path;
  const outputFileName = req.file.filename.replace(
    path.extname(req.file.filename),
    ".pdf",
  );
  const outputPath = path.join(__dirname, "temp", outputFileName);
  const orientation = req.body.orientation || "portrait";

  console.log(
    `Menerima file konversi: ${req.file.originalname} | Orientasi: ${orientation}`,
  );

  const sofficePath = '"C:\\Program Files\\LibreOffice\\program\\soffice.exe"';
  const outputDir = path.join(__dirname, "temp");

  let command = `${sofficePath} --headless --convert-to pdf "${inputPath}" --outdir "${outputDir}"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Gagal mengeksekusi LibreOffice: ${error.message}`);
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      return res
        .status(500)
        .json({ error: "Gagal merender PDF melalui LibreOffice." });
    }

    console.log("Konversi LibreOffice berhasil. Mengirim PDF ke client...");

    if (fs.existsSync(outputPath)) {
      res.download(outputPath, "Converted-Document.pdf", (downloadErr) => {
        if (downloadErr) console.error("Gagal mengirim file:", downloadErr);
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      });
    } else {
      console.error("File output PDF tidak ditemukan.");
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      res
        .status(500)
        .json({ error: "Terjadi kesalahan sistem saat membuat file PDF." });
    }
  });
});

// =========================================================================
// 2. KONFIGURASI & ENDPOINT: GHOSTSCRIPT (COMPRESS PDF)
// =========================================================================
const compressStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "temp/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-uncompressed.pdf"); // Memaksa ekstensi untuk membedakan file
  },
});
const uploadCompress = multer({ storage: compressStorage });

app.post("/api/compress-pdf", uploadCompress.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Tidak ada file yang diunggah." });
  }

  const inputPath = req.file.path;
  const outputFileName = req.file.filename.replace(
    "-uncompressed.pdf",
    "-compressed.pdf",
  );
  const outputPath = path.join(__dirname, "temp", outputFileName);
  const level = req.body.level || "recommended";

  console.log(
    `Menerima file kompresi: ${req.file.originalname} | Level: ${level}`,
  );

  // Path sudah disesuaikan dengan versi Ghostscript 10.07.1 milik Anda
  const gsPath = '"C:\\Program Files\\gs\\gs10.07.1\\bin\\gswin64c.exe"';

  // Pengaturan Kualitas Ghostscript yang Lebih Agresif
  let ghostscriptParams = "";

  if (level === "extreme") {
    // Kualitas Layar (72 DPI) - Paling agresif merusak gambar untuk ukuran super kecil
    ghostscriptParams =
      "-dPDFSETTINGS=/screen -dColorImageResolution=72 -dGrayImageResolution=72 -dMonoImageResolution=72 -dDownsampleColorImages=true";
  } else if (level === "less") {
    // Kualitas Cetak Tinggi (300 DPI) - Kompresi ringan
    ghostscriptParams =
      "-dPDFSETTINGS=/prepress -dColorImageResolution=300 -dGrayImageResolution=300 -dMonoImageResolution=1200 -dDownsampleColorImages=true";
  } else {
    // Rekomendasi Seimbang (150 DPI) - Kualitas e-book
    ghostscriptParams =
      "-dPDFSETTINGS=/ebook -dColorImageResolution=150 -dGrayImageResolution=150 -dMonoImageResolution=300 -dDownsampleColorImages=true";
  }

  const command = `${gsPath} -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 ${ghostscriptParams} -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;

  console.log(
    `Memulai kompresi mesin Ghostscript dengan parameter: ${ghostscriptParams}...`,
  );

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Gagal mengeksekusi Ghostscript: ${error.message}`);
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      return res
        .status(500)
        .json({ error: "Gagal mengompresi PDF via Ghostscript." });
    }

    console.log("Kompresi Ghostscript selesai. Mengirim file ke client...");

    if (fs.existsSync(outputPath)) {
      res.download(outputPath, "Compressed-Document.pdf", (downloadErr) => {
        if (downloadErr) console.error("Gagal mengirim file:", downloadErr);
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      });
    } else {
      console.error("File output terkompresi tidak ditemukan.");
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      res.status(500).json({
        error: "Terjadi kesalahan sistem saat membuat file kompresi.",
      });
    }
  });
});

// =========================================================================
// 3. KONFIGURASI & ENDPOINT: PDF TO WORD (LIBREOFFICE)
// =========================================================================
app.post("/api/pdf-to-word", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Tidak ada file yang diunggah." });
  }

  const inputPath = req.file.path;
  const outputDir = path.dirname(inputPath);

  // LibreOffice akan menghasilkan file output dengan nama dasar yang sama dengan input, tapi berekstensi .docx
  const outputFileName = req.file.filename.replace(
    path.extname(req.file.filename),
    ".docx",
  );
  const outputPath = path.join(outputDir, outputFileName);

  const sofficePath = '"C:\\Program Files\\LibreOffice\\program\\soffice.exe"';

  // Command khusus LibreOffice untuk membaca PDF (writer_pdf_import) dan mengekspornya ke docx
  const command = `${sofficePath} --headless --infilter="writer_pdf_import" --convert-to docx "${inputPath}" --outdir "${outputDir}"`;

  console.log(`[PROSES] Mengonversi PDF ke Word: ${req.file.originalname}`);

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error("Error eksekusi LibreOffice:", error);
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); // Cleanup
      return res.status(500).json({ error: "Gagal mengonversi dokumen." });
    }

    // Periksa apakah file .docx berhasil dibuat
    if (fs.existsSync(outputPath)) {
      console.log("Konversi PDF ke Word selesai. Mengirim file ke client...");
      res.download(outputPath, "Converted-Document.docx", (downloadErr) => {
        if (downloadErr) console.error("Gagal mengirim file:", downloadErr);

        // Hapus file sementara dari server setelah berhasil dikirim
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      });
    } else {
      console.error("File output .docx tidak ditemukan.");
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); // Cleanup
      res
        .status(500)
        .json({ error: "Terjadi kesalahan sistem saat membuat file Word." });
    }
  });
});

// =========================================================================
// 4. KONFIGURASI & ENDPOINT: PDF TO EXCEL (LIBREOFFICE)
// =========================================================================
app.post("/api/pdf-to-excel", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Tidak ada file yang diunggah." });
  }

  const inputPath = req.file.path;
  const outputDir = path.dirname(inputPath);

  // LibreOffice akan menghasilkan file output ber-ekstensi .xlsx
  const outputFileName = req.file.filename.replace(
    path.extname(req.file.filename),
    ".xlsx",
  );
  const outputPath = path.join(outputDir, outputFileName);

  const sofficePath = '"C:\\Program Files\\LibreOffice\\program\\soffice.exe"';

  // Command khusus LibreOffice untuk membaca PDF dengan Calc Import
  const command = `${sofficePath} --headless --infilter="calc_pdf_import" --convert-to xlsx "${inputPath}" --outdir "${outputDir}"`;

  console.log(`[PROSES] Mengonversi PDF ke Excel: ${req.file.originalname}`);

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error("Error eksekusi LibreOffice:", error);
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); // Cleanup
      return res.status(500).json({ error: "Gagal mengonversi dokumen." });
    }

    if (fs.existsSync(outputPath)) {
      console.log("Konversi PDF ke Excel selesai. Mengirim file...");
      res.download(outputPath, "Extracted-Document.xlsx", (downloadErr) => {
        if (downloadErr) console.error("Gagal mengirim file:", downloadErr);

        // Hapus file sementara
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      });
    } else {
      console.error("File output .xlsx tidak ditemukan.");
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      res
        .status(500)
        .json({ error: "Terjadi kesalahan sistem saat membuat file Excel." });
    }
  });
});

// =========================================================================
// 5. KONFIGURASI & ENDPOINT: PDF TO PPTX (LIBREOFFICE IMPRESS)
// =========================================================================
app.post("/api/pdf-to-pptx", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Tidak ada file yang diunggah." });
  }

  const inputPath = req.file.path;
  const outputDir = path.dirname(inputPath);

  // LibreOffice akan menghasilkan file output ber-ekstensi .pptx
  const outputFileName = req.file.filename.replace(
    path.extname(req.file.filename),
    ".pptx",
  );
  const outputPath = path.join(outputDir, outputFileName);

  const sofficePath = '"C:\\Program Files\\LibreOffice\\program\\soffice.exe"';

  // Command khusus LibreOffice (Impress) untuk membaca PDF dan mengekspornya ke pptx
  const command = `${sofficePath} --headless --infilter="impress_pdf_import" --convert-to pptx "${inputPath}" --outdir "${outputDir}"`;

  console.log(`[PROSES] Mengonversi PDF ke PPTX: ${req.file.originalname}`);

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error("Error eksekusi LibreOffice:", error);
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); // Cleanup
      return res.status(500).json({ error: "Gagal mengonversi dokumen." });
    }

    if (fs.existsSync(outputPath)) {
      console.log("Konversi PDF ke PPTX selesai. Mengirim file...");
      res.download(outputPath, "Converted-Presentation.pptx", (downloadErr) => {
        if (downloadErr) console.error("Gagal mengirim file:", downloadErr);

        // Hapus file sementara
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      });
    } else {
      console.error("File output .pptx tidak ditemukan.");
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      res.status(500).json({
        error: "Terjadi kesalahan sistem saat membuat file presentasi.",
      });
    }
  });
});

// =========================================================================
// 6. ENDPOINT TRANSLATE (Menggunakan Google Translate Gratis)
// =========================================================================
app.post("/api/translate", async (req, res) => {
  const { text, from, to } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Teks tidak boleh kosong" });
  }

  try {
    // Ubah format 'autodetect' menjadi 'auto' sesuai standar library
    const fromLang = from === "autodetect" ? "auto" : from;

    const result = await translate(text, { from: fromLang, to: to });
    res.json({ translatedText: result.text });
  } catch (error) {
    console.error("Gagal menerjemahkan teks:", error.message);
    res.status(500).json({ error: "Gagal menerjemahkan teks dari server." });
  }
});

// =========================================================================
// 7. ENDPOINT AI PARAPHRASER (Menggunakan Google Gemini API)
// =========================================================================
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/api/paraphrase", async (req, res) => {
  try {
    const { text, mode, intensity } = req.body;

    if (!text || text.trim() === "") {
      return res.status(400).json({ error: "Teks tidak boleh kosong." });
    }

    // Konfigurasi Deskripsi Dinamis sesuai Aturan Strict
    let modeDesc = "";
    switch (mode) {
      case "academic":
        modeDesc =
          "Formal, objektif, terstruktur, gunakan kosakata akademis secukupnya tanpa berlebihan. Cocok untuk jurnal/makalah.";
        break;
      case "formal":
        modeDesc =
          "Profesional, sopan, jelas, dan lugas. Cocok untuk email atau laporan kerja.";
        break;
      case "creative":
        modeDesc =
          "Ekspresif, menarik, variasi kalimat luwes tanpa mengubah inti fakta.";
        break;
      default:
        modeDesc = "Natural, jelas, bahasa sehari-hari yang rapi.";
    }

    let intDesc = "";
    switch (intensity) {
      case "low":
        intDesc =
          "Perubahan minimal. Fokus pada perbaikan grammar dan readability. Pertahankan sebagian besar struktur kalimat asli.";
        break;
      case "high":
        intDesc =
          "Perubahan struktur signifikan. Susun ulang kalimat dengan variasi tinggi namun makna 100% sama.";
        break;
      case "very high":
        intDesc =
          "Tulis ulang secara total dengan konstruksi yang jauh berbeda. JANGAN mengarang fakta baru atau mengurangi informasi.";
        break;
      default:
        intDesc =
          "Perubahan sedang. Ubah beberapa struktur kalimat dengan variasi kosakata yang natural (Default).";
    }

    // Prompt Engineering Strict Rules
    const systemPrompt = `Anda adalah AI Paraphraser profesional. Hasilkan teks parafrase dengan mematuhi ATURAN MUTLAK berikut:
1. OUTPUT HANYA BERUPA TEKS HASIL PARAFRASE. Dilarang keras memberikan awalan (seperti "Berikut adalah..."), penjelasan, tanda kutip ekstra, atau format markdown yang tidak ada di teks asli.
2. Pertahankan 100% makna asli, data, angka, nama, dan istilah teknis (Content Preservation).
3. Human-like & Anti-Thesaurus: Jangan memaksakan kata-kata rumit. Tulisan harus mengalir senatural mungkin seperti tulisan manusia.
4. Language Preservation: Deteksi bahasa input otomatis. Jika input Bahasa Indonesia -> balas dengan Bahasa Indonesia. Jika input Inggris -> balas dengan Inggris. Jangan terjemahkan.

PENGATURAN:
- Gaya Bahasa (Mode): ${modeDesc}
- Tingkat Perubahan (Intensity): ${intDesc}

TEKS INPUT YANG HARUS DIPARAFRASE:
${text}`;

    // Gunakan model gemini-1.5-flash untuk kecepatan teks yang optimal
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    const result = await model.generateContent(systemPrompt);
    const responseText = result.response.text();

    res.json({ result: responseText.trim() });
  } catch (error) {
    console.error("Gemini API Error:", error);
    res
      .status(500)
      .json({
        error:
          "Gagal memproses teks. Silakan periksa koneksi atau API Key Anda.",
      });
  }
});

// =========================================================================
// RUN SERVER
// =========================================================================
app.listen(port, () => {
  console.log(`========================================================`);
  console.log(`[READY] Backend Server API berjalan di port ${port}`);
  console.log(`- Endpoint Konversi LibreOffice : /api/convert-to-pdf`);
  console.log(`- Endpoint Kompresi Ghostscript : /api/compress-pdf`);
  console.log(`- Endpoint PDF to Word L.Office : /api/pdf-to-word`);
  console.log(`- Endpoint PDF to Excel L.Office: /api/pdf-to-excel`);
  console.log(`- Endpoint PDF to PPTX L.Office : /api/pdf-to-pptx`);
  console.log(`- Endpoint Translate API        : /api/translate`);
  console.log(`- Endpoint AI Paraphrase(Gemini): /api/paraphrase`);
  console.log(`========================================================`);
});
