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
    // No match → fallback to '/'
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
