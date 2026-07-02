# -*- coding: utf-8 -*-
"""PKD Settings — cấu hình 3 kênh + ngưỡng phân tích. Single DocType."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document


class PKDSettings(Document):
	"""Cấu hình trung tâm cho dashboard. Ngưỡng segment/aging/Tết đọc từ đây."""

	def validate(self):
		# 3 kênh phải là 3 Customer Group khác nhau (tránh cấu hình nhầm lặp).
		chosen = [self.kenh_npp, self.kenh_mt, self.kenh_dulich]
		filled = [c for c in chosen if c]
		if len(set(filled)) != len(filled):
			frappe.throw(_("3 kênh (NPP / MT / Du lịch) phải là 3 Nhóm KH khác nhau."))

		# Ngưỡng hạng A phải > hạng B để phân hạng đúng thứ tự.
		if self.hang_a_vnd and self.hang_b_vnd and self.hang_a_vnd <= self.hang_b_vnd:
			frappe.throw(_("Ngưỡng hạng A phải lớn hơn ngưỡng hạng B."))
