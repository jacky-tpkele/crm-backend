require('dotenv').config();
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'xhon-crm-secret-2025';
const PORT = process.env.PORT || 3001;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.auth;
  if (!token) return res.status(401).json({ error: '未授权' });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token 无效或已过期，请从 CRM 重新进入' });
  }
}

// 验证 token（供前端首次验证使用）
app.get('/api/auth', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: '缺少 token' });
  try {
    jwt.verify(token, JWT_SECRET);
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: 'Token 无效' });
  }
});

// 获取存储统计
app.get('/api/stats', auth, (req, res) => {
  const files = fs.readdirSync(UPLOAD_DIR);
  const total = files.reduce((sum, name) => {
    try { return sum + fs.statSync(path.join(UPLOAD_DIR, name)).size; } catch { return sum; }
  }, 0);
  res.json({ fileCount: files.length, totalBytes: total });
});

// 列出所有文件
app.get('/api/files', auth, (req, res) => {
  const files = fs.readdirSync(UPLOAD_DIR)
    .map(name => {
      try {
        const stat = fs.statSync(path.join(UPLOAD_DIR, name));
        return { name, size: stat.size, modified: stat.mtime.toISOString() };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));
  res.json(files);
});

// 上传文件（支持多文件，单文件最大 200MB）
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    // 解码原始文件名，保留中文，防止文件名冲突
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safe = original.replace(/[<>:"/\\|?*]/g, '_');
    const ts = Date.now();
    const ext = path.extname(safe);
    const base = path.basename(safe, ext);
    cb(null, `${base}_${ts}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

app.post('/api/upload', auth, upload.array('files', 30), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: '没有收到文件' });
  res.json({ uploaded: req.files.map(f => ({ name: f.filename, size: f.size })) });
});

// 下载/预览文件（auth 支持 query param 方便浏览器直接打开）
app.get('/api/files/:name', auth, (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });

  const ext = path.extname(req.params.name).toLowerCase();
  const previewExts = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mp3', '.txt'];
  if (previewExts.includes(ext)) {
    res.setHeader('Content-Disposition', `inline; filename="${req.params.name}"`);
    res.sendFile(filePath);
  } else {
    res.download(filePath);
  }
});

// 删除文件
app.delete('/api/files/:name', auth, (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  fs.unlinkSync(filePath);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`云盘服务运行在端口 ${PORT}`));
