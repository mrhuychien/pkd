# -*- coding: utf-8 -*-
"""tet.get_tet_dashboard — theo dõi mùa Tết theo mốc D-N (blueprint Mục 10).

So sánh công bằng khi Tết nhảy tháng 1↔2 dương: trục X = DATEDIFF(posting_date,
tet_date) (−N…0), trục Y = doanh số luỹ kế trong cửa sổ. KHÔNG dùng YoY dương lịch
trong view này. Doanh số loại opening. Filter kênh + item_group áp vào series/thẻ.
"""

from __future__ import annotations

import frappe
from frappe.utils import add_days, flt, getdate, nowdate

from pkd.api._metrics import active_customers, customer_names, customers_in_groups
from pkd.api.utils import (
	_guard,
	channel_map,
	get_settings,
	groups_of,
	pct,
	tet_date,
	TET_DATES,
)


def _season_cumulative(td, n, groups, item_group) -> dict:
	"""{offset(-n..0): doanh số luỹ kế} trong cửa sổ [td-n, td]."""
	empty = {off: 0.0 for off in range(-n, 1)}
	if not groups:
		return empty
	params = {"tet": td, "start": add_days(td, -n), "g": tuple(groups)}
	if item_group:
		params["ig"] = item_group
		q = """
			SELECT DATEDIFF(si.posting_date, %(tet)s) AS off, SUM(sii.amount) AS amt
			FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON si.name = sii.parent
			WHERE si.docstatus = 1 AND IFNULL(si.is_opening, 'No') != 'Yes'
			  AND si.posting_date BETWEEN %(start)s AND %(tet)s
			  AND si.customer_group IN %(g)s AND sii.item_group = %(ig)s
			GROUP BY off
		"""
	else:
		q = """
			SELECT DATEDIFF(si.posting_date, %(tet)s) AS off, SUM(si.grand_total) AS amt
			FROM `tabSales Invoice` si
			WHERE si.docstatus = 1 AND IFNULL(si.is_opening, 'No') != 'Yes'
			  AND si.posting_date BETWEEN %(start)s AND %(tet)s
			  AND si.customer_group IN %(g)s
			GROUP BY off
		"""
	daily = {int(r.off): flt(r.amt) for r in frappe.db.sql(q, params, as_dict=True)}
	cum, running = {}, 0.0
	for off in range(-n, 1):
		running += daily.get(off, 0.0)
		cum[off] = running
	return cum


def _pick_current_year(today, n):
	"""Mùa hiện hành = mùa có cửa sổ chứa hôm nay; else mùa sắp tới."""
	for y, dstr in TET_DATES.items():
		td = getdate(dstr)
		if add_days(td, -n) <= today <= td:
			return y
	upcoming = sorted(getdate(d) for d in TET_DATES.values() if getdate(d) >= today)
	return upcoming[0].year if upcoming else max(TET_DATES)


@frappe.whitelist()
def get_tet_dashboard(tet_year=None, channel=None, item_group=None):
	"""Series 4 mùa (luỹ kế theo mốc D-N) + thẻ tiến độ + coverage NPP + bảng MT."""
	_guard()
	settings = get_settings()
	today = getdate(nowdate())
	n = int(settings.tet_cua_so_ngay or 60)
	item_group = item_group or None

	cur_year = int(tet_year) if tet_year else _pick_current_year(today, n)
	cur_tet = tet_date(cur_year)
	if not cur_tet:
		return {"available": False, "message": f"Chưa có mốc Tết cho năm {cur_year}."}

	groups = groups_of(channel) if channel else list(channel_map().keys())

	# 4 mùa: 3 mùa gần nhất + hiện hành.
	years = [y for y in (cur_year - 3, cur_year - 2, cur_year - 1, cur_year) if y in TET_DATES]
	series = []
	cum_by_year = {}
	for y in years:
		td = tet_date(y)
		cum = _season_cumulative(td, n, groups, item_group)
		cum_by_year[y] = cum
		series.append(
			{
				"year": y,
				"tet_date": str(td),
				"is_current": y == cur_year,
				"points": [{"off": off, "cum": cum[off]} for off in range(-n, 1)],
			}
		)

	# Mốc hiện tại (offset của hôm nay trong cửa sổ, cap ở 0 nếu đã qua Tết).
	off_today = min(0, (today - cur_tet).days)
	days_to_tet = (cur_tet - today).days
	cur_cum = cum_by_year.get(cur_year, {}).get(off_today, 0.0)

	prev_year = cur_year - 1
	prev_cum_same = cum_by_year.get(prev_year, {}).get(off_today) if prev_year in cum_by_year else None
	prev_full = cum_by_year.get(prev_year, {}).get(0) if prev_year in cum_by_year else None

	vs_prev_pct = pct(cur_cum, prev_cum_same) if prev_cum_same else None
	# Ước cả mùa (thô): cur_cum / prev_cum_same × prev_full.
	est_full = (cur_cum / prev_cum_same * prev_full) if (prev_cum_same and prev_full) else None

	cards = {
		"days_to_tet": days_to_tet,
		"off_today": off_today,
		"cum_current": cur_cum,
		"cum_prev_same_offset": prev_cum_same,
		"vs_prev_pct": vs_prev_pct,
		"est_full_season": est_full,
		"prev_full_season": prev_full,
	}

	result = {
		"available": True,
		"tet_year": cur_year,
		"tet_date": str(cur_tet),
		"window_days": n,
		"channel": channel,
		"item_group": item_group,
		"series": series,
		"cards": cards,
	}

	# Coverage NPP (nếu áp vào NPP hoặc toàn phòng).
	if channel in (None, "npp"):
		result["coverage_npp"] = _coverage(groups_of("npp"), cur_tet, prev_year, n, off_today)
	# Bảng chuỗi MT đã/chưa có đơn trong cửa sổ.
	if channel in (None, "mt"):
		result["mt_status"] = _mt_status(groups_of("mt"), cur_tet, n, today)

	return result


def _coverage(npp_groups, cur_tet, prev_year, n, off_today):
	"""# NPP đã lên đơn mùa này (đến mốc) vs cùng mốc mùa trước."""
	cur_end = add_days(cur_tet, off_today)
	cur = active_customers(npp_groups, add_days(cur_tet, -n), cur_end)
	prev = set()
	prev_tet = tet_date(prev_year)
	if prev_tet:
		prev = active_customers(npp_groups, add_days(prev_tet, -n), add_days(prev_tet, off_today))
	return {"current": len(cur), "prev_same_offset": len(prev)}


def _mt_status(mt_groups, cur_tet, n, today):
	"""Chuỗi MT đã/chưa có đơn trong cửa sổ Tết hiện hành."""
	roster = customers_in_groups(mt_groups)
	end = min(today, cur_tet)
	ordered = active_customers(mt_groups, add_days(cur_tet, -n), end)
	names = {r.name: r.customer_name for r in roster}
	done = [{"customer": c, "customer_name": names.get(c, c), "route": f"/khach/{c}"} for c in names if c in ordered]
	pending = [{"customer": c, "customer_name": names.get(c, c), "route": f"/khach/{c}"} for c in names if c not in ordered]
	return {"ordered_count": len(done), "pending_count": len(pending), "ordered": done, "pending": pending[:50]}
