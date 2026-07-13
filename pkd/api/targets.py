# -*- coding: utf-8 -*-
"""targets — chỉ tiêu kênh × tháng, nhập ngay trong SPA (blueprint Mục 8, QĐ #2/#6).

get_targets (ma trận nhập) · save_target (upsert theo combo) · get_target_attainment
(target vs actual, đèn màu). Quyền = _guard() (ai trong phòng cũng nhập được).
Actual loại opening; pace không so cả kỳ (period-aligned theo tháng).
"""

from __future__ import annotations

import json

import frappe
from frappe.utils import flt, get_last_day, getdate, nowdate

from pkd.api.utils import (
	CHANNEL_KEYS,
	CHANNEL_LABELS,
	_guard,
	guard_target_write,
	channel_map,
	get_settings,
	pct,
)


def _roots():
	s = get_settings()
	return {"npp": s.kenh_npp, "mt": s.kenh_mt, "dulich": s.kenh_dulich}


def _root_to_key(roots):
	return {v: k for k, v in roots.items() if v}


@frappe.whitelist()
def get_targets(nam):
	"""Ma trận nhập: 12 tháng × 3 kênh (ô thiếu = null) + items để sửa trong modal."""
	_guard()
	nam = int(nam)
	roots = _roots()

	docs = {}
	for t in frappe.get_all(
		"Channel Sales Target",
		filters={"nam": nam},
		fields=["name", "thang", "kenh", "chi_tieu_thang", "ghi_chu"],
	):
		docs[(int(t.thang), t.kenh)] = t

	# Items của mọi target trong năm — 1 query gom theo parent.
	items_by_parent = {}
	names = [t.name for t in docs.values()]
	if names:
		for it in frappe.get_all(
			"Channel Sales Target Item",
			filters={"parent": ["in", names]},
			fields=["parent", "item_group", "chi_tieu"],
			order_by="idx asc",
		):
			items_by_parent.setdefault(it.parent, []).append(
				{"item_group": it.item_group, "chi_tieu": flt(it.chi_tieu)}
			)

	cells = []
	for thang in range(1, 13):
		for key in CHANNEL_KEYS:
			root = roots.get(key)
			t = docs.get((thang, root))
			cells.append(
				{
					"thang": thang,
					"kenh": key,
					"kenh_group": root,
					"label": CHANNEL_LABELS[key],
					"name": t.name if t else None,
					"chi_tieu_thang": flt(t.chi_tieu_thang) if t else None,
					"ghi_chu": (t.ghi_chu if t else None),
					"items": items_by_parent.get(t.name, []) if t else [],
				}
			)
	return {
		"nam": nam,
		"cells": cells,
		"channels": [{"key": k, "label": CHANNEL_LABELS[k], "group": roots.get(k)} for k in CHANNEL_KEYS],
	}


@frappe.whitelist()
def save_target(data):
	"""Upsert 1 ô chỉ tiêu theo combo (nam,thang,kenh). Validate ở controller (Mục 2.1)."""
	_guard()
	guard_target_write()   # cấp Quản lý kênh chỉ xem
	if isinstance(data, str):
		data = json.loads(data)

	nam = int(data["nam"])
	thang = str(data["thang"])
	kenh = data["kenh"]
	roots = _roots()
	# kenh nhận key ('npp'/...) hoặc group name → chuẩn hoá về group name (target.kenh lưu root).
	if kenh in CHANNEL_KEYS:
		kenh = roots.get(kenh)
	if not kenh:
		frappe.throw("Kênh không hợp lệ hoặc PKD Settings chưa cấu hình.")

	existing = frappe.db.exists("Channel Sales Target", {"nam": nam, "thang": thang, "kenh": kenh})
	doc = frappe.get_doc("Channel Sales Target", existing) if existing else frappe.new_doc("Channel Sales Target")
	if not existing:
		doc.nam = nam
		doc.thang = thang
		doc.kenh = kenh
	doc.chi_tieu_thang = flt(data.get("chi_tieu_thang"))
	doc.ghi_chu = data.get("ghi_chu")
	doc.set("items", [])
	for it in data.get("items") or []:
		if not it.get("item_group"):
			continue
		doc.append("items", {"item_group": it["item_group"], "chi_tieu": flt(it.get("chi_tieu"))})
	doc.save()  # controller validate (a)(b)(c)(d); user có role Sales Dashboard write/create

	return {
		"name": doc.name,
		"nam": doc.nam,
		"thang": int(doc.thang),
		"kenh": doc.kenh,
		"chi_tieu_thang": flt(doc.chi_tieu_thang),
		"items": [{"item_group": r.item_group, "chi_tieu": flt(r.chi_tieu)} for r in doc.items],
	}


def _month_pace(nam, thang, today):
	"""Nhịp kỳ vọng của (nam,thang) so với hôm nay (%)."""
	if nam < today.year or (nam == today.year and thang < today.month):
		return 100.0
	if nam > today.year or (nam == today.year and thang > today.month):
		return 0.0
	days_total = get_last_day(getdate(f"{nam}-{thang:02d}-01")).day
	return round(today.day / days_total * 100, 1)


def _actual_by_month_channel(nam, groups, cmap):
	"""{(thang, channel_key): doanh số} cho cả năm nam (loại opening)."""
	out = {}
	if not groups:
		return out
	rows = frappe.db.sql(
		"""
		SELECT MONTH(si.posting_date) AS m, si.customer_group AS grp, SUM(si.grand_total) AS amt
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND YEAR(si.posting_date) = %(nam)s
		  AND si.customer_group IN %(groups)s
		GROUP BY m, grp
		""",
		{"nam": nam, "groups": tuple(groups)},
		as_dict=True,
	)
	for r in rows:
		key = cmap.get(r.grp)
		if key:
			out[(int(r.m), key)] = out.get((int(r.m), key), 0.0) + flt(r.amt)
	return out


def _actual_by_item_group(nam, thang, groups):
	"""{item_group: doanh số dòng} cho (nam,thang) trong groups (loại opening)."""
	if not groups:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT sii.item_group AS ig, SUM(sii.amount) AS amt
		FROM `tabSales Invoice Item` sii
		JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND YEAR(si.posting_date) = %(nam)s AND MONTH(si.posting_date) = %(thang)s
		  AND si.customer_group IN %(groups)s
		GROUP BY sii.item_group
		""",
		{"nam": nam, "thang": thang, "groups": tuple(groups)},
		as_dict=True,
	)
	return {r.ig: flt(r.amt) for r in rows}


@frappe.whitelist()
def get_target_attainment(nam=None, thang=None):
	"""Ma trận target vs actual + đèn. thang=None → 12×3 (grid); có thang → thêm by_item_group."""
	_guard()
	today = getdate(nowdate())
	nam = int(nam) if nam else today.year
	roots = _roots()
	r2k = _root_to_key(roots)
	cmap = channel_map()
	all_groups = list(cmap.keys())

	# Targets theo (thang, channel_key).
	tgt = {}
	tfilters = {"nam": nam}
	if thang:
		tfilters["thang"] = str(int(thang))
	for t in frappe.get_all(
		"Channel Sales Target", filters=tfilters, fields=["thang", "kenh", "chi_tieu_thang", "name"]
	):
		key = r2k.get(t.kenh)
		if key:
			tgt[(int(t.thang), key)] = {"target": flt(t.chi_tieu_thang), "name": t.name}

	actual = _actual_by_month_channel(nam, all_groups, cmap)

	months = [int(thang)] if thang else list(range(1, 13))
	matrix = []
	for m in months:
		pace = _month_pace(nam, m, today)
		for key in CHANNEL_KEYS:
			target = tgt.get((m, key), {}).get("target")
			act = actual.get((m, key), 0.0)
			row = {
				"thang": m,
				"kenh": key,
				"label": CHANNEL_LABELS[key],
				"target": target,
				"actual": act,
				"attainment_pct": pct(act, target),
				"pace_pct": pace,
				"delta": (act - target) if target is not None else None,
			}
			if thang:  # chi tiết theo nhóm hàng cho 1 tháng
				row["by_item_group"] = _item_group_detail(nam, m, key, roots, tgt.get((m, key), {}).get("name"))
			matrix.append(row)

	return {"nam": nam, "thang": int(thang) if thang else None, "matrix": matrix}


def _item_group_detail(nam, thang, key, roots, target_name):
	"""[{item_group, target, actual, pct}] cho 1 ô (kênh × tháng)."""
	from pkd.api.utils import groups_of

	target_items = {}
	if target_name:
		for it in frappe.get_all(
			"Channel Sales Target Item",
			filters={"parent": target_name},
			fields=["item_group", "chi_tieu"],
		):
			target_items[it.item_group] = flt(it.chi_tieu)
	actual_items = _actual_by_item_group(nam, thang, groups_of(key))
	all_igs = set(target_items) | set(actual_items)
	out = []
	for ig in sorted(all_igs):
		tg = target_items.get(ig)
		ac = actual_items.get(ig, 0.0)
		out.append({"item_group": ig, "target": tg, "actual": ac, "pct": pct(ac, tg)})
	return out
