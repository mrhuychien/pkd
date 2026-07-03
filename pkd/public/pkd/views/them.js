import { html } from '../lib/dom.js';
import { banner } from '../components/banner.js';

export async function render({ container }) {
    const items = [
        ['#/ql-ov?k=npp', '🛠', 'Quản lý kênh', 'Bộ phân tích sâu NPP · MT · Du lịch (tổng quan, sản phẩm, mục tiêu, công nợ...)'],
        ['#/khampha', '🔍', 'Khám phá', 'Bóc tách doanh số/sản lượng linh hoạt + tải CSV'],
        ['#/chitieu', '🎯', 'Chỉ tiêu', 'Ma trận 12 tháng × 3 kênh, nhập ngay tại đây'],
        ['#/trungbay', '🎁', 'Trưng bày', 'Chương trình trưng bày (đọc từ salep)'],
        ['#/tet', '🧧', 'Tết', 'Theo dõi doanh số mùa Tết theo mốc D-N'],
    ];
    container.innerHTML = html`
        ${banner({ title: 'Thêm', subtitle: 'Các chuyên đề khác' })}
        <div class="kd-menu-list">
            ${items.map(([h, e, t, d]) => html`
                <a class="kd-menu-item" href="${h}">
                    <span class="kd-menu-emoji">${e}</span>
                    <span>
                        <div class="kd-font-bold">${t}</div>
                        <div class="kd-text-sm kd-text-muted">${d}</div>
                    </span>
                </a>`).join('')}
        </div>`;
    // Shell cũ (tab mở trước deploy) không có route /ql-* → dùng full-load URL.
    if (!window.PKD?.build) {
        const a = container.querySelector('a[href="#/ql-ov?k=npp"]');
        if (a) a.href = `/kd?r=${Date.now()}#/ql-ov?k=npp`;
    }
}
