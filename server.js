const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080; 

app.use(cors());
app.use(express.json());

// PERBAIKAN: Membuat folder secara internal melalui Node.js (lebih aman di Railway)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
    } catch (err) {
        console.error("Gagal membuat folder uploads:", err);
    }
}

app.use('/uploads', express.static(uploadDir));

const activeStreams = {};

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// Fitur Auto-Delete: Menghapus file video setelah stream dimatikan
function cleanupVideo(filePath) {
    fs.unlink(filePath, (err) => {
        if (err) console.error("Gagal menghapus file:", err);
        else console.log("File sampah berhasil dibersihkan:", filePath);
    });
}

app.post('/start-stream', (req, res) => {
    const { sessionId, streamUrl, streamKey, videoPath, resolution, bitrate, platform } = req.body;
    const streamId = Date.now().toString();

    const resMap = { "480p": "854x480", "720p": "1280x720", "1080p": "1920x1080" };

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
        console.log(`Stream ${streamId} berhenti.`);
        // File dihapus otomatis saat stream mati agar disk tidak penuh
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
        // cleanupVideo akan dipicu oleh event 'close' di atas
        return res.json({ success: true });
    }
    res.json({ success: false });
});

app.get('/stream-status/:sessionId', (req, res) => {
    const session = activeStreams[req.params.sessionId];
    const streamList = session ? Object.values(session).map(s => s.metadata) : [];
    res.json({ success: true, streams: streamList });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

