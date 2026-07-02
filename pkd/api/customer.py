# -*- coding: utf-8 -*-
"""customer.get_customer_detail — hồ sơ 1 khách (blueprint Mục 8).

Quyền = _guard() (QĐ #2: trong phòng ai cũng xem như nhau, không scope theo khách).
Doanh số loại opening; công nợ giữ opening. Không margin. Display từ salep try/except.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_months, add_days, flt, get_first_day, getdate, nowdate

from pkd.api._metrics import _classify
from pkd.api.utils import _guard, channel_of_group, get_settings, iso, pct


def _series_12m_customer(customer, today):
	rows = frappe.db.sql(
		"""
		SELECT DATE_FORMAT(si.posting_date, '%%Y-%%m') AS ym, SUM(si.grand_total) AS amt
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1 AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.customer = %(c)s AND si.posting_date BETWEEN %(s)s AND %(e)s
		GROUP BY ym ORDER BY ym
		""",
		{"c": customer, "s": add_months(get_first_day(today), -11), "e": today},
		as_dict=True,
	)
	found = {r.ym: flt(r.amt) for r in rows}
	out = []
	for i in range(12):
		d = add_months(get_first_day(today), -(11 - i))
		ym = d.strftime("%Y-%m")
		out.append({"month": ym, "amount": found.get(ym, 0.0)})
	return out


def _rank(avg_monthly, settings):
	if avg_monthly >= flt(settings.hang_a_vnd):
		return "A"
	if avg_monthly >= flt(settings.hang_b_vnd):
		return "B"
	return "C"


@frappe.whitelist()
def get_customer_detail(customer):
	"""Hồ sơ + 12m + nhịp + segment + nợ + SKU mix + 20 HĐ + (MT: outlets) + display."""
	_guard()
	if not frappe.db.exists("Customer", customer):
		frappe.throw(_("Khách không tồn tại: {0}").format(customer))

	settings = get_settings()
	today = getdate(nowdate())
	cust = frappe.db.get_value(
		"Customer", customer, ["customer_name", "customer_group", "territory"], as_dict=True
	)
	channel = channel_of_group(cust.customer_group)

	# Thống kê per-customer (1 query).
	st = frappe.db.sql(
		"""
		SELECT COUNT(*) AS orders, MIN(si.posting_date) AS first_o, MAX(si.posting_date) AS last_o,
		       SUM(CASE WHEN si.posting_date > %(w90)s THEN si.grand_total ELSE 0 END) AS rev90,
		       SUM(CASE WHEN si.posting_date > %(w180)s AND si.posting_date <= %(w90)s THEN si.grand_total ELSE 0 END) AS prev90,
		       SUM(CASE WHEN si.posting_date > %(y1)s THEN si.grand_total ELSE 0 END) AS rev12
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1 AND IFNULL(si.is_opening, 'No') != 'Yes' AND si.customer = %(c)s
		""",
		{"c": customer, "w90": add_days(today, -90), "w180": add_days(today, -180), "y1": add_months(today, -12)},
		as_dict=True,
	)[0]

	orders = st.orders or 0
	avg_monthly = flt(st.rev12) / 12.0
	segment = "Chưa mua"
	cycle = {"avg_days": None, "last_order": None, "days_since": None, "qua_nhip": False}
	if orders and st.last_o:
		first_o, last_o = getdate(st.first_o), getdate(st.last_o)
		days_since = (today - last_o).days
		avg_cycle = ((last_o - first_o).days / (orders - 1)) if orders > 1 else None
		hs = flt(settings.he_so_qua_nhip) or 1.5
		cycle = {
			"avg_days": round(avg_cycle, 1) if avg_cycle else None,
			"last_order": iso(last_o),
			"days_since": days_since,
			"qua_nhip": bool(avg_cycle and days_since > avg_cycle * hs),
		}
		segment = _classify(last_o, first_o, st.rev90, st.prev90, today, settings)

	# Công nợ.
	debt_row = frappe.db.sql(
		"""
		SELECT
		  SUM(si.outstanding_amount) AS total,
		  SUM(CASE WHEN DATEDIFF(%(t)s, COALESCE(si.due_date, si.posting_date)) <= 0 THEN si.outstanding_amount ELSE 0 END) AS cur,
		  SUM(CASE WHEN DATEDIFF(%(t)s, COALESCE(si.due_date, si.posting_date)) BETWEEN 1 AND 30 THEN si.outstanding_amount ELSE 0 END) AS d1_30,
		  SUM(CASE WHEN DATEDIFF(%(t)s, COALESCE(si.due_date, si.posting_date)) BETWEEN 31 AND 60 THEN si.outstanding_amount ELSE 0 END) AS d31_60,
		  SUM(CASE WHEN DATEDIFF(%(t)s, COALESCE(si.due_date, si.posting_date)) BETWEEN 61 AND 90 THEN si.outstanding_amount ELSE 0 END) AS d61_90,
		  SUM(CASE WHEN DATEDIFF(%(t)s, COALESCE(si.due_date, si.posting_date)) > 90 THEN si.outstanding_amount ELSE 0 END) AS d90p
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1 AND si.outstanding_amount > 0 AND si.customer = %(c)s
		""",
		{"t": today, "c": customer},
		as_dict=True,
	)[0]
	debt = {
		"outstanding": flt(debt_row.total),
		"buckets": {
			"current": flt(debt_row.cur), "d1_30": flt(debt_row.d1_30), "d31_60": flt(debt_row.d31_60),
			"d61_90": flt(debt_row.d61_90), "d90p": flt(debt_row.d90p), "total": flt(debt_row.total),
		},
	}

	# SKU mix (12 tháng).
	sku_rows = frappe.db.sql(
		"""
		SELECT sii.item_group AS ig, SUM(sii.amount) AS amt
		FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE si.docstatus = 1 AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.customer = %(c)s AND si.posting_date > %(y1)s
		GROUP BY sii.item_group ORDER BY amt DESC LIMIT 12
		""",
		{"c": customer, "y1": add_months(today, -12)},
		as_dict=True,
	)
	sku_total = sum(flt(r.amt) for r in sku_rows)
	top_sku_mix = [{"item_group": r.ig, "amount": flt(r.amt), "pct": pct(r.amt, sku_total)} for r in sku_rows]

	# 20 HĐ gần nhất.
	invoices = [
		{
			"name": r.name,
			"posting_date": iso(r.posting_date),
			"grand_total": flt(r.grand_total),
			"outstanding": flt(r.outstanding_amount),
			"status": r.status,
		}
		for r in frappe.get_all(
			"Sales Invoice",
			filters={"customer": customer, "docstatus": 1},
			fields=["name", "posting_date", "grand_total", "outstanding_amount", "status"],
			order_by="posting_date desc",
			limit=20,
		)
	]

	result = {
		"profile": {
			"name": customer,
			"customer_name": cust.customer_name,
			"group": cust.customer_group,
			"channel": channel,
			"territory": cust.territory,
			"hang": _rank(avg_monthly, settings),
			"avg_monthly": avg_monthly,
			"orders": orders,
		},
		"series_12m": _series_12m_customer(customer, today),
		"cycle": cycle,
		"segment": segment,
		"debt": debt,
		"top_sku_mix": top_sku_mix,
		"invoices": invoices,
	}

	# MT: outlets theo shipping_address_name.
	if channel == "mt":
		result["outlets"] = _customer_outlets(customer, today)

	# Trưng bày (salep) — try/except.
	result["display"] = _display_for(customer)
	return result


def _customer_outlets(customer, today):
	rows = frappe.db.sql(
		"""
		SELECT si.shipping_address_name AS addr, SUM(si.grand_total) AS amt, MAX(si.posting_date) AS last_o
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1 AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.customer = %(c)s AND si.posting_date > %(y1)s
		GROUP BY si.shipping_address_name ORDER BY amt DESC
		""",
		{"c": customer, "y1": add_months(today, -12)},
		as_dict=True,
	)
	return [
		{"shipping_address_name": r.addr or "(không ghi địa chỉ)", "amount": flt(r.amt), "last_invoice": iso(r.last_o) if r.last_o else None}
		for r in rows
	]


def _display_for(customer):
	try:
		from salep.api.dashboard import npp_summary
	except ImportError:
		return {"available": False}
	try:
		rows = npp_summary(distributor=customer) or []
	except frappe.PermissionError:
		return {"available": True, "authorized_salep": False}
	row = rows[0] if rows else {}
	return {
		"available": True,
		"authorized_salep": True,
		"participations": int(row.get("total_participations") or 0),
		"approved": int(row.get("approved_participations") or 0),
		"distinct_points": int(row.get("distinct_points") or 0),
	}
