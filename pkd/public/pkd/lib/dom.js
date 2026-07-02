// Tiny DOM/template helpers. No virtual DOM, no diffing — just template literals
// + targeted element manipulation. For SPA-grade UX without React weight.

import { escapeHtml } from './format.js';

/**
 * `html` is a tagged template literal that returns the same string Node.innerHTML
 * would parse. It exists purely as a marker for editor highlighting.
 *
 * Values are NOT escaped automatically. Escape user data via `escapeHtml(...)`.
 *
 * Usage:
 *   const name = "<script>";
 *   container.innerHTML = html`<h1>Hello, ${escapeHtml(name)}!</h1>`;
 */
export function html(strings, ...values) {
    let out = '';
    strings.forEach((str, i) => {
        out += str;
        if (i < values.length) {
            const v = values[i];
            if (Array.isArray(v)) out += v.join('');
            else if (v === null || v === undefined) out += '';
            else out += String(v);
        }
    });
    return out;
}

/** Mount HTML string into a container element. Returns the container. */
export function mount(container, htmlStr) {
    container.innerHTML = htmlStr;
    return container;
}

/** Delegate event listener attached to `root`, fired only on `selector` matches. */
export function on(root, eventType, selector, handler) {
    root.addEventListener(eventType, (e) => {
        const target = e.target.closest(selector);
        if (target && root.contains(target)) {
            handler.call(target, e, target);
        }
    });
}

/** Query helpers scoped to a root (defaults to document). */
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
