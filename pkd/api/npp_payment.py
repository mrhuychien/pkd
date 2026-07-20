# -*- coding: utf-8 -*-
"""npp_payment.get_npp_payment — CHÍNH SÁCH THANH TOÁN NPP + cảnh báo kế toán.

Chính sách (cấu hình ở PKD Settings — mục "Chính sách thanh toán NPP"):
- Ngày CHỐT (mặc định 5 hàng tháng): chốt các đơn ĐẾN HẠN 30 ngày phải thanh toán.
- Hạn cuối NPP thanh toán (mặc định 10): cửa sổ trả từ ngày chốt → ngày hạn.
- Thưởng 2% doanh số tháng nếu trả đúng hạn. Quá hạn:
    · 1–5 ngày  → ân hạn (giữ đủ thưởng) nhưng CẢNH BÁO "sắp phạt".
    · 6–10 ngày (tt_phat_tu_ngay..tt_cat_tu_ngay-1) → PHẠT 50% thưởng.
    · >10 ngày  (≥ tt_cat_tu_ngay) → CẮT toàn bộ thưởng.

Nguyên tắc số liệu (frappe-sales-analytics):
- "Đến hạn" = COALESCE(due_date, posting+30) ≤ ngày chốt; còn nợ = outstanding_amount
  > 0 (GIỮ opening — nợ thật). Không lọc theo cây kênh vì đây là roster NPP.
- "Doanh số của tháng đó" = net_total (TRƯỚC VAT, loại opening) của NPP trong THÁNG
  kỳ (tháng có cửa sổ thanh toán). Đây là cơ sở tính 2% thưởng.
- Danh sách là TRẠNG THÁI SỐNG (live): chỉ liệt kê NPP CÒN NỢ đến hạn; số ngày quá
  hạn = hôm nay − hạn (tăng dần tới khi trả). NPP đã tất toán không nằm trong danh
  sách (kế toán đã ghi nhận khi thu). KHÔNG suy ngày-trả-trễ từ GL (không có liên
  kết payment↔invoice → dễ gán nhầm thanh toán kỳ khác cho kỳ này).
- Mọi tỷ lệ guard chia 0. Không margin/COGS.
"""

from __future__ import annotations

import datetime

import frappe
from frappe.utils import (
	cint,
	date_diff,
	flt,
	get_first_day,
	get_last_day,
	getdate,
	nowdate,
)

from pkd.api.manager import _channel_customers, _resolve_province
from pkd.api.utils import _guard, get_settings

# Tolerance coi như đã tất toán (tránh lẻ vài đồng do làm tròn).
_PAID_TOL = 1000.0


def _policy(settings) -> dict:
	"""Đọc chính sách (default an toàn nếu site chưa migrate field mới)."""
	ngay_chot = cint(settings.get("tt_ngay_chot")) or 5
	ngay_han = cint(settings.get("tt_ngay_han")) or 10
	phat_tu = cint(settings.get("tt_phat_tu_ngay")) or 6
	cat_tu = cint(settings.get("tt_cat_tu_ngay")) or 11
	thuong_pct = flt(settings.get("tt_thuong_pct")) or 2.0
	# Bảo toàn thứ tự hợp lệ: 1 ≤ phat_tu < cat_tu.
	if phat_tu < 1:
		phat_tu = 1
	if cat_tu <= phat_tu:
		cat_tu = phat_tu + 1
	return {"ngay_chot": ngay_chot, "ngay_han": ngay_han, "phat_tu": phat_tu,
		"cat_tu": cat_tu, "thuong_pct": thuong_pct}


def _clamp_day(year: int, month: int, day: int) -> datetime.date:
	"""date(year, month, day) nhưng kẹp về ngày cuối tháng nếu day > số ngày tháng."""
	last = get_last_day(getdate(f"{year:04d}-{month:02d}-01")).day
	return getdate(f"{year:04d}-{month:02d}-{min(day, last):02d}")


def _tier(days_overdue: int, pol: dict) -> tuple[str, float]:
	"""(tier_key, hệ_số_thưởng) theo số ngày quá hạn."""
	if days_overdue <= 0:
		return "on_time", 1.0
	if days_overdue < pol["phat_tu"]:
		return "grace", 1.0                 # 1..phat_tu-1: ân hạn, cảnh báo sắp phạt
	if days_overdue < pol["cat_tu"]:
		return "penalty", 0.5               # phat_tu..cat_tu-1: phạt 50% thưởng
	return "cut", 0.0                        # ≥ cat_tu: cắt thưởng


TIER_META = {
	"on_time": {"label": "Đúng hạn", "level": "success"},
	"grace": {"label": "Ân hạn (sắp phạt)", "level": "warning"},
	"penalty": {"label": "Phạt 50% thưởng", "level": "warning"},
	"cut": {"label": "Cắt thưởng", "level": "danger"},
	"in_window": {"label": "Đang trong hạn", "level": "info"},
	"pending": {"label": "Chưa tới kỳ chốt", "level": "info"},
}


@frappe.whitelist()
def get_npp_payment(nam=None, thang=None):
	"""Danh sách cảnh báo thanh toán NPP cho kế toán trong 1 kỳ (tháng).

	nam/thang: chọn kỳ; mặc định tháng hiện tại. Trả policy, summary, rows[]."""
	_guard()
	settings = get_settings()
	pol = _policy(settings)

	today = getdate(nowdate())
	nam = cint(nam) or today.year
	thang = cint(thang) or today.month
	if not (1 <= thang <= 12):
		frappe.throw(frappe._("Tháng không hợp lệ: {0}").format(thang))

	m_start = get_first_day(getdate(f"{nam:04d}-{thang:02d}-01"))
	m_end = get_last_day(m_start)
	chot = _clamp_day(nam, thang, pol["ngay_chot"])
	deadline = _clamp_day(nam, thang, pol["ngay_han"])

	# Pha của kỳ so với hôm nay (kỳ tương lai/hiện tại/quá khứ).
	if today < chot:
		phase = "pending"       # chưa tới ngày chốt
	elif today <= deadline:
		phase = "in_window"     # đang trong cửa sổ thanh toán
	else:
		phase = "overdue"       # đã qua hạn → tính quá hạn

	customers = _channel_customers("npp")
	if not customers:
		return _empty(pol, nam, thang, chot, deadline, phase)
	names = tuple(c["name"] for c in customers)

	# ── Phải thu đến hạn (đơn đến hạn ≤ ngày chốt, còn outstanding) ──────────
	due = {r["cust"]: r for r in frappe.db.sql(
		"""
		SELECT si.customer AS cust,
		       COALESCE(SUM(si.outstanding_amount), 0) AS phai_thu,
		       COUNT(*) AS n_inv,
		       MIN(COALESCE(si.due_date, DATE_ADD(si.posting_date, INTERVAL 30 DAY))) AS oldest_due
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND si.outstanding_amount > 0
		  AND si.customer IN %(names)s
		  AND COALESCE(si.due_date, DATE_ADD(si.posting_date, INTERVAL 30 DAY)) <= %(chot)s
		GROUP BY si.customer
		""",
		{"names": names, "chot": chot}, as_dict=True)}

	# ── Doanh số tháng kỳ (net trước VAT, loại opening) → cơ sở thưởng ──────
	rev = {r["cust"]: flt(r["rev"]) for r in frappe.db.sql(
		"""
		SELECT si.customer AS cust, COALESCE(SUM(si.net_total), 0) AS rev
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.customer IN %(names)s
		  AND si.posting_date BETWEEN %(s)s AND %(e)s
		GROUP BY si.customer
		""",
		{"names": names, "s": m_start, "e": m_end}, as_dict=True)}

	rows = []
	for c in customers:
		name = c["name"]
		d = due.get(name)
		phai_thu = flt(d["phai_thu"]) if d else 0.0
		# Chỉ NPP CÒN NỢ đến hạn mới vào danh sách (kế toán có việc để xử lý).
		if phai_thu <= _PAID_TOL:
			continue
		n_inv = int(d["n_inv"]) if d else 0
		oldest_due = getdate(d["oldest_due"]) if (d and d["oldest_due"]) else None
		doanh_so = rev.get(name, 0.0)
		thuong_full = doanh_so * pol["thuong_pct"] / 100.0

		# Tier + ngày quá hạn theo pha của kỳ.
		if phase == "pending":
			days_overdue, tier, mult, status = 0, "pending", 1.0, "pending"
		elif phase == "in_window":
			days_overdue, tier, mult, status = 0, "in_window", 1.0, "in_window"
		else:
			days_overdue = date_diff(today, deadline)
			tier, mult = _tier(days_overdue, pol)
			status = tier  # on_time/grace/penalty/cut (còn nợ, tăng dần tới khi trả)

		thuong_con = thuong_full * mult
		thuong_mat = thuong_full - thuong_con
		meta = TIER_META.get(status, TIER_META["on_time"])
		rows.append({
			"customer": name,
			"customer_name": c.get("customer_name") or name,
			"territory": _resolve_province(c.get("territory"), c.get("customer_name")),
			"phai_thu": phai_thu,
			"n_inv": n_inv,
			"oldest_due": str(oldest_due) if oldest_due else None,
			"days_overdue": days_overdue,
			"doanh_so": doanh_so,
			"thuong_full": thuong_full,
			"thuong_con": thuong_con,
			"thuong_mat": thuong_mat,
			"tier": tier,
			"status": status,
			"status_label": meta["label"],
			"level": meta["level"],
			"route": f"/khach/{name}",
		})

	# Sắp xếp: nặng trước (danger → warning → info → success), rồi tiền phải thu.
	lvl_rank = {"danger": 0, "warning": 1, "info": 2, "success": 3}
	rows.sort(key=lambda r: (lvl_rank.get(r["level"], 9), -r["phai_thu"], -r["thuong_mat"]))

	summary = {
		"n_rows": len(rows),
		"n_cut": sum(1 for r in rows if r["tier"] == "cut"),
		"n_penalty": sum(1 for r in rows if r["tier"] == "penalty"),
		"n_grace": sum(1 for r in rows if r["tier"] == "grace"),
		"n_overdue": sum(1 for r in rows if r["days_overdue"] > 0 and r["phai_thu"] > _PAID_TOL),
		"total_phai_thu": sum(r["phai_thu"] for r in rows),
		"total_thuong_mat": sum(r["thuong_mat"] for r in rows),
	}
	return {
		"policy": {**pol, "nam": nam, "thang": thang, "phase": phase,
			"chot": str(chot), "deadline": str(deadline),
			"m_start": str(m_start), "m_end": str(m_end), "asof": str(today)},
		"summary": summary,
		"rows": rows,
	}


def _empty(pol, nam, thang, chot, deadline, phase) -> dict:
	return {
		"policy": {**pol, "nam": nam, "thang": thang, "phase": phase,
			"chot": str(chot), "deadline": str(deadline), "asof": str(getdate(nowdate()))},
		"summary": {"n_rows": 0, "n_cut": 0, "n_penalty": 0, "n_grace": 0,
			"n_overdue": 0, "total_phai_thu": 0.0, "total_thuong_mat": 0.0},
		"rows": [],
	}


def alert_count() -> dict:
	"""Số NPP cần kế toán xử lý kỳ hiện tại (cho banner Tổng quan). Nhẹ, không throw."""
	try:
		d = get_npp_payment()
		s = d["summary"]
		return {"n_overdue": s["n_overdue"], "n_cut": s["n_cut"], "n_penalty": s["n_penalty"],
			"total_thuong_mat": s["total_thuong_mat"], "thang": d["policy"]["thang"],
			"nam": d["policy"]["nam"], "phase": d["policy"]["phase"]}
	except Exception:
		frappe.log_error(title="pkd npp_payment.alert_count")
		return {"n_overdue": 0, "n_cut": 0, "n_penalty": 0, "total_thuong_mat": 0.0}
