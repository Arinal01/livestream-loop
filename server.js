const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8080;

// --- CONFIG KEAMANAN (RAILWAY VARIABLES) ---
const ADMIN_SECRET_PASSWORD = process.env.ADMIN_PASSWORD; 
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.status(200).send("SERVER LIVE"));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

const activeStreams = {};

// ==========================================
// NEW: ENDPOINT UNTUK LOGIN ADMIN & PROXY
// ==========================================

app.post('/admin-login', (req, res) => {
    const { password } = req.body;
    if (password && password === ADMIN_SECRET_PASSWORD) {
        res.json({ success: true, message: "Auth Success" });
    } else {
        res.status(401).json({ success: false, message: "Password Salah atau Belum Diatur" });
    }
});

app.get('/youtube-proxy', async (req, res) => {
    const { endpoint, q, videoId } = req.query;
    if (!YOUTUBE_API_KEY) return res.status(500).json({ success: false, error: "API Key YouTube belum diatur" });

    let url = "";
    if (endpoint === 'search') {
        url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=50&q=${encodeURIComponent(q)}&type=video&key=${YOUTUBE_API_KEY}`;
    } else if (endpoint === 'video') {
        url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;
    }

    try {
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// AI CONTENT GENERATOR WITH MULTI-MODEL FALLBACK
// ==========================================
app.post('/generate', async (req, res) => {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: "Topic is required" });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: "Gemini API Key belum diatur di server" });

    // Daftar model fallback sesuai ketersediaan akun Anda
    const allowedModels = [
        "gemini-2.0-flash", 
        "gemini-2.0-flash-001", 
        "gemini-2.5-flash", 
        "gemini-flash-latest",
        "gemini-2.0-flash-lite",
        "gemma-3-27b-it"
    ];

    const prompt = `Berperanlah sebagai pakar SEO YouTube 2025. Berikan 4 judul video viral yang berbeda gaya (Clickbait, Edukasi, Storytelling, Listicle) dan 1 deskripsi video yang mengandung SEO tinggi untuk topik: "${topic}". Jawab WAJIB dalam format JSON murni tanpa markdown: {"titles": [{"tag": "VIRAL", "text": "isi"}, {"tag": "STRATEGY", "text": "isi"}, {"tag": "SECRET", "text": "isi"}, {"tag": "GUIDE", "text": "isi"}], "description": "isi"}`;

    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    
    let lastError = null;

    // Logika Fallback: Mencoba model satu per satu jika gagal
    for (const modelName of allowedModels) {
        try {
            console.log(`Mencoba generate menggunakan model: ${modelName}`);
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const data = await response.json();

            if (data.candidates && data.candidates.length > 0) {
                let aiText = data.candidates[0].content.parts[0].text;
                const cleanJson = aiText.replace(/```json|```/g, "").trim();
                return res.json(JSON.parse(cleanJson)); // Berhasil, langsung return
            } else if (data.error) {
                throw new Error(data.error.message);
            }
        } catch (error) {
            console.warn(`Model ${modelName} gagal: ${error.message}`);
            lastError = error.message;
            continue; // Coba model berikutnya
        }
    }

    // Jika semua model gagal
    res.status(500).json({ error: "Semua model AI gagal merespon", details: lastError });
});

// ==========================================
// MONITORING & STREAMING LOGIC (ORIGINAL)
// ==========================================

app.get('/system-stats', (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    res.json({
        success: true,
        cpuUsage: (os.loadavg()[0] * 10).toFixed(1), 
        ramUsage: ((usedMem / totalMem) * 100).toFixed(1), 
        uptime: os.uptime(), 
        activeStreamsCount: Object.keys(activeStreams).reduce((acc, key) => {
            return acc + (activeStreams[key] ? Object.keys(activeStreams[key]).length : 0);
        }, 0)
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

app.post('/kill-all', (req, res) => {
    Object.keys(activeStreams).forEach(sessionId => {
        if (activeStreams[sessionId]) {
            Object.keys(activeStreams[sessionId]).forEach(streamId => {
                activeStreams[sessionId][streamId].process.kill('SIGKILL');
            });
        }
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

const clearUploadsSafe = () => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(uploadDir, file);
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                const now = new Date().getTime();
                const endTime = new Date(stats.mtime).getTime() + (24 * 60 * 60 * 1000); 
                
                if (now > endTime) {
                    try { fs.unlinkSync(filePath); } catch(e) {}
                }
            }
        });
    });
};
setInterval(clearUploadsSafe, 3600000);

app.listen(PORT, '0.0.0.0', () => console.log(`SERVER RUNNING ON PORT ${PORT}`));

