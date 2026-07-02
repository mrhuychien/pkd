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
export function dataTable({ columns, rows, onRowClick, emptyMessage = 'Không có dữ liệu' }) {
    if (!rows || rows.length === 0) {
        return emptyState({ icon: '📭', title: emptyMessage });
    }
    const renderCell = (col, row) => col.render ? col.render(row) : escapeHtml(row[col.key] ?? '');
    const clickable  = onRowClick ? 'kd-table-row-clickable' : '';
    return html`
        <table class="kd-table">
            <thead>
                <tr>${columns.map((c) => html`<th>${escapeHtml(c.label)}</th>`).join('')}</tr>
            </thead>
            <tbody>
                ${rows.map((row, i) => html`
                    <tr class="${clickable}" data-row-index="${i}">
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
