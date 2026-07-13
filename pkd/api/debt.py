# -*- coding: utf-8 -*-
"""debt.get_debt_aging — công nợ & aging (blueprint Mục 8, luật #4).

Công nợ GIỮ opening (nợ thật). Aging theo COALESCE(due_date, posting_date).
DSO = nợ / doanh số 12 tháng × 365 (doanh số loại opening). Không margin.
"""

from __future__ import annotations

import frappe
from frappe.utils import add_months, flt, getdate, nowdate

from pkd.api._metrics import customer_names
from pkd.api.utils import CHANNEL_KEYS, CHANNEL_LABELS, _guard, channel_map, groups_of


def _aging_buckets(groups, today) -> dict:
	"""Buckets nợ theo số ngày quá hạn (giữ opening)."""
	empty = {"current": 0.0, "d1_30": 0.0, "d31_60": 0.0, "d61_90": 0.0, "d90p": 0.0, "total": 0.0}
	if not groups:
		return empty
	row = frappe.db.sql(
		"""
		SELECT
		  SUM(CASE WHEN DATEDIFF(%(today)s, COALESCE(si.due_date, si.posting_date)) <= 0
		           THEN si.outstanding_amount ELSE 0 END) AS current_amt,
		  SUM(CASE WHEN DATEDIFF(%(today)s, COALESCE(si.due_date, si.posting_date)) BETWEEN 1 AND 30
		           THEN si.outstanding_amount ELSE 0 END) AS d1_30,
		  SUM(CASE WHEN DATEDIFF(%(today)s, COALESCE(si.due_date, si.posting_date)) BETWEEN 31 AND 60
		           THEN si.outstanding_amount ELSE 0 END) AS d31_60,
		  SUM(CASE WHEN DATEDIFF(%(today)s, COALESCE(si.due_date, si.posting_date)) BETWEEN 61 AND 90
		           THEN si.outstanding_amount ELSE 0 END) AS d61_90,
		  SUM(CASE WHEN DATEDIFF(%(today)s, COALESCE(si.due_date, si.posting_date)) > 90
		           THEN si.outstanding_amount ELSE 0 END) AS d90p,
		  SUM(si.outstanding_amount) AS total
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND si.outstanding_amount > 0
		  AND si.customer_group IN %(groups)s
		""",
		{"today": today, "groups": tuple(groups)},
		as_dict=True,
	)[0]
	return {
		"current": flt(row.current_amt),
		"d1_30": flt(row.d1_30),
		"d31_60": flt(row.d31_60),
		"d61_90": flt(row.d61_90),
		"d90p": flt(row.d90p),
		"total": flt(row.total),
	}


def _rev_12m(groups, today) -> float:
	"""Doanh số 12 tháng gần nhất (loại opening) — cho DSO."""
	if not groups:
		return 0.0
	row = frappe.db.sql(
		"""
		SELECT SUM(si.net_total) AS amt
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(start)s AND %(today)s
		  AND si.customer_group IN %(groups)s
		""",
		{"start": add_months(getdate(today), -12), "today": today, "groups": tuple(groups)},
		as_dict=True,
	)[0]
	return flt(row.amt)


def _dso(total_debt, rev12):
	return round(total_debt / rev12 * 365, 1) if rev12 else None


def _top_debtors(groups, today, limit=20) -> list[dict]:
	if not groups:
		return []
	rows = frappe.db.sql(
		"""
		SELECT si.customer AS cust,
		       SUM(si.outstanding_amount) AS outstanding,
		       MAX(DATEDIFF(%(today)s, COALESCE(si.due_date, si.posting_date))) AS oldest_days
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND si.outstanding_amount > 0
		  AND si.customer_group IN %(groups)s
		GROUP BY si.customer
		ORDER BY outstanding DESC
		LIMIT %(limit)s
		""",
		{"today": today, "groups": tuple(groups), "limit": limit},
		as_dict=True,
	)
	names = customer_names([r.cust for r in rows])
	return [
		{
			"customer": r.cust,
			"customer_name": names.get(r.cust) or r.cust,
			"outstanding": flt(r.outstanding),
			"oldest_days": int(r.oldest_days or 0),
			"route": f"/khach/{r.cust}",
		}
		for r in rows
	]


@frappe.whitelist()
def get_debt_aging(channel=None):
	"""Aging buckets + theo kênh + top khách nợ + DSO. channel=None → toàn phòng."""
	_guard()
	today = getdate(nowdate())
	cmap = channel_map()
	all_groups = list(cmap.keys())
	groups = groups_of(channel) if channel else all_groups

	buckets = _aging_buckets(groups, today)
	dso = _dso(buckets["total"], _rev_12m(groups, today))

	by_channel = []
	for k in CHANNEL_KEYS:
		gb = groups_of(k)
		b = _aging_buckets(gb, today)
		by_channel.append(
			{"key": k, "label": CHANNEL_LABELS[k], **b, "dso": _dso(b["total"], _rev_12m(gb, today))}
		)

	return {
		"buckets": buckets,
		"by_channel": by_channel,
		"top": _top_debtors(groups, today, limit=20),
		"dso": dso,
	}
