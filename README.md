# pkd — Dashboard Điều hành Phòng Kinh doanh RVHG

Custom app Frappe/ERPNext v16: dashboard **thông tin + điều hành** cho Phòng Kinh
doanh (nhịp NGÀY, dữ liệu sống từ Sales Invoice). Khác BOD Dashboard (nhịp tháng,
KPI đóng băng). Mỗi con số trả lời **"hôm nay làm gì"** → hàng đợi hành động là
trung tâm.

- www route: **`/kd`**
- CSS prefix: **`kd-`** · context global: **`PKD_CONTEXT`**
- Margin/COGS: **CẤM tuyệt đối** — không method nào query `incoming_rate`/giá vốn.

## Cài đặt

```bash
cd ~/frappe-bench
bench get-app pkd git@github.com:mrhuychien/pkd.git
bench --site <site-name> install-app pkd
bench --site <site-name> migrate
bench build --app pkd
bench restart
```

## Truy cập

```
https://<your-site>/kd
```

## Phân quyền — setup thủ công sau install

App gate bằng **1 lớp duy nhất**: role **`Sales Dashboard`**. Gán cho 3 user Phòng KD:

```bash
bench --site <site> add-user-role <user1@rvhg> "Sales Dashboard"
bench --site <site> add-user-role <user2@rvhg> "Sales Dashboard"
bench --site <site> add-user-role <user3@rvhg> "Sales Dashboard"
```

Để view **Trưng bày** (P2) đọc được API của app `salep`, gán thêm role
**`Channel Manager`** (role này do `salep` tạo qua patch — pkd **không** tạo lại):

```bash
bench --site <site> add-user-role <user1@rvhg> "Channel Manager"
```

Cấu hình 3 kênh (Customer Group) trong **PKD Settings** (Desk › PKD Settings)
trước khi dùng: Nhóm KH kênh NPP · MT · Du lịch.

## Tech stack

- Backend: Python whitelisted method (`pkd/api/*.py`), guard quyền dòng đầu, SQL
  tham số hoá. Không rải Server/Client Script.
- Data model: 3 DocType mới (`PKD Settings`, `Channel Sales Target` +
  `Channel Sales Target Item`); zero Custom Field trên DocType chuẩn.
- Frontend: SPA no-build (vanilla ES module, hash router, import map cache-bust,
  Chart.js lazy) tại www page `/kd`.

## Cấu trúc

```
pkd/
  hooks.py            # app config + fixtures (Role Sales Dashboard)
  modules.txt         # PKD
  api/                # utils, overview, channel, explore, debt, actions, targets, display, tet, customer
  pkd/doctype/        # channel_sales_target (+ item), pkd_settings
  www/                # kd.py (get_context guard) + kd.html (shell + import map)
  public/pkd/         # shell.js/css, lib/, components/, views/
  fixtures/           # role.json
docs/design-system.md # tham chiếu design system (port từ npp)
```
