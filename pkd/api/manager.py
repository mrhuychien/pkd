# -*- coding: utf-8 -*-
"""Quản lý kênh — port từ npp.api.manager, CHANNEL-AWARE cho cả 3 kênh.

Mọi method nhận `channel` ('npp'|'mt'|'dulich') và giới hạn theo roster khách
hiện thuộc cây Customer Group của kênh (giống npp: lọc `customer IN names` —
per-customer analytics; KHÁC overview.py dùng snapshot si.customer_group).

Khác npp gốc:
- Guard = pkd (_guard: Sales Dashboard) thay MANAGER_ROLES.
- KHÔNG margin/COGS (blueprint QĐ #3) — mọi cột giá vốn bị loại từ tầng SQL.
- UOM thùng + ngưỡng hạng A/B + segment lấy từ PKD Settings (không hardcode).
- Mục tiêu/khách dùng field `custom_monthly_target` (Custom Field của app npp
  trên Customer) — nếu site chưa cài npp thì trả available=False, không vỡ.
Doanh số loại opening; công nợ GL giữ opening; so kỳ period-aligned.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import (
	add_days,
	add_months,
	date_diff,
	flt,
	get_first_day,
	get_last_day,
	getdate,
)

from pkd.api._debt_gl import channel_debt, debt_breakdown, gl_balance, gl_balances
from pkd.api.utils import BOX_UOMS, CHANNEL_KEYS, CHANNEL_LABELS, _guard, get_settings, groups_of

# Nhãn "đơn vị khách" theo kênh (hiển thị trong view).
CHANNEL_NOUN = {"npp": "NPP", "mt": "Chuỗi", "dulich": "Khách"}

# Trạng thái Hoạt động/Ngủ đông cho bảng overview (nhịp NGÀY — giữ 14 như npp;
# segment vòng đời dùng ngưỡng PKD Settings riêng).
DORMANT_DAYS = 14

# 63 tỉnh/thành — chuẩn hoá cột Tỉnh từ territory/tên KH; dài hơn match trước.
PROVINCES = sorted([
	"An Giang", "Bà Rịa - Vũng Tàu", "Bạc Liêu", "Bắc Giang", "Bắc Kạn", "Bắc Ninh",
	"Bến Tre", "Bình Dương", "Bình Định", "Bình Phước", "Bình Thuận", "Cà Mau",
	"Cao Bằng", "Cần Thơ", "Đà Nẵng", "Đắk Lắk", "Đắk Nông", "Điện Biên", "Đồng Nai",
	"Đồng Tháp", "Gia Lai", "Hà Giang", "Hà Nam", "Hà Nội", "Hà Tĩnh", "Hải Dương",
	"Hải Phòng", "Hậu Giang", "Hoà Bình", "Hòa Bình", "Hưng Yên", "Khánh Hòa",
	"Kiên Giang", "Kon Tum", "Lai Châu", "Lâm Đồng", "Lạng Sơn", "Lào Cai", "Long An",
	"Nam Định", "Nghệ An", "Ninh Bình", "Ninh Thuận", "Phú Thọ", "Phú Yên", "Quảng Bình",
	"Quảng Nam", "Quảng Ngãi", "Quảng Ninh", "Quảng Trị", "Sóc Trăng", "Sơn La",
	"Tây Ninh", "Thái Bình", "Thái Nguyên", "Thanh Hóa", "Thừa Thiên Huế", "Tiền Giang",
	"TP HCM", "Hồ Chí Minh", "Trà Vinh", "Tuyên Quang", "Vĩnh Long", "Vĩnh Phúc", "Yên Bái",
], key=len, reverse=True)

_GENERIC_TERR = {"", "vietnam", "việt nam", "viet nam", "all territories", "rest of the world"}


# ─── Helpers ─────────────────────────────────────────────────────────────────
def _check_channel(channel: str) -> str:
	if channel not in CHANNEL_KEYS:
		frappe.throw(_("Kênh không hợp lệ: {0}").format(channel))
	return channel


def _channel_customers(channel: str) -> list[dict]:
	"""Roster khách hiện thuộc cây group của kênh (name, customer_name, territory)."""
	groups = groups_of(channel)
	if not groups:
		return []
	return frappe.get_all(
		"Customer", filters={"customer_group": ["in", groups], "disabled": 0},
		fields=["name", "customer_name", "territory"], order_by="customer_name asc")


def _names_of(channel: str) -> tuple:
	return tuple(c["name"] for c in _channel_customers(channel))


def _sum_by_customer(query: str, params: tuple) -> dict:
	return {r["k"]: flt(r["v"]) for r in frappe.db.sql(query, params, as_dict=True)}


def _resolve_province(territory: str | None, name: str | None) -> str:
	"""Chuẩn hoá về tỉnh thật: ưu tiên territory (nếu không generic), else dò tên KH."""
	t = (territory or "").strip()
	if t and t.lower() not in _GENERIC_TERR:
		for p in PROVINCES:
			if p.lower() in t.lower():
				return _canon(p)
		return t
	nm = name or ""
	for p in PROVINCES:
		if p.lower() in nm.lower():
			return _canon(p)
	return "Khác"


def _canon(p: str) -> str:
	if p in ("Hồ Chí Minh",):
		return "TP HCM"
	if p == "Hoà Bình":
		return "Hòa Bình"
	return p


def _rank_thresholds():
	s = get_settings()
	return flt(s.hang_a_vnd) or 200_000_000, flt(s.hang_b_vnd) or 100_000_000


def _segment_of(last, first, days_since, r90, p90, today, settings) -> str:
	"""Segment vòng đời — ngưỡng từ PKD Settings (mặc định trùng npp: 30/90/1.2/0.8)."""
	if last is None:
		return "Chưa mua"
	if days_since > (settings.ngay_mat or 90):
		return "Mất"
	if days_since > (settings.ngay_ngu_dong or 30):
		return "Ngủ đông"
	if first and getdate(first) >= add_days(today, -90):
		return "Mới"
	if r90 > p90 * (settings.nguong_tang_truong or 1.2):
		return "Tăng trưởng"
	if r90 < p90 * (settings.nguong_suy_giam or 0.8):
		return "Suy giảm"
	return "Ổn định"


def _has_target_field() -> bool:
	"""Field custom_monthly_target (app npp) có trên Customer không?"""
	try:
		return bool(frappe.db.has_column("Customer", "custom_monthly_target"))
	except Exception:
		return False


def _meta(channel: str) -> dict:
	return {"channel": channel, "label": CHANNEL_LABELS[channel], "noun": CHANNEL_NOUN[channel]}


# ─── Overview ────────────────────────────────────────────────────────────────
@frappe.whitelist()
def overview(channel: str, months: int = 3) -> dict:
	"""Dashboard điều hành kênh + bảng phân tích từng khách (so-kỳ period-aligned)."""
	_guard()
	_check_channel(channel)
	settings = get_settings()
	rank_a, rank_b = _rank_thresholds()
	months = max(1, min(int(months or 3), 36))
	today = getdate()
	start = get_first_day(add_months(today, -(months - 1)))
	end = today  # kỳ hiện tại tính ĐẾN HÔM NAY (partial), không lấy cả tháng

	customers = _channel_customers(channel)
	if not customers:
		return {"meta": _meta(channel), "months": months, "customers": [], "totals": {},
			"growth": {}, "monthly": [], "by_group": [], "by_territory": [],
			"territory_clean": False, "risk": {}, "segments": {}, "concentration": {}}
	names = tuple(c["name"] for c in customers)

	def ch_rev(s, e) -> float:
		return flt(frappe.db.sql(
			"""SELECT COALESCE(SUM(grand_total),0) FROM `tabSales Invoice`
			   WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
			     AND IFNULL(is_opening,'No')!='Yes'""", (names, s, e))[0][0] or 0)

	# ── Per-customer (kỳ [start, today]) ────────────────────────────────
	rev_rows = frappe.db.sql(
		"""SELECT customer AS k, COALESCE(SUM(grand_total),0) AS revenue, COUNT(*) AS orders
		   FROM `tabSales Invoice`
		   WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
		     AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""",
		(names, start, end), as_dict=True)
	rev_map = {r["k"]: flt(r["revenue"]) for r in rev_rows}
	ord_map = {r["k"]: int(r["orders"]) for r in rev_rows}
	qty_map = _sum_by_customer(
		"""SELECT si.customer AS k, COALESCE(SUM(sii.qty),0) AS v
		   FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
		   WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
		     AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s GROUP BY si.customer""",
		(names, start, end, tuple(BOX_UOMS)))
	# Công nợ GL + tuổi nợ từng khách — nguồn chuẩn duy nhất.
	cd = channel_debt(names, today)
	fl_rows = frappe.db.sql(
		"SELECT customer AS k, MAX(posting_date) AS last, MIN(posting_date) AS first "
		"FROM `tabSales Invoice` WHERE docstatus=1 AND customer IN %s GROUP BY customer", (names,), as_dict=True)
	last_map = {r["k"]: r["last"] for r in fl_rows}
	first_map = {r["k"]: r["first"] for r in fl_rows}
	rev90 = _sum_by_customer(
		"""SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
		   WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
		     AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""",
		(names, add_days(today, -90), today))
	prev90 = _sum_by_customer(
		"""SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
		   WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
		     AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""",
		(names, add_days(today, -180), add_days(today, -90)))

	month = today.month
	is_tet = month >= 11 or month <= 2
	if is_tet:
		tet_year = today.year if month >= 11 else today.year - 1
		tet_map = _sum_by_customer(
			"""SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
			   WHERE docstatus=1 AND customer IN %s AND posting_date >= %s AND IFNULL(is_opening,'No')!='Yes'
			   GROUP BY customer""", (names, f"{tet_year}-11-01"))
		# Tết: cần TT = công nợ GL − 50% tổng HĐ mùa Tết
		req_of = lambda n: max(0.0, cd.get(n, {}).get("balance", 0.0) - tet_map.get(n, 0.0) * 0.5)  # noqa: E731
	else:
		req_of = lambda n: cd.get(n, {}).get("overdue", 0.0)  # noqa: E731

	rows = []
	t_rev = t_qty = t_debt = t_req = 0.0
	n_active = n_dormant = n_new = 0
	seg_count = {"Mới": 0, "Tăng trưởng": 0, "Ổn định": 0, "Suy giảm": 0, "Ngủ đông": 0, "Mất": 0, "Chưa mua": 0}
	terr: dict = {}
	resolved_ok = 0
	for c in customers:
		name = c["name"]
		rev = rev_map.get(name, 0.0); qty = qty_map.get(name, 0.0)
		debt = cd.get(name, {}).get("balance", 0.0); req = req_of(name)
		orders = ord_map.get(name, 0); last = last_map.get(name); first = first_map.get(name)
		days_since = date_diff(today, last) if last else None

		if last is None:
			status = "Chưa mua"
		elif days_since <= DORMANT_DAYS:
			status = "Hoạt động"; n_active += 1
		else:
			status = "Ngủ đông"; n_dormant += 1

		segment = _segment_of(last, first, days_since, rev90.get(name, 0.0), prev90.get(name, 0.0), today, settings)
		seg_count[segment] = seg_count.get(segment, 0) + 1

		is_new = bool(first and getdate(first) >= start)
		if is_new:
			n_new += 1

		avg_cycle = (date_diff(last, first) / (orders - 1)) if (orders and orders > 1 and first and last) else None
		hs = flt(settings.he_so_qua_nhip) or 1.5
		overdue_reorder = bool(avg_cycle and days_since is not None and days_since > avg_cycle * hs)

		avg_month = rev / months
		rank = "A" if avg_month >= rank_a else ("B" if avg_month >= rank_b else "C")
		province = _resolve_province(c.get("territory"), c["customer_name"])
		if province != "Khác":
			resolved_ok += 1
		t_rev += rev; t_qty += qty; t_debt += debt; t_req += req
		tv = terr.setdefault(province, {"territory": province, "revenue": 0.0, "debt": 0.0, "count": 0})
		tv["revenue"] += rev; tv["debt"] += debt; tv["count"] += 1
		rows.append({
			"customer": name, "customer_name": c["customer_name"], "territory": province,
			"revenue": rev, "qty": qty, "debt": debt, "required_payment": req,
			"orders": orders, "aov": (rev / orders) if orders else 0.0,
			"last_order": str(last) if last else None, "days_since": days_since,
			"status": status, "segment": segment, "rank": rank, "is_new": is_new,
			"avg_cycle": round(avg_cycle, 1) if avg_cycle else None, "overdue_reorder": overdue_reorder})

	# Pareto / tập trung rủi ro
	sorted_rev = sorted((r["revenue"] for r in rows), reverse=True)
	_tot = sum(sorted_rev) or 1
	cum = 0.0; kh_for_80 = 0
	for v in sorted_rev:
		cum += v; kh_for_80 += 1
		if cum >= _tot * 0.8:
			break
	concentration = {
		"top5_pct": sum(sorted_rev[:5]) / _tot * 100,
		"top10_pct": sum(sorted_rev[:10]) / _tot * 100,
		"npp_for_80": kh_for_80,
	}

	# So-kỳ PERIOD-ALIGNED (dời nguyên cửa sổ [start, today])
	prev_rev = ch_rev(add_months(start, -months), add_months(today, -months))
	ly_rev = ch_rev(add_months(start, -12), add_months(today, -12))

	mtd = ch_rev(get_first_day(today), today)
	dim = get_last_day(today).day
	run_rate = (mtd / today.day * dim) if today.day else mtd

	# Xu hướng 12 tháng + overlay cùng kỳ năm trước
	m24_start = get_first_day(add_months(today, -23))
	m_rev = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
		"""SELECT DATE_FORMAT(posting_date,'%%m/%%Y') AS m, COALESCE(SUM(grand_total),0) AS v
		   FROM `tabSales Invoice` WHERE docstatus=1 AND customer IN %s AND posting_date >= %s
		     AND IFNULL(is_opening,'No')!='Yes' GROUP BY m""", (names, m24_start), as_dict=True)}
	m_qty = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
		"""SELECT DATE_FORMAT(si.posting_date,'%%m/%%Y') AS m, COALESCE(SUM(sii.qty),0) AS v
		   FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
		   WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date >= %s
		     AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s GROUP BY m""",
		(names, get_first_day(add_months(today, -11)), tuple(BOX_UOMS)), as_dict=True)}
	monthly = []
	for offset in range(11, -1, -1):
		key = getdate(add_months(today, -offset)).strftime("%m/%Y")
		key_ly = getdate(add_months(today, -offset - 12)).strftime("%m/%Y")
		monthly.append({"month": key, "revenue": m_rev.get(key, 0.0), "qty": m_qty.get(key, 0.0),
			"revenue_ly": m_rev.get(key_ly, 0.0)})

	by_group = [
		{"item_group": r["item_group"], "revenue": flt(r["revenue"]), "qty": flt(r["qty"])}
		for r in frappe.db.sql(
			"""SELECT i.item_group, COALESCE(SUM(sii.amount),0) AS revenue, COALESCE(SUM(sii.qty),0) AS qty
			   FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
			   JOIN `tabItem` i ON sii.item_code=i.item_code
			   WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
			     AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s
			   GROUP BY i.item_group ORDER BY revenue DESC""", (names, start, end, tuple(BOX_UOMS)), as_dict=True)]

	overdue_total = sum(v["overdue"] for v in cd.values())
	over_90 = sum(v["buckets"]["over_90"] for v in cd.values())
	dso = (t_debt / t_rev * date_diff(end, start)) if t_rev and date_diff(end, start) else 0.0

	return {
		"meta": _meta(channel),
		"months": months,
		"policy": "tet" if is_tet else "normal",
		"customers": rows,
		"segments": seg_count,
		"concentration": concentration,
		"monthly": monthly,
		"by_group": by_group,
		"by_territory": sorted(terr.values(), key=lambda x: x["revenue"], reverse=True),
		"territory_clean": (resolved_ok / len(rows) >= 0.9) if rows else False,
		"totals": {
			"revenue": t_rev, "qty": t_qty, "debt": t_debt, "required_payment": t_req,
			"npp_count": len(rows), "active": n_active, "dormant": n_dormant, "new": n_new,
			"orders": sum(ord_map.values()),
			"aov": (t_rev / sum(ord_map.values())) if sum(ord_map.values()) else 0.0,
			"run_rate": run_rate, "dso": dso,
		},
		"growth": {
			"prev_revenue": prev_rev,
			"growth_pct": ((t_rev - prev_rev) / prev_rev * 100) if prev_rev else None,
			"ly_revenue": ly_rev,
			"yoy_pct": ((t_rev - ly_rev) / ly_rev * 100) if ly_rev else None,
		},
		"risk": {"overdue": overdue_total, "over_90": over_90, "dso": dso},
	}


# ─── Sản phẩm ────────────────────────────────────────────────────────────────
@frappe.whitelist()
def products(channel: str, months: int = 3) -> dict:
	"""Phân tích sản phẩm theo kênh: top, movers, độ phủ. KHÔNG margin (QĐ #3)."""
	_guard()
	_check_channel(channel)
	months = max(1, min(int(months or 3), 36))
	today = getdate()
	start = get_first_day(add_months(today, -(months - 1)))
	end = today
	prev_start = add_months(start, -months)
	prev_end = add_months(today, -months)
	names = _names_of(channel)
	if not names:
		return {"meta": _meta(channel), "months": months, "top": [], "groups": [],
			"coverage": [], "movers": {"up_abs": [], "up_pct": [], "down": [], "new": []}}

	cur = frappe.db.sql(
		"""SELECT sii.item_code, sii.item_name, i.item_group,
		          COALESCE(SUM(sii.amount),0) AS rev, COALESCE(SUM(sii.qty),0) AS qty
		   FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
		   JOIN `tabItem` i ON sii.item_code=i.item_code
		   WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
		     AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s
		   GROUP BY sii.item_code, sii.item_name, i.item_group ORDER BY rev DESC""",
		(names, start, end, tuple(BOX_UOMS)), as_dict=True)
	prev_rows = frappe.db.sql(
		"""SELECT sii.item_code, sii.item_name, COALESCE(SUM(sii.amount),0) AS rev
		   FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
		   WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
		     AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s
		   GROUP BY sii.item_code, sii.item_name""",
		(names, prev_start, prev_end, tuple(BOX_UOMS)), as_dict=True)
	prev = {r["item_code"]: flt(r["rev"]) for r in prev_rows}
	name_of = {r["item_code"]: r["item_name"] for r in prev_rows}
	top = []
	for r in cur:
		rev = flt(r["rev"]); p = prev.get(r["item_code"], 0.0)
		name_of[r["item_code"]] = r["item_name"]
		top.append({"item_code": r["item_code"], "item_name": r["item_name"], "item_group": r["item_group"],
			"revenue": rev, "qty": flt(r["qty"]),
			"prev_revenue": p, "growth_pct": ((rev - p) / p * 100) if p else None})

	# Movers: gộp SKU rớt về 0 + SKU mới
	cur_rev = {r["item_code"]: flt(r["rev"]) for r in cur}
	movers = []
	for code in set(cur_rev) | set(prev):
		rev = cur_rev.get(code, 0.0); p = prev.get(code, 0.0)
		movers.append({"item_code": code, "item_name": name_of.get(code, code),
			"revenue": rev, "prev_revenue": p, "delta": rev - p,
			"growth_pct": ((rev - p) / p * 100) if p else None})
	up_abs = sorted([m for m in movers if m["delta"] > 0], key=lambda x: x["delta"], reverse=True)[:10]
	up_pct = sorted([m for m in movers if m["growth_pct"] is not None and m["growth_pct"] > 0],
		key=lambda x: x["growth_pct"], reverse=True)[:10]
	down = sorted([m for m in movers if m["delta"] < 0], key=lambda x: x["delta"])[:10]
	new_skus = sorted([m for m in movers if m["prev_revenue"] == 0 and m["revenue"] > 0],
		key=lambda x: x["revenue"], reverse=True)[:10]

	total_kh = len(names)
	coverage = sorted([
		{"item_code": r["item_code"], "item_name": r["item_name"], "buyers": int(r["buyers"]),
		 "total_npp": total_kh, "missing": total_kh - int(r["buyers"]), "revenue": flt(r["rev"]),
		 "coverage_pct": (int(r["buyers"]) / total_kh * 100) if total_kh else 0}
		for r in frappe.db.sql(
			"""SELECT sii.item_code, sii.item_name, COUNT(DISTINCT si.customer) AS buyers,
			          COALESCE(SUM(sii.amount),0) AS rev
			   FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
			   WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
			     AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s
			   GROUP BY sii.item_code, sii.item_name""", (names, start, end, tuple(BOX_UOMS)), as_dict=True)
		if int(r["buyers"]) < total_kh],
		key=lambda x: (x["coverage_pct"], -x["revenue"]))[:40]

	groups = [
		{"item_group": r["item_group"], "revenue": flt(r["rev"]), "qty": flt(r["qty"]),
		 "buyers": int(r["buyers"]), "total_npp": total_kh,
		 "coverage_pct": (int(r["buyers"]) / total_kh * 100) if total_kh else 0}
		for r in frappe.db.sql(
			"""SELECT i.item_group, COALESCE(SUM(sii.amount),0) AS rev, COALESCE(SUM(sii.qty),0) AS qty,
			          COUNT(DISTINCT si.customer) AS buyers
			   FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
			   JOIN `tabItem` i ON sii.item_code=i.item_code
			   WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
			     AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s
			   GROUP BY i.item_group ORDER BY rev DESC""", (names, start, end, tuple(BOX_UOMS)), as_dict=True)]
	return {"meta": _meta(channel), "months": months, "top": top, "groups": groups, "coverage": coverage,
		"movers": {"up_abs": up_abs, "up_pct": up_pct, "down": down, "new": new_skus}}


@frappe.whitelist()
def sku_white_space(channel: str, item_code: str, months: int = 3) -> list[dict]:
	"""Khách kênh có doanh số trong kỳ nhưng CHƯA mua `item_code` → cần thúc đẩy."""
	_guard()
	_check_channel(channel)
	months = max(1, min(int(months or 3), 36))
	today = getdate()
	start = get_first_day(add_months(today, -(months - 1)))
	end = today
	names = _names_of(channel)
	if not names or not item_code:
		return []
	bought = {r[0] for r in frappe.db.sql(
		"""SELECT DISTINCT si.customer FROM `tabSales Invoice Item` sii
		   JOIN `tabSales Invoice` si ON sii.parent=si.name
		   WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
		     AND sii.item_code=%s AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s""",
		(names, start, end, item_code, tuple(BOX_UOMS)))}
	rev_rows = frappe.db.sql(
		"""SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
		   WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
		     AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""", (names, start, end), as_dict=True)
	info = {c["name"]: c for c in frappe.get_all(
		"Customer", filters={"name": ["in", list(names)]}, fields=["name", "customer_name"])}
	out = [{"customer": r["k"], "customer_name": (info.get(r["k"]) or {}).get("customer_name") or r["k"],
		"revenue": flt(r["v"])} for r in rev_rows if r["k"] not in bought and flt(r["v"]) > 0]
	out.sort(key=lambda x: x["revenue"], reverse=True)
	return out


@frappe.whitelist()
def white_space(channel: str, item_group: str, months: int = 3) -> list[dict]:
	"""Khách kênh đang phát sinh doanh số nhưng CHƯA mua nhóm `item_group` → cross-sell."""
	_guard()
	_check_channel(channel)
	months = max(1, min(int(months or 3), 36))
	today = getdate()
	start = get_first_day(add_months(today, -(months - 1)))
	end = today
	names = _names_of(channel)
	if not names or not item_group:
		return []
	bought = {r[0] for r in frappe.db.sql(
		"""SELECT DISTINCT si.customer FROM `tabSales Invoice Item` sii
		   JOIN `tabSales Invoice` si ON sii.parent=si.name JOIN `tabItem` i ON sii.item_code=i.item_code
		   WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
		     AND i.item_group=%s AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s""",
		(names, start, end, item_group, tuple(BOX_UOMS)))}
	rev_rows = frappe.db.sql(
		"""SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
		   WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
		     AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""", (names, start, end), as_dict=True)
	info = {c["name"]: c for c in frappe.get_all(
		"Customer", filters={"name": ["in", list(names)]}, fields=["name", "customer_name", "territory"])}
	out = [{"customer": r["k"], "customer_name": (info.get(r["k"]) or {}).get("customer_name") or r["k"],
		"territory": _resolve_province((info.get(r["k"]) or {}).get("territory"), (info.get(r["k"]) or {}).get("customer_name")),
		"revenue": flt(r["v"])}
		for r in rev_rows if r["k"] not in bought and flt(r["v"]) > 0]
	out.sort(key=lambda x: x["revenue"], reverse=True)
	return out


# ─── Mục tiêu theo khách (field custom_monthly_target của app npp) ──────────
@frappe.whitelist()
def targets(channel: str, months: int = 1) -> dict:
	"""% hoàn thành mục tiêu/khách. So theo TIẾN ĐỘ (pace), không so target cả kỳ."""
	_guard()
	_check_channel(channel)
	if not _has_target_field():
		return {"meta": _meta(channel), "available": False,
			"message": "Site chưa có field custom_monthly_target (app npp). Dùng Chỉ tiêu kênh ở #/chitieu."}
	months = max(1, min(int(months or 1), 36))
	today = getdate()
	start = get_first_day(add_months(today, -(months - 1)))
	end = today
	groups = groups_of(channel)
	customers = frappe.get_all(
		"Customer", filters={"customer_group": ["in", groups], "disabled": 0},
		fields=["name", "customer_name", "territory", "custom_monthly_target"], order_by="customer_name asc") if groups else []
	if not customers:
		return {"meta": _meta(channel), "available": True, "months": months, "rows": [], "totals": {}, "expected_pace_pct": 0}
	names = tuple(c["name"] for c in customers)
	rev_map = _sum_by_customer(
		"""SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
		   WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
		     AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""", (names, start, end))
	# Gợi ý target: TB doanh số 3 tháng gần nhất × 1.1
	sug_map = _sum_by_customer(
		"""SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
		   WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
		     AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""",
		(names, get_first_day(add_months(today, -2)), today))
	total_days = (months - 1) * 30 + get_last_day(today).day
	elapsed_days = (months - 1) * 30 + today.day
	expected_pace = (elapsed_days / total_days * 100) if total_days else 0
	rows = []
	t_target = t_rev = 0.0
	for c in customers:
		monthly_t = flt(c.get("custom_monthly_target"))
		target = monthly_t * months
		rev = rev_map.get(c["name"], 0.0)
		t_target += target; t_rev += rev
		rows.append({"customer": c["name"], "customer_name": c["customer_name"],
			"territory": _resolve_province(c.get("territory"), c["customer_name"]),
			"monthly_target": monthly_t, "target": target, "revenue": rev,
			"suggested": round(sug_map.get(c["name"], 0.0) / 3 * 1.1, -3),
			"attainment_pct": (rev / target * 100) if target else None})
	rows.sort(key=lambda x: (x["attainment_pct"] is None, x["attainment_pct"] or 0))
	return {"meta": _meta(channel), "available": True, "months": months, "rows": rows,
		"expected_pace_pct": expected_pace,
		"totals": {"target": t_target, "revenue": t_rev,
			"attainment_pct": (t_rev / t_target * 100) if t_target else None}}


@frappe.whitelist()
def set_target(customer: str, amount) -> dict:
	"""Nhập/cập nhật mục tiêu doanh số THÁNG cho 1 khách."""
	_guard()
	if not _has_target_field():
		frappe.throw(_("Site chưa có field custom_monthly_target (cài app npp trước)."))
	if not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer không tồn tại: {0}").format(customer))
	frappe.db.set_value("Customer", customer, "custom_monthly_target", flt(amount))
	return {"customer": customer, "monthly_target": flt(amount)}


@frappe.whitelist()
def set_targets_bulk(data) -> dict:
	"""Nhập target hàng loạt: data = [{customer, amount}]."""
	_guard()
	if not _has_target_field():
		frappe.throw(_("Site chưa có field custom_monthly_target (cài app npp trước)."))
	if isinstance(data, str):
		data = frappe.parse_json(data)
	n = 0
	for row in (data or []):
		cust = (row.get("customer") or "").strip()
		if cust and frappe.db.exists("Customer", cust):
			frappe.db.set_value("Customer", cust, "custom_monthly_target", flt(row.get("amount")))
			n += 1
	return {"updated": n}


def _acc(d: dict, k: str, v: float) -> None:
	d[k] = d.get(k, 0.0) + v


# ─── Công nợ ─────────────────────────────────────────────────────────────────
@frappe.whitelist()
def receivables(channel: str) -> dict:
	"""Aging kênh + top khách nợ quá hạn + % dùng hạn mức tín dụng (công nợ GL)."""
	_guard()
	_check_channel(channel)
	today = getdate()
	names = _names_of(channel)
	if not names:
		return {"meta": _meta(channel), "buckets": {}, "top": [], "credit": [], "totals": {}}

	cd = channel_debt(names, today)
	buckets = {"current": 0.0, "d1_30": 0.0, "d31_60": 0.0, "d61_90": 0.0, "over_90": 0.0}
	overdue_by: dict = {}
	total_debt = 0.0
	for c, v in cd.items():
		total_debt += v["balance"]
		for k in buckets:
			buckets[k] += v["buckets"][k]
		if v["overdue"] > 0:
			overdue_by[c] = v["overdue"]
	total_overdue = sum(overdue_by.values())

	info = {c["name"]: c for c in frappe.get_all(
		"Customer", filters={"name": ["in", list(names)]}, fields=["name", "customer_name", "territory"])}
	top = sorted([
		{"customer": k, "customer_name": (info.get(k) or {}).get("customer_name") or k,
		 "territory": _resolve_province((info.get(k) or {}).get("territory"), (info.get(k) or {}).get("customer_name")),
		 "overdue": v} for k, v in overdue_by.items()], key=lambda x: x["overdue"], reverse=True)[:20]

	credit = []
	try:
		lim: dict = {}
		for r in frappe.get_all("Customer Credit Limit",
				filters={"parenttype": "Customer", "parent": ["in", list(names)]},
				fields=["parent", "credit_limit"]):
			_acc(lim, r["parent"], flt(r["credit_limit"]))
		for k, climit in lim.items():
			if climit <= 0:
				continue
			out = max(0.0, cd.get(k, {}).get("balance", 0.0))
			credit.append({"customer": k, "customer_name": (info.get(k) or {}).get("customer_name") or k,
				"credit_limit": climit, "outstanding": out, "usage_pct": out / climit * 100})
		credit.sort(key=lambda x: x["usage_pct"], reverse=True)
	except Exception:
		credit = []
	return {"meta": _meta(channel), "buckets": buckets, "top": top, "credit": credit,
		"totals": {"debt": total_debt, "overdue": total_overdue,
			"current": buckets["current"], "npp_with_debt": len(overdue_by)}}


# ─── Cảnh báo / Action center ────────────────────────────────────────────────
@frappe.whitelist()
def insights(channel: str) -> dict:
	"""Cảnh báo hành động — 1 dòng/khách (cờ nặng nhất). MTD-aligned."""
	_guard()
	_check_channel(channel)
	today = getdate()
	names = _names_of(channel)
	if not names:
		return {"meta": _meta(channel), "alerts": []}

	last = {r["k"]: r["v"] for r in frappe.db.sql(
		"SELECT customer AS k, MAX(posting_date) AS v FROM `tabSales Invoice` "
		"WHERE docstatus=1 AND customer IN %s GROUP BY customer", (names,), as_dict=True)}
	info = {c["name"]: c for c in frappe.get_all(
		"Customer", filters={"name": ["in", list(names)]}, fields=["name", "customer_name", "territory"])}
	debt_map = gl_balances(names)

	elapsed = today.day
	this_start = get_first_day(today)
	prev_first = get_first_day(add_months(today, -1))
	prev_end = add_days(prev_first, elapsed - 1)
	this_mtd = _sum_by_customer(
		"SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice` "
		"WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer",
		(names, this_start, today))
	prev_mtd = _sum_by_customer(
		"SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice` "
		"WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer",
		(names, prev_first, prev_end))

	alerts = []
	for c in names:
		nm = (info.get(c) or {}).get("customer_name") or c
		terr = _resolve_province((info.get(c) or {}).get("territory"), nm)
		last_d = last.get(c)
		debt = debt_map.get(c, 0.0)
		days = date_diff(today, last_d) if last_d else None

		if debt > 0 and days is not None and days > 30:
			alerts.append({"type": "debt_risk", "level": "danger", "customer": c, "customer_name": nm,
				"territory": terr, "value": debt,
				"message": f"Còn nợ {debt:,.0f}đ nhưng đã {days} ngày không mua"})
		elif last_d is not None and days is not None and days > DORMANT_DAYS:
			alerts.append({"type": "dormant", "level": "warning", "customer": c, "customer_name": nm,
				"territory": terr, "value": debt,
				"message": f"Ngủ đông — {days} ngày chưa đặt hàng"})
		else:
			pr = prev_mtd.get(c, 0.0)
			tr = this_mtd.get(c, 0.0)
			if pr > 0 and tr < pr * 0.5:
				drop = (1 - tr / pr) * 100
				alerts.append({"type": "declining", "level": "warning", "customer": c, "customer_name": nm,
					"territory": terr, "value": pr - tr,
					"message": f"DS {elapsed} ngày đầu tháng giảm {drop:.0f}% so cùng kỳ tháng trước"})

	order = {"danger": 0, "warning": 1, "info": 2}
	alerts.sort(key=lambda a: (order.get(a["level"], 9), -a["value"]))
	return {"meta": _meta(channel), "alerts": alerts}


@frappe.whitelist()
def action_center(channel: str) -> dict:
	"""1 dòng/khách: health score + giá trị rủi ro + hành động gợi ý. Sort theo rủi ro."""
	_guard()
	_check_channel(channel)
	settings = get_settings()
	today = getdate()
	names = _names_of(channel)
	if not names:
		return {"meta": _meta(channel), "rows": []}
	cust = {c["name"]: c for c in frappe.get_all(
		"Customer", filters={"name": ["in", list(names)]}, fields=["name", "customer_name", "territory"])}
	fl = {r["k"]: r for r in frappe.db.sql(
		"SELECT customer AS k, MAX(posting_date) AS last, MIN(posting_date) AS first, COUNT(*) AS orders "
		"FROM `tabSales Invoice` WHERE docstatus=1 AND customer IN %s GROUP BY customer", (names,), as_dict=True)}
	cd = channel_debt(names, today)
	rev90 = _sum_by_customer(
		"SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice` "
		"WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer",
		(names, add_days(today, -90), today))
	prev90 = _sum_by_customer(
		"SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice` "
		"WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer",
		(names, add_days(today, -180), add_days(today, -90)))

	hs = flt(settings.he_so_qua_nhip) or 1.5
	rows = []
	for c in names:
		info = cust.get(c, {})
		flc = fl.get(c, {})
		last = flc.get("last"); first = flc.get("first"); orders = int(flc.get("orders") or 0)
		days_since = date_diff(today, last) if last else None
		_cd = cd.get(c, {}); d = _cd.get("balance", 0.0); od = _cd.get("overdue", 0.0)
		o90 = _cd.get("buckets", {}).get("over_90", 0.0)
		r90 = rev90.get(c, 0.0); p90 = prev90.get(c, 0.0)

		seg = _segment_of(last, first, days_since, r90, p90, today, settings)

		avg_cycle = (date_diff(last, first) / (orders - 1)) if (orders > 1 and first and last) else None
		overdue_reorder = bool(avg_cycle and days_since is not None and days_since > avg_cycle * hs)

		health = 100
		if seg == "Mất":
			health -= 50
		elif seg == "Ngủ đông":
			health -= 30
		elif seg == "Suy giảm":
			health -= 20
		if od > 0:
			health -= 20
		if o90 > 0:
			health -= 15
		if overdue_reorder:
			health -= 10
		health = max(0, min(100, health))

		losing = (r90 / 3.0) if seg in ("Suy giảm", "Ngủ đông", "Mất") else 0.0
		risk_value = od + losing

		if od > 0:
			action = "Gọi thu nợ"
		elif seg in ("Ngủ đông", "Mất"):
			action = "Chào tái đặt / thăm"
		elif seg == "Suy giảm":
			action = "Tìm hiểu & đẩy KM"
		elif overdue_reorder:
			action = "Nhắc tái đặt"
		else:
			action = "Theo dõi"

		# Bỏ qua khách khỏe, không rủi ro
		if risk_value <= 0 and health >= 85 and not overdue_reorder:
			continue

		rows.append({
			"customer": c, "customer_name": info.get("customer_name") or c,
			"territory": _resolve_province(info.get("territory"), info.get("customer_name")),
			"segment": seg, "health": health, "debt": d, "overdue": od, "over90": o90,
			"days_since": days_since, "avg_cycle": round(avg_cycle, 1) if avg_cycle else None,
			"risk_value": risk_value, "action": action,
		})

	rows.sort(key=lambda x: x["risk_value"], reverse=True)
	return {"meta": _meta(channel), "rows": rows}


# ─── SKU chậm / chiều sâu danh mục ───────────────────────────────────────────
@frappe.whitelist()
def slow_skus(channel: str, days: int = 60) -> list[dict]:
	"""SKU từng bán (12 tháng) trong kênh nhưng KHÔNG phát sinh đơn trong `days` ngày."""
	_guard()
	_check_channel(channel)
	days = max(7, min(int(days or 60), 365))
	today = getdate()
	names = _names_of(channel)
	if not names:
		return []
	recent = {r[0] for r in frappe.db.sql(
		"SELECT DISTINCT sii.item_code FROM `tabSales Invoice Item` sii "
		"JOIN `tabSales Invoice` si ON sii.parent=si.name "
		"WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date >= %s AND sii.uom IN %s",
		(names, add_days(today, -days), tuple(BOX_UOMS)))}
	rows = frappe.db.sql(
		"""SELECT sii.item_code, sii.item_name, MAX(si.posting_date) AS last_sold, COALESCE(SUM(sii.qty),0) AS qty
		   FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
		   WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date >= %s AND sii.uom IN %s
		   GROUP BY sii.item_code, sii.item_name ORDER BY last_sold ASC""",
		(names, add_days(today, -365), tuple(BOX_UOMS)), as_dict=True)
	return [
		{"item_code": r["item_code"], "item_name": r["item_name"], "last_sold": str(r["last_sold"]),
		 "qty": flt(r["qty"]), "days_since": date_diff(today, r["last_sold"])}
		for r in rows if r["item_code"] not in recent
	]


@frappe.whitelist()
def catalog_depth(channel: str, months: int = 3, thin: int = 5) -> dict:
	"""Số SKU phân biệt mỗi khách mua (chiều sâu danh mục) — cờ 'mỏng danh mục'."""
	_guard()
	_check_channel(channel)
	months = max(1, min(int(months or 3), 36))
	thin = max(1, int(thin or 5))
	today = getdate()
	start = get_first_day(add_months(today, -(months - 1)))
	customers = _channel_customers(channel)
	if not customers:
		return {"meta": _meta(channel), "months": months, "thin": thin, "rows": []}
	names = tuple(c["name"] for c in customers)
	sku_map = {r["k"]: int(r["v"]) for r in frappe.db.sql(
		"""SELECT si.customer AS k, COUNT(DISTINCT sii.item_code) AS v
		   FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
		   WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
		     AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s GROUP BY si.customer""",
		(names, start, today, tuple(BOX_UOMS)), as_dict=True)}
	rev_map = _sum_by_customer(
		"""SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
		   WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
		     AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""", (names, start, today))
	rows = []
	for c in customers:
		rev = rev_map.get(c["name"], 0.0)
		if rev <= 0:
			continue
		skus = sku_map.get(c["name"], 0)
		rows.append({"customer": c["name"], "customer_name": c["customer_name"],
			"territory": _resolve_province(c.get("territory"), c["customer_name"]),
			"sku_count": skus, "revenue": rev, "thin": skus < thin})
	rows.sort(key=lambda x: (not x["thin"], -x["revenue"]))
	return {"meta": _meta(channel), "months": months, "thin": thin, "rows": rows}


# ─── Danh sách + chi tiết 1 khách ────────────────────────────────────────────
@frappe.whitelist()
def customer_list(channel: str) -> list[dict]:
	"""Danh sách khách kênh gọn cho ô chọn ở trang phân tích chi tiết."""
	_guard()
	_check_channel(channel)
	rows = _channel_customers(channel)
	return [{"customer": r["name"], "customer_name": r["customer_name"],
		"territory": _resolve_province(r.get("territory"), r["customer_name"])} for r in rows]


@frappe.whitelist()
def customer_detail(channel: str, customer: str, months: int = 12) -> dict:
	"""Phân tích sâu 1 khách: kinh doanh, tài chính, sản phẩm, nhóm hàng + khuyến nghị.

	KHÔNG margin/COGS (QĐ #3) — phần 'Biên LN' của bản npp bị loại."""
	_guard()
	_check_channel(channel)
	settings = get_settings()
	rank_a, rank_b = _rank_thresholds()
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Khách không tồn tại"))
	groups = set(groups_of(channel))
	cinfo = frappe.db.get_value(
		"Customer", customer, ["customer_name", "territory", "customer_group", "creation"], as_dict=True) or {}
	if cinfo.get("customer_group") not in groups:
		frappe.throw(_("Khách hàng này không thuộc kênh {0}").format(CHANNEL_LABELS[channel]))
	monthly_target = 0.0
	if _has_target_field():
		monthly_target = flt(frappe.db.get_value("Customer", customer, "custom_monthly_target"))

	months = max(1, min(int(months or 12), 36))
	today = getdate()
	start = get_first_day(add_months(today, -(months - 1)))
	end = today
	prev_start = add_months(start, -months)
	prev_end = add_months(today, -months)
	ly_start = add_months(start, -12)
	ly_end = add_months(today, -12)

	def rev_between(s, e) -> float:
		return flt(frappe.db.sql(
			"SELECT COALESCE(SUM(grand_total),0) FROM `tabSales Invoice` "
			"WHERE docstatus=1 AND customer=%s AND posting_date BETWEEN %s AND %s "
			"AND IFNULL(is_opening,'No')!='Yes'", (customer, s, e))[0][0] or 0)

	# ── Kinh doanh ──────────────────────────────────────────────────────
	revenue = rev_between(start, end)
	prev_rev = rev_between(prev_start, prev_end)
	ly_rev = rev_between(ly_start, ly_end)
	rev_12 = rev_between(get_first_day(add_months(today, -11)), today)
	avg_monthly = rev_12 / 12.0
	rank = "A" if avg_monthly >= rank_a else ("B" if avg_monthly >= rank_b else "C")

	inv = frappe.db.sql(
		"SELECT COUNT(*) AS n FROM `tabSales Invoice` WHERE docstatus=1 AND customer=%s "
		"AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes'",
		(customer, start, end), as_dict=True)[0]
	orders = int(inv["n"] or 0)
	aov = (revenue / orders) if orders else 0.0
	qg = frappe.db.sql(
		"SELECT COALESCE(SUM(sii.qty),0) AS qty, COUNT(DISTINCT sii.item_code) AS skus, "
		"COUNT(DISTINCT i.item_group) AS grps "
		"FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
		"JOIN `tabItem` i ON sii.item_code=i.item_code "
		"WHERE si.docstatus=1 AND si.customer=%s AND si.posting_date BETWEEN %s AND %s "
		"AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s",
		(customer, start, end, tuple(BOX_UOMS)), as_dict=True)[0]
	qty = flt(qg["qty"]); skus = int(qg["skus"] or 0); groups_bought_n = int(qg["grps"] or 0)

	# ── Vòng đời / nhịp đặt (all-time) ──────────────────────────────────
	fl = frappe.db.sql(
		"SELECT MAX(posting_date) AS last, MIN(posting_date) AS first, COUNT(*) AS n "
		"FROM `tabSales Invoice` WHERE docstatus=1 AND customer=%s", (customer,), as_dict=True)[0]
	last = fl["last"]; first = fl["first"]; n_all = int(fl["n"] or 0)
	days_since = date_diff(today, last) if last else None
	avg_cycle = (date_diff(last, first) / (n_all - 1)) if (n_all > 1 and first and last) else None
	next_expected = str(add_days(last, int(round(avg_cycle)))) if (avg_cycle and last) else None
	hs = flt(settings.he_so_qua_nhip) or 1.5
	overdue_reorder = bool(avg_cycle and days_since is not None and days_since > avg_cycle * hs)

	r90 = rev_between(add_days(today, -90), today)
	p90 = rev_between(add_days(today, -180), add_days(today, -90))
	seg = _segment_of(last, first, days_since, r90, p90, today, settings)

	# ── Xu hướng 12 tháng + overlay năm trước ───────────────────────────
	trend_start = get_first_day(add_months(today, -11))
	rev_by_m = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
		"SELECT DATE_FORMAT(posting_date,'%%Y-%%m') AS m, COALESCE(SUM(grand_total),0) AS v "
		"FROM `tabSales Invoice` WHERE docstatus=1 AND customer=%s AND posting_date>=%s "
		"AND IFNULL(is_opening,'No')!='Yes' GROUP BY m", (customer, trend_start), as_dict=True)}
	qty_by_m = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
		"SELECT DATE_FORMAT(si.posting_date,'%%Y-%%m') AS m, COALESCE(SUM(sii.qty),0) AS v "
		"FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
		"WHERE si.docstatus=1 AND si.customer=%s AND si.posting_date>=%s "
		"AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s GROUP BY m",
		(customer, trend_start, tuple(BOX_UOMS)), as_dict=True)}
	ly_by_m = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
		"SELECT DATE_FORMAT(posting_date,'%%Y-%%m') AS m, COALESCE(SUM(grand_total),0) AS v "
		"FROM `tabSales Invoice` WHERE docstatus=1 AND customer=%s AND posting_date>=%s AND posting_date<%s "
		"AND IFNULL(is_opening,'No')!='Yes' GROUP BY m",
		(customer, add_months(trend_start, -12), trend_start), as_dict=True)}
	monthly = []
	for i in range(12):
		d = getdate(add_months(trend_start, i))
		k = d.strftime("%Y-%m")
		lk = getdate(add_months(d, -12)).strftime("%Y-%m")
		monthly.append({"month": d.strftime("%m/%Y"), "revenue": rev_by_m.get(k, 0.0),
			"qty": qty_by_m.get(k, 0.0), "revenue_ly": ly_by_m.get(lk, 0.0)})

	# ── Tài chính (GL) ──────────────────────────────────────────────────
	debt = gl_balance(customer)
	_open_inv = frappe.db.sql(
		"SELECT name, posting_date, due_date, grand_total, outstanding_amount "
		"FROM `tabSales Invoice` WHERE docstatus=1 AND customer=%s AND outstanding_amount>0 "
		"ORDER BY COALESCE(due_date,posting_date) ASC", (customer,), as_dict=True)
	_bd = debt_breakdown(debt, _open_inv, today)
	buckets = _bd["buckets"]
	overdue = _bd["overdue"]
	dso = (debt / rev_12 * 365) if rev_12 else None

	credit_limit = 0.0
	try:
		for r in frappe.get_all("Customer Credit Limit",
				filters={"parenttype": "Customer", "parent": customer},
				fields=["credit_limit"]):
			credit_limit += flt(r["credit_limit"])
	except Exception:
		credit_limit = 0.0
	credit_usage_pct = (debt / credit_limit * 100) if credit_limit else None

	# ── Mục tiêu ────────────────────────────────────────────────────────
	target = monthly_target * months
	attainment_pct = (revenue / target * 100) if target else None
	total_days = (months - 1) * 30 + get_last_day(today).day
	elapsed_days = (months - 1) * 30 + today.day
	pace = (elapsed_days / total_days * 100) if total_days else 0

	# ── Sản phẩm (không margin) ─────────────────────────────────────────
	cur_sku = frappe.db.sql(
		"SELECT sii.item_code, sii.item_name, i.item_group, COALESCE(SUM(sii.amount),0) AS rev, "
		"COALESCE(SUM(sii.qty),0) AS qty "
		"FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
		"JOIN `tabItem` i ON sii.item_code=i.item_code "
		"WHERE si.docstatus=1 AND si.customer=%s AND si.posting_date BETWEEN %s AND %s "
		"AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s "
		"GROUP BY sii.item_code, sii.item_name, i.item_group ORDER BY rev DESC",
		(customer, start, end, tuple(BOX_UOMS)), as_dict=True)
	prev_sku = {r["item_code"]: flt(r["rev"]) for r in frappe.db.sql(
		"SELECT sii.item_code, COALESCE(SUM(sii.amount),0) AS rev "
		"FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
		"WHERE si.docstatus=1 AND si.customer=%s AND si.posting_date BETWEEN %s AND %s "
		"AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s GROUP BY sii.item_code",
		(customer, prev_start, prev_end, tuple(BOX_UOMS)), as_dict=True)}
	total_rev_sku = sum(flt(r["rev"]) for r in cur_sku) or 0.0
	products_rows = []
	for r in cur_sku:
		rev = flt(r["rev"]); p = prev_sku.get(r["item_code"], 0.0)
		products_rows.append({
			"item_code": r["item_code"], "item_name": r["item_name"], "item_group": r["item_group"],
			"revenue": rev, "qty": flt(r["qty"]),
			"pct_of_total": (rev / total_rev_sku * 100) if total_rev_sku else 0,
			"prev_revenue": p, "delta": rev - p,
			"growth_pct": ((rev - p) / p * 100) if p else None})
	bought_skus = {r["item_code"] for r in cur_sku}

	# ── Nhóm hàng ───────────────────────────────────────────────────────
	cur_grp = frappe.db.sql(
		"SELECT i.item_group, COALESCE(SUM(sii.amount),0) AS rev, COALESCE(SUM(sii.qty),0) AS qty "
		"FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
		"JOIN `tabItem` i ON sii.item_code=i.item_code "
		"WHERE si.docstatus=1 AND si.customer=%s AND si.posting_date BETWEEN %s AND %s "
		"AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s "
		"GROUP BY i.item_group ORDER BY rev DESC", (customer, start, end, tuple(BOX_UOMS)), as_dict=True)
	bought_groups = {r["item_group"] for r in cur_grp}
	total_grp_rev = sum(flt(r["rev"]) for r in cur_grp) or 0.0
	by_group = [{"item_group": r["item_group"], "revenue": flt(r["rev"]), "qty": flt(r["qty"]),
		"pct": (flt(r["rev"]) / total_grp_rev * 100) if total_grp_rev else 0} for r in cur_grp]
	names = _names_of(channel)
	chan_groups = [r[0] for r in frappe.db.sql(
		"SELECT i.item_group FROM `tabSales Invoice Item` sii "
		"JOIN `tabSales Invoice` si ON sii.parent=si.name JOIN `tabItem` i ON sii.item_code=i.item_code "
		"WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date>=%s "
		"AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s "
		"GROUP BY i.item_group ORDER BY COALESCE(SUM(sii.amount),0) DESC",
		(names, add_days(today, -365), tuple(BOX_UOMS)))]
	total_groups = len(chan_groups)
	coverage_pct = (len(bought_groups) / total_groups * 100) if total_groups else 0
	not_bought = [g for g in chan_groups if g not in bought_groups]

	# ── SKU chưa nhập: mã kênh đang bán mà khách này CHƯA nhập (cơ hội) ──
	total_kh = len(names)
	products_not_bought = [
		{"item_code": r["item_code"], "item_name": r["item_name"], "channel_revenue": flt(r["rev"]),
		 "buyers": int(r["buyers"]), "total_npp": total_kh}
		for r in frappe.db.sql(
			"SELECT sii.item_code, sii.item_name, COALESCE(SUM(sii.amount),0) AS rev, "
			"COUNT(DISTINCT si.customer) AS buyers "
			"FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
			"WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date>=%s "
			"AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN %s "
			"GROUP BY sii.item_code, sii.item_name ORDER BY rev DESC",
			(names, add_days(today, -365), tuple(BOX_UOMS)), as_dict=True)
		if r["item_code"] not in bought_skus][:25]

	# ── Lịch thanh toán + các khoản đã thu ──────────────────────────────
	open_invoices = [
		{"invoice": r["name"], "posting_date": str(getdate(r["posting_date"])),
		 "due_date": str(getdate(r["due_date"])) if r.get("due_date") else None,
		 "grand_total": flt(r["grand_total"]), "outstanding": flt(r["outstanding_amount"]),
		 "days_overdue": max(0, date_diff(today, getdate(r["due_date"]) if r.get("due_date") else add_days(getdate(r["posting_date"]), 30)))}
		for r in _open_inv]
	payments = []
	try:
		payments = [
			{"name": r["name"], "posting_date": str(r["posting_date"]), "amount": flt(r["paid_amount"])}
			for r in frappe.get_all(
				"Payment Entry",
				filters={"party_type": "Customer", "party": customer, "docstatus": 1, "payment_type": "Receive"},
				fields=["name", "posting_date", "paid_amount"], order_by="posting_date desc", limit=15)]
	except Exception:
		payments = []

	# ── Khuyến nghị thị trường (bỏ mục margin) ──────────────────────────
	recs = []
	if overdue > 0:
		det = f"Nợ quá hạn {overdue:,.0f}đ"
		if buckets["over_90"] > 0:
			det += f", trong đó >90 ngày {buckets['over_90']:,.0f}đ"
		recs.append({"icon": "🔴", "level": "danger", "title": "Thu hồi nợ quá hạn", "detail": det})
	if credit_usage_pct is not None and credit_usage_pct >= 80:
		recs.append({"icon": "⚠️", "level": "warning", "title": "Sắp chạm hạn mức tín dụng",
			"detail": f"Đã dùng {credit_usage_pct:.0f}% hạn mức ({debt:,.0f}/{credit_limit:,.0f}đ)"})
	if seg in ("Ngủ đông", "Mất"):
		recs.append({"icon": "📞", "level": "warning", "title": "Chào tái đặt / thăm khách",
			"detail": f"{seg} — đã {days_since} ngày không phát sinh đơn"})
	elif overdue_reorder:
		recs.append({"icon": "⏰", "level": "primary", "title": "Nhắc tái đặt",
			"detail": f"Quá nhịp: {days_since} ngày (chu kỳ TB ~{round(avg_cycle)}d)"})
	elif seg == "Suy giảm":
		recs.append({"icon": "📉", "level": "warning", "title": "Tìm hiểu nguyên nhân & đẩy KM",
			"detail": "Doanh số 90 ngày giảm so với kỳ trước"})
	if target and attainment_pct is not None and attainment_pct < pace * 0.8:
		recs.append({"icon": "🎯", "level": "warning", "title": "Chậm so với mục tiêu",
			"detail": f"Mới đạt {attainment_pct:.0f}% (nhịp kỳ vọng ~{pace:.0f}%)"})
	if not_bought:
		recs.append({"icon": "🧩", "level": "primary", "title": "Cross-sell nhóm hàng chưa nhập",
			"detail": "Chưa nhập: " + ", ".join(not_bought[:5])})
	drop_skus = [p for p in products_rows if p["growth_pct"] is not None and p["growth_pct"] <= -40][:5]
	if drop_skus:
		recs.append({"icon": "🛒", "level": "muted", "title": "SKU đang rớt mạnh",
			"detail": ", ".join(p["item_name"] for p in drop_skus)})
	if not recs:
		recs.append({"icon": "✅", "level": "success", "title": "Khách khỏe mạnh",
			"detail": "Không có cảnh báo nổi bật — duy trì chăm sóc định kỳ."})

	return {
		"meta": _meta(channel),
		"months": months,
		"profile": {
			"customer": customer, "customer_name": cinfo.get("customer_name") or customer,
			"territory": _resolve_province(cinfo.get("territory"), cinfo.get("customer_name")),
			"since": str(getdate(cinfo.get("creation"))) if cinfo.get("creation") else None,
			"segment": seg, "rank": rank, "avg_monthly": avg_monthly,
			"first_order": str(first) if first else None, "last_order": str(last) if last else None,
			"days_since": days_since, "orders_all": n_all,
			"avg_cycle": round(avg_cycle, 1) if avg_cycle else None,
			"next_expected": next_expected, "overdue_reorder": overdue_reorder,
		},
		"sales": {
			"revenue": revenue, "prev_revenue": prev_rev,
			"growth_pct": ((revenue - prev_rev) / prev_rev * 100) if prev_rev else None,
			"ly_revenue": ly_rev, "yoy_pct": ((revenue - ly_rev) / ly_rev * 100) if ly_rev else None,
			"qty": qty, "orders": orders, "aov": aov, "skus": skus, "groups_bought": groups_bought_n,
			"monthly": monthly,
		},
		"finance": {
			"debt": debt, "overdue": overdue, "buckets": buckets, "dso": dso,
			"credit_limit": credit_limit, "credit_usage_pct": credit_usage_pct,
			"open_invoices": open_invoices, "payments": payments,
		},
		"target": {"monthly_target": monthly_target, "target": target,
			"attainment_pct": attainment_pct, "expected_pace_pct": pace,
			"available": _has_target_field()},
		"products": products_rows[:40],
		"products_not_bought": products_not_bought,
		"item_groups": {"by_group": by_group, "coverage_pct": coverage_pct,
			"bought": len(bought_groups), "total_groups": total_groups,
			"not_bought": not_bought[:12]},
		"recommendations": recs,
	}


# ─── Bảng doanh số tháng (năm tài chính) ─────────────────────────────────────
@frappe.whitelist()
def sales_matrix(channel: str) -> dict:
	"""Bảng tổng-sắp doanh số khách kênh: tổng từ đầu NĂM TÀI CHÍNH + từng tháng."""
	_guard()
	_check_channel(channel)
	today = getdate()
	try:
		from erpnext.accounts.utils import get_fiscal_year
		fy = get_fiscal_year(today, as_dict=False)
		fy_label, fy_start, fy_end = fy[0], getdate(fy[1]), getdate(fy[2])
	except Exception:
		fy_label = str(today.year)
		fy_start, fy_end = getdate(f"{today.year}-01-01"), getdate(f"{today.year}-12-31")

	customers = _channel_customers(channel)
	if not customers:
		return {"meta": _meta(channel), "fiscal_year": fy_label, "fy_start": str(fy_start),
			"months": [], "rows": [], "totals": {}}
	names = tuple(c["name"] for c in customers)

	end = min(fy_end, get_last_day(today))  # tới hết tháng hiện tại
	months = []
	d = get_first_day(fy_start)
	while getdate(d) <= end:
		dk = getdate(d)
		months.append({"key": dk.strftime("%Y-%m"), "label": "T%d/%s" % (dk.month, dk.strftime("%y"))})
		d = add_months(d, 1)
	month_keys = [m["key"] for m in months]

	by: dict = {}
	for r in frappe.db.sql(
		"""SELECT customer AS c, DATE_FORMAT(posting_date,'%%Y-%%m') AS m, COALESCE(SUM(grand_total),0) AS v
		   FROM `tabSales Invoice`
		   WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
		     AND IFNULL(is_opening,'No')!='Yes'
		   GROUP BY customer, m""", (names, fy_start, end), as_dict=True):
		by.setdefault(r["c"], {})[r["m"]] = flt(r["v"])

	col_totals = {k: 0.0 for k in month_keys}
	rows = []
	for c in customers:
		mm = by.get(c["name"], {})
		monthly = {k: flt(mm.get(k, 0.0)) for k in month_keys}
		for k in month_keys:
			col_totals[k] += monthly[k]
		rows.append({"customer": c["name"], "customer_name": c["customer_name"],
			"monthly": monthly, "total": sum(monthly.values())})
	rows.sort(key=lambda x: x["total"], reverse=True)
	return {"meta": _meta(channel), "fiscal_year": fy_label, "fy_start": str(fy_start),
		"months": months, "rows": rows,
		"totals": {"monthly": col_totals, "grand_total": sum(col_totals.values())}}
