const express    = require('express');
const fetch      = require('node-fetch');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');
const webpush = require('web-push');

const app = express();
app.use(express.json({ limit: '20mb' }));

const SB_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// ──────────────────────────────────────────
// 安全启动校验：环境变量必须存在，否则拒绝运行
// 没有这层防线，攻击者会用历史默认密钥/密码直接登录
// ──────────────────────────────────────────
function assertEnv(name, opts = {}) {
  const v = process.env[name];
  if (!v) {
    const msg = `[SECURITY] 启动失败：环境变量 ${name} 未设置。请到 Vercel → Settings → Environment Variables 补上。`;
    console.error(msg);
    throw new Error(msg);
  }
  if (opts.minLength && v.length < opts.minLength) {
    console.warn(`[SECURITY-WARN] 环境变量 ${name} 长度 ${v.length} < 推荐 ${opts.minLength}，安全性较弱。建议尽快更新为更长的随机字符串。`);
  }
  return v;
}
const SECRET   = assertEnv('JWT_SECRET', { minLength: 32 });
const CRM_USER = assertEnv('CRM_USERNAME');
const CRM_PASS = assertEnv('CRM_PASSWORD', { minLength: 6 });
// VAULT_ENCRYPTION_KEY 保持回退到 SECRET（如果之前没单独设过，密码保险柜里的现有数据是用 SECRET 加密的，
// 强制独立 key 会让历史数据解不开。建议你后期单独设它，但先不强制。）
const VAULT_KEY = crypto
  .createHash('sha256')
  .update(process.env.VAULT_ENCRYPTION_KEY || SECRET)
  .digest();

function encryptText(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptText(payload) {
  const [ivB64, tagB64, dataB64] = String(payload || '').split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function hashSecondPassword(value) {
  const salt = crypto.randomBytes(16).toString('base64');
  const hash = crypto.scryptSync(String(value), salt, 64).toString('base64');
  return `${salt}:${hash}`;
}

function verifySecondPassword(value, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(String(value), salt, 64).toString('base64');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(computed));
}

// 鈹€鈹€ Supabase REST helper 鈹€鈹€
async function sb(path, opts = {}) {
  const url = `${SB_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(data?.message || data?.error || JSON.stringify(data));
  return data;
}

// 鈹€鈹€ JWT auth middleware 鈹€鈹€
function auth(req, res, next) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// ────────────────────────────────────────────────────────────────────
// 回收站：列出软删除记录 + 一键恢复
// ────────────────────────────────────────────────────────────────────
const RECYCLE_TABLES = {
  customers: { label: '客户',   nameField: 'customer_name', extraSelect: 'country,email,whatsapp' },
  products:  { label: '产品',   nameField: 'product_name_cn', extraSelect: 'product_code,product_name_en,specification' },
  suppliers: { label: '供应商', nameField: 'supplier_name', extraSelect: 'supplier_code,contact_name,phone' },
  orders:    { label: '订单',   nameField: 'customer_name', extraSelect: 'order_number,order_date,sales_total,currency' },
  logistics: { label: '物流',   nameField: 'tracking_number', extraSelect: 'carrier,order_name,shipping_date' },
};
app.get('/api/recycle-bin', auth, async (req, res) => {
  try {
    const out = {};
    for (const [t, meta] of Object.entries(RECYCLE_TABLES)) {
      const fields = ['id', meta.nameField, meta.extraSelect, 'updated_at', 'created_at'].filter(Boolean).join(',');
      const data = await sb(`${t}?is_deleted=eq.true&select=${fields}&order=updated_at.desc&limit=200`).catch(() => []);
      out[t] = { label: meta.label, name_field: meta.nameField, items: data };
    }
    res.json(out);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/recycle-bin/restore', auth, async (req, res) => {
  try {
    const { type, id } = req.body || {};
    if (!RECYCLE_TABLES[type] || !id) return res.status(400).json({ message: '参数错误' });
    await sb(`${type}?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: false, updated_at: new Date().toISOString() }) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/recycle-bin/purge', auth, async (req, res) => {
  try {
    const { type, id } = req.body || {};
    if (!RECYCLE_TABLES[type] || !id) return res.status(400).json({ message: '参数错误' });
    // 真正物理删除（彻底清除）。注意：可能因外键约束失败（如订单仍有 line items 引用产品）
    await sb(`${type}?id=eq.${id}`, { method: 'DELETE' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// AUTH
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// AUTH + USER MANAGEMENT
// ────────────────────────────────────────────────────────────────────
// 多用户结构预留：当前只有管理员（环境变量配置），但 schema 和后端
// 都已支持 users 表 + role + created_by。未来加角色 sales/purchase 时
// 只需 INSERT users 行 + 在路由里加 requireRole 即可。
// ────────────────────────────────────────────────────────────────────

let _adminUserCache = null;
async function ensureAdminUser() {
  if (_adminUserCache) return _adminUserCache;
  const username = encodeURIComponent(CRM_USER);
  const existing = await sb(`users?username=eq.${username}&select=*`).catch(() => []);
  if (existing.length) {
    // 强制 role=admin，保持环境变量账号永远是管理员
    if (existing[0].role !== 'admin' || !existing[0].is_active) {
      await sb(`users?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin', is_active: true, updated_at: new Date().toISOString() }),
      }).catch(()=>{});
    }
    _adminUserCache = { ...existing[0], role: 'admin', is_active: true };
    return _adminUserCache;
  }
  const created = await sb('users?select=*', {
    method: 'POST', headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify({
      username: CRM_USER,
      display_name: 'Administrator',
      role: 'admin',
      is_active: true,
    }),
  }).catch(() => null);
  if (created && created[0]) { _adminUserCache = created[0]; return _adminUserCache; }
  // bootstrap 失败兜底（数据库不可达等）：返回内存伪 user，让登录还能用
  return { id: null, username: CRM_USER, role: 'admin', display_name: 'Administrator' };
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ message: 'Username and password required' });
  if (username !== CRM_USER || password !== CRM_PASS)
    return res.status(401).json({ message: 'Invalid credentials' });
  const u = await ensureAdminUser();
  // 异步更新 last_login（不阻塞返回）
  if (u.id) sb(`users?id=eq.${u.id}`, { method:'PATCH', body: JSON.stringify({ last_login_at: new Date().toISOString() }) }).catch(()=>{});
  const token = jwt.sign(
    { user_id: u.id, username: u.username, role: u.role || 'admin' },
    SECRET, { expiresIn: '7d' }
  );
  res.json({
    token, username: u.username,
    user: { id: u.id, username: u.username, role: u.role || 'admin', display_name: u.display_name || u.username },
  });
});

// 角色权限中间件：requireRole('admin') 或 requireRole('admin','sales')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: '权限不足 / Insufficient permissions' });
    }
    next();
  };
}

// 当前登录用户信息
app.get('/api/users/me', auth, async (req, res) => {
  try {
    if (!req.user.user_id) {
      return res.json({ id: null, username: req.user.username, role: req.user.role, display_name: req.user.username });
    }
    const rows = await sb(`users?id=eq.${req.user.user_id}&select=id,username,display_name,role,email,phone,is_active,last_login_at,created_at`);
    if (!rows.length) return res.json({ id: null, username: req.user.username, role: req.user.role, display_name: req.user.username });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// DASHBOARD STATS
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
app.get('/api/dashboard/stats', auth, async (req, res) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const year  = new Date().getFullYear().toString();
    const orders = await sb('orders?select=order_date,sales_total,profit,profit_rmb,currency,exchange_rate,settlement_rate,actual_profit,actual_profit_rmb&is_deleted=eq.false');
    const mO = orders.filter(o => (o.order_date||'').startsWith(month));
    const yO = orders.filter(o => (o.order_date||'').startsWith(year));
    // 优先用结算后的实际值；销售额 RMB = sales × (结算汇率 ?? 录入汇率)
    const effRate = o => Number(o.settlement_rate || o.exchange_rate || 7.2);
    const salesRmb  = o => Number(o.sales_total||0) * (o.currency==='RMB' ? 1 : effRate(o));
    const profitRmb = o => {
      if (o.actual_profit_rmb != null) return Number(o.actual_profit_rmb);
      return Number(o.profit_rmb || (o.currency==='RMB' ? Number(o.profit||0) : Number(o.profit||0) * (Number(o.exchange_rate)||7.2)));
    };
    const sumF = (arr, f) => arr.reduce((a, o) => a + f(o), 0);
    res.json({
      month_orders:  mO.length,
      year_orders:   yO.length,
      month_sales:   sumF(mO, salesRmb),
      year_sales:    sumF(yO, salesRmb),
      month_profit:  sumF(mO, profitRmb),
      year_profit:   sumF(yO, profitRmb),
      currency:      'RMB',
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/dashboard/trends', auth, async (req, res) => {
  try {
    const orders = await sb('orders?select=order_date,sales_total,profit,profit_rmb,currency,exchange_rate,settlement_rate,actual_profit,actual_profit_rmb&is_deleted=eq.false');
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return d.toISOString().slice(0, 7);
    });
    const map = {};
    months.forEach(m => { map[m] = { sales: 0, profit: 0, count: 0 }; });
    orders.forEach(o => {
      const m = (o.order_date||'').slice(0, 7);
      if (map[m]) {
        const rate = Number(o.settlement_rate || o.exchange_rate)||7.2;
        const sRmb = Number(o.sales_total||0) * (o.currency==='RMB'?1:rate);
        const pRmb = o.actual_profit_rmb != null
          ? Number(o.actual_profit_rmb)
          : Number(o.profit_rmb || (o.currency==='RMB' ? Number(o.profit||0) : Number(o.profit||0)*rate));
        map[m].sales  += sRmb;
        map[m].profit += pRmb;
        map[m].count++;
      }
    });
    res.json({
      labels: months,
      sales:  months.map(m => map[m].sales),
      profit: months.map(m => map[m].profit),
      orders: months.map(m => map[m].count),
      currency: 'RMB',
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// CUSTOMERS
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
app.get('/api/customers', auth, async (req, res) => {
  try {
    const { limit = 1000, offset = 0, q = '' } = req.query;
    let url = 'customers?select=*&is_deleted=eq.false&order=created_at.desc';
    if (q) {
      const esc = encodeURIComponent(`%${q}%`);
      url += `&or=(customer_name.ilike.${esc},country.ilike.${esc},email.ilike.${esc},whatsapp.ilike.${esc})`;
    }
    url += `&limit=${Number(limit)||1000}&offset=${Number(offset)||0}`;
    const data = await sb(url);
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/customers', auth, async (req, res) => {
  try {
    const payload = { ...req.body };
    if (req.user.user_id && !payload.created_by) payload.created_by = req.user.user_id;
    const data = await sb('customers?select=*', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    });
    res.json({ success: true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/customers/:id', auth, async (req, res) => {
  try {
    await sb(`customers?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify(req.body) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/customers/:id', auth, async (req, res) => {
  try {
    await sb(`customers?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true }) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// PRODUCTS
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
app.get('/api/products', auth, async (req, res) => {
  try {
    const { limit = 1000, offset = 0, q = '' } = req.query;
    let url = 'products?select=*&is_deleted=eq.false&order=created_at.desc';
    if (q) {
      const esc = encodeURIComponent(`%${q}%`);
      url += `&or=(product_code.ilike.${esc},product_name_cn.ilike.${esc},product_name_en.ilike.${esc},specification.ilike.${esc})`;
    }
    url += `&limit=${Number(limit)||1000}&offset=${Number(offset)||0}`;
    const data = await sb(url);
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/products', auth, async (req, res) => {
  try {
    const payload = { ...req.body };
    if (req.user.user_id && !payload.created_by) payload.created_by = req.user.user_id;
    const data = await sb('products?select=*', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    });
    res.json({ success: true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/products/:id', auth, async (req, res) => {
  try {
    await sb(`products?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify(req.body) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/products/:id', auth, async (req, res) => {
  try {
    await sb(`products?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true }) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// SUPPLIERS
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
app.get('/api/suppliers', auth, async (req, res) => {
  try {
    const { limit = 1000, offset = 0, q = '' } = req.query;
    let url = 'suppliers?select=*&is_deleted=eq.false&order=created_at.desc';
    if (q) {
      const esc = encodeURIComponent(`%${q}%`);
      url += `&or=(supplier_name.ilike.${esc},contact_name.ilike.${esc},phone.ilike.${esc},email.ilike.${esc})`;
    }
    url += `&limit=${Number(limit)||1000}&offset=${Number(offset)||0}`;
    const data = await sb(url);
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/suppliers', auth, async (req, res) => {
  try {
    const payload = { ...req.body };
    if (req.user.user_id && !payload.created_by) payload.created_by = req.user.user_id;
    const data = await sb('suppliers?select=*', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    });
    res.json({ success: true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/suppliers/:id', auth, async (req, res) => {
  try {
    await sb(`suppliers?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify(req.body) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/suppliers/:id', auth, async (req, res) => {
  try {
    await sb(`suppliers?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true }) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// （已清理：旧的无前缀 /suppliers GET/POST/DELETE，前端不再使用）

// ────────────────────────────────────────────────────────────────────
// INQUIRIES
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
app.get('/api/inquiries', auth, async (req, res) => {
  try {
    const data = await sb('inquiries?select=*&order=created_at.desc');
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/inquiries', auth, async (req, res) => {
  try {
    const payload = { ...req.body };
    if (req.user.user_id && !payload.created_by) payload.created_by = req.user.user_id;
    const data = await sb('inquiries?select=*', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    });
    res.json({ success: true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/inquiries/:id', auth, async (req, res) => {
  try {
    await sb(`inquiries?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify(req.body) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/inquiries/:id', auth, async (req, res) => {
  try {
    await sb(`inquiries?id=eq.${req.params.id}`, { method: 'DELETE' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// ORDERS
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
async function fetchOrdersWithItems(filters = {}) {
  const { limit = 500, offset = 0, q = '' } = filters;
  let url = 'orders?select=*&is_deleted=eq.false&order=order_date.desc';
  if (q) {
    // PostgREST or() — 模糊搜索客户名 / 订单号 / 备注
    const esc = encodeURIComponent(`%${q}%`);
    url += `&or=(customer_name.ilike.${esc},order_number.ilike.${esc},remarks.ilike.${esc})`;
  }
  url += `&limit=${Number(limit)||500}&offset=${Number(offset)||0}`;
  const orders = await sb(url);
  if (!orders.length) return orders;
  const ids = orders.map(o => o.id).join(',');
  const items = await sb(`order_items?order_id=in.(${ids})&select=*`);
  return orders.map(o => ({ ...o, items: items.filter(i => i.order_id === o.id) }));
}

app.get('/api/orders', auth, async (req, res) => {
  try { res.json(await fetchOrdersWithItems(req.query)); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/orders/:id', auth, async (req, res) => {
  try {
    const [orderArr, items] = await Promise.all([
      sb(`orders?id=eq.${req.params.id}&select=*`),
      sb(`order_items?order_id=eq.${req.params.id}&select=*`),
    ]);
    if (!orderArr.length) return res.status(404).json({ message: 'Not found' });
    res.json({ order: orderArr[0], items });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 订单的「已发货汇总」：合并该订单所有物流单的 shipment_items，按 product_id 聚合
app.get('/api/orders/:id/shipped-summary', auth, async (req, res) => {
  try {
    const logs = await sb(`logistics?order_id=eq.${req.params.id}&is_deleted=eq.false&select=id,tracking_number,carrier,shipment_items,shipping_date`);
    const summary = {}; // { product_id: { shipped_qty, shipments:[{logistics_id, tracking_number, qty}] } }
    for (const l of logs) {
      const items = Array.isArray(l.shipment_items) ? l.shipment_items : [];
      for (const it of items) {
        if (!it.product_id) continue;
        const q = Number(it.quantity || 0);
        if (!summary[it.product_id]) summary[it.product_id] = { shipped_qty: 0, shipments: [] };
        summary[it.product_id].shipped_qty += q;
        summary[it.product_id].shipments.push({
          logistics_id: l.id,
          tracking_number: l.tracking_number,
          carrier: l.carrier,
          shipping_date: l.shipping_date,
          quantity: q,
        });
      }
    }
    res.json(summary);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ────────────────────────────────────────────────────────────────────
// 订单汇率结算：按结算日汇率重算实际利润（写入 actual_profit_* 字段）
// 业务：USD 订单的 sales_total 不变，purchase_total（RMB）不变，只重算 RMB 利润
// 重复结算合法，新值覆盖旧值
// ────────────────────────────────────────────────────────────────────
function calcSettlement(order, rate) {
  const sales = Number(order.sales_total || 0);                  // 销售币种
  const purchase = Number(order.purchase_total || 0);            // RMB
  const r = Number(rate);
  if (!(r > 0)) throw new Error('结算汇率必须 > 0');
  const isRmb = (order.currency === 'RMB' || order.currency === 'CNY');
  if (isRmb) {
    // RMB 订单不受汇率影响，但允许写入以保留结算日记录
    const profit = +(sales - purchase).toFixed(2);
    return {
      actual_profit: profit,
      actual_profit_rmb: profit,
      actual_profit_rate: sales > 0 ? +(profit / sales * 100).toFixed(2) : 0,
    };
  }
  // 销售币种利润 = sales − purchase/rate
  const profitSales = +(sales - purchase / r).toFixed(2);
  // RMB 利润 = sales × rate − purchase
  const profitRmb = +(sales * r - purchase).toFixed(2);
  const profitRate = sales > 0 ? +(profitSales / sales * 100).toFixed(2) : 0;
  return {
    actual_profit: profitSales,
    actual_profit_rmb: profitRmb,
    actual_profit_rate: profitRate,
  };
}

app.post('/api/orders/:id/settle', auth, async (req, res) => {
  try {
    const { rate, date } = req.body || {};
    if (!rate || Number(rate) <= 0) return res.status(400).json({ message: '结算汇率必须 > 0' });
    const arr = await sb(`orders?id=eq.${req.params.id}&select=*`);
    if (!arr.length) return res.status(404).json({ message: '订单不存在' });
    const order = arr[0];
    const calc = calcSettlement(order, rate);
    const patch = {
      settlement_rate: Number(rate),
      settlement_date: date || new Date().toISOString().slice(0, 10),
      ...calc,
      updated_at: new Date().toISOString(),
    };
    await sb(`orders?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    res.json({ success: true, ...patch });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 批量结算：body { ids: [], rate, date }
app.post('/api/orders/settle-batch', auth, async (req, res) => {
  try {
    const { ids, rate, date } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: '请选择至少一个订单' });
    if (!rate || Number(rate) <= 0) return res.status(400).json({ message: '结算汇率必须 > 0' });
    const orders = await sb(`orders?id=in.(${ids.join(',')})&select=*`);
    const dt = date || new Date().toISOString().slice(0, 10);
    let ok = 0, skipped = 0;
    for (const o of orders) {
      try {
        const calc = calcSettlement(o, rate);
        await sb(`orders?id=eq.${o.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            settlement_rate: Number(rate),
            settlement_date: dt,
            ...calc,
            updated_at: new Date().toISOString(),
          }),
        });
        ok++;
      } catch (_) { skipped++; }
    }
    res.json({ success: true, settled: ok, skipped });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/orders/:id', auth, async (req, res) => {
  try {
    // 软删除订单
    await sb(`orders?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true }) });
    // 同步硬删除该订单关联的采购单（采购单本身没有软删除字段；purchase_order_items 有 ON DELETE CASCADE 会自动清）
    await sb(`purchase_orders?order_id=eq.${req.params.id}`, { method: 'DELETE' }).catch(() => {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// （已清理：legacy POST/PUT /api/orders、POST /api/save-order、/orders-full、
//  /order-detail/:id、PUT /orders/:id、DELETE /delete-order/:id — 全部由 /api/orders/v2 + REST /api/orders/:id 取代）

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// ANALYTICS
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
app.get('/api/analytics/top-customers', auth, async (req, res) => {
  try {
    const orders = await sb('orders?select=customer_name,sales_total&is_deleted=eq.false');
    const map = {};
    orders.forEach(o => {
      const k = o.customer_name || 'Unknown';
      map[k] = (map[k]||0) + Number(o.sales_total||0);
    });
    const sorted = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,10);
    res.json(sorted.map(([name, sales]) => ({ name, sales })));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/analytics/top-products', auth, async (req, res) => {
  try {
    const items = await sb('order_items?select=product_name_cn,quantity,sales_total');
    const map = {};
    items.forEach(i => {
      const k = i.product_name_cn || 'Unknown';
      if (!map[k]) map[k] = { quantity: 0, sales: 0 };
      map[k].quantity += Number(i.quantity||0);
      map[k].sales    += Number(i.sales_total||0);
    });
    const sorted = Object.entries(map).sort((a,b)=>b[1].sales-a[1].sales).slice(0,10);
    res.json(sorted.map(([name, d]) => ({ name, ...d })));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// DOCUMENTS
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

// 列表（支持按 order_id / document_type 过滤）
app.get('/api/documents', auth, async (req, res) => {
  try {
    const { order_id, document_type, limit = 100 } = req.query;
    const parts = ['is_deleted=eq.false'];
    if (order_id) parts.push(`order_id=eq.${order_id}`);
    if (document_type) parts.push(`document_type=eq.${document_type}`);
    const url = `documents?${parts.join('&')}&order=created_at.desc&limit=${Number(limit)||100}&select=id,order_id,document_type,language,document_number,notes,created_at,updated_at`;
    res.json(await sb(url));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 单条（含 HTML 快照，重新预览/再次打印用）
app.get('/api/documents/:id', auth, async (req, res) => {
  try {
    const rows = await sb(`documents?id=eq.${req.params.id}&is_deleted=eq.false&select=*`);
    if (!rows.length) return res.status(404).json({ message: 'Document not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 新增存档：documents.html 生成 PDF 后调用
app.post('/api/documents', auth, async (req, res) => {
  try {
    const { order_id, document_type, language, document_number, html_content, notes } = req.body || {};
    if (!document_type) return res.status(400).json({ message: 'document_type required' });
    if (!html_content) return res.status(400).json({ message: 'html_content required' });
    const payload = {
      order_id: order_id || null,
      document_type,
      language: language || 'en',
      document_number: document_number || null,
      html_content,
      notes: notes || null,
    };
    if (req.user.user_id) payload.created_by = req.user.user_id;
    const data = await sb('documents?select=id,document_number,created_at', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    });
    res.json({ success: true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 修改备注/编号（HTML 内容不允许改，要改就重新生成）
app.patch('/api/documents/:id', auth, async (req, res) => {
  try {
    const allowed = ['notes', 'document_number'];
    const patch = { updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    await sb(`documents?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 删除（软删）
app.delete('/api/documents/:id', auth, async (req, res) => {
  try {
    await sb(`documents?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true, updated_at: new Date().toISOString() }) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// EMAIL
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
const EMAIL_IMAP_HOST = process.env.EMAIL_IMAP_HOST;
const EMAIL_IMAP_PORT = parseInt(process.env.EMAIL_IMAP_PORT || '993');
const EMAIL_SMTP_HOST = process.env.EMAIL_SMTP_HOST;
const EMAIL_SMTP_PORT = parseInt(process.env.EMAIL_SMTP_PORT || '465');
const EMAIL_USER      = process.env.EMAIL_USER;
const EMAIL_PASS      = process.env.EMAIL_PASS;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'TPKELE';

// cfg 鏉ヨ嚜鏁版嵁搴撹处鍙凤紝鏈彁渚涘垯鍥為€€鍒扮幆澧冨彉閲?
function imapClient(cfg = {}) {
  const host = cfg.imap_host || EMAIL_IMAP_HOST;
  const port = cfg.imap_port || EMAIL_IMAP_PORT;
  return new ImapFlow({
    host, port,
    secure: port === 993,
    auth: { user: cfg.username || EMAIL_USER, pass: cfg.password || EMAIL_PASS },
    logger: false,
    tls: { rejectUnauthorized: false },
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

function smtpTransport(cfg = {}) {
  const port = cfg.smtp_port || EMAIL_SMTP_PORT;
  return nodemailer.createTransport({
    host: cfg.smtp_host || EMAIL_SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: cfg.username || EMAIL_USER, pass: cfg.password || EMAIL_PASS },
    tls: { rejectUnauthorized: false },
  });
}

async function getAccountCfg(accountId) {
  if (!accountId) return {};
  try {
    const rows = await sb(`email_accounts?id=eq.${accountId}&is_active=eq.true&select=*`);
    return rows[0] || {};
  } catch { return {}; }
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// EMAIL ACCOUNTS CRUD
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
app.get('/api/email-accounts', auth, async (req, res) => {
  try {
    const data = await sb('email_accounts?select=id,display_name,email,imap_host,imap_port,smtp_host,smtp_port,username,from_name,is_active,created_at&order=created_at.asc');
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/email-accounts', auth, async (req, res) => {
  try {
    const data = await sb('email_accounts?select=id,display_name,email', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(req.body),
    });
    res.json({ success: true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/email-accounts/:id', auth, async (req, res) => {
  try {
    await sb(`email_accounts?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify(req.body) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/email-accounts/:id', auth, async (req, res) => {
  try {
    await sb(`email_accounts?id=eq.${req.params.id}`, { method: 'DELETE' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鍚屾鏀朵欢绠卞埌 Supabase
app.post('/api/emails/sync', auth, async (req, res) => {
  const { account_id } = req.body || {};
  const cfg = await getAccountCfg(account_id);
  const imapHost = cfg.imap_host || EMAIL_IMAP_HOST;
  const imapUser = cfg.username  || EMAIL_USER;
  const imapPass = cfg.password  || EMAIL_PASS;
  if (!imapHost || !imapUser || !imapPass)
    return res.status(503).json({ message: 'Email environment variables are not configured' });

  const client = imapClient(cfg);
  let synced = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      let lastUid = 0;
      try {
        const acctFilter = account_id ? `&account_id=eq.${account_id}` : '&account_id=is.null';
        const rows = await sb(`emails?select=uid&folder=eq.INBOX${acctFilter}&order=uid.desc&limit=1`);
        if (rows.length) lastUid = rows[0].uid || 0;
      } catch {}

      const range = lastUid ? `${lastUid + 1}:*` : '1:*';
      const messages = [];
      try {
        for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
          messages.push({ uid: msg.uid, source: msg.source });
          if (messages.length >= 20) break;
        }
      } catch (fetchErr) {
        if (!fetchErr.message?.includes('No messages')) throw fetchErr;
      }

      for (const { uid, source } of messages) {
        try {
          const parsed = await simpleParser(source);
          const from = parsed.from?.value?.[0] || {};
          const toList = (parsed.to?.value || []).map(a => a.address).join(', ');
          const ccList = (parsed.cc?.value || []).map(a => a.address).join(', ');
          const msgId = parsed.messageId || `uid-${uid}-${Date.now()}`;

          const emailData = {
            message_id:   msgId,
            folder:       'INBOX',
            uid:          uid,
            from_address: from.address || '',
            from_name:    from.name || '',
            to_addresses: toList,
            cc:           ccList,
            subject:      parsed.subject || '(鏃犱富棰?',
            body_text:    parsed.text || '',
            body_html:    parsed.html || '',
            is_read:      false,
            is_deleted:   false,
            received_at:  (parsed.date || new Date()).toISOString(),
          };
          if (account_id) emailData.account_id = account_id;

          await sb('emails?on_conflict=message_id', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=ignore-duplicates' },
            body: JSON.stringify(emailData),
          });
          synced++;
        } catch (parseErr) {
          console.error('瑙ｆ瀽閭欢澶辫触 uid=' + uid, parseErr.message);
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    res.json({ success: true, synced });
  } catch (e) {
    try { await client.logout(); } catch {}
    res.status(500).json({ message: e.message, detail: e.responseText || e.code || String(e) });
  }
});


// 鑾峰彇閭欢鍒楄〃
app.get('/api/emails', auth, async (req, res) => {
  try {
    const folder     = req.query.folder || 'INBOX';
    const account_id = req.query.account_id;
    const page       = Math.max(1, parseInt(req.query.page || '1'));
    const limit      = 50;
    const offset     = (page - 1) * limit;
    const folderFilter = folder === 'SENT'
      ? 'folder=eq.SENT'
      : `folder=eq.${encodeURIComponent(folder)}`;
    // INQUIRY 是网站询盘虚拟文件夹，不绑定邮箱账号，跨账号统一显示
    const acctFilter = folder === 'INQUIRY'
      ? ''
      : (account_id ? `&account_id=eq.${account_id}` : '&account_id=is.null');
    const data = await sb(
      `emails?${folderFilter}${acctFilter}&is_deleted=eq.false&order=received_at.desc&limit=${limit}&offset=${offset}&select=id,message_id,folder,account_id,from_address,from_name,to_addresses,subject,is_read,received_at`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鑾峰彇鍗曞皝閭欢璇︽儏
app.get('/api/emails/:id', auth, async (req, res) => {
  try {
    const rows = await sb(`emails?id=eq.${req.params.id}&select=*`);
    if (!rows.length) return res.status(404).json({ message: 'Email not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鏍囪宸茶/鏈
app.patch('/api/emails/:id/read', auth, async (req, res) => {
  try {
    const { is_read } = req.body;
    await sb(`emails?id=eq.${req.params.id}`, {
      method: 'PATCH', body: JSON.stringify({ is_read }),
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鍒犻櫎閭欢锛堣蒋鍒犻櫎锛?
app.delete('/api/emails/:id', auth, async (req, res) => {
  try {
    // 鏌ュ嚭閭欢鐨?uid / folder / account_id
    const row = await sb(`emails?id=eq.${req.params.id}&select=uid,folder,account_id`);
    const email = Array.isArray(row) && row[0];

    // 鍚屾鍒犻櫎 IMAP 鏈嶅姟鍣ㄤ笂鐨勯偖浠?
    if (email && email.uid) {
      try {
        const cfg    = await getAccountCfg(email.account_id || null);
        const client = imapClient(cfg);
        await client.connect();
        await client.mailboxOpen(email.folder || 'INBOX');
        await client.messageDelete({ uid: true, seq: `${email.uid}:${email.uid}` });
        await client.logout();
      } catch (imapErr) {
        console.error('IMAP delete failed (continuing):', imapErr.message);
        // IMAP 鍒犻櫎澶辫触涓嶉樆鏂湰鍦板垹闄?
      }
    }

    // 鏍囪鏈湴宸插垹闄?
    await sb(`emails?id=eq.${req.params.id}`, {
      method: 'PATCH', body: JSON.stringify({ is_deleted: true }),
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鍙戦€侀偖浠?
app.post('/api/emails/send', auth, async (req, res) => {
  const { to, cc, subject, body_html, body_text, attachments, account_id } = req.body;
  if (!to || !subject) return res.status(400).json({ message: '鏀朵欢浜哄拰涓婚涓嶈兘涓虹┖' });

  const cfg      = await getAccountCfg(account_id);
  const fromUser = cfg.username  || EMAIL_USER;
  const fromName = cfg.from_name || EMAIL_FROM_NAME;

  if (!fromUser) return res.status(503).json({ message: 'Email sender account is not configured' });

  try {
    const transport = smtpTransport(cfg);
    const info = await transport.sendMail({
      from: `"${fromName}" <${fromUser}>`,
      to, cc, subject,
      text: body_text || '',
      html: body_html || `<p>${(body_text || '').replace(/\n/g, '<br>')}</p>`,
      attachments: (attachments || []).map(a => ({
        filename: a.filename,
        content:  Buffer.from(a.content, 'base64'),
        contentType: a.contentType,
      })),
    });

    const sentData = {
      message_id:   info.messageId || `sent-${Date.now()}`,
      folder:       'SENT',
      from_address: fromUser,
      from_name:    fromName,
      to_addresses: to,
      cc:           cc || '',
      subject,
      body_text:    body_text || '',
      body_html:    body_html || '',
      is_read:      true,
      is_deleted:   false,
      received_at:  new Date().toISOString(),
    };
    if (account_id) sentData.account_id = account_id;

    await sb('emails', { method: 'POST', body: JSON.stringify(sentData) });
    res.json({ success: true, messageId: info.messageId });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鑾峰彇鏈鏁伴噺

// 鈹€鈹€ AI 鍔╂墜 鈹€鈹€
// 注：5 个 /api/ai/* endpoint（settings/status/chat/image）已于 2026-05-18 清理，
// ai.html 改为前端直连 SiliconFlow API。logistics/extract 仍读 ai_settings 表（暂保留）。

// 根据邮箱地址查找客户ID（支持 customers.email 多邮箱用逗号分隔）
async function findCustomerByEmail(addr) {
  const a = String(addr || '').trim().toLowerCase();
  if (!a) return null;
  // PostgREST ilike：customers.email 模糊包含该邮箱（前后允许有逗号分隔/空格）
  const esc = encodeURIComponent('%' + a + '%');
  const rows = await sb(`customers?email=ilike.${esc}&select=id,email&limit=10`).catch(() => []);
  if (!rows.length) return null;
  // 精确匹配优先
  for (const r of rows) {
    const list = String(r.email || '').toLowerCase().split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
    if (list.includes(a)) return r.id;
  }
  return rows[0].id;
}

// 客户的邮件历史（按客户邮箱匹配）
app.get('/api/customers/:id/emails', auth, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const cRows = await sb(`customers?id=eq.${req.params.id}&select=email`);
    const cEmail = (cRows[0]?.email || '').split(/[,;\s]+/)[0].trim().toLowerCase();
    if (!cEmail) return res.json([]);
    const esc = encodeURIComponent(cEmail);
    const data = await sb(`emails?from_address=eq.${esc}&is_deleted=eq.false&order=received_at.desc&limit=${limit}&select=id,folder,from_address,from_name,to_addresses,subject,is_read,received_at`);
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// LOGISTICS
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
app.get('/api/logistics', auth, async (req, res) => {
  try {
    const data = await sb('logistics?is_deleted=eq.false&order=created_at.desc&select=*');
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/logistics', auth, async (req, res) => {
  try {
    const { order_id, order_name, tracking_number, carrier, weight, volume, shipping_date, estimated_arrival, notes, shipment_items } = req.body;
    const payload = {
      order_id: order_id || null, order_name: order_name || '',
      tracking_number: tracking_number || '', carrier: carrier || '',
      weight: weight || null, volume: volume || null,
      shipping_date: shipping_date || null, estimated_arrival: estimated_arrival || null,
      notes: notes || '',
      shipment_items: Array.isArray(shipment_items) ? shipment_items : [],
    };
    if (req.user.user_id) payload.created_by = req.user.user_id;
    const data = await sb('logistics?select=id', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    });
    res.json({ success: true, id: data[0].id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/logistics/:id', auth, async (req, res) => {
  try {
    const { order_id, order_name, tracking_number, carrier, weight, volume, shipping_date, estimated_arrival, notes, shipment_items } = req.body;
    await sb(`logistics?id=eq.${req.params.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        order_id: order_id || null, order_name: order_name || '',
        tracking_number: tracking_number || '', carrier: carrier || '',
        weight: weight || null, volume: volume || null,
        shipping_date: shipping_date || null, estimated_arrival: estimated_arrival || null,
        notes: notes || '',
        shipment_items: Array.isArray(shipment_items) ? shipment_items : [],
      }),
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/logistics/:id', auth, async (req, res) => {
  try {
    await sb(`logistics?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true }) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/logistics/extract', auth, async (req, res) => {
  try {
    const { image_data } = req.body;
    if (!image_data) return res.status(400).json({ message: 'Please upload an image' });
    const settings = await sb('ai_settings?select=provider,api_key,model&order=created_at.desc&limit=1');
    if (!settings.length || !settings[0].api_key) return res.status(400).json({ message: 'no_ai' });
    const { provider, api_key, model } = settings[0];
    const base64   = image_data.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = image_data.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';
    const prompt = 'Extract tracking_number, carrier, weight, volume, shipping_date, estimated_arrival, notes from this logistics image and return JSON only.';
    let reply = '';
    if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'gpt-4o', max_tokens: 500,
          messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: image_data } }, { type: 'text', text: prompt }] }] }),
      });
      const d = await r.json();
    if (!image_data) return res.status(400).json({ message: 'Please upload an image' });
      reply = d.choices[0].message.content;
    } else if (provider === 'claude') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': api_key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'claude-3-5-sonnet-20241022', max_tokens: 500,
          messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }, { type: 'text', text: prompt }] }] }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(500).json({ message: d.error?.message || 'Claude璋冪敤澶辫触' });
      reply = d.content[0].text;
    } else if (provider === 'gemini') {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent?key=${api_key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: base64 } }, { text: prompt }] }] }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(500).json({ message: d.error?.message || 'Gemini璋冪敤澶辫触' });
      reply = d.candidates[0].content.parts[0].text;
    }
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ message: '鏃犳硶瑙ｆ瀽AI杩斿洖缁撴灉' });
    res.json({ success: true, data: JSON.parse(m[0]) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});



// PASSWORD VAULT
app.post('/api/password-vault/security/second-password', auth, async (req, res) => {
  try {
    const username = req.user.username || CRM_USER;
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ message: 'New second password must be at least 4 characters' });
    }

    const rows = await sb(`vault_security?username=eq.${encodeURIComponent(username)}&select=*`);
    if (rows.length) {
      if (!oldPassword || !verifySecondPassword(oldPassword, rows[0].second_pass_hash)) {
        return res.status(400).json({ message: 'Old second password is incorrect' });
      }
      await sb(`vault_security?username=eq.${encodeURIComponent(username)}`, {
        method: 'PATCH',
        body: JSON.stringify({ second_pass_hash: hashSecondPassword(newPassword), updated_at: new Date().toISOString() }),
      });
    } else {
      await sb('vault_security', {
        method: 'POST',
        body: JSON.stringify({ username, second_pass_hash: hashSecondPassword(newPassword) }),
      });
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/password-vault/items', auth, async (req, res) => {
  try {
    const username = req.user.username || CRM_USER;
    const { name, platform, account, password } = req.body || {};
    if (!name || !account || !password) {
      return res.status(400).json({ message: 'name, account and password are required' });
    }

    const payload = {
      username,
      name: String(name).trim(),
      platform: String(platform || '').trim(),
      account: String(account).trim(),
      password_encrypted: encryptText(password),
    };

    const data = await sb('password_items?select=id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });

    res.json({ success: true, id: data[0].id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/password-vault/items', auth, async (req, res) => {
  try {
    const username = encodeURIComponent(req.user.username || CRM_USER);
    const keyword = String(req.query.keyword || '').trim().toLowerCase();
    const rows = await sb(`password_items?username=eq.${username}&order=created_at.desc&select=id,name,platform,account,created_at`);

    const filtered = keyword
      ? rows.filter((r) => [r.name, r.platform, r.account].join(' ').toLowerCase().includes(keyword))
      : rows;

    res.json(filtered.map((r) => ({ ...r, password_masked: '************' })));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/password-vault/items/:id/reveal', auth, async (req, res) => {
  try {
    const username = req.user.username || CRM_USER;
    const { secondPassword } = req.body || {};
    if (!secondPassword) return res.status(400).json({ message: 'Second password is required' });

    const sec = await sb(`vault_security?username=eq.${encodeURIComponent(username)}&select=*`);
    if (!sec.length) return res.status(400).json({ message: 'Second password is not set yet' });
    if (!verifySecondPassword(secondPassword, sec[0].second_pass_hash)) {
      return res.status(401).json({ message: 'Second password is incorrect' });
    }

    const rows = await sb(`password_items?id=eq.${req.params.id}&username=eq.${encodeURIComponent(username)}&select=*`);
    if (!rows.length) return res.status(404).json({ message: 'Password record not found' });

    const plain = decryptText(rows[0].password_encrypted);
    res.json({ success: true, password: plain, visibleSeconds: 15 });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// CRM v2 — 供应商/产品/订单/采购单 增强 API
// ═══════════════════════════════════════════════════════════

// ── 工具函数 ──
async function genOrderNumber() {
  const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const prefix = `ORD-${today}-`;
  const rows = await sb(`orders?order_number=like.${prefix}%25&select=order_number&order=order_number.desc&limit=1`);
  let seq = 1;
  if (rows.length) {
    const last = rows[0].order_number || '';
    const m = last.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1],10) + 1;
  }
  return `${prefix}${String(seq).padStart(3,'0')}`;
}

async function genPONumber(today) {
  const prefix = `PO-${today}-`;
  const rows = await sb(`purchase_orders?po_number=like.${prefix}%25&select=po_number&order=po_number.desc&limit=1`);
  let seq = 1;
  if (rows.length) {
    const last = rows[0].po_number || '';
    const m = last.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1],10) + 1;
  }
  return `${prefix}${String(seq).padStart(3,'0')}`;
}

// ─────────────────────────────────────────────
// SUPPLIER 详情（含联系方式、供应产品、最近采购单）
// ─────────────────────────────────────────────
app.get('/api/suppliers/:id/full', auth, async (req, res) => {
  try {
    const id = req.params.id;
    const [supplierArr, contacts, links, pos] = await Promise.all([
      sb(`suppliers?id=eq.${id}&select=*`),
      sb(`supplier_contacts?supplier_id=eq.${id}&select=*&order=is_primary.desc,created_at.asc`),
      sb(`product_suppliers?supplier_id=eq.${id}&select=*,products(id,product_code,product_name_cn,product_name_en,specification,unit)`),
      sb(`purchase_orders?supplier_id=eq.${id}&select=*&order=po_date.desc&limit=20`),
    ]);
    if (!supplierArr.length) return res.status(404).json({ message: 'Supplier not found' });
    res.json({ supplier: supplierArr[0], contacts, products: links, purchase_orders: pos });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─────────────────────────────────────────────
// SUPPLIER CONTACTS
// ─────────────────────────────────────────────
app.get('/api/supplier-contacts', auth, async (req, res) => {
  try {
    const sid = req.query.supplier_id;
    if (!sid) return res.status(400).json({ message: 'supplier_id required' });
    const data = await sb(`supplier_contacts?supplier_id=eq.${sid}&select=*&order=is_primary.desc,created_at.asc`);
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/supplier-contacts', auth, async (req, res) => {
  try {
    const data = await sb('supplier_contacts?select=*', {
      method:'POST', headers:{ 'Prefer':'return=representation' },
      body: JSON.stringify(req.body),
    });
    res.json({ success:true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/supplier-contacts/:id', auth, async (req, res) => {
  try {
    await sb(`supplier_contacts?id=eq.${req.params.id}`, { method:'PATCH', body: JSON.stringify(req.body) });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/supplier-contacts/:id', auth, async (req, res) => {
  try {
    await sb(`supplier_contacts?id=eq.${req.params.id}`, { method:'DELETE' });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─────────────────────────────────────────────
// PRODUCT 详情（含关联供应商、价格历史）
// ─────────────────────────────────────────────
app.get('/api/products/:id/full', auth, async (req, res) => {
  try {
    const id = req.params.id;
    const [productArr, suppliers, history] = await Promise.all([
      sb(`products?id=eq.${id}&select=*`),
      sb(`product_suppliers?product_id=eq.${id}&select=*,suppliers(id,supplier_name,supplier_code,phone)&order=priority.asc`),
      sb(`price_history?product_id=eq.${id}&select=*&order=recorded_at.desc&limit=50`),
    ]);
    if (!productArr.length) return res.status(404).json({ message: 'Product not found' });
    res.json({ product: productArr[0], suppliers, price_history: history });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─────────────────────────────────────────────
// PRODUCT-SUPPLIER LINKS
// ─────────────────────────────────────────────
app.get('/api/product-suppliers', auth, async (req, res) => {
  try {
    const filters = [];
    if (req.query.product_id)  filters.push(`product_id=eq.${req.query.product_id}`);
    if (req.query.supplier_id) filters.push(`supplier_id=eq.${req.query.supplier_id}`);
    const q = filters.length ? '&' + filters.join('&') : '';
    const data = await sb(`product_suppliers?select=*,suppliers(id,supplier_name,supplier_code),products(id,product_code,product_name_cn)${q}&order=priority.asc`);
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/product-suppliers', auth, async (req, res) => {
  try {
    const data = await sb('product_suppliers?select=*', {
      method:'POST', headers:{ 'Prefer':'return=representation' },
      body: JSON.stringify(req.body),
    });
    res.json({ success:true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/product-suppliers/:id', auth, async (req, res) => {
  try {
    await sb(`product_suppliers?id=eq.${req.params.id}`, { method:'PATCH', body: JSON.stringify(req.body) });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/product-suppliers/:id', auth, async (req, res) => {
  try {
    await sb(`product_suppliers?id=eq.${req.params.id}`, { method:'DELETE' });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─────────────────────────────────────────────
// PRICE HISTORY
// ─────────────────────────────────────────────
app.get('/api/price-history', auth, async (req, res) => {
  try {
    const filters = [];
    if (req.query.product_id)  filters.push(`product_id=eq.${req.query.product_id}`);
    if (req.query.supplier_id) filters.push(`supplier_id=eq.${req.query.supplier_id}`);
    if (req.query.price_type)  filters.push(`price_type=eq.${req.query.price_type}`);
    const q = filters.length ? '&' + filters.join('&') : '';
    const data = await sb(`price_history?select=*${q}&order=recorded_at.desc&limit=200`);
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─────────────────────────────────────────────
// PURCHASE ORDERS
// ─────────────────────────────────────────────
app.get('/api/purchase-orders', auth, async (req, res) => {
  try {
    const filters = [];
    if (req.query.order_id)    filters.push(`order_id=eq.${req.query.order_id}`);
    if (req.query.supplier_id) filters.push(`supplier_id=eq.${req.query.supplier_id}`);
    if (req.query.status)      filters.push(`status=eq.${req.query.status}`);
    const q = filters.length ? '&' + filters.join('&') : '';
    const pos = await sb(`purchase_orders?select=*${q}&order=po_date.desc`);
    if (!pos.length) return res.json([]);
    const ids = pos.map(p => p.id).join(',');
    const items = await sb(`purchase_order_items?purchase_order_id=in.(${ids})&select=*`);
    res.json(pos.map(p => ({ ...p, items: items.filter(i => i.purchase_order_id === p.id) })));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/purchase-orders/:id', auth, async (req, res) => {
  try {
    const [poArr, items] = await Promise.all([
      sb(`purchase_orders?id=eq.${req.params.id}&select=*,suppliers(id,supplier_name,supplier_code,contact_name,phone,email,address,payment_terms)`),
      sb(`purchase_order_items?purchase_order_id=eq.${req.params.id}&select=*`),
    ]);
    if (!poArr.length) return res.status(404).json({ message: 'PO not found' });
    res.json({ purchase_order: poArr[0], items });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/purchase-orders/:id', auth, async (req, res) => {
  try {
    await sb(`purchase_orders?id=eq.${req.params.id}`, {
      method:'PATCH',
      body: JSON.stringify({ ...req.body, updated_at: new Date().toISOString() }),
    });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/purchase-orders/:id', auth, async (req, res) => {
  try {
    await sb(`purchase_orders?id=eq.${req.params.id}`, { method:'DELETE' });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 一次性清理孤儿采购单：order_id 关联到 已删除/不存在 的订单
app.post('/api/purchase-orders/cleanup-orphans', auth, async (req, res) => {
  try {
    const pos = await sb('purchase_orders?select=id,order_id');
    if (!pos.length) return res.json({ success:true, deleted:0 });
    const orderIds = [...new Set(pos.map(p => p.order_id).filter(Boolean))];
    let aliveIds = new Set();
    if (orderIds.length) {
      const alive = await sb(`orders?id=in.(${orderIds.join(',')})&is_deleted=eq.false&select=id`);
      aliveIds = new Set(alive.map(o => o.id));
    }
    const orphans = pos.filter(p => p.order_id && !aliveIds.has(p.order_id));
    let deleted = 0;
    for (const o of orphans) {
      await sb(`purchase_orders?id=eq.${o.id}`, { method:'DELETE' }).catch(() => {});
      deleted++;
    }
    res.json({ success:true, deleted });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─────────────────────────────────────────────
// 订单 v2 — 智能保存（写价格历史 + 自动拆分采购单）
// ─────────────────────────────────────────────
async function recalcOrderTotals(items, shippingFee, exchangeRate) {
  let pTotal = 0, sTotal = 0;
  for (const it of items) {
    const qty = Number(it.quantity || 0);
    const pp  = Number(it.purchase_price || 0);
    const sp  = Number(it.sales_price || 0);
    pTotal += qty * pp;
    sTotal += qty * sp;
    it.purchase_total = +(qty * pp).toFixed(2);
    it.sales_total    = +(qty * sp).toFixed(2);
  }
  const shipping = Number(shippingFee || 0);
  // 销售币种利润：销售额(含运费) - 采购额(RMB→销售币种 用 exchange_rate)
  const rate = Number(exchangeRate || 7.2) || 7.2;
  const salesTotal = +(sTotal + shipping).toFixed(2);
  const profitInSalesCurrency = +(salesTotal - pTotal / rate).toFixed(2);
  const profitInRmb = +(salesTotal * rate - pTotal).toFixed(2);
  const profitRate = salesTotal > 0 ? +(profitInSalesCurrency / salesTotal * 100).toFixed(2) : 0;
  return {
    purchase_total: +pTotal.toFixed(2),
    sales_total: salesTotal,
    sales_without_shipping: +sTotal.toFixed(2),
    profit: profitInSalesCurrency,
    profit_rmb: profitInRmb,
    profit_rate: profitRate,
  };
}

async function createPurchaseOrdersForOrder(orderId, items) {
  // 按 supplier_id 分组
  const groups = new Map();
  for (const it of items) {
    if (!it.supplier_id) continue;
    if (!groups.has(it.supplier_id)) groups.set(it.supplier_id, []);
    groups.get(it.supplier_id).push(it);
  }
  if (!groups.size) return [];

  const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const supplierIds = [...groups.keys()];
  const suppliers = await sb(`suppliers?id=in.(${supplierIds.join(',')})&select=id,supplier_name`);
  const supMap = new Map(suppliers.map(s => [s.id, s]));

  const created = [];
  for (const [supplierId, groupItems] of groups) {
    const total = groupItems.reduce((acc,it) => acc + Number(it.purchase_total||0), 0);
    const poNumber = await genPONumber(today);
    const poArr = await sb('purchase_orders?select=id', {
      method:'POST', headers:{ 'Prefer':'return=representation' },
      body: JSON.stringify({
        po_number: poNumber,
        order_id: orderId,
        supplier_id: supplierId,
        supplier_name: supMap.get(supplierId)?.supplier_name || '',
        po_date: new Date().toISOString().slice(0,10),
        status: 'pending',
        total_amount: +total.toFixed(2),
        currency: 'RMB',
      }),
    });
    const poId = poArr[0].id;
    await sb('purchase_order_items', {
      method:'POST',
      body: JSON.stringify(groupItems.map(it => ({
        purchase_order_id: poId,
        order_item_id: it.id || null,
        product_id: it.product_id || null,
        product_name_cn: it.product_name_cn || '',
        specification: it.specification || '',
        unit: it.unit || '',
        quantity: Number(it.quantity || 0),
        purchase_price: Number(it.purchase_price || 0),
        subtotal: +(Number(it.quantity||0) * Number(it.purchase_price||0)).toFixed(2),
      }))),
    });
    created.push({ id: poId, po_number: poNumber, supplier_id: supplierId, total });
  }
  return created;
}

async function writePriceHistoryAndUpdateProducts(orderId, customerId, currency, items, exchangeRate) {
  const today = new Date().toISOString().slice(0,10);
  const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 7.2;
  const isRmb = (currency === 'RMB' || currency === 'CNY');
  const histRows = [];
  for (const it of items) {
    if (!it.product_id) continue;
    if (Number(it.purchase_price)) {
      histRows.push({
        product_id: it.product_id,
        supplier_id: it.supplier_id || null,
        price_type: 'purchase',
        price: Number(it.purchase_price),
        currency: 'RMB',
        quantity: Number(it.quantity||0),
        order_id: orderId,
      });
    }
    if (Number(it.sales_price)) {
      histRows.push({
        product_id: it.product_id,
        supplier_id: null,
        price_type: 'sales',
        price: Number(it.sales_price),
        currency: currency || 'USD',
        quantity: Number(it.quantity||0),
        order_id: orderId,
        customer_id: customerId || null,
      });
    }
    // 更新产品最近价（统一以 RMB 计量，下游数据看板按 RMB 抓取）
    const update = { updated_at: new Date().toISOString() };
    if (Number(it.purchase_price)) {
      update.last_purchase_price = Number(it.purchase_price);
      update.last_purchase_date  = today;
    }
    if (Number(it.sales_price)) {
      const priceRmb = isRmb ? Number(it.sales_price) : Number(it.sales_price) * rate;
      update.last_sales_price = +priceRmb.toFixed(2);
      update.last_sales_date  = today;
    }
    await sb(`products?id=eq.${it.product_id}`, { method:'PATCH', body: JSON.stringify(update) }).catch(()=>{});
  }
  if (histRows.length) {
    await sb('price_history', { method:'POST', body: JSON.stringify(histRows) }).catch(()=>{});
  }
}

app.post('/api/orders/v2', auth, async (req, res) => {
  try {
    const {
      customer_name, customer_id, order_date, shipping_fee, currency, exchange_rate,
      order_number, remarks, items
    } = req.body;
    const itemList = Array.isArray(items) ? items : [];
    const totals = await recalcOrderTotals(itemList, shipping_fee, exchange_rate);
    const orderNumber = (order_number && String(order_number).trim()) || await genOrderNumber();

    const orderArr = await sb('orders?select=id', {
      method:'POST', headers:{ 'Prefer':'return=representation' },
      body: JSON.stringify({
        order_number: orderNumber,
        customer_name, customer_id: customer_id || null,
        order_date: order_date || new Date().toISOString().slice(0,10),
        shipping_fee: Number(shipping_fee||0),
        currency: currency || 'USD',
        exchange_rate: Number(exchange_rate || 7.2),
        remarks: remarks || '',
        ...(req.user.user_id ? { created_by: req.user.user_id } : {}),
        ...totals,
      }),
    });
    const orderId = orderArr[0].id;

    // 写明细（保留 id 用于后续 PO 关联）
    let itemRows = [];
    if (itemList.length) {
      itemRows = await sb('order_items?select=*', {
        method:'POST', headers:{ 'Prefer':'return=representation' },
        body: JSON.stringify(itemList.map((it, idx) => ({
          order_id: orderId,
          product_id: it.product_id || null,
          supplier_id: it.supplier_id || null,
          product_name_cn: it.product_name_cn || '',
          product_name_en: it.product_name_en || '',
          specification: it.specification || '',
          unit: it.unit || '',
          quantity: Number(it.quantity||0),
          purchase_price: Number(it.purchase_price||0),
          sales_price: Number(it.sales_price||0),
          purchase_total: it.purchase_total,
          sales_total: it.sales_total,
          item_remarks: it.item_remarks || '',
          sort_order: idx,
        }))),
      });
    }

    // 写价格历史 + 更新产品最近价（异步容错）
    await writePriceHistoryAndUpdateProducts(orderId, customer_id, currency, itemRows, exchange_rate);

    // 自动按供应商拆分采购单
    const purchaseOrders = await createPurchaseOrdersForOrder(orderId, itemRows);

    res.json({ success:true, id: orderId, order_number: orderNumber, purchase_orders: purchaseOrders });
  } catch (e) { res.status(500).json({ success:false, message: e.message }); }
});

app.put('/api/orders/v2/:id', auth, async (req, res) => {
  try {
    const orderId = req.params.id;
    const {
      customer_name, customer_id, order_date, shipping_fee, currency, exchange_rate,
      order_number, remarks, items
    } = req.body;
    const itemList = Array.isArray(items) ? items : [];
    const totals = await recalcOrderTotals(itemList, shipping_fee, exchange_rate);

    const patch = {
      customer_name, customer_id: customer_id || null,
      order_date, shipping_fee: Number(shipping_fee||0),
      currency: currency || 'USD',
      exchange_rate: Number(exchange_rate || 7.2),
      remarks: remarks || '',
      ...totals,
      updated_at: new Date().toISOString(),
    };
    if (order_number && String(order_number).trim()) patch.order_number = String(order_number).trim();
    await sb(`orders?id=eq.${orderId}`, { method:'PATCH', body: JSON.stringify(patch) });

    // 重写明细
    await sb(`order_items?order_id=eq.${orderId}`, { method:'DELETE' });
    let itemRows = [];
    if (itemList.length) {
      itemRows = await sb('order_items?select=*', {
        method:'POST', headers:{ 'Prefer':'return=representation' },
        body: JSON.stringify(itemList.map((it, idx) => ({
          order_id: orderId,
          product_id: it.product_id || null,
          supplier_id: it.supplier_id || null,
          product_name_cn: it.product_name_cn || '',
          product_name_en: it.product_name_en || '',
          specification: it.specification || '',
          unit: it.unit || '',
          quantity: Number(it.quantity||0),
          purchase_price: Number(it.purchase_price||0),
          sales_price: Number(it.sales_price||0),
          purchase_total: it.purchase_total,
          sales_total: it.sales_total,
          item_remarks: it.item_remarks || '',
          sort_order: idx,
        }))),
      });
    }

    // 重新生成采购单
    await sb(`purchase_orders?order_id=eq.${orderId}`, { method:'DELETE' });
    const purchaseOrders = await createPurchaseOrdersForOrder(orderId, itemRows);

    res.json({ success:true, purchase_orders: purchaseOrders });
  } catch (e) { res.status(500).json({ success:false, message: e.message }); }
});





// ────────────────────────────────────────────────────────────────────
// 物流查件（快递100 实时接口代理）
// ────────────────────────────────────────────────────────────────────
const KD100_KEY      = process.env.KUAIDI100_KEY;
const KD100_CUSTOMER = process.env.KUAIDI100_CUSTOMER;

// 简单内存缓存：同一单号 5 分钟内不重复查（省查询次数）
const _trackCache = new Map();
function _cacheGet(k) {
  const v = _trackCache.get(k);
  if (!v) return null;
  if (Date.now() - v.ts > 5*60*1000) { _trackCache.delete(k); return null; }
  return v.data;
}
function _cacheSet(k, data) { _trackCache.set(k, { ts: Date.now(), data }); }

// 通过单号自动识别承运商编码（快递100 autonumber 接口）
async function kd100AutoDetect(num) {
  try {
    const r = await fetch(`https://www.kuaidi100.com/autonumber/auto?num=${encodeURIComponent(num)}&key=${KD100_KEY}`);
    const j = await r.json();
    if (Array.isArray(j) && j.length) return j[0].comCode;
  } catch (_) {}
  return null;
}

// 本地前缀识别兜底（autonumber 不可用 / 限频时）
function detectCarrierLocal(num) {
  const n = String(num||'').trim().toUpperCase();
  if (!n) return null;
  if (/^SF/.test(n)) return 'shunfeng';
  if (/^JT/.test(n)) return 'jtexpress';
  if (/^YT\d{10,}$/.test(n)) return 'yuantong';
  if (/^YD\d{10,}$/.test(n)) return 'yunda';
  if (/^(ZT|ZTO)/.test(n)) return 'zhongtong';
  if (/^STO/.test(n)) return 'shentong';
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(n)) return 'ems';
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return 'ups';
  // 纯数字按长度推测国内主流
  if (/^(31|33|35|36|37|38|39|43|45|55)\d{11,13}$/.test(n)) return 'yunda';
  if (/^(75|78)\d{10,12}$/.test(n)) return 'zhongtong';
  if (/^(77|88)\d{10,12}$/.test(n)) return 'shentong';
  return null;
}

// 实时查件（快递100 poll/query.do）
async function kd100Query(com, num, phone) {
  const paramObj = { com, num, resultv2: '4' };
  if (phone) paramObj.phone = phone;
  const param = JSON.stringify(paramObj);
  const sign  = crypto.createHash('md5').update(param + KD100_KEY + KD100_CUSTOMER).digest('hex').toUpperCase();
  const body  = new URLSearchParams({ customer: KD100_CUSTOMER, sign, param }).toString();
  const r = await fetch('https://poll.kuaidi100.com/poll/query.do', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return await r.json();
}

app.get('/api/track', auth, async (req, res) => {
  try {
    if (!KD100_KEY || !KD100_CUSTOMER) {
      return res.status(500).json({ message: '后端未配置 KUAIDI100_KEY / KUAIDI100_CUSTOMER 环境变量' });
    }
    const num   = String(req.query.num   || '').trim();
    const phone = String(req.query.phone || '').trim();
    let com     = String(req.query.com   || '').trim();
    if (!num) return res.status(400).json({ message: '缺少单号 num' });

    const cacheKey = `${com||'auto'}:${num}:${phone}`;
    const cached = _cacheGet(cacheKey);
    if (cached) return res.json({ ...cached, _cached: true });

    if (!com || com === 'auto') {
      com = await kd100AutoDetect(num) || detectCarrierLocal(num);
      if (!com) return res.status(404).json({ message: '未能识别承运商，请在物流记录里填承运商后重试', need_carrier: true });
    }

    // 顺丰强制需要手机后 4 位
    if (com === 'shunfeng' && !phone) {
      return res.status(400).json({ message: '顺丰查件需要收件人/寄件人手机后 4 位', need_phone: true, carrier_code: com });
    }

    const raw = await kd100Query(com, num, phone);
    // raw: { message, status:'200/201/...', state, condition, data:[{time, context, ftime, areaCode, areaName}], com, nu, ischeck }
    if (raw.status && String(raw.status) !== '200') {
      return res.status(400).json({ message: raw.message || '查询失败', raw });
    }
    const out = {
      carrier_code: raw.com || com,
      tracking_number: raw.nu || num,
      state: raw.state,           // 0=在途 1=揽收 2=疑难 3=签收 4=退签 5=派件 6=退回 7=转投
      state_text: ({ '0':'在途','1':'已揽收','2':'疑难件','3':'已签收','4':'退签','5':'派件中','6':'退回','7':'转投','10':'待清关','11':'清关中','12':'已清关','13':'清关异常','14':'拒签' })[String(raw.state)] || '未知',
      delivered: String(raw.state) === '3',
      traces: (raw.data || []).map(d => ({
        time: d.ftime || d.time,
        context: d.context,
        location: d.areaName || '',
      })),
    };
    _cacheSet(cacheKey, out);
    res.json(out);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// AMAZON 库存智能补货
// ════════════════════════════════════════════════════════════

// SKU 配置 CRUD
app.get('/api/amazon/skus', auth, async (req, res) => {
  try {
    const data = await sb('amazon_sku_config?is_active=eq.true&select=*&order=created_at.desc');
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/amazon/skus', auth, async (req, res) => {
  try {
    const data = await sb('amazon_sku_config?select=*', {
      method:'POST', headers:{ 'Prefer':'return=representation' },
      body: JSON.stringify(req.body),
    });
    res.json({ success:true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/amazon/skus/:id', auth, async (req, res) => {
  try {
    await sb(`amazon_sku_config?id=eq.${req.params.id}`, {
      method:'PATCH',
      body: JSON.stringify({ ...req.body, updated_at: new Date().toISOString() }),
    });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/amazon/skus/:id', auth, async (req, res) => {
  try {
    await sb(`amazon_sku_config?id=eq.${req.params.id}`, {
      method:'PATCH', body: JSON.stringify({ is_active: false }),
    });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 每日销量录入（手动 / 后续接 SP-API）
app.post('/api/amazon/sales', auth, async (req, res) => {
  try {
    const { sku, sale_date, units_sold, revenue } = req.body || {};
    if (!sku || !sale_date) return res.status(400).json({ message: 'sku & sale_date required' });
    // upsert
    const existing = await sb(`amazon_daily_sales?sku=eq.${encodeURIComponent(sku)}&sale_date=eq.${sale_date}&select=id`);
    if (existing.length) {
      await sb(`amazon_daily_sales?id=eq.${existing[0].id}`, {
        method:'PATCH',
        body: JSON.stringify({ units_sold: Number(units_sold||0), revenue: Number(revenue||0) }),
      });
    } else {
      await sb('amazon_daily_sales', {
        method:'POST',
        body: JSON.stringify({ sku, sale_date, units_sold: Number(units_sold||0), revenue: Number(revenue||0) }),
      });
    }
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 批量录入销量（用于一次性导入）
app.post('/api/amazon/sales/batch', auth, async (req, res) => {
  try {
    const { rows } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ message: 'rows required' });
    let ok = 0;
    for (const r of rows) {
      if (!r.sku || !r.sale_date) continue;
      const existing = await sb(`amazon_daily_sales?sku=eq.${encodeURIComponent(r.sku)}&sale_date=eq.${r.sale_date}&select=id`).catch(()=>[]);
      if (existing.length) {
        await sb(`amazon_daily_sales?id=eq.${existing[0].id}`, {
          method:'PATCH',
          body: JSON.stringify({ units_sold: Number(r.units_sold||0), revenue: Number(r.revenue||0) }),
        });
      } else {
        await sb('amazon_daily_sales', {
          method:'POST',
          body: JSON.stringify({ sku: r.sku, sale_date: r.sale_date, units_sold: Number(r.units_sold||0), revenue: Number(r.revenue||0) }),
        });
      }
      ok++;
    }
    res.json({ success:true, count: ok });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/amazon/sales', auth, async (req, res) => {
  try {
    const { sku, days = 60 } = req.query;
    const since = new Date(Date.now() - Number(days)*86400000).toISOString().slice(0,10);
    let url = `amazon_daily_sales?sale_date=gte.${since}&order=sale_date.asc`;
    if (sku) url += `&sku=eq.${encodeURIComponent(sku)}`;
    const data = await sb(url);
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─────────────────────────────────────────────
// 核心算法：5 层智能补货
// ─────────────────────────────────────────────
function stdev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a,b)=>a+b,0) / arr.length;
  const variance = arr.reduce((a,b)=>a+Math.pow(b-mean,2),0) / arr.length;
  return Math.sqrt(variance);
}

// Z 值映射（服务水平 → Z）
function zFromService(level) {
  const map = { 80:0.84, 85:1.04, 90:1.28, 92:1.41, 95:1.65, 97:1.88, 98:2.05, 99:2.33, 99.5:2.58 };
  const keys = Object.keys(map).map(Number).sort((a,b)=>a-b);
  let best = keys[0];
  for (const k of keys) if (Math.abs(k - level) < Math.abs(best - level)) best = k;
  return map[best];
}

function calcReplenishment(cfg, salesRows) {
  // salesRows: 按日期升序的销量数组 [{sale_date, units_sold}, ...]
  const last7  = salesRows.slice(-7).map(r => Number(r.units_sold||0));
  const last14 = salesRows.slice(-14).map(r => Number(r.units_sold||0));
  const last30 = salesRows.slice(-30).map(r => Number(r.units_sold||0));

  const sum7  = last7.reduce((a,b)=>a+b,0);
  const sum14 = last14.reduce((a,b)=>a+b,0);
  const sum30 = last30.reduce((a,b)=>a+b,0);

  const avg7  = last7.length  ? sum7  / last7.length  : 0;
  const avg14 = last14.length ? sum14 / last14.length : 0;
  const avg30 = last30.length ? sum30 / last30.length : 0;

  // 加权平均日销
  const totalWeight = (last7.length*3) + (last14.length*2) + (last30.length*1);
  const weightedAvg = totalWeight > 0
    ? (sum7*3 + sum14*2 + sum30*1) / totalWeight
    : 0;

  // 趋势系数
  const trendCoef = avg30 > 0 ? avg7 / avg30 : 1;
  const trendLabel = trendCoef > 1.2 ? 'up' : trendCoef < 0.8 ? 'down' : 'flat';

  // 季节系数
  const month = String(new Date().getMonth() + 1);
  const seasonality = cfg.seasonality || {};
  const seasonCoef = Number(seasonality[month]) || 1;

  // 预测日销
  const forecastDaily = weightedAvg * trendCoef * seasonCoef;

  // 需求标准差 + 波动系数
  const sigma = stdev(last30.length ? last30 : last14);
  const cv = avg30 > 0 ? sigma / avg30 : 0;
  const cvLabel = cv < 0.3 ? 'stable' : cv < 0.7 ? 'medium' : 'high';

  // 总前置时间
  const totalLeadTime =
    Number(cfg.production_days||0) +
    Number(cfg.domestic_days||0) +
    Number(cfg.shipping_days||0) +
    Number(cfg.fba_intake_days||0);

  // 安全库存（Z × σ × √前置时间）
  const z = zFromService(Number(cfg.service_level || 95));
  const safetyStock = Math.ceil(z * sigma * Math.sqrt(totalLeadTime));

  // 补货触发点
  const reorderPoint = Math.ceil(forecastDaily * totalLeadTime + safetyStock);

  // 当前 + 在途
  const fbaStock = Number(cfg.fba_stock || 0);
  const inboundStock = Number(cfg.inbound_stock || 0);
  const totalStock = fbaStock + inboundStock;

  // 可卖天数
  const daysOfSupply = forecastDaily > 0 ? totalStock / forecastDaily : 999;

  // 建议补货量
  const coverage = Number(cfg.coverage_days || 60);
  let suggestedQty = Math.ceil(forecastDaily * (totalLeadTime + coverage) + safetyStock - totalStock);
  if (suggestedQty < 0) suggestedQty = 0;

  // MOQ 取整
  const moq = Number(cfg.moq || 1);
  if (moq > 1 && suggestedQty > 0 && suggestedQty < moq) suggestedQty = moq;

  // 状态判定
  let status = 'ok';            // 充足
  let urgencyLabel = '';
  let stockoutDays = 0;
  if (daysOfSupply < totalLeadTime) {
    status = 'urgent';          // 紧急（即使现在下单也会断货）
    stockoutDays = Math.ceil(totalLeadTime - daysOfSupply);
  } else if (totalStock < reorderPoint) {
    status = 'restock';         // 触发补货
  } else if (daysOfSupply > 90 && forecastDaily > 0) {
    status = 'overstock';       // 库存过多
  }

  // 空运/海运组合建议
  const airDays = Number(cfg.air_days || 7);
  const seaDays = Number(cfg.shipping_days || 25);
  const emergencyAirQty = stockoutDays > 0
    ? Math.ceil(forecastDaily * (airDays + Number(cfg.production_days||0) + Number(cfg.domestic_days||0) + Number(cfg.fba_intake_days||0)) + safetyStock)
    : 0;

  return {
    // 销量数据
    avg7: +avg7.toFixed(2),
    avg14: +avg14.toFixed(2),
    avg30: +avg30.toFixed(2),
    weighted_avg: +weightedAvg.toFixed(2),
    // 系数
    trend_coef: +trendCoef.toFixed(3),
    trend_label: trendLabel,
    season_coef: +seasonCoef.toFixed(2),
    // 预测
    forecast_daily: +forecastDaily.toFixed(2),
    // 波动
    sigma: +sigma.toFixed(2),
    cv: +cv.toFixed(2),
    cv_label: cvLabel,
    // 前置时间 + 安全库存
    total_lead_time: totalLeadTime,
    z_value: z,
    safety_stock: safetyStock,
    // 补货
    reorder_point: reorderPoint,
    days_of_supply: +daysOfSupply.toFixed(1),
    suggested_qty: suggestedQty,
    fba_stock: fbaStock,
    inbound_stock: inboundStock,
    total_stock: totalStock,
    // 状态
    status,
    stockout_days: stockoutDays,
    emergency_air_qty: emergencyAirQty,
    coverage_days: coverage,
  };
}

// 获取所有 SKU 的智能补货分析
app.get('/api/amazon/replenishment', auth, async (req, res) => {
  try {
    const skus = await sb('amazon_sku_config?is_active=eq.true&select=*&order=created_at.desc');
    if (!skus.length) return res.json([]);
    const since = new Date(Date.now() - 60*86400000).toISOString().slice(0,10);
    const allSales = await sb(`amazon_daily_sales?sale_date=gte.${since}&order=sale_date.asc&select=*`);
    const out = skus.map(sku => {
      const rows = allSales.filter(r => r.sku === sku.sku);
      const calc = calcReplenishment(sku, rows);
      return { ...sku, ...calc, _sales_history: rows };
    });
    res.json(out);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// AMAZON 广告管理
// ════════════════════════════════════════════════════════════

// 广告每日数据 CRUD
app.get('/api/amazon/ads', auth, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - Number(days)*86400000).toISOString().slice(0,10);
    const data = await sb(`amazon_ad_daily?ad_date=gte.${since}&order=ad_date.desc,campaign_name.asc`);
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/amazon/ads', auth, async (req, res) => {
  try {
    const data = await sb('amazon_ad_daily?select=id', {
      method:'POST', headers:{ 'Prefer':'return=representation' },
      body: JSON.stringify(req.body),
    });
    res.json({ success:true, id: data[0]?.id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/amazon/ads/batch', auth, async (req, res) => {
  try {
    const { rows } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ message: 'rows required' });
    await sb('amazon_ad_daily', { method:'POST', body: JSON.stringify(rows) });
    res.json({ success:true, count: rows.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 广告汇总统计
app.get('/api/amazon/ads/summary', auth, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const since = new Date(Date.now() - Number(days)*86400000).toISOString().slice(0,10);
    const data = await sb(`amazon_ad_daily?ad_date=gte.${since}&select=*`);
    const byKw = {};
    let totalSpend=0, totalSales=0, totalClicks=0, totalImpressions=0, totalOrders=0;
    data.forEach(r => {
      totalSpend += Number(r.spend||0);
      totalSales += Number(r.sales||0);
      totalClicks += Number(r.clicks||0);
      totalImpressions += Number(r.impressions||0);
      totalOrders += Number(r.orders||0);
      const k = r.keyword || '(auto)';
      if (!byKw[k]) byKw[k] = { keyword:k, spend:0, sales:0, clicks:0, impressions:0, orders:0, days:0 };
      byKw[k].spend += Number(r.spend||0);
      byKw[k].sales += Number(r.sales||0);
      byKw[k].clicks += Number(r.clicks||0);
      byKw[k].impressions += Number(r.impressions||0);
      byKw[k].orders += Number(r.orders||0);
      byKw[k].days++;
    });
    const keywords = Object.values(byKw).map(k => ({
      ...k,
      acos: k.sales > 0 ? +(k.spend/k.sales*100).toFixed(2) : 0,
      ctr: k.impressions > 0 ? +(k.clicks/k.impressions*100).toFixed(2) : 0,
      cvr: k.clicks > 0 ? +(k.orders/k.clicks*100).toFixed(2) : 0,
      cpc: k.clicks > 0 ? +(k.spend/k.clicks).toFixed(2) : 0,
    })).sort((a,b) => b.spend - a.spend);
    res.json({
      total: { spend:+totalSpend.toFixed(2), sales:+totalSales.toFixed(2), clicks:totalClicks, impressions:totalImpressions, orders:totalOrders,
        acos: totalSales>0 ? +(totalSpend/totalSales*100).toFixed(2) : 0,
        roas: totalSpend>0 ? +(totalSales/totalSpend).toFixed(2) : 0,
        ctr: totalImpressions>0 ? +(totalClicks/totalImpressions*100).toFixed(2) : 0,
        cvr: totalClicks>0 ? +(totalOrders/totalClicks*100).toFixed(2) : 0,
      },
      keywords,
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 规则引擎 CRUD
app.get('/api/amazon/ad-rules', auth, async (req, res) => {
  try { res.json(await sb('amazon_ad_rules?order=created_at.desc')); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/amazon/ad-rules', auth, async (req, res) => {
  try {
    const data = await sb('amazon_ad_rules?select=*', { method:'POST', headers:{'Prefer':'return=representation'}, body:JSON.stringify(req.body) });
    res.json({ success:true, data:data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/amazon/ad-rules/:id', auth, async (req, res) => {
  try { await sb(`amazon_ad_rules?id=eq.${req.params.id}`, { method:'PATCH', body:JSON.stringify(req.body) }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/amazon/ad-rules/:id', auth, async (req, res) => {
  try { await sb(`amazon_ad_rules?id=eq.${req.params.id}`, { method:'DELETE' }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

// 规则引擎执行：分析数据 → 生成调整建议
app.get('/api/amazon/ad-rules/suggestions', auth, async (req, res) => {
  try {
    const rules = await sb('amazon_ad_rules?is_active=eq.true&select=*');
    if (!rules.length) return res.json([]);
    const maxDays = Math.max(...rules.map(r => Number(r.days||3)));
    const since = new Date(Date.now() - maxDays*86400000).toISOString().slice(0,10);
    const data = await sb(`amazon_ad_daily?ad_date=gte.${since}&select=*`);
    const suggestions = [];
    for (const rule of rules) {
      const d = Number(rule.days||3);
      const cutoff = new Date(Date.now() - d*86400000).toISOString().slice(0,10);
      const filtered = data.filter(r => r.ad_date >= cutoff);
      const byKw = {};
      filtered.forEach(r => {
        const k = `${r.campaign_name}||${r.keyword||'(auto)'}`;
        if (!byKw[k]) byKw[k] = { campaign:r.campaign_name, keyword:r.keyword||'(auto)', spend:0, sales:0, clicks:0, orders:0, days:0 };
        byKw[k].spend += Number(r.spend||0);
        byKw[k].sales += Number(r.sales||0);
        byKw[k].clicks += Number(r.clicks||0);
        byKw[k].orders += Number(r.orders||0);
        byKw[k].days++;
      });
      for (const kw of Object.values(byKw)) {
        if (kw.clicks < Number(rule.min_clicks||0)) continue;
        const acos = kw.sales > 0 ? kw.spend/kw.sales*100 : (kw.spend > 0 ? 999 : 0);
        const cvr = kw.clicks > 0 ? kw.orders/kw.clicks*100 : 0;
        let metricVal = 0;
        if (rule.metric === 'acos') metricVal = acos;
        else if (rule.metric === 'cvr') metricVal = cvr;
        else if (rule.metric === 'spend_no_sale') metricVal = (kw.orders === 0 && kw.spend > 0) ? kw.spend : 0;
        let triggered = false;
        if (rule.operator === '>' && metricVal > Number(rule.threshold)) triggered = true;
        if (rule.operator === '<' && metricVal < Number(rule.threshold)) triggered = true;
        if (rule.operator === '>=' && metricVal >= Number(rule.threshold)) triggered = true;
        if (triggered) {
          suggestions.push({
            rule_id: rule.id, rule_name: rule.rule_name,
            campaign: kw.campaign, keyword: kw.keyword,
            metric: rule.metric, metric_value: +metricVal.toFixed(2),
            action_type: rule.action_type, action_value: Number(rule.action_value),
            spend: +kw.spend.toFixed(2), sales: +kw.sales.toFixed(2), clicks: kw.clicks, orders: kw.orders,
          });
        }
      }
    }
    res.json(suggestions);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 否定关键词
app.get('/api/amazon/negative-keywords', auth, async (req, res) => {
  try { res.json(await sb('amazon_negative_keywords?order=added_at.desc')); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/amazon/negative-keywords', auth, async (req, res) => {
  try { await sb('amazon_negative_keywords', { method:'POST', body:JSON.stringify(req.body) }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/amazon/negative-keywords/:id', auth, async (req, res) => {
  try { await sb(`amazon_negative_keywords?id=eq.${req.params.id}`, { method:'DELETE' }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// AMAZON 竞对调研
// ════════════════════════════════════════════════════════════

// 竞品 ASIN CRUD
app.get('/api/amazon/competitors', auth, async (req, res) => {
  try { res.json(await sb('amazon_competitors?is_active=eq.true&order=created_at.desc&select=*')); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/amazon/competitors', auth, async (req, res) => {
  try {
    const data = await sb('amazon_competitors?select=*', { method:'POST', headers:{'Prefer':'return=representation'}, body:JSON.stringify(req.body) });
    res.json({ success:true, data:data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/amazon/competitors/:id', auth, async (req, res) => {
  try { await sb(`amazon_competitors?id=eq.${req.params.id}`, { method:'PATCH', body:JSON.stringify({...req.body, updated_at:new Date().toISOString()}) }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/amazon/competitors/:id', auth, async (req, res) => {
  try { await sb(`amazon_competitors?id=eq.${req.params.id}`, { method:'PATCH', body:JSON.stringify({is_active:false}) }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

// 竞品历史快照
app.post('/api/amazon/competitors/:id/snapshot', auth, async (req, res) => {
  try {
    const comp = await sb(`amazon_competitors?id=eq.${req.params.id}&select=asin,price,bsr,reviews,rating`);
    if (!comp.length) return res.status(404).json({ message:'Not found' });
    const c = comp[0];
    const today = new Date().toISOString().slice(0,10);
    await sb('amazon_competitor_history', { method:'POST', body:JSON.stringify({ asin:c.asin, snapshot_date:today, price:c.price, bsr:c.bsr, reviews:c.reviews, rating:c.rating }) });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/amazon/competitor-history/:asin', auth, async (req, res) => {
  try { res.json(await sb(`amazon_competitor_history?asin=eq.${req.params.asin}&order=snapshot_date.desc&limit=90`)); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

// 关键词库 CRUD
app.get('/api/amazon/keywords', auth, async (req, res) => {
  try { res.json(await sb('amazon_keywords?is_active=eq.true&order=created_at.desc&select=*')); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/amazon/keywords', auth, async (req, res) => {
  try {
    const data = await sb('amazon_keywords?select=*', { method:'POST', headers:{'Prefer':'return=representation'}, body:JSON.stringify(req.body) });
    res.json({ success:true, data:data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/amazon/keywords/:id', auth, async (req, res) => {
  try { await sb(`amazon_keywords?id=eq.${req.params.id}`, { method:'PATCH', body:JSON.stringify({...req.body, updated_at:new Date().toISOString()}) }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/amazon/keywords/:id', auth, async (req, res) => {
  try { await sb(`amazon_keywords?id=eq.${req.params.id}`, { method:'PATCH', body:JSON.stringify({is_active:false}) }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

// ─────────────────────────────────────────────
// ASIN 自动抓取：从 Amazon 产品页解析基本信息
// ─────────────────────────────────────────────
async function scrapeAsin(asin, marketplace = 'us') {
  const domains = { us:'www.amazon.com', uk:'www.amazon.co.uk', de:'www.amazon.de', jp:'www.amazon.co.jp' };
  const domain = domains[marketplace] || domains.us;
  const url = `https://${domain}/dp/${asin}`;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const html = await r.text();

    const extract = (pattern) => { const m = html.match(pattern); return m ? m[1].trim() : ''; };

    const title = extract(/<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/) || extract(/<title>(.*?)<\/title>/);
    const priceStr = extract(/class="a-price-whole"[^>]*>([\d,]+)/) || extract(/priceAmount.*?>([\d,.]+)/);
    const price = parseFloat((priceStr||'').replace(/,/g,'')) || null;
    const ratingStr = extract(/(\d+\.?\d*)\s*out of\s*5/i) || extract(/(\d+\.?\d*)\s*颗星/);
    const rating = parseFloat(ratingStr) || null;
    const reviewsStr = extract(/(\d[\d,]*)\s*(?:global\s*)?ratings/i) || extract(/(\d[\d,]*)\s*个评分/);
    const reviews = parseInt((reviewsStr||'').replace(/,/g,'')) || null;
    const bsrStr = extract(/Best Sellers Rank.*?#([\d,]+)/i) || extract(/商品の売れ筋ランキング.*?(\d[\d,]*)/);
    const bsr = parseInt((bsrStr||'').replace(/,/g,'')) || null;
    const brand = extract(/Brand.*?<\/td>\s*<td[^>]*>\s*<span[^>]*>(.*?)<\/span>/i) || extract(/brand.*?">(.*?)</i);
    const imgMatch = html.match(/"hiRes":"(https:\/\/[^"]+)"/);
    const image_url = imgMatch ? imgMatch[1] : (extract(/id="landingImage"[^>]*src="([^"]+)"/) || '');
    const category = extract(/Best Sellers Rank.*?in\s*<a[^>]*>(.*?)<\/a>/i) || '';

    return { title: title.replace(/<[^>]+>/g,'').trim(), price, rating, reviews, bsr, brand: brand.replace(/<[^>]+>/g,'').trim(), image_url, category: category.replace(/<[^>]+>/g,'').trim() };
  } catch (e) {
    return { error: e.message };
  }
}

// 输入 ASIN 自动抓取信息
app.post('/api/amazon/competitors/lookup', auth, async (req, res) => {
  try {
    const { asin, marketplace } = req.body || {};
    if (!asin) return res.status(400).json({ message: 'ASIN required' });
    const data = await scrapeAsin(asin.trim(), marketplace);
    if (data.error) return res.status(500).json({ message: `抓取失败: ${data.error}` });
    res.json({ success: true, data: { asin: asin.trim(), ...data } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 全部竞品自动刷新（每日定时调用 or 手动触发）
app.post('/api/amazon/competitors/refresh-all', auth, async (req, res) => {
  try {
    const comps = await sb('amazon_competitors?is_active=eq.true&select=id,asin');
    if (!comps.length) return res.json({ success:true, updated:0, alerts:[] });
    const today = new Date().toISOString().slice(0,10);
    let updated = 0;
    const alerts = [];

    for (const comp of comps) {
      try {
        const data = await scrapeAsin(comp.asin);
        if (data.error) continue;

        // 获取上次快照做对比
        const lastSnap = await sb(`amazon_competitor_history?asin=eq.${comp.asin}&order=snapshot_date.desc&limit=1`).catch(()=>[]);
        const prev = lastSnap[0] || {};

        // 更新竞品主记录
        const patch = { updated_at: new Date().toISOString() };
        if (data.title) patch.title = data.title;
        if (data.price != null) patch.price = data.price;
        if (data.bsr != null) patch.bsr = data.bsr;
        if (data.reviews != null) patch.reviews = data.reviews;
        if (data.rating != null) patch.rating = data.rating;
        if (data.brand) patch.brand = data.brand;
        if (data.image_url) patch.image_url = data.image_url;
        if (data.category) patch.category = data.category;
        await sb(`amazon_competitors?id=eq.${comp.id}`, { method:'PATCH', body:JSON.stringify(patch) });

        // 保存快照
        await sb('amazon_competitor_history', { method:'POST', body:JSON.stringify({
          asin: comp.asin, snapshot_date: today,
          price: data.price, bsr: data.bsr, reviews: data.reviews, rating: data.rating,
        })}).catch(()=>{});

        // 变化检测
        if (prev.price && data.price) {
          const priceDiff = ((data.price - prev.price) / prev.price * 100);
          if (Math.abs(priceDiff) > 5) {
            alerts.push({ asin:comp.asin, type:'price', old:prev.price, new:data.price, change:`${priceDiff>0?'+':''}${priceDiff.toFixed(1)}%` });
          }
        }
        if (prev.bsr && data.bsr) {
          const bsrDiff = ((data.bsr - prev.bsr) / prev.bsr * 100);
          if (Math.abs(bsrDiff) > 20) {
            alerts.push({ asin:comp.asin, type:'bsr', old:prev.bsr, new:data.bsr, change:`${bsrDiff>0?'+':''}${bsrDiff.toFixed(1)}%` });
          }
        }
        if (prev.reviews && data.reviews && (data.reviews - prev.reviews) > 10) {
          alerts.push({ asin:comp.asin, type:'reviews', old:prev.reviews, new:data.reviews, change:`+${data.reviews-prev.reviews}` });
        }

        updated++;
      } catch(_) {}
    }

    res.json({ success:true, updated, alerts });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════
// v2.9: 亚马逊运营升级
//   - 类目 amazon_categories
//   - 全局配置 amazon_op_config（含 SP-API 凭证）
//   - 产品毛利 amazon_margin_items
//   - 竞品品牌 amazon_competitor_brands
//   - 竞品关键词 amazon_brand_keywords
//   - SP-API 同步占位
//   - CSV 批量导入
// ════════════════════════════════════════════════════════════

// ── 类目 ──
app.get('/api/amazon/categories', auth, async (req, res) => {
  try { res.json(await sb('amazon_categories?is_active=eq.true&order=sort_order.asc&select=*')); }
  catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/amazon/categories', auth, async (req, res) => {
  try {
    const { code, name_cn, name_en, sort_order } = req.body || {};
    if (!code || !name_cn) return res.status(400).json({ message: 'code + name_cn required' });
    const data = await sb('amazon_categories?select=*', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ code: code.toLowerCase(), name_cn, name_en, sort_order: sort_order || 0 }),
    });
    res.json({ success: true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/amazon/categories/:id', auth, async (req, res) => {
  try { await sb(`amazon_categories?id=eq.${req.params.id}`, { method:'PATCH', body:JSON.stringify(req.body) }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});
app.delete('/api/amazon/categories/:id', auth, async (req, res) => {
  try { await sb(`amazon_categories?id=eq.${req.params.id}`, { method:'PATCH', body:JSON.stringify({is_active:false}) }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

// ── 全局运营配置 ──
app.get('/api/amazon/op-config', auth, async (req, res) => {
  try {
    const rows = await sb('amazon_op_config?id=eq.1&select=*');
    const c = rows[0] || {};
    // 不返回敏感凭证明文，仅返回是否已设置
    res.json({
      exchange_rate: Number(c.exchange_rate || 7.2),
      commission_rate: Number(c.commission_rate || 15),
      freight_per_kg: Number(c.freight_per_kg || 7.5),
      sp_api_client_id: c.sp_api_client_id || '',
      sp_api_seller_id: c.sp_api_seller_id || '',
      sp_api_marketplace_id: c.sp_api_marketplace_id || 'ATVPDKIKX0DER',
      sp_api_secret_set: !!c.sp_api_client_secret,
      sp_api_refresh_token_set: !!c.sp_api_refresh_token,
      sp_api_last_sync: c.sp_api_last_sync,
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/amazon/op-config', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (b.exchange_rate != null) patch.exchange_rate = Number(b.exchange_rate);
    if (b.commission_rate != null) patch.commission_rate = Number(b.commission_rate);
    if (b.freight_per_kg != null) patch.freight_per_kg = Number(b.freight_per_kg);
    if (b.sp_api_client_id !== undefined) patch.sp_api_client_id = b.sp_api_client_id || null;
    if (b.sp_api_seller_id !== undefined) patch.sp_api_seller_id = b.sp_api_seller_id || null;
    if (b.sp_api_marketplace_id) patch.sp_api_marketplace_id = b.sp_api_marketplace_id;
    if (b.sp_api_client_secret) patch.sp_api_client_secret = encryptText(b.sp_api_client_secret);
    if (b.sp_api_refresh_token) patch.sp_api_refresh_token = encryptText(b.sp_api_refresh_token);
    await sb('amazon_op_config?id=eq.1', { method:'PATCH', body: JSON.stringify(patch) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── 产品毛利 ──
app.get('/api/amazon/margin-items', auth, async (req, res) => {
  try {
    const { category } = req.query;
    let url = 'amazon_margin_items?is_active=eq.true&order=category_code.asc,sort_order.asc&select=*';
    if (category) url = `amazon_margin_items?is_active=eq.true&category_code=eq.${category}&order=sort_order.asc&select=*`;
    res.json(await sb(url));
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/amazon/margin-items', auth, async (req, res) => {
  try {
    const data = await sb('amazon_margin_items?select=*', {
      method:'POST',
      headers:{'Prefer':'return=representation'},
      body: JSON.stringify(req.body),
    });
    res.json({ success:true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/amazon/margin-items/:id', auth, async (req, res) => {
  try {
    await sb(`amazon_margin_items?id=eq.${req.params.id}`, {
      method:'PATCH',
      body: JSON.stringify({ ...req.body, updated_at: new Date().toISOString() }),
    });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.delete('/api/amazon/margin-items/:id', auth, async (req, res) => {
  try {
    await sb(`amazon_margin_items?id=eq.${req.params.id}`, { method:'PATCH', body: JSON.stringify({is_active:false}) });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// 批量保存：前端编辑后整批 upsert（id 存在则改、无则建）
app.post('/api/amazon/margin-items/bulk', auth, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    let saved = 0;
    for (const it of items) {
      if (it.id) {
        await sb(`amazon_margin_items?id=eq.${it.id}`, {
          method:'PATCH',
          body: JSON.stringify({ ...it, id: undefined, updated_at: new Date().toISOString() }),
        });
      } else {
        await sb('amazon_margin_items', { method:'POST', body: JSON.stringify(it) });
      }
      saved++;
    }
    res.json({ success:true, saved });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── 竞品品牌 ──
app.get('/api/amazon/comp-brands', auth, async (req, res) => {
  try {
    const { category } = req.query;
    let url = 'amazon_competitor_brands?is_active=eq.true&order=sort_order.asc,brand_name.asc&select=*';
    if (category) url = `amazon_competitor_brands?is_active=eq.true&category_code=eq.${category}&order=sort_order.asc&select=*`;
    res.json(await sb(url));
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/amazon/comp-brands', auth, async (req, res) => {
  try {
    const data = await sb('amazon_competitor_brands?select=*', {
      method:'POST',
      headers:{'Prefer':'return=representation'},
      body: JSON.stringify(req.body),
    });
    res.json({ success:true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/amazon/comp-brands/:id', auth, async (req, res) => {
  try { await sb(`amazon_competitor_brands?id=eq.${req.params.id}`, { method:'PATCH', body:JSON.stringify(req.body) }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});
app.delete('/api/amazon/comp-brands/:id', auth, async (req, res) => {
  try { await sb(`amazon_competitor_brands?id=eq.${req.params.id}`, { method:'PATCH', body:JSON.stringify({is_active:false}) }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

// ── 竞品关键词调研 ──
app.get('/api/amazon/brand-keywords', auth, async (req, res) => {
  try {
    const { brand_id, category, keyword } = req.query;
    const parts = [];
    if (brand_id) parts.push(`brand_id=eq.${brand_id}`);
    if (keyword) parts.push(`keyword=ilike.%25${encodeURIComponent(keyword)}%25`);
    let url = 'amazon_brand_keywords?' + parts.join('&') + (parts.length ? '&' : '') + 'order=brand_id.asc,organic_rank.asc&select=*';
    let rows = await sb(url);
    if (category) {
      // 按 brand 的 category 过滤
      const brands = await sb(`amazon_competitor_brands?category_code=eq.${category}&select=id`);
      const ids = new Set(brands.map(b => b.id));
      rows = rows.filter(r => ids.has(r.brand_id));
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/amazon/brand-keywords', auth, async (req, res) => {
  try {
    const data = await sb('amazon_brand_keywords?select=*', {
      method:'POST',
      headers:{'Prefer':'return=representation'},
      body: JSON.stringify(req.body),
    });
    res.json({ success:true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/amazon/brand-keywords/:id', auth, async (req, res) => {
  try { await sb(`amazon_brand_keywords?id=eq.${req.params.id}`, { method:'PATCH', body:JSON.stringify(req.body) }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});
app.delete('/api/amazon/brand-keywords/:id', auth, async (req, res) => {
  try { await sb(`amazon_brand_keywords?id=eq.${req.params.id}`, { method:'DELETE' }); res.json({success:true}); }
  catch (e) { res.status(500).json({ message: e.message }); }
});
// 批量导入（CSV / 粘贴）
app.post('/api/amazon/brand-keywords/bulk', auth, async (req, res) => {
  try {
    const { brand_id, rows } = req.body || {};
    if (!brand_id || !Array.isArray(rows) || !rows.length) return res.status(400).json({ message:'brand_id + rows required' });
    const today = new Date().toISOString().slice(0,10);
    const payload = rows
      .filter(r => r && r.keyword)
      .map(r => ({
        brand_id,
        keyword: String(r.keyword).trim(),
        organic_rank: r.organic_rank != null ? Number(r.organic_rank) : null,
        organic_traffic_pct: r.organic_traffic_pct != null ? Number(r.organic_traffic_pct) : null,
        ad_traffic_pct: r.ad_traffic_pct != null ? Number(r.ad_traffic_pct) : null,
        snapshot_date: r.snapshot_date || today,
      }));
    if (!payload.length) return res.json({ success:true, saved:0 });
    await sb('amazon_brand_keywords', { method:'POST', body: JSON.stringify(payload) });
    res.json({ success:true, saved: payload.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// 聚合视图：所有品牌共同关键词矩阵
app.get('/api/amazon/brand-keywords/matrix', auth, async (req, res) => {
  try {
    const { category } = req.query;
    let brandUrl = 'amazon_competitor_brands?is_active=eq.true&order=sort_order.asc&select=*';
    if (category) brandUrl = `amazon_competitor_brands?is_active=eq.true&category_code=eq.${category}&order=sort_order.asc&select=*`;
    const brands = await sb(brandUrl);
    if (!brands.length) return res.json({ brands: [], keywords: [], matrix: {} });
    const ids = brands.map(b => b.id).join(',');
    const kws = await sb(`amazon_brand_keywords?brand_id=in.(${ids})&select=*`);
    // 取每个 (brand, keyword) 的最新快照
    const latest = new Map();   // key brand_id|keyword
    for (const k of kws) {
      const key = `${k.brand_id}|${k.keyword.toLowerCase()}`;
      const prev = latest.get(key);
      if (!prev || (k.snapshot_date || '') > (prev.snapshot_date || '')) latest.set(key, k);
    }
    const kwSet = new Set();
    for (const k of latest.values()) kwSet.add(k.keyword.toLowerCase());
    const keywords = [...kwSet].sort();
    const matrix = {};
    for (const kw of keywords) {
      matrix[kw] = {};
      for (const b of brands) {
        const v = latest.get(`${b.id}|${kw}`);
        if (v) matrix[kw][b.id] = { rank: v.organic_rank, organic: v.organic_traffic_pct, ad: v.ad_traffic_pct };
      }
    }
    res.json({ brands, keywords, matrix });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── SP-API 占位接口 ──
// 测试连接：检查凭证是否填齐（不真正调用，避免没注册开发者时报错）
app.post('/api/amazon/sp-api/sync', auth, async (req, res) => {
  try {
    const rows = await sb('amazon_op_config?id=eq.1&select=*');
    const c = rows[0] || {};
    if (!c.sp_api_client_id || !c.sp_api_client_secret || !c.sp_api_refresh_token) {
      return res.status(400).json({ message: '请先在设置页填写 SP-API 凭证（client_id / client_secret / refresh_token）' });
    }
    const clientSecret = decryptText(c.sp_api_client_secret);
    const refreshToken = decryptText(c.sp_api_refresh_token);
    // 1. 用 refresh_token 换 access_token (LWA)
    const tokenRes = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: c.sp_api_client_id,
        client_secret: clientSecret,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) {
      return res.status(500).json({ message: 'LWA token 获取失败', detail: tokenJson });
    }
    // 2. TODO: 用 access_token 调 SP-API 报告接口拉取数据
    // 这里先返回成功，后续等用户注册好开发者再实现真实数据抓取
    await sb('amazon_op_config?id=eq.1', { method:'PATCH', body: JSON.stringify({ sp_api_last_sync: new Date().toISOString() }) });
    res.json({ success: true, message: 'LWA 连接成功，数据同步接口预留中', has_token: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ────────────────────────────────────────────────────────────────────
// 官网询盘接口（公开，无需 auth）
// 接收 tpkele.com 表单提交，写入 inquiries + 自动关联/创建客户
// 同时往 emails 表写一条 folder=INQUIRY 的记录，便于邮件页"网站询盘"标签查看
// ────────────────────────────────────────────────────────────────────
app.post('/api/website-inquiry', async (req, res) => {
  try {
    const { name, email, product, subject, message } = req.body || {};
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (!email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Invalid email' });
    }

    const cleanName    = String(name).trim();
    const cleanEmail   = String(email).trim().toLowerCase();
    const cleanProduct = product ? String(product).trim() : '';
    const cleanSubject = String(subject).trim();
    const cleanMessage = String(message).trim();
    const now          = new Date().toISOString();

    // 查找或创建客户
    let customerId = null;
    const esc = encodeURIComponent(cleanEmail);
    const existing = await sb(`customers?email=ilike.%25${esc}%25&is_deleted=eq.false&select=id&limit=1`).catch(() => []);
    if (existing.length) {
      customerId = existing[0].id;
    } else {
      const created = await sb('customers?select=id', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          customer_name: cleanName,
          email: cleanEmail,
          source: 'website',
          notes: cleanProduct ? `Product interest: ${cleanProduct}` : '',
        }),
      }).catch(() => null);
      if (created && created[0]) customerId = created[0].id;
    }

    // 写入询盘（拆字段 + 兼容 notes）
    const notesBlock = [
      `From: ${cleanName} <${cleanEmail}>`,
      cleanProduct ? `Product: ${cleanProduct}` : '',
      `Subject: ${cleanSubject}`,
      `Message: ${cleanMessage}`,
    ].filter(Boolean).join('\n');

    await sb('inquiries', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customerId,
        customer_name: cleanName,
        email: cleanEmail,
        product_interest: cleanProduct,
        subject: cleanSubject,
        message: cleanMessage,
        source: 'website',
        inquiry_date: now.slice(0, 10),
        status: 'new',
        notes: notesBlock,
      }),
    });

    // 同步往 emails 表写一条，folder=INQUIRY（不依赖 IMAP，便于在邮件页查看）
    const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#1f2937">
      <p><strong>来自网站表单的询盘</strong></p>
      <table style="border-collapse:collapse;margin:8px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">姓名</td><td><strong>${escapeHtml(cleanName)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">邮箱</td><td><a href="mailto:${escapeHtml(cleanEmail)}">${escapeHtml(cleanEmail)}</a></td></tr>
        ${cleanProduct ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">产品</td><td>${escapeHtml(cleanProduct)}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">主题</td><td>${escapeHtml(cleanSubject)}</td></tr>
      </table>
      <div style="margin-top:14px;padding:14px 16px;background:#f9fafb;border-left:3px solid #2563eb;white-space:pre-wrap;border-radius:4px">${escapeHtml(cleanMessage)}</div>
    </div>`;
    const bodyText = `[网站询盘]\n姓名: ${cleanName}\n邮箱: ${cleanEmail}\n${cleanProduct ? `产品: ${cleanProduct}\n` : ''}主题: ${cleanSubject}\n\n${cleanMessage}`;
    await sb('emails', {
      method: 'POST',
      body: JSON.stringify({
        message_id:   `website-inquiry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        folder:       'INQUIRY',
        from_address: cleanEmail,
        from_name:    cleanName,
        to_addresses: 'website-form',
        subject:      `[询盘] ${cleanSubject}`,
        body_text:    bodyText,
        body_html:    bodyHtml,
        is_read:      false,
        is_deleted:   false,
        received_at:  now,
      }),
    }).catch((e) => { console.error('Failed to write inquiry to emails table:', e.message); });

    res.json({ success: true });
  } catch (e) {
    console.error('Website inquiry error:', e.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ════════════════════════════════════════════════════════════════════
// LIVE CHAT (website ↔ CRM) + Web Push 离线推送
// ════════════════════════════════════════════════════════════════════
// 设计：
//   1. 访客在独立站打开浮窗 → 调 /api/chat/visitor/start 拿 session_id（无认证，靠 visitor_id 区分）
//   2. 访客发消息 → /api/chat/visitor/message
//      → 触发：① 在 chat_messages INSERT（Supabase Realtime 把消息推到 CRM 浏览器） ② Web Push 推到 iPhone PWA
//   3. 客服在 CRM 看会话列表（/api/chat/sessions）、回消息（/api/chat/agent/reply）
//   4. CRM 用户在 PWA 里允许通知后调 /api/chat/push/subscribe 把 endpoint 存起来；
//      访客来新消息时后端遍历所有 push_subscriptions 推一次。
// ════════════════════════════════════════════════════════════════════

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@tpkele.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (e) {
    console.warn('[push] VAPID 配置失败：', e.message);
  }
} else {
  console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY 未设置，推送功能将不可用（聊天仍可用）');
}

// 简单 CORS：聊天访客接口允许跨域（独立站要从 tpkele.com 调到 crm.tpkele.com）
function chatCors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Visitor-Id');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

// 给 CRM 推送（遍历所有订阅）
async function pushToAllAgents(payload) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const subs = await sb('push_subscriptions?select=id,endpoint,p256dh,auth').catch(() => []);
  await Promise.all(subs.map(async (s) => {
    const subscription = {
      endpoint: s.endpoint,
      keys: { p256dh: s.p256dh, auth: s.auth },
    };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (err) {
      // 410 = 用户已取消订阅；404 = endpoint 不存在 → 清理
      if (err.statusCode === 410 || err.statusCode === 404) {
        await sb(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }).catch(() => {});
      } else {
        console.warn('[push] send error:', err.statusCode, err.body);
      }
    }
  }));
}

// VAPID 公钥（前端注册推送时用）
app.get('/api/chat/vapid-public-key', chatCors, (req, res) => {
  res.json({ key: VAPID_PUBLIC });
});

// 给前端拉公开配置（Supabase URL / anon key / VAPID 公钥）
// 这些都是公钥/anon，受 RLS 和域名白名单保护，可以安全暴露给客户端
app.get('/api/chat/config', chatCors, (req, res) => {
  res.json({
    supabase_url: SB_URL,
    supabase_anon_key: SB_KEY,
    vapid_public_key: VAPID_PUBLIC,
  });
});

// ── 访客侧：开启 / 续接一个会话 ─────────────────────────────────
app.options('/api/chat/visitor/start', chatCors, (req, res) => res.status(204).end());
app.post('/api/chat/visitor/start', chatCors, async (req, res) => {
  try {
    const visitorId = String(req.headers['x-visitor-id'] || req.body?.visitor_id || '').trim();
    if (!visitorId || visitorId.length > 100) {
      return res.status(400).json({ message: 'visitor_id required' });
    }
    const { name, email, page_url } = req.body || {};
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    // 找该访客 24 小时内的 open 会话，有就续接；没就新建
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const existing = await sb(
      `chat_sessions?visitor_id=eq.${encodeURIComponent(visitorId)}&status=eq.open&last_message_at=gte.${encodeURIComponent(since)}&order=last_message_at.desc&limit=1`
    ).catch(() => []);

    let session;
    if (existing.length) {
      session = existing[0];
      // 顺手更新姓名/邮箱（如果新填了）
      const patch = {};
      if (name && !session.visitor_name) patch.visitor_name = String(name).slice(0, 100);
      if (email && !session.visitor_email) patch.visitor_email = String(email).slice(0, 200);
      if (Object.keys(patch).length) {
        await sb(`chat_sessions?id=eq.${session.id}`, {
          method: 'PATCH', body: JSON.stringify(patch),
        }).catch(() => {});
      }
    } else {
      const created = await sb('chat_sessions?select=*', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          visitor_id: visitorId,
          visitor_name: name ? String(name).slice(0, 100) : null,
          visitor_email: email ? String(email).slice(0, 200) : null,
          page_url: page_url ? String(page_url).slice(0, 500) : null,
          user_agent: ua,
          status: 'open',
        }),
      });
      session = created[0];
    }

    // 回拉最近 50 条消息（续接时让访客看到历史）
    const msgs = await sb(
      `chat_messages?session_id=eq.${session.id}&select=id,sender,body,created_at&order=created_at.asc&limit=50`
    ).catch(() => []);

    res.json({ session_id: session.id, messages: msgs });
  } catch (e) {
    console.error('chat/visitor/start error:', e.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── 访客侧：发消息 ─────────────────────────────────────────
app.options('/api/chat/visitor/message', chatCors, (req, res) => res.status(204).end());
app.post('/api/chat/visitor/message', chatCors, async (req, res) => {
  try {
    const visitorId = String(req.headers['x-visitor-id'] || req.body?.visitor_id || '').trim();
    const { session_id, body } = req.body || {};
    if (!session_id || !body || !visitorId) {
      return res.status(400).json({ message: 'session_id, body, visitor_id required' });
    }
    const text = String(body).trim().slice(0, 4000);
    if (!text) return res.status(400).json({ message: 'empty body' });

    // 校验 session 属于该访客（防滥用别人 session）
    const sList = await sb(`chat_sessions?id=eq.${session_id}&visitor_id=eq.${encodeURIComponent(visitorId)}&select=*&limit=1`).catch(() => []);
    if (!sList.length) return res.status(404).json({ message: 'session not found' });
    const session = sList[0];

    const now = new Date().toISOString();
    const inserted = await sb('chat_messages?select=*', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ session_id, sender: 'visitor', body: text }),
    });
    const msg = inserted[0];

    // 更新 session（未读 +1、最后消息时间）
    await sb(`chat_sessions?id=eq.${session_id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        last_message_at: now,
        unread_for_agent: (session.unread_for_agent || 0) + 1,
        updated_at: now,
      }),
    }).catch(() => {});

    // 推送给所有客服 PWA
    const visitorLabel = session.visitor_name || session.visitor_email || '匿名访客';
    pushToAllAgents({
      title: `💬 ${visitorLabel}`,
      body: text.length > 80 ? text.slice(0, 80) + '…' : text,
      url: `/dashboard.html?chat=${session_id}`,
      tag: `chat-${session_id}`,
    }).catch((e) => console.warn('[push] fanout failed:', e.message));

    res.json({ message: msg });
  } catch (e) {
    console.error('chat/visitor/message error:', e.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── 访客侧：轮询新消息（兜底，避免 Realtime 连不上时聊不动）──
app.options('/api/chat/visitor/poll', chatCors, (req, res) => res.status(204).end());
app.get('/api/chat/visitor/poll', chatCors, async (req, res) => {
  try {
    const visitorId = String(req.headers['x-visitor-id'] || req.query.visitor_id || '').trim();
    const { session_id, after } = req.query || {};
    if (!session_id || !visitorId) return res.status(400).json({ message: 'session_id, visitor_id required' });

    // 校验 session 属于该访客
    const sList = await sb(`chat_sessions?id=eq.${session_id}&visitor_id=eq.${encodeURIComponent(visitorId)}&select=id&limit=1`).catch(() => []);
    if (!sList.length) return res.status(404).json({ message: 'session not found' });

    const afterClause = after ? `&created_at=gt.${encodeURIComponent(after)}` : '';
    const msgs = await sb(
      `chat_messages?session_id=eq.${session_id}${afterClause}&select=id,sender,body,created_at&order=created_at.asc&limit=100`
    ).catch(() => []);
    res.json({ messages: msgs });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── 客服侧：会话列表 ───────────────────────────────────────
app.get('/api/chat/sessions', auth, async (req, res) => {
  try {
    const sessions = await sb(
      `chat_sessions?select=*&order=last_message_at.desc&limit=200`
    ).catch(() => []);
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── 客服侧：拉某会话的消息 ─────────────────────────────────
app.get('/api/chat/sessions/:id/messages', auth, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const msgs = await sb(
      `chat_messages?session_id=eq.${sessionId}&select=id,sender,agent_id,body,created_at&order=created_at.asc&limit=500`
    ).catch(() => []);
    // 标记为已读 + 清零未读计数
    await sb(`chat_sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ unread_for_agent: 0, updated_at: new Date().toISOString() }),
    }).catch(() => {});
    res.json({ messages: msgs });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── 客服侧：回消息 ─────────────────────────────────────────
app.post('/api/chat/agent/reply', auth, async (req, res) => {
  try {
    const { session_id, body } = req.body || {};
    if (!session_id || !body) return res.status(400).json({ message: 'session_id, body required' });
    const text = String(body).trim().slice(0, 4000);
    if (!text) return res.status(400).json({ message: 'empty body' });

    const now = new Date().toISOString();
    const inserted = await sb('chat_messages?select=*', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        session_id,
        sender: 'agent',
        agent_id: req.user.user_id || null,
        body: text,
      }),
    });

    await sb(`chat_sessions?id=eq.${session_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ last_message_at: now, updated_at: now }),
    }).catch(() => {});

    res.json({ message: inserted[0] });
  } catch (e) {
    console.error('chat/agent/reply error:', e.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── 客服侧：关闭会话 ───────────────────────────────────────
app.post('/api/chat/sessions/:id/close', auth, async (req, res) => {
  try {
    await sb(`chat_sessions?id=eq.${req.params.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'closed', updated_at: new Date().toISOString() }),
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Web Push：订阅 / 退订 ─────────────────────────────────
app.post('/api/chat/push/subscribe', auth, async (req, res) => {
  try {
    const { endpoint, keys, device_name } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: 'invalid subscription' });
    }
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    // upsert：endpoint 是唯一键
    const existing = await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&select=id&limit=1`).catch(() => []);
    if (existing.length) {
      await sb(`push_subscriptions?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          user_id: req.user.user_id || null,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: ua,
          device_name: device_name || null,
          last_used_at: new Date().toISOString(),
        }),
      });
    } else {
      await sb('push_subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          user_id: req.user.user_id || null,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: ua,
          device_name: device_name || null,
        }),
      });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('push/subscribe error:', e.message);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/chat/push/unsubscribe', auth, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ message: 'endpoint required' });
    await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 测试推送（自己点一下，验证 iPhone 收得到）
app.post('/api/chat/push/test', auth, async (req, res) => {
  try {
    await pushToAllAgents({
      title: '🔔 测试通知',
      body: '如果你在 iPhone 主屏幕看到这条，说明 Web Push 通了',
      url: '/dashboard.html',
      tag: 'test-push',
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── CSV 批量导入：通用（按表名 + 列映射）──
// 前端把 CSV 解析成 rows 后调用此接口
module.exports = app;
