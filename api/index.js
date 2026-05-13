const express    = require('express');
const fetch      = require('node-fetch');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');

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
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ message: 'Username and password required' });
  if (username !== CRM_USER || password !== CRM_PASS)
    return res.status(401).json({ message: 'Invalid credentials' });
  const token = jwt.sign({ username }, SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// DASHBOARD STATS
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
app.get('/api/dashboard/stats', auth, async (req, res) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const year  = new Date().getFullYear().toString();
    const orders = await sb('orders?select=order_date,sales_total,profit,profit_rmb,currency,exchange_rate&is_deleted=eq.false');
    const mO = orders.filter(o => (o.order_date||'').startsWith(month));
    const yO = orders.filter(o => (o.order_date||'').startsWith(year));
    // 全部换算成 RMB 统计
    const salesRmb  = o => Number(o.sales_total||0) * (o.currency==='RMB' ? 1 : (Number(o.exchange_rate)||7.2));
    const profitRmb = o => Number(o.profit_rmb || (o.currency==='RMB' ? Number(o.profit||0) : Number(o.profit||0) * (Number(o.exchange_rate)||7.2)));
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
    const orders = await sb('orders?select=order_date,sales_total,profit,profit_rmb,currency,exchange_rate&is_deleted=eq.false');
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
        const rate = Number(o.exchange_rate)||7.2;
        const sRmb = Number(o.sales_total||0) * (o.currency==='RMB'?1:rate);
        const pRmb = Number(o.profit_rmb || (o.currency==='RMB' ? Number(o.profit||0) : Number(o.profit||0)*rate));
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
    const data = await sb('customers?select=*', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(req.body),
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
    const data = await sb('products?select=*', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(req.body),
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
    const data = await sb('suppliers?select=*', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(req.body),
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
    const data = await sb('inquiries?select=*', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(req.body),
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
  const { limit = 500, offset = 0, q = '', status = '' } = filters;
  let url = 'orders?select=*&is_deleted=eq.false&order=order_date.desc';
  if (q) {
    // PostgREST or() — 模糊搜索客户名 / 订单号 / 备注
    const esc = encodeURIComponent(`%${q}%`);
    url += `&or=(customer_name.ilike.${esc},order_number.ilike.${esc},remarks.ilike.${esc})`;
  }
  if (status) url += `&order_status=eq.${encodeURIComponent(status)}`;
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

app.delete('/api/orders/:id', auth, async (req, res) => {
  try {
    await sb(`orders?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true }) });
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
app.get('/api/documents', auth, async (req, res) => {
  try {
    const data = await sb('documents?select=*&order=created_at.desc');
    res.json(data);
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
          if (messages.length >= 50) break;
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

// 鍚屾宸插彂閫侀偖浠?
app.post('/api/emails/sync-sent', auth, async (req, res) => {
  if (!EMAIL_IMAP_HOST || !EMAIL_USER || !EMAIL_PASS)
    return res.status(503).json({ message: 'Email environment variables are not configured' });

  const client = imapClient();
  let synced = 0;
  const sentFolders = ['Sent', 'Sent Messages', 'INBOX.Sent', 'Sent Items'];
  try {
    await client.connect();
    const list = await client.list();
    const sentFolder = list.find(f => sentFolders.some(n => f.name === n || f.path === n));
    if (!sentFolder) { await client.logout(); return res.json({ success: true, synced: 0, note: '鏈壘鍒板凡鍙戦€佹枃浠跺す' }); }

    const lock = await client.getMailboxLock(sentFolder.path);
    try {
      let lastUid = 0;
      try {
        const rows = await sb(`emails?select=uid&folder=eq.${encodeURIComponent(sentFolder.path)}&order=uid.desc&limit=1`);
        if (rows.length) lastUid = rows[0].uid || 0;
      } catch {}

      const searchCriteria = lastUid ? { uid: `${lastUid + 1}:*` } : { all: true };
      const messages = [];
      for await (const msg of client.fetch(searchCriteria, { uid: true, source: true }, { uid: true })) {
        messages.push({ uid: msg.uid, source: msg.source });
      }
      for (const { uid, source } of messages) {
        try {
          const parsed = await simpleParser(source);
          const from = parsed.from?.value?.[0] || {};
          const toList = (parsed.to?.value || []).map(a => a.address).join(', ');
          const msgId = parsed.messageId || `sent-uid-${uid}-${Date.now()}`;
          await sb('emails?on_conflict=message_id', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=ignore-duplicates' },
            body: JSON.stringify({
              message_id: msgId, folder: sentFolder.path, uid,
              from_address: from.address || '', from_name: from.name || '',
              to_addresses: toList, cc: '',
              subject: parsed.subject || '(鏃犱富棰?',
              body_text: parsed.text || '', body_html: parsed.html || '',
              is_read: true, is_deleted: false,
              received_at: (parsed.date || new Date()).toISOString(),
            }),
          });
          synced++;
        } catch {}
      }
    } finally { lock.release(); }
    await client.logout();
    res.json({ success: true, synced });
  } catch (e) {
    try { await client.logout(); } catch {}
    res.status(500).json({ message: e.message });
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
    const acctFilter = account_id
      ? `&account_id=eq.${account_id}`
      : '&account_id=is.null';
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
app.get('/api/emails/unread-count', auth, async (req, res) => {
  try {
    const data = await sb('emails?is_read=eq.false&is_deleted=eq.false&folder=eq.INBOX&select=id');
    res.json({ count: data.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈹€鈹€ AI 鍔╂墜 鈹€鈹€

// 鑾峰彇 AI 璁剧疆锛堜笉杩斿洖 api_key锛?
app.get('/api/ai/settings', auth, async (req, res) => {
  try {
    const rows = await sb('ai_settings?select=id,provider,model,api_key,system_prompt&order=created_at.desc&limit=1');
    const row = rows[0] || {};
    let apiCfg = {};
    let modelCfg = {};
    try { apiCfg = row.api_key ? JSON.parse(row.api_key) : {}; } catch {}
    try { modelCfg = row.model ? JSON.parse(row.model) : {}; } catch {}

    const openai = {
      api_key: apiCfg.openai?.api_key || (row.provider === 'openai' ? row.api_key : '') || '',
      base_url: apiCfg.openai?.base_url || 'https://api.openai.com/v1',
      model: modelCfg.openai?.model || (row.provider === 'openai' ? row.model : '') || 'gpt-4.1-mini'
    };
    const gemini = {
      api_key: apiCfg.gemini?.api_key || (row.provider === 'gemini' ? row.api_key : '') || '',
      base_url: apiCfg.gemini?.base_url || 'https://generativelanguage.googleapis.com/v1beta',
      model: modelCfg.gemini?.model || (row.provider === 'gemini' ? row.model : '') || 'gemini-2.0-flash'
    };

    res.json({
      openai_configured: !!openai.api_key,
      openai_base_url: openai.base_url,
      openai_model: openai.model,
      gemini_configured: !!gemini.api_key,
      gemini_base_url: gemini.base_url,
      gemini_model: gemini.model,
      system_prompt: row.system_prompt || ''
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/ai/settings/status', auth, async (req, res) => {
  try {
    const rows = await sb('ai_settings?select=id,provider,model,api_key,system_prompt&order=created_at.desc&limit=1');
    const row = rows[0] || {};
    let apiCfg = {};
    try { apiCfg = row.api_key ? JSON.parse(row.api_key) : {}; } catch {}
    const openaiConfigured = !!(apiCfg.openai?.api_key || (row.provider === 'openai' && row.api_key));
    const geminiConfigured = !!(apiCfg.gemini?.api_key || (row.provider === 'gemini' && row.api_key));
    res.json({ configured: openaiConfigured || geminiConfigured, openai_configured: openaiConfigured, gemini_configured: geminiConfigured });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/ai/settings', auth, async (req, res) => {
  try {
    const payload = req.body || {};
    const existing = await sb('ai_settings?select=id,provider,model,api_key,system_prompt&limit=1');
    const row = existing[0] || {};

    let apiCfg = {};
    let modelCfg = {};
    try { apiCfg = row.api_key ? JSON.parse(row.api_key) : {}; } catch {}
    try { modelCfg = row.model ? JSON.parse(row.model) : {}; } catch {}

    const nextApi = {
      openai: {
        api_key: payload.openai_api_key || apiCfg.openai?.api_key || (row.provider === 'openai' ? row.api_key : '') || '',
        base_url: payload.openai_base_url || apiCfg.openai?.base_url || 'https://api.openai.com/v1'
      },
      gemini: {
        api_key: payload.gemini_api_key || apiCfg.gemini?.api_key || (row.provider === 'gemini' ? row.api_key : '') || '',
        base_url: payload.gemini_base_url || apiCfg.gemini?.base_url || 'https://generativelanguage.googleapis.com/v1beta'
      }
    };
    const nextModel = {
      openai: { model: payload.openai_model || modelCfg.openai?.model || 'gpt-4.1-mini' },
      gemini: { model: payload.gemini_model || modelCfg.gemini?.model || 'gemini-2.0-flash' }
    };

    const dbRow = { provider: 'openai', api_key: JSON.stringify(nextApi), model: JSON.stringify(nextModel), system_prompt: payload.system_prompt ?? row.system_prompt ?? '' };
    if (existing.length) await sb('ai_settings?id=eq.' + existing[0].id, { method: 'PATCH', body: JSON.stringify(dbRow) });
    else await sb('ai_settings', { method: 'POST', body: JSON.stringify(dbRow) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/ai/chat', auth, async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!messages?.length) return res.status(400).json({ message: 'Message is required' });

    const rows = await sb('ai_settings?select=id,provider,model,api_key,system_prompt&order=created_at.desc&limit=1');
    const row = rows[0] || {};
    let apiCfg = {};
    let modelCfg = {};
    try { apiCfg = row.api_key ? JSON.parse(row.api_key) : {}; } catch {}
    try { modelCfg = row.model ? JSON.parse(row.model) : {}; } catch {}

    const apiKey = process.env.OPENAI_API_KEY || apiCfg.openai?.api_key || (row.provider === 'openai' ? row.api_key : '');
    const base = (process.env.OPENAI_BASE_URL || apiCfg.openai?.base_url || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = process.env.OPENAI_MODEL || modelCfg.openai?.model || (row.provider === 'openai' ? row.model : '') || 'gpt-4.1-mini';
    if (!apiKey) return res.status(400).json({ message: 'Please set OpenAI API key in AI settings' });

    const full = [];
    if (row.system_prompt) full.push({ role: 'system', content: row.system_prompt });
    full.push(...messages);

    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: full, max_tokens: 2000 })
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ message: d.error?.message || d.message || 'GPT request failed' });
    const reply = d?.choices?.[0]?.message?.content;
    if (!reply) return res.status(500).json({ message: 'Empty GPT response' });
    res.json({ success: true, reply });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/ai/image', auth, async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ message: 'Please provide image prompt' });

    const rows = await sb('ai_settings?select=id,provider,model,api_key,system_prompt&order=created_at.desc&limit=1');
    const row = rows[0] || {};
    let apiCfg = {};
    let modelCfg = {};
    try { apiCfg = row.api_key ? JSON.parse(row.api_key) : {}; } catch {}
    try { modelCfg = row.model ? JSON.parse(row.model) : {}; } catch {}

    const apiKey = process.env.GEMINI_API_KEY || apiCfg.gemini?.api_key || (row.provider === 'gemini' ? row.api_key : '');
    const base = (process.env.GEMINI_BASE_URL || apiCfg.gemini?.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const model = process.env.GEMINI_IMAGE_MODEL || modelCfg.gemini?.model || (row.provider === 'gemini' ? row.model : '') || 'gemini-2.0-flash';
    if (!apiKey) return res.status(400).json({ message: 'Please set Gemini API key in AI settings' });

    if (base.includes('generativelanguage.googleapis.com')) {
      const rr = await fetch(base + '/models/' + model + ':generateContent?key=' + apiKey, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Generate an image: ' + prompt }] }] })
      });
      const dd = await rr.json();
      if (!rr.ok) return res.status(500).json({ message: dd.error?.message || dd.message || 'Gemini request failed' });
      const parts = dd?.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find(p => p.inlineData && p.inlineData.data);
      if (!imagePart) return res.status(500).json({ message: 'No image returned by Gemini' });
      return res.json({ success: true, image: 'data:' + (imagePart.inlineData.mimeType || 'image/png') + ';base64,' + imagePart.inlineData.data });
    }

    const rr = await fetch(base + '/images/generations', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: '1024x1024' })
    });
    const dd = await rr.json();
    if (!rr.ok) return res.status(500).json({ message: dd.error?.message || dd.message || 'Proxy image request failed' });
    if (dd?.data?.[0]?.b64_json) return res.json({ success: true, image: 'data:image/png;base64,' + dd.data[0].b64_json });
    if (dd?.data?.[0]?.url) return res.json({ success: true, image: dd.data[0].url });
    return res.status(500).json({ message: 'No image returned by proxy' });
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
    const data = await sb('logistics?select=id', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        order_id: order_id || null, order_name: order_name || '',
        tracking_number: tracking_number || '', carrier: carrier || '',
        weight: weight || null, volume: volume || null,
        shipping_date: shipping_date || null, estimated_arrival: estimated_arrival || null,
        notes: notes || '',
        shipment_items: Array.isArray(shipment_items) ? shipment_items : [],
      }),
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
app.get('/api/password-vault/security/status', auth, async (req, res) => {
  try {
    const username = encodeURIComponent(req.user.username || CRM_USER);
    const rows = await sb(`vault_security?username=eq.${username}&select=username&limit=1`);
    res.json({ configured: rows.length > 0 });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

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
      order_status, remarks, items
    } = req.body;
    const itemList = Array.isArray(items) ? items : [];
    const totals = await recalcOrderTotals(itemList, shipping_fee, exchange_rate);
    const orderNumber = await genOrderNumber();

    const orderArr = await sb('orders?select=id', {
      method:'POST', headers:{ 'Prefer':'return=representation' },
      body: JSON.stringify({
        order_number: orderNumber,
        customer_name, customer_id: customer_id || null,
        order_date: order_date || new Date().toISOString().slice(0,10),
        shipping_fee: Number(shipping_fee||0),
        currency: currency || 'USD',
        exchange_rate: Number(exchange_rate || 7.2),
        order_status: order_status || 'confirmed',
        remarks: remarks || '',
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
      order_status, remarks, items
    } = req.body;
    const itemList = Array.isArray(items) ? items : [];
    const totals = await recalcOrderTotals(itemList, shipping_fee, exchange_rate);

    await sb(`orders?id=eq.${orderId}`, {
      method:'PATCH',
      body: JSON.stringify({
        customer_name, customer_id: customer_id || null,
        order_date, shipping_fee: Number(shipping_fee||0),
        currency: currency || 'USD',
        exchange_rate: Number(exchange_rate || 7.2),
        order_status: order_status || 'confirmed',
        remarks: remarks || '',
        ...totals,
        updated_at: new Date().toISOString(),
      }),
    });

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

module.exports = app;
