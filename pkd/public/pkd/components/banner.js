import { html } from '../lib/dom.js';
import { escapeHtml } from '../lib/format.js';

/** Banner đầu mỗi view (không gồm header toàn cục). */
export function banner({ title, subtitle = '', accentText = '' }) {
    return html`
        <section class="kd-view-banner">
            <div>
                <h2 class="kd-view-banner-title">${escapeHtml(title)}</h2>
                ${subtitle ? html`<p class="kd-view-banner-subtitle">${escapeHtml(subtitle)}</p>` : ''}
            </div>
            ${accentText ? html`<span class="kd-view-banner-badge">${escapeHtml(accentText)}</span>` : ''}
        </section>
    `;
}
