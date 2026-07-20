# -*- coding: utf-8 -*-
"""Route handler cho www page /kd — vỏ SPA Dashboard Phòng KD.

Phân quyền (blueprint Mục 3): Guest → redirect /login; đăng nhập nhưng thiếu role
Sales Dashboard/System Manager → trang 403 tự vẽ (server chặn, không chỉ ẩn nút).
"""

from __future__ import annotations

import frappe
from frappe import _

no_cache = 1  # SPA shell — không cache server-side

SALES_ROLES = {"Sales Dashboard", "System Manager"}

# PHẢI khớp hằng BUILD trong public/pkd/shell.js — dùng để phát hiện tầng cache
# (CDN/proxy) trả shell.js cũ dù HTML đã mới (kd.html so sánh và cảnh báo).
SHELL_BUILD = "npptt-r5"


def get_context(context: dict) -> dict:
	if frappe.session.user == "Guest":
		tail = frappe.local.request.full_path[len("/kd"):] if frappe.local.request else ""
		frappe.local.flags.redirect_location = f"/login?redirect-to=/kd{tail}"
		raise frappe.Redirect

	roles = set(frappe.get_roles())
	authorized = bool(SALES_ROLES & roles)
	is_admin = "System Manager" in roles

	user_doc = frappe.db.get_value(
		"User", frappe.session.user, ["first_name", "full_name"], as_dict=True
	) or {}

	context.update(
		{
			"title": _("Dashboard Phòng KD"),
			"user": frappe.session.user,
			"user_first_name": user_doc.get("first_name") or "",
			"user_full_name": user_doc.get("full_name") or frappe.session.user,
			"authorized": 1 if authorized else 0,
			"is_admin": 1 if is_admin else 0,
			"shell_build": SHELL_BUILD,
			"no_cache": 1,
		}
	)
	return context
