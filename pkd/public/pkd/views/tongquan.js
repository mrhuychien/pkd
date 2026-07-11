import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';
import { pagedTable } from '../components/data-table.js';
import { loadChartLib, chartRegistry } from '../components/chart.js';

const charts = chartRegistry();
const bcCharts = chartRegistry();   // chart của section Kinh doanh chung (re-render riêng)

// Màu kênh CỐ ĐỊNH xuyên mọi chart (đã qua validator palette — màu theo thực thể).
const CH_COLORS = { npp: '#f59e0b', mt: '#10b981', dulich: '#3b82f6', khac: '#ec4899' };
// Palette top-10 (đã validate CVD; donut luôn kèm bảng giá trị làm secondary encoding).
const TOP10 = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#8b5cf6', '#f97316', '#0d9488'];

const trieu = (v) => formatNumber((v || 0) / 1e6);   // hiển thị triệu đồng như Grafana

// ▲/▼ có màu semantic (không dùng màu mùa).
function pctBadge(v) {
    if (v === null || v === undefined) return '<span class="kd-text-muted">—</span>';
    const up = v >= 0;
    return `<span style="color:${up ? 'var(--kd-success)' : 'var(--kd-danger)'};font-weight:800;">${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
}

// Đèn semantic đạt/nhịp: xanh ≥ pace, vàng ≥ 80% pace, đỏ < 80% pace.
function paceClass(attain, pace) {
    if (attain === null || attain === undefined || !pace) return '';
    if (attain >= pace) return 'kd-badge-success';
    if (attain >= pace * 0.8) return 'kd-badge-warning';
    return 'kd-badge-danger';
}

const cardSkeleton = () => html`<div class="kd-card kd-skeleton" style="height:92px;"></div>`;

export async function render({ container }) {
    const ctx = window.PKD_CONTEXT || {};
    const who = ctx.userFullName || ctx.userFirstName || 'Phòng Kinh doanh';
    const todayStr = formatDate(new Date());

    container.innerHTML = html`
        ${banner({ title: `Xin chào, ${who}`, subtitle: `Nhịp hôm nay · ${todayStr}` })}
        <div id="kd-ov-tet"></div>
        <div class="kd-kpi-grid" id="kd-ov-kpis">
            ${cardSkeleton()}${cardSkeleton()}${cardSkeleton()}${cardSkeleton()}
        </div>
        <h3 class="kd-font-bold kd-mt-3">3 kênh (MTD)</h3>
        <div class="kd-dashboard-grid" id="kd-ov-channels">
            ${cardSkeleton()}${cardSkeleton()}${cardSkeleton()}
        </div>
        <h3 class="kd-font-bold kd-mt-3">🔥 Hàng đợi hành động — hôm nay làm gì</h3>
        <div id="kd-ov-queues"><div class="kd-skeleton" style="height:160px;"></div></div>
        <div class="kd-card kd-mt-3">
            <h3 class="kd-font-bold">Cơ cấu nhóm hàng (MTD)</h3>
            <div class="kd-chart-wrap"><canvas id="kd-ov-mix"></canvas></div>
        </div>

        <!-- ═══ Kinh doanh chung — báo cáo quản trị theo năm tài chính ═══ -->
        <div class="kd-flex kd-items-center kd-justify-between kd-mt-3" style="flex-wrap:wrap;gap:8px;">
            <h3 class="kd-font-bold">📊 Kinh doanh chung — năm tài chính</h3>
            <div class="kd-filter-bar">
                <label>Năm TC <select id="kd-bc-fy"></select></label>
                <label>Kênh <select id="kd-bc-channel">
                    <option value="">Tất cả</option><option value="npp">NPP</option>
                    <option value="mt">MT</option><option value="dulich">Du lịch</option>
                    <option value="khac">Khác</option>
                </select></label>
            </div>
        </div>
        <div id="kd-bc-body" class="kd-mt-2"><div class="kd-skeleton" style="height:320px;"></div></div>
    `;

    document.getElementById('kd-bc-channel').addEventListener('change', () => loadBusinessReport());
    document.getElementById('kd-bc-fy').addEventListener('change', () => loadBusinessReport());
    loadBusinessReport();   // tải song song với overview

    try {
        const [ov, q] = await Promise.all([
            api.cached.overview(),
            api.getActionQueues(),
        ]);
        renderTetBanner(ov.tet);
        renderKpis(ov);
        renderChannels(ov);
        renderQueues(q.queues || []);
        await renderMix(ov.mix_item_group || []);
    } catch (err) {
        showToast('Lỗi tải tổng quan: ' + err.message, 'error');
        document.getElementById('kd-ov-kpis').innerHTML =
            `<div class="kd-empty" style="grid-column:1/-1;"><div class="kd-empty-icon">⚠️</div>
             <div class="kd-empty-title">Không tải được dữ liệu</div>
             <div class="kd-text-sm">${escapeHtml(err.message)}</div></div>`;
    }
}

function renderTetBanner(tet) {
    const root = document.getElementById('kd-ov-tet');
    if (!root || !tet || !tet.in_window) { if (root) root.innerHTML = ''; return; }
    root.innerHTML = html`
        <a href="#/tet" class="kd-card kd-mb-2" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--kd-text);border-left:4px solid var(--kd-warning);">
            <span style="font-size:1.6rem;">🧧</span>
            <span><b>Mùa Tết ${tet.tet_year}</b> — còn ${formatNumber(tet.days_to_tet)} ngày. Xem theo dõi Tết →</span>
        </a>`;
}

function renderKpis(ov) {
    const t = ov.total || {};
    const p = ov.period || {};
    const ag = ov.aging_total || {};
    const over30 = (ag.d31_60 || 0) + (ag.d61_90 || 0) + (ag.d90p || 0);
    const attain = t.attainment_pct, pace = p.pace_pct;
    document.getElementById('kd-ov-kpis').innerHTML = html`
        <div class="kd-kpi-card">
            <div class="kd-kpi-label">Doanh số MTD (toàn phòng)</div>
            <div class="kd-kpi-value">${formatVNDShort(t.mtd || 0)}</div>
            <div class="kd-kpi-sub">${pctBadge(t.growth_pct)} vs kỳ trước · ${pctBadge(t.yoy_pct)} YoY <span class="kd-text-muted">(cùng số ngày)</span></div>
        </div>
        <div class="kd-kpi-card">
            <div class="kd-kpi-label">Run-rate (ước cả tháng)</div>
            <div class="kd-kpi-value">${formatVNDShort(t.run_rate || 0)}</div>
            <div class="kd-kpi-sub">Nhịp kỳ vọng ${pace != null ? pace.toFixed(0) : '—'}% · ${formatNumber(t.invoices || 0)} HĐ · ${formatNumber(t.buyers || 0)} KH</div>
        </div>
        <div class="kd-kpi-card">
            <div class="kd-kpi-label">% Đạt chỉ tiêu</div>
            <div class="kd-kpi-value">${attain != null ? attain.toFixed(0) + '%' : '—'} <span class="kd-badge ${paceClass(attain, pace)}">nhịp ${pace != null ? pace.toFixed(0) : '—'}%</span></div>
            <div class="kd-kpi-sub">Chỉ tiêu tháng ${formatVNDShort(t.target || 0)}</div>
        </div>
        <div class="kd-kpi-card">
            <div class="kd-kpi-label">Nợ quá 30 ngày</div>
            <div class="kd-kpi-value danger">${formatVNDShort(over30)}</div>
            <div class="kd-kpi-sub">Tổng nợ ${formatVNDShort(ag.total || 0)} · DSO ~${ag.dso != null ? Math.round(ag.dso) : '—'} ngày</div>
        </div>
    `;
}

function renderChannels(ov) {
    const root = document.getElementById('kd-ov-channels');
    const chs = ov.channels || [];
    const pace = ov.period?.pace_pct;
    if (!chs.length) { root.innerHTML = ''; return; }
    root.innerHTML = chs.map((c) => {
        const attain = c.attainment_pct;
        return html`
        <a href="#/${c.key}" class="kd-card kd-dash-card">
            <div class="kd-dash-info">
                <div class="kd-dash-label">${escapeHtml(c.label)}</div>
                <div class="kd-dash-value">${formatVNDShort(c.mtd || 0)}</div>
                <div class="kd-dash-sub">${pctBadge(c.growth_pct)} · ${formatNumber(c.boxes_mtd || 0)} thùng</div>
                <div class="kd-dash-sub"><span class="kd-badge ${paceClass(attain, pace)}">đạt ${attain != null ? attain.toFixed(0) + '%' : '—'}</span></div>
            </div>
            <i class="fas fa-chevron-right kd-dash-chev"></i>
        </a>`;
    }).join('');
}

// Nhãn giá trị mỗi item theo loại queue.
function itemValue(qid, it) {
    if (qid === 'no_31_60') return formatVNDShort(it.value);
    if (qid === 'rot_segment') return escapeHtml(it.metric);
    if (qid === 'thieu_sku') return escapeHtml(it.metric);
    if (qid === 'qua_nhip') return `${formatNumber(it.value)} ngày · ${escapeHtml(it.metric)}`;
    return `${formatNumber(it.value)} ${escapeHtml(it.metric)}`;
}

function renderQueues(queues) {
    const root = document.getElementById('kd-ov-queues');
    if (!queues.length) { root.innerHTML = ''; return; }
    root.innerHTML = queues.map((q) => {
        const preview = (q.items || []).slice(0, 5);
        const rows = preview.map((it) => html`
            <a class="kd-queue-row" href="#${it.route}">
                <span class="kd-queue-name">${escapeHtml(it.customer_name || it.customer)}</span>
                <span class="kd-queue-val">${itemValue(q.id, it)}</span>
            </a>`).join('');
        const badgeClass = q.count > 0 ? 'kd-badge-danger' : 'kd-badge-muted';
        const more = q.count > 5 ? `<div class="kd-queue-more kd-text-sm kd-text-muted">+ ${q.count - 5} mục nữa</div>` : '';
        const body = q.count > 0 ? rows + more
            : '<div class="kd-text-sm kd-text-muted" style="padding:8px 0;">Không có mục cần xử lý ✓</div>';
        return html`
        <div class="kd-card kd-mb-2">
            <div class="kd-flex kd-items-center kd-justify-between">
                <h4 class="kd-font-bold">${escapeHtml(q.label)}</h4>
                <span class="kd-badge ${badgeClass}">${q.count}</span>
            </div>
            <div class="kd-queue-list kd-mt-2">${body}</div>
        </div>`;
    }).join('');
}

async function renderMix(mix) {
    const el = document.getElementById('kd-ov-mix');
    if (!el) return;
    if (!mix.length) {
        el.closest('.kd-chart-wrap').innerHTML = '<div class="kd-text-sm kd-text-muted" style="padding:20px;text-align:center;">Chưa có dữ liệu nhóm hàng trong kỳ.</div>';
        return;
    }
    const Chart = await loadChartLib();
    charts.destroy();
    const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b', '#94a3b8'];
    charts.add(new Chart(el, {
        type: 'doughnut',
        data: {
            labels: mix.map((m) => m.item_group || '(trống)'),
            datasets: [{ data: mix.map((m) => m.amount || 0), backgroundColor: palette.slice(0, mix.length), borderWidth: 0 }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: { label: (c) => `${c.label}: ${formatVNDShort(c.parsed)}` } },
            },
        },
    }));
}

// ═══════════════════════════════════════════════════════════════════════
// KINH DOANH CHUNG — báo cáo quản trị theo năm tài chính (port từ Grafana)
// Bán ra / Trả về (is_return) / Thực bán / Tỷ lệ trả; theo tháng, theo kênh,
// ngành hàng, top khách, top sản phẩm. Đơn vị hiển thị: TRIỆU đồng.
// ═══════════════════════════════════════════════════════════════════════

let _bcSeq = 0;   // sequence token — response về trễ (đổi filter nhanh) bị bỏ, không đè bản mới

async function loadBusinessReport() {
    const body = document.getElementById('kd-bc-body');
    if (!body) return;
    const seq = ++_bcSeq;
    const fySel = document.getElementById('kd-bc-fy');
    const chSel = document.getElementById('kd-bc-channel');
    bcCharts.destroy();   // destroy TRƯỚC khi skeleton detach canvas — tránh leak cả nhánh lỗi
    body.innerHTML = '<div class="kd-skeleton" style="height:320px;"></div>';
    try {
        const d = await api.getBusinessReport(fySel.value || null, chSel.value || null);
        if (seq !== _bcSeq) return;   // đã có request mới hơn → bỏ response cũ
        // Đổ options năm TC (1 lần, giữ lựa chọn)
        if (!fySel.options.length) {
            fySel.innerHTML = (d.fiscal_years || []).map((y) =>
                `<option value="${escapeHtml(y)}"${y === d.fiscal_year ? ' selected' : ''}>${escapeHtml(y)}</option>`).join('');
        }
        renderBusinessReport(body, d);
        await renderBusinessCharts(d);
    } catch (err) {
        if (seq !== _bcSeq) return;
        body.innerHTML = `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div>
            <div class="kd-empty-title">Không tải được báo cáo</div>
            <div class="kd-text-sm">${escapeHtml(err.message)}</div></div>`;
    }
}

function bcRate(v) { return v == null ? '—' : v.toFixed(2) + '%'; }

function renderBusinessReport(body, d) {
    const t = d.totals || {};
    const filtered = d.channel ? ` · kênh ${escapeHtml(document.querySelector(`#kd-bc-channel option[value="${d.channel}"]`)?.textContent || d.channel)}` : '';

    const monthTiles = (key, cls0) => (d.months || []).map((m) => {
        const v = m[key] || 0;
        const cls = v ? cls0 : 'muted';
        return `<div class="kd-month-tile ${cls}" title="${formatVNDShort(v)}">
            <div class="kd-month-label">${escapeHtml(m.label)}</div>
            <div class="kd-month-value">${trieu(v)}</div></div>`;
    }).join('');

    const miniPanels = (d.channels || []).map((c) => `
        <div class="kd-mini-panel">
            <div class="kd-mini-head" style="background:${CH_COLORS[c.key] || '#64748b'};">${escapeHtml(c.label)}</div>
            <div class="kd-mini-row"><span>Bán ra</span><span>${trieu(c.gross)}</span></div>
            <div class="kd-mini-row"><span>Trả về</span><span style="color:var(--kd-danger);">${trieu(c.returns)}</span></div>
            <div class="kd-mini-row"><span>Thực bán</span><span>${trieu(c.net)}</span></div>
            <div class="kd-mini-row"><span>Tỷ lệ trả</span><span style="color:${(c.return_rate_pct || 0) >= 10 ? 'var(--kd-danger)' : 'var(--kd-warning)'};">${bcRate(c.return_rate_pct)}</span></div>
        </div>`).join('');

    body.innerHTML = html`
        <div class="kd-text-sm kd-text-muted kd-mb-2">Năm tài chính ${escapeHtml(d.fiscal_year)} (${formatDate(d.period.start)} → ${formatDate(d.period.end)})${filtered} · đơn vị: triệu đồng · trả về = hoá đơn is_return</div>

        <div class="kd-stat-grid">
            <div class="kd-stat-tile kd-stat-success"><div class="kd-stat-label">Doanh số bán ra</div>
                <div class="kd-stat-value" title="${formatVNDShort(t.gross)}">${trieu(t.gross)}</div>
                <div class="kd-stat-sub">triệu đ · cả năm TC</div></div>
            <div class="kd-stat-tile kd-stat-danger"><div class="kd-stat-label">Doanh số trả về</div>
                <div class="kd-stat-value" title="${formatVNDShort(t.returns)}">${trieu(t.returns)}</div>
                <div class="kd-stat-sub">triệu đ</div></div>
            <div class="kd-stat-tile kd-stat-success"><div class="kd-stat-label">Doanh số thực bán</div>
                <div class="kd-stat-value" title="${formatVNDShort(t.net)}">${trieu(t.net)}</div>
                <div class="kd-stat-sub">triệu đ = bán ra − trả về</div></div>
            <div class="kd-stat-tile kd-stat-warning"><div class="kd-stat-label">Tỷ lệ trả (%)</div>
                <div class="kd-stat-value">${bcRate(t.return_rate_pct)}</div>
                <div class="kd-stat-sub">|trả về| ÷ bán ra</div></div>
        </div>

        <div class="kd-card kd-mt-2"><h4 class="kd-font-bold kd-text-sm kd-mb-2">Doanh số bán ra theo tháng</h4>
            <div class="kd-month-grid">${monthTiles('gross', 'success')}</div></div>
        <div class="kd-card kd-mt-2"><h4 class="kd-font-bold kd-text-sm kd-mb-2">Doanh số trả về theo tháng</h4>
            <div class="kd-month-grid">${monthTiles('returns', 'danger')}</div></div>

        <div class="kd-card kd-mt-2"><h3 class="kd-font-bold">Bán ra & trả về theo tháng (triệu đ)</h3>
            <div class="kd-chart-wrap"><canvas id="kd-bc-inout"></canvas></div></div>

        <div class="kd-grid-2 kd-mt-2">
            <div class="kd-card"><h3 class="kd-font-bold">Tỷ trọng theo ngành hàng (thực bán)</h3>
                <div class="kd-chart-wrap"><canvas id="kd-bc-nganh"></canvas></div>
                <div class="kd-text-sm kd-mt-2">${(d.nganh_hang || []).map((n) =>
                    `<div class="kd-flex kd-justify-between" style="padding:3px 0;"><span>${escapeHtml(n.label)}</span><b>${formatVNDShort(n.net)}</b></div>`).join('')}</div>
            </div>
            <div class="kd-card"><h3 class="kd-font-bold">Tỷ trọng các kênh (thực bán, cả năm)</h3>
                <div class="kd-chart-wrap"><canvas id="kd-bc-kenh"></canvas></div>
                <div class="kd-text-sm kd-mt-2">${(d.channels || []).map((c) =>
                    `<div class="kd-flex kd-justify-between" style="padding:3px 0;"><span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${CH_COLORS[c.key]};margin-right:6px;"></span>${escapeHtml(c.label)}</span><b>${formatVNDShort(c.net)}</b></div>`).join('')}</div>
            </div>
        </div>

        <h4 class="kd-font-bold kd-text-sm kd-mt-2 kd-mb-2">Kết quả theo kênh (triệu đ · luôn đủ 4 kênh, không theo bộ lọc)</h4>
        <div class="kd-mini-grid">${miniPanels}</div>

        <div class="kd-grid-2 kd-mt-2">
            <div class="kd-card"><h3 class="kd-font-bold">Bán ra các kênh theo tháng</h3>
                <div class="kd-chart-wrap"><canvas id="kd-bc-ch-gross"></canvas></div></div>
            <div class="kd-card"><h3 class="kd-font-bold">Trả về các kênh theo tháng</h3>
                <div class="kd-chart-wrap"><canvas id="kd-bc-ch-returns"></canvas></div></div>
        </div>

        <div class="kd-grid-2 kd-mt-2">
            <div class="kd-card"><h3 class="kd-font-bold">Top khách hàng (thực bán)</h3>
                <div class="kd-chart-wrap"><canvas id="kd-bc-topkh"></canvas></div></div>
            <div class="kd-card"><h3 class="kd-font-bold kd-mb-2">Chi tiết top 20 khách</h3>
                ${pagedTable({
                    columns: [
                        { key: 'customer_name', label: 'Khách', render: (r) => `<a href="#${escapeHtml(r.route || '')}" class="kd-link">${escapeHtml(r.customer_name)}</a>` },
                        { key: 'net', label: 'Thực bán', render: (r) => formatVNDShort(r.net) },
                        { key: 'share_pct', label: '%', render: (r) => r.share_pct != null ? r.share_pct.toFixed(1) + '%' : '—' },
                    ], rows: d.top_customers || [],
                })}</div>
        </div>

        <div class="kd-grid-2 kd-mt-2">
            <div class="kd-card"><h3 class="kd-font-bold">Tỷ trọng doanh số theo sản phẩm TOP 10</h3>
                <div class="kd-chart-wrap"><canvas id="kd-bc-topsp"></canvas></div>
                <div class="kd-text-sm kd-mt-2">${(d.top_products_revenue || []).map((p, i) =>
                    `<div class="kd-flex kd-justify-between" style="padding:2px 0;"><span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${TOP10[i]};margin-right:6px;"></span>${escapeHtml(p.item_code)}</span><b>${formatVNDShort(p.net)}</b></div>`).join('')}</div>
            </div>
            <div>
                <div class="kd-card"><h3 class="kd-font-bold">10 SP bán số lượng nhiều nhất</h3>
                    <div class="kd-chart-wrap"><canvas id="kd-bc-spqty"></canvas></div></div>
                <div class="kd-card kd-mt-2"><h3 class="kd-font-bold">10 SP đóng góp doanh thu lớn nhất (triệu đ)</h3>
                    <div class="kd-chart-wrap"><canvas id="kd-bc-sprev"></canvas></div></div>
            </div>
        </div>
    `;
}

async function renderBusinessCharts(d) {
    const Chart = await loadChartLib();
    bcCharts.destroy();
    const M = (v) => Math.round((v || 0) / 1e6);
    const labels = (d.months || []).map((m) => m.label);
    const money = (ctx) => `${ctx.dataset.label}: ${formatVNDShort(ctx.parsed.y * 1e6)}`;
    const commonBar = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }, tooltip: { callbacks: { label: money } } },
        scales: { y: { ticks: { callback: (v) => formatNumber(v) } } },
    };

    // 1) Bán ra (dương) & trả về (âm) theo tháng — 1 trục y chung.
    const el1 = document.getElementById('kd-bc-inout');
    if (el1) bcCharts.add(new Chart(el1, {
        type: 'bar',
        data: { labels, datasets: [
            { label: 'Bán ra', data: (d.months || []).map((m) => M(m.gross)), backgroundColor: '#10b981', borderRadius: 4 },
            { label: 'Trả về', data: (d.months || []).map((m) => M(m.returns)), backgroundColor: '#ef4444', borderRadius: 4 },
        ] },
        options: commonBar,
    }));

    // 2) Donut ngành hàng (2 lát; giá trị âm hiển thị |v|, bảng cạnh giữ dấu).
    const el2 = document.getElementById('kd-bc-nganh');
    if (el2) bcCharts.add(new Chart(el2, {
        type: 'doughnut',
        data: { labels: (d.nganh_hang || []).map((n) => n.label),
            datasets: [{ data: (d.nganh_hang || []).map((n) => Math.abs(n.net || 0)), backgroundColor: ['#f59e0b', '#10b981'], borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: { label: (c) => { const n = (d.nganh_hang || [])[c.dataIndex]; return `${c.label}: ${formatVNDShort(n ? n.net : c.parsed)}`; } } } } },
    }));

    // 3) Donut tỷ trọng kênh (net) — màu theo thực thể kênh.
    const el3 = document.getElementById('kd-bc-kenh');
    if (el3) bcCharts.add(new Chart(el3, {
        type: 'doughnut',
        data: { labels: (d.channels || []).map((c) => c.label),
            datasets: [{ data: (d.channels || []).map((c) => Math.max(0, c.net || 0)),
                backgroundColor: (d.channels || []).map((c) => CH_COLORS[c.key] || '#64748b'), borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: { label: (c) => `${c.label}: ${formatVNDShort(c.parsed)}` } } } },
    }));

    // 4+5) Grouped bar bán ra / trả về các kênh theo tháng — cùng map màu kênh.
    const cm = d.channel_months || {};
    const chDatasets = (src) => (d.channels || []).map((c) => ({
        label: c.label,
        data: ((src || {})[c.key] || []).map(M),
        backgroundColor: CH_COLORS[c.key] || '#64748b',
        borderRadius: 3,
    }));
    const el4 = document.getElementById('kd-bc-ch-gross');
    if (el4) bcCharts.add(new Chart(el4, { type: 'bar', data: { labels: cm.labels || labels, datasets: chDatasets(cm.gross) }, options: commonBar }));
    const el5 = document.getElementById('kd-bc-ch-returns');
    if (el5) bcCharts.add(new Chart(el5, { type: 'bar', data: { labels: cm.labels || labels, datasets: chDatasets(cm.returns) }, options: commonBar }));

    // 6) Donut top 10 khách (bảng 20 khách bên cạnh là secondary encoding).
    const kh = (d.top_customers || []).slice(0, 10);
    const el6 = document.getElementById('kd-bc-topkh');
    if (el6) bcCharts.add(new Chart(el6, {
        type: 'doughnut',
        data: { labels: kh.map((r) => r.customer_name),
            datasets: [{ data: kh.map((r) => Math.max(0, r.net || 0)), backgroundColor: TOP10, borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
                tooltip: { callbacks: { label: (c) => `${c.label}: ${formatVNDShort(c.parsed)}` } } } },
    }));

    // 7) Donut top 10 sản phẩm theo doanh thu.
    const sp = d.top_products_revenue || [];
    const el7 = document.getElementById('kd-bc-topsp');
    if (el7) bcCharts.add(new Chart(el7, {
        type: 'doughnut',
        data: { labels: sp.map((r) => r.item_code),
            datasets: [{ data: sp.map((r) => Math.max(0, r.net || 0)), backgroundColor: TOP10, borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
                tooltip: { callbacks: { label: (c) => `${sp[c.dataIndex]?.item_name || c.label}: ${formatVNDShort(c.parsed)}` } } } },
    }));

    // 8+9) Bar ngang top SP: số lượng + doanh thu (1 series → không cần legend).
    const hbar = (fmt) => ({
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: fmt } } },
        scales: { x: { ticks: { callback: (v) => formatNumber(v) } } },
    });
    const q = d.top_products_qty || [];
    const el8 = document.getElementById('kd-bc-spqty');
    if (el8) bcCharts.add(new Chart(el8, {
        type: 'bar',
        data: { labels: q.map((r) => r.item_code), datasets: [{ data: q.map((r) => r.qty || 0), backgroundColor: '#10b981', borderRadius: 4 }] },
        options: hbar((c) => `${q[c.dataIndex]?.item_name || ''}: ${formatNumber(c.parsed.x)}`),
    }));
    const el9 = document.getElementById('kd-bc-sprev');
    if (el9) bcCharts.add(new Chart(el9, {
        type: 'bar',
        data: { labels: sp.map((r) => r.item_name), datasets: [{ data: sp.map((r) => M(r.net)), backgroundColor: '#10b981', borderRadius: 4 }] },
        options: hbar((c) => formatVNDShort(c.parsed.x * 1e6)),
    }));
}
