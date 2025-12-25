const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// 1. Endpoint Root (PENTING untuk Health Check Railway)
app.get('/', (req, res) => {
    res.status(200).send("SERVER RUNNING SECURELY");
});

// 2. Folder Uploads Internal
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use('/uploads', express.static(uploadDir));
const activeStreams = {};

// 3. Endpoint Monitoring (Untuk Website Anda)
app.get('/system-stats', (req, res) => {
    res.json({
        cpuUsage: (os.loadavg()[0] * 10).toFixed(2),
        ramUsage: (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(2),
        uptime: os.uptime(),
        activeProcesses: Object.keys(activeStreams).length
    });
});

const upload = multer({ dest: 'uploads/' });

// 4. Endpoint Start Stream
app.post('/start-stream', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false });

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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`SERVER LIVE STREAM PRO RUNNING ON PORT ${PORT}`);
});

