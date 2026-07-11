// Bản đồ choropleth doanh số Việt Nam — SVG thuần, không lib ngoài.
// Hình học: /assets/pkd/pkd/data/vn34.geo.json — 63 ranh giới cũ, mỗi shape gắn
// properties {n: tỉnh MỚI (34, sau sáp nhập 07/2025), o: tỉnh cũ}. Toạ độ đã
// phẳng (planar) → chỉ fit bbox + lật trục Y, không cần chiếu bản đồ.
// Dataviz: sequential 1 hue light→dark; chưa có DS = xám nền (ngoài thang);
// legend + tooltip hover; bảng tỉnh bên cạnh là secondary encoding (caller lo).

import { formatVNDShort, formatNumber, escapeHtml } from '../lib/format.js';

// 6 bậc xanh dương, lightness giảm dần đều (một hue duy nhất — luật sequential).
const SEQ = ['#eff6ff', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#1d4ed8'];
const NO_DATA = '#e2e8f0';

let _geoPromise = null;
function loadGeo() {
    if (!_geoPromise) {
        const v = (window.PKD_CONTEXT || {}).assetVersion || '1';
        _geoPromise = fetch(`/assets/pkd/pkd/data/vn34.geo.json?v=${encodeURIComponent(v)}`)
            .then((r) => { if (!r.ok) throw new Error('Không tải được dữ liệu bản đồ (' + r.status + ')'); return r.json(); })
            .catch((e) => { _geoPromise = null; throw e; });
    }
    return _geoPromise;
}

function eachPoint(geom, fn) {
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    polys.forEach((poly) => poly.forEach((ring) => ring.forEach(([x, y]) => fn(x, y))));
}

function pathD(geom, px, py) {
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    return polys.map((poly) => poly.map((ring) =>
        'M' + ring.map(([x, y]) => `${px(x)} ${py(y)}`).join('L') + 'Z').join('')).join('');
}

/** Vẽ bản đồ vào container. provinces: [{province, net, buyers, share_pct}] (tên MỚI 34). */
export async function renderVnMap(container, provinces) {
    const geo = await loadGeo();
    if (!container.isConnected) return;   // caller đã re-render trong lúc chờ fetch

    const val = {};
    (provinces || []).forEach((p) => { val[p.province] = p; });
    const max = Math.max(0, ...(provinces || []).map((p) => p.net || 0));
    const bin = (v) => {
        if (!max || !v || v <= 0) return -1;                       // ngoài thang
        return Math.min(SEQ.length - 1, Math.floor((v / max) * SEQ.length));
    };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    geo.features.forEach((f) => eachPoint(f.geometry, (x, y) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }));
    const W = 520;
    const k = W / (maxX - minX);
    const H = Math.round((maxY - minY) * k);
    const px = (x) => Math.round((x - minX) * k * 10) / 10;
    const py = (y) => Math.round((maxY - y) * k * 10) / 10;        // lật Y (bắc lên trên)

    const paths = geo.features.map((f, i) => {
        const n = f.properties.n, o = f.properties.o;
        const b = bin((val[n] || {}).net);
        return `<path d="${pathD(f.geometry, px, py)}" fill="${b < 0 ? NO_DATA : SEQ[b]}"
            data-i="${i}" data-n="${escapeHtml(n)}" data-o="${escapeHtml(o)}"></path>`;
    }).join('');

    // Legend quantize: mốc trên của từng bậc + ô "chưa có DS".
    const legend = max ? SEQ.map((c, i) =>
        `<span class="kd-vnmap-leg"><i style="background:${c};"></i>≤ ${formatVNDShort(max * (i + 1) / SEQ.length)}</span>`
    ).join('') + `<span class="kd-vnmap-leg"><i style="background:${NO_DATA};"></i>chưa có DS</span>` : '';

    container.innerHTML = `
        <div class="kd-vnmap-wrap">
            <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bản đồ doanh số theo tỉnh">${paths}</svg>
            <div class="kd-vnmap-tip" hidden></div>
        </div>
        <div class="kd-vnmap-legend">${legend}</div>`;

    // Tooltip hover (event delegation trong container — view re-render tự dọn).
    const wrap = container.querySelector('.kd-vnmap-wrap');
    const tip = container.querySelector('.kd-vnmap-tip');
    wrap.addEventListener('mousemove', (e) => {
        const t = e.target.closest('path[data-n]');
        if (!t) { tip.hidden = true; return; }
        const n = t.getAttribute('data-n'), o = t.getAttribute('data-o');
        const p = val[n];
        tip.innerHTML = `<b>${escapeHtml(n)}</b>${o !== n ? `<span class="kd-text-muted"> · phần ${escapeHtml(o)} cũ</span>` : ''}<br>
            Thực bán: <b>${p ? formatVNDShort(p.net) : '0'}</b>${p && p.share_pct != null ? ` (${p.share_pct.toFixed(1)}%)` : ''}<br>
            Khách mua: ${p ? formatNumber(p.buyers) : 0}`;
        tip.hidden = false;
        const r = wrap.getBoundingClientRect();
        const tx = Math.min(e.clientX - r.left + 12, r.width - 170);
        tip.style.left = Math.max(0, tx) + 'px';
        tip.style.top = (e.clientY - r.top + 12) + 'px';
    });
    wrap.addEventListener('mouseleave', () => { tip.hidden = true; });
}
