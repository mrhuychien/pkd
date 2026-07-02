import { html } from '../lib/dom.js';
import { escapeHtml } from '../lib/format.js';

export function emptyState({ icon = '📭', title = 'Không có dữ liệu', message = '' } = {}) {
    return html`
        <div class="kd-empty">
            <div class="kd-empty-icon">${icon}</div>
            <div class="kd-empty-title">${escapeHtml(title)}</div>
            ${message ? html`<div class="kd-text-sm">${escapeHtml(message)}</div>` : ''}
        </div>
    `;
}
