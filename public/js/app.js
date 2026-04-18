// ==================== STATE ====================
let currentUser = null;
let authToken = null;
let users = [];
let claims = [];
let currentFilter = '';
let currentSearch = '';
let activeSection = 'claims';
let sseSource = null;
let payingClaimId = null;
let selectedPayment = null;

const CATEGORIES = ['meal','drinks','snack','dessert','groceries','other'];
const CAT_EMOJIS = { meal:'🍚', drinks:'🧋', snack:'🍿', dessert:'🍰', groceries:'🛒', other:'📦' };
const PAYMENT_METHODS = ["Touch 'n Go", 'GrabPay', 'Bank Transfer', 'Boost', 'ShopeePay', 'Cash'];
const AVATAR_COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6','#f97316','#06b6d4'];

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  authToken = localStorage.getItem('token');
  if (authToken) {
    checkAuth();
  } else {
    showAuth('login');
  }
});

// ==================== API HELPERS ====================
async function api(url, options = {}) {
  const headers = { ...options.headers };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ==================== AUTH ====================
let authMode = 'login';

function showAuth(mode) {
  authMode = mode;
  document.getElementById('auth-page').style.display = 'flex';
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('display-name-group').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('auth-error').textContent = '';
  updateI18N();

  document.getElementById('auth-title').textContent = t('app_title');
  document.getElementById('auth-subtitle').textContent = t('app_subtitle');
  document.getElementById('auth-submit-btn').textContent = mode === 'login' ? t('login_btn') : t('register_btn');
  document.getElementById('auth-switch').innerHTML = mode === 'login'
    ? `${t('no_account')} <a onclick="showAuth('register')">${t('register')}</a>`
    : `${t('have_account')} <a onclick="showAuth('login')">${t('login')}</a>`;
}

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const display_name = document.getElementById('auth-display-name').value.trim();
  const errEl = document.getElementById('auth-error');

  try {
    let data;
    if (authMode === 'login') {
      data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    } else {
      if (!display_name) { errEl.textContent = t('display_name') + ' required'; return; }
      data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password, display_name }) });
    }
    authToken = data.token;
    localStorage.setItem('token', authToken);
    currentUser = data.user;
    showMainApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

async function checkAuth() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
    showMainApp();
  } catch {
    localStorage.removeItem('token');
    authToken = null;
    showAuth('login');
  }
}

// ==================== MAIN APP ====================
function showMainApp() {
  document.getElementById('auth-page').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  buildBottomNav();
  updateI18N();
  connectSSE();
  loadUsers();
  loadClaims();
  loadNotifications();
  switchSection('claims');
}

// ==================== SSE REAL-TIME ====================
function connectSSE() {
  if (sseSource) sseSource.close();

  sseSource = new EventSource(`/api/sse?token=${authToken}`);
  const dot = document.getElementById('sse-dot');
  const text = document.getElementById('sse-text');

  sseSource.addEventListener('connected', () => {
    dot.classList.remove('offline');
    text.textContent = t('realtime_connected');
  });

  sseSource.addEventListener('ping', () => {
    // Keep alive
  });

  sseSource.addEventListener('claim_created', (e) => {
    const { claim } = JSON.parse(e.data);
    // Add to local list if not already there
    if (!claims.find(c => c.id === claim.id)) {
      claims.unshift(claim);
      renderClaims();
    }
    if (activeSection === 'stats') loadStats();
  });

  sseSource.addEventListener('claim_updated', (e) => {
    const { claim } = JSON.parse(e.data);
    const idx = claims.findIndex(c => c.id === claim.id);
    if (idx >= 0) claims[idx] = claim;
    else claims.unshift(claim);
    renderClaims();
    if (activeSection === 'stats') loadStats();
    if (activeSection === 'settlement') loadSettlement();
  });

  sseSource.addEventListener('claim_deleted', (e) => {
    const { claimId } = JSON.parse(e.data);
    claims = claims.filter(c => c.id !== claimId);
    renderClaims();
    if (activeSection === 'stats') loadStats();
  });

  sseSource.addEventListener('notification', (e) => {
    const { message } = JSON.parse(e.data);
    showToast(message, 'info');
    loadNotifications();
  });

  sseSource.addEventListener('user_joined', () => {
    loadUsers();
  });

  sseSource.onerror = () => {
    dot.classList.add('offline');
    text.textContent = t('realtime_disconnected');
    // Auto reconnect is built into EventSource
  };
}

// ==================== NAVIGATION ====================
const NAV_ITEMS = [
  { id: 'claims', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>', label: 'nav_claims' },
  { id: 'stats', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>', label: 'nav_stats' },
  { id: 'settlement', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2"/><path d="M12 6v6l4 2"/></svg>', label: 'nav_settlement' },
  { id: 'activity', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>', label: 'nav_activity' },
  { id: 'profile', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>', label: 'nav_profile' },
];

function buildBottomNav() {
  const nav = document.getElementById('bottom-nav');
  nav.innerHTML = NAV_ITEMS.map(item =>
    `<button class="nav-item ${item.id === activeSection ? 'active' : ''}" onclick="switchSection('${item.id}')">
      ${item.icon}<span data-i18n="${item.label}">${t(item.label)}</span>
    </button>`
  ).join('');
}

function switchSection(id) {
  activeSection = id;
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${id}`).classList.add('active');
  buildBottomNav();
  document.getElementById('fab-new').style.display = id === 'claims' ? 'flex' : 'none';

  if (id === 'stats') loadStats();
  if (id === 'activity') loadActivity();
  if (id === 'settlement') loadSettlement();
  if (id === 'profile') renderProfile();
}

// ==================== DATA LOADING ====================
async function loadUsers() {
  try {
    const data = await api('/api/users');
    users = data.users;
  } catch (err) { console.error(err); }
}

async function loadClaims() {
  try {
    const data = await api('/api/claims');
    claims = data.claims;
    renderClaims();
  } catch (err) { console.error(err); }
}

async function loadStats() {
  try {
    const data = await api('/api/stats');
    renderStats(data);
  } catch (err) { console.error(err); }
}

async function loadActivity() {
  try {
    const data = await api('/api/activity-log');
    renderActivity(data.activities);
  } catch (err) { console.error(err); }
}

async function loadSettlement() {
  try {
    const data = await api('/api/settlement');
    renderSettlement(data);
  } catch (err) { console.error(err); }
}

async function loadNotifications() {
  try {
    const data = await api('/api/notifications');
    renderNotifications(data);
  } catch (err) { console.error(err); }
}

// ==================== RENDER CLAIMS ====================
function renderFilterTabs() {
  const tabs = document.getElementById('filter-tabs');
  const filters = [
    { key: '', label: 'all' },
    { key: 'pending', label: 'pending' },
    { key: 'approved', label: 'approved' },
    { key: 'paid', label: 'paid' },
    { key: 'rejected', label: 'rejected' },
  ];
  tabs.innerHTML = filters.map(f =>
    `<button class="filter-tab ${currentFilter === f.key ? 'active' : ''}"
      onclick="setFilter('${f.key}')">${t(f.label)}</button>`
  ).join('');
}

function setFilter(f) { currentFilter = f; renderClaims(); }

function renderClaims() {
  renderFilterTabs();
  const list = document.getElementById('claims-list');
  let filtered = claims;
  if (currentFilter) filtered = filtered.filter(c => c.status === currentFilter);
  if (currentSearch) {
    const s = currentSearch.toLowerCase();
    filtered = filtered.filter(c =>
      c.food_description?.toLowerCase().includes(s) ||
      c.restaurant?.toLowerCase().includes(s) ||
      c.submitter_name?.toLowerCase().includes(s) ||
      c.target_name?.toLowerCase().includes(s)
    );
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>${t('no_claims')}</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(c => {
    const isSubmitter = c.submitter_id === currentUser.id;
    const isTarget = c.target_id === currentUser.id;
    const catEmoji = CAT_EMOJIS[c.category] || '📦';
    const catLabel = t(`cat_${c.category}`) || c.category;

    let actions = '';
    if (isTarget && c.status === 'pending') {
      actions = `
        <button class="btn btn-xs btn-success" onclick="reviewClaim(${c.id},'approved')">✓ ${t('approve')}</button>
        <button class="btn btn-xs btn-danger" onclick="reviewClaim(${c.id},'rejected')">✗ ${t('reject')}</button>`;
    }
    if (isTarget && c.status === 'approved') {
      actions = `<button class="btn btn-xs btn-primary" onclick="openPayModal(${c.id})">💰 ${t('mark_paid')}</button>`;
    }
    if (isSubmitter && c.status !== 'paid') {
      actions += `<button class="btn btn-xs btn-outline" onclick="deleteClaim(${c.id})" style="color:var(--danger);">🗑 ${t('delete')}</button>`;
    }

    const receiptHtml = c.receipt_photo
      ? `<img class="receipt-thumb" src="${c.receipt_photo}" onclick="showReceipt('${c.receipt_photo}')">`
      : '';

    const paymentInfo = c.payment_method ? `<span>💳 ${c.payment_method}</span>` : '';

    return `
      <div class="claim-card status-${c.status}">
        <div class="claim-top">
          <div>
            <div class="claim-food">${catEmoji} ${escapeHtml(c.food_description)}</div>
            <div class="claim-meta">
              <span class="category-tag">${catLabel}</span>
              ${c.restaurant ? `<span>📍 ${escapeHtml(c.restaurant)}</span>` : ''}
              ${paymentInfo}
            </div>
          </div>
          <div style="text-align:right;">
            <div class="claim-amount">${c.currency} ${c.amount.toFixed(2)}</div>
            <span class="status-badge status-${c.status}">${t('status_' + c.status)}</span>
          </div>
        </div>
        <div class="claim-people">
          <span class="avatar" style="background:${c.submitter_color}">${(c.submitter_name||'?')[0]}</span>
          <span>${escapeHtml(c.submitter_name)}</span>
          <span class="claim-arrow">→</span>
          <span class="avatar" style="background:${c.target_color}">${(c.target_name||'?')[0]}</span>
          <span>${escapeHtml(c.target_name)}</span>
          ${receiptHtml}
        </div>
        <div class="claim-meta"><span>${timeAgo(c.submitted_at)}</span></div>
        ${actions ? `<div class="claim-actions">${actions}</div>` : ''}
      </div>`;
  }).join('');
}

// ==================== RENDER STATS ====================
function renderStats(data) {
  const grid = document.getElementById('stats-grid');
  grid.innerHTML = `
    <div class="stat-card positive"><div class="stat-value">${data.total_owed_to_me.toFixed(2)}</div><div class="stat-label">${t('owed_to_me')}</div></div>
    <div class="stat-card negative"><div class="stat-value">${data.total_i_owe.toFixed(2)}</div><div class="stat-label">${t('i_owe')}</div></div>
    <div class="stat-card ${data.net_balance >= 0 ? 'positive' : 'negative'}"><div class="stat-value">${data.net_balance >= 0 ? '+' : ''}${data.net_balance.toFixed(2)}</div><div class="stat-label">${t('net_balance')}</div></div>
    <div class="stat-card neutral"><div class="stat-value">${data.pending_review}</div><div class="stat-label">${t('pending_review')}</div></div>
  `;

  // Monthly chart (simple canvas)
  const chartCard = document.getElementById('chart-card');
  if (data.monthly && data.monthly.length > 0) {
    chartCard.style.display = 'block';
    drawMonthlyChart(data.monthly);
  } else {
    chartCard.style.display = 'none';
  }

  // Category breakdown
  const catCard = document.getElementById('category-card');
  if (data.categories && data.categories.length > 0) {
    catCard.style.display = 'block';
    document.getElementById('category-list').innerHTML = data.categories.map(c => {
      const emoji = CAT_EMOJIS[c.category] || '📦';
      const label = t(`cat_${c.category}`) || c.category;
      return `<div class="balance-item">
        <div class="balance-left"><span>${emoji}</span><div><div class="balance-name">${label}</div><div class="balance-detail">${c.count} claims</div></div></div>
        <div class="balance-amount neutral">MYR ${c.total.toFixed(2)}</div>
      </div>`;
    }).join('');
  } else {
    catCard.style.display = 'none';
  }

  // Friend balances
  const bList = document.getElementById('balances-list');
  if (data.balances.length === 0) {
    bList.innerHTML = '<div class="empty-state"><p>No friends yet</p></div>';
  } else {
    bList.innerHTML = data.balances.map(b => `
      <div class="balance-item">
        <div class="balance-left">
          <span class="avatar" style="background:${b.avatar_color}">${(b.display_name||'?')[0]}</span>
          <div>
            <div class="balance-name">${escapeHtml(b.display_name)}</div>
            <div class="balance-detail">${t('they_owe_me')}: ${b.they_owe_me.toFixed(2)} | ${t('i_owe_them')}: ${b.i_owe_them.toFixed(2)}</div>
          </div>
        </div>
        <div class="balance-amount ${b.net >= 0 ? 'positive' : 'negative'}">${b.net >= 0 ? '+' : ''}${b.net.toFixed(2)}</div>
      </div>
    `).join('');
  }
}

function drawMonthlyChart(monthly) {
  const canvas = document.getElementById('monthly-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = 200 * dpr;
  ctx.scale(dpr, dpr);
  const W = canvas.offsetWidth;
  const H = 200;
  ctx.clearRect(0, 0, W, H);

  const maxVal = Math.max(...monthly.map(m => Math.max(m.claimed || 0, m.owed || 0)), 1);
  const barW = Math.min(30, (W - 60) / (monthly.length * 2 + monthly.length - 1));
  const gap = barW * 0.4;
  const chartH = H - 40;
  const startX = (W - (monthly.length * (barW * 2 + gap) - gap)) / 2;

  monthly.forEach((m, i) => {
    const x = startX + i * (barW * 2 + gap);
    const h1 = (m.claimed / maxVal) * chartH;
    const h2 = (m.owed / maxVal) * chartH;

    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.roundRect(x, chartH - h1 + 10, barW, h1, [4, 4, 0, 0]);
    ctx.fill();

    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.roundRect(x + barW, chartH - h2 + 10, barW, h2, [4, 4, 0, 0]);
    ctx.fill();

    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(m.month.slice(5), x + barW, H - 4);
  });

  // Legend
  ctx.fillStyle = '#6366f1';
  ctx.fillRect(10, 4, 10, 10);
  ctx.fillStyle = '#374151';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(t('owed_to_me'), 24, 13);

  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(100, 4, 10, 10);
  ctx.fillStyle = '#374151';
  ctx.fillText(t('i_owe'), 114, 13);
}

// ==================== RENDER SETTLEMENT ====================
function renderSettlement(data) {
  const list = document.getElementById('settlement-list');
  if (data.settlements.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🎉</div><p>${t('no_settlement')}</p></div>`;
    return;
  }
  list.innerHTML = `<p style="font-size:0.8rem;color:var(--gray-500);margin-bottom:12px;">${data.debts_count} ${t('outstanding_debts')}</p>` +
    data.settlements.map(s => `
    <div class="settlement-card">
      <span class="avatar" style="background:${s.from.avatar_color}">${s.from.display_name[0]}</span>
      <div class="settlement-info"><div class="settlement-name">${escapeHtml(s.from.display_name)}</div></div>
      <span class="settlement-arrow">→</span>
      <div class="settlement-amount">MYR ${s.amount.toFixed(2)}</div>
      <span class="settlement-arrow">→</span>
      <span class="avatar" style="background:${s.to.avatar_color}">${s.to.display_name[0]}</span>
      <div class="settlement-info"><div class="settlement-name">${escapeHtml(s.to.display_name)}</div></div>
    </div>
  `).join('');
}

// ==================== RENDER ACTIVITY ====================
function renderActivity(activities) {
  const list = document.getElementById('activity-list');
  if (!activities || activities.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><p>${t('no_activity')}</p></div>`;
    return;
  }
  list.innerHTML = '<div class="card">' + activities.map(a => `
    <div class="activity-item">
      <span class="avatar avatar-sm" style="background:${a.avatar_color}">${(a.display_name||'?')[0]}</span>
      <div>
        <div class="activity-text"><strong>${escapeHtml(a.display_name)}</strong> ${escapeHtml(a.action)}</div>
        <div class="activity-time">${timeAgo(a.created_at)}</div>
      </div>
    </div>
  `).join('') + '</div>';
}

// ==================== RENDER NOTIFICATIONS ====================
function renderNotifications(data) {
  const badge = document.getElementById('notif-badge');
  if (data.unread_count > 0) {
    badge.style.display = 'flex';
    badge.textContent = data.unread_count > 9 ? '9+' : data.unread_count;
  } else {
    badge.style.display = 'none';
  }

  const list = document.getElementById('notif-list');
  if (!data.notifications || data.notifications.length === 0) {
    list.innerHTML = `<div class="notif-empty">${t('no_notifications')}</div>`;
    return;
  }
  list.innerHTML = data.notifications.map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'}">
      <div>${escapeHtml(n.message)}</div>
      <div class="notif-time">${timeAgo(n.created_at)}</div>
    </div>
  `).join('');
}

// ==================== RENDER PROFILE ====================
function renderProfile() {
  if (!currentUser) return;
  const view = document.getElementById('profile-view');
  view.innerHTML = `
    <div class="profile-avatar" style="background:${currentUser.avatar_color}">${(currentUser.display_name||'?')[0]}</div>
    <div class="profile-name">${escapeHtml(currentUser.display_name)}</div>
    <div class="profile-username">@${escapeHtml(currentUser.username)}</div>
  `;
  document.getElementById('profile-display-name').value = currentUser.display_name;

  const picker = document.getElementById('color-picker');
  picker.innerHTML = AVATAR_COLORS.map(c =>
    `<div class="color-swatch ${c === currentUser.avatar_color ? 'active' : ''}"
      style="background:${c}" onclick="selectColor('${c}')"></div>`
  ).join('');
}

function selectColor(c) {
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  event.target.classList.add('active');
}

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const display_name = document.getElementById('profile-display-name').value.trim();
  const avatar_color = document.querySelector('.color-swatch.active')?.style.background;
  const current_password = document.getElementById('profile-current-pw').value;
  const new_password = document.getElementById('profile-new-pw').value;

  try {
    const body = { display_name };
    if (avatar_color) body.avatar_color = rgbToHex(avatar_color);
    if (current_password && new_password) {
      body.current_password = current_password;
      body.new_password = new_password;
    }
    const data = await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(body) });
    currentUser = data.user;
    if (data.token) { authToken = data.token; localStorage.setItem('token', authToken); }
    renderProfile();
    showToast('Profile updated!', 'success');
    document.getElementById('profile-current-pw').value = '';
    document.getElementById('profile-new-pw').value = '';
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ==================== CLAIM ACTIONS ====================
document.getElementById('fab-new').addEventListener('click', () => {
  openClaimModal();
});

function openClaimModal() {
  const select = document.getElementById('claim-target');
  const otherUsers = users.filter(u => u.id !== currentUser.id);
  select.innerHTML = otherUsers.map(u => `<option value="${u.id}">${escapeHtml(u.display_name)}</option>`).join('');

  // Update category options text
  document.querySelectorAll('#claim-category option').forEach(opt => {
    const key = `cat_${opt.value}`;
    opt.textContent = t(key);
  });

  document.getElementById('claim-form').reset();
  openModal('claim-modal');
}

document.getElementById('claim-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData();
  formData.append('target_id', document.getElementById('claim-target').value);
  formData.append('amount', document.getElementById('claim-amount').value);
  formData.append('food_description', document.getElementById('claim-food').value);
  formData.append('restaurant', document.getElementById('claim-restaurant').value);
  formData.append('category', document.getElementById('claim-category').value);
  formData.append('notes', document.getElementById('claim-notes').value);
  formData.append('currency', 'MYR');

  const receipt = document.getElementById('claim-receipt').files[0];
  if (receipt) formData.append('receipt', receipt);

  try {
    const data = await api('/api/claims', {
      method: 'POST',
      body: formData,
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    // Don't set Content-Type for FormData
    delete data.headers;
    closeModal('claim-modal');
    // SSE will push the update, but also add locally immediately
    if (!claims.find(c => c.id === data.claim.id)) {
      claims.unshift(data.claim);
      renderClaims();
    }
    showToast('Claim submitted! / 账单已提交！', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

async function reviewClaim(id, status) {
  try {
    await api(`/api/claims/${id}/review`, { method: 'PATCH', body: JSON.stringify({ status }) });
    showToast(status === 'approved' ? 'Approved! / 已批准！' : 'Rejected / 已拒绝', status === 'approved' ? 'success' : 'info');
  } catch (err) { showToast(err.message, 'error'); }
}

function openPayModal(claimId) {
  payingClaimId = claimId;
  selectedPayment = null;
  document.querySelectorAll('.payment-option').forEach(p => p.classList.remove('selected'));
  document.getElementById('confirm-pay-btn').disabled = true;
  openModal('payment-modal');
}

document.querySelectorAll('.payment-option').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.payment-option').forEach(p => p.classList.remove('selected'));
    opt.classList.add('selected');
    selectedPayment = opt.dataset.method;
    document.getElementById('confirm-pay-btn').disabled = false;
  });
});

document.getElementById('confirm-pay-btn').addEventListener('click', async () => {
  if (!selectedPayment || !payingClaimId) return;
  try {
    await api(`/api/claims/${payingClaimId}/pay`, {
      method: 'PATCH',
      body: JSON.stringify({ payment_method: selectedPayment })
    });
    closeModal('payment-modal');
    showToast('Paid! / 已付款！', 'success');
  } catch (err) { showToast(err.message, 'error'); }
});

async function deleteClaim(id) {
  if (!confirm(t('confirm_delete'))) return;
  try {
    await api(`/api/claims/${id}`, { method: 'DELETE' });
    claims = claims.filter(c => c.id !== id);
    renderClaims();
    showToast('Deleted / 已删除', 'info');
  } catch (err) { showToast(err.message, 'error'); }
}

// ==================== NOTIFICATIONS ====================
document.getElementById('notif-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = document.getElementById('notif-dropdown');
  dd.classList.toggle('active');
});

document.getElementById('mark-read-btn').addEventListener('click', async () => {
  await api('/api/notifications/read', { method: 'PATCH' });
  loadNotifications();
});

document.addEventListener('click', () => {
  document.getElementById('notif-dropdown').classList.remove('active');
});

// ==================== HEADER BUTTONS ====================
document.getElementById('lang-btn').addEventListener('click', () => {
  setLang(getLang() === 'zh' ? 'en' : 'zh');
  updateI18N();
  renderClaims();
  if (activeSection === 'stats') loadStats();
  if (activeSection === 'activity') loadActivity();
  if (activeSection === 'settlement') loadSettlement();
  if (activeSection === 'profile') renderProfile();
  buildBottomNav();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('token');
  authToken = null;
  currentUser = null;
  if (sseSource) sseSource.close();
  showAuth('login');
});

document.getElementById('export-btn').addEventListener('click', () => {
  window.open(`/api/export?token=${authToken}`, '_blank');
});

// ==================== SEARCH ====================
document.getElementById('search-input').addEventListener('input', (e) => {
  currentSearch = e.target.value;
  renderClaims();
});

// ==================== RECEIPT VIEWER ====================
function showReceipt(url) {
  document.getElementById('receipt-full-img').src = url;
  openModal('receipt-modal');
}

// ==================== MODALS ====================
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});

// ==================== I18N ====================
function updateI18N() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder || el.getAttribute('data-i18n-placeholder'));
  });
  // Update SSE status text
  const sseText = document.getElementById('sse-text');
  if (sseText) {
    const dot = document.getElementById('sse-dot');
    sseText.textContent = dot.classList.contains('offline') ? t('realtime_disconnected') : t('realtime_connected');
  }
}

// ==================== UTILS ====================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr + 'Z');
  const diff = (now - date) / 1000;
  if (diff < 60) return t('just_now');
  if (diff < 3600) return Math.floor(diff/60) + t('minutes_ago');
  if (diff < 86400) return Math.floor(diff/3600) + t('hours_ago');
  return Math.floor(diff/86400) + t('days_ago');
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function rgbToHex(rgb) {
  if (rgb.startsWith('#')) return rgb;
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) return rgb;
  return '#' + match.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

// Fix FormData fetch (don't set Content-Type manually)
const origApi = api;
