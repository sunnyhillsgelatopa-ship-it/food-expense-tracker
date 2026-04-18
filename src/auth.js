const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { queryOne, runSql } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'food-tracker-secret-key-change-in-production';
const TOKEN_EXPIRY = '7d';

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, display_name: user.display_name },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function registerUser(username, password, displayName) {
  const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) throw new Error('Username already taken');
  const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const hash = hashPassword(password);
  const result = runSql(
    'INSERT INTO users (username, password_hash, display_name, avatar_color) VALUES (?, ?, ?, ?)',
    [username, hash, displayName, color]
  );
  return { id: result.lastInsertRowid, username, display_name: displayName, avatar_color: color };
}

function loginUser(username, password) {
  const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new Error('Invalid username or password');
  }
  return { id: user.id, username: user.username, display_name: user.display_name, avatar_color: user.avatar_color };
}

module.exports = { authMiddleware, registerUser, loginUser, generateToken, hashPassword, verifyPassword };
