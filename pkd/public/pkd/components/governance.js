// Panel "Giám sát & sức khoẻ kinh doanh" — dùng chung Tổng quan (chọn kênh)
// và Quản lý kênh (kênh cố định). Dữ liệu: pkd.api.governance.get_governance →
// { meta, flow[12 tháng], health, movers{down,up}, concentration, debt, pace }.
// Attribution ROSTER (khách hiện thuộc kênh) — khác snapshot của Kinh doanh chung.

import { html } from '../lib/dom.js';
import { formatNumber, formatVNDShort, escapeHtml } from '../lib/format.js';
import { pagedTable } from './data-table.js';
import { loadChartLib } from './chart.js';

// Màu theo NGỮ NGHĨA cố định (palette đã validate): mua = xanh dương, mới =
// xanh lục, rời = đỏ, tỷ lệ trả = cam, tham chiếu = xám trung tính.
const C = { buyers: '#3b82f6', new: '#10b981', lost: '#ef4444', rate: '#f97316', spike: '#ef4444' };

const pctTxt = (v, digits = 1) => (v == null ? '—' : v.toFixed(digits) + '%');

function deltaBadge(v) {
    if (v === null || v === undefined) return '<span class="kd-text-muted">—</span>';
    const up = v >= 0;
    return `<span style="color:${up ? 'var(--kd-success)' : 'var(--kd-danger)'};font-weight:800;">${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
}

function moverTable(rows, tone) {
    return pagedTable({
        columns: [
            { key: 'customer_name', label: 'Khách', render: (r) =>
                `<a href="#${escapeHtml(r.route || '')}" class="kd-link">${escapeHtml(r.customer_name)}</a>${r.is_new ? ' <span class="kd-badge kd-badge-success">Mới</span>' : ''}` },
            { key: 'prev90', label: '90N trước', render: (r) => formatVNDShort(r.prev90) },
            { key: 'cur90', label: '90N này', render: (r) => formatVNDShort(r.cur90) },
            { key: 'delta', label: 'Chênh', render: (r) =>
                `<span style="color:var(--kd-${tone});font-weight:700;">${formatVNDShort(r.delta)}</span>` },
            { key: 'pct', label: '%', render: (r) => deltaBadge(r.pct) },
        ],
        rows: rows || [],
        emptyMessage: 'Không có biến động đáng kể',
    });
}

export function governanceHtml(d) {
    const h = d.health || {};
    const cc = d.concentration || {};
    const debt = d.debt || {};
    const meta = d.meta || {};
    const pace = d.pace || {};

    const paceChips = (pace.channels || []).map((c) => {
        const att = c.attainment_pct;
        const cls = !c.target ? 'kd-badge' :
            c.below ? 'kd-badge kd-badge-danger' :
            (att != null && pace.pace_pct != null && att < pace.pace_pct) ? 'kd-badge kd-badge-warning' : 'kd-badge kd-badge-success';
        const txt = c.target ? `đạt ${pctTxt(att, 0)} / nhịp ${pctTxt(pace.pace_pct, 0)}` : 'chưa đặt chỉ tiêu';
        return `<span class="${cls}" style="font-size:12px;">${escapeHtml(c.label)}: ${txt}${c.below ? ' ⚠' : ''}</span>`;
    }).join(' ');

    return html`
        <div class="kd-text-sm kd-text-muted kd-mb-2">
            Phạm vi: <b>${escapeHtml(meta.label || '')}</b> · tính đến ${escapeHtml(meta.asof || '')} ·
            tập khách theo <b>roster</b> (khách hiện thuộc kênh — có thể lệch nhẹ với "Kinh doanh chung" vốn theo nhóm ghi trên hoá đơn) ·
            "rời bỏ" = quá ${meta.lost_days || 90} ngày không mua
        </div>

        <div class="kd-stat-grid">
            <div class="kd-stat-tile"><div class="kd-stat-label">Khách mua 90 ngày</div>
                <div class="kd-stat-value">${formatNumber(h.active_90)}</div>
                <div class="kd-stat-sub">có hoá đơn trong 90N</div></div>
            <div class="kd-stat-tile kd-stat-success"><div class="kd-stat-label">Khách mới 90N</div>
                <div class="kd-stat-value">${formatNumber(h.new_90)}</div>
                <div class="kd-stat-sub">đơn đầu tiên trong 90N</div></div>
            <div class="kd-stat-tile kd-stat-danger"><div class="kd-stat-label">Khách rời bỏ 90N</div>
                <div class="kd-stat-value">${formatNumber(h.lost_90)}</div>
                <div class="kd-stat-sub">ròng: ${h.net_90 >= 0 ? '+' : ''}${formatNumber(h.net_90)} khách</div></div>
            <div class="kd-stat-tile"><div class="kd-stat-label">Giữ chân 90N</div>
                <div class="kd-stat-value">${pctTxt(h.retention_pct)}</div>
                <div class="kd-stat-sub">khách 90N trước còn mua 90N này</div></div>
            <div class="kd-stat-tile"><div class="kd-stat-label">DS 90 ngày</div>
                <div class="kd-stat-value" style="font-size:20px;">${formatVNDShort(h.rev90)}</div>
                <div class="kd-stat-sub">${deltaBadge(h.growth90_pct)} so 90N liền trước</div></div>
            <div class="kd-stat-tile"><div class="kd-stat-label">DS / khách mua</div>
                <div class="kd-stat-value" style="font-size:20px;">${h.rev_per_active != null ? formatVNDShort(h.rev_per_active) : '—'}</div>
                <div class="kd-stat-sub">bình quân 90N</div></div>
            <div class="kd-stat-tile ${debt.dso != null && debt.dso > 60 ? 'kd-stat-warning' : ''}"><div class="kd-stat-label">DSO</div>
                <div class="kd-stat-value">${debt.dso != null ? formatNumber(debt.dso) : '—'}</div>
                <div class="kd-stat-sub">ngày thu tiền bình quân (nợ ÷ DS/ngày 12T)</div></div>
            <div class="kd-stat-tile ${(debt.overdue_pct || 0) >= 50 ? 'kd-stat-danger' : 'kd-stat-warning'}"><div class="kd-stat-label">Nợ quá hạn</div>
                <div class="kd-stat-value">${pctTxt(debt.overdue_pct, 0)}</div>
                <div class="kd-stat-sub">${formatVNDShort(debt.overdue)} / ${formatVNDShort(debt.balance)}</div></div>
        </div>

        ${(pace.channels || []).length ? `
        <div class="kd-card kd-mt-2">
            <div class="kd-text-sm"><b>Nhịp đạt chỉ tiêu tháng này</b> (dưới nhịp &gt;5 điểm % = cảnh báo sớm):</div>
            <div class="kd-mt-2" style="display:flex;flex-wrap:wrap;gap:8px;">${paceChips}</div>
        </div>` : ''}

        <div class="kd-card kd-mt-2"><h3 class="kd-font-bold">Biến động tập khách theo tháng</h3>
            <div class="kd-chart-wrap"><canvas id="kd-gov-flow"></canvas></div>
            <div class="kd-text-sm kd-text-muted kd-mt-2">"Rời bỏ" chốt tại tháng mua CUỐI của khách — vài tháng gần nhất
                chưa đủ ${meta.lost_days || 90} ngày im lặng nên chưa thể có khách rời (không phải bằng 0 thật).</div>
        </div>

        <div class="kd-card kd-mt-2"><h3 class="kd-font-bold">Tỷ lệ trả về theo tháng (%)</h3>
            <div class="kd-chart-wrap"><canvas id="kd-gov-ret"></canvas></div>
            <div class="kd-text-sm kd-text-muted kd-mt-2">Điểm đỏ = tháng đột biến (vượt 1,5× trung bình 12 tháng và ≥ 2%).</div>
        </div>

        <div class="kd-grid-2 kd-mt-2">
            <div class="kd-card"><h3 class="kd-font-bold kd-mb-2">🔻 Giảm sút mạnh nhất (90N vs 90N trước)</h3>
                ${moverTable((d.movers || {}).down, 'danger')}</div>
            <div class="kd-card"><h3 class="kd-font-bold kd-mb-2">🔺 Tăng trưởng mạnh nhất</h3>
                ${moverTable((d.movers || {}).up, 'success')}</div>
        </div>

        <div class="kd-grid-2 kd-mt-2">
            <div class="kd-card"><h3 class="kd-font-bold">Mức độ tập trung (12 tháng)</h3>
                <div class="kd-gov-row"><span>Top 5 khách chiếm</span><b>${pctTxt(cc.top5_pct)}</b></div>
                <div class="kd-gov-row"><span>Top 10 khách chiếm</span><b>${pctTxt(cc.top10_pct)}</b></div>
                <div class="kd-gov-row"><span>Số khách tạo 80% doanh số</span><b>${formatNumber(cc.n_for_80)}</b></div>
                <div class="kd-gov-row"><span>Tổng khách có doanh số 12T</span><b>${formatNumber(cc.buyers_12m)}</b></div>
                <div class="kd-text-sm kd-text-muted kd-mt-2">Tập trung càng cao → rủi ro phụ thuộc càng lớn.</div>
            </div>
            <div class="kd-card"><h3 class="kd-font-bold">Tín hiệu công nợ (GL)</h3>
                <div class="kd-gov-row"><span>Tổng công nợ</span><b>${formatVNDShort(debt.balance)}</b></div>
                <div class="kd-gov-row"><span>Quá hạn</span><b style="color:var(--kd-warning);">${formatVNDShort(debt.overdue)}</b></div>
                <div class="kd-gov-row"><span>Quá hạn &gt;90 ngày</span><b style="color:var(--kd-danger);">${formatVNDShort(debt.over_90)}</b></div>
                <div class="kd-gov-row"><span>Còn nợ nhưng đã ngừng mua</span>
                    <b style="color:var(--kd-danger);">${formatNumber(debt.no_buy_count)} khách · ${formatVNDShort(debt.no_buy_amount)}</b></div>
                <div class="kd-text-sm kd-text-muted kd-mt-2">"Ngừng mua" = quá ${meta.dormant_days || 30} ngày không có hoá đơn — nợ của nhóm này khó đòi dần theo thời gian.</div>
            </div>
        </div>
    `;
}

function renderCharts(Chart, registry, d, root) {
    const flow = d.flow || [];
    const labels = flow.map((f) => f.month);

    // Tra canvas TRONG root (2 view cùng dùng id kd-gov-* — tra global sẽ vớ
    // nhầm canvas của render mới khi response cũ về muộn → "Canvas already in use").
    const el1 = root.querySelector('#kd-gov-flow');
    if (el1) registry.add(new Chart(el1, {
        type: 'bar',
        data: { labels, datasets: [
            { label: 'Khách mua', data: flow.map((f) => f.buyers), backgroundColor: C.buyers, borderRadius: 3 },
            { label: 'Mới', data: flow.map((f) => f.new), backgroundColor: C.new, borderRadius: 3 },
            { label: 'Rời bỏ', data: flow.map((f) => f.lost), backgroundColor: C.lost, borderRadius: 3 },
        ] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: { y: { ticks: { callback: (v) => formatNumber(v), precision: 0 } } } },
    }));

    const el2 = root.querySelector('#kd-gov-ret');
    if (el2) registry.add(new Chart(el2, {
        type: 'line',
        data: { labels, datasets: [{
            label: 'Tỷ lệ trả (%)',
            data: flow.map((f) => f.return_rate_pct),
            borderColor: C.rate, backgroundColor: C.rate, tension: 0.3, spanGaps: true,
            pointRadius: flow.map((f) => (f.return_spike ? 6 : 3)),
            pointBackgroundColor: flow.map((f) => (f.return_spike ? C.spike : C.rate)),
        }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
                tooltip: { callbacks: { label: (c) => `Tỷ lệ trả: ${pctTxt(c.parsed.y)}${flow[c.dataIndex]?.return_spike ? ' ⚠ đột biến' : ''}` } } },
            scales: { y: { ticks: { callback: (v) => v + '%' } } } },
    }));
}

/** Vẽ toàn bộ panel vào `body`. Caller giữ 1 chartRegistry riêng và
 *  gọi registry.destroy() TRƯỚC khi đổi nội dung body (chống leak). */
export async function renderGovernance(body, d, registry) {
    body.innerHTML = governanceHtml(d);
    const Chart = await loadChartLib();
    if (!body.isConnected) return;   // caller đã re-render/điều hướng trong lúc chờ lib
    renderCharts(Chart, registry, d, body);
}
