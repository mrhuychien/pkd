import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { emptyState } from '../components/empty-state.js';
import { dataTable } from '../components/data-table.js';
import { loadChartLib, chartRegistry } from '../components/chart.js';

const charts = chartRegistry();
let _itemGroups = [];

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: '🧧 Theo dõi Tết', subtitle: 'Luỹ kế theo mốc D-N (so mùa công bằng khi Tết nhảy tháng)' })}
        <div class="kd-card">
            <div class="kd-filter-bar">
                <label>Kênh <select id="kd-tet-channel"><option value="">Tất cả</option><option value="npp">NPP</option><option value="mt">MT</option><option value="dulich">Du lịch</option></select></label>
                <label>Nhóm hàng <select id="kd-tet-ig"><option value="">Tất cả</option></select></label>
                <button class="kd-btn-primary" id="kd-tet-run" type="button"><i class="fas fa-rotate"></i> Cập nhật</button>
            </div>
        </div>
        <div id="kd-tet-body" class="kd-mt-3"><div class="kd-skeleton" style="height:360px;"></div></div>
    `;
    try { _itemGroups = (await api.cached.itemGroups()) || []; } catch (e) { _itemGroups = []; }
    const igSel = document.getElementById('kd-tet-ig');
    _itemGroups.forEach((g) => { const o = document.createElement('option'); o.value = g.name; o.textContent = g.name; igSel.appendChild(o); });
    document.getElementById('kd-tet-run').addEventListener('click', load);
    load();
}

async function load() {
    const body = document.getElementById('kd-tet-body');
    body.innerHTML = '<div class="kd-skeleton" style="height:360px;"></div>';
    const channel = document.getElementById('kd-tet-channel').value || null;
    const item_group = document.getElementById('kd-tet-ig').value || null;
    try {
        const d = await api.getTetDashboard({ channel, item_group });
        if (!d.available) { body.innerHTML = emptyState({ icon: '🧧', title: 'Chưa có mốc Tết', message: d.message || '' }); return; }
        renderBody(d);
        await renderChart(d);
    } catch (err) {
        body.innerHTML = emptyState({ icon: '⚠️', title: 'Lỗi', message: err.message });
    }
}

function renderBody(d) {
    const c = d.cards || {};
    const cov = d.coverage_npp;
    const mt = d.mt_status;
    document.getElementById('kd-tet-body').innerHTML = html`
        <div class="kd-kpi-grid">
            <div class="kd-kpi-card"><div class="kd-kpi-label">Còn đến Tết ${d.tet_year}</div>
                <div class="kd-kpi-value">${c.days_to_tet > 0 ? formatNumber(c.days_to_tet) + ' ngày' : 'Đã qua'}</div>
                <div class="kd-kpi-sub">Mùng 1: ${escapeHtml(d.tet_date)}</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Luỹ kế hiện tại</div>
                <div class="kd-kpi-value">${formatVNDShort(c.cum_current || 0)}</div>
                <div class="kd-kpi-sub">${c.vs_prev_pct != null ? c.vs_prev_pct.toFixed(0) + '% so cùng mốc mùa trước' : 'chưa có mùa trước để so'}</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Ước cả mùa <span class="kd-text-muted">(thô)</span></div>
                <div class="kd-kpi-value">${c.est_full_season != null ? formatVNDShort(c.est_full_season) : '—'}</div>
                <div class="kd-kpi-sub">Mùa trước cả mùa: ${c.prev_full_season != null ? formatVNDShort(c.prev_full_season) : '—'}</div></div>
            ${cov ? `<div class="kd-kpi-card"><div class="kd-kpi-label">NPP đã lên đơn</div>
                <div class="kd-kpi-value">${formatNumber(cov.current)}</div>
                <div class="kd-kpi-sub">cùng mốc mùa trước: ${formatNumber(cov.prev_same_offset)}</div></div>` : ''}
        </div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Doanh số luỹ kế theo mốc D-N (4 mùa)</h3>
            <div class="kd-chart-wrap"><canvas id="kd-tet-chart"></canvas></div></div>

        ${mt ? `<div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">Chuỗi MT trong cửa sổ Tết — đã đơn ${mt.ordered_count} · chưa ${mt.pending_count}</h3>
            <h4 class="kd-font-bold kd-text-sm kd-mt-2">Chưa có đơn (${mt.pending_count})</h4>
            ${(mt.pending || []).length ? dataTable({
                columns: [{ key: 'customer_name', label: 'Chuỗi', render: (r) => `<a href="#${r.route}" style="color:var(--kd-primary);font-weight:600;">${escapeHtml(r.customer_name)}</a>` }],
                rows: mt.pending,
            }) : '<div class="kd-text-sm kd-text-muted">Mọi chuỗi đã có đơn ✓</div>'}</div>` : ''}
    `;
}

async function renderChart(d) {
    const el = document.getElementById('kd-tet-chart');
    if (!el) return;
    const Chart = await loadChartLib();
    charts.destroy();
    const offsets = (d.series[0]?.points || []).map((p) => p.off);
    const colors = ['#cbd5e1', '#94a3b8', '#f59e0b', '#ef4444'];
    const datasets = (d.series || []).map((s, i) => ({
        label: `Tết ${s.year}`,
        data: s.points.map((p) => p.cum),
        borderColor: colors[i] || '#3b82f6',
        backgroundColor: 'transparent',
        borderWidth: s.is_current ? 3 : 1.5,
        tension: 0.25, pointRadius: 0,
    }));
    charts.add(new Chart(el, {
        type: 'line',
        data: { labels: offsets.map((o) => `D${o}`), datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatVNDShort(ctx.parsed.y)}` } } },
            scales: { y: { ticks: { callback: (v) => formatVNDShort(v) } } },
        },
    }));
}
