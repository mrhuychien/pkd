# -*- coding: utf-8 -*-
"""Công nợ theo GL (port từ npp.api.outstanding — phần helper thuần).

Số dư GL (debit−credit) là nguồn CHUẨN cho "công nợ hiện tại": khoản thu chưa
đối trừ vẫn được tính, tránh cộng dồn outstanding của HĐ cũ đã được bù (cách cũ
làm overdue phình to). Tuổi nợ = phân bổ số dư GL vào các HĐ MỚI NHẤT.
Công nợ GIỮ opening (nợ thật). Không liên quan margin.
"""

from __future__ import annotations

import frappe
from frappe.utils import add_days, date_diff, flt, getdate


def gl_balance(customer: str) -> float:
	"""Số dư công nợ phải thu từ GL (debit − credit) của 1 khách."""
	return flt(frappe.db.sql(
		"SELECT COALESCE(SUM(debit-credit),0) FROM `tabGL Entry` "
		"WHERE is_cancelled=0 AND party_type='Customer' AND party=%s",
		(customer,))[0][0] or 0)


def gl_balances(customers) -> dict:
	"""Số dư công nợ GL theo TỪNG khách. customers: list/tuple mã KH."""
	customers = tuple(customers)
	if not customers:
		return {}
	return {r["k"]: flt(r["v"]) for r in frappe.db.sql(
		"SELECT party AS k, COALESCE(SUM(debit-credit),0) AS v FROM `tabGL Entry` "
		"WHERE is_cancelled=0 AND party_type='Customer' AND party IN %s GROUP BY party",
		(customers,), as_dict=True)}


def debt_breakdown(balance, invoices, today=None) -> dict:
	"""Phân bổ số dư GL vào các HĐ MỚI NHẤT (đối trừ HĐ cũ trước), chia tuổi nợ
	phần đã phân bổ. invoices: [{posting_date, due_date, outstanding_amount}].
	Trả {overdue, in_term, buckets{current,d1_30,d31_60,d61_90,over_90}}."""
	today = today or getdate()
	balance = flt(balance)
	buckets = {"current": 0.0, "d1_30": 0.0, "d31_60": 0.0, "d61_90": 0.0, "over_90": 0.0}
	if balance > 0:
		remaining = balance
		for inv in sorted(invoices, key=lambda x: getdate(x["posting_date"]), reverse=True):
			if remaining <= 0:
				break
			out = flt(inv.get("outstanding_amount"))
			if out <= 0:
				continue
			alloc = out if out <= remaining else remaining
			remaining -= alloc
			due = getdate(inv["due_date"]) if inv.get("due_date") else add_days(getdate(inv["posting_date"]), 30)
			age = date_diff(today, due)
			if age <= 0:
				buckets["current"] += alloc
			elif age <= 30:
				buckets["d1_30"] += alloc
			elif age <= 60:
				buckets["d31_60"] += alloc
			elif age <= 90:
				buckets["d61_90"] += alloc
			else:
				buckets["over_90"] += alloc
	in_term = buckets["current"]
	return {"overdue": max(0.0, balance - in_term), "in_term": in_term, "buckets": buckets}


def channel_debt(customers, today=None) -> dict:
	"""{customer: {balance, overdue, in_term, buckets}} — công nợ GL + tuổi nợ cho
	1 nhóm khách. Nguồn DUY NHẤT cho tổng hợp công nợ cấp kênh."""
	today = today or getdate()
	customers = tuple(customers)
	if not customers:
		return {}
	bal = gl_balances(customers)
	inv_by: dict = {}
	for r in frappe.db.sql(
		"SELECT customer, posting_date, due_date, outstanding_amount FROM `tabSales Invoice` "
		"WHERE docstatus=1 AND customer IN %s AND outstanding_amount>0 ORDER BY posting_date DESC",
		(customers,), as_dict=True):
		inv_by.setdefault(r["customer"], []).append(r)
	out = {}
	for c in customers:
		b = bal.get(c, 0.0)
		bd = debt_breakdown(b, inv_by.get(c, []), today)
		out[c] = {"balance": b, "overdue": bd["overdue"], "in_term": bd["in_term"], "buckets": bd["buckets"]}
	return out
