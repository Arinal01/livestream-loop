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

// Pembuatan folder internal untuk menghindari 'npm error path'
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
    } catch (e) {
        console.error("Folder error:", e);
    }
}

app.use('/uploads', express.static(uploadDir));

const activeStreams = {};

// Konfigurasi Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// Endpoint Monitoring Sistem
app.get('/system-stats', (req, res) => {
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    res.json({
        cpuUsage: os.loadavg()[0].toFixed(2), // Load average 1 menit
        ramUsage: (((totalMem - freeMem) / totalMem) * 100).toFixed(2),
        uptime: os.uptime()
    });
});

// Fitur Auto-Delete
function cleanupVideo(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (err) console.error("Cleanup error:", err);
            else console.log("Video deleted:", filePath);
        });
    }
}

app.post('/upload-video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false });
    res.json({ success: true, videoUrl: req.file.path });
});

app.post('/start-stream', (req, res) => {
    const { sessionId, streamUrl, streamKey, videoPath, resolution, bitrate, platform } = req.body;
    const streamId = Date.now().toString();

    const resMap = { "480p": "854x480", "720p": "1280x720", "1080p": "1920x1080" };

    const ffmpegArgs = [
        '-re', '-stream_loop', '-1',
        '-i', videoPath,
        '-s', resMap[resolution] || "1280x720",
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-b:v', bitrate, '-maxrate', bitrate, '-bufsize', '3000k',
        '-pix_fmt', 'yuv420p', '-g', '50',
        '-c:a', 'aac', '-b:a', '128k',
        '-f', 'flv', `${streamUrl}${streamKey}`
    ];

    const proc = spawn('ffmpeg', ffmpegArgs);

    if (!activeStreams[sessionId]) activeStreams[sessionId] = {};
    activeStreams[sessionId][streamId] = {
        process: proc,
        metadata: { streamId, platform, resolution, bitrate, startTime: new Date(), videoPath }
    };

    proc.on('close', () => {
        if (activeStreams[sessionId] && activeStreams[sessionId][streamId]) {
            cleanupVideo(activeStreams[sessionId][streamId].metadata.videoPath);
            delete activeStreams[sessionId][streamId];
        }
    });

    res.json({ success: true, streamId });
});

app.post('/stop-stream', (req, res) => {
    const { sessionId, streamId } = req.body;
    if (activeStreams[sessionId] && activeStreams[sessionId][streamId]) {
        activeStreams[sessionId][streamId].process.kill('SIGKILL');
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.get('/stream-status/:sessionId', (req, res) => {
    const session = activeStreams[req.params.sessionId];
    res.json({ success: true, streams: session ? Object.values(session).map(s => s.metadata) : [] });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server live on port ${PORT}`));

