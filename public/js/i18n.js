const translations = {
  en: {
    app_title: 'Food Expense Tracker',
    app_subtitle: 'Split bills with friends easily',
    login: 'Login', register: 'Register', logout: 'Logout',
    username: 'Username', password: 'Password', display_name: 'Display Name',
    login_btn: 'Login', register_btn: 'Register',
    no_account: "Don't have an account?", have_account: 'Already have an account?',

    // Navigation
    nav_claims: 'Claims', nav_stats: 'Dashboard', nav_activity: 'Activity',
    nav_settlement: 'Settlement', nav_profile: 'Profile',

    // Claims
    new_claim: 'New Claim', submit_claim: 'Submit Claim',
    select_target: 'Who owes you?', amount: 'Amount (MYR)',
    food_desc: 'What food?', restaurant: 'Restaurant (optional)',
    category: 'Category', notes: 'Notes (optional)',
    receipt: 'Upload Receipt', all: 'All', pending: 'Pending',
    approved: 'Approved', rejected: 'Rejected', paid: 'Paid',
    approve: 'Approve', reject: 'Reject', mark_paid: 'Mark as Paid',
    delete: 'Delete', cancel: 'Cancel',
    no_claims: 'No claims yet', search_placeholder: 'Search claims...',
    confirm_delete: 'Are you sure you want to delete this claim?',
    select_payment: 'Select payment method',

    // Categories
    cat_meal: 'Meal', cat_drinks: 'Drinks', cat_snack: 'Snack',
    cat_dessert: 'Dessert', cat_groceries: 'Groceries', cat_other: 'Other',

    // Stats
    owed_to_me: 'Owed to Me', i_owe: 'I Owe', net_balance: 'Net Balance',
    pending_review: 'Pending Review', friend_balances: 'Friend Balances',
    monthly_chart: 'Monthly Trend', they_owe_me: 'They owe me',
    i_owe_them: 'I owe them', total_paid_back: 'Total Paid Back',
    total_received_back: 'Total Received Back', category_breakdown: 'By Category',

    // Activity
    activity_log: 'Activity Log', no_activity: 'No activity yet',

    // Settlement
    settlement_title: 'Smart Settlement', settlement_desc: 'Optimal way to settle all debts',
    pays: 'pays', no_settlement: 'All settled! No pending debts.',
    outstanding_debts: 'outstanding approved debts',

    // Notifications
    notifications: 'Notifications', no_notifications: 'No notifications',
    mark_all_read: 'Mark all read',

    // Profile
    edit_profile: 'Edit Profile', change_password: 'Change Password',
    current_password: 'Current Password', new_password: 'New Password',
    save_changes: 'Save Changes', avatar_color: 'Avatar Color',

    // Export
    export_csv: 'Export CSV',

    // Status
    status_pending: 'Pending', status_approved: 'Approved',
    status_rejected: 'Rejected', status_paid: 'Paid',

    // Realtime
    realtime_connected: 'Live', realtime_disconnected: 'Offline',

    // Time
    just_now: 'just now', minutes_ago: 'm ago', hours_ago: 'h ago',
    days_ago: 'd ago',
  },
  zh: {
    app_title: '美食记账本',
    app_subtitle: '轻松和朋友分账',
    login: '登录', register: '注册', logout: '退出',
    username: '用户名', password: '密码', display_name: '显示名称',
    login_btn: '登录', register_btn: '注册',
    no_account: '没有账号？', have_account: '已有账号？',

    nav_claims: '账单', nav_stats: '统计', nav_activity: '动态',
    nav_settlement: '结算', nav_profile: '个人',

    new_claim: '新账单', submit_claim: '提交账单',
    select_target: '谁欠你钱？', amount: '金额 (MYR)',
    food_desc: '什么食物？', restaurant: '餐厅（可选）',
    category: '类别', notes: '备注（可选）',
    receipt: '上传收据', all: '全部', pending: '待审批',
    approved: '已批准', rejected: '已拒绝', paid: '已付款',
    approve: '批准', reject: '拒绝', mark_paid: '标记已付款',
    delete: '删除', cancel: '取消',
    no_claims: '还没有账单', search_placeholder: '搜索账单...',
    confirm_delete: '确定要删除这个账单吗？',
    select_payment: '选择支付方式',

    cat_meal: '正餐', cat_drinks: '饮料', cat_snack: '小吃',
    cat_dessert: '甜品', cat_groceries: '杂货', cat_other: '其他',

    owed_to_me: '别人欠我', i_owe: '我欠别人', net_balance: '净余额',
    pending_review: '待审批', friend_balances: '朋友余额',
    monthly_chart: '月度趋势', they_owe_me: '他们欠我',
    i_owe_them: '我欠他们', total_paid_back: '已还总额',
    total_received_back: '已收回总额', category_breakdown: '按类别',

    activity_log: '动态日志', no_activity: '还没有动态',

    settlement_title: '智能结算', settlement_desc: '最优还款方案',
    pays: '付给', no_settlement: '全部结清！没有待还的账单。',
    outstanding_debts: '笔待还账单',

    notifications: '通知', no_notifications: '没有通知',
    mark_all_read: '全部已读',

    edit_profile: '编辑资料', change_password: '修改密码',
    current_password: '当前密码', new_password: '新密码',
    save_changes: '保存', avatar_color: '头像颜色',

    export_csv: '导出CSV',

    status_pending: '待审批', status_approved: '已批准',
    status_rejected: '已拒绝', status_paid: '已付款',

    realtime_connected: '已连接', realtime_disconnected: '离线',

    just_now: '刚刚', minutes_ago: '分钟前', hours_ago: '小时前',
    days_ago: '天前',
  }
};

let currentLang = localStorage.getItem('lang') || 'zh';

function t(key) {
  return translations[currentLang]?.[key] || translations['en']?.[key] || key;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('lang', lang);
}

function getLang() { return currentLang; }
