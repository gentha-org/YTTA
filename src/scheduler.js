const cron = require('node-cron');
const { memberQueries, contributionQueries, expenseQueries, getSetting } = require('./database');

let bot = null;

function initScheduler(telegramBot) {
    bot = telegramBot;
    const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID;
    
    if (!groupChatId || groupChatId === 'GANTI_DENGAN_CHAT_ID_GRUP') {
        console.log('⚠️ Scheduler: Group chat ID not set, skipping scheduled messages');
        return;
    }

    // ============================================
    // Reminder Iuran - Setiap tanggal 1, jam 09:00
    // ============================================
    cron.schedule('0 9 1 * *', async () => {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const monthName = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        const status = await contributionQueries.getStatusByMonth(currentMonth);
        const contribution = parseFloat(await getSetting('monthly_contribution')) || 0;

        const unpaid = status.filter(s => !s.paid);
        if (unpaid.length === 0) return;

        let unpaidText = unpaid.map(s => `  ❌ ${s.name}`).join('\n');

        bot.sendMessage(groupChatId, 
`🔔 *REMINDER IURAN BULANAN*
📅 ${monthName}

${contribution > 0 ? `💰 Iuran: Rp ${contribution.toLocaleString('id-ID')}/orang` : ''}

Yang belum bayar:
${unpaidText}

Silakan bayar dan catat dengan /bayar [jumlah] 🙏`,
            { parse_mode: 'Markdown' }
        );
    });

    // ============================================
    // Reminder Iuran - Setiap tanggal 5, 10, 15 jam 09:00
    // ============================================
    cron.schedule('0 9 5,10,15 * *', async () => {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const status = await contributionQueries.getStatusByMonth(currentMonth);
        const unpaid = status.filter(s => !s.paid);
        
        if (unpaid.length === 0) return;

        let unpaidNames = unpaid.map(s => s.name).join(', ');
        bot.sendMessage(groupChatId, 
`⏰ Reminder: ${unpaidNames} belum bayar iuran bulan ini ya~ 😊`,
            { parse_mode: 'Markdown' }
        );
    });

    // ============================================
    // Laporan Mingguan - Setiap Minggu jam 20:00
    // ============================================
    cron.schedule('0 20 * * 0', async () => {
        const weekTotalRow = await expenseQueries.getThisWeekTotal();
        const weekTotal = weekTotalRow?.total || 0;
        const categoryData = await expenseQueries.getCategorySummary();
        const memberData = await expenseQueries.getMemberSummary();

        let categoryText = categoryData.slice(0, 5).map(c => 
            `  🏷️ ${c.category}: Rp ${c.total.toLocaleString('id-ID')}`
        ).join('\n') || '  Belum ada pengeluaran';

        bot.sendMessage(groupChatId, 
`📊 *LAPORAN MINGGUAN*
📅 Minggu ini

💰 Total Pengeluaran: Rp ${weekTotal.toLocaleString('id-ID')}
👥 Rata-rata/orang: Rp ${Math.round(weekTotal / 4).toLocaleString('id-ID')}

📂 *Top Kategori:*
${categoryText}

📈 Lihat detail di dashboard: http://localhost:${process.env.PORT || 3000}`,
            { parse_mode: 'Markdown' }
        );
    });

    // ============================================
    // Budget Warning - Cek setiap hari jam 21:00
    // ============================================
    cron.schedule('0 21 * * *', async () => {
        const budget = parseFloat(await getSetting('monthly_budget')) || 0;
        if (budget <= 0) return;

        const monthTotalRow = await expenseQueries.getThisMonthTotal();
        const monthTotal = monthTotalRow?.total || 0;
        const percentage = Math.round((monthTotal / budget) * 100);

        if (percentage >= 90 && percentage < 100) {
            bot.sendMessage(groupChatId, 
`⚠️ *PERINGATAN BUDGET*

Budget bulan ini sudah terpakai ${percentage}%!
💰 Terpakai: Rp ${monthTotal.toLocaleString('id-ID')}
💵 Budget: Rp ${budget.toLocaleString('id-ID')}
📉 Sisa: Rp ${(budget - monthTotal).toLocaleString('id-ID')}

Ayo hemat! 💪`,
                { parse_mode: 'Markdown' }
            );
        } else if (percentage >= 100) {
            bot.sendMessage(groupChatId, 
`🚨 *BUDGET TERLAMPAUI!*

Pengeluaran sudah melebihi budget ${percentage}%!
💸 Terpakai: Rp ${monthTotal.toLocaleString('id-ID')}
💵 Budget: Rp ${budget.toLocaleString('id-ID')}
📉 Over: Rp ${(monthTotal - budget).toLocaleString('id-ID')}

Perlu evaluasi pengeluaran! 📋`,
                { parse_mode: 'Markdown' }
            );
        }
    });

    console.log('📅 Scheduler initialized:');
    console.log('   - Iuran reminder: Tanggal 1, 5, 10, 15 jam 09:00');
    console.log('   - Weekly report: Setiap Minggu jam 20:00');
    console.log('   - Budget check: Setiap hari jam 21:00');
}

module.exports = { initScheduler };
