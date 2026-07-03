import { html } from '../lib/dom.js';
import { formatCurrency, formatNumber, formatVNDShort, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { paged } from '../components/data-table.js';
import { qlNav, channelOf, CHANNEL_LABEL, CHANNEL_NOUN } from '../components/ql-nav.js';
import { salesMatrixHtml } from '../components/sales-matrix.js';
import { loadChartLib, chartRegistry } from '../components/chart.js';

// ─── Tổng quan QUẢN LÝ KÊNH (port từ npp quan-ly.js, channel-aware ?k=) ─────
const charts = chartRegistry();
let _rows = [];
let _k = 'npp';

const RANK_BADGE = { A: 'success', B: 'primary', C: 'muted' };
const SEGMENT_BADGE = { 'Mới': 'primary', 'Tăng trưởng': 'success', 'Ổn định': 'muted', 'Suy giảm': 'warning', 'Ngủ đông': 'warning', 'Mất': 'danger', 'Chưa mua': 'muted' };

export async function render({ container, query }) {
    _k = channelOf(query);
    const noun = CHANNEL_NOUN[_k];
    container.innerHTML = html`
        ${banner({ title: `Quản lý kênh ${CHANNEL_LABEL[_k]}`, subtitle: `Phân tích doanh số & sức khỏe ${noun} toàn kênh` })}
        ${qlNav('ov', _k)}
        <div id="kd-ql-risk"></div>
        <div class="kd-flex kd-justify-between kd-items-center">
            <h3 class="kd-font-bold">Tổng quan</h3>
            <select id="kd-ql-period" style="padding:8px 12px;border-radius:10px;border:1px solid var(--kd-border);background:var(--kd-surface);font-weight:600;color:var(--kd-text);">
                <option value="1">Tháng này</option>
                <option value="3" selected>3 tháng</option>
                <option value="6">6 tháng</option>
                <option value="12">12 tháng</option>
            </select>
        </div>
        <div class="kd-kpi-grid" id="kd-ql-kpis">
            ${'<div class="kd-skeleton" style="height:92px;"></div>'.repeat(6)}
        </div>
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Xu hướng doanh số &amp; sản lượng</h3>
            <div class="kd-chart-wrap"><canvas id="kd-ql-trend"></canvas></div></div>
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Cơ cấu nhóm hàng</h3>
            <div class="kd-chart-wrap"><canvas id="kd-ql-group"></canvas></div></div>
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Top 10 ${noun} theo doanh số</h3>
            <div class="kd-chart-wrap"><canvas id="kd-ql-top"></canvas></div></div>

        <div id="kd-ql-matrix" class="kd-mt-3"><div class="kd-skeleton" style="height:240px;"></div></div>

        <div class="kd-grid-2 kd-mt-3">
            <div class="kd-card"><h3 class="kd-font-bold">Phân khúc vòng đời ${noun}</h3><div id="kd-ql-seg" class="kd-mt-2"></div></div>
            <div class="kd-card"><h3 class="kd-font-bold">Mức độ tập trung (Pareto)</h3><div id="kd-ql-conc" class="kd-mt-2"></div></div>
        </div>

        <div class="kd-card kd-mt-3">
            <h3 class="kd-font-bold">Danh sách ${noun}</h3>
            <div class="kd-ql-filters kd-mt-3">
                <input id="kd-ql-search" class="kd-dh-search" placeholder="Tìm ${noun}...">
                <select id="kd-ql-f-rank"><option value="">Mọi hạng</option><option value="A">Hạng A</option><option value="B">Hạng B</option><option value="C">Hạng C</option></select>
                <select id="kd-ql-f-seg"><option value="">Mọi phân khúc</option><option>Mới</option><option>Tăng trưởng</option><option>Ổn định</option><option>Suy giảm</option><option>Ngủ đông</option><option>Mất</option><option>Chưa mua</option></select>
            </div>
            <div id="kd-ql-table" class="kd-mt-3"><div class="kd-skeleton" style="height:240px;"></div></div>
        </div>
    `;

    document.getElementById('kd-ql-period').addEventListener('change', (e) => loadData(parseInt(e.target.value, 10) || 3));
    ['kd-ql-search', 'kd-ql-f-rank', 'kd-ql-f-seg'].forEach((id) =>
        document.getElementById(id).addEventListener('input', applyFilters));
    await loadData(3);
    loadMatrix();   // bảng DS theo tháng — theo năm tài chính, độc lập bộ lọc kỳ
}

async function loadMatrix() {
    const root = document.getElementById('kd-ql-matrix');
    if (!root) return;
    try {
        const d = await api.mgr.salesMatrix(_k);
        root.innerHTML = salesMatrixHtml(d, {
            showKpis: false, title: `Doanh số từng ${CHANNEL_NOUN[_k]} theo tháng`, showMeta: true,
            detailHref: (c) => `#/ql-khach?k=${_k}&c=${encodeURIComponent(c)}`,
        });
    } catch (err) {
        root.innerHTML = `<div class="kd-card"><div class="kd-text-muted">Không tải được bảng doanh số tháng: ${escapeHtml(err.message)}</div></div>`;
    }
}

async function loadData(months) {
    try {
        const Chart = await loadChartLib();
        const data = await api.mgr.overview(_k, months);
        _rows = data.customers || [];
        renderKpis(data);
        renderRisk(data.risk || {});
        renderSeg(data.segments || {});
        renderConc(data.concentration || {});
        charts.destroy();
        renderCharts(Chart, data);
        applyFilters();
    } catch (err) {
        document.getElementById('kd-ql-kpis').innerHTML =
            `<div class="kd-empty" style="grid-column:1/-1;"><div class="kd-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
        document.getElementById('kd-ql-table').innerHTML = '';
    }
}

function pct(v) {
    if (v === null || v === undefined) return '<span class="kd-text-muted">—</span>';
    const up = v >= 0;
    return `<span style="color:${up ? 'var(--kd-success)' : 'var(--kd-danger)'};font-weight:800;">${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
}

function renderRisk(r) {
    const root = document.getElementById('kd-ql-risk');
    if (!root) return;
    if (!(r.overdue > 0)) { root.innerHTML = ''; return; }
    root.innerHTML = html`
        <div class="kd-risk-bar">
            <span>🚨 <strong>Cảnh báo dòng tiền</strong></span>
            <span>Nợ quá hạn: <strong>${formatVNDShort(r.overdue || 0)}</strong></span>
            <span>Quá 90 ngày: <strong>${formatVNDShort(r.over_90 || 0)}</strong></span>
            <span>DSO: <strong>~${Math.round(r.dso || 0)} ngày</strong></span>
        </div>`;
}

function renderKpis(d) {
    const t = d.totals || {};
    const g = d.growth || {};
    const noun = CHANNEL_NOUN[_k];
    const label = d.months === 1 ? 'tháng này, đến nay' : `${d.months} tháng, đến nay`;
    document.getElementById('kd-ql-kpis').innerHTML = html`
        <div class="kd-kpi-card">
            <div class="kd-kpi-label">Doanh số (${label})</div>
            <div class="kd-kpi-value">${formatVNDShort(t.revenue || 0)}</div>
            <div class="kd-kpi-sub">${pct(g.growth_pct)} vs kỳ trước · ${pct(g.yoy_pct)} vs năm trước <span class="kd-text-muted">(cùng số ngày)</span></div>
        </div>
        <div class="kd-kpi-card">
            <div class="kd-kpi-label">Run-rate tháng này</div>
            <div class="kd-kpi-value">${formatVNDShort(t.run_rate || 0)}</div>
            <div class="kd-kpi-sub">Ước tính cả tháng theo nhịp hiện tại</div>
        </div>
        <div class="kd-kpi-card">
            <div class="kd-kpi-label">Sản lượng</div>
            <div class="kd-kpi-value">${formatNumber(t.qty || 0)} <span style="font-size:.8rem;font-weight:600;">thùng</span></div>
            <div class="kd-kpi-sub">${formatNumber(t.orders || 0)} đơn · TB/đơn ${formatVNDShort(t.aov || 0)}</div>
        </div>
        <div class="kd-kpi-card">
            <div class="kd-kpi-label">${noun} hoạt động</div>
            <div class="kd-kpi-value">${formatNumber(t.active || 0)}<span style="font-size:.8rem;font-weight:600;">/${formatNumber(t.npp_count || 0)}</span></div>
            <div class="kd-kpi-sub">😴 ${formatNumber(t.dormant || 0)} ngủ đông · 🆕 ${formatNumber(t.new || 0)} mới</div>
        </div>
        <div class="kd-kpi-card">
            <div class="kd-kpi-label">Tổng công nợ</div>
            <div class="kd-kpi-value danger">${formatVNDShort(t.debt || 0)}</div>
            <div class="kd-kpi-sub">DSO ~${Math.round(t.dso || 0)} ngày · số dư GL</div>
        </div>
        <div class="kd-kpi-card">
            <div class="kd-kpi-label">Cần thanh toán</div>
            <div class="kd-kpi-value warning">${formatVNDShort(t.required_payment || 0)}</div>
            <div class="kd-kpi-sub">Chính sách ${d.policy === 'tet' ? 'Tết' : 'thường'}</div>
        </div>
    `;
}

function renderCharts(Chart, d) {
    const m = d.monthly || [];
    charts.add(new Chart(document.getElementById('kd-ql-trend'), {
        data: {
            labels: m.map((x) => x.month),
            datasets: [
                { type: 'bar',  label: 'Số thùng', data: m.map((x) => x.qty),     backgroundColor: 'rgba(16,185,129,0.45)', yAxisID: 'y1', order: 3 },
                { type: 'line', label: 'Doanh số', data: m.map((x) => x.revenue), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)', tension: 0.3, fill: true, yAxisID: 'y', order: 1 },
                { type: 'line', label: 'Cùng kỳ năm trước', data: m.map((x) => x.revenue_ly || 0), borderColor: '#94a3b8', borderDash: [5, 5], tension: 0.3, fill: false, yAxisID: 'y', order: 2 },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => c.dataset.yAxisID === 'y' ? `${c.dataset.label}: ${formatCurrency(c.parsed.y)}` : `Thùng: ${formatNumber(c.parsed.y)}` } } },
            scales: { y: { position: 'left', ticks: { callback: (v) => formatVNDShort(v) } }, y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => formatNumber(v) } } },
        },
    }));

    const grp = d.by_group || [];
    charts.add(new Chart(document.getElementById('kd-ql-group'), {
        type: 'doughnut',
        data: { labels: grp.map((x) => x.item_group), datasets: [{ data: grp.map((x) => x.revenue), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${formatCurrency(c.parsed)}` } } } },
    }));

    const top = [...(d.customers || [])].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    charts.add(new Chart(document.getElementById('kd-ql-top'), {
        type: 'bar',
        data: { labels: top.map((x) => x.customer_name), datasets: [{ label: 'Doanh số', data: top.map((x) => x.revenue), backgroundColor: '#3b82f6' }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatCurrency(c.parsed.x) } } }, scales: { x: { ticks: { callback: (v) => formatVNDShort(v) } } } },
    }));
}

function applyFilters() {
    const q = (document.getElementById('kd-ql-search').value || '').toLowerCase().trim();
    const fRank = document.getElementById('kd-ql-f-rank').value;
    const fSeg = document.getElementById('kd-ql-f-seg').value;
    let rows = _rows.filter((r) =>
        (!q || (r.customer_name || '').toLowerCase().includes(q) || (r.customer || '').toLowerCase().includes(q)) &&
        (!fRank || r.rank === fRank) &&
        (!fSeg || r.segment === fSeg));
    rows = rows.sort((a, b) => b.revenue - a.revenue);
    renderTable(rows);
}

function renderTable(rows) {
    const root = document.getElementById('kd-ql-table');
    if (!root) return;
    const noun = CHANNEL_NOUN[_k];
    if (!rows.length) { root.innerHTML = `<div class="kd-text-muted kd-text-center" style="padding:1rem;">Không có ${noun} phù hợp</div>`; return; }
    root.innerHTML = paged({
        rows,
        pageSize: 10,
        render: (slice) => html`
        <div style="overflow-x:auto;"><table class="kd-table">
            <thead><tr>
                <th>${noun}</th><th>Tỉnh</th><th>Hạng</th>
                <th class="kd-text-end">Doanh số</th><th class="kd-text-end">Công nợ</th><th class="kd-text-end">Cần TT</th>
                <th>Phân khúc</th><th>Chu kỳ</th><th></th>
            </tr></thead>
            <tbody>
                ${slice.map((r) => html`<tr>
                    <td data-label="${noun}"><strong>${escapeHtml(r.customer_name)}</strong>${r.is_new ? ' <span class="kd-badge kd-badge-primary">Mới</span>' : ''}<div class="kd-text-sm kd-text-muted">${escapeHtml(r.customer)}</div></td>
                    <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                    <td data-label="Hạng"><span class="kd-badge kd-badge-${RANK_BADGE[r.rank] || 'muted'}">${r.rank}</span></td>
                    <td data-label="Doanh số" class="kd-text-end">${formatCurrency(r.revenue)}</td>
                    <td data-label="Công nợ" class="kd-text-end">${formatCurrency(r.debt)}</td>
                    <td data-label="Cần TT" class="kd-text-end" style="color:${r.required_payment > 0 ? 'var(--kd-warning)' : 'var(--kd-text-3)'};font-weight:700;">${formatCurrency(r.required_payment)}</td>
                    <td data-label="Phân khúc"><span class="kd-badge kd-badge-${SEGMENT_BADGE[r.segment] || 'muted'}">${escapeHtml(r.segment)}</span></td>
                    <td data-label="Chu kỳ">${r.avg_cycle ? r.avg_cycle + 'd' : '—'}${r.days_since != null ? ' · ' + r.days_since + 'd' : ''}${r.overdue_reorder ? ' ⏰' : ''}</td>
                    <td><button class="kd-btn-primary kd-ql-view" data-c="${escapeHtml(r.customer)}" type="button" style="padding:6px 12px;font-size:.8rem;">Xem</button></td>
                </tr>`).join('')}
            </tbody>
        </table></div>`,
        onDraw: (el) => el.querySelectorAll('.kd-ql-view').forEach((b) =>
            b.addEventListener('click', () => { location.hash = `#/ql-khach?k=${_k}&c=` + encodeURIComponent(b.dataset.c); })),
    });
}

function renderSeg(seg) {
    const root = document.getElementById('kd-ql-seg');
    if (!root) return;
    const order = ['Mới', 'Tăng trưởng', 'Ổn định', 'Suy giảm', 'Ngủ đông', 'Mất', 'Chưa mua'];
    root.innerHTML = order.map((k) => `<div class="kd-flex kd-justify-between" style="padding:6px 0;border-bottom:1px solid var(--kd-border);">
        <span class="kd-badge kd-badge-${SEGMENT_BADGE[k] || 'muted'}">${k}</span><strong>${(seg && seg[k]) || 0}</strong></div>`).join('');
}

function renderConc(c) {
    const root = document.getElementById('kd-ql-conc');
    if (!root) return;
    c = c || {};
    const noun = CHANNEL_NOUN[_k];
    root.innerHTML = `
        <div class="kd-flex kd-justify-between" style="padding:6px 0;border-bottom:1px solid var(--kd-border);"><span>Top 5 ${noun} đóng góp</span><strong>${(c.top5_pct || 0).toFixed(0)}%</strong></div>
        <div class="kd-flex kd-justify-between" style="padding:6px 0;border-bottom:1px solid var(--kd-border);"><span>Top 10 ${noun} đóng góp</span><strong>${(c.top10_pct || 0).toFixed(0)}%</strong></div>
        <div class="kd-flex kd-justify-between" style="padding:6px 0;"><span>Số ${noun} tạo 80% doanh số</span><strong>${c.npp_for_80 || 0}</strong></div>`;
}
