// Highlight tab đang active trong bottom-nav (mobile) theo segment đầu của route.
// '/them' active khi ở bất kỳ route thuộc menu "Thêm".
const MORE_ROUTES = new Set(['/trungbay', '/tet', '/chitieu', '/khampha']);

export function highlightActiveRoute(path) {
    const items = document.querySelectorAll('.kd-nav-item');
    const seg = '/' + (path.split('/')[1] || '');
    items.forEach((el) => {
        const r = el.dataset.route;
        let active = r === seg || (seg === '/' && r === '/');
        if (r === '/them' && MORE_ROUTES.has(seg)) active = true;
        el.classList.toggle('kd-active', active);
    });
}
