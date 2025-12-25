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

app.get('/', (req, res) => res.status(200).send("SERVER LIVE"));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// Objek untuk menyimpan data stream berdasarkan SessionID
const activeStreams = {};

app.get('/system-stats', (req, res) => {
    res.json({
        cpuUsage: (os.loadavg()[0] * 10).toFixed(2),
        ramUsage: (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(2),
        uptime: os.uptime(),
        activeProcesses: Object.keys(activeStreams).length
    });
});

const upload = multer({ dest: 'uploads/' });

// Upload Endpoint
app.post('/upload-video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false });
    res.json({ success: true, videoUrl: req.file.path });
});

// Start Stream Endpoint
app.post('/start-stream', (req, res) => {
    const { sessionId, streamUrl, streamKey, videoPath, resolution, bitrate, platform } = req.body;
    const streamId = Date.now().toString();

    const ffmpegArgs = [
        '-re', '-stream_loop', '-1', '-i', videoPath,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-b:v', bitrate || '1500k', '-bufsize', '3000k',
        '-c:a', 'aac', '-b:a', '128k', '-f', 'flv', `${streamUrl}${streamKey}`
    ];

    const proc = spawn('ffmpeg', ffmpegArgs);

    // Simpan ke memory berdasarkan session
    if (!activeStreams[sessionId]) activeStreams[sessionId] = {};
    activeStreams[sessionId][streamId] = {
        process: proc,
        metadata: { streamId, platform, resolution, bitrate, startTime: new Date(), videoPath }
    };

    proc.on('close', () => {
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        if (activeStreams[sessionId]) delete activeStreams[sessionId][streamId];
    });

    res.json({ success: true, streamId });
});

// Status Endpoint (DIBUTUHKAN WEBSITE)
app.get('/stream-status/:sessionId', (req, res) => {
    const session = activeStreams[req.params.sessionId];
    const streamList = session ? Object.values(session).map(s => s.metadata) : [];
    res.json({ success: true, streams: streamList });
});

// Stop Stream Endpoint
app.post('/stop-stream', (req, res) => {
    const { sessionId, streamId } = req.body;
    if (activeStreams[sessionId] && activeStreams[sessionId][streamId]) {
        activeStreams[sessionId][streamId].process.kill('SIGKILL');
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`SERVER RUNNING ON PORT ${PORT}`));

