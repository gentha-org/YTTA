const ExcelJS = require('exceljs');
const path = require('path');
const { expenseQueries, contributionQueries, memberQueries, getSetting } = require('./database');

/**
 * Generate comprehensive Excel financial report
 */
async function generateReport(month = null) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Kos Finance App';
    workbook.created = new Date();

    // Colors
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a1a2e' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    const subHeaderFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16213e' } };
    const accentFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0f3460' } };
    const currencyFormat = '#,##0';
    const borderStyle = { style: 'thin', color: { argb: 'FF333333' } };
    const borders = { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle };

    // ===== SHEET 1: Semua Transaksi =====
    const wsTransactions = workbook.addWorksheet('Semua Transaksi', {
        properties: { tabColor: { argb: 'FFe94560' } }
    });

    // Title
    wsTransactions.mergeCells('A1:G1');
    const titleCell = wsTransactions.getCell('A1');
    titleCell.value = `📋 LAPORAN KEUANGAN KOS — ${month || 'Semua Periode'}`;
    titleCell.font = { bold: true, size: 16, color: { argb: 'FF1a1a2e' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    wsTransactions.getRow(1).height = 40;

    // Headers
    wsTransactions.columns = [
        { key: 'no', width: 5 },
        { key: 'date', width: 14 },
        { key: 'description', width: 35 },
        { key: 'category', width: 18 },
        { key: 'amount', width: 18 },
        { key: 'paid_by', width: 14 },
        { key: 'source', width: 12 },
    ];

    const headerRow = wsTransactions.addRow(['No', 'Tanggal', 'Deskripsi', 'Kategori', 'Jumlah (Rp)', 'Dibayar Oleh', 'Sumber']);
    headerRow.eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = borders;
    });
    headerRow.height = 28;

    // Data
    let expenses;
    if (month) {
        const startDate = `${month}-01`;
        const endDate = `${month}-31`;
        expenses = await expenseQueries.getByDateRange(startDate, endDate);
    } else {
        expenses = await expenseQueries.getAll();
    }

    let totalAmount = 0;
    expenses.forEach((exp, i) => {
        const row = wsTransactions.addRow([
            i + 1,
            exp.date.toISOString ? exp.date.toISOString().slice(0, 10) : exp.date,
            exp.description,
            exp.category,
            exp.amount,
            exp.paid_by_name || '-',
            exp.source === 'scan' ? '📷 Scan' : '✏️ Manual'
        ]);
        totalAmount += exp.amount;

        row.eachCell(cell => {
            cell.border = borders;
            cell.alignment = { vertical: 'middle' };
        });
        row.getCell(5).numFmt = currencyFormat;
        row.getCell(5).alignment = { horizontal: 'right' };

        // Alternating row colors
        if (i % 2 === 0) {
            row.eachCell(cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
            });
        }
    });

    // Total row
    const totalRow = wsTransactions.addRow(['', '', '', 'TOTAL', totalAmount, '', '']);
    totalRow.eachCell(cell => {
        cell.fill = accentFill;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
        cell.border = borders;
    });
    totalRow.getCell(5).numFmt = currencyFormat;
    totalRow.height = 30;

    // ===== SHEET 2: Ringkasan Mingguan =====
    const wsWeekly = workbook.addWorksheet('Ringkasan Mingguan', {
        properties: { tabColor: { argb: 'FF00b4d8' } }
    });

    wsWeekly.mergeCells('A1:D1');
    wsWeekly.getCell('A1').value = '📈 RINGKASAN PENGELUARAN MINGGUAN';
    wsWeekly.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1a1a2e' } };
    wsWeekly.getRow(1).height = 40;

    wsWeekly.columns = [
        { key: 'week', width: 18 },
        { key: 'start', width: 14 },
        { key: 'end', width: 14 },
        { key: 'total', width: 20 },
    ];

    const weekHeader = wsWeekly.addRow(['Minggu', 'Dari', 'Sampai', 'Total (Rp)']);
    weekHeader.eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { horizontal: 'center' };
        cell.border = borders;
    });

    const weeklyData = await expenseQueries.getWeeklySummary();
    weeklyData.forEach((w, i) => {
        const row = wsWeekly.addRow([w.week, w.week_start, w.week_end, w.total]);
        row.eachCell(cell => { cell.border = borders; });
        row.getCell(4).numFmt = currencyFormat;
        if (i % 2 === 0) {
            row.eachCell(cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F8FF' } };
            });
        }
    });

    // ===== SHEET 3: Per Anggota =====
    const wsMember = workbook.addWorksheet('Per Anggota', {
        properties: { tabColor: { argb: 'FF06d6a0' } }
    });

    wsMember.mergeCells('A1:D1');
    wsMember.getCell('A1').value = '👥 PENGELUARAN PER ANGGOTA';
    wsMember.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1a1a2e' } };
    wsMember.getRow(1).height = 40;

    wsMember.columns = [
        { key: 'name', width: 20 },
        { key: 'total', width: 20 },
        { key: 'count', width: 14 },
        { key: 'avg', width: 20 },
    ];

    const memberHeader = wsMember.addRow(['Anggota', 'Total (Rp)', 'Jumlah Transaksi', 'Rata-rata (Rp)']);
    memberHeader.eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { horizontal: 'center' };
        cell.border = borders;
    });

    const memberData = await expenseQueries.getMemberSummary();
    memberData.forEach((m, i) => {
        const avg = m.count > 0 ? Math.round(m.total / m.count) : 0;
        const row = wsMember.addRow([m.name, m.total, m.count, avg]);
        row.eachCell(cell => { cell.border = borders; });
        row.getCell(2).numFmt = currencyFormat;
        row.getCell(4).numFmt = currencyFormat;
    });

    // ===== SHEET 4: Per Kategori =====
    const wsCategory = workbook.addWorksheet('Per Kategori', {
        properties: { tabColor: { argb: 'FFffd166' } }
    });

    wsCategory.mergeCells('A1:C1');
    wsCategory.getCell('A1').value = '🏷️ PENGELUARAN PER KATEGORI';
    wsCategory.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1a1a2e' } };
    wsCategory.getRow(1).height = 40;

    wsCategory.columns = [
        { key: 'category', width: 25 },
        { key: 'total', width: 20 },
        { key: 'count', width: 14 },
    ];

    const catHeader = wsCategory.addRow(['Kategori', 'Total (Rp)', 'Jumlah Transaksi']);
    catHeader.eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { horizontal: 'center' };
        cell.border = borders;
    });

    const catData = await expenseQueries.getCategorySummary();
    catData.forEach((c, i) => {
        const row = wsCategory.addRow([c.category, c.total, c.count]);
        row.eachCell(cell => { cell.border = borders; });
        row.getCell(2).numFmt = currencyFormat;
    });

    // Save to buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

/**
 * Save report to file
 */
async function saveReport(filePath, month = null) {
    const workbook = await generateReport(month);
    const ExcelJSWorkbook = new ExcelJS.Workbook();
    await ExcelJSWorkbook.xlsx.load(workbook);
    await ExcelJSWorkbook.xlsx.writeFile(filePath);
    return filePath;
}

module.exports = { generateReport, saveReport };
