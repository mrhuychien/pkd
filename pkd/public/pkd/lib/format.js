// Pure utility helpers. No side effects, no DOM.

const VND = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

export function formatNumber(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    return VND.format(Math.round(Number(n)));
}

export function formatCurrency(n) {
    return formatNumber(n) + ' ₫';
}

/** Rút gọn tiền VND cho thẻ lớn: 1.600.000.000 → "1,6 tỷ"; 33.000.000 → "33 tr". */
export function formatVNDShort(n) {
    n = Number(n) || 0;
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace('.', ',') + ' tỷ';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',') + ' tr';
    return formatNumber(n) + ' ₫';
}

export function formatDate(input) {
    if (!input) return '-';
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return String(input);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(input) {
    if (!input) return '-';
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return String(input);
    return d.toLocaleString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

export function todayISO() {
    const d = new Date();
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
    ].join('-');
}

export function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = String(s ?? '');
    return div.innerHTML;
}

export function debounce(fn, wait = 300) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

export function parseQuery(qs) {
    const out = {};
    if (!qs) return out;
    const s = qs.startsWith('?') ? qs.slice(1) : qs;
    for (const pair of s.split('&')) {
        if (!pair) continue;
        const [k, v = ''] = pair.split('=');
        out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
    return out;
}

export function stringifyQuery(obj) {
    const parts = [];
    for (const [k, v] of Object.entries(obj || {})) {
        if (v === null || v === undefined || v === '') continue;
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    }
    return parts.length ? '?' + parts.join('&') : '';
}
