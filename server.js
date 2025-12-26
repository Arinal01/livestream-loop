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

// --- FIX: ENDPOINT MONITORING (DARI KODE BARU) ---
app.get('/system-stats', (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    res.json({
        success: true,
        cpuUsage: (os.loadavg()[0] * 10).toFixed(1), 
        ramUsage: ((usedMem / totalMem) * 100).toFixed(1), 
        uptime: os.uptime(), 
        activeStreamsCount: Object.keys(activeStreams).reduce((acc, key) => acc + Object.keys(activeStreams[key]).length, 0)
    });
});

const logStream = (id, msg) => console.log(`[Stream ${id}] ${msg}`);
const upload = multer({ dest: 'uploads/' });

app.post('/upload-video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false });
    const targetPath = path.join(uploadDir, `${Date.now()}-${req.file.originalname}`);
    fs.renameSync(req.file.path, targetPath);
    res.json({ success: true, videoUrl: targetPath });
});

app.post('/start-stream', (req, res) => {
    const { sessionId, streamUrl, streamKey, videoPath, resolution, bitrate, platform } = req.body;
    const streamId = Date.now().toString();

    // --- FIX: LOGIKA FFMPEG STABIL (DARI KODE LAMA) ---
    const ffmpegArgs = [
        '-re',
        '-stream_loop', '-1',
        '-i', videoPath,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-b:v', bitrate || '2500k',
        '-maxrate', bitrate || '2500k',
        '-bufsize', '5000k',
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-f', 'flv',
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

    // Tetap pantau error agar proses tidak gantung
    proc.stderr.on('data', (data) => {
        // console.log(`FFMPEG: ${data}`); 
    });

    proc.on('close', (code) => {
        logStream(streamId, `Process exited with code ${code}`);
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

// --- FIX: ENDPOINT KILL ALL AGAR SESUAI DENGAN DASHBOARD ---
app.post('/kill-all', (req, res) => {
    Object.keys(activeStreams).forEach(sessionId => {
        Object.keys(activeStreams[sessionId]).forEach(streamId => {
            activeStreams[sessionId][streamId].process.kill('SIGKILL');
        });
    });
    res.json({ success: true, message: "All processes terminated" });
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

// --- FIX: CLEANUP AMAN ---
// Kita tidak menghapus file saat server start karena bisa memutus live yang sedang berjalan 
// jika Railway melakukan restart proses ringan.
const clearUploadsSafe = () => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(uploadDir, file);
            const stats = fs.statSync(filePath);
            const now = new Date().getTime();
            const endTime = new Date(stats.mtime).getTime() + (24 * 60 * 60 * 1000); // 24 jam
            
            // Hanya hapus jika file sudah lebih dari 24 jam (Aman untuk long-live)
            if (now > endTime) {
                fs.unlinkSync(filePath);
            }
        });
    });
};
// Jalankan pembersihan setiap 1 jam, bukan saat start
setInterval(clearUploadsSafe, 3600000);

app.listen(PORT, '0.0.0.0', () => console.log(`SERVER RUNNING ON PORT ${PORT}`));

