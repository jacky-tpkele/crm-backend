const express = require('express');
const fetch   = require('node-fetch');
const jwt     = require('jsonwebtoken');

const app = express();
app.use(express.json({ limit: '20mb' }));

const SB_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET  = process.env.JWT_SECRET   || 'xhon-crm-secret-2025';
const CRM_USER= process.env.CRM_USERNAME || 'TPKELE';
const CRM_PASS= process.env.CRM_PASSWORD || '662255';

// ── Supabase REST helper ──
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

// ── JWT auth middleware ──
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

// ══════════════════════════════
// AUTH
// ══════════════════════════════
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ message: 'Username and password required' });
  if (username !== CRM_USER || password !== CRM_PASS)
    return res.status(401).json({ message: 'Invalid credentials' });
  const token = jwt.sign({ username }, SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

// ══════════════════════════════
// DASHBOARD STATS
// ══════════════════════════════
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

// ══════════════════════════════
// CUSTOMERS
// ══════════════════════════════
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

// ══════════════════════════════
// PRODUCTS
// ══════════════════════════════
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

// ══════════════════════════════
// SUPPLIERS
// ══════════════════════════════
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

// ══════════════════════════════
// INQUIRIES
// ══════════════════════════════
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

// ══════════════════════════════
// ORDERS
// ══════════════════════════════
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
    await sb(`orders?id=eq.${req.params.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...orderData, updated_at: new Date().toISOString() }),
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/orders/:id', auth, async (req, res) => {
  try {
    await sb(`orders?id=eq.${req.params.id}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true }) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── Backward-compat routes ──
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
    res.json({ success: true, message: '订单保存成功', id: orderId });
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

// ══════════════════════════════
// ANALYTICS
// ══════════════════════════════
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

// ══════════════════════════════
// DOCUMENTS
// ══════════════════════════════
app.get('/api/documents', auth, async (req, res) => {
  try {
    const data = await sb('documents?select=*&order=created_at.desc');
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = app;
