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

// 1. Penanganan Folder (Solusi npm error path /app)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
    } catch (e) {
        console.error("Folder Error:", e);
    }
}

app.use('/uploads', express.static(uploadDir));
const activeStreams = {};

// 2. Monitoring CPU & WhatsApp Alert
const WA_API_KEY = "API_KEY_ANDA"; // Ganti dengan API Key Anda
const WA_NUMBER = "628xxx"; // Ganti dengan nomor WA Anda
let isAlertActive = false;

setInterval(() => {
    const cpuLoad = (os.loadavg()[0] * 10).toFixed(2);
    if (cpuLoad > 90 && !isAlertActive) {
        axios.get(`https://api.wa-gateway.com/send?apikey=${WA_API_KEY}&number=${WA_NUMBER}&message=${encodeURIComponent('⚠️ Server Overload: CPU ' + cpuLoad + '%')}`).catch(e => {});
        isAlertActive = true;
    } else if (cpuLoad < 70) {
        isAlertActive = false;
    }
}, 30000);

// 3. Endpoint Status (Untuk Web Anda)
app.get('/system-stats', (req, res) => {
    res.json({
        cpuUsage: (os.loadavg()[0] * 10).toFixed(2),
        ramUsage: (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(2),
        uptime: os.uptime(),
        activeProcesses: Object.keys(activeStreams).length
    });
});

// 4. Proses Streaming (Optimasi Low-CPU)
const upload = multer({ dest: 'uploads/' });

app.post('/start-stream', (req, res) => {
    const { sessionId, streamUrl, streamKey, videoPath, resolution, bitrate } = req.body;
    const streamId = Date.now().toString();

    const ffmpegArgs = [
        '-re', '-stream_loop', '-1',
        '-i', videoPath,
        '-c:v', 'libx264', '-preset', 'ultrafast', // Sangat penting untuk Railway
        '-tune', 'zerolatency',
        '-b:v', bitrate || '1500k',
        '-bufsize', '3000k',
        '-c:a', 'aac', '-b:a', '128k',
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
    Object.keys(activeStreams).forEach(id => activeStreams[id].process.kill('SIGKILL'));
    res.json({ success: true });
});

app.get('/stream-status/:sessionId', (req, res) => {
    res.json({ success: true, streams: Object.keys(activeStreams).map(id => ({ id })) });
});

// Mencegah server mati (keep-alive)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================`);
    console.log(`SERVER LIVE STREAM PRO RUNNING`);
    console.log(`PORT: ${PORT}`);
    console.log(`=================================`);
});

