import { html } from '../lib/dom.js';
import { escapeHtml } from '../lib/format.js';
import { emptyState } from './empty-state.js';

/**
 * @param {object} opts
 * @param {Array<{key, label, render?}>} opts.columns
 * @param {Array<object>}                opts.rows
 * @param {function?}                    opts.onRowClick
 * @param {string?}                      opts.emptyMessage
 */
export function dataTable({ columns, rows, onRowClick, emptyMessage = 'Không có dữ liệu', rowStyle = null }) {
    if (!rows || rows.length === 0) {
        return emptyState({ icon: '📭', title: emptyMessage });
    }
    const renderCell = (col, row) => col.render ? col.render(row) : escapeHtml(row[col.key] ?? '');
    const clickable  = onRowClick ? 'kd-table-row-clickable' : '';
    // rowStyle(row) → chuỗi inline-style (đã kiểm soát, không phải dữ liệu người dùng).
    return html`
        <table class="kd-table">
            <thead>
                <tr>${columns.map((c) => html`<th>${escapeHtml(c.label)}</th>`).join('')}</tr>
            </thead>
            <tbody>
                ${rows.map((row, i) => html`
                    <tr class="${clickable}" data-row-index="${i}"${rowStyle ? ` style="${rowStyle(row)}"` : ''}>
                        ${columns.map((c) => html`<td data-label="${escapeHtml(c.label)}">${renderCell(c, row)}</td>`).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

/** Gắn click sau khi render (container + rows + handler). */
export function bindTableClicks(container, rows, handler) {
    container.querySelectorAll('.kd-table-row-clickable').forEach((tr) => {
        tr.addEventListener('click', () => {
            const i = Number(tr.dataset.rowIndex);
            if (!isNaN(i)) handler(rows[i]);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// PHÂN TRANG dùng chung — mặc định 10 dòng/trang.
// paged() trả về CHUỖI HTML nên nhúng được vào mọi template; trạng thái giữ
// trong registry, nút ‹ › điều khiển qua event-delegation cấp document (bind
// 1 lần khi module nạp) nên hoạt động cả khi bảng nằm sâu trong innerHTML.
// ═══════════════════════════════════════════════════════════════════════
const PT_REG = new Map();
let ptSeq = 0;

function ptPager(id, st) {
    const totalPages = Math.max(1, Math.ceil(st.rows.length / st.pageSize));
    if (totalPages <= 1) return '';
    return `<div class="kd-pager">
        <button type="button" class="kd-pager-btn" data-pt-prev="${id}" ${st.page <= 0 ? 'disabled' : ''}>‹ Trước</button>
        <span class="kd-pager-info">Trang ${st.page + 1}/${totalPages} · ${st.rows.length} dòng</span>
        <button type="button" class="kd-pager-btn" data-pt-next="${id}" ${st.page >= totalPages - 1 ? 'disabled' : ''}>Sau ›</button>
    </div>`;
}

function ptInner(id) {
    const st = PT_REG.get(id);
    if (!st) return '';
    const start = st.page * st.pageSize;
    const slice = st.rows.slice(start, start + st.pageSize);
    return st.render(slice, start) + ptPager(id, st);
}

function ptDraw(id) {
    const el = document.querySelector(`[data-pt="${id}"]`);
    const st = PT_REG.get(id);
    if (!el || !st) return;
    el.innerHTML = ptInner(id);
    if (st.onDraw) { try { st.onDraw(el); } catch (e) { console.error(e); } }
}

/**
 * Bọc 1 khối render theo trang (mặc định 10 dòng/trang).
 * @param {Array}    opts.rows      toàn bộ dòng
 * @param {function} opts.render    (slice, startIndex) => chuỗi HTML của bảng
 * @param {number?}  opts.pageSize  mặc định 10
 * @param {function?} opts.onDraw   (wrapperEl) => void — re-bind event sau mỗi lần vẽ
 * @returns chuỗi HTML (nhúng vào template bất kỳ)
 */
export function paged({ rows, render, pageSize = 10, onDraw = null }) {
    const id = 'pt' + (++ptSeq);
    // Registry chỉ giữ các bảng gần nhất — bảng cũ đã bị thay DOM thì bỏ.
    if (PT_REG.size > 200) {
        const oldest = PT_REG.keys().next().value;
        PT_REG.delete(oldest);
    }
    const st = { rows: rows || [], render, pageSize: Math.max(1, pageSize), page: 0, onDraw };
    PT_REG.set(id, st);
    // onDraw của trang ĐẦU: chạy sau khi chuỗi được gắn vào DOM (microtask đủ muộn
    // vì caller gán innerHTML đồng bộ ngay sau khi build chuỗi).
    if (onDraw) {
        setTimeout(() => {
            const el = document.querySelector(`[data-pt="${id}"]`);
            if (el) { try { onDraw(el); } catch (e) { console.error(e); } }
        }, 0);
    }
    return `<div class="kd-paged" data-pt="${id}">${ptInner(id)}</div>`;
}

/** dataTable có phân trang sẵn (10 dòng/trang). Cùng tham số dataTable + pageSize. */
export function pagedTable({ columns, rows, emptyMessage = 'Không có dữ liệu', pageSize = 10, onDraw = null, rowStyle = null }) {
    if (!rows || rows.length === 0) {
        return emptyState({ icon: '📭', title: emptyMessage });
    }
    return paged({
        rows, pageSize, onDraw,
        render: (slice) => dataTable({ columns, rows: slice, emptyMessage, rowStyle }),
    });
}

// Event delegation cho nút chuyển trang — bind 1 lần khi module nạp.
document.addEventListener('click', (e) => {
    const prev = e.target.closest('[data-pt-prev]');
    const next = e.target.closest('[data-pt-next]');
    if (!prev && !next) return;
    const id = prev ? prev.dataset.ptPrev : next.dataset.ptNext;
    const st = PT_REG.get(id);
    if (!st) return;
    const totalPages = Math.max(1, Math.ceil(st.rows.length / st.pageSize));
    st.page = Math.min(Math.max(0, st.page + (prev ? -1 : 1)), totalPages - 1);
    ptDraw(id);
});
