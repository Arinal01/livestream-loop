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

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Penyimpanan stream aktif (Grup berdasarkan sessionId)
// Struktur: { sessionId: { streamId: { process, metadata } } }
const activeStreams = {};

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.post('/upload-video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false });
    res.json({ success: true, videoUrl: path.join(__dirname, 'uploads', req.file.filename), fileName: req.file.originalname });
});

app.post('/start-stream', (req, res) => {
    const { sessionId, streamUrl, streamKey, videoPath, resolution, bitrate, platform } = req.body;
    const streamId = Date.now().toString(); // ID Unik untuk setiap profil stream

    // Resolusi mapping
    const resMap = {
        "720p": "1280x720",
        "1080p": "1920x1080",
        "480p": "854x480"
    };

    const ffmpegArgs = [
        '-re', '-stream_loop', '-1',
        '-i', videoPath,
        '-s', resMap[resolution] || "1280x720",
        '-c:v', 'libx264', '-preset', 'veryfast',
        '-b:v', bitrate, '-maxrate', bitrate, '-bufsize', '4000k',
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
        if (activeStreams[sessionId]) delete activeStreams[sessionId][streamId];
    });

    res.json({ success: true, streamId });
});

app.get('/stream-status/:sessionId', (req, res) => {
    const session = activeStreams[req.params.sessionId];
    if (!session) return res.json({ success: true, streams: [] });
    
    const streamList = Object.values(session).map(s => s.metadata);
    res.json({ success: true, streams: streamList });
});

app.post('/stop-stream', (req, res) => {
    const { sessionId, streamId } = req.body;
    if (activeStreams[sessionId] && activeStreams[sessionId][streamId]) {
        activeStreams[sessionId][streamId].process.kill('SIGKILL');
        delete activeStreams[sessionId][streamId];
        return res.json({ success: true });
    }
    res.json({ success: false });
});

app.listen(PORT, () => console.log(`Server on port ${PORT}`));

