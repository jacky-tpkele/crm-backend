const express    = require('express');
const fetch      = require('node-fetch');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

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

// ══════════════════════════════
// EMAIL
// ══════════════════════════════
const EMAIL_IMAP_HOST = process.env.EMAIL_IMAP_HOST;
const EMAIL_IMAP_PORT = parseInt(process.env.EMAIL_IMAP_PORT || '993');
const EMAIL_SMTP_HOST = process.env.EMAIL_SMTP_HOST;
const EMAIL_SMTP_PORT = parseInt(process.env.EMAIL_SMTP_PORT || '465');
const EMAIL_USER      = process.env.EMAIL_USER;
const EMAIL_PASS      = process.env.EMAIL_PASS;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'TPKELE';

function imapClient() {
  return new ImapFlow({
    host: EMAIL_IMAP_HOST,
    port: EMAIL_IMAP_PORT,
    secure: EMAIL_IMAP_PORT === 993,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

function smtpTransport() {
  return nodemailer.createTransport({
    host: EMAIL_SMTP_HOST,
    port: EMAIL_SMTP_PORT,
    secure: EMAIL_SMTP_PORT === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    tls: { rejectUnauthorized: false },
  });
}

// 同步收件箱到 Supabase
app.post('/api/emails/sync', auth, async (req, res) => {
  if (!EMAIL_IMAP_HOST || !EMAIL_USER || !EMAIL_PASS)
    return res.status(503).json({ message: '未配置邮箱环境变量' });

  const client = imapClient();
  let synced = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // 查询 Supabase 中已有的最大 uid
      let lastUid = 0;
      try {
        const rows = await sb('emails?select=uid&folder=eq.INBOX&order=uid.desc&limit=1');
        if (rows.length) lastUid = rows[0].uid || 0;
      } catch {}

      // ImapFlow fetch requires string sequence/UID range
      const range = lastUid ? `${lastUid + 1}:*` : '1:*';
      const messages = [];
      try {
        for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
          messages.push({ uid: msg.uid, source: msg.source });
          if (messages.length >= 50) break; // 每次最多同步50封，防止超时
        }
      } catch (fetchErr) {
        // 如果 UID 范围无新邮件，ImapFlow 会抛出异常，忽略即可
        if (!fetchErr.message?.includes('No messages')) throw fetchErr;
      }

      for (const { uid, source } of messages) {
        try {
          const parsed = await simpleParser(source);
          const from = parsed.from?.value?.[0] || {};
          const toList = (parsed.to?.value || []).map(a => a.address).join(', ');
          const ccList = (parsed.cc?.value || []).map(a => a.address).join(', ');
          const msgId = parsed.messageId || `uid-${uid}-${Date.now()}`;

          await sb('emails?on_conflict=message_id', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=ignore-duplicates' },
            body: JSON.stringify({
              message_id:   msgId,
              folder:       'INBOX',
              uid:          uid,
              from_address: from.address || '',
              from_name:    from.name || '',
              to_addresses: toList,
              cc:           ccList,
              subject:      parsed.subject || '(无主题)',
              body_text:    parsed.text || '',
              body_html:    parsed.html || '',
              is_read:      false,
              is_deleted:   false,
              received_at:  (parsed.date || new Date()).toISOString(),
            }),
          });
          synced++;
        } catch (parseErr) {
          console.error('解析邮件失败 uid=' + uid, parseErr.message);
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

// 同步已发送邮件
app.post('/api/emails/sync-sent', auth, async (req, res) => {
  if (!EMAIL_IMAP_HOST || !EMAIL_USER || !EMAIL_PASS)
    return res.status(503).json({ message: '未配置邮箱环境变量' });

  const client = imapClient();
  let synced = 0;
  const sentFolders = ['Sent', 'Sent Messages', 'INBOX.Sent', '已发送'];
  try {
    await client.connect();
    const list = await client.list();
    const sentFolder = list.find(f => sentFolders.some(n => f.name === n || f.path === n));
    if (!sentFolder) { await client.logout(); return res.json({ success: true, synced: 0, note: '未找到已发送文件夹' }); }

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
              subject: parsed.subject || '(无主题)',
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

// 获取邮件列表
app.get('/api/emails', auth, async (req, res) => {
  try {
    const folder = req.query.folder || 'INBOX';
    const page   = Math.max(1, parseInt(req.query.page || '1'));
    const limit  = 50;
    const offset = (page - 1) * limit;
    const folderFilter = folder === 'SENT'
      ? 'folder=neq.INBOX&folder=neq.DRAFTS'
      : `folder=eq.${encodeURIComponent(folder)}`;
    const data = await sb(
      `emails?${folderFilter}&is_deleted=eq.false&order=received_at.desc&limit=${limit}&offset=${offset}&select=id,message_id,folder,from_address,from_name,to_addresses,subject,is_read,received_at`
    );
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 获取单封邮件详情
app.get('/api/emails/:id', auth, async (req, res) => {
  try {
    const rows = await sb(`emails?id=eq.${req.params.id}&select=*`);
    if (!rows.length) return res.status(404).json({ message: '邮件不存在' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 标记已读/未读
app.patch('/api/emails/:id/read', auth, async (req, res) => {
  try {
    const { is_read } = req.body;
    await sb(`emails?id=eq.${req.params.id}`, {
      method: 'PATCH', body: JSON.stringify({ is_read }),
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 删除邮件（软删除）
app.delete('/api/emails/:id', auth, async (req, res) => {
  try {
    await sb(`emails?id=eq.${req.params.id}`, {
      method: 'PATCH', body: JSON.stringify({ is_deleted: true }),
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 发送邮件
app.post('/api/emails/send', auth, async (req, res) => {
  if (!EMAIL_SMTP_HOST || !EMAIL_USER || !EMAIL_PASS)
    return res.status(503).json({ message: '未配置邮箱环境变量' });

  const { to, cc, subject, body_html, body_text } = req.body;
  if (!to || !subject) return res.status(400).json({ message: '收件人和主题不能为空' });

  try {
    const transport = smtpTransport();
    const info = await transport.sendMail({
      from: `"${EMAIL_FROM_NAME}" <${EMAIL_USER}>`,
      to, cc, subject,
      text: body_text || '',
      html: body_html || `<p>${(body_text || '').replace(/\n/g, '<br>')}</p>`,
    });

    // 保存到已发送
    await sb('emails', {
      method: 'POST',
      body: JSON.stringify({
        message_id:   info.messageId || `sent-${Date.now()}`,
        folder:       'SENT',
        from_address: EMAIL_USER,
        from_name:    EMAIL_FROM_NAME,
        to_addresses: to,
        cc:           cc || '',
        subject,
        body_text:    body_text || '',
        body_html:    body_html || '',
        is_read:      true,
        is_deleted:   false,
        received_at:  new Date().toISOString(),
      }),
    });

    res.json({ success: true, messageId: info.messageId });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// 获取未读数量
app.get('/api/emails/unread-count', auth, async (req, res) => {
  try {
    const data = await sb('emails?is_read=eq.false&is_deleted=eq.false&folder=eq.INBOX&select=id');
    res.json({ count: data.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = app;
