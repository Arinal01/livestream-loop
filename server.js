const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const os = require('os');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// --- KONFIGURASI WHATSAPP & MONITORING ---
const WA_API_KEY = "API_KEY_ANDA"; // Masukkan API Key Anda
const WA_NUMBER = "628xxx";       // Nomor WA Anda (format 62)
let isAlertActive = false;

// 1. Pembuatan Folder Internal (Fix npm error path /app)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
    } catch (e) {
        console.error("Gagal buat folder:", e);
    }
}

app.use('/uploads', express.static(uploadDir));
const activeStreams = {};

// 2. Fungsi Kirim WhatsApp
async function sendWANotif(message) {
    try {
        // Sesuaikan URL ini dengan dokumentasi API Gateway Anda (Contoh: Whacenter/Fowiz)
        await axios.get(`https://api.gateway-anda.com/send?apikey=${WA_API_KEY}&to=${WA_NUMBER}&msg=${encodeURIComponent(message)}`);
    } catch (error) {
        console.error("WA Notif Error:", error.message);
    }
}

// 3. Auto-Monitoring CPU (Tiap 30 Detik)
setInterval(() => {
    const cpuLoad = (os.loadavg()[0] * 10).toFixed(2);
    if (cpuLoad > 90 && !isAlertActive) {
        sendWANotif(`⚠️ ALERT: CPU Server menyentuh ${cpuLoad}%. Segera cek dashboard admin!`);
        isAlertActive = true;
    } else if (cpuLoad < 70) {
        isAlertActive = false;
    }
}, 30000);

// 4. Endpoint Monitoring
app.get('/system-stats', (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    res.json({
        cpuUsage: (os.loadavg()[0] * 10).toFixed(2),
        ramUsage: (((totalMem - freeMem) / totalMem) * 100).toFixed(2),
        uptime: os.uptime(),
        activeProcesses: Object.keys(activeStreams).length
    });
});

// 5. Fitur Auto-Delete
function cleanupVideo(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (!err) console.log("File dibersihkan:", path.basename(filePath));
        });
    }
}

// 6. Streaming Logic
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.post('/upload-video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).send();
    res.json({ success: true, videoUrl: req.file.path });
});

app.post('/start-stream', (req, res) => {
    const { sessionId, streamUrl, streamKey, videoPath, resolution, bitrate } = req.body;
    const streamId = Date.now().toString();
    const resMap = { "480p": "854x480", "720p": "1280x720", "1080p": "1920x1080" };

    const ffmpegArgs = [
        '-re', '-stream_loop', '-1', '-i', videoPath,
        '-s', resMap[resolution] || "1280x720",
        '-c:v', 'libx264', '-preset', 'ultrafast', // Mode paling ringan
        '-b:v', bitrate || '2000k', '-maxrate', bitrate || '2000k', '-bufsize', '3000k',
        '-pix_fmt', 'yuv420p', '-g', '50', '-c:a', 'aac', '-b:a', '128k',
        '-f', 'flv', `${streamUrl}${streamKey}`
    ];

    const proc = spawn('ffmpeg', ffmpegArgs);
    activeStreams[streamId] = { process: proc, videoPath };

    proc.on('close', () => {
        cleanupVideo(videoPath);
        delete activeStreams[streamId];
    });

    res.json({ success: true, streamId });
});

app.post('/kill-all', (req, res) => {
    Object.keys(activeStreams).forEach(id => activeStreams[id].process.kill('SIGKILL'));
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`SERVER AKTIF: PORT ${PORT}`));

