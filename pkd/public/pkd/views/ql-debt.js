import { html } from '../lib/dom.js';
import { formatCurrency, formatVNDShort, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { paged } from '../components/data-table.js';
import { qlNav, channelOf, CHANNEL_LABEL, CHANNEL_NOUN } from '../components/ql-nav.js';

// ─── Công nợ & Tuổi nợ theo kênh (port từ npp quan-ly-debt — công nợ GL) ─────
let _k = 'npp';

const BUCKETS = [
    ['current', 'Trong hạn', 'success'], ['d1_30', '1–30 ngày', 'muted'],
    ['d31_60', '31–60 ngày', 'warning'], ['d61_90', '61–90 ngày', 'warning'], ['over_90', '> 90 ngày', 'danger'],
];

export async function render({ container, query }) {
    _k = channelOf(query);
    container.innerHTML = html`
        ${banner({ title: 'Công nợ & Tuổi nợ', subtitle: `Aging kênh ${CHANNEL_LABEL[_k]} · nợ quá hạn · hạn mức` })}
        ${qlNav('db', _k)}
        <div id="kd-db-body"><div class="kd-skeleton" style="height:280px;"></div></div>
    `;
    try {
        const d = await api.mgr.receivables(_k);
        renderDebt(d);
    } catch (err) {
        document.getElementById('kd-db-body').innerHTML =
            `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderDebt(d) {
    const b = d.buckets || {};
    const t = d.totals || {};
    const top = d.top || [];
    const credit = d.credit || [];
    const noun = CHANNEL_NOUN[_k];
    document.getElementById('kd-db-body').innerHTML = html`
        <div class="kd-kpi-grid">
            <div class="kd-kpi-card"><div class="kd-kpi-label">Tổng công nợ kênh</div>
                <div class="kd-kpi-value">${formatVNDShort(t.debt || 0)}</div>
                <div class="kd-kpi-sub">Số dư sổ cái (GL) · kênh ${escapeHtml(CHANNEL_LABEL[_k])}</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Nợ quá hạn</div>
                <div class="kd-kpi-value danger">${formatVNDShort(t.overdue || 0)}</div>
                <div class="kd-kpi-sub">${t.npp_with_debt || 0} ${escapeHtml(noun)} có nợ quá hạn</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Trong hạn</div>
                <div class="kd-kpi-value">${formatVNDShort(t.current || 0)}</div></div>
        </div>

        <h3 class="kd-font-bold kd-mt-3">Tuổi nợ</h3>
        <div class="kd-kpi-grid kd-mt-2" style="grid-template-columns:repeat(2,1fr);">
            ${BUCKETS.map(([k, label, color]) => html`
                <div class="kd-kpi-card">
                    <div class="kd-kpi-label">${label}</div>
                    <div class="kd-kpi-value ${color === 'danger' ? 'danger' : (color === 'warning' ? 'warning' : '')}">${formatVNDShort(b[k] || 0)}</div>
                </div>`).join('')}
        </div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Top ${escapeHtml(noun)} nợ quá hạn</h3>
            ${top.length ? paged({
                rows: top,
                pageSize: 10,
                render: (slice) => html`<table class="kd-table kd-mt-2">
                <thead><tr><th>${noun}</th><th>Tỉnh</th><th class="kd-text-end">Nợ quá hạn</th></tr></thead>
                <tbody>
                    ${slice.map((r) => html`<tr>
                        <td data-label="${noun}"><a href="#/ql-khach?k=${_k}&c=${encodeURIComponent(r.customer)}" class="kd-link">${escapeHtml(r.customer_name)}</a></td>
                        <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                        <td data-label="Nợ quá hạn" class="kd-text-end"><strong style="color:var(--kd-danger);">${formatCurrency(r.overdue)}</strong></td>
                    </tr>`).join('')}
                </tbody>
            </table>`,
            }) : '<p class="kd-text-sm kd-text-muted kd-mt-2">Không có nợ quá hạn 🎉</p>'}
        </div>

        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Hạn mức tín dụng & % sử dụng</h3>
            ${credit.length ? paged({
                rows: credit,
                pageSize: 10,
                render: (slice) => html`<table class="kd-table kd-mt-2">
                <thead><tr><th>${noun}</th><th class="kd-text-end">Hạn mức</th><th class="kd-text-end">Dư nợ</th><th class="kd-text-end">% dùng</th></tr></thead>
                <tbody>
                    ${slice.map((r) => html`<tr>
                        <td data-label="${noun}">${r.usage_pct >= 100 ? '🔴 ' : (r.usage_pct >= 80 ? '🟠 ' : '')}<a href="#/ql-khach?k=${_k}&c=${encodeURIComponent(r.customer)}" class="kd-link">${escapeHtml(r.customer_name)}</a></td>
                        <td data-label="Hạn mức" class="kd-text-end">${formatCurrency(r.credit_limit)}</td>
                        <td data-label="Dư nợ" class="kd-text-end">${formatCurrency(r.outstanding)}</td>
                        <td data-label="% dùng" class="kd-text-end"><strong style="color:${r.usage_pct >= 100 ? 'var(--kd-danger)' : (r.usage_pct >= 80 ? 'var(--kd-warning)' : 'var(--kd-text)')};">${r.usage_pct.toFixed(0)}%</strong></td>
                    </tr>`).join('')}
                </tbody>
            </table>`,
            }) : `<p class="kd-text-sm kd-text-muted kd-mt-2">Chưa thiết lập hạn mức tín dụng (Customer Credit Limit) cho ${escapeHtml(noun)} nào.</p>`}
        </div>
    `;
}
