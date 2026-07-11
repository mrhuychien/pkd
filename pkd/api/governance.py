# -*- coding: utf-8 -*-
"""governance.get_governance — bộ chỉ số GIÁM SÁT & sức khoẻ kinh doanh.

Bổ sung tầng "quản trị" mà overview/manager chưa có: biến động TẬP KHÁCH
(mới / rời bỏ / giữ chân theo tháng), top tăng — giảm 90 ngày aligned, mức độ
tập trung Pareto toàn cục, tín hiệu công nợ (DSO, quá hạn, "nợ mà không mua"),
tỷ lệ trả về theo tháng (đánh dấu tháng đột biến), và nhịp đạt mục tiêu MTD
theo kênh. Attribution: ROSTER (customer IN khách hiện thuộc kênh) — tự nhiên
cho tập khách; khác snapshot của Kinh doanh chung (ghi chú ở UI, là thiết kế).
Doanh số loại opening; công nợ GIỮ opening; không margin/COGS (QĐ #3).
"""

from __future__ import annotations

import frappe
from frappe.utils import add_days, add_months, flt, get_first_day, getdate

from pkd.api._debt_gl import channel_debt
from pkd.api.utils import (
	CHANNEL_KEYS, CHANNEL_LABELS, _guard, channel_map, get_settings,
	iso, pace_pct, pct, period_mtd,
)


def _growth(cur, prev):
	"""% tăng trưởng chia |prev| — prev ÂM (kỳ trước trả nhiều hơn mua) vẫn ra
	đúng DẤU (growth_pct chuẩn chia prev có dấu sẽ đảo ngược dấu). None nếu prev=0."""
	p = flt(prev)
	if not p:
		return None
	return round((flt(cur) - p) / abs(p) * 100, 1)

GOV_FILTERS = {None, "", "npp", "mt", "dulich"}
GOV_LABELS = {**CHANNEL_LABELS, None: "Toàn công ty"}


def _roster(channel: str | None) -> list[dict]:
	"""Tập khách theo ROSTER: kênh → khách hiện thuộc cây group kênh; None → mọi khách."""
	if channel:
		from pkd.api.manager import _channel_customers
		return _channel_customers(channel)
	return frappe.get_all("Customer", fields=["name", "customer_name"])


def _month_axis(today) -> list[dict]:
	"""12 bucket tháng lùi từ tháng hiện tại (nhãn khớp report.py: T7/25)."""
	out = []
	for offset in range(11, -1, -1):
		d = get_first_day(add_months(today, -offset))
		out.append({"key": d.strftime("%Y-%m"), "label": "T%d/%s" % (d.month, d.strftime("%y"))})
	return out


@frappe.whitelist()
def get_governance(channel=None):
	"""Gói giám sát: flow tập khách 12T, sức khoẻ 90N, movers, Pareto, nợ, trả về, nhịp kênh."""
	_guard()
	if channel not in GOV_FILTERS:
		frappe.throw(frappe._("Kênh không hợp lệ: {0}").format(channel))
	channel = channel or None

	settings = get_settings()
	lost_days = int(settings.ngay_mat or 90)
	dormant_days = int(settings.ngay_ngu_dong or 30)
	today = getdate()
	w90 = add_days(today, -90)
	w180 = add_days(today, -180)
	months = _month_axis(today)
	m12_start = getdate(months[0]["key"] + "-01")
	month_keys = [m["key"] for m in months]

	roster = _roster(channel)
	names = tuple(c["name"] for c in roster)
	name_of = {c["name"]: c.get("customer_name") or c["name"] for c in roster}
	if channel and not names:
		names = ("__none__",)
	cond = " AND si.customer IN %(names)s" if channel else ""
	params = {"names": names, "today": today, "w90": w90, "w180": w180, "m12": m12_start}

	# ── 1 query per-customer: first/last + 2 cửa sổ 90N aligned + 12 tháng ──
	cust_rows = frappe.db.sql(
		f"""
		SELECT si.customer AS cust,
		       MIN(si.posting_date) AS first_order,
		       MAX(si.posting_date) AS last_order,
		       SUM(CASE WHEN si.posting_date > %(w90)s THEN si.grand_total ELSE 0 END) AS cur90,
		       SUM(CASE WHEN si.posting_date > %(w90)s THEN 1 ELSE 0 END) AS n_cur90,
		       SUM(CASE WHEN si.posting_date > %(w180)s AND si.posting_date <= %(w90)s
		                THEN si.grand_total ELSE 0 END) AS prev90,
		       SUM(CASE WHEN si.posting_date > %(w180)s AND si.posting_date <= %(w90)s
		                THEN 1 ELSE 0 END) AS n_prev90,
		       SUM(CASE WHEN si.posting_date >= %(m12)s THEN si.grand_total ELSE 0 END) AS rev12
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date <= %(today)s{cond}
		GROUP BY si.customer
		""",
		params,
		as_dict=True,
	)

	# ── Flow theo tháng: buyers/hoá đơn/bán-trả (1 query) + mới/rời (Python) ──
	m_rows = frappe.db.sql(
		f"""
		SELECT DATE_FORMAT(si.posting_date, '%%Y-%%m') AS ym,
		       COUNT(DISTINCT si.customer) AS buyers,
		       COUNT(*) AS invoices,
		       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN si.grand_total ELSE 0 END), 0) AS returns,
		       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN 0 ELSE si.grand_total END), 0) AS gross
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(m12)s AND %(today)s{cond}
		GROUP BY ym
		""",
		params,
		as_dict=True,
	)
	m_map = {r.ym: r for r in m_rows}
	new_by_m = {k: 0 for k in month_keys}
	lost_by_m = {k: 0 for k in month_keys}
	for r in cust_rows:
		fk = getdate(r.first_order).strftime("%Y-%m")
		if fk in new_by_m:
			new_by_m[fk] += 1
		# "Rời bỏ" chốt tại tháng mua CUỐI khi đã im lặng > ngay_mat →
		# các tháng gần đây chưa thể "rời" (right-censored) — UI ghi chú.
		last = getdate(r.last_order)
		if (today - last).days > lost_days:
			lk = last.strftime("%Y-%m")
			if lk in lost_by_m:
				lost_by_m[lk] += 1
	flow = []
	for m in months:
		r = m_map.get(m["key"])
		g = flt(r.gross) if r else 0.0
		ret = flt(r.returns) if r else 0.0
		flow.append({
			"month": m["label"], "key": m["key"],
			"buyers": int(r.buyers) if r else 0,
			"invoices": int(r.invoices) if r else 0,
			"new": new_by_m[m["key"]], "lost": lost_by_m[m["key"]],
			"gross": g, "returns": ret,
			"return_rate_pct": round(-ret / g * 100, 2) if g else None,
		})
	rates = [f["return_rate_pct"] for f in flow if f["return_rate_pct"] is not None]
	avg_rate = (sum(rates) / len(rates)) if rates else None
	for f in flow:
		# Đột biến trả về: vượt 1.5× trung bình 12T và tối thiểu 2 điểm %.
		f["return_spike"] = bool(
			avg_rate is not None and f["return_rate_pct"] is not None
			and f["return_rate_pct"] > avg_rate * 1.5 and f["return_rate_pct"] >= 2
		)

	# ── Sức khoẻ tập khách 90 ngày (aligned by construction) ────────────────
	active_90 = sum(1 for r in cust_rows if r.n_cur90)
	prev_buyers = [r for r in cust_rows if r.n_prev90]
	retained = sum(1 for r in prev_buyers if r.n_cur90)
	new_90 = sum(1 for r in cust_rows if getdate(r.first_order) > w90)
	# "Rời bỏ trong 90N" = TRỞ THÀNH mất (im lặng > ngay_mat) trong 90 ngày qua —
	# cùng ngưỡng cấu hình với flow tháng, không hardcode 90/180.
	lost_cut = add_days(today, -lost_days)
	lost_window = add_days(today, -(90 + lost_days))
	lost_90 = sum(
		1 for r in cust_rows
		if lost_window < getdate(r.last_order) <= lost_cut
	)
	rev90_total = sum(flt(r.cur90) for r in cust_rows)
	prev90_total = sum(flt(r.prev90) for r in cust_rows)
	health = {
		"active_90": active_90,
		"new_90": new_90,
		"lost_90": lost_90,
		"net_90": new_90 - lost_90,
		"retention_pct": pct(retained, len(prev_buyers)),
		"rev90": rev90_total,
		"prev90": prev90_total,
		"growth90_pct": _growth(rev90_total, prev90_total),
		"rev_per_active": (rev90_total / active_90) if active_90 else None,
	}

	# ── Movers: top giảm / top tăng (90N vs 90N trước, cùng độ dài cửa sổ) ──
	def mover(r):
		delta = flt(r.cur90) - flt(r.prev90)
		return {
			"customer": r.cust, "customer_name": name_of.get(r.cust) or r.cust,
			"prev90": flt(r.prev90), "cur90": flt(r.cur90), "delta": delta,
			"pct": _growth(r.cur90, r.prev90),
			"is_new": bool(getdate(r.first_order) > w90),
			"route": f"/khach/{r.cust}",
		}
	movers_all = [mover(r) for r in cust_rows]
	down = sorted((m for m in movers_all if m["prev90"] > 0 and m["delta"] < 0),
		key=lambda m: m["delta"])[:10]
	up = sorted((m for m in movers_all if m["delta"] > 0),
		key=lambda m: m["delta"], reverse=True)[:10]

	# ── Tập trung Pareto (12 tháng) ─────────────────────────────────────────
	rev12_total = sum(flt(r.rev12) for r in cust_rows)   # net toàn bộ (mẫu số DSO)
	rev12_sorted = sorted((flt(r.rev12) for r in cust_rows if flt(r.rev12) > 0), reverse=True)
	tot12 = sum(rev12_sorted)
	cum = 0.0
	n80 = 0
	for v in rev12_sorted:
		cum += v
		n80 += 1
		if cum >= tot12 * 0.8:
			break
	concentration = {
		"top5_pct": pct(sum(rev12_sorted[:5]), tot12),
		"top10_pct": pct(sum(rev12_sorted[:10]), tot12),
		"n_for_80": n80 if tot12 else 0,
		"buyers_12m": len(rev12_sorted),
	}

	# ── Tín hiệu công nợ (GL — nguồn chuẩn duy nhất; GIỮ opening).
	# Dùng ROSTER (không phải danh sách có hoá đơn bán) để không sót khách
	# chỉ còn số dư opening/journal mà chưa từng có hoá đơn thường.
	cd = channel_debt(names, today) if names and names != ("__none__",) else {}
	balance = sum(v["balance"] for v in cd.values())
	overdue = sum(v["overdue"] for v in cd.values())
	over_90 = sum(v["buckets"]["over_90"] for v in cd.values())
	last_map = {r.cust: getdate(r.last_order) for r in cust_rows}
	no_buy = [
		(c, v["balance"]) for c, v in cd.items()
		if v["balance"] > 0 and (c not in last_map or (today - last_map[c]).days > dormant_days)
	]
	debt = {
		"balance": balance,
		"overdue": overdue,
		"overdue_pct": pct(overdue, balance),
		"over_90": over_90,
		# DSO = nợ ÷ doanh số/ngày. Cửa sổ 12T thực tế là 334–365 ngày (11 tháng
		# tròn + MTD) → scale theo SỐ NGÀY THẬT, đừng nhân cứng 365 (lệch tới ~9%).
		"dso": round(balance / rev12_total * ((today - m12_start).days + 1), 0)
			if rev12_total > 0 else None,
		"no_buy_count": len(no_buy),
		"no_buy_amount": sum(a for _, a in no_buy),
	}

	# ── Nhịp đạt mục tiêu MTD theo kênh (dưới nhịp = cảnh báo sớm) ──────────
	from pkd.api.overview import _rev_by_group, _targets_by_channel, _to_channels

	period = period_mtd(today)
	pace = pace_pct(period)
	cmap = channel_map()
	ch_mtd = _to_channels(_rev_by_group(period["start"], period["end"]), cmap)
	targets = _targets_by_channel(period["end"].year, period["end"].month)
	keys = [channel] if channel else list(CHANNEL_KEYS)
	pace_channels = []
	for k in keys:
		tgt = targets.get(k) or 0
		att = pct(ch_mtd.get(k, 0.0), tgt)
		pace_channels.append({
			"key": k, "label": CHANNEL_LABELS[k],
			"mtd": ch_mtd.get(k, 0.0), "target": tgt, "attainment_pct": att,
			"below": bool(tgt and att is not None and pace is not None and att < pace - 5),
		})

	return {
		"meta": {
			"channel": channel,
			"label": GOV_LABELS.get(channel) or channel,
			"asof": iso(today),
			"lost_days": lost_days,
			"dormant_days": dormant_days,
			"attribution": "roster",
		},
		"flow": flow,
		"health": health,
		"movers": {"down": down, "up": up},
		"concentration": concentration,
		"debt": debt,
		"pace": {"pace_pct": pace, "channels": pace_channels},
	}
