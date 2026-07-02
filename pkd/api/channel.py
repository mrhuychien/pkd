# -*- coding: utf-8 -*-
"""channel — dashboard 3 kênh NPP / MT / Du lịch (blueprint Mục 8).

Doanh số loại opening, so kỳ period-aligned. MT ưu tiên trailing (sell-in nhiễu PO).
Attribution theo si.customer_group. Không margin. Hygiene flags bật/tắt bảng.
"""

from __future__ import annotations

import frappe
from frappe.utils import add_months, add_days, flt, get_first_day, getdate, nowdate

from pkd.api._metrics import (
	SEGMENT_RANK,
	active_customers,
	customer_names,
	customers_in_groups,
	order_stats,
	revenue_by_customer,
	segment_map,
	sku_group_count,
)
from pkd.api.debt import _aging_buckets, _dso, _rev_12m, _top_debtors
from pkd.api.utils import (
	CHANNEL_LABELS,
	_guard,
	get_settings,
	groups_of,
	growth_pct,
	iso,
	pct,
	period_mtd,
)

GENERIC_TERRITORY = {None, "", "All Territories", "Vietnam", "Việt Nam"}


# ─── Helper chung ────────────────────────────────────────────────────────────
def _series_12m(groups, today) -> list[dict]:
	"""Doanh số 12 tháng gần nhất theo tháng (loại opening)."""
	if not groups:
		return []
	start = get_first_day(add_months(getdate(today), -11))
	rows = frappe.db.sql(
		"""
		SELECT DATE_FORMAT(si.posting_date, '%%Y-%%m') AS ym, SUM(si.grand_total) AS amt
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(s)s AND %(e)s
		  AND si.customer_group IN %(g)s
		GROUP BY ym ORDER BY ym
		""",
		{"s": start, "e": today, "g": tuple(groups)},
		as_dict=True,
	)
	found = {r.ym: flt(r.amt) for r in rows}
	out = []
	for i in range(12):
		d = add_months(get_first_day(getdate(today)), -(11 - i))
		ym = d.strftime("%Y-%m")
		out.append({"month": ym, "amount": found.get(ym, 0.0)})
	return out


def _outstanding_by_customer(groups) -> dict:
	if not groups:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT si.customer AS cust, SUM(si.outstanding_amount) AS amt
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1 AND si.outstanding_amount > 0
		  AND si.customer_group IN %(g)s
		GROUP BY si.customer
		""",
		{"g": tuple(groups)},
		as_dict=True,
	)
	return {r.cust: flt(r.amt) for r in rows}


def _pareto(rev_by_cust: dict) -> dict:
	vals = sorted((v for v in rev_by_cust.values() if v), reverse=True)
	total = sum(vals)
	if not total:
		return {"top5_pct": None, "top10_pct": None, "npp_for_80": None}
	cum, n80 = 0.0, 0
	for v in vals:
		cum += v
		n80 += 1
		if cum >= total * 0.8:
			break
	return {
		"top5_pct": round(sum(vals[:5]) / total * 100, 1),
		"top10_pct": round(sum(vals[:10]) / total * 100, 1),
		"npp_for_80": n80,
	}


# ─── NPP ─────────────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_npp_dashboard():
	"""Coverage · 12m · segments + biến động · Pareto · SKU mix · quá nhịp · aging."""
	_guard()
	settings = get_settings()
	today = getdate(nowdate())
	npp = groups_of("npp")
	period = period_mtd(today)

	roster = customers_in_groups(npp)
	roster_names = [r.name for r in roster]
	total = len(roster_names)
	win = int(settings.cua_so_hoat_dong or 90)
	active = active_customers(npp, add_days(today, -win), today)
	bought_mtd = active_customers(npp, period["start"], today)
	coverage = {
		"active": len(active),
		"bought_mtd": len(bought_mtd),
		"total": total,
		"pct": pct(len(active), total),
	}

	rev_mtd = revenue_by_customer(npp, period["start"], today)
	rev_12m_cust = revenue_by_customer(npp, add_months(today, -12), today)

	# Segments (count + amount MTD); "Chưa mua" = roster chưa có đơn.
	seg_now = segment_map(npp, today)
	seg_count, seg_amount = {}, {}
	for cust, s in seg_now.items():
		seg_count[s] = seg_count.get(s, 0) + 1
		seg_amount[s] = seg_amount.get(s, 0.0) + rev_mtd.get(cust, 0.0)
	never = [c for c in roster_names if c not in seg_now]
	if never:
		seg_count["Chưa mua"] = len(never)
	seg_order = ["Mới", "Tăng trưởng", "Ổn định", "Suy giảm", "Ngủ đông", "Mất", "Chưa mua"]
	segments = [
		{"segment": s, "count": seg_count.get(s, 0), "amount": seg_amount.get(s, 0.0)}
		for s in seg_order if seg_count.get(s, 0)
	]

	# Biến động segment (hôm nay vs đầu tháng).
	seg_anchor = segment_map(npp, get_first_day(today))
	changes = []
	for cust, ns in seg_now.items():
		os_ = seg_anchor.get(cust)
		if os_ and os_ != ns:
			changes.append(
				{"customer": cust, "from": os_, "to": ns, "drop": SEGMENT_RANK[ns] - SEGMENT_RANK[os_]}
			)
	changes.sort(key=lambda x: x["drop"], reverse=True)
	changes = changes[:50]
	cnames = customer_names([c["customer"] for c in changes])
	for c in changes:
		c["customer_name"] = cnames.get(c["customer"]) or c["customer"]

	# SKU mix (khách active 90d).
	min_sku = int(settings.sku_toi_thieu or 3)
	sku_counts = sku_group_count(npp, 90, today)
	sku_ok = sum(1 for n in sku_counts.values() if n >= min_sku)
	thieu = [{"customer": c, "groups_bought": n} for c, n in sku_counts.items() if n < min_sku]
	thieu.sort(key=lambda x: x["groups_bought"])
	thieu = thieu[:50]
	tnames = customer_names([t["customer"] for t in thieu])
	for t in thieu:
		t["customer_name"] = tnames.get(t["customer"]) or t["customer"]
		t["route"] = f"/khach/{t['customer']}"
	sku_mix = {"du_nhom_pct": (round(sku_ok / len(sku_counts) * 100, 1) if sku_counts else None), "thieu": thieu}

	# Quá nhịp tái đặt.
	hs = flt(settings.he_so_qua_nhip) or 1.5
	stats = order_stats(npp, today)
	overdue = []
	for cust, s in stats.items():
		cyc = s["avg_cycle"]
		if cyc and cyc > 0 and s["days_since"] > cyc * hs:
			overdue.append(
				{"customer": cust, "avg_cycle": round(cyc, 1), "days_since": s["days_since"], "route": f"/khach/{cust}"}
			)
	overdue.sort(key=lambda x: x["days_since"], reverse=True)
	overdue = overdue[:50]
	onames = customer_names([o["customer"] for o in overdue])
	for o in overdue:
		o["customer_name"] = onames.get(o["customer"]) or o["customer"]

	debt_buckets = _aging_buckets(npp, today)
	debt = {"buckets": debt_buckets, "dso": _dso(debt_buckets["total"], _rev_12m(npp, today)), "top": _top_debtors(npp, today, 15)}

	return {
		"coverage": coverage,
		"series_12m": _series_12m(npp, today),
		"segments": segments,
		"segment_changes": changes,
		"pareto": _pareto(rev_12m_cust),
		"sku_mix": sku_mix,
		"overdue_reorder": overdue,
		"debt": debt,
	}


# ─── MT ──────────────────────────────────────────────────────────────────────
def _mt_addr_pct(groups, start, end) -> float:
	"""% hoá đơn MT có shipping_address_name (hygiene)."""
	if not groups:
		return 0.0
	row = frappe.db.sql(
		"""
		SELECT COUNT(*) AS total,
		       SUM(CASE WHEN si.shipping_address_name IS NOT NULL AND si.shipping_address_name != ''
		                THEN 1 ELSE 0 END) AS with_addr
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(s)s AND %(e)s
		  AND si.customer_group IN %(g)s
		""",
		{"s": start, "e": end, "g": tuple(groups)},
		as_dict=True,
	)[0]
	if not row.total:
		return 0.0
	return round((row.with_addr or 0) / row.total * 100, 1)


@frappe.whitelist()
def get_mt_dashboard(chain=None):
	"""Hygiene địa chỉ · bảng chuỗi (ưu tiên trailing) · outlets khi chọn chuỗi."""
	_guard()
	settings = get_settings()
	today = getdate(nowdate())
	mt = groups_of("mt")
	n = int(settings.mt_trailing_thang or 3)
	period = period_mtd(today)

	# Hygiene (theo trailing N tháng).
	trail_start = add_months(today, -n)
	addr_pct = _mt_addr_pct(mt, trail_start, today)
	addr_ok = addr_pct >= flt(settings.mt_addr_nguong_pct or 80)

	mtd_map = revenue_by_customer(mt, period["start"], today)
	trail_map = revenue_by_customer(mt, trail_start, today)
	prev_map = revenue_by_customer(mt, add_months(today, -2 * n), add_months(today, -n))
	yoy_map = revenue_by_customer(mt, add_months(today, -12 - n), add_months(today, -12))
	stats = order_stats(mt, today)
	out_map = _outstanding_by_customer(mt)
	silence = int(settings.mt_ngay_im_lang or 30)

	custs = set(mtd_map) | set(trail_map) | set(stats) | set(out_map)
	names = customer_names(list(custs))
	chains = []
	for c in custs:
		s = stats.get(c, {})
		chains.append(
			{
				"customer": c,
				"customer_name": names.get(c) or c,
				"mtd": flt(mtd_map.get(c, 0.0)),
				"trailing_3m": flt(trail_map.get(c, 0.0)),
				"prev_3m_aligned": flt(prev_map.get(c, 0.0)),
				"growth_pct": growth_pct(trail_map.get(c, 0.0), prev_map.get(c, 0.0)),
				"yoy_pct": growth_pct(trail_map.get(c, 0.0), yoy_map.get(c, 0.0)),
				"last_invoice": iso(s.get("last_order")) if s.get("last_order") else None,
				"days_silent": s.get("days_since"),
				"outstanding": flt(out_map.get(c, 0.0)),
				"route": f"/khach/{c}",
			}
		)
	chains.sort(key=lambda x: x["trailing_3m"], reverse=True)

	result = {
		"hygiene": {"addr_pct": addr_pct, "addr_ok": addr_ok},
		"chains": chains,
		"trailing_months": n,
		"silence_days": silence,
		"meta": {"note": "Sell-in, nhiễu theo PO — ưu tiên trailing 3 tháng"},
	}

	if chain:
		result["outlets"] = _mt_outlets(mt, chain, today, n, period)
	return result


def _mt_outlets(mt, chain, today, n, period) -> list[dict]:
	"""Chi tiết siêu thị theo shipping_address_name của 1 chuỗi."""
	rows = frappe.db.sql(
		"""
		SELECT si.shipping_address_name AS addr,
		       SUM(CASE WHEN si.posting_date BETWEEN %(ms)s AND %(today)s THEN si.grand_total ELSE 0 END) AS mtd,
		       SUM(CASE WHEN si.posting_date BETWEEN %(ts)s AND %(today)s THEN si.grand_total ELSE 0 END) AS trailing,
		       MAX(si.posting_date) AS last_invoice
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.customer = %(chain)s
		  AND si.customer_group IN %(g)s
		  AND si.posting_date >= %(ts)s
		GROUP BY si.shipping_address_name
		ORDER BY trailing DESC
		""",
		{"ms": period["start"], "ts": add_months(today, -n), "today": today, "chain": chain, "g": tuple(mt)},
		as_dict=True,
	)
	return [
		{
			"shipping_address_name": r.addr or "(không ghi địa chỉ)",
			"mtd": flt(r.mtd),
			"trailing_3m": flt(r.trailing),
			"last_invoice": iso(r.last_invoice) if r.last_invoice else None,
		}
		for r in rows
	]


# ─── Du lịch ─────────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_tourism_dashboard():
	"""By territory (+clean flag) · khách mới · tỷ lệ đơn 2 · khách quen im ắng · 12m."""
	_guard()
	settings = get_settings()
	today = getdate(nowdate())
	dl = groups_of("dulich")
	period = period_mtd(today)

	# By territory (trailing 12 tháng).
	by_territory, territory_clean = _tourism_territory(dl, today)

	stats = order_stats(dl, today)  # first_order/last_order/orders/avg_cycle/days_since

	# Khách mới: đơn ĐẦU rơi vào kỳ MTD.
	new_list = []
	for c, s in stats.items():
		if s["first_order"] and period["start"] <= s["first_order"] <= today:
			new_list.append(c)
	nnames = customer_names(new_list)
	new_customers = {
		"count": len(new_list),
		"list": [{"customer": c, "customer_name": nnames.get(c) or c, "route": f"/khach/{c}"} for c in new_list],
	}

	# Tỷ lệ đơn thứ 2: trong số khách có đơn đầu ≤180 ngày, bao nhiêu % đã có ≥2 đơn.
	recent_first = [s for s in stats.values() if s["first_order"] and (today - s["first_order"]).days <= 180]
	if recent_first:
		second = sum(1 for s in recent_first if s["orders"] >= 2)
		second_order_rate = round(second / len(recent_first) * 100, 1)
	else:
		second_order_rate = None

	# Khách quen im ắng: ≥3 đơn & quá nhịp.
	hs = flt(settings.he_so_qua_nhip) or 1.5
	quiet = []
	for c, s in stats.items():
		cyc = s["avg_cycle"]
		if s["orders"] >= 3 and cyc and cyc > 0 and s["days_since"] > cyc * hs:
			quiet.append({"customer": c, "avg_cycle": round(cyc, 1), "days_since": s["days_since"], "route": f"/khach/{c}"})
	quiet.sort(key=lambda x: x["days_since"], reverse=True)
	quiet = quiet[:50]
	qnames = customer_names([q["customer"] for q in quiet])
	for q in quiet:
		q["customer_name"] = qnames.get(q["customer"]) or q["customer"]

	return {
		"by_territory": by_territory,
		"territory_clean": territory_clean,
		"new_customers": new_customers,
		"second_order_rate": second_order_rate,
		"quiet_regulars": quiet,
		"series_12m": _series_12m(dl, today),
	}


def _tourism_territory(dl, today):
	"""Doanh số theo territory 12 tháng + cờ territory_clean (≥90% có tỉnh không generic)."""
	if not dl:
		return [], False
	rows = frappe.db.sql(
		"""
		SELECT si.territory AS terr, SUM(si.grand_total) AS amt, COUNT(*) AS cnt
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(s)s AND %(e)s
		  AND si.customer_group IN %(g)s
		GROUP BY si.territory ORDER BY amt DESC
		""",
		{"s": add_months(today, -12), "e": today, "g": tuple(dl)},
		as_dict=True,
	)
	total_cnt = sum(r.cnt for r in rows)
	clean_cnt = sum(r.cnt for r in rows if r.terr not in GENERIC_TERRITORY)
	territory_clean = bool(total_cnt) and (clean_cnt / total_cnt) >= 0.9
	by_territory = [
		{"territory": r.terr or "(chưa rõ)", "amount": flt(r.amt), "invoices": r.cnt}
		for r in rows
	]
	return by_territory, territory_clean
