# -*- coding: utf-8 -*-
"""Channel Sales Target — chỉ tiêu giao theo kênh × tháng (+ chi tiết nhóm hàng).

Là bản ghi thường (không workflow), truy vết bằng track_changes. Nhập qua SPA
(pkd.api.targets.save_target) — form Desk là phụ. Xem blueprint Mục 2.1.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate


class ChannelSalesTarget(Document):
	def before_validate(self):
		# "default năm hiện tại": set ở đây (chạy trước _validate_mandatory) để
		# save từ SPA/programmatic không cần truyền nam vẫn hợp lệ.
		if not self.nam:
			self.nam = getdate().year

	def validate(self):
		self._validate_kenh_is_root()
		self._validate_no_duplicate_item_group()
		self._validate_items_sum()
		self._validate_unique_combo()

	def _validate_kenh_is_root(self):
		"""(a) kenh phải là 1 trong 3 root khai báo trong PKD Settings."""
		settings = frappe.get_cached_doc("PKD Settings")
		roots = {settings.kenh_npp, settings.kenh_mt, settings.kenh_dulich}
		roots.discard(None)
		if not roots:
			frappe.throw(_("Chưa cấu hình 3 kênh trong PKD Settings."))
		if self.kenh not in roots:
			frappe.throw(
				_("Kênh phải là 1 trong 3 nhóm gốc cấu hình ở PKD Settings: {0}").format(
					", ".join(sorted(roots))
				)
			)

	def _validate_no_duplicate_item_group(self):
		"""(c) item_group không trùng trong bảng chi tiết."""
		seen = set()
		for row in self.items or []:
			if row.item_group in seen:
				frappe.throw(
					_("Nhóm hàng '{0}' bị trùng trong bảng chi tiết.").format(row.item_group)
				)
			seen.add(row.item_group)

	def _validate_items_sum(self):
		"""(b) nếu có dòng chi tiết → tổng phải bằng chỉ tiêu tháng (precision tiền tệ)."""
		if not self.items:
			return
		total = sum(flt(row.chi_tieu) for row in self.items)
		# So bằng precision tiền tệ (2 chữ số) để tránh sai số dấu phẩy động.
		if flt(total, 2) != flt(self.chi_tieu_thang, 2):
			frappe.throw(
				_(
					"Tổng chi tiết theo nhóm hàng ({0}) phải bằng Chỉ tiêu tháng ({1})."
				).format(flt(total, 2), flt(self.chi_tieu_thang, 2))
			)

	def _validate_unique_combo(self):
		"""(d) combo (nam, thang, kenh) là duy nhất — save_target sẽ upsert."""
		dup = frappe.db.exists(
			"Channel Sales Target",
			{
				"nam": self.nam,
				"thang": self.thang,
				"kenh": self.kenh,
				"name": ["!=", self.name],
			},
		)
		if dup:
			frappe.throw(
				_("Đã tồn tại chỉ tiêu cho kênh {0} tháng {1}/{2} (bản ghi {3}).").format(
					self.kenh, self.thang, self.nam, dup
				)
			)
