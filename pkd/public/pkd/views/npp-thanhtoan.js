// Chính sách thanh toán NPP — DANH SÁCH CẢNH BÁO cho kế toán xử lý.
// Nguồn: pkd.api.npp_payment.get_npp_payment(nam, thang). Chọn kỳ (năm/tháng);
// hàng màu theo mức độ (cắt thưởng = đỏ, phạt 50% = cam, ân hạn = vàng nhạt).

import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';
import { pagedTable } from '../components/data-table.js';

// Màu badge theo level trả từ server (semantic — không dùng màu mùa).
const LEVEL_BADGE = { danger: 'kd-badge-danger', warning: 'kd-badge-warning', info: 'kd-badge', success: 'kd-badge-success' };
// Nền hàng nhấn theo tier (chỉ tier phạt/cắt để kế toán nhìn thấy ngay).
const TIER_ROWBG = {
    cut: 'background:rgba(239,68,68,.08);',
    penalty: 'background:rgba(249,115,22,.08);',
    grace: 'background:rgba(234,179,8,.07);',
};

let _sel = { nam: null, thang: null };

export async function render({ container }) {
    const now = new Date();
    _sel.nam = _sel.nam || now.getFullYear();
    _sel.thang = _sel.thang || (now.getMonth() + 1);

    const yearOpts = [];
    for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) yearOpts.push(y);
    const monthOpts = Array.from({ length: 12 }, (_, i) => i + 1);

    container.innerHTML = html`
        ${banner({ title: 'Thanh toán NPP', subtitle: 'Cảnh báo quá hạn & tác động thưởng — kế toán xử lý' })}
        <div class="kd-flex kd-items-center kd-justify-between" style="flex-wrap:wrap;gap:8px;">
            <h3 class="kd-font-bold">Kỳ thanh toán</h3>
            <div class="kd-filter-bar">
                <label>Tháng <select id="kd-tt-thang">
                    ${monthOpts.map((m) => `<option value="${m}"${m === _sel.thang ? ' selected' : ''}>Tháng ${m}</option>`).join('')}
                </select></label>
                <label>Năm <select id="kd-tt-nam">
                    ${yearOpts.map((y) => `<option value="${y}"${y === _sel.nam ? ' selected' : ''}>${y}</option>`).join('')}
                </select></label>
            </div>
        </div>
        <div id="kd-tt-body" class="kd-mt-2"><div class="kd-skeleton" style="height:320px;"></div></div>
    `;
    document.getElementById('kd-tt-thang').addEventListener('change', (e) => { _sel.thang = parseInt(e.target.value, 10); load(); });
    document.getElementById('kd-tt-nam').addEventListener('change', (e) => { _sel.nam = parseInt(e.target.value, 10); load(); });
    await load();
}

let _seq = 0;
async function load() {
    const body = document.getElementById('kd-tt-body');
    if (!body) return;
    const seq = ++_seq;
    body.innerHTML = '<div class="kd-skeleton" style="height:320px;"></div>';
    try {
        const d = await api.getNppPayment(_sel.nam, _sel.thang);
        if (seq !== _seq) return;
        renderReport(body, d);
    } catch (err) {
        if (seq !== _seq) return;
        body.innerHTML = `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div>
            <div class="kd-empty-title">Không tải được danh sách</div>
            <div class="kd-text-sm">${escapeHtml(err.message)}</div></div>`;
    }
}

const PHASE_NOTE = {
    pending: 'Kỳ CHƯA tới ngày chốt — số phải thu là dự kiến, chưa tính quá hạn.',
    in_window: 'Đang trong cửa sổ thanh toán (chưa quá hạn) — theo dõi để nhắc NPP.',
    overdue: 'Đã qua hạn — các NPP còn nợ bên dưới bị tính ngày quá hạn & ảnh hưởng thưởng.',
};

function renderReport(body, d) {
    const p = d.policy || {};
    const s = d.summary || {};
    const rows = d.rows || [];

    const tiers = `1–${p.phat_tu - 1} ngày: ân hạn (giữ thưởng) · ${p.phat_tu}–${p.cat_tu - 1} ngày: phạt 50% · ≥${p.cat_tu} ngày: cắt thưởng`;

    body.innerHTML = html`
        <div class="kd-text-sm kd-text-muted kd-mb-2">
            Kỳ <b>tháng ${p.thang}/${p.nam}</b> · chốt đơn đến hạn ngày <b>${formatDate(p.chot)}</b> ·
            hạn thanh toán <b>${formatDate(p.deadline)}</b> · thưởng <b>${formatNumber(p.thuong_pct)}%</b> doanh số ·
            tính đến ${formatDate(p.asof)}.<br>
            Quá hạn: ${tiers}. ${escapeHtml(PHASE_NOTE[p.phase] || '')}
            <br>Doanh số thưởng = net trước VAT của tháng; phải thu = hoá đơn đến hạn còn nợ (giữ opening).
        </div>

        <div class="kd-stat-grid">
            <div class="kd-stat-tile kd-stat-danger"><div class="kd-stat-label">Cắt thưởng (>${p.cat_tu - 1}d)</div>
                <div class="kd-stat-value">${formatNumber(s.n_cut)}</div>
                <div class="kd-stat-sub">NPP quá hạn nặng</div></div>
            <div class="kd-stat-tile kd-stat-warning"><div class="kd-stat-label">Phạt 50% (${p.phat_tu}–${p.cat_tu - 1}d)</div>
                <div class="kd-stat-value">${formatNumber(s.n_penalty)}</div>
                <div class="kd-stat-sub">NPP bị giảm nửa thưởng</div></div>
            <div class="kd-stat-tile"><div class="kd-stat-label">Còn nợ đến hạn</div>
                <div class="kd-stat-value" style="font-size:20px;">${formatVNDShort(s.total_phai_thu)}</div>
                <div class="kd-stat-sub">${formatNumber(s.n_overdue)} NPP đang quá hạn</div></div>
            <div class="kd-stat-tile kd-stat-danger"><div class="kd-stat-label">Thưởng bị cắt/giảm</div>
                <div class="kd-stat-value" style="font-size:20px;">${formatVNDShort(s.total_thuong_mat)}</div>
                <div class="kd-stat-sub">kế toán không chi khoản này</div></div>
        </div>

        <div class="kd-card kd-mt-2">
            <h3 class="kd-font-bold kd-mb-2">Danh sách NPP cần xử lý (${formatNumber(rows.length)})</h3>
            <div id="kd-tt-table"></div>
        </div>
    `;

    document.getElementById('kd-tt-table').innerHTML = pagedTable({
        columns: [
            { key: 'customer_name', label: 'NPP', render: (r) =>
                `<a href="#${escapeHtml(r.route)}" class="kd-link">${escapeHtml(r.customer_name)}</a>`
                + `<br><span class="kd-text-sm kd-text-muted">${escapeHtml(r.territory || '')}</span>` },
            { key: 'status_label', label: 'Trạng thái', render: (r) =>
                `<span class="kd-badge ${LEVEL_BADGE[r.level] || 'kd-badge'}">${escapeHtml(r.status_label)}</span>` },
            { key: 'days_overdue', label: 'Quá hạn', render: (r) =>
                r.days_overdue > 0 ? `<b style="color:var(--kd-danger);">${formatNumber(r.days_overdue)} ngày</b>` : '—' },
            { key: 'phai_thu', label: 'Còn nợ đến hạn', render: (r) =>
                r.phai_thu > 0 ? `${formatVNDShort(r.phai_thu)}<br><span class="kd-text-sm kd-text-muted">${formatNumber(r.n_inv)} HĐ · hạn ${r.oldest_due ? formatDate(r.oldest_due) : '—'}</span>` : '—' },
            { key: 'doanh_so', label: 'DS tháng', render: (r) => formatVNDShort(r.doanh_so) },
            { key: 'thuong_full', label: 'Thưởng', render: (r) =>
                `Đủ: ${formatVNDShort(r.thuong_full)}<br>Còn: <b>${formatVNDShort(r.thuong_con)}</b>`
                + (r.thuong_mat > 0 ? `<br><span style="color:var(--kd-danger);">Mất ${formatVNDShort(r.thuong_mat)}</span>` : '') },
        ],
        rows,
        rowStyle: (r) => TIER_ROWBG[r.tier] || '',
        emptyMessage: 'Không có NPP nào cần xử lý trong kỳ này 🎉',
    });
}
