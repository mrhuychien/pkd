// Chart.js lazy-load 1 lần từ CDN + tiện ích destroy để tránh leak khi re-render.
// (Tập trung ở đây thay vì lặp trong từng view.)

let chartLib = null;

export function loadChartLib() {
    if (chartLib) return Promise.resolve(chartLib);
    return new Promise((resolve, reject) => {
        if (window.Chart) { chartLib = window.Chart; return resolve(chartLib); }
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js';
        s.onload  = () => { chartLib = window.Chart; resolve(chartLib); };
        s.onerror = () => reject(new Error('Không tải được Chart.js'));
        document.head.appendChild(s);
    });
}

/**
 * Tạo "registry" chart cục bộ cho 1 view. Gọi reg.destroy() ở đầu mỗi lần vẽ lại.
 *   const charts = chartRegistry();
 *   charts.destroy(); charts.add(new Chart(...));
 */
export function chartRegistry() {
    let list = [];
    return {
        add(c) { list.push(c); return c; },
        destroy() { list.forEach((c) => { try { c.destroy(); } catch {} }); list = []; },
    };
}
