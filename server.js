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

// --- PENANGANAN FOLDER INTERNAL ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log("Folder uploads siap.");
    } catch (e) {
        console.error("Gagal buat folder:", e.message);
    }
}

app.use('/uploads', express.static(uploadDir));
const activeStreams = {};

// --- WA NOTIFIKASI ---
const WA_API_KEY = "API_KEY_ANDA"; 
const WA_NUMBER = "628xxx";
let isAlertActive = false;

async function sendWANotif(msg) {
    try {
        await axios.get(`https://api.wa-gateway.com/send?apikey=${WA_API_KEY}&number=${WA_NUMBER}&message=${encodeURIComponent(msg)}`);
    } catch (e) { console.log("WA Error"); }
}

// Monitoring CPU
setInterval(() => {
    const cpuLoad = (os.loadavg()[0] * 10).toFixed(2);
    if (cpuLoad > 90 && !isAlertActive) {
        sendWANotif(`⚠️ Server Overload: CPU ${cpuLoad}%`);
        isAlertActive = true;
    } else if (cpuLoad < 70) { isAlertActive = false; }
}, 30000);

// --- ENDPOINTS ---
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
    const { streamUrl, streamKey, resolution, bitrate } = req.body;
    const videoPath = req.file.path;
    const streamId = Date.now().toString();

    const ffmpegArgs = [
        '-re', '-stream_loop', '-1', '-i', videoPath,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-b:v', bitrate || '1500k', '-bufsize', '3000k',
        '-c:a', 'aac', '-b:a', '128k', '-f', 'flv', `${streamUrl}${streamKey}`
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
    Object.keys(activeStreams).forEach(id => activeStreams[id].process.kill('SIGKILL'));
    res.json({ success: true });
});

// Menjaga server tetap hidup
app.listen(PORT, '0.0.0.0', () => {
    console.log(`SERVER LIVE STREAM PRO RUNNING ON PORT ${PORT}`);
});

