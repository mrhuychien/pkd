import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { emptyState } from '../components/empty-state.js';
import { dataTable } from '../components/data-table.js';

const STATUS_BADGE = { 'Đang chạy': 'kd-badge-success', 'Nháp': 'kd-badge-muted', 'Kết thúc': 'kd-badge-warning' };

function pctBadge(v) {
    if (v == null) return '<span class="kd-text-muted">—</span>';
    const up = v >= 0;
    return `<span style="color:${up ? 'var(--kd-success)' : 'var(--kd-danger)'};font-weight:700;">${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Trưng bày', subtitle: 'Chương trình trưng bày (đọc từ salep)' })}
        <div id="kd-tb-body"><div class="kd-skeleton" style="height:300px;"></div></div>
    `;
    let d;
    try {
        d = await api.getDisplaySummary();
    } catch (err) {
        document.getElementById('kd-tb-body').innerHTML = emptyState({ icon: '⚠️', title: 'Lỗi tải trưng bày', message: err.message });
        return;
    }
    const body = document.getElementById('kd-tb-body');
    if (!d.available) {
        body.innerHTML = emptyState({ icon: '🧩', title: 'Chưa có dữ liệu trưng bày', message: 'Bench chưa cài app salep hoặc chưa có chương trình.' });
        return;
    }
    if (d.authorized_salep === false) {
        body.innerHTML = emptyState({ icon: '🔒', title: 'Cần quyền Channel Manager', message: 'Nhờ quản trị gán role "Channel Manager" để xem dữ liệu trưng bày.' });
        return;
    }

    const programCards = (d.programs || []).map((p) => {
        const prog = p.progress_pct != null ? Math.min(100, p.progress_pct) : 0;
        return `
        <div class="kd-card kd-mb-2">
            <div class="kd-flex kd-items-center kd-justify-between">
                <b>${escapeHtml(p.program_name || p.program)}</b>
                <span class="kd-badge ${STATUS_BADGE[p.status] || 'kd-badge-muted'}">${escapeHtml(p.status || '')}</span>
            </div>
            <div class="kd-text-sm kd-text-muted kd-mt-2">Đã duyệt ${formatNumber(p.approved)}/${formatNumber(p.target_points)} điểm · ${p.progress_pct != null ? p.progress_pct.toFixed(0) + '%' : '—'}</div>
            <div class="kd-progress kd-mt-2"><span style="width:${prog}%;"></span></div>
            <div class="kd-text-sm kd-mt-2">Ngân sách: dùng <b>${formatVNDShort(p.budget_used)}</b> / ${formatVNDShort(p.budget)} · còn <b>${formatVNDShort(p.budget_remaining)}</b></div>
        </div>`;
    }).join('') || '<div class="kd-text-sm kd-text-muted">Chưa có chương trình.</div>';

    body.innerHTML = html`
        <div class="kd-mt-3">${programCards}</div>
        <div class="kd-card kd-mt-3">
            <h3 class="kd-font-bold kd-mb-2">Top NPP trưng bày <span class="kd-text-sm kd-text-muted">(doanh số: tham khảo)</span></h3>
            ${dataTable({
                columns: [
                    { key: 'customer_name', label: 'NPP', render: (r) => `<a href="#${r.route}" style="color:var(--kd-primary);font-weight:600;">${escapeHtml(r.customer_name)}</a>` },
                    { key: 'approved', label: 'Lượt duyệt', render: (r) => formatNumber(r.approved) },
                    { key: 'revenue_mtd', label: 'DS MTD (tham khảo)', render: (r) => formatVNDShort(r.revenue_mtd) },
                    { key: 'growth_pct', label: 'vs kỳ trước', render: (r) => pctBadge(r.growth_pct) },
                ], rows: d.rank_npp || [],
            })}
            <div class="kd-text-sm kd-text-muted kd-mt-2">${escapeHtml(d.note || '')}</div>
        </div>
        <div class="kd-card kd-mt-3">
            <h3 class="kd-font-bold kd-mb-2">Top NVBH</h3>
            ${dataTable({
                columns: [
                    { key: 'full_name', label: 'NVBH', render: (r) => escapeHtml(r.full_name) },
                    { key: 'approved', label: 'Lượt duyệt', render: (r) => formatNumber(r.approved) },
                ], rows: d.rank_staff || [],
            })}
        </div>
    `;
}
