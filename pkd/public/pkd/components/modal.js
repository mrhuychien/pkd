import { html } from '../lib/dom.js';

let closeHandler = null;

export function showModal({ title, body, footer = '' }) {
    const root = document.getElementById('kd-modal-mount');
    if (!root) return;
    root.innerHTML = html`
        <div class="kd-modal-content" role="dialog" aria-modal="true">
            <div class="kd-modal-header kd-flex kd-items-center kd-justify-between">
                <h3 class="kd-text-lg kd-font-bold">${title}</h3>
                <button class="kd-icon-btn" id="kd-modal-close" type="button" aria-label="Đóng">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="kd-modal-body kd-mt-3">${body}</div>
            ${footer ? html`<div class="kd-modal-footer kd-mt-4">${footer}</div>` : ''}
        </div>
    `;
    root.classList.add('kd-show');
    document.getElementById('kd-modal-close').onclick = closeModal;
    root.onclick = (e) => { if (e.target === root) closeModal(); };
}

export function setModalCloseHandler(fn) { closeHandler = fn; }

export function closeModal() {
    const root = document.getElementById('kd-modal-mount');
    if (!root) return;
    root.classList.remove('kd-show');
    root.innerHTML = '';
    if (closeHandler) { try { closeHandler(); } catch {} closeHandler = null; }
}
