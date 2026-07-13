# -*- coding: utf-8 -*-
"""explore.get_revenue_breakdown — bóc tách doanh số/sản lượng linh hoạt (Mục 8).

AN TOÀN SQL: dimension chỉ nhận từ DIMS (whitelist dict cứng) → KHÔNG BAO GIỜ
nội suy input người dùng vào câu SQL. measure/compare/fmt cũng whitelist. Mọi
giá trị lọc (item_group, ngày, kênh) truyền qua tham số %s.
Doanh số loại opening; boxes = sii.qty WHERE uom IN box. Không margin.
"""

from __future__ import annotations

import csv
import io

import frappe
from frappe import _
from frappe.utils import flt, getdate

from pkd.api.utils import (
	BOX_UOMS,
	CHANNEL_KEYS,
	CHANNEL_LABELS,
	_guard,
	channel_map,
	groups_of,
	growth_pct,
	shift_range,
)

# Whitelist chiều phân tích → mảnh SQL CỐ ĐỊNH (không phải input người dùng).
DIMS = {
	"channel": {"level": "invoice", "sql": "si.customer_group", "special": "channel", "label": "Kênh"},
	"customer": {"level": "invoice", "sql": "si.customer", "lookup": "customer", "label": "Khách hàng"},
	"outlet": {
		"level": "invoice",
		"sql": "si.shipping_address_name",
		"require_channel": "mt",
		"label": "Siêu thị (địa chỉ giao)",
	},
	"item_group": {"level": "line", "sql": "sii.item_group", "label": "Nhóm hàng"},
	"item": {"level": "line", "sql": "sii.item_code", "lookup": "item", "label": "Mặt hàng"},
	"month": {"level": "invoice", "sql": "DATE_FORMAT(si.posting_date, '%%Y-%%m')", "label": "Tháng"},
	"territory": {"level": "invoice", "sql": "si.territory", "label": "Tỉnh/Khu vực"},
}
MEASURES = ("amount", "boxes")
COMPARES = (None, "", "prev", "yoy")
FORMATS = ("json", "csv")


def _series(cfg, measure, date_from, date_to, channel, item_group, limit) -> dict:
	"""Trả {key: value} cho 1 khoảng ngày. Mảnh SQL lấy từ cfg (whitelist)."""
	use_line = (measure == "boxes") or (item_group is not None) or (cfg["level"] == "line")
	params = {"df": date_from, "dt": date_to, "limit": int(limit)}
	where = [
		"si.docstatus = 1",
		"IFNULL(si.is_opening, 'No') != 'Yes'",
		"si.posting_date BETWEEN %(df)s AND %(dt)s",
	]
	if channel:
		params["groups"] = tuple(groups_of(channel)) or ("__none__",)
		where.append("si.customer_group IN %(groups)s")
	if item_group is not None:
		params["ig"] = item_group
		where.append("sii.item_group = %(ig)s")

	if measure == "boxes":
		val = "SUM(sii.qty)"
		params["uoms"] = tuple(BOX_UOMS)
		where.append("sii.uom IN %(uoms)s")
		frm = "`tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON si.name = sii.parent"
	elif use_line:
		val = "SUM(sii.net_amount)"
		frm = "`tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON si.name = sii.parent"
	else:
		val = "SUM(si.net_total)"
		frm = "`tabSales Invoice` si"

	grp = cfg["sql"]  # mảnh cố định từ whitelist DIMS
	# grp/val/frm đều là literal từ whitelist — an toàn; mọi giá trị đi qua %()s.
	q = (
		f"SELECT {grp} AS k, {val} AS v FROM {frm} "
		f"WHERE {' AND '.join(where)} "
		f"GROUP BY {grp} ORDER BY v DESC LIMIT %(limit)s"
	)
	rows = frappe.db.sql(q, params, as_dict=True)

	if cfg.get("special") == "channel":
		# Gộp customer_group → 3 kênh.
		cmap = channel_map()
		agg = {}
		for r in rows:
			key = cmap.get(r.k)
			if key:
				agg[key] = agg.get(key, 0.0) + flt(r.v)
		return agg
	return {r.k: flt(r.v) for r in rows if r.k is not None}


def _labels(dimension, cfg, keys) -> dict:
	"""Nhãn hiển thị cho các key (lookup customer/item; còn lại = chính key)."""
	if cfg.get("special") == "channel":
		return {k: CHANNEL_LABELS.get(k, k) for k in keys}
	lookup = cfg.get("lookup")
	if lookup == "customer":
		rows = frappe.get_all("Customer", filters={"name": ["in", list(keys)]}, fields=["name", "customer_name"])
		m = {r.name: r.customer_name for r in rows}
		return {k: m.get(k, k) for k in keys}
	if lookup == "item":
		rows = frappe.get_all("Item", filters={"name": ["in", list(keys)]}, fields=["name", "item_name"])
		m = {r.name: r.item_name for r in rows}
		return {k: m.get(k, k) for k in keys}
	return {k: (k if k not in (None, "") else "(trống)") for k in keys}


def _build_rows(dimension, cfg, measure, date_from, date_to, channel, item_group, compare, limit):
	main = _series(cfg, measure, date_from, date_to, channel, item_group, limit)
	prev = None
	if compare in ("prev", "yoy"):
		pf, pt = shift_range(date_from, date_to, compare)
		if pf and pt:
			prev = _series(cfg, measure, pf, pt, channel, item_group, limit)

	ordered = sorted(main.items(), key=lambda kv: kv[1], reverse=True)
	labels = _labels(dimension, cfg, [k for k, _ in ordered])
	rows = []
	for k, v in ordered:
		row = {"key": k, "label": labels.get(k, k), "value": flt(v)}
		if prev is not None:
			pv = flt(prev.get(k, 0.0))
			row["prev_value"] = pv
			row["growth_pct"] = growth_pct(v, pv)
		rows.append(row)
	return rows


def _to_csv(rows, dimension, measure, has_compare) -> str:
	buf = io.StringIO()
	w = csv.writer(buf)
	header = ["key", dimension, "amount" if measure == "amount" else "boxes"]
	if has_compare:
		header += ["prev_value", "growth_pct"]
	w.writerow(header)
	for r in rows:
		line = [r["key"], r["label"], r["value"]]
		if has_compare:
			line += [r.get("prev_value", ""), r.get("growth_pct", "")]
		w.writerow(line)
	return buf.getvalue()


@frappe.whitelist()
def get_revenue_breakdown(
	dimension,
	date_from,
	date_to,
	channel=None,
	item_group=None,
	measure="amount",
	compare=None,
	fmt="json",
	limit=500,
):
	"""Bóc tách theo `dimension`. Trả rows[{key,label,value,prev_value?,growth_pct?}]
	+ meta; fmt='csv' → {filename, csv}."""
	_guard()

	if dimension not in DIMS:
		frappe.throw(_("Chiều phân tích không hợp lệ: {0}").format(dimension))
	if measure not in MEASURES:
		frappe.throw(_("Đơn vị đo không hợp lệ: {0}").format(measure))
	if compare not in COMPARES:
		frappe.throw(_("Kiểu so sánh không hợp lệ: {0}").format(compare))
	if fmt not in FORMATS:
		frappe.throw(_("Định dạng không hợp lệ: {0}").format(fmt))
	if channel and channel not in CHANNEL_KEYS:
		frappe.throw(_("Kênh không hợp lệ: {0}").format(channel))

	cfg = DIMS[dimension]
	if cfg.get("require_channel") and channel != cfg["require_channel"]:
		frappe.throw(
			_("Chiều '{0}' yêu cầu chọn kênh '{1}'.").format(dimension, cfg["require_channel"])
		)

	date_from, date_to = getdate(date_from), getdate(date_to)
	compare = compare or None
	try:
		limit = max(1, min(int(limit), 2000))
	except (TypeError, ValueError):
		limit = 500

	rows = _build_rows(
		dimension, cfg, measure, date_from, date_to, channel, item_group, compare, limit
	)

	meta = {
		"measure": measure,
		"dimension": dimension,
		"dimension_label": cfg["label"],
		"period": {"from": str(date_from), "to": str(date_to)},
		"compare": compare,
	}

	if fmt == "csv":
		filename = f"pkd_{dimension}_{measure}_{date_from}_{date_to}.csv"
		return {"filename": filename, "csv": _to_csv(rows, dimension, measure, compare is not None)}

	return {"rows": rows, "meta": meta}
