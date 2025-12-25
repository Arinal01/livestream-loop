const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Pastikan folder uploads ada
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const activeStreams = {};

// 1. ENDPOINT UPLOAD
app.post('/upload-video', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'File kosong.' });
  // Path absolut untuk FFmpeg
  const videoPath = path.join(__dirname, 'uploads', req.file.filename);
  res.json({ success: true, videoUrl: videoPath });
});

// 2. ENDPOINT START (MULTI-CHANNEL)
app.post('/start-stream', (req, res) => {
  const { sessionId, streamUrl, streamKeys, videoPath, autoReconnect } = req.body;

  if (activeStreams[sessionId]) return res.json({ success: false, message: 'Stream sedang berjalan.' });

  // Ubah single key atau array keys menjadi format TEE FFmpeg
  // Contoh: [f=flv]rtmp1|[f=flv]rtmp2
  const outputs = streamKeys.map(key => `[f=flv]${streamUrl}/${key}`).join('|');

  const ffmpegArgs = [
    '-re',
    '-stream_loop', '-1', // Looping selamanya
    '-i', videoPath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2500k',
    '-maxrate', '2500k', '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p', '-g', '50',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-f', 'tee', // Menggunakan protocol TEE untuk multi-output
    '-map', '0:v:0', '-map', '0:a:0',
    outputs
  ];

  const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  activeStreams[sessionId] = {
    process: ffmpegProcess,
    startTime: new Date(),
    keys: streamKeys
  };

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`[FFmpeg ${sessionId}]: ${data}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`[Stream ${sessionId}] Berhenti. Code: ${code}`);
    delete activeStreams[sessionId];
    
    // Logika Auto Reconnect Sederhana
    if (autoReconnect && code !== 0) {
        console.log(`[${sessionId}] Reconnecting...`);
        // Trigger restart logic here if needed
    }
  });

  res.json({ success: true, message: 'Multi-stream dimulai!' });
});

// 3. ENDPOINT STOP
app.post('/stop-stream', (req, res) => {
  const { sessionId } = req.body;
  if (activeStreams[sessionId]) {
    activeStreams[sessionId].process.kill('SIGKILL');
    delete activeStreams[sessionId];
    return res.json({ success: true });
  }
  res.status(404).json({ success: false });
});

app.listen(PORT, () => console.log(`Backend siap di port ${PORT}`));

