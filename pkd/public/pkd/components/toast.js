import { html } from '../lib/dom.js';
import { escapeHtml } from '../lib/format.js';

const ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

export function showToast(message, type = 'info', durationMs = 3500) {
    const root = document.getElementById('kd-toast-mount');
    if (!root) return;

    const el = document.createElement('div');
    el.className = `kd-toast kd-${type}`;
    el.innerHTML = html`<span>${ICONS[type] || ICONS.info}</span>&nbsp; ${escapeHtml(message)}`;
    root.appendChild(el);

    setTimeout(() => {
        el.style.animation = 'kdToastOut 0.25s ease forwards';
        setTimeout(() => el.remove(), 250);
    }, durationMs);
}

export const toast = {
    success: (m) => showToast(m, 'success'),
    error:   (m) => showToast(m, 'error'),
    warning: (m) => showToast(m, 'warning'),
    info:    (m) => showToast(m, 'info'),
};
