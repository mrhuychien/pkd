# -*- coding: utf-8 -*-
"""Helpers dùng chung cho mọi method pkd.api.* — blueprint Mục 2.4, 3, 8.

Nguyên tắc số liệu (frappe-sales-analytics), in vào code:
- Doanh số/sản lượng: docstatus=1 + loại is_opening.  Công nợ: GIỮ opening.
- Doanh số = TRƯỚC THUẾ: si.net_total / sii.net_amount. grand_total (gồm VAT)
  CHỈ dùng cho công nợ/giá trị hoá đơn phải thanh toán.
- So kỳ period-aligned (giữ nguyên số ngày đã trôi).
- CẤM margin/COGS: KHÔNG method nào query giá vốn (blueprint QĐ #3) — loại từ tầng SQL.
- Attribution doanh số dùng si.customer_group (snapshot trên hoá đơn), KHÔNG join
  Customer hiện tại → lịch sử ổn định khi khách đổi nhóm.
- Mọi tỷ lệ guard chia 0 → None (FE hiện "—").
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, add_months, flt, get_first_day, get_last_day, getdate, nowdate

# ─── Phân quyền: 1 lớp duy nhất gate cả app (blueprint QĐ #2) ───────────────
SALES_ROLES = {"Sales Dashboard", "System Manager"}

# ─── Kênh ───────────────────────────────────────────────────────────────────
CHANNEL_KEYS = ("npp", "mt", "dulich")
CHANNEL_LABELS = {"npp": "NPP", "mt": "MT", "dulich": "Du lịch"}
_CHANNEL_MAP_CACHE = "pkd:channel_map"

# ─── Đơn vị thùng (blueprint luật #4) — [VERIFY tên UOM trên site] ──────────
BOX_UOMS = ("Thùng", "Box")

# ─── Bảng mùng 1 Tết âm (blueprint Mục 10) ─────────────────────────────────
# [VERIFY từng ngày với lịch vạn niên]. Các mốc 2015–2028 đã đối chiếu giá trị
# phổ biến; 2029–2035 cần soát lại nguồn lịch âm trước khi dùng cho báo cáo Tết.
TET_DATES = {
	2015: "2015-02-19", 2016: "2016-02-08", 2017: "2017-01-28", 2018: "2018-02-16",
	2019: "2019-02-05", 2020: "2020-01-25", 2021: "2021-02-12", 2022: "2022-02-01",
	2023: "2023-01-22", 2024: "2024-02-10", 2025: "2025-01-29", 2026: "2026-02-17",
	2027: "2027-02-06", 2028: "2028-01-26", 2029: "2029-02-13", 2030: "2030-02-03",
	2031: "2031-01-23", 2032: "2032-02-11", 2033: "2033-01-31", 2034: "2034-02-19",
	2035: "2035-02-08",
}


# ─── Guard ──────────────────────────────────────────────────────────────────
def _guard():
	"""Chặn Guest + user không có role Phòng KD. Gọi ở DÒNG ĐẦU mọi method."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Vui lòng đăng nhập"), frappe.PermissionError)
	if not SALES_ROLES & set(frappe.get_roles()):
		frappe.throw(_("Chỉ Phòng Kinh doanh truy cập được."), frappe.PermissionError)


def guard_target_write():
	"""Cấp 'PKD Quan Ly Kenh' CHỈ XEM — ghi chỉ tiêu cần Trưởng phòng.

	Chỉ chặn user mang role Quan Ly Kenh mà KHÔNG có quyền cao hơn — user cũ
	(chỉ Sales Dashboard) giữ nguyên quyền như trước, không hồi quy. Gọi SAU
	_guard() ở mọi method ghi chỉ tiêu (targets.save_target, manager.set_target*)."""
	roles = set(frappe.get_roles())
	if "PKD Quan Ly Kenh" in roles and not ({"System Manager", "PKD Truong Phong"} & roles):
		frappe.throw(_("Quyền Quản lý kênh chỉ xem — sửa chỉ tiêu cần cấp Trưởng phòng."),
			frappe.PermissionError)


# ─── Settings ────────────────────────────────────────────────────────────────
def get_settings():
	"""Trả PKD Settings (cached doc). Ngưỡng segment/aging/MT/hạng/Tết đọc từ đây."""
	return frappe.get_cached_doc("PKD Settings")


# ─── Channel map (Customer Group tree → 3 kênh) ─────────────────────────────
def channel_map() -> dict:
	"""Map MỌI Customer Group con → 'npp'|'mt'|'dulich' bằng nested set (lft/rgt).

	Cache 10 phút (cây group ít đổi). Attribution doanh số dùng si.customer_group
	nên cần đủ mọi group con của 3 root.
	"""
	cached = frappe.cache().get_value(_CHANNEL_MAP_CACHE)
	if cached is not None:
		return cached

	settings = get_settings()
	roots = {"npp": settings.kenh_npp, "mt": settings.kenh_mt, "dulich": settings.kenh_dulich}
	mapping: dict[str, str] = {}
	for key, root in roots.items():
		if not root:
			continue
		node = frappe.db.get_value("Customer Group", root, ["lft", "rgt"], as_dict=True)
		if not node:
			continue
		# Mọi group con: lft >= root.lft AND rgt <= root.rgt (nested set).
		children = frappe.get_all(
			"Customer Group",
			filters={"lft": [">=", node.lft], "rgt": ["<=", node.rgt]},
			pluck="name",
		)
		for g in children:
			mapping[g] = key

	frappe.cache().set_value(_CHANNEL_MAP_CACHE, mapping, expires_in_sec=600)
	return mapping


def groups_of(channel: str) -> list[str]:
	"""Danh sách Customer Group thuộc 1 kênh — dùng cho `si.customer_group IN %s`."""
	cmap = channel_map()
	return [g for g, k in cmap.items() if k == channel]


def channel_root(channel: str) -> str | None:
	"""Root Customer Group của 1 kênh (target.kenh lưu root này)."""
	settings = get_settings()
	return {"npp": settings.kenh_npp, "mt": settings.kenh_mt, "dulich": settings.kenh_dulich}.get(channel)


def channel_of_group(group: str) -> str | None:
	"""Kênh của 1 Customer Group (dùng khi cần map ngược 1 giá trị)."""
	return channel_map().get(group)


def clear_channel_cache():
	"""Xoá cache channel_map (gọi khi PKD Settings đổi 3 root)."""
	frappe.cache().delete_value(_CHANNEL_MAP_CACHE)


# ─── Kỳ thời gian (period-aligned) ──────────────────────────────────────────
def period_mtd(today=None) -> dict:
	"""Kỳ month-to-date: {start(first day), end(today), days_passed, days_total}."""
	today = getdate(today) if today else getdate(nowdate())
	start = get_first_day(today)
	return {
		"start": start,
		"end": today,
		"days_passed": (today - start).days + 1,
		"days_total": get_last_day(today).day,
	}


def shift_period(period: dict, months: int) -> dict:
	"""Dịch kỳ month-aligned lùi `months` tháng, GIỮ số ngày đã trôi.

	prev tháng: months=1; YoY: months=12. (frappe-sales-analytics luật #2:
	prev_end = prev_first + (days_passed-1)).
	"""
	start = add_months(period["start"], -months)
	end = add_days(start, period["days_passed"] - 1)
	return {
		"start": start,
		"end": end,
		"days_passed": period["days_passed"],
		"days_total": get_last_day(start).day,
	}


def shift_range(date_from, date_to, mode: str) -> tuple:
	"""Dịch 1 khoảng ngày bất kỳ (dùng cho Khám phá compare).

	- 'prev': lùi đúng độ dài khoảng (new_to = from-1 ngày; new_from = new_to-span).
	- 'yoy' : lùi 12 tháng, giữ nguyên độ dài (dịch cả 2 mốc).
	Trả (new_from, new_to) hoặc (None, None) nếu mode không hợp lệ.
	"""
	df, dt = getdate(date_from), getdate(date_to)
	if mode == "prev":
		span = (dt - df).days
		new_to = add_days(df, -1)
		new_from = add_days(new_to, -span)
		return new_from, new_to
	if mode == "yoy":
		return add_months(df, -12), add_months(dt, -12)
	return None, None


# ─── Tỷ lệ (luôn guard chia 0) ──────────────────────────────────────────────
def pct(numerator, denominator, digits: int = 1):
	"""Trả % (đã ×100), None nếu mẫu = 0/None."""
	d = flt(denominator)
	if not d:
		return None
	return round(flt(numerator) / d * 100, digits)


def growth_pct(cur, prev, digits: int = 1):
	"""% tăng trưởng (cur-prev)/prev × 100, None nếu prev = 0."""
	p = flt(prev)
	if not p:
		return None
	return round((flt(cur) - p) / p * 100, digits)


def pace_pct(period: dict):
	"""Nhịp kỳ vọng = days_passed/days_total × 100."""
	return pct(period["days_passed"], period["days_total"])


def run_rate(mtd_value, period: dict):
	"""Ước cả tháng = MTD/ngày_đã_qua × ngày_trong_tháng (ước tính, cảnh báo sớm)."""
	if not period["days_passed"]:
		return None
	return flt(mtd_value) / period["days_passed"] * period["days_total"]


# ─── Tết ─────────────────────────────────────────────────────────────────────
def tet_date(year: int):
	"""Ngày mùng 1 Tết dương lịch của `year` (getdate) hoặc None nếu ngoài bảng."""
	d = TET_DATES.get(int(year))
	return getdate(d) if d else None


def iso(d):
	"""Chuyển date → chuỗi ISO 'YYYY-MM-DD' để trả FE (None-safe)."""
	return str(getdate(d)) if d else None


def tet_banner_info(today=None, window: int = 60):
	"""Thông tin thẻ "Mùa Tết" cho Tổng quan. None nếu ngoài bảng TET_DATES.

	in_window = còn trong cửa sổ Tết sắp tới (days_to_tet <= window).
	"""
	today = getdate(today) if today else getdate(nowdate())
	upcoming = sorted(getdate(d) for d in TET_DATES.values() if getdate(d) >= today)
	if not upcoming:
		return None
	td = upcoming[0]
	days = (td - today).days
	return {"tet_year": td.year, "tet_date": str(td), "days_to_tet": days, "in_window": days <= int(window)}
