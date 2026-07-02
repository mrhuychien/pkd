# -*- coding: utf-8 -*-
"""actions.get_action_queues — 5 hàng đợi hành động "hôm nay làm gì" (Mục 8).

qua_nhip (NPP quá nhịp tái đặt) · no_31_60 (nợ mới vào 31–60, mọi kênh) ·
rot_segment (NPP rớt phân khúc) · mt_im_lang (chuỗi MT im lặng) ·
thieu_sku (NPP thiếu SKU mix). Mỗi item có route để tap → drill-down khách.
Doanh số loại opening; công nợ giữ opening. Không margin.
"""

from __future__ import annotations

import frappe
from frappe.utils import flt, get_first_day, getdate, nowdate

from pkd.api._metrics import (
	SEGMENT_RANK,
	customer_names,
	order_stats,
	segment_map,
	sku_group_count,
)
from pkd.api.utils import _guard, get_settings, groups_of

# Metadata hiển thị mỗi queue.
QUEUE_META = {
	"qua_nhip": {"label": "Quá nhịp tái đặt (NPP)", "channel": "npp"},
	"no_31_60": {"label": "Nợ mới vào 31–60 ngày", "channel": "all"},
	"rot_segment": {"label": "Rớt phân khúc (NPP)", "channel": "npp"},
	"mt_im_lang": {"label": "Chuỗi MT im lặng", "channel": "mt"},
	"thieu_sku": {"label": "Thiếu SKU mix (NPP)", "channel": "npp"},
}

QUEUE_ORDER = ["qua_nhip", "no_31_60", "rot_segment", "mt_im_lang", "thieu_sku"]


def _route(customer: str) -> str:
	return f"/khach/{customer}"


def _q_qua_nhip(settings, today, limit) -> list[dict]:
	"""NPP: days_since > avg_cycle × hệ số quá nhịp (cần ≥2 đơn để có nhịp)."""
	npp = groups_of("npp")
	stats = order_stats(npp, today)
	hs = flt(settings.he_so_qua_nhip) or 1.5
	items = []
	for cust, s in stats.items():
		cyc = s["avg_cycle"]
		if cyc and cyc > 0 and s["days_since"] > cyc * hs:
			items.append(
				{
					"customer": cust,
					"metric": f"nhịp ~{round(cyc)}d",
					"value": int(s["days_since"]),
					"route": _route(cust),
				}
			)
	items.sort(key=lambda x: x["value"], reverse=True)
	return items[:limit]


def _q_no_31_60(today, all_groups, limit) -> list[dict]:
	"""Mọi kênh: khách có nợ trong bucket 31–60 ngày (giữ opening), sort tiền."""
	if not all_groups:
		return []
	rows = frappe.db.sql(
		"""
		SELECT si.customer AS cust, SUM(si.outstanding_amount) AS val
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND si.outstanding_amount > 0
		  AND DATEDIFF(%(today)s, COALESCE(si.due_date, si.posting_date)) BETWEEN 31 AND 60
		  AND si.customer_group IN %(groups)s
		GROUP BY si.customer
		ORDER BY val DESC
		LIMIT %(limit)s
		""",
		{"today": today, "groups": tuple(all_groups), "limit": limit},
		as_dict=True,
	)
	return [
		{"customer": r.cust, "metric": "₫ nợ 31–60d", "value": flt(r.val), "route": _route(r.cust)}
		for r in rows
	]


def _q_rot_segment(today, limit) -> list[dict]:
	"""NPP: segment hôm nay xấu hơn segment đầu tháng (anchor)."""
	npp = groups_of("npp")
	anchor = get_first_day(today)
	seg_now = segment_map(npp, today)
	seg_anchor = segment_map(npp, anchor)
	items = []
	for cust, now_seg in seg_now.items():
		from_seg = seg_anchor.get(cust)
		if not from_seg:
			continue
		drop = SEGMENT_RANK.get(now_seg, 0) - SEGMENT_RANK.get(from_seg, 0)
		if drop > 0:
			items.append(
				{
					"customer": cust,
					"metric": f"{from_seg} → {now_seg}",
					"value": drop,
					"route": _route(cust),
				}
			)
	items.sort(key=lambda x: x["value"], reverse=True)
	return items[:limit]


def _q_mt_im_lang(settings, today, limit) -> list[dict]:
	"""MT: chuỗi có đơn trước đây nhưng im lặng ≥ mt_ngay_im_lang ngày."""
	mt = groups_of("mt")
	stats = order_stats(mt, today)
	threshold = int(settings.mt_ngay_im_lang or 30)
	items = [
		{
			"customer": cust,
			"metric": "ngày im lặng",
			"value": int(s["days_since"]),
			"route": _route(cust),
		}
		for cust, s in stats.items()
		if s["days_since"] >= threshold
	]
	items.sort(key=lambda x: x["value"], reverse=True)
	return items[:limit]


def _q_thieu_sku(settings, today, limit) -> list[dict]:
	"""NPP đang hoạt động (90d) nhưng số nhóm hàng < sku_toi_thieu."""
	npp = groups_of("npp")
	min_sku = int(settings.sku_toi_thieu or 3)
	counts = sku_group_count(npp, 90, today)
	items = [
		{
			"customer": cust,
			"metric": f"{n}/{min_sku} nhóm",
			"value": n,
			"route": _route(cust),
		}
		for cust, n in counts.items()
		if n < min_sku
	]
	items.sort(key=lambda x: x["value"])  # ít nhóm nhất lên đầu
	return items[:limit]


def _compute_queues(channel: str | None, limit: int) -> list[dict]:
	"""Tính 5 queue (đầy đủ items). channel=None → tất cả; else lọc theo kênh (+ 'all')."""
	settings = get_settings()
	today = getdate(nowdate())
	all_groups = groups_of("npp") + groups_of("mt") + groups_of("dulich")

	raw = {
		"qua_nhip": _q_qua_nhip(settings, today, limit),
		"no_31_60": _q_no_31_60(today, all_groups, limit),
		"rot_segment": _q_rot_segment(today, limit),
		"mt_im_lang": _q_mt_im_lang(settings, today, limit),
		"thieu_sku": _q_thieu_sku(settings, today, limit),
	}

	# Enrich customer_name 1 query IN cho toàn bộ item.
	all_custs = [it["customer"] for items in raw.values() for it in items]
	names = customer_names(all_custs)

	queues = []
	for qid in QUEUE_ORDER:
		meta = QUEUE_META[qid]
		if channel and meta["channel"] not in (channel, "all"):
			continue
		items = raw[qid]
		for it in items:
			it["customer_name"] = names.get(it["customer"]) or it["customer"]
		queues.append(
			{
				"id": qid,
				"label": meta["label"],
				"channel": meta["channel"],
				"count": len(items),
				"items": items,
			}
		)
	return queues


def queue_counts(channel: str | None = None) -> dict:
	"""{queue_id: count} — dùng cho badge Tổng quan (overview.action_counts)."""
	return {q["id"]: q["count"] for q in _compute_queues(channel, limit=50)}


@frappe.whitelist()
def get_action_queues(channel=None):
	"""5 hàng đợi hành động, mỗi queue tối đa 50 item; item có route để drill-down."""
	_guard()
	return {"queues": _compute_queues(channel, limit=50)}
