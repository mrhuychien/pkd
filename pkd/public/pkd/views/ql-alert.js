import { html } from '../lib/dom.js';
import { formatVNDShort, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { paged } from '../components/data-table.js';
import { qlNav, channelOf, CHANNEL_LABEL, CHANNEL_NOUN } from '../components/ql-nav.js';

// ─── Cần xử lý / Action Center theo kênh (port từ npp quan-ly-alert) ─────────
let _k = 'npp';

const SEG_BADGE = { 'Mới': 'primary', 'Tăng trưởng': 'success', 'Ổn định': 'muted', 'Suy giảm': 'warning', 'Ngủ đông': 'warning', 'Mất': 'danger', 'Chưa mua': 'muted' };
const ACTION_BADGE = { 'Gọi thu nợ': 'danger', 'Chào tái đặt / thăm': 'warning', 'Tìm hiểu & đẩy KM': 'warning', 'Nhắc tái đặt': 'primary', 'Theo dõi': 'muted' };

function healthBar(h) {
    const color = h >= 70 ? 'var(--kd-success)' : (h >= 40 ? 'var(--kd-warning)' : 'var(--kd-danger)');
    return `<div style="display:flex;align-items:center;gap:6px;">
        <div style="flex:1;height:8px;background:var(--kd-surface-2);border-radius:4px;overflow:hidden;min-width:48px;">
            <div style="width:${h}%;height:100%;background:${color};"></div></div>
        <strong style="color:${color};font-size:.8rem;">${h}</strong></div>`;
}

export async function render({ container, query }) {
    _k = channelOf(query);
    const noun = CHANNEL_NOUN[_k];
    container.innerHTML = html`
        ${banner({ title: 'Cần xử lý (Action Center)', subtitle: `${noun} kênh ${CHANNEL_LABEL[_k]} ưu tiên theo GIÁ TRỊ RỦI RO` })}
        ${qlNav('al', _k)}
        <div id="kd-ac-body"><div class="kd-skeleton" style="height:280px;"></div></div>
    `;
    try {
        const d = await api.mgr.actionCenter(_k);
        renderRows(d.rows || []);
    } catch (err) {
        document.getElementById('kd-ac-body').innerHTML =
            `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderRows(rows) {
    const root = document.getElementById('kd-ac-body');
    const noun = CHANNEL_NOUN[_k];
    if (!rows.length) {
        root.innerHTML = `<div class="kd-empty"><div class="kd-empty-icon">✅</div><div class="kd-empty-title">Không có ${noun} cần xử lý</div><div class="kd-text-sm">Kênh đang khỏe.</div></div>`;
        return;
    }
    const totalRisk = rows.reduce((s, r) => s + (r.risk_value || 0), 0);
    root.innerHTML = html`
        <div class="kd-kpi-grid">
            <div class="kd-kpi-card"><div class="kd-kpi-label">${noun} cần xử lý</div><div class="kd-kpi-value">${rows.length}</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Tổng giá trị rủi ro</div><div class="kd-kpi-value danger">${formatVNDShort(totalRisk)}</div><div class="kd-kpi-sub">Nợ quá hạn + doanh số đang mất</div></div>
        </div>
        <div class="kd-card kd-mt-3">
            <p class="kd-text-sm kd-text-muted">Sắp theo <strong>giá trị rủi ro</strong> (không theo số lượng) — xử lý từ trên xuống.</p>
            ${paged({
                rows,
                pageSize: 10,
                render: (slice) => html`<div style="overflow-x:auto;"><table class="kd-table kd-mt-2">
                <thead><tr><th>${noun}</th><th>Tỉnh</th><th>Phân khúc</th><th>Sức khỏe</th><th class="kd-text-end">Giá trị rủi ro</th><th>Hành động</th><th></th></tr></thead>
                <tbody>
                    ${slice.map((r) => html`<tr>
                        <td data-label="${noun}"><strong>${escapeHtml(r.customer_name)}</strong>${r.overdue > 0 ? ` <span class="kd-text-sm kd-text-muted">(nợ quá hạn ${formatVNDShort(r.overdue)})</span>` : ''}</td>
                        <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                        <td data-label="Phân khúc"><span class="kd-badge kd-badge-${SEG_BADGE[r.segment] || 'muted'}">${escapeHtml(r.segment)}</span></td>
                        <td data-label="Sức khỏe" style="min-width:120px;">${healthBar(r.health)}</td>
                        <td data-label="Giá trị rủi ro" class="kd-text-end"><strong style="color:var(--kd-danger);">${formatVNDShort(r.risk_value)}</strong></td>
                        <td data-label="Hành động"><span class="kd-badge kd-badge-${ACTION_BADGE[r.action] || 'muted'}">${escapeHtml(r.action)}</span></td>
                        <td><a href="#/ql-khach?k=${_k}&c=${encodeURIComponent(r.customer)}" class="kd-text-sm kd-link">Mở</a></td>
                    </tr>`).join('')}
                </tbody>
            </table></div>`,
            })}
        </div>
    `;
}
