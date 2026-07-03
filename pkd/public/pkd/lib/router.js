// Hash-based router with named routes, params, and query string support.
// Routes match the form: '/path/:param/...' against location.hash.

import { parseQuery } from './format.js';

const routes = [];     // { pattern: RegExp, paramNames: string[], handler }
let currentPath = null;
let onBeforeNavigate = null;

function compile(pattern) {
    const paramNames = [];
    const regexStr = pattern
        .replace(/\//g, '\\/')
        .replace(/:([^/]+)/g, (_, name) => { paramNames.push(name); return '([^/?]+)'; });
    return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

export function add(pattern, handler) {
    const { regex, paramNames } = compile(pattern);
    routes.push({ regex, paramNames, handler });
}

export function setBeforeNavigate(fn) {
    onBeforeNavigate = fn;
}

export function navigate(path, replace = false) {
    const target = path.startsWith('#') ? path : `#${path}`;
    if (replace) location.replace(target);
    else location.hash = target.slice(1);
}

function parseHash() {
    const raw = location.hash.slice(1) || '/';
    const [path, qs = ''] = raw.split('?');
    return { path: path || '/', query: parseQuery(qs) };
}

async function dispatch() {
    const { path, query } = parseHash();
    if (path === currentPath && !location.hash.includes('?')) {
        // pure hash repaint — skip
    }
    currentPath = path;

    for (const { regex, paramNames, handler } of routes) {
        const m = path.match(regex);
        if (!m) continue;
        const params = {};
        paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
        if (onBeforeNavigate) {
            try { await onBeforeNavigate({ path, params, query }); } catch (e) { console.error(e); }
        }
        try {
            await handler({ path, params, query });
        } catch (err) {
            console.error('Route handler error:', err);
        }
        return;
    }
    // No match → nhiều khả năng shell đang chạy BẢN CŨ (route mới thêm sau khi
    // trang được tải — deploy giữa phiên). Reload 1 lần để nạp shell mới; nếu
    // sau reload vẫn không match (route thật sự không tồn tại) → về '/'.
    const flag = 'kd_reload:' + path;
    try {
        if (!sessionStorage.getItem(flag)) {
            sessionStorage.setItem(flag, '1');
            location.reload();
            return;
        }
        sessionStorage.removeItem(flag);
    } catch (e) { /* sessionStorage bị chặn → bỏ qua */ }
    navigate('/', true);
}

export function start() {
    window.addEventListener('hashchange', dispatch);
    window.addEventListener('DOMContentLoaded', dispatch, { once: true });
    if (document.readyState !== 'loading') dispatch();
}

/** Re-dispatch route hiện tại (dùng cho nút Làm mới). */
export function reload() {
    currentPath = null;   // ép handler chạy lại
    return dispatch();
}

export function currentRoute() { return parseHash(); }
