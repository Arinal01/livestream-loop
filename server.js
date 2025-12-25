const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const os = require('os');
const axios = require('axios');

const app = express();
// Railway sangat sensitif dengan port, pastikan HANYA menggunakan process.env.PORT
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Pembuatan folder uploads secara aman
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
    } catch (e) {
        console.error("Folder error:", e.message);
    }
}

app.use('/uploads', express.static(uploadDir));
const activeStreams = {};

// --- FIX: HEALTH CHECK ENDPOINT ---
// Railway membutuhkan respon 200 OK pada root URL agar container tidak di-restart
app.get('/', (req, res) => {
    res.status(200).send("Server is alive and running!");
});

// WA Notifikasi
const WA_API_KEY = "API_KEY_ANDA"; 
const WA_NUMBER = "628xxx";
let isAlertActive = false;

async function sendWANotif(msg) {
    try {
        await axios.get(`https://api.wa-gateway.com/send?apikey=${WA_API_KEY}&number=${WA_NUMBER}&message=${encodeURIComponent(msg)}`);
    } catch (e) { console.log("WA Notif Failed"); }
}

// Monitoring CPU
setInterval(() => {
    const cpuLoad = (os.loadavg()[0] * 10).toFixed(2);
    if (cpuLoad > 90 && !isAlertActive) {
        sendWANotif(`⚠️ Server Overload: CPU ${cpuLoad}%`);
        isAlertActive = true;
    } else if (cpuLoad < 70) { isAlertActive = false; }
}, 30000);

app.get('/system-stats', (req, res) => {
    res.json({
        cpuUsage: (os.loadavg()[0] * 10).toFixed(2),
        ramUsage: (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(2),
        uptime: os.uptime(),
        activeProcesses: Object.keys(activeStreams).length
    });
});

const upload = multer({ dest: 'uploads/' });

app.post('/start-stream', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "No file" });

    const { streamUrl, streamKey, resolution, bitrate } = req.body;
    const videoPath = req.file.path;
    const streamId = Date.now().toString();

    // Mapping Resolusi
    const resMap = { "480p": "854x480", "720p": "1280x720", "1080p": "1920x1080" };

    const ffmpegArgs = [
        '-re', '-stream_loop', '-1', '-i', videoPath,
        '-s', resMap[resolution] || "1280x720",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-b:v', bitrate || '1500k', '-maxrate', bitrate || '1500k', '-bufsize', '3000k',
        '-pix_fmt', 'yuv420p', '-g', '50', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
        '-f', 'flv', `${streamUrl}${streamKey}`
    ];

    const proc = spawn('ffmpeg', ffmpegArgs);
    activeStreams[streamId] = { process: proc, videoPath };

    proc.on('close', () => {
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        delete activeStreams[streamId];
    });

    res.json({ success: true, streamId });
});

app.post('/kill-all', (req, res) => {
    Object.keys(activeStreams).forEach(id => {
        if (activeStreams[id].process) activeStreams[id].process.kill('SIGKILL');
    });
    res.json({ success: true });
});

// Gunakan 0.0.0.0 agar bisa diakses secara publik oleh Railway
app.listen(PORT, '0.0.0.0', () => {
    console.log(`SERVER LIVE STREAM PRO RUNNING ON PORT ${PORT}`);
});

