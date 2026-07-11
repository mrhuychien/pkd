# -*- coding: utf-8 -*-
"""geo.get_province_sales — doanh số theo TỈNH cho bản đồ toàn quốc.

Nhóm theo cột tuỳ biến trên Sales Invoice (ưu tiên `custom_tỉnh`, dò thêm
`custom_tinh` — gotcha fieldname có dấu); site CHƯA có cột thì fallback suy
tỉnh từ Customer.territory/tên khách (nguồn ghi rõ trong response).

Tên tỉnh được CHUẨN HOÁ về 34 tỉnh/thành SAU SÁP NHẬP 07/2025 (NQ
202/2025/QH15): dữ liệu ghi tên cũ (63) hay tên mới (34) đều gộp đúng —
so khớp không dấu, bỏ tiền tố Tỉnh/TP. Giá trị không nhận diện được trả
trong `unmatched` (không âm thầm vứt). Cửa sổ = năm tài chính, lọc kênh
snapshot như Kinh doanh chung. Doanh số loại opening; không margin (QĐ #3).
"""

from __future__ import annotations

import re
import unicodedata

import frappe
from frappe.utils import flt, getdate

from pkd.api.report import BC_FILTERS, _fiscal_years, _group_filter_sql, _pick_fy
from pkd.api.utils import _guard, channel_map, pct

# Cột ứng viên theo thứ tự ưu tiên (chỉ nhận identifier trong whitelist này —
# tên cột được nội suy vào SQL nên TUYỆT ĐỐI không lấy từ input).
PROV_COLUMNS = ("custom_tỉnh", "custom_tinh")

# Tỉnh CŨ (63) → tỉnh MỚI (34). Tên mới map về chính nó khi build bảng tra.
OLD_TO_NEW = {
	"Hà Nội": "Hà Nội", "Cao Bằng": "Cao Bằng", "Lạng Sơn": "Lạng Sơn",
	"Quảng Ninh": "Quảng Ninh", "Lai Châu": "Lai Châu", "Điện Biên": "Điện Biên",
	"Sơn La": "Sơn La", "Thanh Hóa": "Thanh Hóa", "Nghệ An": "Nghệ An",
	"Hà Tĩnh": "Hà Tĩnh", "Thừa Thiên Huế": "Huế",
	"Tuyên Quang": "Tuyên Quang", "Hà Giang": "Tuyên Quang",
	"Lào Cai": "Lào Cai", "Yên Bái": "Lào Cai",
	"Thái Nguyên": "Thái Nguyên", "Bắc Kạn": "Thái Nguyên",
	"Phú Thọ": "Phú Thọ", "Vĩnh Phúc": "Phú Thọ", "Hòa Bình": "Phú Thọ",
	"Bắc Ninh": "Bắc Ninh", "Bắc Giang": "Bắc Ninh",
	"Hưng Yên": "Hưng Yên", "Thái Bình": "Hưng Yên",
	"Hải Phòng": "Hải Phòng", "Hải Dương": "Hải Phòng",
	"Ninh Bình": "Ninh Bình", "Hà Nam": "Ninh Bình", "Nam Định": "Ninh Bình",
	"Quảng Trị": "Quảng Trị", "Quảng Bình": "Quảng Trị",
	"Đà Nẵng": "Đà Nẵng", "Quảng Nam": "Đà Nẵng",
	"Quảng Ngãi": "Quảng Ngãi", "Kon Tum": "Quảng Ngãi",
	"Gia Lai": "Gia Lai", "Bình Định": "Gia Lai",
	"Khánh Hòa": "Khánh Hòa", "Ninh Thuận": "Khánh Hòa",
	"Lâm Đồng": "Lâm Đồng", "Đắk Nông": "Lâm Đồng", "Bình Thuận": "Lâm Đồng",
	"Đắk Lắk": "Đắk Lắk", "Phú Yên": "Đắk Lắk",
	"TP. Hồ Chí Minh": "TP. Hồ Chí Minh", "Bình Dương": "TP. Hồ Chí Minh",
	"Bà Rịa-Vũng Tàu": "TP. Hồ Chí Minh",
	"Đồng Nai": "Đồng Nai", "Bình Phước": "Đồng Nai",
	"Tây Ninh": "Tây Ninh", "Long An": "Tây Ninh",
	"Cần Thơ": "Cần Thơ", "Sóc Trăng": "Cần Thơ", "Hậu Giang": "Cần Thơ",
	"Vĩnh Long": "Vĩnh Long", "Bến Tre": "Vĩnh Long", "Trà Vinh": "Vĩnh Long",
	"Đồng Tháp": "Đồng Tháp", "Tiền Giang": "Đồng Tháp",
	"An Giang": "An Giang", "Kiên Giang": "An Giang",
	"Cà Mau": "Cà Mau", "Bạc Liêu": "Cà Mau",
}

# Cách viết đời thường hay gặp trong dữ liệu nhập tay.
ALIASES = {
	"tphcm": "TP. Hồ Chí Minh", "tp hcm": "TP. Hồ Chí Minh", "hcm": "TP. Hồ Chí Minh",
	"sai gon": "TP. Hồ Chí Minh", "saigon": "TP. Hồ Chí Minh",
	"vung tau": "TP. Hồ Chí Minh", "ba ria": "TP. Hồ Chí Minh",
	"ba ria vung tau": "TP. Hồ Chí Minh",
	"hue": "Huế", "tt hue": "Huế",
	"daklak": "Đắk Lắk", "dac lac": "Đắk Lắk", "kontum": "Quảng Ngãi",
	"bac can": "Thái Nguyên", "vinh phuc": "Phú Thọ",
}


def _norm(s: str) -> str:
	"""lower → bỏ dấu (NFD) → đ→d → bỏ ký tự lạ → bỏ tiền tố tỉnh/tp → gọn space."""
	s = (s or "").strip().lower()
	s = unicodedata.normalize("NFD", s)
	s = "".join(c for c in s if unicodedata.category(c) != "Mn")
	s = s.replace("đ", "d")
	s = re.sub(r"[^a-z0-9 ]+", " ", s)
	s = re.sub(r"\s+", " ", s).strip()
	s = re.sub(r"^(tinh|thanh pho|tp|t p)\s+", "", s)
	return s


def _canon_table() -> dict:
	table = {}
	for old, new in OLD_TO_NEW.items():
		table[_norm(old)] = new
		table[_norm(new)] = new
	for k, v in ALIASES.items():
		table[_norm(k)] = v
	return table


CANON = _canon_table()


def _prov_column() -> str | None:
	"""Cột tỉnh thật trên site (fieldname có dấu dễ lệch → dò cả 2 biến thể)."""
	for col in PROV_COLUMNS:
		try:
			if frappe.db.has_column("Sales Invoice", col):
				return col
		except Exception:
			continue
	return None


@frappe.whitelist()
def get_province_sales(fiscal_year=None, channel=None):
	"""Doanh số theo tỉnh (chuẩn hoá 34 tỉnh mới) trong 1 năm tài chính, lọc kênh."""
	_guard()
	if channel not in BC_FILTERS:
		frappe.throw(frappe._("Kênh không hợp lệ: {0}").format(channel))
	channel = channel or None

	fys = _fiscal_years()
	fy = _pick_fy(fys, fiscal_year)
	start, end = getdate(fy["year_start_date"]), getdate(fy["year_end_date"])
	cmap = channel_map()
	params: dict = {"s": start, "e": end}
	chf = _group_filter_sql(channel, cmap, params)

	col = _prov_column()
	if col:
		# col lấy từ whitelist PROV_COLUMNS phía trên — không phải input.
		rows = frappe.db.sql(
			f"""
			SELECT si.`{col}` AS prov,
			       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN si.grand_total ELSE 0 END), 0) AS ret,
			       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN 0 ELSE si.grand_total END), 0) AS gross,
			       COUNT(*) AS invoices,
			       COUNT(DISTINCT si.customer) AS buyers
			FROM `tabSales Invoice` si
			WHERE si.docstatus = 1
			  AND IFNULL(si.is_opening, 'No') != 'Yes'
			  AND si.posting_date BETWEEN %(s)s AND %(e)s{chf}
			GROUP BY si.`{col}`
			""",
			params,
			as_dict=True,
		)
		source = col
	else:
		# Fallback: chưa có cột tỉnh trên hoá đơn → suy từ hồ sơ khách.
		crows = frappe.db.sql(
			f"""
			SELECT si.customer AS cust,
			       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN si.grand_total ELSE 0 END), 0) AS ret,
			       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN 0 ELSE si.grand_total END), 0) AS gross,
			       COUNT(*) AS invoices
			FROM `tabSales Invoice` si
			WHERE si.docstatus = 1
			  AND IFNULL(si.is_opening, 'No') != 'Yes'
			  AND si.posting_date BETWEEN %(s)s AND %(e)s{chf}
			GROUP BY si.customer
			""",
			params,
			as_dict=True,
		)
		from pkd.api.manager import _resolve_province

		info = {c["name"]: c for c in frappe.get_all(
			"Customer",
			filters={"name": ["in", [r.cust for r in crows] or ["__none__"]]},
			fields=["name", "customer_name", "territory"],
		)}
		agg: dict = {}
		for r in crows:
			c = info.get(r.cust) or {}
			prov = _resolve_province(c.get("territory"), c.get("customer_name"))
			a = agg.setdefault(prov, {"ret": 0.0, "gross": 0.0, "invoices": 0, "buyers": 0})
			a["ret"] += flt(r.ret)
			a["gross"] += flt(r.gross)
			a["invoices"] += int(r.invoices)
			a["buyers"] += 1
		rows = [frappe._dict(prov=k, **v) for k, v in agg.items()]
		source = "customer"

	# ── Gộp về 34 tỉnh mới; không nhận diện được → unmatched (minh bạch) ────
	provinces: dict = {}
	unmatched: dict = {}
	for r in rows:
		raw = (r.prov or "").strip()
		canon = CANON.get(_norm(raw)) if raw else None
		net = flt(r.gross) + flt(r.ret)
		if canon:
			p = provinces.setdefault(canon, {"province": canon, "gross": 0.0, "returns": 0.0,
				"net": 0.0, "invoices": 0, "buyers": 0})
			p["gross"] += flt(r.gross)
			p["returns"] += flt(r.ret)
			p["net"] += net
			p["invoices"] += int(r.invoices)
			# buyers cộng dồn giữa các cách ghi khác nhau của cùng 1 tỉnh — có thể
			# đếm trùng 1 khách xuất hiện ở 2 cách ghi; chấp nhận, ghi chú ở UI.
			p["buyers"] += int(r.buyers)
		else:
			key = raw or "(bỏ trống)"
			u = unmatched.setdefault(key, {"raw": key, "net": 0.0, "invoices": 0})
			u["net"] += net
			u["invoices"] += int(r.invoices)

	total_net = sum(p["net"] for p in provinces.values()) + sum(u["net"] for u in unmatched.values())
	out = sorted(provinces.values(), key=lambda p: p["net"], reverse=True)
	for p in out:
		p["share_pct"] = pct(p["net"], total_net)

	return {
		"source": source,
		"fiscal_year": fy["name"],
		"period": {"start": str(start), "end": str(end)},
		"channel": channel,
		"total_net": total_net,
		"provinces": out,
		"unmatched": sorted(unmatched.values(), key=lambda u: u["net"], reverse=True),
	}
