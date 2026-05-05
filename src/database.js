const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString || connectionString.includes('YOUR-PASSWORD')) {
    console.warn("⚠️ DATABASE_URL belum diatur atau password masih kosong di .env. Menggunakan konfigurasi default untuk mencoba koneksi, tapi ini mungkin gagal.");
}

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false } // Diperlukan untuk koneksi ke layanan cloud seperti Supabase/Neon
});

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS members (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                telegram_id TEXT,
                telegram_username TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS contributions (
                id SERIAL PRIMARY KEY,
                member_id INTEGER NOT NULL REFERENCES members(id),
                amount REAL NOT NULL,
                month TEXT NOT NULL,
                paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                notes TEXT
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS expenses (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL DEFAULT CURRENT_DATE,
                description TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'Lainnya',
                amount REAL NOT NULL,
                paid_by INTEGER REFERENCES members(id),
                receipt_image TEXT,
                items TEXT,
                source TEXT DEFAULT 'manual',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS debts (
                id SERIAL PRIMARY KEY,
                from_member_id INTEGER NOT NULL REFERENCES members(id),
                to_member_id INTEGER NOT NULL REFERENCES members(id),
                amount REAL NOT NULL,
                reason TEXT,
                settled INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                settled_at TIMESTAMP
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        // Seed data members
        const membersList = ['Gentha', 'Nopal', 'Roni', 'Ikbal'];
        for (const name of membersList) {
            await client.query('INSERT INTO members (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
        }

        // Seed data settings
        const defaultSettings = {
            monthly_contribution: '0',
            monthly_budget: '0',
            weekly_budget: '0',
            currency: 'Rp',
            kos_name: 'Kos Kita'
        };
        for (const [key, value] of Object.entries(defaultSettings)) {
            await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
        }

        await client.query('COMMIT');
        console.log("✅ Database berhasil diinisialisasi (PostgreSQL)");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ Gagal inisialisasi database:", e);
        throw e;
    } finally {
        client.release();
    }
}

// ============================================
// MEMBER QUERIES
// ============================================
const memberQueries = {
    getAll: async () => (await pool.query('SELECT * FROM members ORDER BY name')).rows,
    getById: async (id) => (await pool.query('SELECT * FROM members WHERE id = $1', [id])).rows[0],
    getByName: async (name) => (await pool.query('SELECT * FROM members WHERE LOWER(name) = LOWER($1)', [name])).rows[0],
    getByTelegramId: async (id) => (await pool.query('SELECT * FROM members WHERE telegram_id = $1', [id])).rows[0],
    updateTelegramId: async (telegramId, username, id) => await pool.query('UPDATE members SET telegram_id = $1, telegram_username = $2 WHERE id = $3', [telegramId, username, id])
};

// ============================================
// EXPENSE QUERIES
// ============================================
const expenseQueries = {
    insert: async (date, description, category, amount, paid_by, receipt_image, items, source) => {
        const query = `
            INSERT INTO expenses (date, description, category, amount, paid_by, receipt_image, items, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
        `;
        return (await pool.query(query, [date, description, category, amount, paid_by, receipt_image, items, source])).rows[0];
    },
    getAll: async () => {
        const query = `
            SELECT e.*, m.name as paid_by_name
            FROM expenses e
            LEFT JOIN members m ON e.paid_by = m.id
            ORDER BY e.date DESC, e.created_at DESC
        `;
        return (await pool.query(query)).rows;
    },
    getByDateRange: async (start, end) => {
        const query = `
            SELECT e.*, m.name as paid_by_name
            FROM expenses e
            LEFT JOIN members m ON e.paid_by = m.id
            WHERE e.date BETWEEN $1 AND $2
            ORDER BY e.date DESC, e.created_at DESC
        `;
        return (await pool.query(query, [start, end])).rows;
    },
    getByCategory: async (category) => {
        const query = `
            SELECT e.*, m.name as paid_by_name
            FROM expenses e
            LEFT JOIN members m ON e.paid_by = m.id
            WHERE e.category = $1
            ORDER BY e.date DESC
        `;
        return (await pool.query(query, [category])).rows;
    },
    getWeeklySummary: async () => {
        const query = `
            SELECT 
                TO_CHAR(date, 'IYYY-IW') as week,
                MIN(date) as week_start,
                MAX(date) as week_end,
                SUM(amount) as total,
                COUNT(*) as count
            FROM expenses
            WHERE date >= CURRENT_DATE - INTERVAL '8 weeks'
            GROUP BY TO_CHAR(date, 'IYYY-IW')
            ORDER BY week ASC
        `;
        return (await pool.query(query)).rows;
    },
    getMonthlySummary: async () => {
        const query = `
            SELECT 
                TO_CHAR(date, 'YYYY-MM') as month,
                SUM(amount) as total,
                COUNT(*) as count
            FROM expenses
            WHERE date >= CURRENT_DATE - INTERVAL '12 months'
            GROUP BY TO_CHAR(date, 'YYYY-MM')
            ORDER BY month ASC
        `;
        return (await pool.query(query)).rows;
    },
    getCategorySummary: async () => {
        const query = `
            SELECT 
                category,
                SUM(amount) as total,
                COUNT(*) as count
            FROM expenses
            WHERE created_at >= date_trunc('month', CURRENT_DATE)
            GROUP BY category
            ORDER BY total DESC
        `;
        return (await pool.query(query)).rows;
    },
    getMemberSummary: async () => {
        const query = `
            SELECT 
                m.name,
                m.id as member_id,
                COALESCE(SUM(e.amount), 0) as total,
                COUNT(e.id) as count
            FROM members m
            LEFT JOIN expenses e ON m.id = e.paid_by AND e.created_at >= date_trunc('month', CURRENT_DATE)
            GROUP BY m.id, m.name
            ORDER BY total DESC
        `;
        return (await pool.query(query)).rows;
    },
    getWeeklyMemberSummary: async () => {
        const query = `
            SELECT 
                m.name,
                m.id as member_id,
                COALESCE(SUM(e.amount), 0) as total,
                COUNT(e.id) as count
            FROM members m
            LEFT JOIN expenses e ON m.id = e.paid_by AND e.created_at >= date_trunc('week', CURRENT_DATE)
            GROUP BY m.id, m.name
            ORDER BY total DESC
        `;
        return (await pool.query(query)).rows;
    },
    getThisMonthTotal: async () => {
        const query = `
            SELECT COALESCE(SUM(amount), 0) as total
            FROM expenses
            WHERE created_at >= date_trunc('month', CURRENT_DATE)
        `;
        return (await pool.query(query)).rows[0] || { total: 0 };
    },
    getThisWeekTotal: async () => {
        const query = `
            SELECT COALESCE(SUM(amount), 0) as total
            FROM expenses
            WHERE created_at >= date_trunc('week', CURRENT_DATE)
        `;
        return (await pool.query(query)).rows[0] || { total: 0 };
    },
    getRecent: async (limit) => {
        const query = `
            SELECT e.*, m.name as paid_by_name
            FROM expenses e
            LEFT JOIN members m ON e.paid_by = m.id
            ORDER BY e.created_at DESC
            LIMIT $1
        `;
        return (await pool.query(query, [limit])).rows;
    },
    deleteById: async (id) => {
        await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
    },
    getDailyTotals: async (start, end) => {
        const query = `
            SELECT date, SUM(amount) as total, COUNT(*) as count
            FROM expenses
            WHERE date BETWEEN $1 AND $2
            GROUP BY date
            ORDER BY date ASC
        `;
        return (await pool.query(query, [start, end])).rows;
    }
};

// ============================================
// CONTRIBUTION QUERIES
// ============================================
const contributionQueries = {
    insert: async (member_id, amount, month, notes) => {
        const query = `
            INSERT INTO contributions (member_id, amount, month, notes)
            VALUES ($1, $2, $3, $4)
        `;
        await pool.query(query, [member_id, amount, month, notes]);
    },
    getByMonth: async (month) => {
        const query = `
            SELECT c.*, m.name
            FROM contributions c
            JOIN members m ON c.member_id = m.id
            WHERE c.month = $1
            ORDER BY c.paid_at
        `;
        return (await pool.query(query, [month])).rows;
    },
    getStatusByMonth: async (month) => {
        const query = `
            SELECT 
                m.id, m.name,
                CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as paid,
                c.amount, c.paid_at
            FROM members m
            LEFT JOIN contributions c ON m.id = c.member_id AND c.month = $1
            ORDER BY m.name
        `;
        return (await pool.query(query, [month])).rows;
    },
    getTotalByMonth: async (month) => {
        const query = `
            SELECT COALESCE(SUM(amount), 0) as total
            FROM contributions
            WHERE month = $1
        `;
        return (await pool.query(query, [month])).rows[0] || { total: 0 };
    },
    getHistory: async (limit) => {
        const query = `
            SELECT c.*, m.name
            FROM contributions c
            JOIN members m ON c.member_id = m.id
            ORDER BY c.month DESC, c.paid_at DESC
            LIMIT $1
        `;
        return (await pool.query(query, [limit])).rows;
    }
};

// ============================================
// DEBT QUERIES
// ============================================
const debtQueries = {
    insert: async (from_member_id, to_member_id, amount, reason) => {
        const query = `
            INSERT INTO debts (from_member_id, to_member_id, amount, reason)
            VALUES ($1, $2, $3, $4)
        `;
        await pool.query(query, [from_member_id, to_member_id, amount, reason]);
    },
    getActive: async () => {
        const query = `
            SELECT d.*, 
                mf.name as from_name,
                mt.name as to_name
            FROM debts d
            JOIN members mf ON d.from_member_id = mf.id
            JOIN members mt ON d.to_member_id = mt.id
            WHERE d.settled = 0
            ORDER BY d.created_at DESC
        `;
        return (await pool.query(query)).rows;
    },
    settle: async (id) => {
        await pool.query('UPDATE debts SET settled = 1, settled_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    }
};

// ============================================
// SETTINGS QUERIES
// ============================================
const settingQueries = {
    get: async (key) => {
        const row = (await pool.query('SELECT value FROM settings WHERE key = $1', [key])).rows[0];
        return row ? row.value : null;
    },
    set: async (key, value) => {
        await pool.query(`
            INSERT INTO settings (key, value) VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, [key, String(value)]);
    },
    getAll: async () => {
        return (await pool.query('SELECT * FROM settings')).rows;
    }
};

// ============================================
// HELPER FUNCTIONS
// ============================================
async function getSetting(key) {
    return await settingQueries.get(key);
}

async function setSetting(key, value) {
    await settingQueries.set(key, value);
}

async function getBalance() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const totalContrRow = await contributionQueries.getTotalByMonth(currentMonth);
    const totalExpRow = await expenseQueries.getThisMonthTotal();
    
    const totalContributions = totalContrRow.total || 0;
    const totalExpenses = totalExpRow.total || 0;
    return {
        contributions: totalContributions,
        expenses: totalExpenses,
        balance: totalContributions - totalExpenses
    };
}

async function getDashboardData() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    // Execute all queries in parallel for better performance
    const [
        balance,
        weeklyData,
        categoryData,
        memberData,
        weeklyMemberData,
        recentExpenses,
        contributionStatus,
        monthlyTrend,
        weekTotalRow,
        monthTotalRow,
        activeDebts,
        members,
        budgetSetting,
        weeklyBudgetSetting,
        contributionSetting
    ] = await Promise.all([
        getBalance(),
        expenseQueries.getWeeklySummary(),
        expenseQueries.getCategorySummary(),
        expenseQueries.getMemberSummary(),
        expenseQueries.getWeeklyMemberSummary(),
        expenseQueries.getRecent(20),
        contributionQueries.getStatusByMonth(currentMonth),
        expenseQueries.getMonthlySummary(),
        expenseQueries.getThisWeekTotal(),
        expenseQueries.getThisMonthTotal(),
        debtQueries.getActive(),
        memberQueries.getAll(),
        getSetting('monthly_budget'),
        getSetting('weekly_budget'),
        getSetting('monthly_contribution')
    ]);

    const weekTotal = weekTotalRow.total || 0;
    const monthTotal = monthTotalRow.total || 0;
    const budget = parseFloat(budgetSetting) || 0;
    const weeklyBudget = parseFloat(weeklyBudgetSetting) || 0;
    const contribution = parseFloat(contributionSetting) || 0;

    return {
        balance,
        weekTotal,
        monthTotal,
        budget,
        weeklyBudget,
        contribution,
        budgetPercentage: budget > 0 ? Math.round((monthTotal / budget) * 100) : 0,
        weeklyBudgetPercentage: weeklyBudget > 0 ? Math.round((weekTotal / weeklyBudget) * 100) : 0,
        weeklyData,
        categoryData,
        memberData,
        weeklyMemberData,
        recentExpenses,
        contributionStatus,
        monthlyTrend,
        activeDebts,
        members
    };
}

module.exports = {
    pool,
    initDB,
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
