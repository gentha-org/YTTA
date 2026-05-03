const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Pastikan folder data ada
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'keuangan.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================
// TABLE CREATION
// ============================================

db.exec(`
    CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        telegram_id TEXT,
        telegram_username TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS contributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        month TEXT NOT NULL,
        paid_at TEXT DEFAULT (datetime('now', 'localtime')),
        notes TEXT,
        FOREIGN KEY (member_id) REFERENCES members(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
        description TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Lainnya',
        amount REAL NOT NULL,
        paid_by INTEGER,
        receipt_image TEXT,
        items TEXT,
        source TEXT DEFAULT 'manual',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (paid_by) REFERENCES members(id)
    );

    CREATE TABLE IF NOT EXISTS debts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_member_id INTEGER NOT NULL,
        to_member_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        reason TEXT,
        settled INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        settled_at TEXT,
        FOREIGN KEY (from_member_id) REFERENCES members(id),
        FOREIGN KEY (to_member_id) REFERENCES members(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
`);

// ============================================
// SEED DATA - Anggota Kos
// ============================================

const members = ['Gentha', 'Nopal', 'Roni', 'Ikbal'];
const insertMember = db.prepare('INSERT OR IGNORE INTO members (name) VALUES (?)');
members.forEach(name => insertMember.run(name));

// Default settings
const defaultSettings = {
    monthly_contribution: '0',
    monthly_budget: '0',
    currency: 'Rp',
    kos_name: 'Kos Kita'
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
Object.entries(defaultSettings).forEach(([key, value]) => insertSetting.run(key, value));

// ============================================
// MEMBER QUERIES
// ============================================

const memberQueries = {
    getAll: db.prepare('SELECT * FROM members ORDER BY name'),
    getById: db.prepare('SELECT * FROM members WHERE id = ?'),
    getByName: db.prepare('SELECT * FROM members WHERE LOWER(name) = LOWER(?)'),
    getByTelegramId: db.prepare('SELECT * FROM members WHERE telegram_id = ?'),
    updateTelegramId: db.prepare('UPDATE members SET telegram_id = ?, telegram_username = ? WHERE id = ?'),
};

// ============================================
// EXPENSE QUERIES
// ============================================

const expenseQueries = {
    insert: db.prepare(`
        INSERT INTO expenses (date, description, category, amount, paid_by, receipt_image, items, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getAll: db.prepare(`
        SELECT e.*, m.name as paid_by_name
        FROM expenses e
        LEFT JOIN members m ON e.paid_by = m.id
        ORDER BY e.date DESC, e.created_at DESC
    `),
    getByDateRange: db.prepare(`
        SELECT e.*, m.name as paid_by_name
        FROM expenses e
        LEFT JOIN members m ON e.paid_by = m.id
        WHERE e.date BETWEEN ? AND ?
        ORDER BY e.date DESC, e.created_at DESC
    `),
    getByCategory: db.prepare(`
        SELECT e.*, m.name as paid_by_name
        FROM expenses e
        LEFT JOIN members m ON e.paid_by = m.id
        WHERE e.category = ?
        ORDER BY e.date DESC
    `),
    getWeeklySummary: db.prepare(`
        SELECT 
            strftime('%Y-W%W', date) as week,
            MIN(date) as week_start,
            MAX(date) as week_end,
            SUM(amount) as total,
            COUNT(*) as count
        FROM expenses
        WHERE date >= date('now', 'localtime', '-8 weeks')
        GROUP BY strftime('%Y-W%W', date)
        ORDER BY week ASC
    `),
    getMonthlySummary: db.prepare(`
        SELECT 
            strftime('%Y-%m', date) as month,
            SUM(amount) as total,
            COUNT(*) as count
        FROM expenses
        WHERE date >= date('now', 'localtime', '-12 months')
        GROUP BY strftime('%Y-%m', date)
        ORDER BY month ASC
    `),
    getCategorySummary: db.prepare(`
        SELECT 
            category,
            SUM(amount) as total,
            COUNT(*) as count
        FROM expenses
        WHERE created_at >= date('now', 'localtime', 'start of month')
        GROUP BY category
        ORDER BY total DESC
    `),
    getMemberSummary: db.prepare(`
        SELECT 
            m.name,
            m.id as member_id,
            COALESCE(SUM(e.amount), 0) as total,
            COUNT(e.id) as count
        FROM members m
        LEFT JOIN expenses e ON m.id = e.paid_by AND e.created_at >= date('now', 'localtime', 'start of month')
        GROUP BY m.id
        ORDER BY total DESC
    `),
    getThisMonthTotal: db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM expenses
        WHERE created_at >= date('now', 'localtime', 'start of month')
    `),
    getThisWeekTotal: db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM expenses
        WHERE created_at >= date('now', 'localtime', 'weekday 0', '-7 days')
    `),
    getRecent: db.prepare(`
        SELECT e.*, m.name as paid_by_name
        FROM expenses e
        LEFT JOIN members m ON e.paid_by = m.id
        ORDER BY e.created_at DESC
        LIMIT ?
    `),
    deleteById: db.prepare('DELETE FROM expenses WHERE id = ?'),
    getDailyTotals: db.prepare(`
        SELECT date, SUM(amount) as total, COUNT(*) as count
        FROM expenses
        WHERE date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
    `),
};

// ============================================
// CONTRIBUTION QUERIES
// ============================================

const contributionQueries = {
    insert: db.prepare(`
        INSERT INTO contributions (member_id, amount, month, notes)
        VALUES (?, ?, ?, ?)
    `),
    getByMonth: db.prepare(`
        SELECT c.*, m.name
        FROM contributions c
        JOIN members m ON c.member_id = m.id
        WHERE c.month = ?
        ORDER BY c.paid_at
    `),
    getStatusByMonth: db.prepare(`
        SELECT 
            m.id, m.name,
            CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as paid,
            c.amount, c.paid_at
        FROM members m
        LEFT JOIN contributions c ON m.id = c.member_id AND c.month = ?
        ORDER BY m.name
    `),
    getTotalByMonth: db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM contributions
        WHERE month = ?
    `),
    getHistory: db.prepare(`
        SELECT c.*, m.name
        FROM contributions c
        JOIN members m ON c.member_id = m.id
        ORDER BY c.month DESC, c.paid_at DESC
        LIMIT ?
    `),
};

// ============================================
// DEBT QUERIES
// ============================================

const debtQueries = {
    insert: db.prepare(`
        INSERT INTO debts (from_member_id, to_member_id, amount, reason)
        VALUES (?, ?, ?, ?)
    `),
    getActive: db.prepare(`
        SELECT d.*, 
            mf.name as from_name,
            mt.name as to_name
        FROM debts d
        JOIN members m1 ON d.from_member_id = m1.id
        JOIN members mf ON d.from_member_id = mf.id
        JOIN members mt ON d.to_member_id = mt.id
        WHERE d.settled = 0
        ORDER BY d.created_at DESC
    `),
    settle: db.prepare(`
        UPDATE debts SET settled = 1, settled_at = datetime('now', 'localtime')
        WHERE id = ?
    `),
};

// ============================================
// SETTINGS QUERIES
// ============================================

const settingQueries = {
    get: db.prepare('SELECT value FROM settings WHERE key = ?'),
    set: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
    getAll: db.prepare('SELECT * FROM settings'),
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function getSetting(key) {
    const row = settingQueries.get.get(key);
    return row ? row.value : null;
}

function setSetting(key, value) {
    settingQueries.set.run(key, String(value));
}

function getBalance() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const totalContributions = contributionQueries.getTotalByMonth.get(currentMonth)?.total || 0;
    const totalExpenses = expenseQueries.getThisMonthTotal.get()?.total || 0;
    return {
        contributions: totalContributions,
        expenses: totalExpenses,
        balance: totalContributions - totalExpenses
    };
}

function getDashboardData() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const balance = getBalance();
    const weeklyData = expenseQueries.getWeeklySummary.all();
    const categoryData = expenseQueries.getCategorySummary.all();
    const memberData = expenseQueries.getMemberSummary.all();
    const recentExpenses = expenseQueries.getRecent.all(20);
    const contributionStatus = contributionQueries.getStatusByMonth.all(currentMonth);
    const monthlyTrend = expenseQueries.getMonthlySummary.all();
    const weekTotal = expenseQueries.getThisWeekTotal.get()?.total || 0;
    const monthTotal = expenseQueries.getThisMonthTotal.get()?.total || 0;
    const activeDebts = debtQueries.getActive.all();
    const members = memberQueries.getAll.all();
    const budget = parseFloat(getSetting('monthly_budget')) || 0;
    const contribution = parseFloat(getSetting('monthly_contribution')) || 0;

    return {
        balance,
        weekTotal,
        monthTotal,
        budget,
        contribution,
        budgetPercentage: budget > 0 ? Math.round((monthTotal / budget) * 100) : 0,
        weeklyData,
        categoryData,
        memberData,
        recentExpenses,
        contributionStatus,
        monthlyTrend,
        activeDebts,
        members
    };
}

module.exports = {
    db,
    memberQueries,
    expenseQueries,
    contributionQueries,
    debtQueries,
    settingQueries,
    getSetting,
    setSetting,
    getBalance,
    getDashboardData
};
