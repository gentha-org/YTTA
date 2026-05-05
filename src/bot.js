const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');
const { 
    memberQueries, expenseQueries, contributionQueries, 
    debtQueries, getSetting, setSetting, getBalance 
} = require('./database');
const { scanReceipt, parseManualInput, autoCategorizee } = require('./ocr');
const { generateReport } = require('./excel');

// Pastikan folder uploads ada (Untuk temporary file)
const uploadsDir = path.join(__dirname, '..', 'uploads', 'receipts');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

let bot = null;

function createBot(token) {
    bot = new TelegramBot(token, { polling: true });
    
    console.log('🤖 Telegram Bot started!');

    // ============================================
    // /start - Welcome message
    // ============================================
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const name = msg.from.first_name;
        
        bot.sendMessage(chatId, 
`🏠 *Selamat datang di KOS FINANCE BOT!*

Halo ${name}! Saya bot untuk mengelola keuangan kos bersama.

📋 *Perintah yang tersedia:*

💰 *Pencatatan:*
/tambah [jumlah] [keterangan] — Input pengeluaran
/scan — Balas foto nota untuk scan otomatis  
/kategori — Lihat daftar kategori

📊 *Laporan:*
/saldo — Cek saldo patungan
/pengeluaran — Ringkasan pengeluaran bulan ini
/minggu — Pengeluaran minggu ini
/excel — Download laporan Excel

👥 *Anggota:*
/iuran — Status iuran bulan ini
/bayar [jumlah] — Catat iuran kamu
/hutang — Cek status hutang
/anggota — Daftar anggota

⚙️ *Pengaturan:*
/setiuran [jumlah] — Set iuran bulanan
/setbudget [jumlah] — Set budget bulanan
/daftar — Daftar diri ke sistem

📷 *Scan Nota:*
Cukup kirim foto nota/struk ke bot ini!

🌐 *Dashboard:* http://localhost:${process.env.PORT || 3000}`,
            { parse_mode: 'Markdown' }
        );
    });

    // ============================================
    // Auto-register: /daftar
    // ============================================
    bot.onText(/\/daftar/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = String(msg.from.id);
        const username = msg.from.username || '';
        const name = msg.from.first_name;

        // Check if already registered
        const existing = await memberQueries.getByTelegramId(telegramId);
        if (existing) {
            bot.sendMessage(chatId, `✅ Kamu sudah terdaftar sebagai *${existing.name}*`, { parse_mode: 'Markdown' });
            return;
        }

        // Try to match by name
        const members = await memberQueries.getAll();

        bot.sendMessage(chatId, 
`👋 Halo ${name}!

Silakan pilih nama kamu dari daftar anggota:
${members.map((m, i) => `${i + 1}. ${m.name}`).join('\n')}

Balas dengan angka (1-${members.length}):`,
        );

        // Listen for reply
        bot.once('message', async (reply) => {
            if (reply.from.id !== msg.from.id) return;
            
            const choice = parseInt(reply.text);
            if (choice >= 1 && choice <= members.length) {
                const selected = members[choice - 1];
                await memberQueries.updateTelegramId(telegramId, username, selected.id);
                bot.sendMessage(chatId, `✅ Berhasil! Kamu terdaftar sebagai *${selected.name}*`, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, '❌ Pilihan tidak valid. Coba lagi dengan /daftar');
            }
        });
    });

    // ============================================
    // /tambah [jumlah] [keterangan]
    // ============================================
    bot.onText(/\/tambah (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const telegramId = String(msg.from.id);
        const input = match[1];
        
        const member = await memberQueries.getByTelegramId(telegramId);
        if (!member) {
            bot.sendMessage(chatId, '⚠️ Kamu belum terdaftar! Gunakan /daftar dulu.');
            return;
        }

        const parsed = parseManualInput(input);
        if (!parsed) {
            bot.sendMessage(chatId, '❌ Format salah. Gunakan: /tambah [jumlah] [keterangan]\nContoh: /tambah 50000 beli sabun');
            return;
        }

        const category = autoCategorizee(parsed.description);
        const today = new Date().toISOString().slice(0, 10);

        try {
            await expenseQueries.insert(
                today, parsed.description, category, parsed.amount,
                member.id, null, null, 'manual'
            );

            const balance = await getBalance();
            
            bot.sendMessage(chatId, 
`✅ *Pengeluaran tercatat!*

📝 ${parsed.description}
💰 Rp ${parsed.amount.toLocaleString('id-ID')}
🏷️ Kategori: ${category}
👤 Oleh: ${member.name}
📅 ${today}

📊 Total bulan ini: Rp ${balance.expenses.toLocaleString('id-ID')}`,
                { parse_mode: 'Markdown' }
            );

            // Notify group if exists
            notifyGroup(`📝 *Pengeluaran Baru*\n\n${parsed.description}\n💰 Rp ${parsed.amount.toLocaleString('id-ID')}\n👤 ${member.name}\n🏷️ ${category}`);

        } catch (err) {
            bot.sendMessage(chatId, '❌ Error menyimpan data: ' + err.message);
        }
    });

    // ============================================
    // Photo handler - Auto scan receipt
    // ============================================
    bot.on('photo', async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = String(msg.from.id);

        const member = await memberQueries.getByTelegramId(telegramId);
        if (!member) {
            bot.sendMessage(chatId, '⚠️ Kamu belum terdaftar! Gunakan /daftar dulu.');
            return;
        }

        bot.sendMessage(chatId, '🔍 Sedang scan nota... Mohon tunggu ⏳');

        let localPath = null;
        try {
            // Download photo (get highest resolution)
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            const file = await bot.getFile(photoId);
            const filePath = file.file_path;
            const downloadUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;

            // Download to local temporarily
            const ext = path.extname(filePath) || '.jpg';
            localPath = path.join(uploadsDir, `receipt_${Date.now()}${ext}`);
            
            const https = require('https');
            const fileStream = fs.createWriteStream(localPath);
            
            await new Promise((resolve, reject) => {
                https.get(downloadUrl, (response) => {
                    response.pipe(fileStream);
                    fileStream.on('finish', () => {
                        fileStream.close();
                        resolve();
                    });
                }).on('error', reject);
            });

            // Scan with Gemini Vision (and upload to ImgBB inside scanReceipt)
            const result = await scanReceipt(localPath);

            // Clean up temporary file
            try { fs.unlinkSync(localPath); } catch (e) {}
            localPath = null;

            if (!result.success) {
                bot.sendMessage(chatId, `❌ Gagal scan nota: ${result.error}\n\nCoba kirim foto yang lebih jelas, atau input manual:\n/tambah [jumlah] [keterangan]`);
                return;
            }

            const data = result.data;
            const itemsList = data.items ? data.items.map((item, i) => 
                `  ${i + 1}. ${item.name} — Rp ${(item.total || item.price || 0).toLocaleString('id-ID')}`
            ).join('\n') : 'Tidak ada item terdeteksi';

            // Send confirmation
            bot.sendMessage(chatId, 
`🧾 *Hasil Scan Nota:*

🏪 Toko: ${data.store_name || 'Tidak terdeteksi'}
📅 Tanggal: ${data.date || new Date().toISOString().slice(0, 10)}
🏷️ Kategori: ${data.category_suggestion || 'Lainnya'}

📋 *Items:*
${itemsList}

💰 *TOTAL: Rp ${(data.total || 0).toLocaleString('id-ID')}*

📝 ${data.description || '-'}

Apakah data ini benar?
Balas *YA* untuk simpan, atau *TIDAK* untuk batal.`,
                { parse_mode: 'Markdown' }
            );

            // Wait for confirmation
            bot.once('message', async (reply) => {
                if (reply.from.id !== msg.from.id) return;
                
                const answer = reply.text.toLowerCase().trim();
                if (answer === 'ya' || answer === 'y' || answer === 'yes') {
                    const date = data.date || new Date().toISOString().slice(0, 10);
                    const description = data.description || `Belanja di ${data.store_name || 'toko'}`;
                    const category = data.category_suggestion || 'Lainnya';
                    const amount = data.total || 0;
                    const items = JSON.stringify(data.items || []);
                    
                    // receipt_url is obtained from ImgBB via scanReceipt
                    const receiptImage = data.receipt_url || null;

                    await expenseQueries.insert(
                        date, description, category, amount,
                        member.id, receiptImage, items, 'scan'
                    );

                    const balance = await getBalance();

                    bot.sendMessage(chatId, 
`✅ *Pengeluaran tersimpan!*

💰 Rp ${amount.toLocaleString('id-ID')} — ${description}
👤 Dicatat oleh: ${member.name}

📊 Total bulan ini: Rp ${balance.expenses.toLocaleString('id-ID')}`,
                        { parse_mode: 'Markdown' }
                    );

                    notifyGroup(`📷 *Nota Baru Discan*\n\n${description}\n💰 Rp ${amount.toLocaleString('id-ID')}\n👤 ${member.name}\n🏷️ ${category}`);
                } else {
                    bot.sendMessage(chatId, '❌ Dibatalkan. Kamu bisa kirim ulang foto atau input manual.');
                }
            });

        } catch (err) {
            if (localPath) {
                try { fs.unlinkSync(localPath); } catch (e) {}
            }
            console.error('Photo handler error:', err);
            bot.sendMessage(chatId, '❌ Error memproses foto: ' + err.message);
        }
    });

    // ============================================
    // /saldo - Check balance
    // ============================================
    bot.onText(/\/saldo/, async (msg) => {
        const chatId = msg.chat.id;
        const balance = await getBalance();
        const budget = parseFloat(await getSetting('monthly_budget')) || 0;
        const currentMonth = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        
        let budgetInfo = '';
        if (budget > 0) {
            const pct = Math.round((balance.expenses / budget) * 100);
            const bar = '█'.repeat(Math.min(pct / 5, 20)) + '░'.repeat(Math.max(20 - pct / 5, 0));
            budgetInfo = `\n📊 Budget: ${bar} ${pct}%\n⚠️ Sisa budget: Rp ${(budget - balance.expenses).toLocaleString('id-ID')}`;
        }

        bot.sendMessage(chatId, 
`💰 *Saldo Keuangan Kos*
📅 ${currentMonth}

💵 Total Iuran: Rp ${balance.contributions.toLocaleString('id-ID')}
💸 Total Pengeluaran: Rp ${balance.expenses.toLocaleString('id-ID')}
💰 Sisa Saldo: Rp ${balance.balance.toLocaleString('id-ID')}${budgetInfo}`,
            { parse_mode: 'Markdown' }
        );
    });

    // ============================================
    // /pengeluaran - This month's expenses
    // ============================================
    bot.onText(/\/pengeluaran/, async (msg) => {
        const chatId = msg.chat.id;
        const categoryData = await expenseQueries.getCategorySummary();
        const memberData = await expenseQueries.getMemberSummary();
        const currentMonth = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        const monthTotalRow = await expenseQueries.getThisMonthTotal();
        const monthTotal = monthTotalRow?.total || 0;

        let categoryText = categoryData.map(c => 
            `  🏷️ ${c.category}: Rp ${c.total.toLocaleString('id-ID')} (${c.count}x)`
        ).join('\n') || '  Belum ada pengeluaran';

        let memberText = memberData.map(m => 
            `  👤 ${m.name}: Rp ${m.total.toLocaleString('id-ID')} (${m.count}x)`
        ).join('\n');

        bot.sendMessage(chatId, 
`📊 *Pengeluaran Bulan ${currentMonth}*

💰 Total: Rp ${monthTotal.toLocaleString('id-ID')}
👥 Rata-rata/orang: Rp ${Math.round(monthTotal / 4).toLocaleString('id-ID')}

📂 *Per Kategori:*
${categoryText}

👥 *Per Anggota:*
${memberText}`,
            { parse_mode: 'Markdown' }
        );
    });

    // ============================================
    // /minggu - This week's expenses
    // ============================================
    bot.onText(/\/minggu/, async (msg) => {
        const chatId = msg.chat.id;
        const weekTotalRow = await expenseQueries.getThisWeekTotal();
        const weekTotal = weekTotalRow?.total || 0;
        const recent = await expenseQueries.getRecent(10);
        
        let recentText = recent.map((e, i) => 
            `  ${i + 1}. ${e.description} — Rp ${e.amount.toLocaleString('id-ID')} (${e.paid_by_name || '-'})`
        ).join('\n') || '  Belum ada transaksi';

        bot.sendMessage(chatId, 
`📅 *Pengeluaran Minggu Ini*

💰 Total: Rp ${weekTotal.toLocaleString('id-ID')}
👥 Rata-rata/orang: Rp ${Math.round(weekTotal / 4).toLocaleString('id-ID')}

📋 *Transaksi Terakhir:*
${recentText}`,
            { parse_mode: 'Markdown' }
        );
    });

    // ============================================
    // /iuran - Contribution status
    // ============================================
    bot.onText(/\/iuran/, async (msg) => {
        const chatId = msg.chat.id;
        const currentMonth = new Date().toISOString().slice(0, 7);
        const monthName = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        const status = await contributionQueries.getStatusByMonth(currentMonth);
        const contribution = parseFloat(await getSetting('monthly_contribution')) || 0;

        let statusText = status.map(s => {
            const icon = s.paid ? '✅' : '❌';
            const amount = s.paid ? `Rp ${s.amount.toLocaleString('id-ID')}` : 'Belum bayar';
            return `  ${icon} ${s.name}: ${amount}`;
        }).join('\n');

        let contribInfo = contribution > 0 ? `💵 Iuran/orang: Rp ${contribution.toLocaleString('id-ID')}\n` : '⚠️ Iuran belum diset (gunakan /setiuran)\n';

        bot.sendMessage(chatId, 
`💳 *Status Iuran — ${monthName}*

${contribInfo}
👥 *Status Pembayaran:*
${statusText}`,
            { parse_mode: 'Markdown' }
        );
    });

    // ============================================
    // /bayar [jumlah] - Record contribution
    // ============================================
    bot.onText(/\/bayar(?:\s+(\d+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const telegramId = String(msg.from.id);
        
        const member = await memberQueries.getByTelegramId(telegramId);
        if (!member) {
            bot.sendMessage(chatId, '⚠️ Kamu belum terdaftar! Gunakan /daftar dulu.');
            return;
        }

        const amount = match[1] ? parseInt(match[1]) : parseFloat(await getSetting('monthly_contribution')) || 0;
        if (amount <= 0) {
            bot.sendMessage(chatId, '❌ Masukkan jumlah iuran: /bayar [jumlah]\nContoh: /bayar 200000');
            return;
        }

        const currentMonth = new Date().toISOString().slice(0, 7);

        try {
            await contributionQueries.insert(member.id, amount, currentMonth, null);
            
            bot.sendMessage(chatId, 
`✅ *Iuran Tercatat!*

👤 ${member.name}
💰 Rp ${amount.toLocaleString('id-ID')}
📅 Bulan: ${currentMonth}

Terima kasih sudah bayar iuran! 🙏`,
                { parse_mode: 'Markdown' }
            );

            notifyGroup(`💳 *Iuran Masuk*\n👤 ${member.name}\n💰 Rp ${amount.toLocaleString('id-ID')}`);
        } catch (err) {
            bot.sendMessage(chatId, '❌ Error: ' + err.message);
        }
    });

    // ============================================
    // /excel - Download Excel report
    // ============================================
    bot.onText(/\/excel/, async (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, '📊 Sedang membuat laporan Excel... ⏳');

        try {
            const buffer = await generateReport();
            const fileName = `Laporan_Keuangan_Kos_${new Date().toISOString().slice(0, 10)}.xlsx`;
            
            await bot.sendDocument(chatId, Buffer.from(buffer), {
                caption: '📋 Laporan Keuangan Kos'
            }, {
                filename: fileName,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
        } catch (err) {
            bot.sendMessage(chatId, '❌ Error membuat laporan: ' + err.message);
        }
    });

    // ============================================
    // /hutang - Check debts
    // ============================================
    bot.onText(/\/hutang/, async (msg) => {
        const chatId = msg.chat.id;
        const debts = await debtQueries.getActive();

        if (debts.length === 0) {
            bot.sendMessage(chatId, '✅ Tidak ada hutang aktif! 🎉');
            return;
        }

        let debtText = debts.map((d, i) => 
            `  ${i + 1}. ${d.from_name} → ${d.to_name}: Rp ${d.amount.toLocaleString('id-ID')}\n     📝 ${d.reason || '-'}`
        ).join('\n');

        bot.sendMessage(chatId, 
`💸 *Status Hutang*

${debtText}

Untuk lunas, hubungi admin.`,
            { parse_mode: 'Markdown' }
        );
    });

    // ============================================
    // /anggota - List members  
    // ============================================
    bot.onText(/\/anggota/, async (msg) => {
        const chatId = msg.chat.id;
        const members = await memberQueries.getAll();

        let memberText = members.map((m, i) => {
            const status = m.telegram_id ? '✅ Terdaftar' : '❌ Belum daftar';
            return `  ${i + 1}. ${m.name} — ${status}`;
        }).join('\n');

        bot.sendMessage(chatId, 
`👥 *Anggota Kos*

${memberText}

Belum terdaftar? Gunakan /daftar`,
            { parse_mode: 'Markdown' }
        );
    });

    // ============================================
    // /kategori - List categories
    // ============================================
    bot.onText(/\/kategori/, (msg) => {
        bot.sendMessage(msg.chat.id, 
`🏷️ *Daftar Kategori:*

🍚 Makanan & Minuman
⚡ Listrik
💧 Air
🌐 Internet/WiFi
🧹 Kebersihan
🏠 Perlengkapan Kos
🚑 Kesehatan
🎉 Hiburan
🚗 Transportasi
📦 Lainnya`,
            { parse_mode: 'Markdown' }
        );
    });

    // ============================================
    // /setiuran [jumlah] - Set monthly contribution
    // ============================================
    bot.onText(/\/setiuran (\d+)/, async (msg, match) => {
        const amount = parseInt(match[1]);
        await setSetting('monthly_contribution', amount);
        bot.sendMessage(msg.chat.id, `✅ Iuran bulanan diset: *Rp ${amount.toLocaleString('id-ID')}* /orang`, { parse_mode: 'Markdown' });
    });

    // ============================================
    // /setbudget [jumlah] - Set monthly budget
    // ============================================
    bot.onText(/\/setbudget (\d+)/, async (msg, match) => {
        const amount = parseInt(match[1]);
        await setSetting('monthly_budget', amount);
        bot.sendMessage(msg.chat.id, `✅ Budget bulanan diset: *Rp ${amount.toLocaleString('id-ID')}*`, { parse_mode: 'Markdown' });
    });

    // ============================================
    // Helper: Notify group chat
    // ============================================
    function notifyGroup(message) {
        const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID;
        if (groupChatId && groupChatId !== 'GANTI_DENGAN_CHAT_ID_GRUP') {
            try {
                bot.sendMessage(groupChatId, message, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error('Failed to notify group:', err.message);
            }
        }
    }

    return bot;
}

function getBot() {
    return bot;
}

module.exports = { createBot, getBot };
