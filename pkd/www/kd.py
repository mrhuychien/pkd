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


def get_context(context: dict) -> dict:
	if frappe.session.user == "Guest":
		tail = frappe.local.request.full_path[len("/kd"):] if frappe.local.request else ""
		frappe.local.flags.redirect_location = f"/login?redirect-to=/kd{tail}"
		raise frappe.Redirect

	roles = set(frappe.get_roles())
	authorized = bool(SALES_ROLES & roles)

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
			"no_cache": 1,
		}
	)
	return context
