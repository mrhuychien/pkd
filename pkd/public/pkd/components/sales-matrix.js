// Bảng doanh số khách × tháng (năm tài chính) — port từ npp components/sales-matrix.
// Dữ liệu: pkd.api.manager.sales_matrix → { months:[{key,label}], rows:[{customer,
//   customer_name, monthly:{key:val}, total}], totals:{grand_total, monthly},
//   fiscal_year, fy_start, meta{noun} }.

import { html } from '../lib/dom.js';
import { formatCurrency, formatVNDShort, formatDate, escapeHtml } from '../lib/format.js';

const STK = 'position:sticky;left:0;z-index:1;min-width:170px;';

function cell(v) {
    return v ? `<td class="kd-text-end" title="${formatCurrency(v)}">${formatVNDShort(v)}</td>`
             : '<td class="kd-text-end kd-text-muted">—</td>';
}

/**
 * @param d               kết quả sales_matrix
 * @param opts.showKpis   2 thẻ KPI phía trên — mặc định true
 * @param opts.title      tiêu đề h3 trong thẻ bảng
 * @param opts.showMeta   dòng meta gọn trong thẻ — mặc định false
 * @param opts.detailHref (customer) => href mở chi tiết
 */
export function salesMatrixHtml(d, opts = {}) {
    const showKpis = opts.showKpis !== false;
    const noun = (d.meta && d.meta.noun) || 'KH';
    const detailHref = opts.detailHref || ((c) => `#/khach/${encodeURIComponent(c)}`);
    const months = d.months || [];
    const rows = d.rows || [];
    const t = d.totals || {};
    const colT = t.monthly || {};
    if (!rows.length) {
        return '<div class="kd-empty"><div class="kd-empty-icon">📭</div><div class="kd-empty-title">Chưa có dữ liệu doanh số</div></div>';
    }
    const monthHead = months.map((m) => `<th class="kd-text-end" style="white-space:nowrap;">${escapeHtml(m.label)}</th>`).join('');

    const kpis = showKpis ? html`
        <div class="kd-kpi-grid">
            <div class="kd-kpi-card"><div class="kd-kpi-label">Năm tài chính</div>
                <div class="kd-kpi-value" style="font-size:1.15rem;">${escapeHtml(String(d.fiscal_year || ''))}</div>
                <div class="kd-kpi-sub">Từ ${d.fy_start ? formatDate(d.fy_start) : ''} đến nay</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Tổng doanh số kênh (YTD)</div>
                <div class="kd-kpi-value">${formatVNDShort(t.grand_total || 0)}</div>
                <div class="kd-kpi-sub">${rows.length} ${escapeHtml(noun)}</div></div>
        </div>` : '';
    const title = opts.title ? `<h3 class="kd-font-bold">${escapeHtml(opts.title)}</h3>` : '';
    const meta = opts.showMeta ? `<div class="kd-text-sm kd-text-muted" style="margin:.25rem 0 .5rem;">Năm tài chính ${escapeHtml(String(d.fiscal_year || ''))}${d.fy_start ? ' · từ ' + formatDate(d.fy_start) + ' đến nay' : ''} · Tổng YTD ${formatVNDShort(t.grand_total || 0)} · ${rows.length} ${escapeHtml(noun)}</div>` : '';

    return html`
        ${kpis}
        <div class="kd-card ${showKpis ? 'kd-mt-3' : ''}">
            ${title}${meta}
            <div style="overflow-x:auto;">
            <table class="kd-table">
                <thead><tr>
                    <th style="${STK}background:var(--kd-surface-2);z-index:2;">#  ${escapeHtml(noun)}</th>
                    ${monthHead}
                    <th class="kd-text-end" style="white-space:nowrap;">Tổng YTD</th>
                </tr></thead>
                <tbody>
                    ${rows.map((r, i) => html`<tr>
                        <td style="${STK}background:var(--kd-surface);">
                            <strong style="color:var(--kd-text-muted);">${i + 1}.</strong>
                            <a href="${detailHref(r.customer)}" class="kd-link">${escapeHtml(r.customer_name)}</a></td>
                        ${months.map((m) => cell(r.monthly[m.key] || 0)).join('')}
                        <td class="kd-text-end"><strong title="${formatCurrency(r.total)}">${formatVNDShort(r.total)}</strong></td>
                    </tr>`).join('')}
                </tbody>
                <tfoot><tr style="border-top:2px solid var(--kd-border);font-weight:800;">
                    <td style="${STK}background:var(--kd-surface-2);">Tổng cộng</td>
                    ${months.map((m) => `<td class="kd-text-end" title="${formatCurrency(colT[m.key] || 0)}">${formatVNDShort(colT[m.key] || 0)}</td>`).join('')}
                    <td class="kd-text-end"><strong title="${formatCurrency(t.grand_total || 0)}">${formatVNDShort(t.grand_total || 0)}</strong></td>
                </tr></tfoot>
            </table>
            </div>
            <p class="kd-text-sm kd-text-muted kd-mt-2">Doanh số = tổng hoá đơn (đã loại HĐ đầu kỳ). Chạm vào ô để xem số đầy đủ; bấm tên để mở chi tiết.</p>
        </div>
    `;
}
