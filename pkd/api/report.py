# -*- coding: utf-8 -*-
"""report.get_business_report — "Kinh doanh chung" theo NĂM TÀI CHÍNH (Grafana port).

Điểm mới so với phần còn lại của app: TÁCH hoá đơn trả về (si.is_return=1,
net_total ÂM) khỏi bán ra → bán ra / trả về / thực bán / tỷ lệ trả. Doanh số TRƯỚC thuế.
Doanh số loại opening như thường; so sánh trong 1 cửa sổ năm tài chính (không
so kỳ nên không cần align). Kênh = 4 kênh cấu hình (3 chính + Showroom) + bucket "Khác" (group ngoài mọi cây). Không margin/COGS (QĐ #3).
"""

from __future__ import annotations

import frappe
from frappe.utils import add_months, flt, get_first_day, getdate, nowdate

from pkd.api._metrics import customer_names
from pkd.api.utils import _guard, channel_map

# Nhãn + thứ tự kênh cố định cho báo cáo (màu FE map theo key — không đổi thứ tự).
BC_CHANNELS = [("npp", "NPP"), ("mt", "MT"), ("dulich", "Du lịch"), ("showroom", "Showroom"), ("khac", "Khác")]
BC_FILTERS = {None, "", "npp", "mt", "dulich", "showroom", "khac"}


def _fiscal_years() -> list[dict]:
	"""Danh sách Fiscal Year (mới → cũ). Fallback năm dương lịch nếu site chưa cấu hình."""
	try:
		rows = frappe.get_all(
			"Fiscal Year",
			fields=["name", "year_start_date", "year_end_date"],
			order_by="year_start_date desc",
			limit_page_length=30,
		)
	except Exception:
		rows = []
	if rows:
		return rows
	y = getdate(nowdate()).year
	return [{"name": str(y), "year_start_date": getdate(f"{y}-01-01"), "year_end_date": getdate(f"{y}-12-31")}]


def _pick_fy(fys: list[dict], fiscal_year: str | None) -> dict:
	"""Chọn FY theo tên (sai tên → throw, không im lặng trả năm khác);
	không truyền thì FY chứa hôm nay, else FY mới nhất."""
	if fiscal_year:
		for f in fys:
			if f["name"] == fiscal_year:
				return f
		frappe.throw(frappe._("Năm tài chính không tồn tại: {0}").format(fiscal_year))
	today = getdate(nowdate())
	for f in fys:
		if getdate(f["year_start_date"]) <= today <= getdate(f["year_end_date"]):
			return f
	return fys[0]


def _month_list(start, end) -> list[dict]:
	"""Bucket tháng phủ TRỌN cửa sổ FY (12 bucket; 13 nếu FY bắt đầu giữa tháng
	— ERPNext cho phép, đừng cap 12 kẻo rớt doanh số đuôi FY khỏi ô tháng)."""
	out = []
	d = get_first_day(getdate(start))
	end = getdate(end)
	while d <= end:
		out.append({"key": d.strftime("%Y-%m"), "label": "T%d/%s" % (d.month, d.strftime("%y"))})
		d = add_months(d, 1)
	return out


def _channel_key(cmap: dict, grp: str) -> str:
	return cmap.get(grp) or "khac"


def _rate(g, ret):
	"""Tỷ lệ trả về % (returns mang dấu âm) — None khi chưa có bán ra."""
	return round(-flt(ret) / flt(g) * 100, 2) if flt(g) else None


def _window_agg(start, end, cmap: dict, channel: str | None, month_keys: list[str]) -> dict:
	"""Gom 1 cửa sổ FY từ 1 query invoice-level: tổng/tháng (áp filter kênh)
	+ kênh/kênh×tháng (LUÔN đủ 4 kênh — khối so sánh không áp filter)."""
	rows = frappe.db.sql(
		"""
		SELECT DATE_FORMAT(si.posting_date, '%%Y-%%m') AS ym,
		       si.customer_group AS grp,
		       IF(si.is_return = 1, 1, 0) AS ret,
		       COALESCE(SUM(si.net_total), 0) AS amt
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(s)s AND %(e)s
		GROUP BY ym, grp, ret
		""",
		{"s": start, "e": end},
		as_dict=True,
	)
	gross = returns = 0.0
	m_gross = {k: 0.0 for k in month_keys}
	m_returns = {k: 0.0 for k in month_keys}
	ch_tot = {k: {"gross": 0.0, "returns": 0.0} for k, _ in BC_CHANNELS}
	ch_m_gross = {k: {mk: 0.0 for mk in month_keys} for k, _ in BC_CHANNELS}
	ch_m_returns = {k: {mk: 0.0 for mk in month_keys} for k, _ in BC_CHANNELS}
	for r in rows:
		key = _channel_key(cmap, r.grp)
		amt = flt(r.amt)
		ch_tot[key]["returns" if r.ret else "gross"] += amt
		if r.ym in m_gross:
			(ch_m_returns if r.ret else ch_m_gross)[key][r.ym] += amt
		if (channel is None) or (key == channel):
			if r.ret:
				returns += amt
			else:
				gross += amt
			if r.ym in m_gross:
				(m_returns if r.ret else m_gross)[r.ym] += amt
	return {"gross": gross, "returns": returns, "m_gross": m_gross, "m_returns": m_returns,
		"ch_tot": ch_tot, "ch_m_gross": ch_m_gross, "ch_m_returns": ch_m_returns}


def _group_filter_sql(channel: str | None, cmap: dict, params: dict) -> str:
	"""Mảnh WHERE lọc kênh (literal cố định; giá trị qua %(...)s). '' = không lọc."""
	if not channel:
		return ""
	mapped = tuple(cmap.keys()) or ("__none__",)
	if channel == "khac":
		# NULL NOT IN (...) → NULL (bị loại) trong khi nhánh Python map NULL → 'khac'
		# → phải cộng cả NULL để 2 nhánh cùng 1 request khớp số nhau.
		params["all_groups"] = mapped
		return " AND (si.customer_group IS NULL OR si.customer_group NOT IN %(all_groups)s)"
	groups = tuple(g for g, k in cmap.items() if k == channel) or ("__none__",)
	params["ch_groups"] = groups
	return " AND si.customer_group IN %(ch_groups)s"


@frappe.whitelist()
def get_business_report(fiscal_year=None, channel=None):
	"""Toàn cảnh bán ra / trả về / thực bán theo FY: tổng, theo tháng, theo kênh,
	ngành hàng (Tết vs truyền thống), top khách, top sản phẩm (doanh thu + SL).

	`channel` lọc: tổng/tháng/ngành hàng/top; các khối SO SÁNH KÊNH luôn đủ 4 kênh."""
	_guard()
	if channel not in BC_FILTERS:
		frappe.throw(frappe._("Kênh không hợp lệ: {0}").format(channel))
	channel = channel or None

	fys = _fiscal_years()
	fy = _pick_fy(fys, fiscal_year)
	start, end = getdate(fy["year_start_date"]), getdate(fy["year_end_date"])
	months = _month_list(start, end)
	month_keys = [m["key"] for m in months]
	cmap = channel_map()

	# ── Cửa sổ FY hiện tại: tổng, tháng, kênh, kênh×tháng ───────────────────
	agg = _window_agg(start, end, cmap, channel, month_keys)
	gross, returns = agg["gross"], agg["returns"]
	m_gross, m_returns = agg["m_gross"], agg["m_returns"]
	ch_tot = agg["ch_tot"]
	ch_m_gross, ch_m_returns = agg["ch_m_gross"], agg["ch_m_returns"]

	channels = [
		{
			"key": k, "label": label,
			"gross": ch_tot[k]["gross"], "returns": ch_tot[k]["returns"],
			"net": ch_tot[k]["gross"] + ch_tot[k]["returns"],
			"return_rate_pct": _rate(ch_tot[k]["gross"], ch_tot[k]["returns"]),
		}
		for k, label in BC_CHANNELS
	]

	# ── FY TRƯỚC (cùng bộ lọc kênh) — nguồn YoY / overlay / luỹ kế ─────────
	idx = next((i for i, f in enumerate(fys) if f["name"] == fy["name"]), None)
	prev_fy = fys[idx + 1] if (idx is not None and idx + 1 < len(fys)) else None
	if prev_fy:
		p_start, p_end = getdate(prev_fy["year_start_date"]), getdate(prev_fy["year_end_date"])
		prev_name = prev_fy["name"]
	else:
		# Site chưa khai FY trước → dịch nguyên cửa sổ lùi 12 tháng
		# (hoá đơn cũ vẫn có trong DB dù FY chưa được khai).
		p_start, p_end = add_months(start, -12), add_months(end, -12)
		prev_name = None
	prev_months = _month_list(p_start, p_end)
	agg_p = _window_agg(p_start, p_end, cmap, channel, [m["key"] for m in prev_months])
	prev = {
		"fiscal_year": prev_name,
		"period": {"start": str(getdate(p_start)), "end": str(getdate(p_end))},
		"totals": {
			"gross": agg_p["gross"], "returns": agg_p["returns"],
			"net": agg_p["gross"] + agg_p["returns"],
			"return_rate_pct": _rate(agg_p["gross"], agg_p["returns"]),
		},
		"months": [
			{"key": m["key"], "label": m["label"],
			 "gross": agg_p["m_gross"][m["key"]], "returns": agg_p["m_returns"][m["key"]]}
			for m in prev_months
		],
		"channels_net": {
			k: agg_p["ch_tot"][k]["gross"] + agg_p["ch_tot"][k]["returns"] for k, _ in BC_CHANNELS
		},
	}

	# ── Ngành hàng: Hàng Tết vs truyền thống (net, line-level) ──────────────
	params: dict = {"s": start, "e": end}
	chf = _group_filter_sql(channel, cmap, params)
	ig_rows = frappe.db.sql(
		f"""
		SELECT sii.item_group AS ig, COALESCE(SUM(sii.net_amount), 0) AS amt
		FROM `tabSales Invoice Item` sii
		JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(s)s AND %(e)s{chf}
		GROUP BY sii.item_group
		""",
		params,
		as_dict=True,
	)
	# 'tết' so sánh Unicode phía Python (LOWER SQL không tin được với tiếng Việt).
	tet_net = sum(flt(r.amt) for r in ig_rows if "tết" in (r.ig or "").lower())
	tt_net = sum(flt(r.amt) for r in ig_rows) - tet_net
	nganh_hang = [
		{"label": "Hàng truyền thống", "net": tt_net},
		{"label": "Hàng Tết", "net": tet_net},
	]

	# ── Top khách theo NET (bán − trả) ──────────────────────────────────────
	params2: dict = {"s": start, "e": end}
	chf2 = _group_filter_sql(channel, cmap, params2)
	cust_rows = frappe.db.sql(
		f"""
		SELECT si.customer AS cust, COALESCE(SUM(si.net_total), 0) AS net
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(s)s AND %(e)s{chf2}
		GROUP BY si.customer
		ORDER BY net DESC
		LIMIT 20
		""",
		params2,
		as_dict=True,
	)
	names = customer_names([r.cust for r in cust_rows])
	total_net = gross + returns
	top_customers = [
		{
			"customer": r.cust,
			"customer_name": names.get(r.cust) or r.cust,
			"net": flt(r.net),
			"share_pct": round(flt(r.net) / total_net * 100, 1) if total_net else None,
			"route": f"/khach/{r.cust}",
		}
		for r in cust_rows
	]

	# ── Top sản phẩm: doanh thu net + số lượng net (đơn vị trên hoá đơn) ────
	def top_products(order_col: str):
		p: dict = {"s": start, "e": end}
		f = _group_filter_sql(channel, cmap, p)
		# order_col là literal chọn từ 2 hằng bên dưới — không phải input.
		return frappe.db.sql(
			f"""
			SELECT sii.item_code, sii.item_name,
			       COALESCE(SUM(sii.net_amount), 0) AS net,
			       COALESCE(SUM(sii.qty), 0) AS qty
			FROM `tabSales Invoice Item` sii
			JOIN `tabSales Invoice` si ON si.name = sii.parent
			WHERE si.docstatus = 1
			  AND IFNULL(si.is_opening, 'No') != 'Yes'
			  AND si.posting_date BETWEEN %(s)s AND %(e)s{f}
			GROUP BY sii.item_code, sii.item_name
			ORDER BY {order_col} DESC
			LIMIT 10
			""",
			p,
			as_dict=True,
		)

	top_rev = [
		{"item_code": r.item_code, "item_name": r.item_name, "net": flt(r.net)}
		for r in top_products("net")
	]
	top_qty = [
		{"item_code": r.item_code, "item_name": r.item_name, "qty": flt(r.qty)}
		for r in top_products("qty")
	]

	return {
		"fiscal_years": [f["name"] for f in fys],
		"fiscal_year": fy["name"],
		"period": {"start": str(start), "end": str(end)},
		"channel": channel,
		"totals": {
			"gross": gross,
			"returns": returns,
			"net": gross + returns,
			"return_rate_pct": _rate(gross, returns),
		},
		"prev": prev,
		"months": [
			{"key": m["key"], "label": m["label"], "gross": m_gross[m["key"]], "returns": m_returns[m["key"]]}
			for m in months
		],
		"channels": channels,
		"channel_months": {
			"labels": [m["label"] for m in months],
			"gross": {k: [ch_m_gross[k][mk] for mk in month_keys] for k, _ in BC_CHANNELS},
			"returns": {k: [ch_m_returns[k][mk] for mk in month_keys] for k, _ in BC_CHANNELS},
		},
		"nganh_hang": nganh_hang,
		"top_customers": top_customers,
		"top_products_revenue": top_rev,
		"top_products_qty": top_qty,
	}
