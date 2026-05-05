// Global Variables
const API_URL = 'http://localhost:3000/api';
let charts = {};
let systemMembers = [];

// Format helpers
const formatRp = (num) => 'Rp ' + parseInt(num).toLocaleString('id-ID');
const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('id-ID', { 
        day: 'numeric', month: 'short', year: 'numeric' 
    });
};

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Set Date Header
    document.getElementById('current-date').innerText = new Date().toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    // Navigation setup
    setupNavigation();
    
    // Load default view data
    loadDashboard();
    loadMembersForSelects();
    loadSettings();
    
    // Set default date input to today
    document.getElementById('exp-date').valueAsDate = new Date();
});

// ==========================================
// Navigation & Modals
// ==========================================
function setupNavigation() {
    const links = document.querySelectorAll('.nav-links a');
    links.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            // Update active styling
            document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
            const parent = e.currentTarget.parentElement;
            if(parent) parent.classList.add('active');
            
            // Switch view
            const target = e.currentTarget.getAttribute('data-target');
            switchView(target);
        });
    });
}

function switchView(viewId) {
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');

    // Trigger load data based on view
    if (viewId === 'dashboard') loadDashboard();
    else if (viewId === 'transaksi') loadExpenses();
    else if (viewId === 'iuran') loadContributions();
    else if (viewId === 'hutang') loadDebts();
    else if (viewId === 'pengaturan') loadSettings();
}

function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

// Close modals when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
}

// ==========================================
// Load Data Functions
// ==========================================

async function loadMembersForSelects() {
    try {
        const res = await fetch(`${API_URL}/members`);
        const data = await res.json();
        if (data.success) {
            systemMembers = data.data;
            let options = '<option value="">Pilih Anggota</option>';
            systemMembers.forEach(m => {
                options += `<option value="${m.id}">${m.name}</option>`;
            });
            
            // Populate all member selects
            document.getElementById('exp-member').innerHTML = options;
            document.getElementById('scan-member').innerHTML = options;
            document.getElementById('contrib-member').innerHTML = options;
            document.getElementById('debt-from').innerHTML = options;
            document.getElementById('debt-to').innerHTML = options;
        }
    } catch (e) {
        console.error("Error loading members", e);
    }
}

async function loadDashboard() {
    try {
        const res = await fetch(`${API_URL}/dashboard`);
        const json = await res.json();
        
        if (!json.success) throw new Error(json.error);
        const data = json.data;

        // Update Stats
        document.getElementById('stat-balance').innerText = formatRp(data.balance.balance);
        document.getElementById('stat-month-total').innerText = formatRp(data.monthTotal);
        document.getElementById('stat-week-total').innerText = formatRp(data.weekTotal);
        
        const pct = data.budgetPercentage || 0;
        document.getElementById('stat-budget-pct').innerText = `${pct}%`;
        const pBar = document.getElementById('budget-progress');
        pBar.style.width = `${Math.min(pct, 100)}%`;
        if(pct > 90) pBar.style.background = 'var(--danger)';
        else pBar.style.background = 'linear-gradient(90deg, var(--primary), var(--secondary))';

        const weekPct = data.weeklyBudgetPercentage || 0;
        document.getElementById('stat-week-pct').innerText = `${weekPct}% (${formatRp(data.weekTotal)})`;
        const wpBar = document.getElementById('weekly-budget-progress');
        wpBar.style.width = `${Math.min(weekPct, 100)}%`;
        if(weekPct > 90) wpBar.style.background = 'var(--danger)';
        else wpBar.style.background = 'linear-gradient(90deg, var(--warning), #fbbf24)';

        // Update Recent Table
        const tbody = document.querySelector('#recent-expenses-table tbody');
        if (data.recentExpenses.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">Belum ada transaksi</td></tr>';
        } else {
            tbody.innerHTML = data.recentExpenses.map(e => `
                <tr>
                    <td>${formatDate(e.date)}</td>
                    <td><b>${e.description}</b></td>
                    <td><span class="badge" style="padding:4px 8px; border-radius:4px; background:rgba(255,255,255,0.1); font-size:0.8rem;">${e.category}</span></td>
                    <td class="text-right text-warning"><b>${formatRp(e.amount)}</b></td>
                    <td>${e.paid_by_name || '-'}</td>
                </tr>
            `).join('');
        }

        // Update Leaderboard
        if (data.memberData && data.memberData.length > 0) {
            const boros = data.memberData[0];
            const hemat = data.memberData[data.memberData.length - 1];

            document.getElementById('leader-boros-name').innerText = boros.name;
            document.getElementById('leader-boros-amount').innerText = formatRp(boros.total);

            document.getElementById('leader-hemat-name').innerText = hemat.name;
            document.getElementById('leader-hemat-amount').innerText = formatRp(hemat.total);
        }

        if (data.weeklyMemberData && data.weeklyMemberData.length > 0) {
            const wBoros = data.weeklyMemberData[0];
            const wHemat = data.weeklyMemberData[data.weeklyMemberData.length - 1];

            document.getElementById('leader-week-boros-name').innerText = wBoros.name;
            document.getElementById('leader-week-boros-amount').innerText = formatRp(wBoros.total);

            document.getElementById('leader-week-hemat-name').innerText = wHemat.name;
            document.getElementById('leader-week-hemat-amount').innerText = formatRp(wHemat.total);
        }

        // --- Render Charts ---
        renderCategoryChart(data.categoryData);
        renderMemberChart(data.memberData);
        
        // Fetch daily trend separatedly (last 30 days)
        fetch(`${API_URL}/daily-totals`)
            .then(r => r.json())
            .then(td => {
                if(td.success) renderTrendChart(td.data);
            });

    } catch (error) {
        console.error('Failed to load dashboard:', error);
    }
}

async function loadExpenses() {
    try {
        const catFilter = document.getElementById('filter-category').value;
        const url = catFilter ? `${API_URL}/expenses?category=${encodeURIComponent(catFilter)}` : `${API_URL}/expenses`;
        
        const res = await fetch(url);
        const json = await res.json();
        
        const tbody = document.querySelector('#all-expenses-table tbody');
        if (json.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">Belum ada transaksi</td></tr>';
        } else {
            tbody.innerHTML = json.data.map(e => `
                <tr>
                    <td>${formatDate(e.date)}</td>
                    <td>${e.description}</td>
                    <td>${e.category}</td>
                    <td class="text-right"><b>${formatRp(e.amount)}</b></td>
                    <td>${e.paid_by_name || '-'}</td>
                    <td>${e.source === 'scan' ? '📷 Scan' : '✏️ Manual'}</td>
                    <td>
                        <button onclick="deleteExpense(${e.id})" class="btn btn-sm btn-secondary" style="color:var(--danger); border-color:rgba(239, 68, 68, 0.3)">Hapus</button>
                    </td>
                </tr>
            `).join('');
        }

        // populate categories filter if empty
        const filterEl = document.getElementById('filter-category');
        if (filterEl.options.length <= 1) {
            // grab unique categories
            const cats = [...new Set(json.data.map(d => d.category))];
            cats.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c; opt.innerText = c;
                filterEl.appendChild(opt);
            });
        }
    } catch (error) {
        console.error('Failed to load expenses', error);
    }
}

async function loadContributions() {
    try {
        const res = await fetch(`${API_URL}/contributions`);
        const json = await res.json();
        const data = json.data.status;
        
        const container = document.getElementById('contribution-status');
        container.innerHTML = data.map(c => `
            <div class="c-card">
                <div>
                    <h3 style="margin-bottom: 5px">${c.name}</h3>
                    <p class="text-muted" style="font-size:0.85rem">${c.paid ? `Dibayar pd: ${formatDate(c.paid_at)}` : 'Tagihan Aktif'}</p>
                </div>
                <div class="c-status">
                    <span class="c-badge ${c.paid ? 'paid' : 'unpaid'}">${c.paid ? 'LUNAS' : 'BELUM BAYAR'}</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error("Failed", err);
    }
}

async function loadDebts() {
    try {
        const res = await fetch(`${API_URL}/debts`);
        const json = await res.json();
        
        const container = document.getElementById('debts-list');
        if (!json.success || json.data.length === 0) {
            container.innerHTML = '<div class="text-center" style="grid-column: 1/-1; padding: 20px;">Belum ada catatan hutang.</div>';
            return;
        }

        container.innerHTML = json.data.map(d => `
            <div class="c-card" style="display:flex; flex-direction:column; gap:10px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <h3 style="margin-bottom: 5px">${d.from_name} <span style="color:var(--text-muted)">➔</span> ${d.to_name}</h3>
                        <h2 class="text-danger">${formatRp(d.amount)}</h2>
                        <p class="text-muted" style="font-size:0.85rem; margin-top:5px;">📅 ${formatDate(d.created_at)}</p>
                        <p class="text-muted" style="font-size:0.85rem">📝 ${d.reason || '-'}</p>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                        <span class="badge" style="background:rgba(239, 68, 68, 0.2); color:var(--danger); font-size:0.75rem; padding:4px 8px; border-radius:4px;">BELUM LUNAS</span>
                        <div style="display:flex; gap:5px; margin-top:10px;">
                            <button class="btn btn-sm btn-secondary" onclick="pingDebt(${d.id})" style="font-size:0.8rem; padding:6px 12px;" title="Kirim notif ke Telegram Grup">🔔 Tagih</button>
                            <button class="btn btn-sm btn-primary" onclick="settleDebt(${d.id})" style="font-size:0.8rem; padding:6px 12px;">Tandai Lunas</button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch(e) {
        console.error("Gagal load hutang", e);
    }
}

async function loadSettings() {
    try {
        const res = await fetch(`${API_URL}/settings`);
        const json = await res.json();
        const data = json.data;
        
        if (data.kos_name) document.getElementById('set-kos-name').value = data.kos_name;
        if (data.monthly_budget) document.getElementById('set-budget').value = data.monthly_budget;
        if (data.weekly_budget) document.getElementById('set-weekly-budget').value = data.weekly_budget;
        if (data.monthly_contribution) document.getElementById('set-contribution').value = data.monthly_contribution;
        
        // Update header UI globally
        if (data.kos_name) {
            document.querySelector('.logo h1').innerText = data.kos_name;
            document.querySelector('.greeting h2').innerText = `Halo, Warga ${data.kos_name}! 👋`;
        }
    } catch (e) {
        console.error(e);
    }
}

// ==========================================
// Chart rendering functions (Chart.js)
// ==========================================
Chart.defaults.color = '#9CA3AF';
Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";

function renderCategoryChart(data) {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    if (charts.category) charts.category.destroy();

    const labels = data.map(d => d.category);
    const values = data.map(d => d.total);
    
    // Vibrant colors for dark mode
    const bgColors = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];

    charts.category = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels.length ? labels : ['Belum Ada Data'],
            datasets: [{
                data: values.length ? values : [1],
                backgroundColor: values.length ? bgColors : ['#4B5563'],
                borderWidth: 0,
                cutout: '65%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, padding: 15 } }
            }
        }
    });
}

function renderMemberChart(data) {
    const ctx = document.getElementById('memberChart').getContext('2d');
    if (charts.member) charts.member.destroy();

    const labels = data.map(d => d.name);
    const values = data.map(d => d.total);

    charts.member = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Pengeluaran (Rp)',
                data: values,
                backgroundColor: 'rgba(59, 130, 246, 0.8)',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function renderTrendChart(data) {
    const ctx = document.getElementById('trendChart').getContext('2d');
    if (charts.trend) charts.trend.destroy();

    const labels = data.map(d => formatDate(d.date).substring(0, 6)); // "12 May"
    const values = data.map(d => d.total);

    // Gradient fill
    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.5)'); // Purple
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.0)');

    charts.trend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Harian',
                data: values,
                borderColor: '#8B5CF6',
                borderWidth: 3,
                backgroundColor: gradient,
                fill: true,
                tension: 0.4 // Smooth curves
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// ==========================================
// Action Functions
// ==========================================

async function submitExpense(e) {
    e.preventDefault();
    const payload = {
        paid_by: document.getElementById('exp-member').value,
        description: document.getElementById('exp-desc').value,
        amount: document.getElementById('exp-amount').value,
        category: document.getElementById('exp-cat').value,
        date: document.getElementById('exp-date').value,
        source: 'web'
    };

    try {
        const res = await fetch(`${API_URL}/expenses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            alert("Pengeluaran tersimpan!");
            closeModal('add-expense-modal');
            document.getElementById('expense-manual').reset();
            loadDashboard(); // Refresh view
            if(document.getElementById('view-transaksi').classList.contains('active')) loadExpenses();
        }
    } catch (err) {
        alert("Gagal menyimpan: " + err.message);
    }
}

async function submitScan(e) {
    e.preventDefault();
    const memberId = document.getElementById('scan-member').value;
    const fileField = document.getElementById('scan-file');
    const btn = document.getElementById('btn-scan');
    
    if(!fileField.files[0]) return alert("Pilih foto dulu");

    const formData = new FormData();
    formData.append('receipt', fileField.files[0]);

    btn.disabled = true;
    btn.innerHTML = '⏳ Menganalisis gambar dengan AI...';

    try {
        const res = await fetch(`${API_URL}/scan`, {
            method: 'POST',
            body: formData
        });
        const json = await res.json();
        
        if(json.success) {
            const data = json.data;
            const resDiv = document.getElementById('scan-result');
            resDiv.classList.remove('hidden');
            
            // Format item list
            const itemsHtml = (data.items || []).map(i => `
                <div class="extracted-item">
                    <span>${i.qty || 1}x ${i.name}</span>
                    <span>${formatRp(i.total || i.price || 0)}</span>
                </div>
            `).join('');

            resDiv.innerHTML = `
                <div class="extracted-data">
                    <p style="margin-bottom: 10px; color: var(--success)">✅ <strong>Berhasil di-extract!</strong></p>
                    <div class="form-group">
                        <label>Deskripsi/Merchant</label>
                        <input type="text" id="scan-confirm-desc" class="input-field" value="${data.description || data.store_name || ''}">
                    </div>
                    <div class="form-group">
                        <label>Kategori</label>
                        <input type="text" id="scan-confirm-cat" class="input-field" value="${data.category_suggestion || 'Lainnya'}">
                    </div>
                    <div class="form-group">
                        <label>Total Jumlah (Rp)</label>
                        <input type="number" id="scan-confirm-amount" class="input-field" value="${data.total || 0}">
                    </div>
                    
                    <div style="margin: 15px 0;">
                        <h4 style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 5px;">ITEMS DITEMUKAN</h4>
                        ${itemsHtml || '<p class="text-muted">Tidak ada rincian item jelas</p>'}
                    </div>

                    <button type="button" class="btn btn-primary full-width" onclick="confirmScanData(${memberId}, '${data.date}')">Konfirmasi Simpan</button>
                </div>
            `;
        } else {
            alert('Gagal scan: ' + json.error);
        }
    } catch(err) {
        alert('Gagal menghubungi server.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="icon">📷</span> Scan Sekarang';
    }
}

async function confirmScanData(memberId, date) {
    const payload = {
        paid_by: memberId,
        description: document.getElementById('scan-confirm-desc').value,
        category: document.getElementById('scan-confirm-cat').value,
        amount: document.getElementById('scan-confirm-amount').value,
        date: date || new Date().toISOString().slice(0,10),
        source: 'scan'
    };

    try {
        const res = await fetch(`${API_URL}/expenses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if(res.ok) {
            alert("Hasil scan tersimpan!");
            closeModal('add-expense-modal');
            document.getElementById('scan-result').classList.add('hidden');
            document.getElementById('scan-form').reset();
            loadDashboard();
        }
    } catch(e) {
        alert('Gagal simpan data konfirmasi');
    }
}

async function submitContribution(e) {
    e.preventDefault();
    const payload = {
        member_id: document.getElementById('contrib-member').value,
        amount: document.getElementById('contrib-amount').value
    };

    try {
        const res = await fetch(`${API_URL}/contributions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if(res.ok) {
            alert("Iuran dicatat!");
            closeModal('add-contribution-modal');
            document.getElementById('contribution-form').reset();
            loadContributions();
            if(document.getElementById('view-dashboard').classList.contains('active')) loadDashboard();
        }
    } catch(e) { alert("Error"); }
}

async function deleteExpense(id) {
    if(confirm("Yakin ingin menghapus pengeluaran ini?")) {
        try {
            await fetch(`${API_URL}/expenses/${id}`, { method: 'DELETE' });
            loadExpenses();
            loadDashboard();
        } catch(e) {}
    }
}

async function submitDebt(e) {
    e.preventDefault();
    const payload = {
        from_member_id: document.getElementById('debt-from').value,
        to_member_id: document.getElementById('debt-to').value,
        amount: document.getElementById('debt-amount').value,
        reason: document.getElementById('debt-reason').value
    };

    if (payload.from_member_id === payload.to_member_id) {
        return alert("Peminjam dan Pemberi tidak boleh orang yang sama!");
    }

    try {
        const res = await fetch(`${API_URL}/debts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if(res.ok) {
            alert("Hutang berhasil dicatat!");
            closeModal('add-debt-modal');
            document.getElementById('debt-form').reset();
            loadDebts();
        } else {
            const err = await res.json();
            alert("Gagal: " + err.error);
        }
    } catch(e) { alert("Error menyimpan hutang"); }
}

async function settleDebt(id) {
    if(confirm("Tandai hutang ini sebagai LUNAS?")) {
        try {
            await fetch(`${API_URL}/debts/${id}/settle`, { method: 'PUT' });
            loadDebts();
        } catch(e) { alert("Error"); }
    }
}

async function pingDebt(id) {
    try {
        const res = await fetch(`${API_URL}/ping-debt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const data = await res.json();
        if(res.ok) alert("Berhasil! " + data.message);
        else alert("Gagal: " + data.error);
    } catch(e) {
        alert("Error menghubungi server.");
    }
}

async function saveSettings(e) {
    e.preventDefault();
    const payload = {
        kos_name: document.getElementById('set-kos-name').value,
        monthly_budget: document.getElementById('set-budget').value,
        weekly_budget: document.getElementById('set-weekly-budget').value,
        monthly_contribution: document.getElementById('set-contribution').value
    };
    try {
        const res = await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if(res.ok) {
            alert("Pengaturan disimpan!");
            // Update UI immediately
            document.querySelector('.logo h1').innerText = payload.kos_name;
            document.querySelector('.greeting h2').innerText = `Halo, Warga ${payload.kos_name}! 👋`;
            loadDashboard(); // Refresh budget bar
        }
    } catch(e) { alert("Error menyimpan pengaturan"); }
}

function exportExcel() {
    window.location.href = `${API_URL}/export/excel`;
}
