import { html } from '../lib/dom.js';
import { formatVNDShort, formatNumber, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';
import { showModal, closeModal } from '../components/modal.js';

const CH = [['npp', 'NPP'], ['mt', 'MT'], ['dulich', 'Du lịch']];
let _cells = {};       // (thang|kenh) -> cell (target + items, để sửa)
let _nam = null;
let _itemGroups = [];

function cellKey(thang, kenh) { return `${thang}|${kenh}`; }

// Đèn semantic: xanh ≥ pace, vàng ≥ 80% pace, đỏ < 80% pace.
function lightClass(attain, pace) {
    if (attain === null || attain === undefined) return 'kd-cell-empty';
    if (!pace) return 'kd-cell-green';
    if (attain >= pace) return 'kd-cell-green';
    if (attain >= pace * 0.8) return 'kd-cell-amber';
    return 'kd-cell-red';
}

export async function render({ container }) {
    const now = new Date().getFullYear();
    _nam = now;
    container.innerHTML = html`
        ${banner({ title: 'Chỉ tiêu', subtitle: 'Ma trận 12 tháng × 3 kênh — tap ô để nhập' })}
        <div class="kd-card">
            <label class="kd-font-bold">Năm
                <select id="kd-tg-year" style="margin-left:8px;padding:6px 12px;border-radius:10px;border:1px solid var(--kd-border);font-weight:700;">
                    ${[now + 1, now, now - 1, now - 2].map((y) => `<option value="${y}"${y === now ? ' selected' : ''}>${y}</option>`).join('')}
                </select>
            </label>
        </div>
        <div class="kd-mt-3" id="kd-tg-grid"><div class="kd-skeleton" style="height:300px;"></div></div>
    `;

    document.getElementById('kd-tg-year').addEventListener('change', (e) => { _nam = Number(e.target.value); load(); });
    try { _itemGroups = (await api.cached.itemGroups()) || []; } catch (e) { _itemGroups = []; }
    load();
}

async function load() {
    const grid = document.getElementById('kd-tg-grid');
    grid.innerHTML = '<div class="kd-skeleton" style="height:300px;"></div>';
    try {
        const [tg, att] = await Promise.all([api.getTargets(_nam), api.getTargetAttainment(_nam)]);
        _cells = {};
        (tg.cells || []).forEach((c) => { _cells[cellKey(c.thang, c.kenh)] = c; });
        const attMap = {};
        (att.matrix || []).forEach((m) => { attMap[cellKey(m.thang, m.kenh)] = m; });
        renderGrid(attMap);
    } catch (err) {
        grid.innerHTML = `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div class="kd-empty-title">Lỗi</div><div class="kd-text-sm">${escapeHtml(err.message)}</div></div>`;
    }
}

function renderGrid(attMap) {
    let rows = '';
    for (let thang = 1; thang <= 12; thang++) {
        let tds = '';
        CH.forEach(([key, label]) => {
            const a = attMap[cellKey(thang, key)] || {};
            const target = a.target, actual = a.actual || 0;
            const attain = a.attainment_pct, pace = a.pace_pct;
            const lc = lightClass(attain, pace);
            const inner = target != null
                ? `<div>${formatVNDShort(target)}</div>
                   <div class="kd-text-sm kd-text-muted">TH ${formatVNDShort(actual)}</div>
                   <span class="kd-cell-light ${lc}">${attain != null ? attain.toFixed(0) + '%' : '—'}</span>`
                : `<span class="kd-cell-light kd-cell-empty">+ nhập</span>`;
            tds += `<td data-label="${label}" class="kd-matrix-cell" data-thang="${thang}" data-kenh="${key}">${inner}</td>`;
        });
        rows += `<tr><td data-label="Tháng"><b>Th ${thang}</b></td>${tds}</tr>`;
    }
    document.getElementById('kd-tg-grid').innerHTML = `
        <div class="kd-card">
            <table class="kd-table">
                <thead><tr><th>Tháng</th>${CH.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    document.querySelectorAll('.kd-matrix-cell').forEach((td) => {
        td.addEventListener('click', () => openEditor(Number(td.dataset.thang), td.dataset.kenh));
    });
}

function openEditor(thang, kenh) {
    const cell = _cells[cellKey(thang, kenh)] || { thang, kenh, chi_tieu_thang: null, items: [] };
    const label = CH.find(([k]) => k === kenh)?.[1] || kenh;
    let items = (cell.items || []).map((it) => ({ ...it }));

    const igOptions = ['<option value="">— nhóm hàng —</option>']
        .concat(_itemGroups.map((g) => `<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)}</option>`)).join('');

    const body = html`
        <div class="kd-font-bold kd-mb-2">${label} · Tháng ${thang}/${_nam}</div>
        <label class="kd-w-full">Chỉ tiêu tháng (VND)
            <input type="number" id="kd-tg-total" class="kd-w-full" value="${cell.chi_tieu_thang ?? ''}"
                   style="padding:10px;border-radius:10px;border:1px solid var(--kd-border);margin-top:4px;">
        </label>
        <div class="kd-mt-3 kd-flex kd-items-center kd-justify-between">
            <span class="kd-font-bold">Chi tiết theo nhóm hàng (tuỳ chọn)</span>
            <button type="button" id="kd-tg-additem" class="kd-btn-primary" style="padding:4px 10px;"><i class="fas fa-plus"></i></button>
        </div>
        <div id="kd-tg-items" class="kd-mt-2"></div>
        <div id="kd-tg-warn" class="kd-text-sm" style="color:var(--kd-danger);font-weight:700;margin-top:6px;"></div>
    `;
    const footer = html`<button type="button" id="kd-tg-save" class="kd-btn-primary kd-w-full"><i class="fas fa-save"></i> Lưu</button>`;
    showModal({ title: 'Nhập chỉ tiêu', body, footer });

    const totalInput = document.getElementById('kd-tg-total');
    const itemsWrap = document.getElementById('kd-tg-items');
    const warn = document.getElementById('kd-tg-warn');
    const saveBtn = document.getElementById('kd-tg-save');

    function renderItems() {
        itemsWrap.innerHTML = items.map((it, i) => `
            <div class="kd-flex kd-items-center" style="gap:6px;margin-bottom:6px;">
                <select data-i="${i}" class="kd-tg-ig" style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--kd-border);">${igOptions}</select>
                <input type="number" data-i="${i}" class="kd-tg-amt" value="${it.chi_tieu ?? ''}" placeholder="VND" style="width:120px;padding:8px;border-radius:8px;border:1px solid var(--kd-border);">
                <button type="button" data-i="${i}" class="kd-tg-del kd-icon-btn" style="color:var(--kd-danger);"><i class="fas fa-trash"></i></button>
            </div>`).join('');
        items.forEach((it, i) => {
            const sel = itemsWrap.querySelector(`.kd-tg-ig[data-i="${i}"]`);
            if (sel) sel.value = it.item_group || '';
        });
        itemsWrap.querySelectorAll('.kd-tg-ig').forEach((el) => el.addEventListener('change', (e) => { items[Number(e.target.dataset.i)].item_group = e.target.value; validate(); }));
        itemsWrap.querySelectorAll('.kd-tg-amt').forEach((el) => el.addEventListener('input', (e) => { items[Number(e.target.dataset.i)].chi_tieu = Number(e.target.value) || 0; validate(); }));
        itemsWrap.querySelectorAll('.kd-tg-del').forEach((el) => el.addEventListener('click', (e) => { items.splice(Number(e.currentTarget.dataset.i), 1); renderItems(); validate(); }));
        validate();
    }

    function validate() {
        const total = Number(totalInput.value) || 0;
        if (items.length) {
            const sum = items.reduce((s, it) => s + (Number(it.chi_tieu) || 0), 0);
            if (Math.round(sum) !== Math.round(total)) {
                warn.textContent = `Tổng chi tiết ${formatNumber(sum)} ≠ chỉ tiêu tháng ${formatNumber(total)}`;
                saveBtn.disabled = true; saveBtn.style.opacity = 0.5;
                return;
            }
        }
        warn.textContent = '';
        saveBtn.disabled = false; saveBtn.style.opacity = 1;
    }

    document.getElementById('kd-tg-additem').addEventListener('click', () => { items.push({ item_group: '', chi_tieu: 0 }); renderItems(); });
    totalInput.addEventListener('input', validate);
    renderItems();

    saveBtn.addEventListener('click', async () => {
        const total = Number(totalInput.value) || 0;
        if (!total) { showToast('Nhập chỉ tiêu tháng', 'warning'); return; }
        const payload = {
            nam: _nam, thang, kenh,
            chi_tieu_thang: total,
            items: items.filter((it) => it.item_group),
        };
        saveBtn.disabled = true;
        try {
            await api.saveTarget(payload);
            closeModal();
            showToast('Đã lưu chỉ tiêu', 'success');
            load();
        } catch (err) {
            saveBtn.disabled = false;
            showToast('Lỗi lưu: ' + err.message, 'error');
        }
    });
}
