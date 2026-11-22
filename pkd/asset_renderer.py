# -*- coding: utf-8 -*-
"""Phục vụ asset của portal /kd theo ĐƯỜNG DẪN CÓ PHIÊN BẢN: /kd-assets/<ver>/<file>.

Vì sao (chữa tận gốc lỗi "Giao diện đang chạy bản CŨ … shell: X ≠ Y"):
- Cách cũ cache-bust bằng query `?v=` trên /assets/... Nếu CDN (Cloudflare "Ignore
  Query String" / Cache Rule bỏ query) hoặc nginx copy assets cũ (chưa `bench build`)
  thì `?v=` mới vẫn nhận file cũ → shell cũ chạy với HTML mới.
- Cách mới: phiên bản nằm TRONG ĐƯỜNG DẪN → mọi tầng cache coi là URL khác hẳn;
  file đọc THẲNG từ code app (apps/pkd/pkd/public/pkd) → không cần `bench build`,
  không phụ thuộc symlink/copy của sites/assets.
- <ver> = băm NỘI DUNG toàn bộ file asset → đổi đúng khi code đổi, ổn định giữa các
  lần tải trang → được cache vĩnh viễn (immutable) ở trình duyệt + CDN.
- Mọi import tương đối trong JS (./lib/…, ../components/…) tự kế thừa /kd-assets/<ver>/
  nên toàn bộ module cùng phiên bản — không cần import map nữa.

Đăng ký: hooks.py `page_renderer`. Frappe v16 thử renderer tuỳ biến TRƯỚC mọi renderer
chuẩn (path_resolver.PathResolver.resolve); process_response chỉ setdefault
Cache-Control nên header public/immutable ở đây được giữ, và response public không bị
gắn cookie (an toàn cho CDN).
"""

from __future__ import annotations

import hashlib
import os
import re
import time

import frappe
from frappe.website.page_renderers.base_renderer import BaseRenderer
from werkzeug.wrappers import Response

PREFIX = "kd-assets/"
# Chỉ phục vụ đúng các loại file của portal. MIME khớp gzip_types của nginx Frappe.
MIME = {
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
}
_VER_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_CACHE_FOREVER = "public, max-age=31536000, immutable"
_NO_CACHE = "no-cache"   # sai phiên bản → không cho CDN ghim nội dung lệch

# Cache trong tiến trình: chỉ băm lại nội dung khi "chữ ký" stat (mtime/size) đổi.
_state = {"sig": None, "ver": None, "checked": 0.0}
_RECHECK_SECONDS = 5.0


def asset_root() -> str:
	return os.path.realpath(frappe.get_app_path("pkd", "public", "pkd"))


def _asset_files(root: str):
	for dirpath, dirnames, filenames in os.walk(root):
		dirnames.sort()
		for fn in sorted(filenames):
			if os.path.splitext(fn)[1] in MIME:
				full = os.path.join(dirpath, fn)
				yield os.path.relpath(full, root).replace(os.sep, "/"), full


def asset_version() -> str:
	"""Phiên bản = 12 ký tự đầu SHA-1 của (đường dẫn + nội dung) mọi file asset.

	Băm theo NỘI DUNG (không theo mtime) → nhiều worker/nhiều máy chủ cùng code ra cùng
	phiên bản. Chỉ đọc lại nội dung khi stat thay đổi; stat tối đa mỗi 5 giây/tiến trình."""
	now = time.monotonic()
	if _state["ver"] and now - _state["checked"] < _RECHECK_SECONDS:
		return _state["ver"]
	root = asset_root()
	files = list(_asset_files(root))
	sig = tuple((rel, os.stat(full).st_mtime_ns, os.stat(full).st_size) for rel, full in files)
	if sig != _state["sig"]:
		h = hashlib.sha1()
		for rel, full in files:
			h.update(rel.encode())
			h.update(b"\0")
			with open(full, "rb") as fh:
				h.update(fh.read())
			h.update(b"\0")
		_state["sig"], _state["ver"] = sig, h.hexdigest()[:12]
	_state["checked"] = now
	return _state["ver"]


def asset_base() -> str:
	"""Tiền tố URL cho kd.html: /kd-assets/<ver>"""
	return f"/{PREFIX}{asset_version()}"


def _not_found() -> Response:
	return Response("Not Found", status=404, mimetype="text/plain", headers={"Cache-Control": _NO_CACHE})


class PKDAssetRenderer(BaseRenderer):
	def can_render(self):
		return self.path.startswith(PREFIX)

	def render(self):
		rest = self.path[len(PREFIX):]
		ver, sep, rel = rest.partition("/")
		if not sep or not rel or not _VER_RE.match(ver):
			return _not_found()
		ext = os.path.splitext(rel)[1]
		if ext not in MIME:
			return _not_found()
		root = asset_root()
		full = os.path.realpath(os.path.join(root, rel))
		# Chặn path traversal (../, symlink ra ngoài): phải nằm TRONG thư mục asset.
		if not full.startswith(root + os.sep) or not os.path.isfile(full):
			return _not_found()
		with open(full, "rb") as fh:
			data = fh.read()
		current = ver == asset_version()
		resp = Response(data, status=200, headers={
			"Content-Type": MIME[ext],
			"Cache-Control": _CACHE_FOREVER if current else _NO_CACHE,
			"X-Content-Type-Options": "nosniff",
		})
		resp.set_etag(hashlib.sha1(data).hexdigest())
		request = getattr(frappe.local, "request", None)
		if request is not None:
			resp.make_conditional(request)   # If-None-Match → 304
		return resp
