import * as router from './lib/router.js';
import { showToast } from './components/toast.js';
import { initSeason, openSeasonPicker } from './components/season-picker.js';
import { highlightActiveRoute } from './components/bottom-nav.js';
import * as store from './lib/store.js';

// Dấu vết build — đổi mỗi lần sửa shell/routes. Gõ `PKD.build` trong Console
// để biết trình duyệt đang chạy bản nào (chẩn đoán shell cũ/mới tức thì).
const BUILD = 'adm-r4';

// ─── 1. Sanity check ───────────────────────────────────────────────────
if (!window.PKD_CONTEXT) {
    console.error('[PKD] window.PKD_CONTEXT missing — check www/kd.html');
}
console.log(`[PKD] shell build=${BUILD} · assetVersion=${window.PKD_CONTEXT?.assetVersion || '?'} · routes QLK: có`);

// ─── 2. Season ─────────────────────────────────────────────────────────
initSeason();
document.getElementById('kd-btn-season')?.addEventListener('click', openSeasonPicker);

// ─── 3. Header refresh button ─────────────────────────────────────────
document.getElementById('kd-btn-refresh')?.addEventListener('click', () => {
    store.invalidate();                       // xoá cache client → tải lại số liệu
    window.dispatchEvent(new CustomEvent('kd:refresh'));
    router.reload();                          // vẽ lại route hiện tại
    showToast('Đã làm mới dữ liệu', 'info');
});

// ─── 4. Header back button ────────────────────────────────────────────
document.getElementById('kd-btn-back')?.addEventListener('click', () => {
    history.length > 1 ? history.back() : router.navigate('/');
});

// ─── 5. Lazy-load views (code-split per route, cache-bust bằng assetVersion) ─
const ASSET_V = encodeURIComponent(window.PKD_CONTEXT?.assetVersion || '');
const withV = (path) => (ASSET_V ? `${path}?v=${ASSET_V}` : path);
const VIEW_MODULES = {
    '/'         : () => import(withV('./views/tongquan.js')),
    '/npp'      : () => import(withV('./views/npp.js')),
    '/mt'       : () => import(withV('./views/mt.js')),
    '/dulich'   : () => import(withV('./views/dulich.js')),
    '/them'     : () => import(withV('./views/them.js')),
    '/trungbay' : () => import(withV('./views/trungbay.js')),
    '/tet'      : () => import(withV('./views/tet.js')),
    '/chitieu'  : () => import(withV('./views/chitieu.js')),
    '/khampha'  : () => import(withV('./views/khampha.js')),
    '/khach'    : () => import(withV('./views/khach.js')),
    // Bộ "Quản lý kênh" (port từ app npp) — kênh chọn qua ?k=npp|mt|dulich
    '/ql-ov'    : () => import(withV('./views/ql-tongquan.js')),
    '/ql-sp'    : () => import(withV('./views/ql-sanpham.js')),
    '/ql-khach' : () => import(withV('./views/ql-khach.js')),
    '/ql-target': () => import(withV('./views/ql-target.js')),
    '/ql-alert' : () => import(withV('./views/ql-alert.js')),
    '/ql-debt'  : () => import(withV('./views/ql-debt.js')),
    '/ql-ds'    : () => import(withV('./views/ql-ds.js')),
    // Quản trị người dùng (chỉ Administrator — server vẫn guard mọi method)
    '/quan-tri' : () => import(withV('./views/quantri.js')),
};

const TITLES = {
    '/'         : 'Tổng quan',
    '/npp'      : 'Kênh NPP',
    '/mt'       : 'Kênh MT',
    '/dulich'   : 'Kênh Du lịch',
    '/them'     : 'Thêm',
    '/trungbay' : 'Trưng bày',
    '/tet'      : 'Theo dõi Tết',
    '/chitieu'  : 'Chỉ tiêu',
    '/khampha'  : 'Khám phá',
    '/khach'    : 'Chi tiết khách',
    '/ql-ov'    : 'Quản lý kênh',
    '/ql-sp'    : 'QL · Sản phẩm',
    '/ql-khach' : 'QL · Chi tiết KH',
    '/ql-target': 'QL · Mục tiêu',
    '/ql-alert' : 'QL · Cần xử lý',
    '/ql-debt'  : 'QL · Công nợ',
    '/ql-ds'    : 'QL · DS tháng',
    '/quan-tri' : 'Quản trị người dùng',
};

async function renderRoute(routeKey, ctx) {
    const viewEl = document.getElementById('kd-view');
    viewEl.innerHTML = '<div class="kd-skeleton" style="height:200px;"></div>';
    try {
        const loader = VIEW_MODULES[routeKey];
        if (!loader) throw new Error(`Không có view cho ${routeKey}`);
        const mod = await loader();
        if (typeof mod.render !== 'function') throw new Error(`View ${routeKey} thiếu render()`);
        await mod.render({ container: viewEl, title: TITLES[routeKey] || 'PKD', route: routeKey, ...ctx });
    } catch (err) {
        console.error(err);
        viewEl.innerHTML = `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div>
            <div class="kd-empty-title">Lỗi tải trang</div>
            <div class="kd-text-sm">${err.message}</div></div>`;
    }
}

// ─── 5b. Desktop nav ngang (8 mục; CSS ẩn trên mobile) ─────────────────
const DESK_NAV = [
    ['/', '🏠 Tổng quan'], ['/npp', '📦 NPP'], ['/mt', '🏬 MT'], ['/dulich', '🧳 Du lịch'],
    ['/ql-ov', '🛠 Quản lý kênh'],
    ['/trungbay', '🎁 Trưng bày'], ['/tet', '🧧 Tết'], ['/chitieu', '🎯 Chỉ tiêu'], ['/khampha', '🔍 Khám phá'],
];
if (window.PKD_CONTEXT?.isAdmin) DESK_NAV.push(['/quan-tri', '👤 Người dùng']);
(function buildDesktopNav() {
    const app = document.getElementById('kd-app');
    const main = document.getElementById('kd-view');
    if (!app || !main) return;
    const nav = document.createElement('nav');
    nav.className = 'kd-desktop-nav';
    nav.id = 'kd-desktop-nav';
    nav.innerHTML = DESK_NAV.map(([r, l]) => `<a href="#${r}" data-route="${r}">${l}</a>`).join('');
    main.parentNode.insertBefore(nav, main);
})();
function highlightDesktopNav(path) {
    let seg = '/' + (path.split('/')[1] || '');
    if (seg.startsWith('/ql-')) seg = '/ql-ov';   // mọi tab QLK sáng mục "Quản lý kênh"
    document.querySelectorAll('#kd-desktop-nav a').forEach((a) => {
        a.classList.toggle('kd-active', a.dataset.route === seg);
    });
}

// ─── 6. Routes ─────────────────────────────────────────────────────────
const simple = ['/', '/npp', '/mt', '/dulich', '/them', '/trungbay', '/tet', '/chitieu', '/khampha',
                '/ql-ov', '/ql-sp', '/ql-khach', '/ql-target', '/ql-alert', '/ql-debt', '/ql-ds', '/quan-tri'];
simple.forEach((r) => {
    router.add(r, ({ query }) => { highlightActiveRoute(r); return renderRoute(r, { query }); });
});
// Drill-down khách (mở từ mọi bảng/queue).
router.add('/khach/:id', ({ params, query }) => { highlightActiveRoute('/khach'); return renderRoute('/khach', { params, query }); });

// ─── 7. Header title + back button sync ────────────────────────────────
router.setBeforeNavigate(({ path }) => {
    const seg = '/' + (path.split('/')[1] || '');
    highlightDesktopNav(path);
    document.getElementById('kd-header-title').textContent = TITLES[seg] || 'PKD';
    const isDetail = path !== '/' && path.split('/').length > 2;
    const backBtn  = document.getElementById('kd-btn-back');
    if (backBtn) backBtn.hidden = !isDetail;
});

// ─── 8. Tài khoản / Đăng xuất ──────────────────────────────────────────
(function setupAccount() {
    const actions = document.querySelector('.kd-header-actions');
    if (!actions || document.getElementById('kd-btn-account')) return;
    const ctx = window.PKD_CONTEXT || {};
    const esc = (s) => { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; };

    const btn = document.createElement('button');
    btn.id = 'kd-btn-account';
    btn.className = 'kd-icon-btn';
    btn.type = 'button';
    btn.title = 'Tài khoản';
    btn.setAttribute('aria-label', 'Tài khoản');
    btn.innerHTML = '<i class="fas fa-circle-user"></i>';
    actions.appendChild(btn);

    const menu = document.createElement('div');
    menu.id = 'kd-account-menu';
    menu.className = 'kd-acct-menu';
    menu.hidden = true;
    menu.innerHTML = `
        <div class="kd-acct-name"><i class="fas fa-user"></i> ${esc(ctx.userFullName || ctx.user)}</div>
        <button type="button" id="kd-acct-logout" class="kd-acct-logout"><i class="fas fa-right-from-bracket"></i> Đăng xuất</button>`;
    document.body.appendChild(menu);

    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', (e) => { if (!menu.hidden && e.target !== btn && !menu.contains(e.target)) menu.hidden = true; });
    menu.querySelector('#kd-acct-logout').addEventListener('click', () => {
        try {
            if (window.frappe?.call) { window.frappe.call({ method: 'logout', callback: () => { location.href = '/login'; } }); return; }
        } catch (e) { /* ignore */ }
        location.href = '/api/method/logout';
    });
})();

// ─── 9. Start ──────────────────────────────────────────────────────────
router.start();
window.PKD = { store, router, showToast, build: BUILD };
