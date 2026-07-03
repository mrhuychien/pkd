import { html } from '../lib/dom.js';
import { formatCurrency, formatVNDShort, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';
import { emptyState } from '../components/empty-state.js';
import { qlNav, channelOf, CHANNEL_LABEL, CHANNEL_NOUN } from '../components/ql-nav.js';

// ─── Mục tiêu doanh số THEO KHÁCH (port từ npp quan-ly-target, channel-aware) ─
// Ghi vào Customer.custom_monthly_target (Custom Field của app npp). Nếu site
// chưa cài npp → server trả available:false, view chỉ hướng dẫn (#/chitieu là
// chỉ tiêu THEO KÊNH của pkd — hai tầng bổ trợ nhau).
let _k = 'npp';
let _months = 1;
let _pace = 0;

/** Tô màu % đạt theo nhịp kỳ vọng: ≥ nhịp = xanh, ≥80% nhịp = vàng, còn lại đỏ. */
function attBadge(pct) {
    if (pct === null || pct === undefined) return '<span class="kd-text-muted">— chưa đặt</span>';
    const ref = _pace || 100;
    const color = pct >= ref ? 'var(--kd-success)' : (pct >= ref * 0.8 ? 'var(--kd-warning)' : 'var(--kd-danger)');
    return `<strong style="color:${color};">${pct.toFixed(0)}%</strong>`;
}

const BTN = 'padding:8px 14px;font-size:.85rem;border:none;border-radius:10px;font-weight:700;cursor:pointer;';

export async function render({ container, query }) {
    _k = channelOf(query);
    const noun = CHANNEL_NOUN[_k];
    container.innerHTML = html`
        ${banner({ title: 'Mục tiêu doanh số', subtitle: `% hoàn thành theo ${noun} · kênh ${CHANNEL_LABEL[_k]}` })}
        ${qlNav('tg', _k)}
        <div class="kd-flex kd-justify-between kd-items-center kd-flex-wrap" style="gap:10px;">
            <h3 class="kd-font-bold">Mục tiêu vs Thực tế</h3>
            <select id="kd-tg2-period" style="padding:8px 12px;border-radius:10px;border:1px solid var(--kd-border);background:var(--kd-surface);font-weight:600;color:var(--kd-text);">
                <option value="1" selected>Tháng này</option><option value="3">3 tháng</option><option value="6">6 tháng</option><option value="12">12 tháng</option>
            </select>
        </div>
        <div class="kd-kpi-grid" id="kd-tg2-totals">
            <div class="kd-skeleton" style="height:90px;"></div><div class="kd-skeleton" style="height:90px;"></div><div class="kd-skeleton" style="height:90px;"></div>
        </div>
        <div class="kd-card kd-mt-3">
            <div class="kd-flex kd-justify-between kd-items-center kd-flex-wrap" style="gap:10px;">
                <p class="kd-text-sm kd-text-muted" style="margin:0;flex:1;min-width:220px;">Nhập <strong>mục tiêu doanh số/tháng</strong> cho từng ${noun}. % đạt = doanh số kỳ ÷ (mục tiêu tháng × số tháng), tô màu theo <strong>nhịp kỳ vọng</strong>. Chỉ tiêu tổng theo kênh nhập ở <a href="#/chitieu" class="kd-link">Chỉ tiêu</a>.</p>
                <div class="kd-flex" style="gap:8px;">
                    <button id="kd-tg2-fill" type="button" style="${BTN}background:var(--kd-surface-2);color:var(--kd-text);border:1px solid var(--kd-border);">✨ Điền gợi ý</button>
                    <button id="kd-tg2-saveall" type="button" style="${BTN}background:var(--kd-season-grad);color:#fff;">💾 Lưu tất cả</button>
                </div>
            </div>
            <details class="kd-mt-2" style="font-size:.85rem;">
                <summary style="cursor:pointer;color:var(--kd-text-muted);">📋 Dán hàng loạt từ Excel/Sheets</summary>
                <p class="kd-text-sm kd-text-muted kd-mt-2" style="margin-bottom:6px;">Mỗi dòng: <code>Tên (hoặc mã)</code> &lt;tab/phẩy&gt; <code>mục tiêu</code>. Bấm "Áp dụng" để điền vào bảng (chưa lưu), kiểm tra rồi "Lưu tất cả".</p>
                <textarea id="kd-tg2-paste" rows="4" placeholder="NPP Hà Nội	150000000&#10;NPP Hải Phòng, 90000000" style="width:100%;padding:8px;border:1px solid var(--kd-border);border-radius:8px;background:var(--kd-surface);color:var(--kd-text);font-family:monospace;font-size:.8rem;"></textarea>
                <button id="kd-tg2-apply" type="button" class="kd-mt-2" style="${BTN}background:var(--kd-surface-2);color:var(--kd-text);border:1px solid var(--kd-border);">Áp dụng vào bảng</button>
            </details>
            <div id="kd-tg2-table" class="kd-mt-3"><div class="kd-skeleton" style="height:240px;"></div></div>
        </div>
    `;
    document.getElementById('kd-tg2-period').addEventListener('change', (e) => load(parseInt(e.target.value, 10) || 1));
    document.getElementById('kd-tg2-fill').addEventListener('click', fillSuggestions);
    document.getElementById('kd-tg2-saveall').addEventListener('click', saveAll);
    document.getElementById('kd-tg2-apply').addEventListener('click', applyPaste);
    await load(1);
}

async function load(months) {
    _months = months;
    try {
        const d = await api.mgr.targets(_k, months);
        if (d.available === false) {
            document.getElementById('kd-tg2-totals').innerHTML = '';
            document.getElementById('kd-tg2-table').innerHTML = emptyState({
                icon: '🧩', title: 'Chưa có field mục tiêu theo khách',
                message: d.message || 'Cần app npp (Customer.custom_monthly_target). Dùng #/chitieu cho chỉ tiêu kênh.',
            });
            return;
        }
        _pace = d.expected_pace_pct || 0;
        const t = d.totals || {};
        document.getElementById('kd-tg2-totals').innerHTML = html`
            <div class="kd-kpi-card"><div class="kd-kpi-label">Tổng mục tiêu</div><div class="kd-kpi-value">${formatVNDShort(t.target || 0)}</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">Doanh số thực</div><div class="kd-kpi-value">${formatVNDShort(t.revenue || 0)}</div></div>
            <div class="kd-kpi-card"><div class="kd-kpi-label">% hoàn thành</div><div class="kd-kpi-value">${t.attainment_pct === null || t.attainment_pct === undefined ? '—' : t.attainment_pct.toFixed(0) + '%'}</div><div class="kd-kpi-sub">Nhịp kỳ vọng ~${_pace.toFixed(0)}%</div></div>
        `;
        renderTable(d.rows || []);
    } catch (err) {
        document.getElementById('kd-tg2-table').innerHTML =
            `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderTable(rows) {
    const root = document.getElementById('kd-tg2-table');
    const noun = CHANNEL_NOUN[_k];
    root.innerHTML = html`
        <div style="overflow-x:auto;"><table class="kd-table">
            <thead><tr><th>${noun}</th><th>Tỉnh</th><th>Mục tiêu/tháng</th><th>Gợi ý</th><th class="kd-text-end">Doanh số kỳ</th><th class="kd-text-end">% đạt</th></tr></thead>
            <tbody>
                ${rows.map((r) => html`<tr>
                    <td data-label="${noun}"><strong>${escapeHtml(r.customer_name)}</strong></td>
                    <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                    <td data-label="Mục tiêu/tháng" style="white-space:nowrap;">
                        <input type="number" min="0" step="1000000" class="kd-tg2-input" data-c="${escapeHtml(r.customer)}" data-name="${escapeHtml((r.customer_name || '').toLowerCase().trim())}" data-orig="${r.monthly_target || 0}" data-sug="${r.suggested || 0}" value="${r.monthly_target || 0}"
                               style="width:130px;padding:6px 8px;border:1px solid var(--kd-border);border-radius:8px;background:var(--kd-surface);color:var(--kd-text);">
                        <button class="kd-tg2-save" data-c="${escapeHtml(r.customer)}" type="button" style="padding:6px 10px;font-size:.8rem;border:none;border-radius:8px;background:var(--kd-season-grad);color:#fff;font-weight:700;cursor:pointer;">Lưu</button>
                    </td>
                    <td data-label="Gợi ý" style="white-space:nowrap;">
                        ${r.suggested ? html`<span class="kd-text-muted">${formatVNDShort(r.suggested)}</span> <a href="javascript:void(0)" class="kd-tg2-use kd-link kd-text-sm" data-c="${escapeHtml(r.customer)}">dùng</a>` : '<span class="kd-text-muted">—</span>'}
                    </td>
                    <td data-label="Doanh số" class="kd-text-end">${formatCurrency(r.revenue)}</td>
                    <td data-label="% đạt" class="kd-text-end">${attBadge(r.attainment_pct)}</td>
                </tr>`).join('') || `<tr><td colspan="6" class="kd-text-center kd-text-muted">Không có ${noun}</td></tr>`}
            </tbody>
        </table></div>
    `;
    root.querySelectorAll('.kd-tg2-save').forEach((b) => b.addEventListener('click', () => saveTarget(b.dataset.c, root)));
    root.querySelectorAll('.kd-tg2-use').forEach((b) => b.addEventListener('click', () => {
        const inp = root.querySelector(`.kd-tg2-input[data-c="${CSS.escape(b.dataset.c)}"]`);
        if (inp) { inp.value = inp.dataset.sug || 0; inp.focus(); }
    }));
}

/** Điền gợi ý (TB 3 tháng × 1.1) vào MỌI ô chưa có mục tiêu. */
function fillSuggestions() {
    const inputs = document.querySelectorAll('#kd-tg2-table .kd-tg2-input');
    let n = 0;
    inputs.forEach((inp) => {
        const cur = parseFloat(inp.value) || 0;
        const sug = parseFloat(inp.dataset.sug) || 0;
        if (cur <= 0 && sug > 0) { inp.value = sug; n++; }
    });
    showToast(n ? `Đã điền gợi ý cho ${n} khách — kiểm tra rồi "Lưu tất cả"` : 'Tất cả đã có mục tiêu', n ? 'info' : 'success');
}

/** Lưu mọi ô có thay đổi so với giá trị đã tải (set_targets_bulk). */
async function saveAll() {
    const inputs = document.querySelectorAll('#kd-tg2-table .kd-tg2-input');
    const changed = [];
    inputs.forEach((inp) => {
        const cur = parseFloat(inp.value) || 0;
        const orig = parseFloat(inp.dataset.orig) || 0;
        if (cur !== orig) changed.push({ customer: inp.dataset.c, amount: cur });
    });
    if (!changed.length) { showToast('Không có thay đổi để lưu', 'info'); return; }
    try {
        const r = await api.mgr.setTargetsBulk(changed);
        showToast(`Đã lưu ${r.updated} khách`, 'success');
        load(_months);
    } catch (err) {
        showToast('Lỗi lưu: ' + (err.message || ''), 'error');
    }
}

/** Dán từ Excel/Sheets: mỗi dòng "tên/mã <tab|,> số". */
function applyPaste() {
    const ta = document.getElementById('kd-tg2-paste');
    const text = (ta.value || '').trim();
    if (!text) { showToast('Chưa có dữ liệu để dán', 'info'); return; }
    const inputs = Array.from(document.querySelectorAll('#kd-tg2-table .kd-tg2-input'));
    const byCode = new Map(inputs.map((i) => [i.dataset.c.toLowerCase(), i]));
    const byName = new Map(inputs.map((i) => [i.dataset.name, i]));
    let ok = 0, miss = 0;
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split(/\t|,|;|\s{2,}/).map((s) => s.trim()).filter(Boolean);
        if (parts.length < 2) { miss++; continue; }
        const amount = parseFloat(parts[parts.length - 1].replace(/[^\d.-]/g, '')) || 0;
        const key = parts.slice(0, -1).join(' ').toLowerCase().trim();
        const inp = byCode.get(key) || byName.get(key);
        if (inp && amount > 0) { inp.value = amount; ok++; } else { miss++; }
    }
    showToast(`Đã áp dụng ${ok} dòng${miss ? `, ${miss} dòng không khớp` : ''} — kiểm tra rồi "Lưu tất cả"`, ok ? 'success' : 'error');
}

async function saveTarget(customer, root) {
    const input = root.querySelector(`.kd-tg2-input[data-c="${CSS.escape(customer)}"]`);
    const amount = parseFloat(input.value) || 0;
    try {
        await api.mgr.setTarget(customer, amount);
        showToast('Đã lưu mục tiêu', 'success');
        load(_months);
    } catch (err) {
        showToast('Lỗi lưu: ' + (err.message || ''), 'error');
    }
}
