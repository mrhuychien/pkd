import { html } from '../lib/dom.js';
import { formatCurrency, formatNumber, formatVNDShort, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { qlNav, channelOf, CHANNEL_LABEL, CHANNEL_NOUN } from '../components/ql-nav.js';
import { loadChartLib, chartRegistry } from '../components/chart.js';

// ─── Phân tích SẢN PHẨM theo kênh (port từ npp quan-ly-sanpham, KHÔNG margin) ─
const charts = chartRegistry();
let _k = 'npp', _groups = [], _months = 3, _top = [], _movers = {}, _upMode = 'abs';
const _skuSort = { key: 'revenue', dir: -1 };

export async function render({ container, query }) {
    _k = channelOf(query);
    const noun = CHANNEL_NOUN[_k];
    container.innerHTML = html`
        ${banner({ title: 'Phân tích sản phẩm', subtitle: `Kênh ${CHANNEL_LABEL[_k]}` })}
        ${qlNav('sp', _k)}
        <div class="kd-flex kd-justify-between kd-items-center">
            <h3 class="kd-font-bold">Sản phẩm</h3>
            <select id="kd-sp-period" style="padding:8px 12px;border-radius:10px;border:1px solid var(--kd-border);background:var(--kd-surface);font-weight:600;color:var(--kd-text);">
                <option value="3" selected>3 tháng</option><option value="6">6 tháng</option><option value="12">12 tháng</option>
            </select>
        </div>
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Top 10 sản phẩm (doanh số)</h3>
            <div class="kd-chart-wrap"><canvas id="kd-sp-top"></canvas></div></div>
        <div class="kd-grid-2 kd-mt-3">
            <div class="kd-card">
                <div class="kd-flex kd-justify-between kd-items-center">
                    <h3 class="kd-font-bold">📈 Tăng mạnh (top 10)</h3>
                    <div class="kd-flex" style="gap:4px;">
                        <button type="button" class="kd-sp-upmode" data-mode="abs" style="padding:4px 10px;font-size:.75rem;border:1px solid var(--kd-border);border-radius:8px;background:var(--kd-season-grad);color:#fff;cursor:pointer;">Giá trị</button>
                        <button type="button" class="kd-sp-upmode" data-mode="pct" style="padding:4px 10px;font-size:.75rem;border:1px solid var(--kd-border);border-radius:8px;background:var(--kd-surface);color:var(--kd-text);cursor:pointer;">%</button>
                    </div>
                </div>
                <div id="kd-sp-up" class="kd-mt-2"></div>
            </div>
            <div class="kd-card"><h3 class="kd-font-bold">📉 Giảm mạnh (top 10 theo giá trị)</h3><div id="kd-sp-down" class="kd-mt-2"></div></div>
        </div>
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">🆕 Mã hàng mới phát sinh (kỳ trước chưa bán)</h3><div id="kd-sp-new" class="kd-mt-2"></div></div>
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Mã hàng chưa phủ hết ${noun} (cơ hội phân phối)</h3><div id="kd-sp-coverage" class="kd-mt-2"></div></div>
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Độ phủ nhóm hàng</h3><div id="kd-sp-groups" class="kd-mt-2"></div></div>
        <div class="kd-card kd-mt-3">
            <div class="kd-flex kd-justify-between kd-items-center">
                <h3 class="kd-font-bold">Bảng SKU đầy đủ</h3>
                <input id="kd-sp-skusearch" class="kd-dh-search" placeholder="Tìm SKU..." style="max-width:200px;">
            </div>
            <div id="kd-sp-skutable" class="kd-mt-2"></div>
        </div>
        <div class="kd-card kd-mt-3">
            <div class="kd-flex kd-justify-between kd-items-center">
                <h3 class="kd-font-bold">SKU bán chậm / chết</h3>
                <select id="kd-sp-slowdays" style="padding:8px 10px;border-radius:10px;border:1px solid var(--kd-border);background:var(--kd-surface);font-weight:600;color:var(--kd-text);">
                    <option value="60" selected>60 ngày</option><option value="90">90 ngày</option>
                </select>
            </div>
            <div id="kd-sp-slow" class="kd-mt-2"></div>
        </div>
        <div class="kd-card kd-mt-3"><h3 class="kd-font-bold">Chiều sâu danh mục (SKU/${noun})</h3><div id="kd-sp-depth" class="kd-mt-2"></div></div>
        <div class="kd-card kd-mt-3">
            <div class="kd-flex kd-justify-between kd-items-center">
                <h3 class="kd-font-bold">Cơ hội bán thêm (${noun} chưa mua nhóm)</h3>
                <select id="kd-sp-ws" style="padding:8px 10px;border-radius:10px;border:1px solid var(--kd-border);background:var(--kd-surface);font-weight:600;color:var(--kd-text);"></select>
            </div>
            <div id="kd-sp-ws-list" class="kd-mt-3"></div>
        </div>
    `;
    document.getElementById('kd-sp-period').addEventListener('change', (e) => loadData(parseInt(e.target.value, 10) || 3));
    document.getElementById('kd-sp-ws').addEventListener('change', loadWhiteSpace);
    document.getElementById('kd-sp-skusearch').addEventListener('input', renderSkuTable);
    document.getElementById('kd-sp-slowdays').addEventListener('change', loadSlow);
    document.querySelectorAll('.kd-sp-upmode').forEach((b) => b.addEventListener('click', () => {
        _upMode = b.dataset.mode;
        document.querySelectorAll('.kd-sp-upmode').forEach((x) => {
            const on = x === b;
            x.style.background = on ? 'var(--kd-season-grad)' : 'var(--kd-surface)';
            x.style.color = on ? '#fff' : 'var(--kd-text)';
        });
        renderMovers(_movers);
    }));
    await loadData(3);
}

async function loadData(months) {
    _months = months;
    try {
        const Chart = await loadChartLib();
        const d = await api.mgr.products(_k, months);
        _groups = d.groups || [];
        charts.destroy();
        renderTop(Chart, d.top || []);
        renderMovers(d.movers || {});
        renderCoverage(d.coverage || []);
        renderGroups(_groups);
        _top = d.top || [];
        renderSkuTable();
        loadSlow();
        loadDepth();
        const sel = document.getElementById('kd-sp-ws');
        sel.innerHTML = _groups.map((g) => `<option value="${escapeHtml(g.item_group)}">${escapeHtml(g.item_group)}</option>`).join('');
        loadWhiteSpace();
    } catch (err) {
        document.getElementById('kd-sp-groups').innerHTML =
            `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderTop(Chart, top) {
    const t = top.slice(0, 10);
    charts.add(new Chart(document.getElementById('kd-sp-top'), {
        type: 'bar',
        data: { labels: t.map((x) => x.item_name), datasets: [{ label: 'Doanh số', data: t.map((x) => x.revenue), backgroundColor: '#3b82f6' }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatCurrency(c.parsed.x) } } }, scales: { x: { ticks: { callback: (v) => formatVNDShort(v) } } } },
    }));
}

function moverRow(x) {
    const up = (x.delta || 0) >= 0;
    const color = up ? 'var(--kd-success)' : 'var(--kd-danger)';
    const pctTxt = x.growth_pct == null ? (x.prev_revenue ? '' : 'mới') : (up ? '▲' : '▼') + Math.abs(x.growth_pct).toFixed(0) + '%';
    return `<div class="kd-flex kd-justify-between kd-text-sm" style="padding:6px 0;border-bottom:1px solid var(--kd-border);gap:8px;">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(x.item_name)}</span>
        <span style="color:${color};font-weight:700;white-space:nowrap;">${up ? '+' : ''}${formatVNDShort(x.delta)}${pctTxt ? ' · ' + pctTxt : ''}</span></div>`;
}

function renderMovers(m) {
    _movers = m || {};
    const up = (_upMode === 'pct' ? _movers.up_pct : _movers.up_abs) || [];
    const down = _movers.down || [];
    const nw = _movers.new || [];
    document.getElementById('kd-sp-up').innerHTML = up.length ? up.map(moverRow).join('') : '<div class="kd-text-muted kd-text-sm">Không có</div>';
    document.getElementById('kd-sp-down').innerHTML = down.length ? down.map(moverRow).join('') : '<div class="kd-text-muted kd-text-sm">Không có</div>';
    const nwEl = document.getElementById('kd-sp-new');
    if (nwEl) nwEl.innerHTML = nw.length
        ? nw.map((x) => `<span class="kd-badge kd-badge-primary" style="display:inline-block;margin:2px;">${escapeHtml(x.item_name)} · ${formatVNDShort(x.revenue)}</span>`).join('')
        : '<div class="kd-text-muted kd-text-sm">Không có mã mới.</div>';
}

function renderCoverage(cov) {
    const root = document.getElementById('kd-sp-coverage');
    if (!root) return;
    const noun = CHANNEL_NOUN[_k];
    if (!cov.length) { root.innerHTML = `<div class="kd-text-muted">Mọi SKU đã phủ toàn bộ ${noun} 🎉</div>`; return; }
    root.innerHTML = `<p class="kd-text-sm kd-text-muted">Sắp theo độ phủ thấp nhất — ưu tiên đẩy phân phối:</p>
        <div style="overflow-x:auto;"><table class="kd-table kd-mt-2">
        <thead><tr><th>SKU</th><th class="kd-text-end">Độ phủ</th><th class="kd-text-end">Thiếu</th><th class="kd-text-end">DS kỳ</th><th></th></tr></thead>
        <tbody>${cov.map((r) => `<tr>
            <td data-label="SKU">${escapeHtml(r.item_name)}</td>
            <td data-label="Độ phủ" class="kd-text-end">${r.buyers}/${r.total_npp} (${(r.coverage_pct || 0).toFixed(0)}%)</td>
            <td data-label="Thiếu" class="kd-text-end"><strong style="color:var(--kd-warning);">${r.missing}</strong></td>
            <td data-label="DS kỳ" class="kd-text-end">${formatCurrency(r.revenue)}</td>
            <td><a href="javascript:void(0)" class="kd-link kd-text-sm kd-sp-cov-drill" data-code="${escapeHtml(r.item_code)}" data-name="${escapeHtml(r.item_name)}">${noun} thiếu →</a></td>
        </tr>`).join('')}</tbody></table></div>
        <div id="kd-sp-cov-detail" class="kd-mt-2"></div>`;
    root.querySelectorAll('.kd-sp-cov-drill').forEach((a) => a.addEventListener('click', () => drillCoverage(a.dataset.code, a.dataset.name)));
}

async function drillCoverage(code, name) {
    const root = document.getElementById('kd-sp-cov-detail');
    if (!root) return;
    const noun = CHANNEL_NOUN[_k];
    root.innerHTML = '<div class="kd-skeleton" style="height:80px;"></div>';
    try {
        const list = await api.mgr.skuWhiteSpace(_k, code, _months);
        root.innerHTML = !list.length
            ? `<div class="kd-text-muted">"${escapeHtml(name)}" đã phủ hết ${noun} có doanh số.</div>`
            : `<div class="kd-card" style="background:var(--kd-surface-2);"><strong>${escapeHtml(name)}</strong> — ${list.length} ${noun} chưa nhập:
                <table class="kd-table kd-mt-2"><thead><tr><th>${noun}</th><th class="kd-text-end">DS kỳ</th></tr></thead>
                <tbody>${list.map((r) => `<tr><td data-label="${noun}">${escapeHtml(r.customer_name)}</td><td data-label="DS" class="kd-text-end">${formatCurrency(r.revenue)}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (err) { root.innerHTML = `<div class="kd-text-muted">${escapeHtml(err.message)}</div>`; }
}

function renderGroups(groups) {
    const noun = CHANNEL_NOUN[_k];
    document.getElementById('kd-sp-groups').innerHTML = html`
        <table class="kd-table">
            <thead><tr><th>Nhóm hàng</th><th class="kd-text-end">Doanh số</th><th class="kd-text-end">Số thùng</th><th class="kd-text-end">Độ phủ ${noun}</th></tr></thead>
            <tbody>
                ${groups.map((g) => html`<tr>
                    <td data-label="Nhóm hàng">${escapeHtml(g.item_group)}</td>
                    <td data-label="Doanh số" class="kd-text-end">${formatCurrency(g.revenue)}</td>
                    <td data-label="Số thùng" class="kd-text-end">${formatNumber(g.qty)}</td>
                    <td data-label="Độ phủ" class="kd-text-end">${g.buyers}/${g.total_npp} (${(g.coverage_pct || 0).toFixed(0)}%)</td>
                </tr>`).join('') || '<tr><td colspan="4" class="kd-text-center kd-text-muted">Không có dữ liệu</td></tr>'}
            </tbody>
        </table>
    `;
}

function renderSkuTable() {
    const root = document.getElementById('kd-sp-skutable');
    if (!root) return;
    const q = (document.getElementById('kd-sp-skusearch')?.value || '').toLowerCase().trim();
    const { key, dir } = _skuSort;
    let rows = _top.filter((r) => !q || (r.item_name || '').toLowerCase().includes(q) || (r.item_code || '').toLowerCase().includes(q));
    rows = rows.slice().sort((a, b) => {
        let av = a[key], bv = b[key];
        if (av === null || av === undefined) av = -Infinity;
        if (bv === null || bv === undefined) bv = -Infinity;
        return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
    const hd = (k, label, end) => `<th class="${end ? 'kd-text-end' : ''}" data-sk="${k}" style="cursor:pointer;user-select:none;">${label}${key === k ? (dir < 0 ? ' ▼' : ' ▲') : ''}</th>`;
    root.innerHTML = `<div style="overflow-x:auto;"><table class="kd-table">
        <thead><tr>${hd('item_name', 'SKU')}<th>Nhóm</th>${hd('revenue', 'DS', 1)}${hd('qty', 'Thùng', 1)}${hd('growth_pct', '%Thay đổi', 1)}</tr></thead>
        <tbody>${rows.map((r) => `<tr>
            <td data-label="SKU">${escapeHtml(r.item_name)}</td>
            <td data-label="Nhóm">${escapeHtml(r.item_group || '')}</td>
            <td data-label="DS" class="kd-text-end">${formatCurrency(r.revenue)}</td>
            <td data-label="Thùng" class="kd-text-end">${formatNumber(r.qty)}</td>
            <td data-label="%Thay đổi" class="kd-text-end">${r.growth_pct == null ? '—' : (r.growth_pct >= 0 ? '▲' : '▼') + Math.abs(r.growth_pct).toFixed(0) + '%'}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="kd-text-center kd-text-muted">Không có SKU</td></tr>'}</tbody>
    </table></div>`;
    root.querySelectorAll('th[data-sk]').forEach((th) => th.addEventListener('click', () => {
        const k = th.dataset.sk;
        if (_skuSort.key === k) _skuSort.dir *= -1; else { _skuSort.key = k; _skuSort.dir = -1; }
        renderSkuTable();
    }));
}

async function loadSlow() {
    const root = document.getElementById('kd-sp-slow');
    if (!root) return;
    const days = parseInt(document.getElementById('kd-sp-slowdays')?.value, 10) || 60;
    root.innerHTML = '<div class="kd-skeleton" style="height:120px;"></div>';
    try {
        const list = await api.mgr.slowSkus(_k, days);
        root.innerHTML = !list.length ? '<div class="kd-text-muted">Không có SKU chậm trong ngưỡng này.</div>' : `
            <table class="kd-table"><thead><tr><th>SKU</th><th>Bán cuối</th><th class="kd-text-end">Số ngày</th><th class="kd-text-end">Thùng (12T)</th></tr></thead>
            <tbody>${list.map((r) => `<tr><td data-label="SKU">${escapeHtml(r.item_name)}</td><td data-label="Bán cuối">${escapeHtml(r.last_sold)}</td><td data-label="Số ngày" class="kd-text-end">${r.days_since}</td><td data-label="Thùng" class="kd-text-end">${formatNumber(r.qty)}</td></tr>`).join('')}</tbody></table>`;
    } catch (err) { root.innerHTML = `<div class="kd-text-muted">${escapeHtml(err.message)}</div>`; }
}

async function loadDepth() {
    const root = document.getElementById('kd-sp-depth');
    if (!root) return;
    const noun = CHANNEL_NOUN[_k];
    root.innerHTML = '<div class="kd-skeleton" style="height:120px;"></div>';
    try {
        const d = await api.mgr.catalogDepth(_k, _months);
        const rows = d.rows || [];
        root.innerHTML = !rows.length ? '<div class="kd-text-muted">Chưa có dữ liệu.</div>' : `
            <p class="kd-text-sm kd-text-muted">⚠️ = danh mục mỏng (< ${d.thin} SKU) → ưu tiên cross-sell.</p>
            <table class="kd-table kd-mt-2"><thead><tr><th>${noun}</th><th>Tỉnh</th><th class="kd-text-end">Số SKU</th><th class="kd-text-end">Doanh số</th></tr></thead>
            <tbody>${rows.map((r) => `<tr><td data-label="${noun}">${r.thin ? '⚠️ ' : ''}${escapeHtml(r.customer_name)}</td><td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td><td data-label="Số SKU" class="kd-text-end">${r.sku_count}</td><td data-label="Doanh số" class="kd-text-end">${formatCurrency(r.revenue)}</td></tr>`).join('')}</tbody></table>`;
    } catch (err) { root.innerHTML = `<div class="kd-text-muted">${escapeHtml(err.message)}</div>`; }
}

async function loadWhiteSpace() {
    const group = document.getElementById('kd-sp-ws').value;
    const root = document.getElementById('kd-sp-ws-list');
    const noun = CHANNEL_NOUN[_k];
    if (!group) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="kd-skeleton" style="height:120px;"></div>';
    try {
        const list = await api.mgr.whiteSpace(_k, group, _months);
        if (!list.length) { root.innerHTML = `<div class="kd-text-muted">Tất cả ${noun} đang mua đều đã có "${escapeHtml(group)}".</div>`; return; }
        root.innerHTML = html`
            <div class="kd-text-sm kd-text-muted">${list.length} ${noun} có doanh số nhưng CHƯA mua "${escapeHtml(group)}" → ưu tiên chào hàng:</div>
            <table class="kd-table kd-mt-2">
                <thead><tr><th>${noun}</th><th>Tỉnh</th><th class="kd-text-end">Doanh số kỳ</th></tr></thead>
                <tbody>
                    ${list.map((r) => html`<tr>
                        <td data-label="${noun}">${escapeHtml(r.customer_name)}</td>
                        <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                        <td data-label="Doanh số" class="kd-text-end">${formatCurrency(r.revenue)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        root.innerHTML = `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}
