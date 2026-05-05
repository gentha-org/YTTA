require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const { 
    initDB, memberQueries, expenseQueries, contributionQueries, 
    debtQueries, settingQueries, getSetting, setSetting, 
    getBalance, getDashboardData 
} = require('./database');
const { scanReceipt, parseManualInput, autoCategorizee } = require('./ocr');
const { generateReport } = require('./excel');
const { createBot, getBot } = require('./bot');
const { initScheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// File upload config (for temporary local storage before ImgBB/Gemini)
const uploadsDir = path.join(__dirname, '..', 'uploads', 'receipts');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
        cb(null, `receipt_${Date.now()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ============================================
// API ROUTES
// ============================================

// Dashboard data
app.get('/api/dashboard', async (req, res) => {
    try {
        const data = await getDashboardData();
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Members
app.get('/api/members', async (req, res) => {
    try {
        const members = await memberQueries.getAll();
        res.json({ success: true, data: members });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Expenses
app.get('/api/expenses', async (req, res) => {
    try {
        const { start, end, category, limit } = req.query;
        let expenses;
        
        if (start && end) {
            expenses = await expenseQueries.getByDateRange(start, end);
        } else if (category) {
            expenses = await expenseQueries.getByCategory(category);
        } else if (limit) {
            expenses = await expenseQueries.getRecent(parseInt(limit));
        } else {
            expenses = await expenseQueries.getAll();
        }
        
        res.json({ success: true, data: expenses });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Add expense
app.post('/api/expenses', async (req, res) => {
    try {
        const { date, description, category, amount, paid_by, source, receipt_image } = req.body;
        const cat = category || autoCategorizee(description);
        const today = date || new Date().toISOString().slice(0, 10);
        
        const result = await expenseQueries.insert(
            today, description, cat, amount,
            paid_by || null, receipt_image || null, null, source || 'web'
        );

        res.json({ 
            success: true, 
            data: { id: result.id },
            message: 'Pengeluaran berhasil ditambahkan'
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete expense
app.delete('/api/expenses/:id', async (req, res) => {
    try {
        await expenseQueries.deleteById(parseInt(req.params.id));
        res.json({ success: true, message: 'Pengeluaran berhasil dihapus' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Upload & scan receipt
app.post('/api/scan', upload.single('receipt'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        
        const result = await scanReceipt(req.file.path);
        
        // Try to clean up local file if ephemeral
        try { fs.unlinkSync(req.file.path); } catch (e) {}

        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Contributions
app.get('/api/contributions', async (req, res) => {
    try {
        const { month } = req.query;
        const currentMonth = month || new Date().toISOString().slice(0, 7);
        const status = await contributionQueries.getStatusByMonth(currentMonth);
        const totalRow = await contributionQueries.getTotalByMonth(currentMonth);
        res.json({ success: true, data: { status, total: totalRow?.total || 0, month: currentMonth } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/contributions', async (req, res) => {
    try {
        const { member_id, amount, month, notes } = req.body;
        const m = month || new Date().toISOString().slice(0, 7);
        await contributionQueries.insert(member_id, amount, m, notes || null);
        res.json({ success: true, message: 'Iuran berhasil dicatat' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Summary endpoints
app.get('/api/summary/weekly', async (req, res) => {
    try {
        const data = await expenseQueries.getWeeklySummary();
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/summary/monthly', async (req, res) => {
    try {
        const data = await expenseQueries.getMonthlySummary();
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/summary/categories', async (req, res) => {
    try {
        const data = await expenseQueries.getCategorySummary();
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/summary/members', async (req, res) => {
    try {
        const data = await expenseQueries.getMemberSummary();
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Debts
app.get('/api/debts', async (req, res) => {
    try {
        const debts = await debtQueries.getActive();
        res.json({ success: true, data: debts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/debts', async (req, res) => {
    try {
        const { from_member_id, to_member_id, amount, reason } = req.body;
        await debtQueries.insert(from_member_id, to_member_id, amount, reason || null);
        res.json({ success: true, message: 'Hutang tercatat' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/debts/:id/settle', async (req, res) => {
    try {
        await debtQueries.settle(parseInt(req.params.id));
        res.json({ success: true, message: 'Hutang dilunasi' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/ping-debt', async (req, res) => {
    try {
        const { id } = req.body;
        const debts = await debtQueries.getActive();
        const debt = debts.find(d => d.id === parseInt(id));
        if (!debt) return res.status(404).json({ success: false, error: 'Hutang tidak ditemukan' });

        const bot = getBot();
        if (!bot) return res.status(500).json({ success: false, error: 'Bot tidak aktif' });

        const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID;
        if (!groupChatId || groupChatId === 'GANTI_DENGAN_CHAT_ID_GRUP') {
            return res.status(400).json({ success: false, error: 'Grup chat ID belum disetting di .env' });
        }

        const message = `🔔 *PENGINGAT HUTANG*\n\nHalo ${debt.from_name}, jangan lupa ada catatan hutang ke ${debt.to_name} sebesar *Rp ${debt.amount.toLocaleString('id-ID')}* ya.\n📝 Keterangan: ${debt.reason || '-'}`;
        
        bot.sendMessage(groupChatId, message, { parse_mode: 'Markdown' });
        res.json({ success: true, message: 'Notifikasi terkirim ke grup' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Settings
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await settingQueries.getAll();
        const obj = {};
        settings.forEach(s => { obj[s.key] = s.value; });
        res.json({ success: true, data: obj });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/settings', async (req, res) => {
    try {
        const updates = req.body;
        for (const [key, value] of Object.entries(updates)) {
            await setSetting(key, value);
        }
        res.json({ success: true, message: 'Pengaturan berhasil disimpan' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Excel export
app.get('/api/export/excel', async (req, res) => {
    try {
        const { month } = req.query;
        const buffer = await generateReport(month);
        const fileName = `Laporan_Keuangan_Kos_${month || 'Semua'}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(Buffer.from(buffer));
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Balance
app.get('/api/balance', async (req, res) => {
    try {
        const balance = await getBalance();
        res.json({ success: true, data: balance });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Daily totals for charts
app.get('/api/daily-totals', async (req, res) => {
    try {
        const { start, end } = req.query;
        const s = start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const e = end || new Date().toISOString().slice(0, 10);
        const data = await expenseQueries.getDailyTotals(s, e);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// START SERVER & BOT
// ============================================

async function startApp() {
    try {
        // Initialize PostgreSQL
        await initDB();

        app.listen(PORT, () => {
            console.log(`\n🚀 ═══════════════════════════════════════════`);
            console.log(`   KOS FINANCE APP — Server berjalan!`);
            console.log(`   🌐 Dashboard: http://localhost:${PORT}`);
            console.log(`   📡 API: http://localhost:${PORT}/api`);
            console.log(`═══════════════════════════════════════════════\n`);

            // Start Telegram Bot
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (botToken && botToken !== 'GANTI_DENGAN_TOKEN_BOT_TELEGRAM') {
                try {
                    const bot = createBot(botToken);
                    initScheduler(bot);
                    console.log('🤖 Telegram Bot: AKTIF');
                } catch (err) {
                    console.log('⚠️ Telegram Bot gagal start:', err.message);
                }
            } else {
                console.log('⚠️ Telegram Bot: TIDAK AKTIF (token belum diset di .env)');
                console.log('   Untuk mengaktifkan:');
                console.log('   1. Buat bot di @BotFather di Telegram');
                console.log('   2. Copy token ke file .env');
                console.log('   3. Restart server\n');
            }
        });
    } catch (e) {
        console.error("Critical Failure:", e);
        process.exit(1);
    }
}

startApp();
