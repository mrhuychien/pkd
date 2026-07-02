# -*- coding: utf-8 -*-
"""Chỉ số per-customer dùng chung: segment vòng đời, nhịp tái đặt, SKU mix.

Dùng bởi actions (hàng đợi), channel (dashboard kênh), customer (drill-down).
Mọi doanh số ở đây LOẠI is_opening + docstatus=1 (luật #1). Attribution theo
si.customer_group (snapshot). Không có margin/COGS ở bất kỳ đâu (QĐ #3).
"""

from __future__ import annotations

import frappe
from frappe.utils import add_days, flt, getdate

from pkd.api.utils import get_settings

# Xếp hạng segment từ TỐT → XẤU (để phát hiện "rớt segment").
SEGMENT_RANK = {
	"Tăng trưởng": 0,
	"Mới": 1,
	"Ổn định": 2,
	"Suy giảm": 3,
	"Ngủ đông": 4,
	"Mất": 5,
	"Chưa mua": 6,
}


def _classify(last_order, first_order, rev90, prev90, ref, settings) -> str:
	"""Segment 1 khách tại mốc `ref` (thứ tự ưu tiên theo frappe-sales-analytics)."""
	days_since = (ref - getdate(last_order)).days
	first_days = (ref - getdate(first_order)).days
	if days_since > settings.ngay_mat:
		return "Mất"
	if days_since > settings.ngay_ngu_dong:
		return "Ngủ đông"
	if first_days <= 90:
		return "Mới"
	if prev90 and flt(rev90) > flt(prev90) * settings.nguong_tang_truong:
		return "Tăng trưởng"
	if prev90 and flt(rev90) < flt(prev90) * settings.nguong_suy_giam:
		return "Suy giảm"
	return "Ổn định"


def segment_map(groups: list[str], ref_date) -> dict:
	"""{customer: segment} cho mọi khách CÓ ĐƠN thuộc `groups`, tính tại ref_date.

	(Khách "Chưa mua" không có trong map này — cần roster đầy đủ, xem
	customers_in_groups.)
	"""
	if not groups:
		return {}
	settings = get_settings()
	ref = getdate(ref_date)
	w90 = add_days(ref, -90)
	w180 = add_days(ref, -180)
	rows = frappe.db.sql(
		# Gom per-customer trong 1 query (tránh N+1): last/first order + rev cửa sổ 90/90.
		"""
		SELECT si.customer AS cust,
		       MAX(si.posting_date) AS last_order,
		       MIN(si.posting_date) AS first_order,
		       SUM(CASE WHEN si.posting_date > %(w90)s THEN si.grand_total ELSE 0 END) AS rev90,
		       SUM(CASE WHEN si.posting_date > %(w180)s AND si.posting_date <= %(w90)s
		                THEN si.grand_total ELSE 0 END) AS prev90
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date <= %(ref)s
		  AND si.customer_group IN %(groups)s
		GROUP BY si.customer
		""",
		{"w90": w90, "w180": w180, "ref": ref, "groups": tuple(groups)},
		as_dict=True,
	)
	return {
		r.cust: _classify(r.last_order, r.first_order, r.rev90, r.prev90, ref, settings)
		for r in rows
	}


def order_stats(groups: list[str], ref_date=None) -> dict:
	"""{customer: {orders, first_order, last_order, avg_cycle, days_since}} — nhịp tái đặt.

	avg_cycle = (last-first)/(orders-1) ngày; None nếu < 2 đơn.
	"""
	if not groups:
		return {}
	ref = getdate(ref_date) if ref_date else getdate(frappe.utils.nowdate())
	rows = frappe.db.sql(
		"""
		SELECT si.customer AS cust,
		       COUNT(*) AS orders,
		       MIN(si.posting_date) AS first_order,
		       MAX(si.posting_date) AS last_order
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date <= %(ref)s
		  AND si.customer_group IN %(groups)s
		GROUP BY si.customer
		""",
		{"ref": ref, "groups": tuple(groups)},
		as_dict=True,
	)
	out = {}
	for r in rows:
		first_o, last_o = getdate(r.first_order), getdate(r.last_order)
		span = (last_o - first_o).days
		avg_cycle = (span / (r.orders - 1)) if r.orders and r.orders > 1 else None
		out[r.cust] = {
			"orders": r.orders,
			"first_order": first_o,
			"last_order": last_o,
			"avg_cycle": avg_cycle,
			"days_since": (ref - last_o).days,
		}
	return out


def sku_group_count(groups: list[str], days: int, ref_date=None) -> dict:
	"""{customer: số nhóm hàng phân biệt} trong `days` ngày gần nhất (SKU mix NPP)."""
	if not groups:
		return {}
	ref = getdate(ref_date) if ref_date else getdate(frappe.utils.nowdate())
	start = add_days(ref, -int(days))
	rows = frappe.db.sql(
		"""
		SELECT si.customer AS cust, COUNT(DISTINCT sii.item_group) AS n
		FROM `tabSales Invoice Item` sii
		JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(start)s AND %(ref)s
		  AND si.customer_group IN %(groups)s
		GROUP BY si.customer
		""",
		{"start": start, "ref": ref, "groups": tuple(groups)},
		as_dict=True,
	)
	return {r.cust: r.n for r in rows}


def customers_in_groups(groups: list[str]) -> list[dict]:
	"""Roster khách hiện thuộc `groups` (Customer.customer_group hiện tại).

	Dùng cho coverage & "Chưa mua" — đây là ẢNH HIỆN TẠI (khác attribution
	doanh số theo snapshot hoá đơn), đúng ngữ nghĩa "khách của kênh bây giờ".
	"""
	if not groups:
		return []
	return frappe.get_all(
		"Customer",
		filters={"customer_group": ["in", groups], "disabled": 0},
		fields=["name", "customer_name"],
	)


def revenue_by_customer(groups: list[str], start, end) -> dict:
	"""{customer: doanh số grand_total} trong [start,end] (loại opening)."""
	if not groups:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT si.customer AS cust, SUM(si.grand_total) AS amt
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(s)s AND %(e)s
		  AND si.customer_group IN %(g)s
		GROUP BY si.customer
		""",
		{"s": start, "e": end, "g": tuple(groups)},
		as_dict=True,
	)
	return {r.cust: flt(r.amt) for r in rows}


def active_customers(groups: list[str], start, end) -> set:
	"""Tập customer có ít nhất 1 đơn (loại opening) trong [start,end]."""
	if not groups:
		return set()
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT si.customer AS cust
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(s)s AND %(e)s
		  AND si.customer_group IN %(g)s
		""",
		{"s": start, "e": end, "g": tuple(groups)},
		as_dict=True,
	)
	return {r.cust for r in rows}


def customer_names(names: list[str]) -> dict:
	"""{customer: customer_name} — 1 query IN, None-safe."""
	names = [n for n in set(names) if n]
	if not names:
		return {}
	rows = frappe.get_all(
		"Customer", filters={"name": ["in", names]}, fields=["name", "customer_name"]
	)
	return {r.name: r.customer_name for r in rows}
