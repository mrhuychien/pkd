import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';
import { loadChartLib, chartRegistry } from '../components/chart.js';

const charts = chartRegistry();

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
    `;

    try {
        const [ov, q] = await Promise.all([
            api.cached.overview(),
            api.getActionQueues(),
        ]);
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
