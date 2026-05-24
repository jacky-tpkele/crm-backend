// 一次性图标生成器 —— 生成 PWA 需要的 PNG 图标
// 用法：node gen-icons.js
// 只用 Node 内置 zlib + crypto，不需要 npm install
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, 'icons');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// 颜色（与 CRM dashboard 主题一致）
const BG = [12, 28, 69, 255];      // #0c1c45 深蓝
const FG = [232, 239, 255, 255];   // #e8efff 近白

// 5x7 像素 "T" 字模
const T_GLYPH = [
  [1,1,1,1,1],
  [1,1,1,1,1],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
];

function drawIcon(size, { maskable = false } = {}) {
  // 像素 RGBA
  const px = Buffer.alloc(size * size * 4);
  // 背景
  for (let i = 0; i < size * size; i++) {
    px[i * 4]     = BG[0];
    px[i * 4 + 1] = BG[1];
    px[i * 4 + 2] = BG[2];
    px[i * 4 + 3] = BG[3];
  }
  // maskable 图标四周保留 10% 安全边距，普通图标用 圆角矩形（直接占满）
  const safe = maskable ? Math.round(size * 0.1) : Math.round(size * 0.06);
  // 字形占用的宽度大约 60% 区域
  const glyphW = T_GLYPH[0].length;
  const glyphH = T_GLYPH.length;
  const cell = Math.floor((size - safe * 2) / Math.max(glyphW, glyphH));
  const drawW = cell * glyphW;
  const drawH = cell * glyphH;
  const ox = Math.floor((size - drawW) / 2);
  const oy = Math.floor((size - drawH) / 2);
  for (let gy = 0; gy < glyphH; gy++) {
    for (let gx = 0; gx < glyphW; gx++) {
      if (!T_GLYPH[gy][gx]) continue;
      for (let py = 0; py < cell; py++) {
        for (let px2 = 0; px2 < cell; px2++) {
          const x = ox + gx * cell + px2;
          const y = oy + gy * cell + py;
          if (x < 0 || x >= size || y < 0 || y >= size) continue;
          const i = (y * size + x) * 4;
          px[i]     = FG[0];
          px[i + 1] = FG[1];
          px[i + 2] = FG[2];
          px[i + 3] = FG[3];
        }
      }
    }
  }
  return px;
}

// CRC32 表
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);   // bit depth
  ihdr.writeUInt8(6, 9);   // color type RGBA
  ihdr.writeUInt8(0, 10);  // compression
  ihdr.writeUInt8(0, 11);  // filter
  ihdr.writeUInt8(0, 12);  // interlace
  // IDAT —— 每行前面加一个 filter byte (0)
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idatData = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
  { size: 512, name: 'icon-maskable.png', maskable: true },
  { size: 180, name: 'apple-touch-icon.png' },
];

for (const t of targets) {
  const rgba = drawIcon(t.size, { maskable: !!t.maskable });
  const png = encodePNG(t.size, rgba);
  const out = path.join(OUT_DIR, t.name);
  fs.writeFileSync(out, png);
  console.log('wrote', out, png.length, 'bytes');
}
