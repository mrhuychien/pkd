// Quản trị người dùng portal — CHỈ Administrator (System Manager).
// Tạo user portal-only (Website User → Frappe chặn Desk từ tầng auth), gán cấp
// quyền Trưởng phòng / Quản lý kênh, phát hành QR đăng nhập 1 lần (quét là vào
// thẳng /kd, không cần mật khẩu lần đầu). Server guard mọi method — UI gate chỉ
// là tiện dụng.

import { html } from '../lib/dom.js';
import { escapeHtml, formatNumber } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';
import { pagedTable } from '../components/data-table.js';

let _levels = [{ key: 'truong_phong', label: 'Trưởng phòng' }, { key: 'quan_ly_kenh', label: 'Quản lý kênh' }];

export async function render({ container }) {
    if (!window.PKD_CONTEXT?.isAdmin) {
        container.innerHTML = html`<div class="kd-empty" style="min-height:50vh;">
            <div class="kd-empty-icon">🔒</div>
            <div class="kd-empty-title">Chỉ Administrator</div>
            <div class="kd-text-sm">Trang quản trị người dùng chỉ dành cho System Manager.</div></div>`;
        return;
    }

    container.innerHTML = html`
        ${banner({ title: 'Quản trị người dùng', subtitle: 'Tạo tài khoản portal · cấp quyền · QR đăng nhập ngay' })}

        <div class="kd-card">
            <h3 class="kd-font-bold kd-mb-2">➕ Tạo user portal mới</h3>
            <div class="kd-adm-form">
                <label>Họ tên * <input id="kd-adm-name" type="text" placeholder="Nguyễn Văn A" autocomplete="off"></label>
                <label>Số điện thoại * (dùng để đăng nhập) <input id="kd-adm-mobile" type="tel" placeholder="09xxxxxxxx" autocomplete="off"></label>
                <label>Cấp quyền <select id="kd-adm-level">
                    ${_levels.map((l) => `<option value="${l.key}">${escapeHtml(l.label)}</option>`).join('')}
                </select></label>
                <label>Mật khẩu (bỏ trống = tự sinh) <input id="kd-adm-pass" type="text" placeholder="tự sinh 10 ký tự" autocomplete="off"></label>
                <label>Email (tuỳ chọn) <input id="kd-adm-email" type="email" placeholder="không bắt buộc" autocomplete="off"></label>
            </div>
            <div class="kd-text-sm kd-text-muted kd-mt-2">
                • Người dùng đăng nhập bằng <b>SỐ ĐIỆN THOẠI + mật khẩu</b> tại trang /login (email không cần).<br>
                • User chỉ vào được <b>portal /kd</b> — Desk/ERPNext bị chặn hẳn (Website User).<br>
                • <b>Trưởng phòng</b>: toàn quyền portal, kể cả sửa chỉ tiêu. <b>Quản lý kênh</b>: xem toàn bộ, <u>không sửa chỉ tiêu</u>.<br>
                • Sau khi tạo sẽ hiện <b>mật khẩu (1 lần)</b> + <b>mã QR vào ngay</b> (1 lần, hạn 7 ngày).
            </div>
            <button class="kd-btn kd-btn-primary kd-mt-3" id="kd-adm-create">Tạo user + QR</button>
        </div>

        <div id="kd-adm-result"></div>

        <div class="kd-card kd-mt-3">
            <h3 class="kd-font-bold kd-mb-2">Danh sách user portal</h3>
            <div id="kd-adm-list"><div class="kd-skeleton" style="height:160px;"></div></div>
        </div>
    `;

    document.getElementById('kd-adm-create').addEventListener('click', onCreate);
    // Delegation trên #kd-adm-list (node TẠO MỚI mỗi render) — KHÔNG gắn vào
    // container (#kd-view được router tái sử dụng → listener tích tụ, 1 click bắn N lần).
    document.getElementById('kd-adm-list').addEventListener('click', onListAction);
    await loadList();
}

async function loadList() {
    const root = document.getElementById('kd-adm-list');
    if (!root) return;
    try {
        const d = await api.admin.listUsers();
        if (d.levels?.length) _levels = d.levels;
        const rows = d.users || [];
        root.innerHTML = pagedTable({
            columns: [
                { key: 'full_name', label: 'Họ tên', render: (r) =>
                    `<b>${escapeHtml(r.full_name || r.user)}</b><br><span class="kd-text-sm kd-text-muted">${r.mobile_no ? `📱 ${escapeHtml(r.mobile_no)} · ` : ''}${escapeHtml(r.user)}</span>` },
                { key: 'level_label', label: 'Cấp quyền', render: (r) =>
                    `<span class="kd-badge ${r.level === 'truong_phong' ? 'kd-badge-success' : 'kd-badge-warning'}">${escapeHtml(r.level_label)}</span>` },
                { key: 'enabled', label: 'Trạng thái', render: (r) =>
                    r.enabled ? '<span class="kd-badge kd-badge-success">Hoạt động</span>' : '<span class="kd-badge kd-badge-danger">Đã khoá</span>' },
                { key: 'last_active', label: 'Hoạt động cuối', render: (r) => escapeHtml(r.last_active || '—') },
                { key: 'user', label: '', render: (r) => `
                    <button class="kd-btn kd-btn-sm" data-adm-qr="${escapeHtml(r.user)}">QR mới</button>
                    <button class="kd-btn kd-btn-sm" data-adm-toggle="${escapeHtml(r.user)}" data-to="${r.enabled ? 0 : 1}">${r.enabled ? 'Khoá' : 'Mở'}</button>` },
            ],
            rows,
            emptyMessage: 'Chưa có user portal nào — tạo user đầu tiên ở form trên',
        });
    } catch (err) {
        root.innerHTML = `<div class="kd-text-muted">Lỗi tải danh sách: ${escapeHtml(err.message)}</div>`;
    }
}

async function onCreate() {
    const btn = document.getElementById('kd-adm-create');
    const name = document.getElementById('kd-adm-name').value.trim();
    const mobile = document.getElementById('kd-adm-mobile').value.trim();
    const email = document.getElementById('kd-adm-email').value.trim();
    const pass = document.getElementById('kd-adm-pass').value.trim();
    const level = document.getElementById('kd-adm-level').value;
    if (!name || !mobile) { showToast('Bắt buộc nhập Họ tên + Số điện thoại', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Đang tạo...';
    try {
        const r = await api.admin.createUser(name, mobile, level, email || null, pass || null);
        showToast(`Đã tạo tài khoản cho ${r.mobile}`, 'success');
        ['kd-adm-email', 'kd-adm-name', 'kd-adm-mobile', 'kd-adm-pass'].forEach((id) => { document.getElementById(id).value = ''; });
        await showQrPanel(r, 'Tạo user thành công');
        await loadList();
    } catch (err) {
        showToast('Lỗi: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Tạo user + QR';
    }
}

async function onListAction(e) {
    const qrBtn = e.target.closest('[data-adm-qr]');
    if (qrBtn) {
        qrBtn.disabled = true;
        try {
            const r = await api.admin.renewQr(qrBtn.getAttribute('data-adm-qr'));
            await showQrPanel(r, 'QR đăng nhập mới');
        } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
        qrBtn.disabled = false;
        return;
    }
    const tg = e.target.closest('[data-adm-toggle]');
    if (tg) {
        tg.disabled = true;
        try {
            const r = await api.admin.setEnabled(tg.getAttribute('data-adm-toggle'), tg.getAttribute('data-to'));
            showToast(r.enabled ? 'Đã mở lại tài khoản' : 'Đã khoá tài khoản', 'success');
            await loadList();
        } catch (err) { showToast('Lỗi: ' + err.message, 'error'); tg.disabled = false; }
    }
}

async function showQrPanel(r, title) {
    const root = document.getElementById('kd-adm-result');
    if (!root) return;
    const creds = r.password ? `
        <div class="kd-mt-2" style="background:var(--kd-bg);border:1px dashed var(--kd-border);border-radius:10px;padding:10px 12px;">
            <div class="kd-font-bold kd-text-sm">🔑 Đăng nhập thủ công (trang /login):</div>
            <div class="kd-text-sm kd-mt-2">Số điện thoại: <b>${escapeHtml(r.mobile || '')}</b> · Mật khẩu:
                <code id="kd-adm-pw" style="font-weight:800;">${escapeHtml(r.password)}</code>
                <button class="kd-btn-sm" id="kd-adm-copy-pw" style="margin-left:6px;">📋 Copy</button></div>
            <div class="kd-text-sm kd-text-muted kd-mt-2">Mật khẩu chỉ hiện <b>1 lần này</b> — lưu lại trước khi rời trang. Người dùng có thể đổi qua "Quên mật khẩu".</div>
        </div>` : '';
    root.innerHTML = html`
        <div class="kd-card kd-mt-3" style="border-left:4px solid var(--kd-success);">
            <h3 class="kd-font-bold">✅ ${escapeHtml(title)}: ${escapeHtml(r.full_name || r.user)}</h3>
            <div class="kd-text-sm kd-text-muted">${r.mobile ? `📱 ${escapeHtml(r.mobile)} · ` : ''}${escapeHtml(r.user)}${r.level_label ? ` · ${escapeHtml(r.level_label)}` : ''}</div>
            ${creds}
            <div class="kd-adm-qrwrap kd-mt-3">
                <div id="kd-adm-qr" class="kd-adm-qr"></div>
                <div>
                    <div class="kd-font-bold kd-text-sm kd-mb-2">📱 Đưa người dùng quét mã này bằng camera điện thoại — vào thẳng dashboard, không cần mật khẩu.</div>
                    <div class="kd-text-sm kd-text-muted">Mã dùng <b>1 lần</b>, hạn <b>${formatNumber(r.expires_days || 7)} ngày</b>. Hết hạn/đã dùng → bấm "QR mới" ở danh sách dưới.
                        Sau lần đầu, người dùng đặt mật khẩu qua "Quên mật khẩu" trên trang đăng nhập nếu muốn tự đăng nhập lại.</div>
                    <div class="kd-mt-2" style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="kd-btn kd-btn-sm" id="kd-adm-copy">📋 Copy link</button>
                    </div>
                    <div class="kd-text-sm kd-mt-2" style="word-break:break-all;"><code id="kd-adm-url">${escapeHtml(r.quick_url)}</code></div>
                </div>
            </div>
        </div>`;
    document.getElementById('kd-adm-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(r.quick_url); showToast('Đã copy link đăng nhập', 'success'); }
        catch { showToast('Không copy được — chọn tay đoạn link bên dưới', 'error'); }
    });
    document.getElementById('kd-adm-copy-pw')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(`SĐT: ${r.mobile} · Mật khẩu: ${r.password}`);
            showToast('Đã copy SĐT + mật khẩu', 'success');
        } catch { showToast('Không copy được — ghi tay lại', 'error'); }
    });
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await drawQr(document.getElementById('kd-adm-qr'), r.quick_url);
}

// QR: lazy-load qrcodejs từ CDN (giống Chart.js). CDN nghẽn → vẫn còn link + copy.
let _qrLib = null;
function loadQrLib() {
    if (window.QRCode) return Promise.resolve(window.QRCode);
    if (_qrLib) return _qrLib;
    _qrLib = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
        s.onload = () => resolve(window.QRCode);
        s.onerror = () => { _qrLib = null; reject(new Error('Không tải được thư viện QR')); };
        document.head.appendChild(s);
    });
    return _qrLib;
}

async function drawQr(el, text) {
    if (!el) return;
    try {
        const QRCode = await loadQrLib();
        el.innerHTML = '';
        new QRCode(el, { text, width: 220, height: 220, correctLevel: QRCode.CorrectLevel ? QRCode.CorrectLevel.M : undefined });
    } catch {
        el.innerHTML = '<div class="kd-text-sm kd-text-muted" style="max-width:220px;">Không vẽ được QR (mạng chặn CDN) — dùng nút Copy link gửi cho người dùng.</div>';
    }
}
