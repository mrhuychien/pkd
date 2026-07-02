const mount = () => document.getElementById('kd-loading-mount');
const text  = () => mount()?.querySelector('.kd-loading-text');

export function showLoading(message = 'Đang xử lý...') {
    const m = mount(); if (!m) return;
    text().textContent = message;
    m.hidden = false;
}

export function hideLoading() {
    const m = mount(); if (!m) return;
    m.hidden = true;
}
