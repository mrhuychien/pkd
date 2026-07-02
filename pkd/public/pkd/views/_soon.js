import { html } from '../lib/dom.js';

/** Placeholder cho route chưa build ở phase hiện tại. */
export async function render({ container, title }) {
    container.innerHTML = html`
        <div class="kd-empty" style="min-height:55vh;">
            <div class="kd-empty-icon">🚧</div>
            <div class="kd-empty-title">${title || 'Màn hình'} — đang phát triển</div>
            <div class="kd-text-sm">Chức năng này sẽ có trong phase kế tiếp.</div>
        </div>`;
}
