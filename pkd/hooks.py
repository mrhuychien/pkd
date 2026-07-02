# -*- coding: utf-8 -*-
"""Frappe hooks for pkd — Dashboard Điều hành Phòng Kinh doanh RVHG."""

from . import __version__ as app_version  # noqa: F401

app_name = "pkd"
app_title = "PKD Dashboard"
app_publisher = "Hoang Giang JSC"
app_description = "Dashboard điều hành Phòng Kinh doanh RVHG"
app_email = "chien@1nguoi.com"
app_license = "MIT"

# ─────────────────────────────────────────────────────────────────────
# Static assets — KHÔNG nhồi vào mọi desk page. Assets của SPA nạp riêng
# trong www/kd.html qua <link>/<script> (xem import map ở đó).
# ─────────────────────────────────────────────────────────────────────
app_include_css = []
app_include_js = []
web_include_css = []
web_include_js = []

# ─────────────────────────────────────────────────────────────────────
# Fixtures — chỉ export Role "Sales Dashboard" (1 lớp gate cả app).
# KHÔNG có Custom Field / Property Setter (blueprint Mục 6: zero custom field).
# DocType + child + Single ship qua module JSON chuẩn, không qua fixtures.
# Filter đúng tên role để export không gom role khác (nextcode-build).
# ─────────────────────────────────────────────────────────────────────
fixtures = [
    {"doctype": "Role", "filters": [["name", "in", ["Sales Dashboard"]]]},
]

# MVP: mọi số liệu query-on-demand → KHÔNG cần doc_events/scheduler (Mục 5).
