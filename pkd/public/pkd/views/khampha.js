import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, escapeHtml, todayISO } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';
import { dataTable } from '../components/data-table.js';
import { loadChartLib, chartRegistry } from '../components/chart.js';

const charts = chartRegistry();

const DIMENSIONS = [
    ['channel', 'Kênh'], ['customer', 'Khách hàng'], ['item_group', 'Nhóm hàng'],
    ['item', 'Mặt hàng'], ['month', 'Tháng'], ['territory', 'Tỉnh/Khu vực'],
    ['outlet', 'Siêu thị (MT)'],
];
const PRESETS = [['mtd', 'Tháng này'], ['prev', 'Tháng trước'], ['qtd', 'Quý này'], ['ytd', 'Năm nay'], ['custom', 'Tuỳ chọn']];

function presetRange(preset) {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const iso = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    if (preset === 'mtd') return [iso(new Date(y, m, 1)), todayISO()];
    if (preset === 'prev') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    if (preset === 'qtd') return [iso(new Date(y, Math.floor(m / 3) * 3, 1)), todayISO()];
    if (preset === 'ytd') return [iso(new Date(y, 0, 1)), todayISO()];
    return null;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Khám phá', subtitle: 'Bóc tách doanh số/sản lượng theo nhiều chiều' })}
        <div class="kd-card">
            <div class="kd-filter-bar" id="kd-ex-filters">
                <label>Chiều
                    <select id="kd-ex-dim">${DIMENSIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
                </label>
                <label>Kỳ
                    <select id="kd-ex-preset">${PRESETS.map(([v, l]) => `<option value="${v}"${v === 'mtd' ? ' selected' : ''}>${l}</option>`).join('')}</select>
                </label>
                <label id="kd-ex-from-wrap" hidden>Từ <input type="date" id="kd-ex-from"></label>
                <label id="kd-ex-to-wrap" hidden>Đến <input type="date" id="kd-ex-to"></label>
                <label>Kênh
                    <select id="kd-ex-channel"><option value="">Tất cả</option><option value="npp">NPP</option><option value="mt">MT</option><option value="dulich">Du lịch</option></select>
                </label>
                <label>Nhóm hàng
                    <select id="kd-ex-ig"><option value="">Tất cả</option></select>
                </label>
                <label>Đo
                    <select id="kd-ex-measure"><option value="amount">Tiền</option><option value="boxes">Thùng</option></select>
                </label>
                <label>So sánh
                    <select id="kd-ex-compare"><option value="">Không</option><option value="prev">Kỳ trước</option><option value="yoy">YoY</option></select>
                </label>
                <button class="kd-btn-primary" id="kd-ex-run" type="button"><i class="fas fa-play"></i> Chạy</button>
                <button class="kd-btn-primary" id="kd-ex-csv" type="button" style="background:var(--kd-success);"><i class="fas fa-download"></i> CSV</button>
            </div>
        </div>
        <div class="kd-card kd-mt-3" id="kd-ex-chart-card" hidden>
            <h3 class="kd-font-bold">Top 15</h3>
            <div class="kd-chart-wrap"><canvas id="kd-ex-chart"></canvas></div>
        </div>
        <div class="kd-mt-3" id="kd-ex-result"><div class="kd-text-sm kd-text-muted">Chọn bộ lọc rồi bấm "Chạy".</div></div>
    `;

    // Nạp danh sách nhóm hàng cho filter.
    try {
        const igs = await api.cached.itemGroups();
        const sel = document.getElementById('kd-ex-ig');
        (igs || []).forEach((g) => { const o = document.createElement('option'); o.value = g.name; o.textContent = g.name; sel.appendChild(o); });
    } catch (e) { /* im lặng — filter nhóm hàng vẫn dùng "Tất cả" */ }

    const presetSel = document.getElementById('kd-ex-preset');
    presetSel.addEventListener('change', () => {
        const custom = presetSel.value === 'custom';
        document.getElementById('kd-ex-from-wrap').hidden = !custom;
        document.getElementById('kd-ex-to-wrap').hidden = !custom;
        if (custom && !document.getElementById('kd-ex-from').value) {
            document.getElementById('kd-ex-from').value = presetRange('mtd')[0];
            document.getElementById('kd-ex-to').value = todayISO();
        }
    });

    document.getElementById('kd-ex-run').addEventListener('click', () => runQuery());
    document.getElementById('kd-ex-csv').addEventListener('click', () => downloadCsv());
    runQuery();  // chạy lần đầu với mặc định
}

function readFilters() {
    const dim = document.getElementById('kd-ex-dim').value;
    const preset = document.getElementById('kd-ex-preset').value;
    let range = presetRange(preset);
    if (!range) range = [document.getElementById('kd-ex-from').value, document.getElementById('kd-ex-to').value];
    let channel = document.getElementById('kd-ex-channel').value || null;
    if (dim === 'outlet') channel = 'mt';  // outlet bắt buộc kênh MT
    const item_group = document.getElementById('kd-ex-ig').value || null;
    const measure = document.getElementById('kd-ex-measure').value;
    const compare = document.getElementById('kd-ex-compare').value || null;
    return { dimension: dim, date_from: range[0], date_to: range[1], channel, item_group, measure, compare };
}

async function runQuery() {
    const f = readFilters();
    if (!f.date_from || !f.date_to) { showToast('Chọn khoảng ngày', 'warning'); return; }
    const result = document.getElementById('kd-ex-result');
    result.innerHTML = '<div class="kd-skeleton" style="height:200px;"></div>';
    try {
        const data = await api.getRevenueBreakdown({ ...f, fmt: 'json', limit: 500 });
        renderTable(data);
        await renderChart(data);
    } catch (err) {
        result.innerHTML = `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div class="kd-empty-title">Lỗi</div><div class="kd-text-sm">${escapeHtml(err.message)}</div></div>`;
        document.getElementById('kd-ex-chart-card').hidden = true;
    }
}

function fmtValue(measure, v) {
    return measure === 'boxes' ? `${formatNumber(v)} thùng` : formatVNDShort(v);
}

function renderTable(data) {
    const rows = data.rows || [];
    const measure = data.meta?.measure || 'amount';
    const hasCompare = rows.length && rows[0].prev_value !== undefined;
    const columns = [
        { key: 'label', label: data.meta?.dimension_label || 'Nhãn', render: (r) => escapeHtml(r.label ?? '(trống)') },
        { key: 'value', label: measure === 'boxes' ? 'Thùng' : 'Doanh số', render: (r) => fmtValue(measure, r.value) },
    ];
    if (hasCompare) {
        columns.push({ key: 'prev_value', label: 'Kỳ so sánh', render: (r) => fmtValue(measure, r.prev_value || 0) });
        columns.push({
            key: 'growth_pct', label: 'Tăng trưởng', render: (r) => {
                const g = r.growth_pct;
                if (g === null || g === undefined) return '<span class="kd-text-muted">—</span>';
                const up = g >= 0;
                return `<span style="color:${up ? 'var(--kd-success)' : 'var(--kd-danger)'};font-weight:700;">${up ? '▲' : '▼'} ${Math.abs(g).toFixed(1)}%</span>`;
            },
        });
    }
    document.getElementById('kd-ex-result').innerHTML =
        `<div class="kd-card"><h3 class="kd-font-bold kd-mb-2">Kết quả (${rows.length})</h3>${dataTable({ columns, rows })}</div>`;
}

async function renderChart(data) {
    const rows = (data.rows || []).slice(0, 15);
    const card = document.getElementById('kd-ex-chart-card');
    if (!rows.length) { card.hidden = true; return; }
    card.hidden = false;
    const measure = data.meta?.measure || 'amount';
    const Chart = await loadChartLib();
    charts.destroy();
    charts.add(new Chart(document.getElementById('kd-ex-chart'), {
        type: 'bar',
        data: {
            labels: rows.map((r) => r.label ?? '(trống)'),
            datasets: [{ data: rows.map((r) => r.value || 0), backgroundColor: '#3b82f6', borderRadius: 4 }],
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtValue(measure, c.parsed.x) } } },
            scales: { x: { ticks: { callback: (v) => formatVNDShort(v) } } },
        },
    }));
}

async function downloadCsv() {
    const f = readFilters();
    if (!f.date_from || !f.date_to) { showToast('Chọn khoảng ngày', 'warning'); return; }
    try {
        const res = await api.getRevenueBreakdown({ ...f, fmt: 'csv', limit: 2000 });
        const blob = new Blob(['﻿' + (res.csv || '')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = res.filename || 'pkd_export.csv';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        showToast('Đã tải CSV', 'success');
    } catch (err) {
        showToast('Lỗi tải CSV: ' + err.message, 'error');
    }
}
