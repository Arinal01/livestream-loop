const express = require('express');
const multer = require('multer'); // Untuk menangani upload file
const { spawn, exec } = require('child_process'); // Untuk menjalankan FFmpeg
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
    // Memberi nama file unik agar tidak bentrok
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Aktifkan CORS untuk mengizinkan frontend mengakses API ini
app.use(cors());
// Middleware untuk parse JSON body pada request
app.use(express.json());
// Serve static files from 'uploads' directory
app.use('/uploads', express.static('uploads'));

// Objek untuk menyimpan detail stream yang sedang berjalan
// Kunci adalah session ID atau user ID, nilai adalah objek proses FFmpeg
const activeStreams = {}; 

// Endpoint untuk mengunggah video
app.post('/upload-video', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Tidak ada file yang diunggah.' });
  }
  const videoPath = `/app/uploads/${req.file.filename}`; // Path di dalam container
  res.json({ success: true, message: 'Video berhasil diunggah.', videoUrl: videoPath });
});

// Endpoint untuk memulai stream
app.post('/start-stream', (req, res) => {
  const { sessionId, streamUrl, streamKey, videoPath, bitrate = '3000k' } = req.body;

  if (!sessionId || !streamUrl || !streamKey || !videoPath) {
    return res.status(400).json({ success: false, message: 'Data yang diperlukan tidak lengkap.' });
  }

  if (activeStreams[sessionId]) {
    return res.status(400).json({ success: false, message: 'Stream untuk sesi ini sudah berjalan. Hentikan dulu.' });
  }

  console.log(`[${sessionId}] Starting FFmpeg for video: ${videoPath} to ${streamUrl}/${streamKey}`);

  const ffmpegProcess = spawn('ffmpeg', [
    '-re',                 // Membaca input pada native frame rate
    '-stream_loop', '-1',  // Loop video tanpa henti
    '-i', videoPath,       // Input video dari path yang diunggah
    '-c:v', 'libx264',     // Codec video H.264
    '-preset', 'veryfast', // Preset encoding cepat
    '-b:v', bitrate,       // Video bitrate
    '-maxrate', bitrate,   // Max video bitrate
    '-bufsize', '6000k',   // Buffer size
    '-pix_fmt', 'yuv420p', // Pixel format
    '-g', '50',            // GOP size
    '-c:a', 'aac',         // Codec audio AAC
    '-b:a', '128k',        // Audio bitrate
    '-f', 'flv',           // Format output FLV (untuk RTMP)
    `${streamUrl}/${streamKey}` // URL dan kunci stream tujuan
  ]);

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`[FFmpeg ${sessionId} ERR]: ${data}`);
    // Kamu bisa menyimpan log ini ke database atau mengirim ke frontend via WebSocket
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`[FFmpeg ${sessionId}] child process exited with code ${code}`);
    delete activeStreams[sessionId]; // Hapus dari daftar stream aktif
  });

  ffmpegProcess.on('error', (err) => {
    console.error(`[FFmpeg ${sessionId}] Failed to start FFmpeg process: ${err.message}`);
    delete activeStreams[sessionId];
  });

  activeStreams[sessionId] = ffmpegProcess; // Simpan proses FFmpeg yang aktif

  res.json({ success: true, message: 'Live stream berhasil dimulai!', sessionId: sessionId });
});

// Endpoint untuk menghentikan stream
app.post('/stop-stream', (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ success: false, message: 'Session ID diperlukan.' });
  }

  if (activeStreams[sessionId]) {
    activeStreams[sessionId].kill('SIGTERM'); // Kirim sinyal terminate ke proses FFmpeg
    delete activeStreams[sessionId];
    console.log(`[${sessionId}] Live stream dihentikan.`);
    return res.json({ success: true, message: 'Live stream berhasil dihentikan.' });
  }

  res.json({ success: false, message: 'Tidak ada live stream yang berjalan untuk sesi ini.' });
});

// Endpoint untuk mendapatkan status stream (opsional)
app.get('/stream-status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const isActive = !!activeStreams[sessionId];
  res.json({ success: true, isActive: isActive });
});

app.get('/', (req, res) => {
  res.send('Railway Live Streaming Backend is Running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
