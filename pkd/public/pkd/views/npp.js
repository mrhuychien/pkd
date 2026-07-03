import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';
import { dataTable } from '../components/data-table.js';
import { loadChartLib, chartRegistry } from '../components/chart.js';

const charts = chartRegistry();

const SEG_BADGE = {
    'Mới': 'kd-badge-primary', 'Tăng trưởng': 'kd-badge-success', 'Ổn định': 'kd-badge-muted',
    'Suy giảm': 'kd-badge-warning', 'Ngủ đông': 'kd-badge-warning', 'Mất': 'kd-badge-danger', 'Chưa mua': 'kd-badge-muted',
};

function custLink(r) {
    const route = r.route || `/khach/${r.customer}`;
    return `<a href="#${route}" style="color:var(--kd-primary);font-weight:600;">${escapeHtml(r.customer_name || r.customer)}</a>`;
}

function agingBar(b) {
    const parts = [
        ['Trong hạn', b.current, '#10b981'], ['1–30', b.d1_30, '#84cc16'],
        ['31–60', b.d31_60, '#f59e0b'], ['61–90', b.d61_90, '#f97316'], ['>90', b.d90p, '#ef4444'],
    ];
    const total = b.total || parts.reduce((s, p) => s + (p[1] || 0), 0) || 1;
    const bar = parts.map(([, v, c]) => `<span style="width:${((v || 0) / total * 100).toFixed(1)}%;background:${c};"></span>`).join('');
    const legend = parts.map(([l, v, c]) => `<div class="kd-flex kd-items-center" style="gap:6px;"><span style="width:10px;height:10px;border-radius:3px;background:${c};display:inline-block;"></span><span class="kd-text-sm">${l}: <b>${formatVNDShort(v || 0)}</b></span></div>`).join('');
    return `<div class="kd-aging-bar" style="display:flex;height:14px;border-radius:7px;overflow:hidden;">${bar}</div>
            <div class="kd-aging-list" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;">${legend}</div>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Kênh NPP', subtitle: 'Sức khoẻ nhà phân phối — coverage, vòng đời, tái đặt' })}
        <a href="#/ql-ov?k=npp" class="kd-cta-block" id="kd-npp-qlk"><i class="fas fa-toolbox"></i><span>Quản lý kênh NPP (phân tích sâu)</span><i class="fas fa-chevron-right"></i></a>
        <div id="kd-npp-body"><div class="kd-skeleton" style="height:400px;"></div></div>
    `;
    // Tab mở TRƯỚC deploy chạy shell cũ (không có route /ql-* — nhận biết qua
    // PKD.build chưa tồn tại) → đổi sang full-load URL để nạp shell mới.
    if (!window.PKD?.build) {
        const a = container.querySelector('#kd-npp-qlk');
        if (a) a.href = `/kd?r=${Date.now()}#/ql-ov?k=npp`;
    }
    try {
        const d = await api.getNppDashboard();
        renderBody(d);
        await renderChart(d.series_12m || []);
    } catch (err) {
        document.getElementById('kd-npp-body').innerHTML =
            `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div class="kd-empty-title">Lỗi</div><div class="kd-text-sm">${escapeHtml(err.message)}</div></div>`;
        showToast(err.message, 'error');
    }
}

function renderBody(d) {
    const cov = d.coverage || {};
    const par = d.pareto || {};
    const sku = d.sku_mix || {};
    const debt = d.debt || {};
    const segChips = (d.segments || []).map((s) =>
        `<span class="kd-badge ${SEG_BADGE[s.segment] || 'kd-badge-muted'}">${escapeHtml(s.segment)}: ${s.count}</span>`).join(' ');

    document.getElementById('kd-npp-body').innerHTML = html`
        <div class="kd-kpi-grid">
            <div class="kd-kpi-card"><div class="kd-kpi-label">Coverage (hoạt động)</div>
                <div class="kd-kpi-value">${formatNumber(cov.active || 0)}<span style="font-size:.8rem;">/${formatNumber(cov.total || 0)}</span></div>
                <div class="kd-kpi-sub">${cov.pct != null ? cov.pct.toFixed(0) + '%' : '—'} · MTD mua: ${formatNumber(cov.bought_mtd || 0)}</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Pareto (12 tháng)</div>
                <div class="kd-kpi-value">${par.top5_pct != null ? par.top5_pct.toFixed(0) + '%' : '—'}</div>
                <div class="kd-kpi-sub">Top5 · Top10 ${par.top10_pct != null ? par.top10_pct.toFixed(0) + '%' : '—'} · ${par.npp_for_80 ?? '—'} KH tạo 80%</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">SKU mix đạt</div>
                <div class="kd-kpi-value">${sku.du_nhom_pct != null ? sku.du_nhom_pct.toFixed(0) + '%' : '—'}</div>
                <div class="kd-kpi-sub">${(sku.thieu || []).length} KH thiếu nhóm hàng</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Tổng nợ NPP</div>
                <div class="kd-kpi-value danger">${formatVNDShort(debt.buckets?.total || 0)}</div>
                <div class="kd-kpi-sub">DSO ~${debt.dso != null ? Math.round(debt.dso) : '—'} ngày</div></div>
        </div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Doanh số 12 tháng</h3>
            <div class="kd-chart-wrap"><canvas id="kd-npp-12m"></canvas></div></div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">Phân khúc vòng đời</h3>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">${segChips || '<span class="kd-text-muted">—</span>'}</div></div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">Biến động phân khúc (so đầu tháng)</h3>
            ${(d.segment_changes || []).length ? dataTable({
                columns: [
                    { key: 'customer_name', label: 'Khách', render: custLink },
                    { key: 'change', label: 'Chuyển', render: (r) => `<span class="kd-badge ${r.drop > 0 ? 'kd-badge-danger' : 'kd-badge-success'}">${escapeHtml(r.from)} → ${escapeHtml(r.to)}</span>` },
                ], rows: d.segment_changes,
            }) : '<div class="kd-text-sm kd-text-muted">Không có biến động.</div>'}</div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">Quá nhịp tái đặt</h3>
            ${renderCustTable(d.overdue_reorder, [
                { key: 'days_since', label: 'Ngày từ đơn cuối', render: (r) => `${formatNumber(r.days_since)}d` },
                { key: 'avg_cycle', label: 'Nhịp TB', render: (r) => `${formatNumber(r.avg_cycle)}d` },
            ])}</div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">Thiếu SKU mix</h3>
            ${renderCustTable(sku.thieu, [{ key: 'groups_bought', label: 'Số nhóm', render: (r) => formatNumber(r.groups_bought) }])}</div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">Công nợ (aging)</h3>
            ${agingBar(debt.buckets || {})}
            <div class="kd-mt-3">${dataTable({
                columns: [
                    { key: 'customer_name', label: 'Khách', render: custLink },
                    { key: 'outstanding', label: 'Nợ', render: (r) => formatVNDShort(r.outstanding) },
                    { key: 'oldest_days', label: 'Nợ lâu nhất', render: (r) => `${formatNumber(r.oldest_days)}d` },
                ], rows: debt.top || [],
            })}</div></div>
    `;
}

function renderCustTable(rows, extraCols) {
    if (!rows || !rows.length) return '<div class="kd-text-sm kd-text-muted">Không có mục.</div>';
    return dataTable({
        columns: [{ key: 'customer_name', label: 'Khách', render: custLink }, ...extraCols],
        rows,
    });
}

async function renderChart(series) {
    const el = document.getElementById('kd-npp-12m');
    if (!el || !series.length) return;
    const Chart = await loadChartLib();
    charts.destroy();
    charts.add(new Chart(el, {
        type: 'bar',
        data: { labels: series.map((s) => s.month), datasets: [{ data: series.map((s) => s.amount), backgroundColor: '#3b82f6', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatVNDShort(c.parsed.y) } } }, scales: { y: { ticks: { callback: (v) => formatVNDShort(v) } } } },
    }));
}
