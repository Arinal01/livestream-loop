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

// Pastikan folder uploads ada
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// Konfigurasi CORS yang lebih kuat
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Memory storage untuk stream aktif
const activeStreams = {};

// Endpoint Upload
app.post('/upload-video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file.' });
    // Gunakan path absolute untuk FFmpeg agar lebih aman di Railway
    const videoPath = path.join(__dirname, 'uploads', req.file.filename);
    res.json({ 
        success: true, 
        videoUrl: videoPath,
        fileName: req.file.originalname 
    });
});

// Endpoint Start Stream (Mendukung Multi-Key)
app.post('/start-stream', (req, res) => {
    const { sessionId, streamUrl, streamKeys, videoPath, bitrate = '3000k' } = req.body;

    if (!sessionId || !streamUrl || !streamKeys || !videoPath) {
        return res.status(400).json({ success: false, message: 'Data tidak lengkap.' });
    }

    if (activeStreams[sessionId]) {
        return res.status(400).json({ success: false, message: 'Stream sedang berjalan.' });
    }

    const processes = [];
    const keys = Array.isArray(streamKeys) ? streamKeys : [streamKeys];

    // Jalankan satu proses FFmpeg untuk setiap stream key
    keys.forEach(key => {
        const ffmpegProcess = spawn('ffmpeg', [
            '-re',
            '-stream_loop', '-1',
            '-i', videoPath,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-b:v', bitrate,
            '-maxrate', bitrate,
            '-bufsize', '6000k',
            '-pix_fmt', 'yuv420p',
            '-g', '50',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-f', 'flv',
            `${streamUrl}${key}`
        ]);

        ffmpegProcess.stderr.on('data', (data) => console.log(`[${sessionId}] FFmpeg: ${data}`));
        
        ffmpegProcess.on('close', () => {
            console.log(`[${sessionId}] Stream key ${key} closed.`);
        });

        processes.push(ffmpegProcess);
    });

    activeStreams[sessionId] = {
        processes: processes,
        startTime: new Date(),
        channelCount: keys.length,
        videoPath: videoPath
    };

    res.json({ success: true, channelCount: keys.length });
});

// Endpoint Status (Untuk Sinkronisasi saat Refresh)
app.get('/stream-status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const stream = activeStreams[sessionId];

    if (stream) {
        res.json({ 
            success: true, 
            isActive: true, 
            startTime: stream.startTime,
            channelCount: stream.channelCount 
        });
    } else {
        res.json({ success: true, isActive: false });
    }
});

// Endpoint Stop
app.post('/stop-stream', (req, res) => {
    const { sessionId } = req.body;
    if (activeStreams[sessionId]) {
        activeStreams[sessionId].processes.forEach(p => p.kill('SIGKILL'));
        delete activeStreams[sessionId];
        return res.json({ success: true });
    }
    res.json({ success: false });
});

app.get('/', (req, res) => res.send('K-TOOL Backend Active'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

