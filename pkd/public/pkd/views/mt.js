import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';
import { dataTable } from '../components/data-table.js';

let _data = null;

function pctBadge(v) {
    if (v == null) return '<span class="kd-text-muted">—</span>';
    const up = v >= 0;
    return `<span style="color:${up ? 'var(--kd-success)' : 'var(--kd-danger)'};font-weight:700;">${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Kênh MT', subtitle: 'Chuỗi siêu thị — sell-in, nhiễu theo PO (ưu tiên trailing 3 tháng)' })}
        <a href="#/ql-ov?k=mt" class="kd-cta-block"><i class="fas fa-toolbox"></i><span>Quản lý kênh MT (phân tích sâu)</span><i class="fas fa-chevron-right"></i></a>
        <div id="kd-mt-body"><div class="kd-skeleton" style="height:400px;"></div></div>
    `;
    try {
        _data = await api.getMtDashboard();
        renderBody(_data);
    } catch (err) {
        document.getElementById('kd-mt-body').innerHTML =
            `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div class="kd-empty-title">Lỗi</div><div class="kd-text-sm">${escapeHtml(err.message)}</div></div>`;
        showToast(err.message, 'error');
    }
}

function renderBody(d) {
    const hy = d.hygiene || {};
    const silent = (d.chains || []).filter((c) => c.days_silent != null && c.days_silent >= (d.silence_days || 30));
    const hygieneWarn = !hy.addr_ok
        ? `<div class="kd-card" style="border-left:4px solid var(--kd-warning);background:rgba(245,158,11,.06);">
             <b>⚠️ Dữ liệu địa chỉ giao chưa đủ (${hy.addr_pct != null ? hy.addr_pct.toFixed(0) : 0}%)</b>
             <div class="kd-text-sm">Bảng chi tiết siêu thị bị ẩn để tránh số liệu sai. Cần gắn <code>shipping_address_name</code> cho hoá đơn MT.</div></div>`
        : '';

    document.getElementById('kd-mt-body').innerHTML = html`
        ${hygieneWarn}
        <div class="kd-card kd-mt-3">
            <h3 class="kd-font-bold kd-mb-2">Chuỗi siêu thị <span class="kd-text-sm kd-text-muted">(${d.meta?.note || ''})</span></h3>
            ${dataTable({
                columns: [
                    { key: 'customer_name', label: 'Chuỗi', render: chainCell },
                    { key: 'trailing_3m', label: 'Trailing 3T', render: (r) => `<b>${formatVNDShort(r.trailing_3m)}</b>` },
                    { key: 'mtd', label: 'MTD', render: (r) => formatVNDShort(r.mtd) },
                    { key: 'growth_pct', label: 'vs kỳ trước', render: (r) => pctBadge(r.growth_pct) },
                    { key: 'yoy_pct', label: 'YoY', render: (r) => pctBadge(r.yoy_pct) },
                    { key: 'outstanding', label: 'Nợ', render: (r) => formatVNDShort(r.outstanding) },
                    { key: 'days_silent', label: 'Im lặng', render: (r) => r.days_silent != null ? `${formatNumber(r.days_silent)}d` : '—' },
                ], rows: d.chains || [],
            })}
        </div>

        <div id="kd-mt-outlets" class="kd-mt-3"></div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold kd-mb-2">Im lặng ≥ ${d.silence_days || 30} ngày (${silent.length})</h3>
            ${silent.length ? dataTable({
                columns: [
                    { key: 'customer_name', label: 'Chuỗi', render: (r) => `<a href="#/khach/${r.customer}" style="color:var(--kd-primary);font-weight:600;">${escapeHtml(r.customer_name)}</a>` },
                    { key: 'days_silent', label: 'Ngày im lặng', render: (r) => `${formatNumber(r.days_silent)}d` },
                    { key: 'last_invoice', label: 'HĐ gần nhất', render: (r) => r.last_invoice ? formatDate(r.last_invoice) : '—' },
                ], rows: silent,
            }) : '<div class="kd-text-sm kd-text-muted">Không có chuỗi im lặng.</div>'}</div>
    `;

    // Tap tên chuỗi → tải bảng siêu thị (nếu hygiene đạt).
    document.querySelectorAll('.kd-mt-chain').forEach((a) => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            if (!hy.addr_ok) { showToast('Địa chỉ giao chưa đủ — không hiển thị chi tiết siêu thị', 'warning'); return; }
            loadOutlets(a.dataset.customer, a.dataset.name);
        });
    });
}

function chainCell(r) {
    return `<a href="#" class="kd-mt-chain" data-customer="${escapeHtml(r.customer)}" data-name="${escapeHtml(r.customer_name)}" style="color:var(--kd-primary);font-weight:600;">${escapeHtml(r.customer_name)}</a>
            <a href="#/khach/${escapeHtml(r.customer)}" title="Chi tiết khách" style="margin-left:6px;">👤</a>`;
}

async function loadOutlets(customer, name) {
    const panel = document.getElementById('kd-mt-outlets');
    panel.innerHTML = '<div class="kd-skeleton" style="height:150px;"></div>';
    try {
        const d = await api.getMtDashboard(customer);
        const outlets = d.outlets || [];
        panel.innerHTML = `
            <div class="kd-card">
                <h3 class="kd-font-bold kd-mb-2">🏬 Siêu thị của: ${escapeHtml(name)}</h3>
                ${outlets.length ? dataTable({
                    columns: [
                        { key: 'shipping_address_name', label: 'Siêu thị', render: (r) => escapeHtml(r.shipping_address_name) },
                        { key: 'trailing_3m', label: 'Trailing 3T', render: (r) => formatVNDShort(r.trailing_3m) },
                        { key: 'mtd', label: 'MTD', render: (r) => formatVNDShort(r.mtd) },
                        { key: 'last_invoice', label: 'HĐ gần nhất', render: (r) => r.last_invoice ? formatDate(r.last_invoice) : '—' },
                    ], rows: outlets,
                }) : '<div class="kd-text-sm kd-text-muted">Chưa có dữ liệu siêu thị.</div>'}
            </div>`;
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
        panel.innerHTML = `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div class="kd-text-sm">${escapeHtml(err.message)}</div></div>`;
    }
}
