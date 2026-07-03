import { html } from '../lib/dom.js';
import { escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { qlNav, channelOf, CHANNEL_LABEL, CHANNEL_NOUN } from '../components/ql-nav.js';
import { salesMatrixHtml } from '../components/sales-matrix.js';

// ─── Bảng doanh số khách × tháng theo kênh (port từ npp quan-ly-doanhso) ─────
export async function render({ container, query }) {
    const k = channelOf(query);
    container.innerHTML = html`
        ${banner({ title: `Bảng doanh số ${CHANNEL_NOUN[k]}`, subtitle: `Kênh ${CHANNEL_LABEL[k]} — tổng từ đầu năm tài chính + chi tiết từng tháng` })}
        ${qlNav('ds', k)}
        <div id="kd-ds-body"><div class="kd-skeleton" style="height:320px;"></div></div>
    `;
    try {
        const d = await api.mgr.salesMatrix(k);
        document.getElementById('kd-ds-body').innerHTML = salesMatrixHtml(d, {
            showKpis: true,
            detailHref: (c) => `#/ql-khach?k=${k}&c=${encodeURIComponent(c)}`,
        });
    } catch (err) {
        document.getElementById('kd-ds-body').innerHTML =
            `<div class="kd-empty"><div class="kd-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}
