const express = require('express');
const multer = require('multer'); // Untuk menangani upload file
const { spawn } = require('child_process'); // Untuk menjalankan FFmpeg
const cors = require('cors'); // Untuk mengizinkan permintaan dari frontend kamu
const dotenv = require('dotenv'); // Untuk membaca variabel lingkungan

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Konfigurasi Multer untuk penyimpanan video
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Simpan video di folder 'uploads'
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Aktifkan CORS
app.use(cors());
// Middleware untuk parse JSON body
app.use(express.json());
// Serve static files
app.use('/uploads', express.static('uploads'));

/**
 * Objek untuk menyimpan detail stream yang sedang berjalan.
 * Sekarang menyimpan objek berisi proses FFmpeg dan metadata video.
 */
const activeStreams = {}; 

// Endpoint untuk mengunggah video
app.post('/upload-video', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Tidak ada file yang diunggah.' });
  }
  const videoPath = `/app/uploads/${req.file.filename}`; 
  res.json({ 
    success: true, 
    message: 'Video berhasil diunggah.', 
    videoUrl: videoPath,
    originalName: req.file.originalname // Kirim balik nama asli untuk disimpan di frontend
  });
});

// Endpoint untuk memulai stream
app.post('/start-stream', (req, res) => {
  const { sessionId, streamUrl, streamKey, videoPath, videoName, bitrate = '3000k' } = req.body;

  if (!sessionId || !streamUrl || !streamKey || !videoPath) {
    return res.status(400).json({ success: false, message: 'Data yang diperlukan tidak lengkap.' });
  }

  if (activeStreams[sessionId]) {
    return res.status(400).json({ success: false, message: 'Stream untuk sesi ini sudah berjalan.' });
  }

  console.log(`[${sessionId}] Starting FFmpeg: ${videoPath}`);

  const ffmpegProcess = spawn('ffmpeg', [
    '-re',
    '-stream_loop', '-1',
    '-i', videoPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', bitrate,
    '-maxrate', bitrate,
    '-bufsize', '6000k',
    '-pix_fmt', 'yuv420p',
    '-g', '50',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'flv',
    `${streamUrl}/${streamKey}`
  ]);

  // Simpan proses dan metadata ke memori server
  activeStreams[sessionId] = {
    process: ffmpegProcess,
    videoName: videoName || "Live Stream", // Menyimpan nama video agar tidak hilang saat refresh
    startTime: new Date()
  };

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`[FFmpeg ${sessionId} ERR]: ${data}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`[FFmpeg ${sessionId}] exited with code ${code}`);
    delete activeStreams[sessionId]; 
  });

  ffmpegProcess.on('error', (err) => {
    console.error(`[FFmpeg ${sessionId}] Error: ${err.message}`);
    delete activeStreams[sessionId];
  });

  res.json({ success: true, message: 'Live stream berhasil dimulai!', sessionId: sessionId });
});

// Endpoint untuk menghentikan stream
app.post('/stop-stream', (req, res) => {
  const { sessionId } = req.body;

  if (activeStreams[sessionId]) {
    activeStreams[sessionId].process.kill('SIGTERM'); // Menghentikan proses FFmpeg
    delete activeStreams[sessionId];
    return res.json({ success: true, message: 'Live stream dihentikan.' });
  }

  res.json({ success: false, message: 'Tidak ada stream aktif.' });
});

/**
 * Endpoint status yang diperbarui untuk mendukung sinkronisasi frontend.
 * Digunakan frontend untuk mengecek apakah stream masih jalan saat halaman direfresh.
 */
app.get('/stream-status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const stream = activeStreams[sessionId];

  if (stream) {
    res.json({ 
      success: true, 
      isActive: true, 
      videoName: stream.videoName, 
      startTime: stream.startTime 
    });
  } else {
    res.json({ success: true, isActive: false });
  }
});

app.get('/', (req, res) => {
  res.send('K-TOOL Backend is Running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

