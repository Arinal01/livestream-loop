const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const os = require('os');

const app = express();
// Menggunakan process.env.PORT agar sesuai dengan konfigurasi dinamis Railway
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// --- 1. HANDLING FOLDER UPLOADS ---
// Dibuat secara internal oleh Node.js untuk menghindari error izin akses shell di Railway
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log("Folder 'uploads' berhasil dibuat.");
    } catch (e) {
        console.error("Gagal membuat folder uploads:", e);
    }
}

app.use('/uploads', express.static(uploadDir));

// Objek untuk menyimpan data stream yang sedang berjalan
const activeStreams = {};

// --- 2. KONFIGURASI PENYIMPANAN VIDEO (MULTER) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// --- 3. ENDPOINT MONITORING SISTEM (UNTUK ADMIN) ---
app.get('/system-stats', (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    // Menghitung statistik penggunaan server
    const stats = {
        cpuUsage: (os.loadavg()[0] * 10).toFixed(2), // Estimasi load CPU dalam %
        ramUsage: (((totalMem - freeMem) / totalMem) * 100).toFixed(2), // % RAM terpakai
        uptime: os.uptime(), // Durasi server berjalan (detik)
        activeProcesses: Object.keys(activeStreams).reduce((acc, user) => {
            return acc + Object.keys(activeStreams[user]).length;
        }, 0)
    };
    res.json(stats);
});

// --- 4. FITUR AUTO-DELETE ---
// Menghapus file video secara permanen dari server setelah stream selesai
function cleanupVideo(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (err) console.error("Auto-Delete Error:", err);
            else console.log("File sampah berhasil dihapus:", path.basename(filePath));
        });
    }
}

// --- 5. ENDPOINTS CORE ---

// Upload Video
app.post('/upload-video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    res.json({ success: true, videoUrl: req.file.path });
});

// Mulai Streaming
app.post('/start-stream', (req, res) => {
    const { sessionId, streamUrl, streamKey, videoPath, resolution, bitrate, platform } = req.body;
    const streamId = Date.now().toString();

    // Mapping resolusi video
    const resMap = { 
        "480p": "854x480", 
        "720p": "1280x720", 
        "1080p": "1920x1080" 
    };

    // Argumen FFmpeg Optimized untuk Cloud (Ultrafast preset agar CPU hemat)
    const ffmpegArgs = [
        '-re',                     // Baca file sesuai kecepatan frame asli
        '-stream_loop', '-1',      // Looping video selamanya
        '-i', videoPath,           // Input file
        '-s', resMap[resolution] || "1280x720",
        '-c:v', 'libx264',         // Codec video
        '-preset', 'ultrafast',    // Penggunaan CPU paling rendah
        '-b:v', bitrate || '2500k', 
        '-maxrate', bitrate || '2500k', 
        '-bufsize', '3000k',
        '-pix_fmt', 'yuv420p',
        '-g', '50',                // Keyframe interval
        '-c:a', 'aac',             // Codec audio
        '-b:a', '128k',
        '-ar', '44100',
        '-f', 'flv',               // Format output untuk RTMP
        `${streamUrl}${streamKey}` // Tujuan (RTMP URL + Key)
    ];

    const proc = spawn('ffmpeg', ffmpegArgs);

    // Simpan proses ke dalam memori
    if (!activeStreams[sessionId]) activeStreams[sessionId] = {};
    activeStreams[sessionId][streamId] = {
        process: proc,
        metadata: { streamId, platform, resolution, bitrate, startTime: new Date(), videoPath }
    };

    // Trigger pembersihan saat proses berhenti/dimatikan
    proc.on('close', () => {
        if (activeStreams[sessionId] && activeStreams[sessionId][streamId]) {
            const pathToDelete = activeStreams[sessionId][streamId].metadata.videoPath;
            cleanupVideo(pathToDelete); // Hapus file video
            delete activeStreams[sessionId][streamId]; // Hapus dari daftar aktif
            console.log(`Stream ${streamId} telah diberhentikan & file dihapus.`);
        }
    });

    // Logging error FFmpeg untuk debugging di Railway console
    proc.stderr.on('data', (data) => {
        // Hanya aktifkan jika butuh debug: console.log(`FFmpeg: ${data}`);
    });

    res.json({ success: true, streamId });
});

// Hentikan Streaming
app.post('/stop-stream', (req, res) => {
    const { sessionId, streamId } = req.body;
    if (activeStreams[sessionId] && activeStreams[sessionId][streamId]) {
        activeStreams[sessionId][streamId].process.kill('SIGKILL');
        res.json({ success: true, message: "Stream stopping..." });
    } else {
        res.json({ success: false, message: "Stream not found" });
    }
} );

// Ambil Status Berdasarkan User
app.get('/stream-status/:sessionId', (req, res) => {
    const session = activeStreams[req.params.sessionId];
    const streamList = session ? Object.values(session).map(s => s.metadata) : [];
    res.json({ success: true, streams: streamList });
});

// --- 6. RUN SERVER ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`-----------------------------------------`);
    console.log(`SERVER LIVE STREAM PRO BERJALAN`);
    console.log(`Port    : ${PORT}`);
    console.log(`Status  : OK`);
    console.log(`-----------------------------------------`);
});

