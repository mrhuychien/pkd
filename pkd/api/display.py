# -*- coding: utf-8 -*-
"""display.get_display_summary — wrapper đọc trưng bày từ app salep (blueprint Mục 7).

Chỉ HIỂN THỊ, zero DocType mới. Guard pkd (_guard) + guard salep (Channel Manager).
Nếu chưa cài salep → {available: False}; thiếu role salep → {available: True,
authorized_salep: False}. Decimal của salep có thể ra chuỗi → flt()/int() trước khi tính.
Doanh số ghép mức NPP là THAM KHẢO (không phải nhân quả) — UI ghi rõ.
"""

from __future__ import annotations

import frappe
from frappe.utils import flt

from pkd.api._metrics import customer_names
from pkd.api.utils import _guard, growth_pct, iso, pct, period_mtd, shift_period


def _revenue_for_customers(customers, start, end) -> dict:
	"""{customer: doanh số} cho danh sách customer cụ thể (loại opening)."""
	customers = [c for c in set(customers) if c]
	if not customers:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT si.customer AS cust, SUM(si.grand_total) AS amt
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(s)s AND %(e)s
		  AND si.customer IN %(c)s
		GROUP BY si.customer
		""",
		{"s": start, "e": end, "c": tuple(customers)},
		as_dict=True,
	)
	return {r.cust: flt(r.amt) for r in rows}


@frappe.whitelist()
def get_display_summary():
	"""Tiến độ chương trình trưng bày + rank NPP (kèm doanh số tham khảo) + rank NVBH."""
	_guard()

	try:
		from salep.api.dashboard import channel_summary
	except ImportError:
		# Bench chưa cài salep → view hiện empty state.
		return {"available": False}

	try:
		data = channel_summary()
	except frappe.PermissionError:
		# User thiếu role Channel Manager (salep guard). UI hướng dẫn cấp quyền.
		return {"available": True, "authorized_salep": False}

	# (b) tiến độ + ngân sách còn lại.
	programs = []
	for p in data.get("program_progress") or []:
		target = int(p.get("target_points") or 0)
		approved = int(p.get("approved") or 0)
		budget = flt(p.get("budget"))
		used = flt(p.get("budget_used"))
		programs.append(
			{
				"program": p.get("program"),
				"program_name": p.get("program_name"),
				"status": p.get("status"),
				"target_points": target,
				"approved": approved,
				"total": int(p.get("total") or 0),
				"budget": budget,
				"budget_used": used,
				"budget_remaining": budget - used,
				"progress_pct": pct(approved, target) if target else None,
			}
		)
	# "Đang chạy" lên đầu.
	status_rank = {"Đang chạy": 0, "Nháp": 1, "Kết thúc": 2}
	programs.sort(key=lambda x: status_rank.get(x["status"], 3))

	# (a)+(c) rank NPP: tên hiển thị + doanh số MTD tham khảo.
	rank_npp = data.get("rank_npp") or []
	top = rank_npp[:20]
	npp_ids = [r.get("npp") for r in top]
	names = customer_names(npp_ids)
	period = period_mtd()
	prev = shift_period(period, 1)
	rev_mtd = _revenue_for_customers(npp_ids, period["start"], period["end"])
	rev_prev = _revenue_for_customers(npp_ids, prev["start"], prev["end"])
	rank_npp_out = [
		{
			"npp": r.get("npp"),
			"customer_name": names.get(r.get("npp")) or r.get("npp"),
			"approved": int(r.get("approved") or 0),
			"revenue_mtd": flt(rev_mtd.get(r.get("npp"), 0.0)),
			"growth_pct": growth_pct(rev_mtd.get(r.get("npp"), 0.0), rev_prev.get(r.get("npp"), 0.0)),
			"route": f"/khach/{r.get('npp')}",
		}
		for r in top
	]

	rank_staff = [
		{
			"staff_user": r.get("staff_user"),
			"full_name": r.get("full_name") or r.get("staff_user"),
			"approved": int(r.get("approved") or 0),
		}
		for r in (data.get("rank_staff") or [])[:20]
	]

	return {
		"available": True,
		"authorized_salep": True,
		"programs": programs,
		"rank_npp": rank_npp_out,
		"rank_staff": rank_staff,
		"period": {"start": iso(period["start"]), "end": iso(period["end"])},
		"note": "Doanh số ghép ở mức NPP — tham khảo, không phải nhân quả (điểm lẻ nằm dưới NPP).",
	}
