# -*- coding: utf-8 -*-
"""admin.* — Quản trị người dùng portal (chỉ Administrator/System Manager).

Tạo user CHỈ truy cập portal: `user_type = Website User` → Frappe chặn Desk
từ gốc (không phải ẩn nút). Quyền 2 cấp qua role phụ (desk_access=0):
- PKD Truong Phong  — toàn quyền portal (kể cả sửa chỉ tiêu)
- PKD Quan Ly Kenh  — xem toàn bộ, KHÔNG sửa chỉ tiêu (guard ở targets/manager)
Cả hai đều kèm role gốc "Sales Dashboard" (cổng vào duy nhất của app).

QR truy cập ngay: token 1 lần (frappe.generate_hash 48 ký tự, cache TTL
QR_TTL_DAYS ngày) → URL /api/method/pkd.api.admin.quick_login?token=...
Quét là đăng nhập thẳng vào /kd, KHÔNG cần mật khẩu lần đầu. An toàn:
token dùng 1 lần (xoá trước khi kiểm), hết hạn tự huỷ, chỉ cấp cho user
portal (Website User + Sales Dashboard, không bao giờ System Manager),
và chỉ System Manager tạo được token.
"""

from __future__ import annotations

import re
import secrets

import frappe
from frappe import _
from frappe.utils import get_url

# Mật khẩu tự sinh: 10 ký tự, bỏ ký tự dễ nhầm (0/O, 1/l/I) — đọc được qua điện thoại.
_PW_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
# Email nội bộ cho user chỉ có SĐT (User của Frappe bắt buộc keyed theo email).
_SYNTH_DOMAIN = "pkd.local"

QR_TTL_DAYS = 7
_QLOGIN_KEY = "pkd:qlogin:{token}"

BASE_ROLE = "Sales Dashboard"
LEVELS = {
	"truong_phong": "PKD Truong Phong",
	"quan_ly_kenh": "PKD Quan Ly Kenh",
}
LEVEL_LABELS = {"truong_phong": "Trưởng phòng", "quan_ly_kenh": "Quản lý kênh"}


def _admin_guard():
	"""Chỉ Administrator / System Manager. Gọi ở DÒNG ĐẦU mọi method admin."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Vui lòng đăng nhập"), frappe.PermissionError)
	if "System Manager" not in frappe.get_roles():
		frappe.throw(_("Chỉ Administrator được quản trị người dùng."), frappe.PermissionError)


def _is_portal_user(email: str) -> bool:
	"""User portal hợp lệ để cấp QR/bật tắt: Website User + Sales Dashboard,
	không phải Administrator/System Manager (không bao giờ đụng tài khoản quản trị)."""
	if not email or email in ("Administrator", "Guest"):
		return False
	u = frappe.db.get_value("User", email, ["enabled", "user_type"], as_dict=True)
	if not u or u.user_type != "Website User":
		return False
	roles = set(frappe.get_roles(email))
	return BASE_ROLE in roles and "System Manager" not in roles


def _issue_token(email: str) -> dict:
	token = frappe.generate_hash(length=48)
	frappe.cache().set_value(
		_QLOGIN_KEY.format(token=token), email, expires_in_sec=QR_TTL_DAYS * 86400
	)
	return {
		"quick_url": get_url(f"/api/method/pkd.api.admin.quick_login?token={token}"),
		"expires_days": QR_TTL_DAYS,
	}


@frappe.whitelist()
def list_portal_users():
	"""Danh sách user portal + cấp quyền (suy từ Has Role)."""
	_admin_guard()
	users = frappe.get_all(
		"User",
		filters={"user_type": "Website User", "name": ["not in", ("Guest", "Administrator")]},
		fields=["name", "full_name", "enabled", "mobile_no", "creation", "last_active"],
	)
	watch = [BASE_ROLE] + list(LEVELS.values())
	role_rows = frappe.get_all(
		"Has Role",
		filters={"parenttype": "User", "role": ["in", watch],
			"parent": ["in", [u["name"] for u in users] or ["__none__"]]},
		fields=["parent", "role"],
	)
	roles_of: dict = {}
	for r in role_rows:
		roles_of.setdefault(r["parent"], set()).add(r["role"])
	out = []
	for u in users:
		rs = roles_of.get(u["name"], set())
		if BASE_ROLE not in rs:
			continue  # Website User khác (khách hàng NPP...) — không thuộc portal này
		level = ("truong_phong" if LEVELS["truong_phong"] in rs
			else "quan_ly_kenh" if LEVELS["quan_ly_kenh"] in rs else None)
		out.append({
			"user": u["name"], "full_name": u["full_name"], "enabled": int(u["enabled"]),
			"mobile_no": u["mobile_no"], "creation": str(u["creation"])[:10],
			"last_active": str(u["last_active"])[:16] if u["last_active"] else None,
			"level": level,
			"level_label": LEVEL_LABELS.get(level) or "—",
		})
	out.sort(key=lambda x: (-x["enabled"], x["full_name"] or ""))
	return {"users": out, "levels": [{"key": k, "label": LEVEL_LABELS[k]} for k in LEVELS]}


def _norm_mobile(mobile: str) -> str:
	"""Chuẩn hoá SĐT: bỏ khoảng trắng/chấm/gạch; +84xxx → 0xxx; validate 10-11 số."""
	m = re.sub(r"[\s.\-()]+", "", mobile or "")
	if m.startswith("+84"):
		m = "0" + m[3:]
	elif m.startswith("84") and len(m) >= 10:
		m = "0" + m[2:]
	if not re.match(r"^0\d{9,10}$", m):
		frappe.throw(_("Số điện thoại không hợp lệ: {0}").format(mobile))
	return m


def _ensure_mobile_login_enabled():
	"""Đăng nhập bằng SĐT cần System Settings bật cờ — bật 1 lần khi tạo user."""
	if not frappe.db.get_single_value("System Settings", "allow_login_using_mobile_number"):
		frappe.db.set_single_value("System Settings", "allow_login_using_mobile_number", 1)
		frappe.clear_cache()


@frappe.whitelist()
def create_portal_user(full_name, mobile, level, email=None, password=None):
	"""Tạo user portal-only: BẮT BUỘC họ tên + SĐT. Đăng nhập = SĐT + mật khẩu
	(tự sinh nếu bỏ trống — trả về 1 LẦN); email tuỳ chọn (không có → email nội
	bộ <SĐT>@pkd.local vì Frappe khoá User theo email). Kèm QR vào ngay."""
	_admin_guard()
	full_name = (full_name or "").strip()
	if not full_name:
		frappe.throw(_("Thiếu họ tên"))
	if level not in LEVELS:
		frappe.throw(_("Cấp quyền không hợp lệ: {0}").format(level))
	mobile = _norm_mobile(mobile)
	if frappe.db.exists("User", {"mobile_no": mobile}):
		frappe.throw(_("Số điện thoại đã có tài khoản: {0}").format(mobile))

	email = (email or "").strip().lower()
	if email:
		if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
			frappe.throw(_("Email không hợp lệ: {0}").format(email))
	else:
		email = f"{mobile}@{_SYNTH_DOMAIN}"
	if frappe.db.exists("User", email):
		frappe.throw(_("User đã tồn tại: {0}").format(email))

	password = (password or "").strip() or "".join(secrets.choice(_PW_ALPHABET) for _ in range(10))

	doc = frappe.get_doc({
		"doctype": "User",
		"email": email,
		"first_name": full_name,
		"mobile_no": mobile,
		# Website User = KHÔNG có Desk (chặn từ tầng auth, không phải ẩn UI).
		"user_type": "Website User",
		"enabled": 1,
		"send_welcome_email": 0,
		"new_password": password,
		"roles": [{"role": BASE_ROLE}, {"role": LEVELS[level]}],
	})
	doc.flags.no_welcome_mail = True
	doc.insert(ignore_permissions=True)
	_ensure_mobile_login_enabled()

	tk = _issue_token(email)
	return {
		"user": email, "full_name": doc.full_name, "mobile": mobile,
		"password": password,   # hiện đúng 1 lần cho admin đưa người dùng
		"level": level, "level_label": LEVEL_LABELS[level],
		**tk,
	}


@frappe.whitelist()
def renew_qr(user):
	"""Phát hành lại QR đăng nhập cho 1 user portal (token cũ hết hạn/đã dùng)."""
	_admin_guard()
	if not _is_portal_user(user):
		frappe.throw(_("Không phải user portal hợp lệ: {0}").format(user))
	full_name = frappe.db.get_value("User", user, "full_name")
	return {"user": user, "full_name": full_name, **_issue_token(user)}


@frappe.whitelist()
def set_enabled(user, enabled):
	"""Bật / tắt 1 user portal (không đụng tài khoản quản trị)."""
	_admin_guard()
	if not _is_portal_user(user):
		frappe.throw(_("Không phải user portal hợp lệ: {0}").format(user))
	frappe.db.set_value("User", user, "enabled", 1 if frappe.utils.cint(enabled) else 0)
	return {"user": user, "enabled": frappe.utils.cint(enabled)}


@frappe.whitelist(allow_guest=True, methods=["GET"])
def quick_login(token=None):
	"""Đích của QR: token hợp lệ → đăng nhập thẳng user portal → /kd.

	Token dùng 1 LẦN (xoá trước khi kiểm — thất bại cũng cháy), hết hạn theo
	cache TTL. Sai/hết hạn → về trang login thường (đường lùi an toàn).
	"""
	ok = False
	token = str(token or "")
	if len(token) >= 40 and re.match(r"^[A-Za-z0-9]+$", token):
		key = _QLOGIN_KEY.format(token=token)
		email = frappe.cache().get_value(key)
		frappe.cache().delete_value(key)  # one-time, kể cả nhánh fail phía dưới
		if email and _is_portal_user(email) and frappe.db.get_value("User", email, "enabled"):
			frappe.local.login_manager.login_as(email)
			frappe.logger("pkd").info(f"quick_login OK cho {email}")
			ok = True
	frappe.local.response["type"] = "redirect"
	frappe.local.response["location"] = "/kd" if ok else "/login?redirect-to=%2Fkd"
