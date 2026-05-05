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
const SECRET  = process.env.JWT_SECRET   || 'xhon-crm-secret-2025';
const CRM_USER= process.env.CRM_USERNAME || 'TPKELE';
const CRM_PASS= process.env.CRM_PASSWORD || '662255';
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
    const orders = await sb('orders?select=order_date,sales_total,profit&is_deleted=eq.false');
    const mO = orders.filter(o => (o.order_date||'').startsWith(month));
    const yO = orders.filter(o => (o.order_date||'').startsWith(year));
    const sum = (arr, f) => arr.reduce((a, o) => a + Number(o[f]||0), 0);
    res.json({
      month_orders:  mO.length,
      year_orders:   yO.length,
      month_sales:   sum(mO, 'sales_total'),
      year_sales:    sum(yO, 'sales_total'),
      month_profit:  sum(mO, 'profit'),
      year_profit:   sum(yO, 'profit'),
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/dashboard/trends', auth, async (req, res) => {
  try {
    const orders = await sb('orders?select=order_date,sales_total,profit&is_deleted=eq.false');
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
        map[m].sales  += Number(o.sales_total||0);
        map[m].profit += Number(o.profit||0);
        map[m].count++;
      }
    });
    res.json({
      labels: months,
      sales:  months.map(m => map[m].sales),
      profit: months.map(m => map[m].profit),
      orders: months.map(m => map[m].count),
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// CUSTOMERS
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
app.get('/api/customers', auth, async (req, res) => {
  try {
    const data = await sb('customers?select=*&is_deleted=eq.false&order=created_at.desc');
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
    const data = await sb('products?select=*&is_deleted=eq.false&order=created_at.desc');
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
    const data = await sb('suppliers?select=*&is_deleted=eq.false&order=created_at.desc');
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

// backward-compat GET /suppliers (old orders.html)
app.get('/suppliers', auth, async (req, res) => {
  try {
    const data = await sb('suppliers?select=*&is_deleted=eq.false&order=created_at.desc');
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/suppliers', auth, async (req, res) => {
  try {
    const { product_image_data, product_name, specification, supplier_name, contact_name, phone } = req.body;
    const data = await sb('suppliers?select=*', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ supplier_name, contact_name, phone, notes: [product_name, specification].filter(Boolean).join(' - '), product_image_data }),
    });
    res.json({ success: true, data: data[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/suppliers/:id', auth, async (req, res) => {
  try {
    await sb(`suppliers?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true }) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
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
async function fetchOrdersWithItems() {
  const orders = await sb('orders?select=*&is_deleted=eq.false&order=order_date.desc');
  if (!orders.length) return orders;
  const ids = orders.map(o => o.id).join(',');
  const items = await sb(`order_items?order_id=in.(${ids})&select=*`);
  return orders.map(o => ({ ...o, items: items.filter(i => i.order_id === o.id) }));
}

app.get('/api/orders', auth, async (req, res) => {
  try { res.json(await fetchOrdersWithItems()); }
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

app.post('/api/orders', auth, async (req, res) => {
  const { customer_name, customer_id, order_date, shipping_fee, currency, order_status, remarks,
          purchase_total, sales_total, sales_without_shipping, profit, items } = req.body;
  try {
    const orderArr = await sb('orders?select=id', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        customer_name, customer_id, order_date,
        shipping_fee:  Number(shipping_fee||0),
        purchase_total: Number(purchase_total||0),
        sales_total:    Number(sales_total||0),
        sales_without_shipping: Number(sales_without_shipping||0),
        profit:         Number(profit||0),
        currency:       currency||'USD',
        order_status:   order_status||'confirmed',
        remarks:        remarks||'',
      }),
    });
    const orderId = orderArr[0].id;
    if (items?.length) {
      await sb('order_items', {
        method: 'POST',
        body: JSON.stringify(items.map(it => ({ ...it, order_id: orderId }))),
      });
    }
    res.json({ success: true, id: orderId });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/orders/:id', auth, async (req, res) => {
  try {
    const { items, ...orderData } = req.body;
    const orderId = req.params.id;
    await sb(`orders?id=eq.${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...orderData, updated_at: new Date().toISOString() }),
    });
    if (items?.length) {
      await sb(`order_items?order_id=eq.${orderId}`, { method: 'DELETE' });
      await sb('order_items', {
        method: 'POST',
        body: JSON.stringify(items.map(it => ({ ...it, order_id: orderId }))),
      });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/orders/:id', auth, async (req, res) => {
  try {
    await sb(`orders?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true }) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 鈹€鈹€ Backward-compat routes 鈹€鈹€
app.post('/api/save-order', auth, async (req, res) => {
  const { customer_name, order_date, shipping_fee, items } = req.body;
  try {
    let pTotal = 0, sTotal = 0;
    (items||[]).forEach(it => {
      const qty = Number(it.qty||it.quantity||0);
      pTotal += qty * Number(it.p_price||it.purchase_price||0);
      sTotal += qty * Number(it.s_price||it.sales_price||0);
    });
    const shipping = Number(shipping_fee||0);
    const orderArr = await sb('orders?select=id', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        customer_name, order_date, shipping_fee: shipping,
        purchase_total: pTotal, sales_total: sTotal + shipping,
        sales_without_shipping: sTotal, profit: sTotal - pTotal, order_status: 'confirmed',
      }),
    });
    const orderId = orderArr[0].id;
    await sb('order_items', {
      method: 'POST',
      body: JSON.stringify((items||[]).map(it => ({
        order_id: orderId,
        product_name_cn: it.cn_name||it.product_name_cn||'',
        product_name_en: it.en_name||it.product_name_en||'',
        specification:   it.specification||'',
        quantity:        Number(it.qty||it.quantity||0),
        purchase_price:  Number(it.p_price||it.purchase_price||0),
        sales_price:     Number(it.s_price||it.sales_price||0),
        purchase_total:  Number(it.qty||it.quantity||0)*Number(it.p_price||it.purchase_price||0),
        sales_total:     Number(it.qty||it.quantity||0)*Number(it.s_price||it.sales_price||0),
      }))),
    });
    res.json({ success: true, message: '璁㈠崟淇濆瓨鎴愬姛', id: orderId });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/orders-full', auth, async (req, res) => {
  try { res.json(await fetchOrdersWithItems()); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/order-detail/:id', auth, async (req, res) => {
  try {
    const [orderArr, items] = await Promise.all([
      sb(`orders?id=eq.${req.params.id}&select=*`),
      sb(`order_items?order_id=eq.${req.params.id}&select=*`),
    ]);
    if (!orderArr.length) return res.status(404).json({ message: 'Not found' });
    res.json({ order: orderArr[0], items });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/orders/:id', auth, async (req, res) => {
  try {
    const { items, ...orderData } = req.body;
    await sb(`orders?id=eq.${req.params.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...orderData, updated_at: new Date().toISOString() }),
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/delete-order/:id', auth, async (req, res) => {
  try {
    await sb(`orders?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true }) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

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
    const { order_id, order_name, tracking_number, carrier, weight, volume, shipping_date, estimated_arrival, notes } = req.body;
    const data = await sb('logistics?select=id', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        order_id: order_id || null, order_name: order_name || '',
        tracking_number: tracking_number || '', carrier: carrier || '',
        weight: weight || null, volume: volume || null,
        shipping_date: shipping_date || null, estimated_arrival: estimated_arrival || null,
        notes: notes || '',
      }),
    });
    res.json({ success: true, id: data[0].id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/logistics/:id', auth, async (req, res) => {
  try {
    const { order_id, order_name, tracking_number, carrier, weight, volume, shipping_date, estimated_arrival, notes } = req.body;
    await sb(`logistics?id=eq.${req.params.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        order_id: order_id || null, order_name: order_name || '',
        tracking_number: tracking_number || '', carrier: carrier || '',
        weight: weight || null, volume: volume || null,
        shipping_date: shipping_date || null, estimated_arrival: estimated_arrival || null,
        notes: notes || '',
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
module.exports = app;




