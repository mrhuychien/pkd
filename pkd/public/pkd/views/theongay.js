// Tab "Theo ngày" — DOANH SỐ THEO NGÀY trong 1 tháng (tách từ Tổng quan).
// Nguồn: pkd.api.daily.get_daily_sales(nam, thang, channel). Bộ lọc tháng + kênh đồng
// bộ lên URL (#/theongay?m=2026-11&k=npp) để chia sẻ link; bấm 1 ngày → lọc bảng khách.

import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { pagedTable } from '../components/data-table.js';
import { loadChartLib, chartRegistry, CH_COLORS } from '../components/chart.js';

const ddCharts = chartRegistry();
const DD_CHANNELS = ['', 'npp', 'mt', 'dulich', 'showroom', 'khac'];

// ▲/▼ semantic; .kd-delta trên stat tile màu → kế thừa màu chữ tile (CSS).
function pctBadge(v) {
    if (v === null || v === undefined) return '<span class="kd-text-muted">—</span>';
    const up = v >= 0;
    return `<span class="kd-delta" style="color:${up ? 'var(--kd-success)' : 'var(--kd-danger)'};font-weight:800;">${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
}

export async function render({ container, query }) {
    const q = query || {};
    const k = DD_CHANNELS.includes(q.k) ? q.k : '';
    _dd.day = null;
    _dd.q = '';
    container.innerHTML = html`
        ${banner({ title: 'Doanh số theo ngày', subtitle: 'Bán ra · trả về · thực bán từng ngày — theo kênh & khách hàng' })}
        <div class="kd-flex kd-items-center kd-justify-between" style="flex-wrap:wrap;gap:8px;">
            <h3 class="kd-font-bold">📅 Doanh số theo ngày trong tháng</h3>
            <div class="kd-filter-bar">
                <label>Tháng <select id="kd-dd-month">${ddMonthOptions(q.m)}</select></label>
                <label>Kênh <select id="kd-dd-channel">
                    ${[['', 'Tất cả'], ['npp', 'NPP'], ['mt', 'MT'], ['dulich', 'Du lịch'], ['showroom', 'Showroom'], ['khac', 'Khác']]
                        .map(([v, l]) => `<option value="${v}"${v === k ? ' selected' : ''}>${l}</option>`).join('')}
                </select></label>
            </div>
        </div>
        <div id="kd-dd-body" class="kd-mt-2"><div class="kd-skeleton" style="height:320px;"></div></div>
    `;
    document.getElementById('kd-dd-month').addEventListener('change', () => loadDaily(true));
    document.getElementById('kd-dd-channel').addEventListener('change', () => loadDaily(false));
    bindDailyEvents(document.getElementById('kd-dd-body'));
    await loadDaily(true);
}

const CH_LABEL = { npp: 'NPP', mt: 'MT', dulich: 'Du lịch', showroom: 'Showroom', khac: 'Khác' };
const _dd = { data: null, day: null, q: '' };   // day = 'YYYY-MM-DD' đang chọn (lọc bảng khách)
let _ddSeq = 0;

// 18 tháng gần nhất, mặc định tháng hiện tại (value "YYYY-M").
function ddMonthOptions(selected) {
    const now = new Date();
    const vals = [];
    for (let i = 0; i < 18; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        vals.push([`${d.getFullYear()}-${d.getMonth() + 1}`, d.getMonth() + 1, d.getFullYear()]);
    }
    const sel = vals.some(([v]) => v === selected) ? selected : vals[0][0];
    return vals.map(([v, m, y]) => `<option value="${v}"${v === sel ? ' selected' : ''}>Tháng ${m}/${y}</option>`).join('');
}

const ddDate = (iso) => { const [, m, d] = String(iso).split('-'); return `${d}/${m}`; };
const ddDot = (k) => `<span class="kd-dd-dot" style="background:${CH_COLORS[k] || '#64748b'};"></span>`;
// Tìm kiếm không dấu: "pho" khớp "Phố", "dong" khớp "Đông".
const ddNorm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();

async function loadDaily(resetDay) {
    const body = document.getElementById('kd-dd-body');
    if (!body) return;
    const seq = ++_ddSeq;
    const [y, m] = (document.getElementById('kd-dd-month')?.value || '').split('-').map(Number);
    const ch = document.getElementById('kd-dd-channel')?.value || null;
    if (location.hash.startsWith('#/theongay')) {
        const qs = new URLSearchParams();
        if (y && m) qs.set('m', `${y}-${m}`);
        if (ch) qs.set('k', ch);
        history.replaceState(null, '', `#/theongay${qs.toString() ? '?' + qs : ''}`);
    }
    ddCharts.destroy();   // destroy TRƯỚC khi skeleton detach canvas
    body.innerHTML = '<div class="kd-skeleton" style="height:320px;"></div>';
    try {
        const d = await api.getDailySales(y || null, m || null, ch);
        if (seq !== _ddSeq) return;   // response cũ (đổi bộ lọc nhanh) → bỏ
        _dd.data = d;
        if (resetDay || !(d.days || []).some((x) => x.date === _dd.day && !x.future)) _dd.day = null;
        renderDaily(body, d);
        await renderDailyCharts(d);
    } catch (err) {
        if (seq !== _ddSeq) return;
        body.innerHTML = `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div>
            <div class="kd-empty-title">Không tải được doanh số theo ngày</div>
            <div class="kd-text-sm">${escapeHtml(err.message)}</div></div>`;
    }
}

// Bind 1 lần lên #kd-dd-body (node sống suốt view): bấm ngày → lọc khách; tìm khách.
function bindDailyEvents(body) {
    if (!body) return;
    body.addEventListener('click', (e) => {
        const dayBtn = e.target.closest('[data-dd-day]');
        if (dayBtn) {
            const day = dayBtn.getAttribute('data-dd-day');
            _dd.day = _dd.day === day ? null : day;   // bấm lại = bỏ chọn
            markSelectedDay();
            renderCustTable();
            if (_dd.day) document.getElementById('kd-dd-cust')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        if (e.target.closest('[data-dd-clear]')) {
            _dd.day = null;
            markSelectedDay();
            renderCustTable();
        }
    });
    body.addEventListener('input', (e) => {
        if (e.target.id !== 'kd-dd-q') return;
        _dd.q = e.target.value;
        renderCustTable();
    });
}

// Tô dòng ngày đang chọn tại chỗ (không vẽ lại bảng → giữ nguyên trang đang xem).
function markSelectedDay() {
    document.querySelectorAll('#kd-dd-days [data-dd-day]').forEach((b) => {
        const on = b.getAttribute('data-dd-day') === _dd.day;
        b.classList.toggle('kd-active', on);
        const tr = b.closest('tr');
        if (tr) tr.style.background = on ? 'rgba(59,130,246,.10)' : '';
    });
}

function renderDaily(body, d) {
    const t = d.totals || {};
    const p = d.period || {};
    const filtered = d.channel ? ` · kênh <b>${escapeHtml(CH_LABEL[d.channel] || d.channel)}</b>` : '';
    const nCmp = p.cmp_days != null ? p.cmp_days : (p.days_passed || 0);   // số ngày backend thật sự so
    const cmpNote = p.days_passed ? `vs ${escapeHtml(p.prev_label)} (cùng ${nCmp} ngày đầu)` : '';
    const best = t.best_day;

    if (!p.days_passed) {
        body.innerHTML = `<div class="kd-empty"><div class="kd-empty-icon">🗓️</div>
            <div class="kd-empty-title">Tháng ${p.thang}/${p.nam} chưa bắt đầu</div></div>`;
        return;
    }

    body.innerHTML = html`
        <div class="kd-text-sm kd-text-muted kd-mb-2">
            Tháng <b>${p.thang}/${p.nam}</b> · ${p.is_current ? `đã qua ${p.days_passed}/${p.days_total} ngày` : `đủ ${p.days_total} ngày`}${filtered} ·
            doanh số <b>chưa VAT</b>, toàn bộ hoá đơn (trừ opening) · trả về = hoá đơn trả hàng · so cùng kỳ tháng trước cùng số ngày
        </div>

        <div class="kd-stat-grid">
            <div class="kd-stat-tile kd-stat-success"><div class="kd-stat-label">Bán ra tháng</div>
                <div class="kd-stat-value" style="font-size:1.6rem;">${formatVNDShort(t.gross || 0)}</div>
                <div class="kd-stat-sub">${pctBadge(t.gross_growth_pct)} ${cmpNote}</div></div>
            <div class="kd-stat-tile kd-stat-danger"><div class="kd-stat-label">Trả về</div>
                <div class="kd-stat-value" style="font-size:1.6rem;">${formatVNDShort(t.returns || 0)}</div>
                <div class="kd-stat-sub">tỷ lệ trả ${t.return_rate_pct != null ? t.return_rate_pct.toFixed(2) + '%' : '—'} · ${formatNumber(t.ret_invoices || 0)} HĐ trả</div></div>
            <div class="kd-stat-tile kd-stat-success"><div class="kd-stat-label">Thực bán</div>
                <div class="kd-stat-value" style="font-size:1.6rem;">${formatVNDShort(t.net || 0)}</div>
                <div class="kd-stat-sub">${pctBadge(t.net_growth_pct)} ${cmpNote}</div></div>
            <div class="kd-stat-tile kd-stat-warning"><div class="kd-stat-label">Bán ra TB / ngày</div>
                <div class="kd-stat-value" style="font-size:1.6rem;">${t.avg_per_day != null ? formatVNDShort(t.avg_per_day) : '—'}</div>
                <div class="kd-stat-sub">${t.run_rate != null ? `ước cả tháng ${formatVNDShort(t.run_rate)}` : `${formatNumber(t.selling_days || 0)} ngày có bán`}</div></div>
        </div>
        <div class="kd-text-sm kd-mt-2">
            ${best ? `🏆 Ngày bán cao nhất: <b>${ddDate(best.date)} (${escapeHtml(best.dow)})</b> — ${formatVNDShort(best.gross)} · ` : ''}
            ${formatNumber(t.invoices || 0)} hoá đơn bán · ${formatNumber(t.buyers || 0)} khách mua · ${formatNumber(t.selling_days || 0)} ngày có bán
        </div>

        <div class="kd-card kd-mt-2"><h3 class="kd-font-bold">Bán ra theo ngày — phân tách kênh</h3>
            <div class="kd-chart-wrap"><canvas id="kd-dd-stack"></canvas></div>
            <div class="kd-text-sm kd-text-muted kd-mt-2">Biểu đồ &amp; bảng kênh luôn đủ mọi kênh (không theo bộ lọc) để so sánh tỷ trọng.</div>
            <div class="kd-mt-2">${pagedTable({
                columns: [
                    { key: 'label', label: 'Kênh', render: (c) => `<span>${ddDot(c.key)}${escapeHtml(c.label)}</span>` },
                    { key: 'gross', label: 'Bán ra', render: (c) => formatVNDShort(c.gross) },
                    { key: 'returns', label: 'Trả về', render: (c) => c.returns ? `<span style="color:var(--kd-danger);">${formatVNDShort(c.returns)}</span>` : '—' },
                    { key: 'net', label: 'Thực bán', render: (c) => `<b>${formatVNDShort(c.net)}</b>` },
                    { key: 'share_pct', label: 'Tỷ trọng', render: (c) => c.share_pct != null ? c.share_pct.toFixed(1) + '%' : '—' },
                ],
                rows: d.channel_totals || [],
            })}</div>
        </div>

        <div class="kd-card kd-mt-2"><h3 class="kd-font-bold">Luỹ kế thực bán — tháng này vs ${escapeHtml(p.prev_label)}</h3>
            <div class="kd-chart-wrap"><canvas id="kd-dd-cum"></canvas></div></div>

        <div class="kd-card kd-mt-2">
            <h3 class="kd-font-bold">Chi tiết theo ngày</h3>
            <div class="kd-text-sm kd-text-muted kd-mb-2">Bấm vào một ngày để xem khách hàng mua trong ngày đó (bấm lại để bỏ chọn).</div>
            <div id="kd-dd-days"></div>
        </div>

        <div class="kd-card kd-mt-2" id="kd-dd-cust">
            <div class="kd-flex kd-items-center kd-justify-between" style="flex-wrap:wrap;gap:8px;">
                <h3 class="kd-font-bold" id="kd-dd-cust-title">Khách hàng</h3>
                <input id="kd-dd-q" class="kd-dd-search" type="search" placeholder="Tìm khách (không cần dấu)…" value="${escapeHtml(_dd.q)}">
            </div>
            <div id="kd-dd-cust-sum" class="kd-text-sm kd-text-muted kd-mt-2"></div>
            <div id="kd-dd-cust-table" class="kd-mt-2"></div>
        </div>
    `;
    renderDayTable();
    renderCustTable();
}

function renderDayTable() {
    const root = document.getElementById('kd-dd-days');
    const d = _dd.data;
    if (!root || !d) return;
    const rows = (d.days || []).filter((x) => !x.future).slice().reverse();   // mới nhất lên đầu
    const showCh = !d.channel;
    const columns = [
        { key: 'date', label: 'Ngày', render: (r) =>
            `<button type="button" class="kd-dd-daybtn${r.dow === 'CN' ? ' kd-sun' : ''}${r.date === _dd.day ? ' kd-active' : ''}" data-dd-day="${escapeHtml(r.date)}">${ddDate(r.date)} · ${escapeHtml(r.dow)}</button>` },
        { key: 'gross', label: 'Bán ra', render: (r) => r.gross ? formatVNDShort(r.gross) : '<span class="kd-text-muted">—</span>' },
        { key: 'returns', label: 'Trả về', render: (r) => r.returns ? `<span style="color:var(--kd-danger);">${formatVNDShort(r.returns)}</span>` : '<span class="kd-text-muted">—</span>' },
        { key: 'net', label: 'Thực bán', render: (r) => (r.gross || r.returns) ? `<b>${formatVNDShort(r.net)}</b>` : '<span class="kd-text-muted">—</span>' },
        { key: 'invoices', label: 'HĐ', render: (r) => `<span>${formatNumber(r.invoices)}${r.ret_invoices ? ` <span class="kd-text-muted">· ${formatNumber(r.ret_invoices)} trả</span>` : ''}</span>` },
        { key: 'buyers', label: 'Khách', render: (r) => formatNumber(r.buyers) },
    ];
    if (showCh) {
        columns.push({ key: 'channels', label: 'Theo kênh', render: (r) => {
            const parts = Object.entries(r.channels || {}).sort((a, b) => b[1] - a[1]);
            if (!parts.length) return '<span class="kd-text-muted">—</span>';
            return `<span class="kd-dd-chips">${parts.map(([k, v]) =>
                `<span class="kd-dd-chip">${ddDot(k)}${escapeHtml(CH_LABEL[k] || k)} ${formatVNDShort(v)}</span>`).join('')}</span>`;
        } });
    }
    root.innerHTML = pagedTable({
        columns, rows,
        rowStyle: (r) => (r.date === _dd.day ? 'background:rgba(59,130,246,.10);' : ''),
        emptyMessage: 'Chưa có ngày nào trong kỳ',
    });
}

function renderCustTable() {
    const root = document.getElementById('kd-dd-cust-table');
    const d = _dd.data;
    if (!root || !d) return;
    const q = ddNorm(_dd.q).trim();
    const agg = new Map();
    for (const r of d.customers || []) {
        if (_dd.day && r.date !== _dd.day) continue;
        let a = agg.get(r.customer);
        if (!a) {
            a = { customer: r.customer, customer_name: r.customer_name, route: r.route, channel: r.channel,
                gross: 0, returns: 0, invoices: 0, ret_invoices: 0, days: new Set() };
            agg.set(r.customer, a);
        }
        a.gross += r.gross || 0;
        a.returns += r.returns || 0;
        a.invoices += r.invoices || 0;
        a.ret_invoices += r.ret_invoices || 0;
        if (r.invoices) a.days.add(r.date);
        a.channel = r.channel;
    }
    let rows = [...agg.values()].map((a) => ({ ...a, net: a.gross + a.returns, n_days: a.days.size }));
    if (q) rows = rows.filter((a) => ddNorm(a.customer_name).includes(q) || ddNorm(a.customer).includes(q));
    rows.sort((x, y) => y.net - x.net);

    const title = document.getElementById('kd-dd-cust-title');
    if (title) {
        title.innerHTML = _dd.day
            ? `Khách hàng ngày ${ddDate(_dd.day)} <button type="button" class="kd-btn-sm" data-dd-clear>× Xem cả tháng</button>`
            : 'Khách hàng — cả tháng';
    }
    const sum = document.getElementById('kd-dd-cust-sum');
    if (sum) {
        const g = rows.reduce((s, a) => s + a.gross, 0), n = rows.reduce((s, a) => s + a.net, 0);
        sum.innerHTML = `${formatNumber(rows.length)} khách · bán ra <b>${formatVNDShort(g)}</b> · thực bán <b>${formatVNDShort(n)}</b>${q ? ' · đang lọc theo tìm kiếm' : ''}`;
    }
    const columns = [
        { key: 'customer_name', label: 'Khách', render: (a) =>
            `<a href="#${escapeHtml(a.route)}" class="kd-link">${escapeHtml(a.customer_name)}</a>` },
        { key: 'channel', label: 'Kênh', render: (a) => `<span>${ddDot(a.channel)}${escapeHtml(CH_LABEL[a.channel] || a.channel)}</span>` },
        { key: 'gross', label: 'Bán ra', render: (a) => a.gross ? formatVNDShort(a.gross) : '—' },
        { key: 'returns', label: 'Trả về', render: (a) => a.returns ? `<span style="color:var(--kd-danger);">${formatVNDShort(a.returns)}</span>` : '—' },
        { key: 'net', label: 'Thực bán', render: (a) => `<b>${formatVNDShort(a.net)}</b>` },
        { key: 'invoices', label: 'HĐ', render: (a) => `<span>${formatNumber(a.invoices)}${a.ret_invoices ? ` <span class="kd-text-muted">· ${formatNumber(a.ret_invoices)} trả</span>` : ''}</span>` },
    ];
    if (!_dd.day) columns.push({ key: 'n_days', label: 'Số ngày mua', render: (a) => formatNumber(a.n_days) });
    root.innerHTML = pagedTable({
        columns, rows,
        emptyMessage: q ? 'Không có khách khớp tìm kiếm' : (_dd.day ? 'Ngày này không có hoá đơn' : 'Chưa có khách mua trong tháng'),
    });
}

async function renderDailyCharts(d) {
    const Chart = await loadChartLib();
    if (!document.getElementById('kd-dd-stack')) return;   // đã re-render/điều hướng
    ddCharts.destroy();
    const days = d.days || [];
    const labels = days.map((x) => `${x.day}`);
    const cd = d.channel_days || {};
    const money = (v) => formatVNDShort(v);

    // 1) Cột chồng bán ra theo ngày × kênh (chỉ kênh có số; ngày tương lai = null).
    const datasets = (cd.keys || [])
        .filter((k) => (cd.gross?.[k] || []).some((v) => v))
        .map((k) => ({
            label: (cd.labels || {})[k] || CH_LABEL[k] || k,
            data: (cd.gross[k] || []).map((v, i) => (days[i]?.future ? null : v)),
            backgroundColor: CH_COLORS[k] || '#64748b',
            borderRadius: 3, stack: 'g',
        }));
    const el1 = document.getElementById('kd-dd-stack');
    if (el1) ddCharts.add(new Chart(el1, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    filter: (it) => !!it.parsed.y,
                    callbacks: {
                        title: (items) => { const x = days[items[0]?.dataIndex]; return x ? `${ddDate(x.date)} (${x.dow})` : ''; },
                        label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}`,
                        footer: (items) => `Tổng bán ra: ${money(items.reduce((s, it) => s + (it.parsed.y || 0), 0))}`,
                    },
                },
            },
            scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => money(v) } } },
        },
    }));

    // 2) Luỹ kế thực bán tháng này vs tháng trước (cùng ngày-trong-tháng).
    const cum = d.cum || {};
    const prev = labels.map((_, i) => (cum.prev && i < cum.prev.length ? cum.prev[i] : null));
    const el2 = document.getElementById('kd-dd-cum');
    if (el2) ddCharts.add(new Chart(el2, {
        type: 'line',
        data: { labels, datasets: [
            { label: `Tháng ${d.period.thang}/${d.period.nam}`, data: cum.cur || [], borderColor: '#3b82f6',
              backgroundColor: 'rgba(59,130,246,.08)', fill: true, tension: 0.25, pointRadius: 2, spanGaps: false },
            { label: `${d.period.prev_label} (cùng ngày)`, data: prev, borderColor: '#94a3b8',
              backgroundColor: 'transparent', borderDash: [6, 4], tension: 0.25, pointRadius: 0 },
        ] },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: {
                    title: (items) => `Ngày ${items[0]?.label}`,
                    label: (c) => `${c.dataset.label}: ${c.parsed.y == null ? '—' : money(c.parsed.y)}`,
                } },
            },
            scales: { y: { ticks: { callback: (v) => money(v) } } },
        },
    }));
}
