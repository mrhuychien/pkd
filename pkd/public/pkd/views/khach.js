import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { showToast } from '../components/toast.js';
import { dataTable } from '../components/data-table.js';
import { loadChartLib, chartRegistry } from '../components/chart.js';

const charts = chartRegistry();
const CH_LABEL = { npp: 'NPP', mt: 'MT', dulich: 'Du lịch' };
const SEG_BADGE = {
    'Mới': 'kd-badge-primary', 'Tăng trưởng': 'kd-badge-success', 'Ổn định': 'kd-badge-muted',
    'Suy giảm': 'kd-badge-warning', 'Ngủ đông': 'kd-badge-warning', 'Mất': 'kd-badge-danger', 'Chưa mua': 'kd-badge-muted',
};

export async function render({ container, params }) {
    const customer = params?.id;
    container.innerHTML = '<div class="kd-skeleton" style="height:400px;"></div>';
    if (!customer) { container.innerHTML = '<div class="kd-empty"><div class="kd-empty-icon">❓</div><div class="kd-empty-title">Thiếu mã khách</div></div>'; return; }
    let d;
    try {
        d = await api.getCustomerDetail(customer);
    } catch (err) {
        container.innerHTML = `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div class="kd-empty-title">Lỗi</div><div class="kd-text-sm">${escapeHtml(err.message)}</div></div>`;
        showToast(err.message, 'error'); return;
    }
    renderBody(container, d);
    await renderChart(d.series_12m || []);
}

function renderBody(container, d) {
    const p = d.profile || {};
    const cyc = d.cycle || {};
    const debt = d.debt || {};
    const rev12 = (d.series_12m || []).reduce((s, m) => s + (m.amount || 0), 0);
    const disp = d.display || {};

    container.innerHTML = html`
        <section class="kd-view-banner">
            <div>
                <h2 class="kd-view-banner-title">${escapeHtml(p.customer_name || p.name)}</h2>
                <p class="kd-view-banner-subtitle">${escapeHtml(p.name)} · ${escapeHtml(p.territory || '—')}</p>
            </div>
        </section>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
            <span class="kd-badge kd-badge-primary">Hạng ${escapeHtml(p.hang || '—')}</span>
            <span class="kd-badge ${SEG_BADGE[d.segment] || 'kd-badge-muted'}">${escapeHtml(d.segment || '—')}</span>
            <span class="kd-badge kd-badge-muted">${escapeHtml(CH_LABEL[p.channel] || p.channel || '—')}</span>
            ${cyc.qua_nhip ? '<span class="kd-badge kd-badge-danger">Quá nhịp tái đặt</span>' : ''}
        </div>

        <div class="kd-kpi-grid">
            <div class="kd-kpi-card"><div class="kd-kpi-label">Doanh số 12 tháng</div>
                <div class="kd-kpi-value">${formatVNDShort(rev12)}</div>
                <div class="kd-kpi-sub">TB tháng ${formatVNDShort(p.avg_monthly || 0)} · ${formatNumber(p.orders || 0)} đơn</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Công nợ</div>
                <div class="kd-kpi-value danger">${formatVNDShort(debt.outstanding || 0)}</div>
                <div class="kd-kpi-sub">Quá 90d: ${formatVNDShort(debt.buckets?.d90p || 0)}</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Nhịp tái đặt</div>
                <div class="kd-kpi-value">${cyc.avg_days != null ? formatNumber(cyc.avg_days) + 'd' : '—'}</div>
                <div class="kd-kpi-sub">Đơn cuối: ${cyc.last_order ? formatDate(cyc.last_order) : '—'} (${cyc.days_since != null ? cyc.days_since + 'd trước' : '—'})</div></div>
        </div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Doanh số 12 tháng</h3>
            <div class="kd-chart-wrap"><canvas id="kd-kh-12m"></canvas></div></div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">Cơ cấu nhóm hàng (12 tháng)</h3>
            ${(d.top_sku_mix || []).length ? dataTable({
                columns: [
                    { key: 'item_group', label: 'Nhóm hàng', render: (r) => escapeHtml(r.item_group || '(trống)') },
                    { key: 'amount', label: 'Doanh số', render: (r) => formatVNDShort(r.amount) },
                    { key: 'pct', label: '%', render: (r) => r.pct != null ? r.pct.toFixed(1) + '%' : '—' },
                ], rows: d.top_sku_mix,
            }) : '<div class="kd-text-sm kd-text-muted">Chưa có dữ liệu.</div>'}</div>

        ${p.channel === 'mt' && (d.outlets || []).length ? `
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">🏬 Siêu thị (12 tháng)</h3>
            ${dataTable({
                columns: [
                    { key: 'shipping_address_name', label: 'Siêu thị', render: (r) => escapeHtml(r.shipping_address_name) },
                    { key: 'amount', label: 'Doanh số', render: (r) => formatVNDShort(r.amount) },
                    { key: 'last_invoice', label: 'HĐ gần nhất', render: (r) => r.last_invoice ? formatDate(r.last_invoice) : '—' },
                ], rows: d.outlets,
            })}</div>` : ''}

        ${disp.available && disp.authorized_salep ? `
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">🎁 Trưng bày</h3>
            <div class="kd-text-sm">Tham gia: <b>${formatNumber(disp.participations)}</b> · Đã duyệt: <b>${formatNumber(disp.approved)}</b> · Điểm: <b>${formatNumber(disp.distinct_points)}</b></div></div>` : ''}

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">20 hoá đơn gần nhất</h3>
            ${dataTable({
                columns: [
                    { key: 'posting_date', label: 'Ngày', render: (r) => formatDate(r.posting_date) },
                    { key: 'name', label: 'Số HĐ', render: (r) => escapeHtml(r.name) },
                    { key: 'grand_total', label: 'Tổng', render: (r) => formatVNDShort(r.grand_total) },
                    { key: 'outstanding', label: 'Còn nợ', render: (r) => formatVNDShort(r.outstanding) },
                ], rows: d.invoices || [],
            })}</div>
    `;
}

async function renderChart(series) {
    const el = document.getElementById('kd-kh-12m');
    if (!el || !series.length) return;
    const Chart = await loadChartLib();
    charts.destroy();
    charts.add(new Chart(el, {
        type: 'bar',
        data: { labels: series.map((s) => s.month), datasets: [{ data: series.map((s) => s.amount), backgroundColor: '#3b82f6', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatVNDShort(c.parsed.y) } } }, scales: { y: { ticks: { callback: (v) => formatVNDShort(v) } } } },
    }));
}
