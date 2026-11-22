# -*- coding: utf-8 -*-
"""daily.get_daily_sales — DOANH SỐ THEO NGÀY trong 1 tháng (Tổng quan).

Quy ước số liệu thống nhất toàn app:
- Quét TOÀN BỘ Sales Invoice đã submit trong tháng (không lọc cây kênh); loại
  hoá đơn opening; doanh số TRƯỚC VAT (net_total).
- Bán ra = hoá đơn thường; trả về = hoá đơn is_return (net_total ÂM); thực bán
  = bán ra + trả về. Cùng gốc với ô tháng "Kinh doanh chung" và KPI MTD.
- Kênh theo nhóm khách GHI TRÊN HOÁ ĐƠN (snapshot si.customer_group) → 3 kênh
  chính + Showroom + "Khác" (nhóm ngoài mọi cây hoặc bỏ trống).
- So cùng kỳ tháng trước PERIOD-ALIGNED: ngày 1..N tháng này vs ngày 1..N tháng
  trước (N = số ngày đã qua); không so "đến hôm nay" với "cả tháng trước".
- Không margin/COGS (QĐ #3).
"""

from __future__ import annotations

import frappe
from frappe.utils import add_months, cint, flt, get_first_day, get_last_day, getdate, nowdate

from pkd.api._metrics import customer_names
from pkd.api.report import BC_CHANNELS, BC_FILTERS
from pkd.api.utils import _guard, channel_map, pct, run_rate

_DOW = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]   # date.weekday(): 0 = Thứ Hai


def _growth(cur, prev):
	"""% tăng trưởng chia |prev| (prev âm vẫn đúng dấu); None nếu prev = 0."""
	p = flt(prev)
	if not p:
		return None
	return round((flt(cur) - p) / abs(p) * 100, 1)


@frappe.whitelist()
def get_daily_sales(nam=None, thang=None, channel=None):
	"""Doanh số từng ngày của 1 tháng: tổng, theo kênh, theo khách, luỹ kế so tháng trước.

	nam/thang: mặc định tháng hiện tại. channel lọc tổng/bảng ngày/khách/luỹ kế;
	khối phân tách kênh (biểu đồ chồng + bảng kênh) luôn đủ mọi kênh."""
	_guard()
	if channel not in BC_FILTERS:
		frappe.throw(frappe._("Kênh không hợp lệ: {0}").format(channel))
	channel = channel or None

	today = getdate(nowdate())
	nam = cint(nam) or today.year
	thang = cint(thang) or today.month
	if not (1 <= thang <= 12) or not (2000 <= nam <= 2100):
		frappe.throw(frappe._("Kỳ không hợp lệ: {0}/{1}").format(thang, nam))

	m_start = getdate(f"{nam:04d}-{thang:02d}-01")
	m_end = get_last_day(m_start)
	n_days = m_end.day
	if m_start <= today <= m_end:
		days_passed, is_current = today.day, True
	elif today > m_end:
		days_passed, is_current = n_days, False
	else:
		days_passed, is_current = 0, False          # tháng tương lai

	p_start = get_first_day(add_months(m_start, -1))
	p_end = get_last_day(p_start)
	cmap = channel_map()

	def ch_of(grp):
		return cmap.get(grp) or "khac"

	def in_filter(key):
		return channel is None or key == channel

	# ── 1 query tháng: ngày × nhóm khách × khách (UNFILTERED — lọc ở Python) ──
	rows = frappe.db.sql(
		"""
		SELECT si.posting_date AS d, si.customer_group AS grp, si.customer AS cust,
		       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN 0 ELSE si.net_total END), 0) AS gross,
		       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN si.net_total ELSE 0 END), 0) AS ret,
		       SUM(CASE WHEN si.is_return = 1 THEN 0 ELSE 1 END) AS inv,
		       SUM(CASE WHEN si.is_return = 1 THEN 1 ELSE 0 END) AS ret_inv
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(s)s AND %(e)s
		GROUP BY si.posting_date, si.customer_group, si.customer
		""",
		{"s": m_start, "e": m_end},
		as_dict=True,
	)

	day_keys = list(range(1, n_days + 1))
	ch_keys = [k for k, _ in BC_CHANNELS]
	d_gross = {d: 0.0 for d in day_keys}
	d_ret = {d: 0.0 for d in day_keys}
	d_inv = {d: 0 for d in day_keys}
	d_ret_inv = {d: 0 for d in day_keys}
	d_buyers = {d: set() for d in day_keys}
	ch_day_gross = {k: [0.0] * n_days for k in ch_keys}
	ch_tot = {k: {"gross": 0.0, "returns": 0.0} for k in ch_keys}
	cust_day: dict = {}                 # (date, customer) → aggregate
	month_buyers: set = set()

	for r in rows:
		day = getdate(r.d).day
		key = ch_of(r.grp)
		g, rt = flt(r.gross), flt(r.ret)
		# Phân tách kênh: luôn đủ mọi kênh (không áp bộ lọc).
		ch_day_gross[key][day - 1] += g
		ch_tot[key]["gross"] += g
		ch_tot[key]["returns"] += rt
		if not in_filter(key):
			continue
		d_gross[day] += g
		d_ret[day] += rt
		d_inv[day] += cint(r.inv)
		d_ret_inv[day] += cint(r.ret_inv)
		if cint(r.inv):
			d_buyers[day].add(r.cust)
			month_buyers.add(r.cust)
		ck = (str(getdate(r.d)), r.cust)
		a = cust_day.setdefault(ck, {"date": ck[0], "customer": r.cust, "channel": key,
			"gross": 0.0, "returns": 0.0, "invoices": 0, "ret_invoices": 0})
		a["gross"] += g
		a["returns"] += rt
		a["invoices"] += cint(r.inv)
		a["ret_invoices"] += cint(r.ret_inv)
		a["channel"] = key

	# ── Tháng trước (aligned theo ngày-trong-tháng) ─────────────────────────
	prev_rows = frappe.db.sql(
		"""
		SELECT si.posting_date AS d, si.customer_group AS grp,
		       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN 0 ELSE si.net_total END), 0) AS gross,
		       COALESCE(SUM(CASE WHEN si.is_return = 1 THEN si.net_total ELSE 0 END), 0) AS ret
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1
		  AND IFNULL(si.is_opening, 'No') != 'Yes'
		  AND si.posting_date BETWEEN %(s)s AND %(e)s
		GROUP BY si.posting_date, si.customer_group
		""",
		{"s": p_start, "e": p_end},
		as_dict=True,
	)
	p_days = p_end.day
	p_gross = [0.0] * p_days
	p_net = [0.0] * p_days
	for r in prev_rows:
		if not in_filter(ch_of(r.grp)):
			continue
		i = getdate(r.d).day - 1
		p_gross[i] += flt(r.gross)
		p_net[i] += flt(r.gross) + flt(r.ret)

	# ── Bảng ngày + tổng (chỉ tính ngày đã qua) ─────────────────────────────
	days = []
	for d in day_keys:
		dt = getdate(f"{nam:04d}-{thang:02d}-{d:02d}")
		days.append({
			"date": str(dt), "day": d, "dow": _DOW[dt.weekday()],
			"gross": d_gross[d], "returns": d_ret[d], "net": d_gross[d] + d_ret[d],
			"invoices": d_inv[d], "ret_invoices": d_ret_inv[d], "buyers": len(d_buyers[d]),
			"channels": {k: ch_day_gross[k][d - 1] for k in ch_keys if ch_day_gross[k][d - 1]},
			"future": d > days_passed,
		})

	gross = sum(d_gross.values())
	returns = sum(d_ret.values())
	net = gross + returns
	n_cmp = min(days_passed, p_days)                 # so cùng số ngày
	prev_gross_aligned = sum(p_gross[:n_cmp])
	prev_net_aligned = sum(p_net[:n_cmp])
	cur_gross_aligned = sum(d_gross[d] for d in day_keys if d <= n_cmp)
	cur_net_aligned = sum(d_gross[d] + d_ret[d] for d in day_keys if d <= n_cmp)
	best = max((x for x in days if not x["future"]), key=lambda x: x["gross"], default=None)

	period = {"days_passed": days_passed, "days_total": n_days}
	totals = {
		"gross": gross, "returns": returns, "net": net,
		"return_rate_pct": round(-returns / gross * 100, 2) if gross else None,
		"invoices": sum(d_inv.values()), "ret_invoices": sum(d_ret_inv.values()),
		"buyers": len(month_buyers),
		"selling_days": sum(1 for d in day_keys if d_gross[d] > 0),
		"avg_per_day": (gross / days_passed) if days_passed else None,
		"run_rate": run_rate(gross, period) if is_current else None,
		"prev_gross_aligned": prev_gross_aligned,
		"prev_net_aligned": prev_net_aligned,
		"gross_growth_pct": _growth(cur_gross_aligned, prev_gross_aligned),
		"net_growth_pct": _growth(cur_net_aligned, prev_net_aligned),
		"best_day": ({"date": best["date"], "dow": best["dow"], "gross": best["gross"]}
			if best and best["gross"] > 0 else None),
	}

	# ── Luỹ kế thực bán: tháng này (tới ngày đã qua) vs tháng trước ─────────
	cum_cur, s = [], 0.0
	for d in day_keys:
		if d > days_passed:
			cum_cur.append(None)
		else:
			s += d_gross[d] + d_ret[d]
			cum_cur.append(s)
	cum_prev, s = [], 0.0
	for v in p_net:
		s += v
		cum_prev.append(s)

	# ── Phân tách kênh (luôn đủ mọi kênh) ───────────────────────────────────
	all_gross = sum(v["gross"] for v in ch_tot.values())
	channel_totals = [
		{"key": k, "label": label, "gross": ch_tot[k]["gross"], "returns": ch_tot[k]["returns"],
		 "net": ch_tot[k]["gross"] + ch_tot[k]["returns"],
		 "share_pct": pct(ch_tot[k]["gross"], all_gross)}
		for k, label in BC_CHANNELS
	]

	# ── Khách × ngày (đã lọc kênh) — FE gộp cả tháng hoặc theo ngày chọn ────
	names = customer_names([v["customer"] for v in cust_day.values()])
	customers = []
	for v in cust_day.values():
		v["customer_name"] = names.get(v["customer"]) or v["customer"]
		v["route"] = f"/khach/{v['customer']}"
		customers.append(v)

	return {
		"period": {"nam": nam, "thang": thang, "start": str(m_start), "end": str(m_end),
			"days_total": n_days, "days_passed": days_passed, "is_current": is_current,
			"cmp_days": n_cmp,   # số ngày đầu tháng THỰC SỰ đem so (≤ độ dài tháng trước)
			"today": str(today), "prev_label": f"T{p_start.month}/{p_start.year}"},
		"channel": channel,
		"totals": totals,
		"days": days,
		"channel_days": {"keys": ch_keys, "labels": dict(BC_CHANNELS),
			"gross": ch_day_gross},
		"channel_totals": channel_totals,
		"cum": {"cur": cum_cur, "prev": cum_prev},
		"customers": customers,
	}
