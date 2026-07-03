// Sub-nav bộ "Quản lý kênh" (port từ npp managerNav, channel-aware).
// Mỗi view QLK nhận kênh qua query ?k=npp|mt|dulich — nav giữ nguyên k khi đổi tab.

import { escapeHtml } from '../lib/format.js';

export const CHANNELS = [['npp', 'NPP'], ['mt', 'MT'], ['dulich', 'Du lịch']];
export const CHANNEL_LABEL = Object.fromEntries(CHANNELS);
// Nhãn "đơn vị khách" theo kênh — dùng cho tiêu đề cột/bảng.
export const CHANNEL_NOUN = { npp: 'NPP', mt: 'Chuỗi', dulich: 'Khách' };

const TABS = [
    ['/ql-ov', 'ov', '📊 Tổng quan'],
    ['/ql-sp', 'sp', '📦 Sản phẩm'],
    ['/ql-khach', 'kh', '🔍 Chi tiết KH'],
    ['/ql-target', 'tg', '🎯 Mục tiêu KH'],
    ['/ql-alert', 'al', '🔔 Cần xử lý'],
    ['/ql-debt', 'db', '💰 Công nợ'],
    ['/ql-ds', 'ds', '📅 DS tháng'],
];

/** Chuẩn hoá kênh từ query (mặc định npp). */
export function channelOf(query) {
    const k = (query && query.k) || 'npp';
    return CHANNEL_LABEL[k] ? k : 'npp';
}

/**
 * HTML sub-nav: hàng 1 = pills chọn kênh (giữ tab hiện tại), hàng 2 = tab QLK
 * (giữ kênh hiện tại) + nút quay về trang Điều hành của kênh.
 */
export function qlNav(activeTab, channel) {
    const pills = CHANNELS.map(([k, label]) => {
        const tab = TABS.find(([, key]) => key === activeTab);
        const href = `#${tab ? tab[0] : '/ql-ov'}?k=${k}`;
        return `<a href="${href}" class="${k === channel ? 'kd-active' : ''}">${escapeHtml(label)}</a>`;
    }).join('');
    const tabs = TABS.map(([h, key, label]) =>
        `<a href="#${h}?k=${channel}" class="${key === activeTab ? 'kd-active' : ''}">${label}</a>`).join('');
    const back = `<a href="#/${channel}">↩ Điều hành</a>`;
    return `<div class="kd-ql-nav kd-ql-channels">${pills}</div>
            <div class="kd-ql-nav">${tabs}${back}</div>`;
}
