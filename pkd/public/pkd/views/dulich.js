import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';
import { dataTable } from '../components/data-table.js';
import { loadChartLib, chartRegistry } from '../components/chart.js';

const charts = chartRegistry();

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Kênh Du lịch', subtitle: 'Khách mới, tỷ lệ quay lại, khách quen im ắng' })}
        <a href="#/ql-ov?k=dulich" class="kd-cta-block"><i class="fas fa-toolbox"></i><span>Quản lý kênh Du lịch (phân tích sâu)</span><i class="fas fa-chevron-right"></i></a>
        <div id="kd-dl-body"><div class="kd-skeleton" style="height:400px;"></div></div>
    `;
    try {
        const d = await api.getTourismDashboard();
        renderBody(d);
        await renderChart(d.series_12m || []);
    } catch (err) {
        document.getElementById('kd-dl-body').innerHTML =
            `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div class="kd-empty-title">Lỗi</div><div class="kd-text-sm">${escapeHtml(err.message)}</div></div>`;
        showToast(err.message, 'error');
    }
}

function renderBody(d) {
    const nc = d.new_customers || {};
    const sor = d.second_order_rate;
    const territoryBlock = d.territory_clean
        ? `<div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">Doanh số theo tỉnh/khu vực (12 tháng)</h3>
             ${dataTable({
                 columns: [
                     { key: 'territory', label: 'Tỉnh/Khu vực', render: (r) => escapeHtml(r.territory) },
                     { key: 'amount', label: 'Doanh số', render: (r) => formatVNDShort(r.amount) },
                     { key: 'invoices', label: 'Số HĐ', render: (r) => formatNumber(r.invoices) },
                 ], rows: d.by_territory || [],
             })}</div>`
        : `<div class="kd-card kd-mt-3" style="border-left:4px solid var(--kd-warning);background:rgba(245,158,11,.06);">
             <b>⚠️ Dữ liệu tỉnh/khu vực chưa sạch</b>
             <div class="kd-text-sm">Nhiều hoá đơn thiếu <code>territory</code> hoặc để mặc định. Cần chuẩn hoá tỉnh trước khi phân tích theo khu vực.</div></div>`;

    document.getElementById('kd-dl-body').innerHTML = html`
        <div class="kd-kpi-grid">
            <div class="kd-kpi-card"><div class="kd-kpi-label">Khách mới (MTD)</div>
                <div class="kd-kpi-value">${formatNumber(nc.count || 0)}</div>
                <div class="kd-kpi-sub">Đơn đầu tiên rơi vào tháng này</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Tỷ lệ có đơn thứ 2</div>
                <div class="kd-kpi-value">${sor != null ? sor.toFixed(0) + '%' : '—'}</div>
                <div class="kd-kpi-sub">Khách đơn đầu ≤180 ngày</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Khách quen im ắng</div>
                <div class="kd-kpi-value warning">${formatNumber((d.quiet_regulars || []).length)}</div>
                <div class="kd-kpi-sub">≥3 đơn & quá nhịp</div></div>
        </div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Doanh số 12 tháng</h3>
            <div class="kd-chart-wrap"><canvas id="kd-dl-12m"></canvas></div></div>

        ${territoryBlock}

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">Khách quen im ắng</h3>
            ${(d.quiet_regulars || []).length ? dataTable({
                columns: [
                    { key: 'customer_name', label: 'Khách', render: (r) => `<a href="#/khach/${escapeHtml(r.customer)}" style="color:var(--kd-primary);font-weight:600;">${escapeHtml(r.customer_name)}</a>` },
                    { key: 'days_since', label: 'Ngày từ đơn cuối', render: (r) => `${formatNumber(r.days_since)}d` },
                    { key: 'avg_cycle', label: 'Nhịp TB', render: (r) => `${formatNumber(r.avg_cycle)}d` },
                ], rows: d.quiet_regulars,
            }) : '<div class="kd-text-sm kd-text-muted">Không có khách quen im ắng.</div>'}</div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">Khách mới trong tháng (${nc.count || 0})</h3>
            ${(nc.list || []).length ? dataTable({
                columns: [{ key: 'customer_name', label: 'Khách', render: (r) => `<a href="#/khach/${escapeHtml(r.customer)}" style="color:var(--kd-primary);font-weight:600;">${escapeHtml(r.customer_name)}</a>` }],
                rows: nc.list,
            }) : '<div class="kd-text-sm kd-text-muted">Chưa có khách mới tháng này.</div>'}</div>
    `;
}

async function renderChart(series) {
    const el = document.getElementById('kd-dl-12m');
    if (!el || !series.length) return;
    const Chart = await loadChartLib();
    charts.destroy();
    charts.add(new Chart(el, {
        type: 'line',
        data: { labels: series.map((s) => s.month), datasets: [{ data: series.map((s) => s.amount), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.12)', fill: true, tension: 0.3 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatVNDShort(c.parsed.y) } } }, scales: { y: { ticks: { callback: (v) => formatVNDShort(v) } } } },
    }));
}
