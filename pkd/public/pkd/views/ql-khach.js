import { html } from '../lib/dom.js';
import { formatCurrency, formatNumber, formatVNDShort, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { paged } from '../components/data-table.js';
import { qlNav, channelOf, CHANNEL_LABEL, CHANNEL_NOUN } from '../components/ql-nav.js';
import { salesMatrixHtml } from '../components/sales-matrix.js';
import { loadChartLib, chartRegistry } from '../components/chart.js';

// ─── Phân tích CHI TIẾT 1 khách theo kênh (port từ npp quan-ly-npp, KHÔNG margin) ─
const charts = chartRegistry();
let _k = 'npp', _list = null, _months = 12;

const RANK_BADGE = { A: 'success', B: 'primary', C: 'muted' };
const SEG_BADGE = { 'Mới': 'primary', 'Tăng trưởng': 'success', 'Ổn định': 'muted', 'Suy giảm': 'warning', 'Ngủ đông': 'warning', 'Mất': 'danger', 'Chưa mua': 'muted' };
const REC_BORDER = { danger: 'var(--kd-danger)', warning: 'var(--kd-warning)', primary: 'var(--kd-primary, #3b82f6)', muted: 'var(--kd-border)', success: 'var(--kd-success)' };

function pct(v) {
    if (v === null || v === undefined) return '<span class="kd-text-muted">—</span>';
    const up = v >= 0;
    return `<span style="color:${up ? 'var(--kd-success)' : 'var(--kd-danger)'};font-weight:800;">${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
}

export async function render({ container, query }) {
    _k = channelOf(query);
    _list = null;   // kênh có thể đổi → nạp lại danh sách
    const noun = CHANNEL_NOUN[_k];
    const sel = (query && query.c) || '';
    container.innerHTML = html`
        ${banner({ title: `Phân tích chi tiết ${noun}`, subtitle: `Kênh ${CHANNEL_LABEL[_k]} — soi kinh doanh, tài chính, sản phẩm, nhóm hàng` })}
        ${qlNav('kh', _k)}
        <div class="kd-ql-filters kd-mt-2">
            <select id="kd-d-pick" style="min-width:240px;flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--kd-border);background:var(--kd-surface);font-weight:600;color:var(--kd-text);">
                <option value="">— Chọn ${noun} —</option>
            </select>
            <select id="kd-d-period" style="padding:9px 12px;border-radius:10px;border:1px solid var(--kd-border);background:var(--kd-surface);font-weight:600;color:var(--kd-text);">
                <option value="3">3 tháng</option><option value="6">6 tháng</option><option value="12" selected>12 tháng</option>
            </select>
        </div>
        <div id="kd-d-body" class="kd-mt-3"></div>
    `;
    const pick = document.getElementById('kd-d-pick');
    const period = document.getElementById('kd-d-period');
    try {
        if (!_list) _list = await api.mgr.customerList(_k);
        pick.innerHTML = `<option value="">— Chọn ${noun} —</option>` + (_list || []).map((r) =>
            `<option value="${escapeHtml(r.customer)}">${escapeHtml(r.customer_name)}${r.territory ? ' · ' + escapeHtml(r.territory) : ''}</option>`).join('');
    } catch (err) {
        document.getElementById('kd-d-body').innerHTML = errBox(err.message);
        return;
    }
    pick.value = sel;
    period.value = String(_months);
    pick.addEventListener('change', () => { syncHash(pick.value); loadDetail(pick.value); });
    period.addEventListener('change', () => { _months = parseInt(period.value, 10) || 12; loadDetail(pick.value); });
    if (sel) loadDetail(sel); else emptyState();
}

function syncHash(c) {
    const h = c ? `#/ql-khach?k=${_k}&c=${encodeURIComponent(c)}` : `#/ql-khach?k=${_k}`;
    history.replaceState(null, '', h);   // sync URL, không re-render
}
function emptyState() {
    const noun = CHANNEL_NOUN[_k];
    document.getElementById('kd-d-body').innerHTML =
        `<div class="kd-empty"><div class="kd-empty-icon">🔍</div><div class="kd-empty-title">Chọn một ${noun} để phân tích</div><div class="kd-text-sm kd-text-muted">Dùng ô chọn phía trên.</div></div>`;
}
function errBox(msg) {
    return `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div>${escapeHtml(msg || 'Lỗi')}</div></div>`;
}

async function loadDetail(customer) {
    const body = document.getElementById('kd-d-body');
    if (!customer) { emptyState(); return; }
    body.innerHTML = '<div class="kd-skeleton" style="height:320px;"></div>';
    try {
        const Chart = await loadChartLib();
        const d = await api.mgr.customerDetail(_k, customer, _months);
        charts.destroy();
        renderAll(d);
        renderTrend(Chart, d.sales.monthly || []);
        renderGroupChart(Chart, d.item_groups.by_group || []);
        if (_k === 'mt') loadChainOutlets(customer);   // MT: chi tiết từng siêu thị của chuỗi
    } catch (err) {
        body.innerHTML = errBox(err.message);
    }
}

// ─── MT: phân tích toàn bộ siêu thị thuộc chuỗi (shipping_address_name) ─────
function pctCell(v) {
    if (v === null || v === undefined) return '<span class="kd-text-muted">—</span>';
    const up = v >= 0;
    return `<span style="color:${up ? 'var(--kd-success)' : 'var(--kd-danger)'};font-weight:700;">${up ? '▲' : '▼'}${Math.abs(v).toFixed(0)}%</span>`;
}

async function loadChainOutlets(customer) {
    const host = document.getElementById('kd-d-outlets');
    if (!host) return;
    host.innerHTML = '<div class="kd-skeleton" style="height:260px;"></div>';
    try {
        const d = await api.mgr.mtChainOutlets(customer, _months);
        renderOutlets(host, customer, d);
    } catch (err) {
        host.innerHTML = `<div class="kd-card"><div class="kd-text-muted">Không tải được chi tiết siêu thị: ${escapeHtml(err.message)}</div></div>`;
    }
}

function renderOutlets(host, customer, d) {
    const t = d.totals || {};
    const hy = d.hygiene || {};
    const outlets = d.outlets || [];
    const monthsLbl = d.months === 1 ? 'tháng này' : `${d.months} tháng`;

    const hygieneNote = (hy.no_addr_revenue > 0)
        ? `<div class="kd-card kd-mb-2" style="border-left:4px solid var(--kd-warning);background:rgba(245,158,11,.06);">
             <b>⚠️ ${formatVNDShort(hy.no_addr_revenue)} (${hy.addr_pct != null ? (100 - hy.addr_pct).toFixed(0) : '?'}% doanh số, ${d.no_addr?.orders || 0} HĐ) KHÔNG ghi địa chỉ giao</b>
             <div class="kd-text-sm">Phần này không phân bổ được về siêu thị nào — <a href="javascript:void(0)" class="kd-link" id="kd-ot-noaddr">soi bucket thiếu địa chỉ →</a></div></div>`
        : '';

    const outletRow = (o, idx) => `<tr>
        <td data-label="Siêu thị"><strong style="color:var(--kd-text-muted);">${idx + 1}.</strong>
            <a href="javascript:void(0)" class="kd-link kd-ot-drill" data-o="${escapeHtml(o.outlet)}">${escapeHtml(o.title)}</a>
            ${o.silent ? ' <span class="kd-badge kd-badge-warning">im lặng</span>' : ''}</td>
        <td data-label="Doanh số" class="kd-text-end"><strong>${formatVNDShort(o.revenue)}</strong>
            <div class="kd-text-sm kd-text-muted">${o.share_pct != null ? o.share_pct.toFixed(1) + '%' : '—'} chuỗi</div></td>
        <td data-label="vs kỳ trước" class="kd-text-end">${pctCell(o.growth_pct)}</td>
        <td data-label="YoY" class="kd-text-end">${pctCell(o.yoy_pct)}</td>
        <td data-label="Thùng" class="kd-text-end">${formatNumber(o.boxes)}</td>
        <td data-label="Đơn" class="kd-text-end">${formatNumber(o.orders)}<div class="kd-text-sm kd-text-muted">TB ${formatVNDShort(o.aov)}</div></td>
        <td data-label="Nhóm" class="kd-text-end">${o.groups_bought}</td>
        <td data-label="Đơn cuối">${o.last_invoice ? formatDate(o.last_invoice) : '—'}${o.days_since != null ? `<div class="kd-text-sm kd-text-muted">${o.days_since}d trước${o.avg_cycle ? ' · nhịp ~' + o.avg_cycle + 'd' : ''}</div>` : ''}</td>
    </tr>`;
    const outletTable = outlets.length ? paged({
        rows: outlets,
        pageSize: 10,
        render: (slice, start) => `<div style="overflow-x:auto;"><table class="kd-table">
                <thead><tr><th>Siêu thị</th><th class="kd-text-end">Doanh số</th><th class="kd-text-end">vs kỳ trước</th><th class="kd-text-end">YoY</th><th class="kd-text-end">Thùng</th><th class="kd-text-end">Đơn</th><th class="kd-text-end">Nhóm</th><th>Đơn cuối</th></tr></thead>
                <tbody>${slice.map((o, i) => outletRow(o, start + i)).join('')}</tbody>
            </table></div>`,
        onDraw: (el) => el.querySelectorAll('.kd-ot-drill').forEach((a) =>
            a.addEventListener('click', () => drillOutlet(customer, a.dataset.o))),
    }) : '<div class="kd-text-center kd-text-muted" style="padding:1rem;">Chưa có siêu thị nào phát sinh đơn trong kỳ</div>';

    host.innerHTML = html`
        <h3 class="kd-font-bold kd-mt-3">🏬 Siêu thị thuộc chuỗi (${monthsLbl})</h3>
        <div class="kd-kpi-grid">
            <div class="kd-kpi-card"><div class="kd-kpi-label">Siêu thị có đơn</div>
                <div class="kd-kpi-value">${formatNumber(t.outlet_count || 0)}</div>
                <div class="kd-kpi-sub">😴 ${formatNumber(t.silent_count || 0)} im lặng</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Doanh số chuỗi</div>
                <div class="kd-kpi-value">${formatVNDShort(t.revenue || 0)}</div>
                <div class="kd-kpi-sub">${formatNumber(t.boxes || 0)} thùng · ${formatNumber(t.orders || 0)} đơn</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">% có địa chỉ giao</div>
                <div class="kd-kpi-value">${hy.addr_pct != null ? hy.addr_pct.toFixed(0) + '%' : '—'}</div>
                <div class="kd-kpi-sub">theo doanh số kỳ</div></div>
        </div>
        ${hygieneNote}
        <div class="kd-card kd-mt-2">
            ${outletTable}
            <p class="kd-text-sm kd-text-muted kd-mt-2">So kỳ cùng số ngày (period-aligned). Bấm tên siêu thị để soi nhóm hàng, xu hướng, hoá đơn.</p>
        </div>
        <div id="kd-ot-detail" class="kd-mt-2"></div>
        <div id="kd-ot-matrix" class="kd-mt-2"></div>
    `;

    // Ma trận siêu thị × tháng (tái dùng sales-matrix, hàng không phải link).
    document.getElementById('kd-ot-matrix').innerHTML = salesMatrixHtml({
        meta: { noun: 'Siêu thị' },
        fiscal_year: `${d.months} tháng gần nhất`,
        fy_start: null,
        months: d.month_list || [],
        rows: outlets.map((o) => ({ customer: o.outlet, customer_name: o.title, monthly: o.monthly || {}, total: o.revenue })),
        totals: { monthly: t.monthly || {}, grand_total: t.revenue || 0 },
    }, { showKpis: false, title: 'Doanh số từng siêu thị theo tháng', showMeta: true, detailHref: null });

    // .kd-ot-drill đã bind trong onDraw của paged() (re-bind mỗi lần chuyển trang).
    document.getElementById('kd-ot-noaddr')?.addEventListener('click', () => drillOutlet(customer, d.no_addr?.outlet || '(không ghi địa chỉ)'));
}

async function drillOutlet(customer, outlet) {
    const panel = document.getElementById('kd-ot-detail');
    if (!panel) return;
    panel.innerHTML = '<div class="kd-skeleton" style="height:200px;"></div>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
        const Chart = await loadChartLib();
        const d = await api.mgr.mtOutletDetail(customer, outlet, _months);
        panel.innerHTML = html`
            <div class="kd-card" style="background:var(--kd-surface-2);">
                <div class="kd-flex kd-justify-between kd-items-center">
                    <h3 class="kd-font-bold">🔍 ${escapeHtml(d.title)}</h3>
                    <button type="button" id="kd-ot-close" class="kd-icon-btn" aria-label="Đóng"><i class="fas fa-times"></i></button>
                </div>
                <div class="kd-chart-wrap kd-mt-2"><canvas id="kd-ot-trend"></canvas></div>
                <div class="kd-grid-2 kd-mt-2">
                    <div>
                        <h4 class="kd-font-bold kd-text-sm">Cơ cấu nhóm hàng (kỳ)</h4>
                        ${(d.by_group || []).length ? `<table class="kd-table kd-mt-2"><thead><tr><th>Nhóm</th><th class="kd-text-end">DS</th><th class="kd-text-end">Thùng</th><th class="kd-text-end">%</th></tr></thead>
                        <tbody>${d.by_group.map((g) => `<tr><td data-label="Nhóm">${escapeHtml(g.item_group)}</td><td data-label="DS" class="kd-text-end">${formatVNDShort(g.revenue)}</td><td data-label="Thùng" class="kd-text-end">${formatNumber(g.qty)}</td><td data-label="%" class="kd-text-end">${(g.pct || 0).toFixed(1)}%</td></tr>`).join('')}</tbody></table>` : '<div class="kd-text-sm kd-text-muted">Chưa có dữ liệu.</div>'}
                    </div>
                    <div>
                        <h4 class="kd-font-bold kd-text-sm">Hoá đơn gần nhất</h4>
                        ${(d.invoices || []).length ? `<table class="kd-table kd-mt-2"><thead><tr><th>Ngày</th><th>Số HĐ</th><th class="kd-text-end">Tổng</th><th class="kd-text-end">Còn nợ</th></tr></thead>
                        <tbody>${d.invoices.map((r) => `<tr><td data-label="Ngày">${formatDate(r.posting_date)}</td><td data-label="Số HĐ">${escapeHtml(r.invoice)}</td><td data-label="Tổng" class="kd-text-end">${formatVNDShort(r.grand_total)}</td><td data-label="Nợ" class="kd-text-end">${formatVNDShort(r.outstanding)}</td></tr>`).join('')}</tbody></table>` : '<div class="kd-text-sm kd-text-muted">Chưa có hoá đơn.</div>'}
                    </div>
                </div>
            </div>`;
        document.getElementById('kd-ot-close').addEventListener('click', () => { panel.innerHTML = ''; });
        const m = d.monthly || [];
        charts.add(new Chart(document.getElementById('kd-ot-trend'), {
            data: {
                labels: m.map((x) => x.month),
                datasets: [
                    { type: 'bar', label: 'Thùng', data: m.map((x) => x.qty), backgroundColor: 'rgba(16,185,129,0.45)', yAxisID: 'y1', order: 2 },
                    { type: 'line', label: 'Doanh số', data: m.map((x) => x.revenue), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)', tension: 0.3, fill: true, yAxisID: 'y', order: 1 },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => c.dataset.yAxisID === 'y' ? `DS: ${formatVNDShort(c.parsed.y)}` : `Thùng: ${formatNumber(c.parsed.y)}` } } },
                scales: { y: { position: 'left', ticks: { callback: (v) => formatVNDShort(v) } }, y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => formatNumber(v) } } },
            },
        }));
    } catch (err) {
        panel.innerHTML = `<div class="kd-card"><div class="kd-text-muted">${escapeHtml(err.message)}</div></div>`;
    }
}

function renderAll(d) {
    const p = d.profile, s = d.sales, f = d.finance, t = d.target, g = d.item_groups;
    const noun = CHANNEL_NOUN[_k];
    const monthsLbl = d.months === 1 ? 'tháng này' : `${d.months} tháng`;
    document.getElementById('kd-d-body').innerHTML = html`
        <!-- Hồ sơ -->
        <div class="kd-card">
            <div class="kd-flex kd-justify-between kd-items-center kd-flex-wrap" style="gap:8px;">
                <div>
                    <h2 style="margin:0;font-size:1.25rem;font-weight:800;">${escapeHtml(p.customer_name)}</h2>
                    <div class="kd-text-sm kd-text-muted">${escapeHtml(p.customer)} · ${escapeHtml(p.territory || '—')}${p.since ? ' · KH từ ' + formatDate(p.since) : ''}</div>
                </div>
                <div class="kd-flex" style="gap:6px;">
                    <span class="kd-badge kd-badge-${RANK_BADGE[p.rank] || 'muted'}">Hạng ${p.rank}</span>
                    <span class="kd-badge kd-badge-${SEG_BADGE[p.segment] || 'muted'}">${escapeHtml(p.segment)}</span>
                </div>
            </div>
            <div class="kd-flex kd-flex-wrap kd-text-sm kd-mt-2" style="gap:14px;color:var(--kd-text-muted);">
                <span>🛒 ${p.orders_all} đơn (toàn thời gian)</span>
                <span>🕒 Đặt gần nhất: ${p.last_order ? formatDate(p.last_order) : '—'}${p.days_since != null ? ` (${p.days_since} ngày trước)` : ''}</span>
                <span>🔁 Chu kỳ TB: ${p.avg_cycle ? p.avg_cycle + ' ngày' : '—'}</span>
                <span>📅 Dự kiến đặt tới: ${p.next_expected ? formatDate(p.next_expected) : '—'}${p.overdue_reorder ? ' ⏰ quá hạn' : ''}</span>
            </div>
        </div>

        <!-- Khuyến nghị -->
        <div class="kd-card kd-mt-3">
            <h3 class="kd-font-bold">💡 Khuyến nghị thị trường</h3>
            <div class="kd-mt-2" style="display:flex;flex-direction:column;gap:8px;">
                ${(d.recommendations || []).map((r) => `
                    <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--kd-border);border-left:4px solid ${REC_BORDER[r.level] || 'var(--kd-border)'};border-radius:10px;background:var(--kd-surface-2);">
                        <span style="font-size:1.1rem;line-height:1.2;">${r.icon || '•'}</span>
                        <div><strong>${escapeHtml(r.title)}</strong><div class="kd-text-sm kd-text-muted">${escapeHtml(r.detail)}</div></div>
                    </div>`).join('')}
            </div>
        </div>

        <!-- Kinh doanh -->
        <h3 class="kd-font-bold kd-mt-3">Kinh doanh (${monthsLbl})</h3>
        <div class="kd-kpi-grid">
            <div class="kd-kpi-card"><div class="kd-kpi-label">Doanh số</div><div class="kd-kpi-value">${formatVNDShort(s.revenue || 0)}</div>
                <div class="kd-kpi-sub">${pct(s.growth_pct)} vs kỳ trước · ${pct(s.yoy_pct)} vs năm trước</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Sản lượng</div><div class="kd-kpi-value">${formatNumber(s.qty || 0)} <span style="font-size:.8rem;font-weight:600;">thùng</span></div>
                <div class="kd-kpi-sub">${formatNumber(s.orders || 0)} đơn · TB/đơn ${formatVNDShort(s.aov || 0)}</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Độ đa dạng</div><div class="kd-kpi-value">${s.skus || 0} <span style="font-size:.8rem;font-weight:600;">SKU</span></div>
                <div class="kd-kpi-sub">${s.groups_bought || 0}/${g.total_groups || 0} nhóm hàng</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Mục tiêu</div>
                <div class="kd-kpi-value">${t.attainment_pct == null ? '—' : t.attainment_pct.toFixed(0) + '%'}</div>
                <div class="kd-kpi-sub">${t.monthly_target ? formatVNDShort(t.monthly_target) + '/tháng · nhịp ~' + (t.expected_pace_pct || 0).toFixed(0) + '%' : (t.available === false ? 'Cần app npp' : 'Chưa đặt mục tiêu')}</div></div>
        </div>
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Xu hướng doanh số &amp; sản lượng (12 tháng)</h3>
            <div class="kd-chart-wrap"><canvas id="kd-d-trend"></canvas></div></div>

        <!-- Tài chính -->
        <h3 class="kd-font-bold kd-mt-3">Tài chính</h3>
        <div class="kd-kpi-grid">
            <div class="kd-kpi-card"><div class="kd-kpi-label">Tổng công nợ (GL)</div><div class="kd-kpi-value ${f.debt > 0 ? 'danger' : ''}">${formatVNDShort(f.debt || 0)}</div>
                <div class="kd-kpi-sub">DSO ~${f.dso == null ? '—' : Math.round(f.dso)} ngày</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Nợ quá hạn</div><div class="kd-kpi-value ${f.overdue > 0 ? 'danger' : ''}">${formatVNDShort(f.overdue || 0)}</div>
                <div class="kd-kpi-sub">>90 ngày: ${formatVNDShort((f.buckets || {}).over_90 || 0)}</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Hạn mức tín dụng</div>
                <div class="kd-kpi-value ${f.credit_usage_pct >= 100 ? 'danger' : (f.credit_usage_pct >= 80 ? 'warning' : '')}">${f.credit_usage_pct == null ? '—' : f.credit_usage_pct.toFixed(0) + '%'}</div>
                <div class="kd-kpi-sub">${f.credit_limit ? 'Hạn mức ' + formatVNDShort(f.credit_limit) : 'Chưa đặt hạn mức'}</div></div>
        </div>
        ${f.debt > 0 ? html`<div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Tuổi nợ</h3>
            <table class="kd-table kd-mt-2"><tbody>
                ${[['Trong hạn', 'current'], ['1–30 ngày', 'd1_30'], ['31–60 ngày', 'd31_60'], ['61–90 ngày', 'd61_90'], ['> 90 ngày', 'over_90']].map(([lbl, k]) =>
                    `<tr><td>${lbl}</td><td class="kd-text-end"><strong style="color:${k === 'over_90' ? 'var(--kd-danger)' : (k === 'current' ? 'var(--kd-success)' : 'var(--kd-text)')};">${formatCurrency((f.buckets || {})[k] || 0)}</strong></td></tr>`).join('')}
            </tbody></table></div>` : ''}

        <!-- Lịch thanh toán & các khoản thu -->
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Lịch thanh toán (hoá đơn còn nợ)</h3>
            ${(f.open_invoices && f.open_invoices.length) ? paged({
                rows: f.open_invoices,
                pageSize: 10,
                render: (slice) => html`<div style="overflow-x:auto;"><table class="kd-table kd-mt-2">
                <thead><tr><th>Hoá đơn</th><th>Ngày</th><th>Hạn TT</th><th class="kd-text-end">Còn nợ</th><th class="kd-text-end">Quá hạn</th></tr></thead>
                <tbody>${slice.map((r) => `<tr>
                    <td data-label="Hoá đơn">${escapeHtml(r.invoice)}</td>
                    <td data-label="Ngày">${formatDate(r.posting_date)}</td>
                    <td data-label="Hạn TT">${r.due_date ? formatDate(r.due_date) : '—'}</td>
                    <td data-label="Còn nợ" class="kd-text-end">${formatCurrency(r.outstanding)}</td>
                    <td data-label="Quá hạn" class="kd-text-end">${r.days_overdue > 0 ? `<strong style="color:var(--kd-danger);">${r.days_overdue} ngày</strong>` : '<span class="kd-text-muted">trong hạn</span>'}</td>
                </tr>`).join('')}</tbody></table></div>`,
            }) : '<p class="kd-text-muted kd-mt-2">🎉 Không còn hoá đơn nợ.</p>'}
        </div>
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Các khoản đã thanh toán (gần đây)</h3>
            ${(f.payments && f.payments.length) ? paged({
                rows: f.payments,
                pageSize: 10,
                render: (slice) => html`<table class="kd-table kd-mt-2">
                <thead><tr><th>Phiếu thu</th><th>Ngày</th><th class="kd-text-end">Số tiền</th></tr></thead>
                <tbody>${slice.map((r) => `<tr>
                    <td data-label="Phiếu thu">${escapeHtml(r.name)}</td>
                    <td data-label="Ngày">${formatDate(r.posting_date)}</td>
                    <td data-label="Số tiền" class="kd-text-end" style="color:var(--kd-success);font-weight:700;">${formatCurrency(r.amount)}</td>
                </tr>`).join('')}</tbody></table>`,
            }) : '<p class="kd-text-muted kd-mt-2">Chưa ghi nhận khoản thu (Payment Entry) nào.</p>'}
        </div>

        <!-- Nhóm hàng -->
        <h3 class="kd-font-bold kd-mt-3">Nhóm hàng</h3>
        <div class="kd-grid-2">
            <div class="kd-card"><h3 class="kd-font-bold">Cơ cấu nhóm hàng</h3>
                <div class="kd-chart-wrap"><canvas id="kd-d-group"></canvas></div></div>
            <div class="kd-card">
                <h3 class="kd-font-bold">Độ phủ danh mục</h3>
                <div class="kd-kpi-value kd-mt-2">${(g.coverage_pct || 0).toFixed(0)}% <span style="font-size:.85rem;font-weight:600;color:var(--kd-text-muted);">(${g.bought || 0}/${g.total_groups || 0} nhóm)</span></div>
                <p class="kd-text-sm kd-text-muted kd-mt-3">${g.not_bought && g.not_bought.length ? 'Nhóm hàng CHƯA nhập (cơ hội cross-sell):' : '🎉 Đã nhập đủ các nhóm hàng đang bán.'}</p>
                <div class="kd-flex kd-flex-wrap kd-mt-2" style="gap:6px;">
                    ${(g.not_bought || []).map((x) => `<span class="kd-badge kd-badge-warning">${escapeHtml(x)}</span>`).join('')}
                </div>
            </div>
        </div>

        <!-- Sản phẩm: tăng / giảm / chưa nhập -->
        <div class="kd-grid-2 kd-mt-3">
            <div class="kd-card"><h3 class="kd-font-bold">📈 Mã hàng đang tăng</h3><div class="kd-mt-2">${moverList(d.products, 'up')}</div></div>
            <div class="kd-card"><h3 class="kd-font-bold">📉 Mã hàng đang giảm</h3><div class="kd-mt-2">${moverList(d.products, 'down')}</div></div>
        </div>
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">🧩 Mã hàng CHƯA nhập (kênh đang bán) — cơ hội thúc đẩy</h3>
            ${(d.products_not_bought && d.products_not_bought.length) ? html`<div style="overflow-x:auto;"><table class="kd-table kd-mt-2">
                <thead><tr><th>SKU</th><th class="kd-text-end">Đang bán ở</th><th class="kd-text-end">DS kênh (12T)</th></tr></thead>
                <tbody>${d.products_not_bought.map((r) => `<tr>
                    <td data-label="SKU">${escapeHtml(r.item_name)}<div class="kd-text-sm kd-text-muted">${escapeHtml(r.item_code)}</div></td>
                    <td data-label="Đang bán ở" class="kd-text-end">${r.buyers}/${r.total_npp} ${escapeHtml(noun)}</td>
                    <td data-label="DS kênh" class="kd-text-end">${formatCurrency(r.channel_revenue)}</td>
                </tr>`).join('')}</tbody></table></div>` : `<p class="kd-text-muted kd-mt-2">🎉 ${escapeHtml(noun)} đã nhập mọi mã hàng kênh đang bán.</p>`}
        </div>

        <!-- Sản phẩm -->
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Sản phẩm (top theo doanh số)</h3>
            ${(d.products || []).length ? paged({
                rows: d.products,
                pageSize: 10,
                render: (slice) => html`<div style="overflow-x:auto;"><table class="kd-table kd-mt-2">
                <thead><tr><th>SKU</th><th>Nhóm</th><th class="kd-text-end">Doanh số</th><th class="kd-text-end">% DS</th><th class="kd-text-end">+/- kỳ trước</th></tr></thead>
                <tbody>
                    ${slice.map((r) => html`<tr>
                        <td data-label="SKU"><strong>${escapeHtml(r.item_name)}</strong><div class="kd-text-sm kd-text-muted">${escapeHtml(r.item_code)} · ${formatNumber(r.qty)} thùng</div></td>
                        <td data-label="Nhóm">${escapeHtml(r.item_group || '—')}</td>
                        <td data-label="Doanh số" class="kd-text-end">${formatCurrency(r.revenue)}</td>
                        <td data-label="% DS" class="kd-text-end">${(r.pct_of_total || 0).toFixed(1)}%</td>
                        <td data-label="+/-" class="kd-text-end">${pct(r.growth_pct)}</td>
                    </tr>`).join('')}
                </tbody>
            </table></div>`,
            }) : '<p class="kd-text-muted kd-mt-2">Chưa có doanh số trong kỳ.</p>'}
        </div>

        <!-- MT: chi tiết từng siêu thị của chuỗi (đổ bởi loadChainOutlets) -->
        <div id="kd-d-outlets"></div>
    `;
}

function moverList(products, dir) {
    let rows = (products || []).filter((x) => (dir === 'up' ? x.delta > 0 : x.delta < 0));
    rows = rows.sort((a, b) => (dir === 'up' ? b.delta - a.delta : a.delta - b.delta)).slice(0, 10);
    if (!rows.length) return '<div class="kd-text-muted kd-text-sm">Không có</div>';
    return rows.map((x) => {
        const up = x.delta >= 0;
        const pctTxt = x.growth_pct == null ? (x.prev_revenue ? '' : 'mới') : (up ? '▲' : '▼') + Math.abs(x.growth_pct).toFixed(0) + '%';
        return `<div class="kd-flex kd-justify-between kd-text-sm" style="padding:6px 0;border-bottom:1px solid var(--kd-border);gap:8px;">
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(x.item_name)}</span>
            <span style="color:${up ? 'var(--kd-success)' : 'var(--kd-danger)'};font-weight:700;white-space:nowrap;">${up ? '+' : ''}${formatVNDShort(x.delta)}${pctTxt ? ' · ' + pctTxt : ''}</span></div>`;
    }).join('');
}

function renderTrend(Chart, m) {
    const el = document.getElementById('kd-d-trend');
    if (!el) return;
    charts.add(new Chart(el, {
        data: {
            labels: m.map((x) => x.month),
            datasets: [
                { type: 'bar', label: 'Số thùng', data: m.map((x) => x.qty), backgroundColor: 'rgba(16,185,129,0.45)', yAxisID: 'y1', order: 3 },
                { type: 'line', label: 'Doanh số', data: m.map((x) => x.revenue), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)', tension: 0.3, fill: true, yAxisID: 'y', order: 1 },
                { type: 'line', label: 'Cùng kỳ năm trước', data: m.map((x) => x.revenue_ly || 0), borderColor: '#94a3b8', borderDash: [5, 5], tension: 0.3, fill: false, yAxisID: 'y', order: 2 },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => c.dataset.yAxisID === 'y' ? `${c.dataset.label}: ${formatCurrency(c.parsed.y)}` : `Thùng: ${formatNumber(c.parsed.y)}` } } },
            scales: { y: { position: 'left', ticks: { callback: (v) => formatVNDShort(v) } }, y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => formatNumber(v) } } },
        },
    }));
}

function renderGroupChart(Chart, grp) {
    const el = document.getElementById('kd-d-group');
    if (!el) return;
    if (!grp.length) { const w = el.closest('.kd-chart-wrap'); if (w) w.innerHTML = '<div class="kd-text-muted kd-text-center" style="padding:2rem;">Chưa có doanh số trong kỳ</div>'; return; }
    charts.add(new Chart(el, {
        type: 'doughnut',
        data: { labels: grp.map((x) => x.item_group), datasets: [{ data: grp.map((x) => x.revenue), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${formatCurrency(c.parsed)}` } } } },
    }));
}
