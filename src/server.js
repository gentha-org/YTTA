require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const { 
    memberQueries, expenseQueries, contributionQueries, 
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

// File upload config
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
app.get('/api/dashboard', (req, res) => {
    try {
        const data = getDashboardData();
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Members
app.get('/api/members', (req, res) => {
    const members = memberQueries.getAll.all();
    res.json({ success: true, data: members });
});

// Expenses
app.get('/api/expenses', (req, res) => {
    const { start, end, category, limit } = req.query;
    let expenses;
    
    if (start && end) {
        expenses = expenseQueries.getByDateRange.all(start, end);
    } else if (category) {
        expenses = expenseQueries.getByCategory.all(category);
    } else if (limit) {
        expenses = expenseQueries.getRecent.all(parseInt(limit));
    } else {
        expenses = expenseQueries.getAll.all();
    }
    
    res.json({ success: true, data: expenses });
});

// Add expense
app.post('/api/expenses', (req, res) => {
    try {
        const { date, description, category, amount, paid_by, source } = req.body;
        const cat = category || autoCategorizee(description);
        const today = date || new Date().toISOString().slice(0, 10);
        
        const result = expenseQueries.insert.run(
            today, description, cat, amount,
            paid_by || null, null, null, source || 'web'
        );

        res.json({ 
            success: true, 
            data: { id: result.lastInsertRowid },
            message: 'Pengeluaran berhasil ditambahkan'
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete expense
app.delete('/api/expenses/:id', (req, res) => {
    try {
        expenseQueries.deleteById.run(parseInt(req.params.id));
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
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Contributions
app.get('/api/contributions', (req, res) => {
    const { month } = req.query;
    const currentMonth = month || new Date().toISOString().slice(0, 7);
    const status = contributionQueries.getStatusByMonth.all(currentMonth);
    const total = contributionQueries.getTotalByMonth.get(currentMonth);
    res.json({ success: true, data: { status, total: total?.total || 0, month: currentMonth } });
});

app.post('/api/contributions', (req, res) => {
    try {
        const { member_id, amount, month, notes } = req.body;
        const m = month || new Date().toISOString().slice(0, 7);
        contributionQueries.insert.run(member_id, amount, m, notes || null);
        res.json({ success: true, message: 'Iuran berhasil dicatat' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Summary endpoints
app.get('/api/summary/weekly', (req, res) => {
    const data = expenseQueries.getWeeklySummary.all();
    res.json({ success: true, data });
});

app.get('/api/summary/monthly', (req, res) => {
    const data = expenseQueries.getMonthlySummary.all();
    res.json({ success: true, data });
});

app.get('/api/summary/categories', (req, res) => {
    const data = expenseQueries.getCategorySummary.all();
    res.json({ success: true, data });
});

app.get('/api/summary/members', (req, res) => {
    const data = expenseQueries.getMemberSummary.all();
    res.json({ success: true, data });
});

// Debts
app.get('/api/debts', (req, res) => {
    const debts = debtQueries.getActive.all();
    res.json({ success: true, data: debts });
});

app.post('/api/debts', (req, res) => {
    try {
        const { from_member_id, to_member_id, amount, reason } = req.body;
        debtQueries.insert.run(from_member_id, to_member_id, amount, reason || null);
        res.json({ success: true, message: 'Hutang tercatat' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/debts/:id/settle', (req, res) => {
    try {
        debtQueries.settle.run(parseInt(req.params.id));
        res.json({ success: true, message: 'Hutang dilunasi' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/ping-debt', (req, res) => {
    try {
        const { id } = req.body;
        const debts = debtQueries.getActive.all();
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
app.get('/api/settings', (req, res) => {
    const settings = settingQueries.getAll.all();
    const obj = {};
    settings.forEach(s => { obj[s.key] = s.value; });
    res.json({ success: true, data: obj });
});

app.put('/api/settings', (req, res) => {
    try {
        const updates = req.body;
        Object.entries(updates).forEach(([key, value]) => {
            setSetting(key, value);
        });
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
app.get('/api/balance', (req, res) => {
    const balance = getBalance();
    res.json({ success: true, data: balance });
});

// Daily totals for charts
app.get('/api/daily-totals', (req, res) => {
    const { start, end } = req.query;
    const s = start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const e = end || new Date().toISOString().slice(0, 10);
    const data = expenseQueries.getDailyTotals.all(s, e);
    res.json({ success: true, data });
});

// ============================================
// START SERVER & BOT
// ============================================

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
