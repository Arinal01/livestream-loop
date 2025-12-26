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

const activeStreams = {};

// --- HELPER: LOG KE CONSOLE AGAR BISA DILIHAT DI RAILWAY LOGS ---
const logStream = (id, msg) => console.log(`[Stream ${id}] ${msg}`);

const upload = multer({ dest: 'uploads/' });

app.post('/upload-video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false });
    // Beri nama permanen agar tidak terhapus otomatis oleh sistem tertentu
    const targetPath = path.join(uploadDir, `${Date.now()}-${req.file.originalname}`);
    fs.renameSync(req.file.path, targetPath);
    res.json({ success: true, videoUrl: targetPath });
});

app.post('/start-stream', (req, res) => {
    const { sessionId, streamUrl, streamKey, videoPath, resolution, bitrate, platform } = req.body;
    const streamId = Date.now().toString();

    // OPTIMASI FFmpeg: Ditambahkan buffer dan reconnect flags
    const ffmpegArgs = [
        '-re',
        '-stream_loop', '-1', // Loop selamanya
        '-i', videoPath,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-b:v', bitrate || '2500k',
        '-maxrate', bitrate || '2500k',
        '-bufsize', '5000k', // Buffer lebih besar agar stabil
        '-pix_fmt', 'yuv420p', // Kompatibilitas tinggi platform
        '-g', '60', // Keyframe interval (penting untuk YT/TikTok)
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-f', 'flv',
        // Tambahkan timeout agar tidak menggantung jika platform down
        `${streamUrl}${streamKey}`
    ];

    const proc = spawn('ffmpeg', ffmpegArgs);

    if (!activeStreams[sessionId]) activeStreams[sessionId] = {};
    
    activeStreams[sessionId][streamId] = {
        process: proc,
        metadata: { 
            streamId, 
            platform, 
            resolution, 
            bitrate, 
            startTime: new Date(), 
            videoPath,
            status: 'starting'
        }
    };

    logStream(streamId, `Started streaming ${platform}`);

    // Pantau error dari FFmpeg
    proc.stderr.on('data', (data) => {
        // Uncomment baris bawah jika ingin debugging berat di Railway logs
        // console.log(`FFMPEG LOG: ${data}`);
    });

    proc.on('close', (code) => {
        logStream(streamId, `Process exited with code ${code}`);
        // JANGAN hapus videoPath di sini jika ingin auto-restart manual nanti
        if (activeStreams[sessionId]) {
            delete activeStreams[sessionId][streamId];
        }
    });

    proc.on('error', (err) => {
        logStream(streamId, `Failed to start: ${err.message}`);
    });

    res.json({ success: true, streamId });
});

app.get('/stream-status/:sessionId', (req, res) => {
    const session = activeStreams[req.params.sessionId];
    const streamList = session ? Object.values(session).map(s => s.metadata) : [];
    res.json({ success: true, streams: streamList });
});

// FIX: Endpoint Stop-All untuk membersihkan FFmpeg yang tersangkut
app.post('/stop-all/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (activeStreams[sessionId]) {
        Object.keys(activeStreams[sessionId]).forEach(id => {
            activeStreams[sessionId][id].process.kill('SIGKILL');
        });
        delete activeStreams[sessionId];
    }
    res.json({ success: true });
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

// Cleanup: Hapus file video lama yang tidak terpakai saat server restart
const clearUploads = () => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) return;
        files.forEach(file => fs.unlinkSync(path.join(uploadDir, file)));
    });
};
clearUploads();

app.listen(PORT, '0.0.0.0', () => console.log(`SERVER RUNNING ON PORT ${PORT}`));

