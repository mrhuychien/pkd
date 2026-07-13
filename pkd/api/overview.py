# -*- coding: utf-8 -*-
"""overview.get_overview — Tổng quan toàn phòng (blueprint Mục 8).

Doanh số: docstatus=1 + loại is_opening. Công nợ (aging): giữ opening.
So kỳ period-aligned. Attribution theo si.customer_group. Không margin/COGS.
"""

from __future__ import annotations

import frappe
from frappe.utils import add_months, flt, getdate

from pkd.api.utils import (
	BOX_UOMS,
	CHANNEL_KEYS,
	CHANNEL_KEYS_EXT,
	CHANNEL_LABELS,
	_guard,
	channel_map,
	get_settings,
	growth_pct,
	iso,
	pace_pct,
	pct,
	period_mtd,
	run_rate,
	shift_period,
	tet_banner_info,
)


# ─── Helper truy vấn ─────────────────────────────────────────────────────────
def _rev_split_by_group(start, end) -> tuple[dict, dict]:
	"""({group: BÁN RA}, {group: TRẢ VỀ âm}) — net_total TRƯỚC thuế, tách is_return,
	quét TOÀN BỘ Sales Invoice (loại opening). Cùng gốc số với ô tháng Kinh doanh chung."""
	rows = frappe.db.sql(
		"""
		SELECT si.customer_group AS grp,
		       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN 0 ELSE si.net_total END), 0) AS gross,
		       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN si.net_total ELSE 0 END), 0) AS ret
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(start)s AND %(end)s
		GROUP BY si.customer_group
		""",
		{"start": start, "end": end},
		as_dict=True,
	)
	return {r.grp: flt(r.gross) for r in rows}, {r.grp: flt(r.ret) for r in rows}


def _rev_by_group(start, end) -> dict:
	"""{customer_group: THỰC BÁN net (bán ra + trả về)} — giữ cho code dùng net."""
	gross, ret = _rev_split_by_group(start, end)
	return {k: gross.get(k, 0.0) + ret.get(k, 0.0) for k in set(gross) | set(ret)}


def _boxes_by_group(start, end) -> dict:
	"""{customer_group: sản lượng thùng} — sii.qty WHERE uom IN BOX_UOMS (luật #4)."""
	rows = frappe.db.sql(
		"""
		SELECT si.customer_group AS grp, SUM(sii.qty) AS boxes
		FROM `tabSales Invoice Item` sii
		JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(start)s AND %(end)s
		  AND sii.uom IN %(uoms)s
		GROUP BY si.customer_group
		""",
		{"start": start, "end": end, "uoms": tuple(BOX_UOMS)},
		as_dict=True,
	)
	return {r.grp: flt(r.boxes) for r in rows}


def _to_channels(by_group: dict, cmap: dict) -> dict:
	"""Gộp {group: value} → {channel_key: value} qua channel_map.

	Đủ mọi kênh cấu hình (kể cả Showroom) + bucket "khac" cho group ngoài
	các cây (và hoá đơn không có customer_group)."""
	out = {k: 0.0 for k in (*CHANNEL_KEYS_EXT, "khac")}
	for grp, val in by_group.items():
		out[cmap.get(grp) or "khac"] += flt(val)
	return out


def _targets_by_channel(nam: int, thang: int) -> dict:
	"""{channel_key: chỉ tiêu tháng} từ Channel Sales Target (kenh lưu root group)."""
	settings = get_settings()
	root_to_key = {
		settings.kenh_npp: "npp",
		settings.kenh_mt: "mt",
		settings.kenh_dulich: "dulich",
		settings.get("kenh_showroom"): "showroom",
	}
	root_to_key.pop(None, None)
	out = {k: 0.0 for k in CHANNEL_KEYS_EXT}
	for t in frappe.get_all(
		"Channel Sales Target",
		filters={"nam": nam, "thang": str(thang)},
		fields=["kenh", "chi_tieu_thang"],
	):
		key = root_to_key.get(t.kenh)
		if key:
			out[key] += flt(t.chi_tieu_thang)
	return out


def _mix_item_group(start, end, limit: int = 10) -> list[dict]:
	"""Top nhóm hàng theo doanh số dòng trong kỳ — TOÀN BỘ Sales Invoice
	(toàn phòng không lọc theo cây kênh, kẻo rớt hoá đơn ngoài cây)."""
	rows = frappe.db.sql(
		"""
		SELECT sii.item_group AS item_group, SUM(sii.net_amount) AS amount
		FROM `tabSales Invoice Item` sii
		JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(start)s AND %(end)s
		GROUP BY sii.item_group
		ORDER BY amount DESC
		""",
		{"start": start, "end": end},
		as_dict=True,
	)
	total = sum(flt(r.amount) for r in rows)
	top = rows[:limit]
	out = [
		{"item_group": r.item_group, "amount": flt(r.amount), "pct": pct(r.amount, total)}
		for r in top
	]
	rest = total - sum(flt(r.amount) for r in top)
	if rest > 0 and len(rows) > limit:
		out.append({"item_group": "Khác", "amount": flt(rest), "pct": pct(rest, total)})
	return out


def _aging_total(today) -> dict:
	"""Aging công nợ TOÀN BỘ khách (COALESCE(due_date,posting_date)). GIỮ opening."""
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
		""",
		{"today": today},
		as_dict=True,
	)[0]
	total_debt = flt(row.total)
	# DSO = nợ / doanh số 12 tháng × 365 (doanh số loại opening).
	rev12 = _revenue_window(add_months(getdate(today), -12), today)
	dso = round(total_debt / rev12 * 365, 1) if rev12 else None
	return {
		"current": flt(row.current_amt),
		"d1_30": flt(row.d1_30),
		"d31_60": flt(row.d31_60),
		"d61_90": flt(row.d61_90),
		"d90p": flt(row.d90p),
		"total": total_debt,
		"dso": dso,
	}


def _revenue_window(start, end) -> float:
	"""Tổng doanh số TOÀN BỘ Sales Invoice trong [start,end] (loại opening) — cho DSO."""
	row = frappe.db.sql(
		"""
		SELECT SUM(si.net_total) AS amt
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(start)s AND %(end)s
		""",
		{"start": start, "end": end},
		as_dict=True,
	)[0]
	return flt(row.amt)


def _invoices_buyers(start, end) -> dict:
	"""Số hoá đơn + số khách mua trong kỳ — TOÀN BỘ Sales Invoice (loại opening)."""
	row = frappe.db.sql(
		"""
		SELECT COUNT(*) AS invoices, COUNT(DISTINCT si.customer) AS buyers
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(start)s AND %(end)s
		""",
		{"start": start, "end": end},
		as_dict=True,
	)[0]
	return {"invoices": row.invoices or 0, "buyers": row.buyers or 0}


# ─── API ─────────────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_overview():
	"""Tổng quan: period, total, channels[], mix nhóm hàng, aging, action_counts."""
	_guard()

	period = period_mtd()
	prev = shift_period(period, 1)
	yoy = shift_period(period, 12)
	cmap = channel_map()

	# Doanh số theo group cho 4 mốc + thùng. Headline = BÁN RA (gross, chưa trừ
	# trả về) — CÙNG GỐC với ô "bán ra theo tháng" của Kinh doanh chung để 2 số
	# khớp nhau; trả về/thực bán trả kèm để hiển thị phụ.
	g_mtd, r_mtd = _rev_split_by_group(period["start"], period["end"])
	ch_mtd = _to_channels(g_mtd, cmap)
	ch_ret = _to_channels(r_mtd, cmap)
	ch_prev = _to_channels(_rev_split_by_group(prev["start"], prev["end"])[0], cmap)
	ch_yoy = _to_channels(_rev_split_by_group(yoy["start"], yoy["end"])[0], cmap)
	ch_today = _to_channels(_rev_split_by_group(period["end"], period["end"])[0], cmap)
	ch_boxes = _to_channels(_boxes_by_group(period["start"], period["end"]), cmap)

	targets = _targets_by_channel(period["end"].year, period["end"].month)

	channels = []
	# 3 kênh chính + Showroom + Khác — kênh phụ chỉ so sánh chung, không view riêng.
	for k in (*CHANNEL_KEYS_EXT, "khac"):
		tgt = targets.get(k) or 0  # khac/showroom chưa đặt chỉ tiêu → 0
		channels.append(
			{
				"key": k,
				"label": CHANNEL_LABELS[k],
				"mtd": ch_mtd[k],                          # bán ra (cùng gốc toàn phòng)
				"returns_mtd": ch_ret[k],
				"net_mtd": ch_mtd[k] + ch_ret[k],
				"growth_pct": growth_pct(ch_mtd[k], ch_prev[k]),
				"yoy_pct": growth_pct(ch_mtd[k], ch_yoy[k]),
				"run_rate": run_rate(ch_mtd[k], period),
				"target": tgt,
				"attainment_pct": pct(ch_mtd[k], tgt),
				"boxes_mtd": ch_boxes[k],
			}
		)

	total_mtd = sum(ch_mtd.values())
	total_prev = sum(ch_prev.values())
	total_yoy = sum(ch_yoy.values())
	total_today = sum(ch_today.values())
	total_target = sum(v for v in targets.values() if v)
	ib = _invoices_buyers(period["start"], period["end"])

	total_returns = sum(ch_ret.values())
	total = {
		"today": total_today,
		"mtd": total_mtd,                       # BÁN RA — khớp ô tháng Kinh doanh chung
		"returns_mtd": total_returns,           # trả về (âm)
		"net_mtd": total_mtd + total_returns,   # thực bán
		"prev_mtd": total_prev,
		"growth_pct": growth_pct(total_mtd, total_prev),
		"yoy_pct": growth_pct(total_mtd, total_yoy),
		"run_rate": run_rate(total_mtd, period),
		"target": total_target,
		"attainment_pct": pct(total_mtd, total_target),
		"invoices": ib["invoices"],
		"buyers": ib["buyers"],
	}

	# Hàng đợi hành động — P0 chỉ count (đầy đủ items ở P1).
	from pkd.api.actions import queue_counts

	action_counts = queue_counts()

	return {
		"period": {
			"start": iso(period["start"]),
			"end": iso(period["end"]),
			"days_passed": period["days_passed"],
			"days_total": period["days_total"],
			"pace_pct": pace_pct(period),
		},
		"total": total,
		"channels": channels,
		"mix_item_group": _mix_item_group(period["start"], period["end"]),
		"aging_total": _aging_total(period["end"]),
		"action_counts": action_counts,
		"tet": tet_banner_info(period["end"], int(get_settings().tet_cua_so_ngay or 60)),
	}
