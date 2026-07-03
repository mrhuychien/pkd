// Wrapper quanh frappe.call() + helper cho whitelisted method của pkd.
// Mọi method server-side có _guard() → quyền kiểm ở server, không chỉ ẩn nút.

import * as store from './store.js';

function call(method, args = {}) {
    return new Promise((resolve, reject) => {
        if (typeof window.frappe?.call !== 'function') {
            return reject(new Error('Frappe API không khả dụng — bạn đã đăng nhập chưa?'));
        }
        window.frappe.call({
            method,
            args,
            callback: (r) => resolve(r?.message),
            error: (xhr) => {
                const msg = xhr?.responseJSON?.exc || xhr?.statusText || 'API error';
                reject(new Error(String(msg).slice(0, 500)));
            },
        });
    });
}

// ─── Standard CRUD (đọc list phục vụ filter Khám phá / Chỉ tiêu) ────────────
export const list = (doctype, opts = {}) => call('frappe.client.get_list', {
    doctype,
    fields:            opts.fields || ['name'],
    filters:           opts.filters || [],
    order_by:          opts.order_by || 'name asc',
    limit_page_length: opts.limit ?? 0,
    limit_start:       opts.start ?? 0,
});

// ─── pkd.api.* whitelisted methods ─────────────────────────────────────────
export const getOverview        = ()          => call('pkd.api.overview.get_overview');
export const getActionQueues    = (channel)   => call('pkd.api.actions.get_action_queues', { channel });
export const getRevenueBreakdown = (args)     => call('pkd.api.explore.get_revenue_breakdown', args);

// P1
export const getNppDashboard     = ()         => call('pkd.api.channel.get_npp_dashboard');
export const getMtDashboard      = (chain)    => call('pkd.api.channel.get_mt_dashboard', { chain });
export const getTourismDashboard = ()         => call('pkd.api.channel.get_tourism_dashboard');
export const getDebtAging        = (channel)  => call('pkd.api.debt.get_debt_aging', { channel });
export const getTargets          = (nam)      => call('pkd.api.targets.get_targets', { nam });
export const saveTarget          = (data)     => call('pkd.api.targets.save_target', { data });
export const getTargetAttainment = (nam, thang) => call('pkd.api.targets.get_target_attainment', { nam, thang });

// Quản lý kênh (port từ npp.api.manager — channel-aware)
export const mgr = {
    overview:        (k, months)          => call('pkd.api.manager.overview', { channel: k, months }),
    products:        (k, months)          => call('pkd.api.manager.products', { channel: k, months }),
    skuWhiteSpace:   (k, item_code, months) => call('pkd.api.manager.sku_white_space', { channel: k, item_code, months }),
    whiteSpace:      (k, item_group, months) => call('pkd.api.manager.white_space', { channel: k, item_group, months }),
    targets:         (k, months)          => call('pkd.api.manager.targets', { channel: k, months }),
    setTarget:       (customer, amount)   => call('pkd.api.manager.set_target', { customer, amount }),
    setTargetsBulk:  (data)               => call('pkd.api.manager.set_targets_bulk', { data }),
    receivables:     (k)                  => call('pkd.api.manager.receivables', { channel: k }),
    insights:        (k)                  => call('pkd.api.manager.insights', { channel: k }),
    actionCenter:    (k)                  => call('pkd.api.manager.action_center', { channel: k }),
    slowSkus:        (k, days)            => call('pkd.api.manager.slow_skus', { channel: k, days }),
    catalogDepth:    (k, months)          => call('pkd.api.manager.catalog_depth', { channel: k, months }),
    customerList:    (k)                  => call('pkd.api.manager.customer_list', { channel: k }),
    customerDetail:  (k, customer, months) => call('pkd.api.manager.customer_detail', { channel: k, customer, months }),
    salesMatrix:     (k)                  => call('pkd.api.manager.sales_matrix', { channel: k }),
};

// P2
export const getDisplaySummary   = ()          => call('pkd.api.display.get_display_summary');
export const getTetDashboard     = (args)      => call('pkd.api.tet.get_tet_dashboard', args || {});
export const getCustomerDetail   = (customer)  => call('pkd.api.customer.get_customer_detail', { customer });

// ─── Cached variants (dashboard nhịp ngày → TTL ngắn) ──────────────────────
export const cached = {
    overview() { return store.ensure('overview', () => getOverview(), store.TTL.SHORT); },
    itemGroups() { return store.ensure('item_groups', () => list('Item Group', { fields: ['name'], order_by: 'name asc' }), store.TTL.LONG); },
};

export { call };  // escape hatch
