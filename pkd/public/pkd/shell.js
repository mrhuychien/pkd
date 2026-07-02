import * as router from './lib/router.js';
import { showToast } from './components/toast.js';
import { initSeason, openSeasonPicker } from './components/season-picker.js';
import { highlightActiveRoute } from './components/bottom-nav.js';
import * as store from './lib/store.js';

// ─── 1. Sanity check ───────────────────────────────────────────────────
if (!window.PKD_CONTEXT) {
    console.error('[PKD] window.PKD_CONTEXT missing — check www/kd.html');
}

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
    '/npp'      : () => import(withV('./views/_soon.js')),   // P1
    '/mt'       : () => import(withV('./views/_soon.js')),   // P1
    '/dulich'   : () => import(withV('./views/_soon.js')),   // P1
    '/them'     : () => import(withV('./views/them.js')),
    '/trungbay' : () => import(withV('./views/_soon.js')),   // P2
    '/tet'      : () => import(withV('./views/_soon.js')),   // P2
    '/chitieu'  : () => import(withV('./views/chitieu.js')),
    '/khampha'  : () => import(withV('./views/khampha.js')),
    '/khach'    : () => import(withV('./views/_soon.js')),   // P2
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

// ─── 6. Routes ─────────────────────────────────────────────────────────
const simple = ['/', '/npp', '/mt', '/dulich', '/them', '/trungbay', '/tet', '/chitieu', '/khampha'];
simple.forEach((r) => {
    router.add(r, ({ query }) => { highlightActiveRoute(r); return renderRoute(r, { query }); });
});
// Drill-down khách (mở từ mọi bảng/queue).
router.add('/khach/:id', ({ params, query }) => { highlightActiveRoute('/khach'); return renderRoute('/khach', { params, query }); });

// ─── 7. Header title + back button sync ────────────────────────────────
router.setBeforeNavigate(({ path }) => {
    const seg = '/' + (path.split('/')[1] || '');
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
window.PKD = { store, router, showToast };
