const express = require('express');
const path = require('path');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { initDatabase, queryAll, queryOne, runSql, saveDb, backupDb } = require('./database');
const { authMiddleware, registerUser, loginUser, generateToken, hashPassword, verifyPassword } = require('./auth');

const JWT_SECRET = process.env.JWT_SECRET || 'food-tracker-secret-key-change-in-production';
const app = express();
const PORT = process.env.PORT || 3000;

// ==================== SSE REAL-TIME ====================
const sseClients = new Map(); // userId -> Set of response objects

function addSSEClient(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);
}

function removeSSEClient(userId, res) {
  if (sseClients.has(userId)) {
    sseClients.get(userId).delete(res);
    if (sseClients.get(userId).size === 0) sseClients.delete(userId);
  }
}

function broadcastSSE(event, data, excludeUserId = null) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [userId, clients] of sseClients) {
    if (excludeUserId && userId === excludeUserId) continue;
    for (const res of clients) {
      try { res.write(msg); } catch(e) { /* client disconnected */ }
    }
  }
}

function sendSSEToUser(userId, event, data) {
  if (!sseClients.has(userId)) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients.get(userId)) {
    try { res.write(msg); } catch(e) { /* client disconnected */ }
  }
}

function broadcastSSEToAll(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [userId, clients] of sseClients) {
    for (const res of clients) {
      try { res.write(msg); } catch(e) {}
    }
  }
}

// ==================== MIDDLEWARE ====================
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
    const fs = require('fs');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `receipt_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype) || file.mimetype === 'image/heic';
    cb(null, ext || mime);
  }
});

// ==================== SSE ENDPOINT ====================
app.get('/api/sse', (req, res) => {
  // Auth via query param or cookie
  const token = req.query.token || req.cookies?.token;
  if (!token) return res.status(401).end();

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch(e) {
    return res.status(401).end();
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send heartbeat immediately
  res.write(`event: connected\ndata: {"userId":${decoded.id}}\n\n`);

  addSSEClient(decoded.id, res);

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    try { res.write(`event: ping\ndata: {}\n\n`); } catch(e) { clearInterval(heartbeat); }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSSEClient(decoded.id, res);
  });
});

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password, display_name } = req.body;
    if (!username || !password || !display_name) {
      return res.status(400).json({ error: 'All fields are required / 所有字段必填' });
    }
    if (username.length < 2) return res.status(400).json({ error: 'Username too short / 用户名太短' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters / 密码至少4位' });
    if (display_name.length < 1) return res.status(400).json({ error: 'Display name required / 显示名必填' });

    const user = registerUser(username, password, display_name);
    const token = generateToken(user);
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

    // Log activity
    runSql('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
      [user.id, 'registered a new account', JSON.stringify({ display_name })]);

    // Broadcast new user
    broadcastSSEToAll('user_joined', { user });

    res.json({ user, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const user = loginUser(username, password);
    const token = generateToken(user);
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    res.json({ user, token });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = queryOne('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?', [req.user.id]);
  res.json({ user });
});

// ==================== PROFILE ====================

app.patch('/api/auth/profile', authMiddleware, (req, res) => {
  try {
    const { display_name, avatar_color, current_password, new_password } = req.body;
    const user = queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);

    if (display_name) {
      runSql('UPDATE users SET display_name = ? WHERE id = ?', [display_name, req.user.id]);
    }
    if (avatar_color) {
      runSql('UPDATE users SET avatar_color = ? WHERE id = ?', [avatar_color, req.user.id]);
    }
    if (new_password) {
      if (!current_password || !verifyPassword(current_password, user.password_hash)) {
        return res.status(400).json({ error: 'Current password incorrect / 当前密码不正确' });
      }
      const hash = hashPassword(new_password);
      runSql('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    }

    const updated = queryOne('SELECT id, username, display_name, avatar_color FROM users WHERE id = ?', [req.user.id]);
    const token = generateToken(updated);
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    res.json({ user: updated, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== USERS ROUTE ====================

app.get('/api/users', authMiddleware, (req, res) => {
  const users = queryAll('SELECT id, username, display_name, avatar_color FROM users');
  res.json({ users });
});

// ==================== CLAIMS ROUTES ====================

const CLAIM_SELECT = `
  SELECT c.*,
    s.display_name as submitter_name, s.avatar_color as submitter_color,
    t.display_name as target_name, t.avatar_color as target_color
  FROM claims c
  JOIN users s ON c.submitter_id = s.id
  JOIN users t ON c.target_id = t.id
`;

// Create new claim
app.post('/api/claims', authMiddleware, upload.single('receipt'), (req, res) => {
  try {
    const { target_id, amount, currency, food_description, restaurant, notes, category } = req.body;
    if (!target_id || !amount || !food_description) {
      return res.status(400).json({ error: 'Target user, amount and food description are required' });
    }
    if (parseInt(target_id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot submit a claim to yourself / 不能向自己提交账单' });
    }
    if (parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0 / 金额必须大于0' });
    }

    const receiptPath = req.file ? `/uploads/${req.file.filename}` : null;
    const result = runSql(
      `INSERT INTO claims (submitter_id, target_id, amount, currency, food_description, restaurant, receipt_photo, notes, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, parseInt(target_id), parseFloat(amount), currency || 'MYR', food_description, restaurant || null, receiptPath, notes || null, category || 'meal']
    );

    // Log activity
    const targetUser = queryOne('SELECT display_name FROM users WHERE id = ?', [parseInt(target_id)]);
    runSql(
      'INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
      [req.user.id, `submitted a claim to ${targetUser?.display_name || 'user'} for ${food_description}`,
       JSON.stringify({ food_description, amount: parseFloat(amount), currency: currency || 'MYR', target_user: targetUser?.display_name, category: category || 'meal' })]
    );

    // Notification
    runSql('INSERT INTO notifications (user_id, message) VALUES (?, ?)',
      [parseInt(target_id), `${req.user.display_name} submitted a claim of ${currency || 'MYR'} ${parseFloat(amount).toFixed(2)} for "${food_description}"`]);

    const claim = queryOne(`${CLAIM_SELECT} WHERE c.id = ?`, [result.lastInsertRowid]);

    // SSE push to everyone
    broadcastSSEToAll('claim_created', { claim });
    sendSSEToUser(parseInt(target_id), 'notification', {
      message: `${req.user.display_name} submitted a claim of ${currency || 'MYR'} ${parseFloat(amount).toFixed(2)} for "${food_description}"`
    });

    res.json({ claim });
  } catch (err) {
    console.error('Error creating claim:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all claims
app.get('/api/claims', authMiddleware, (req, res) => {
  try {
    const { status, search, category } = req.query;
    let query = `${CLAIM_SELECT} WHERE 1=1`;
    const params = [];

    if (status) { query += ' AND c.status = ?'; params.push(status); }
    if (category) { query += ' AND c.category = ?'; params.push(category); }
    if (search) {
      query += ' AND (c.food_description LIKE ? OR c.restaurant LIKE ? OR s.display_name LIKE ? OR t.display_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    query += ' ORDER BY c.submitted_at DESC';
    const claims = queryAll(query, params);
    res.json({ claims });
  } catch (err) {
    console.error('Error getting claims:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get single claim detail
app.get('/api/claims/:id', authMiddleware, (req, res) => {
  try {
    const claim = queryOne(`${CLAIM_SELECT} WHERE c.id = ?`, [parseInt(req.params.id)]);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    res.json({ claim });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve or reject claim
app.patch('/api/claims/:id/review', authMiddleware, (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }
    const claim = queryOne('SELECT * FROM claims WHERE id = ?', [parseInt(req.params.id)]);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (claim.target_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the target user can approve/reject / 只有被请求的人可以审批' });
    }
    if (claim.status !== 'pending') {
      return res.status(400).json({ error: 'Already reviewed / 已经审批过了' });
    }

    runSql('UPDATE claims SET status = ?, reviewed_at = datetime("now") WHERE id = ?',
      [status, parseInt(req.params.id)]);

    const submitterUser = queryOne('SELECT display_name FROM users WHERE id = ?', [claim.submitter_id]);
    runSql('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
      [req.user.id, `${status} a claim from ${submitterUser?.display_name || 'user'} for ${claim.food_description}`,
       JSON.stringify({ food_description: claim.food_description, amount: claim.amount, currency: claim.currency, review_status: status })]);

    const statusMsg = status === 'approved' ? 'approved' : 'rejected';
    runSql('INSERT INTO notifications (user_id, message) VALUES (?, ?)',
      [claim.submitter_id, `${req.user.display_name} ${statusMsg} your claim of ${claim.currency} ${claim.amount.toFixed(2)} for "${claim.food_description}"`]);

    const updated = queryOne(`${CLAIM_SELECT} WHERE c.id = ?`, [parseInt(req.params.id)]);

    broadcastSSEToAll('claim_updated', { claim: updated });
    sendSSEToUser(claim.submitter_id, 'notification', {
      message: `${req.user.display_name} ${statusMsg} your claim of ${claim.currency} ${claim.amount.toFixed(2)}`
    });

    res.json({ claim: updated });
  } catch (err) {
    console.error('Error reviewing claim:', err);
    res.status(500).json({ error: err.message });
  }
});

// Mark claim as paid
app.patch('/api/claims/:id/pay', authMiddleware, (req, res) => {
  try {
    const { payment_method } = req.body;
    if (!payment_method) return res.status(400).json({ error: 'Payment method required / 请选择支付方式' });

    const claim = queryOne('SELECT * FROM claims WHERE id = ?', [parseInt(req.params.id)]);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (claim.target_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the target user can mark as paid / 只有被请求的人可以标记已付款' });
    }
    if (claim.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved claims can be paid / 只有已批准的账单才能付款' });
    }

    runSql('UPDATE claims SET status = ?, payment_method = ?, paid_at = datetime("now") WHERE id = ?',
      ['paid', payment_method, parseInt(req.params.id)]);

    const submitterUser = queryOne('SELECT display_name FROM users WHERE id = ?', [claim.submitter_id]);
    runSql('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
      [req.user.id, `paid ${submitterUser?.display_name || 'user'} for ${claim.food_description} via ${payment_method}`,
       JSON.stringify({ payment_method, amount: claim.amount, currency: claim.currency })]);

    runSql('INSERT INTO notifications (user_id, message) VALUES (?, ?)',
      [claim.submitter_id, `${req.user.display_name} paid ${claim.currency} ${claim.amount.toFixed(2)} via ${payment_method} for "${claim.food_description}"`]);

    const updated = queryOne(`${CLAIM_SELECT} WHERE c.id = ?`, [parseInt(req.params.id)]);

    broadcastSSEToAll('claim_updated', { claim: updated });
    sendSSEToUser(claim.submitter_id, 'notification', {
      message: `${req.user.display_name} paid ${claim.currency} ${claim.amount.toFixed(2)} via ${payment_method}`
    });

    res.json({ claim: updated });
  } catch (err) {
    console.error('Error marking paid:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete claim
app.delete('/api/claims/:id', authMiddleware, (req, res) => {
  try {
    const claim = queryOne('SELECT * FROM claims WHERE id = ?', [parseInt(req.params.id)]);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (claim.submitter_id !== req.user.id) {
      return res.status(403).json({ error: 'Only submitter can delete / 只有提交者可以删除' });
    }
    if (claim.status === 'paid') {
      return res.status(400).json({ error: 'Cannot delete paid claim / 已付款的不能删除' });
    }

    runSql('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
      [req.user.id, `deleted claim for ${claim.food_description}`,
       JSON.stringify({ amount: claim.amount, currency: claim.currency })]);

    runSql('DELETE FROM claims WHERE id = ?', [parseInt(req.params.id)]);

    broadcastSSEToAll('claim_deleted', { claimId: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting claim:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== STATS ====================

app.get('/api/stats', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;

    const iOwe = queryOne(
      `SELECT COALESCE(SUM(amount), 0) as total FROM claims WHERE target_id = ? AND status IN ('approved','paid')`, [userId]);
    const owedToMe = queryOne(
      `SELECT COALESCE(SUM(amount), 0) as total FROM claims WHERE submitter_id = ? AND status IN ('approved','paid')`, [userId]);
    const pendingReview = queryOne(
      `SELECT COUNT(*) as count FROM claims WHERE target_id = ? AND status = 'pending'`, [userId]);
    const myPending = queryOne(
      `SELECT COUNT(*) as count FROM claims WHERE submitter_id = ? AND status = 'pending'`, [userId]);
    const totalPaid = queryOne(
      `SELECT COALESCE(SUM(amount), 0) as total FROM claims WHERE target_id = ? AND status = 'paid'`, [userId]);
    const totalReceived = queryOne(
      `SELECT COALESCE(SUM(amount), 0) as total FROM claims WHERE submitter_id = ? AND status = 'paid'`, [userId]);

    const monthly = queryAll(
      `SELECT strftime('%Y-%m', submitted_at) as month,
        SUM(CASE WHEN submitter_id = ? THEN amount ELSE 0 END) as claimed,
        SUM(CASE WHEN target_id = ? THEN amount ELSE 0 END) as owed
      FROM claims WHERE status IN ('approved','paid')
      AND submitted_at >= date('now', '-6 months')
      GROUP BY month ORDER BY month`, [userId, userId]);

    const balances = queryAll(
      `SELECT u.id, u.display_name, u.avatar_color,
        COALESCE(SUM(CASE WHEN c.submitter_id = ? AND c.target_id = u.id THEN c.amount ELSE 0 END), 0) as they_owe_me,
        COALESCE(SUM(CASE WHEN c.target_id = ? AND c.submitter_id = u.id THEN c.amount ELSE 0 END), 0) as i_owe_them
      FROM users u
      LEFT JOIN claims c ON (
        (c.submitter_id = ? AND c.target_id = u.id) OR
        (c.target_id = ? AND c.submitter_id = u.id)
      ) AND c.status IN ('approved','paid')
      WHERE u.id != ?
      GROUP BY u.id`, [userId, userId, userId, userId, userId]);

    // Category breakdown
    const categories = queryAll(
      `SELECT category, COUNT(*) as count, SUM(amount) as total
      FROM claims WHERE (submitter_id = ? OR target_id = ?) AND status IN ('approved','paid')
      GROUP BY category`, [userId, userId]);

    res.json({
      total_owed_to_me: owedToMe.total,
      total_i_owe: iOwe.total,
      net_balance: owedToMe.total - iOwe.total,
      total_paid: totalPaid.total,
      total_received: totalReceived.total,
      pending_review: pendingReview.count,
      my_pending: myPending.count,
      monthly,
      categories,
      balances: balances.map(b => ({
        ...b,
        net: b.they_owe_me - b.i_owe_them
      }))
    });
  } catch (err) {
    console.error('Error getting stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== SETTLEMENT CALCULATOR ====================

app.get('/api/settlement', authMiddleware, (req, res) => {
  try {
    // Calculate net balances between all pairs (only approved, not yet paid)
    const debts = queryAll(
      `SELECT c.submitter_id, s.display_name as creditor_name,
              c.target_id, t.display_name as debtor_name,
              SUM(c.amount) as total
       FROM claims c
       JOIN users s ON c.submitter_id = s.id
       JOIN users t ON c.target_id = t.id
       WHERE c.status = 'approved'
       GROUP BY c.submitter_id, c.target_id`
    );

    // Build net balance map
    const netMap = {};
    const users = queryAll('SELECT id, display_name, avatar_color FROM users');
    users.forEach(u => { netMap[u.id] = { ...u, balance: 0 }; });

    debts.forEach(d => {
      netMap[d.submitter_id].balance += d.total;  // creditor gets money
      netMap[d.target_id].balance -= d.total;       // debtor owes money
    });

    // Greedy settlement algorithm
    const settlements = [];
    const positive = []; // people who are owed
    const negative = []; // people who owe

    Object.values(netMap).forEach(u => {
      if (u.balance > 0.01) positive.push({ ...u });
      else if (u.balance < -0.01) negative.push({ ...u, balance: Math.abs(u.balance) });
    });

    positive.sort((a, b) => b.balance - a.balance);
    negative.sort((a, b) => b.balance - a.balance);

    let i = 0, j = 0;
    while (i < positive.length && j < negative.length) {
      const amount = Math.min(positive[i].balance, negative[j].balance);
      if (amount > 0.01) {
        settlements.push({
          from: { id: negative[j].id, display_name: negative[j].display_name, avatar_color: negative[j].avatar_color },
          to: { id: positive[i].id, display_name: positive[i].display_name, avatar_color: positive[i].avatar_color },
          amount: Math.round(amount * 100) / 100
        });
      }
      positive[i].balance -= amount;
      negative[j].balance -= amount;
      if (positive[i].balance < 0.01) i++;
      if (negative[j].balance < 0.01) j++;
    }

    res.json({ settlements, debts_count: debts.length });
  } catch (err) {
    console.error('Error calculating settlement:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== NOTIFICATIONS ====================

app.get('/api/notifications', authMiddleware, (req, res) => {
  try {
    const notifications = queryAll(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]);
    const unreadCount = queryOne(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      [req.user.id]);
    res.json({ notifications, unread_count: unreadCount?.count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/notifications/read', authMiddleware, (req, res) => {
  try {
    runSql('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ACTIVITY LOG ====================

app.get('/api/activity-log', authMiddleware, (req, res) => {
  try {
    const activities = queryAll(`
      SELECT al.id, al.user_id, al.action, al.details, al.created_at, u.display_name, u.avatar_color
      FROM activity_log al JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC LIMIT 100
    `);
    res.json({ activities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== EXPORT ====================

app.get('/api/export', authMiddleware, (req, res) => {
  try {
    const claims = queryAll(
      `SELECT c.id, c.amount, c.currency, c.food_description, c.restaurant, c.category, c.status, c.submitted_at, c.reviewed_at, c.paid_at, c.notes, c.payment_method,
        s.display_name as submitter, t.display_name as target
      FROM claims c JOIN users s ON c.submitter_id = s.id JOIN users t ON c.target_id = t.id
      WHERE c.submitter_id = ? OR c.target_id = ?
      ORDER BY c.submitted_at DESC`, [req.user.id, req.user.id]);

    const csv = [
      'ID,Submitter,Target,Amount,Currency,Food,Restaurant,Category,Status,Submitted,Reviewed,Paid,Notes,Payment Method',
      ...claims.map(c =>
        `${c.id},"${c.submitter}","${c.target}",${c.amount},${c.currency},"${c.food_description}","${c.restaurant || ''}","${c.category || 'meal'}",${c.status},${c.submitted_at},${c.reviewed_at || ''},${c.paid_at || ''},"${c.notes || ''}","${c.payment_method || ''}"`
      )
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=claims_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n  Food Expense Tracker v2.0`);
      console.log(`  Local:   http://localhost:${PORT}`);
      console.log(`  Network: http://0.0.0.0:${PORT}`);
      console.log(`  Real-time sync: SSE enabled\n`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
