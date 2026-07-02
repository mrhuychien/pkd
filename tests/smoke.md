# Smoke test — pkd `/kd` (chạy trên bench thật)

Sau `migrate → build --app pkd → restart → refresh`, đăng nhập user có role
`Sales Dashboard` (và `Channel Manager` cho Trưng bày), mở `/kd` trên **mobile**.

## Chuẩn bị dữ liệu
- [ ] PKD Settings: đã chọn 3 Customer Group (NPP / MT / Du lịch).
- [ ] `[VERIFY]` UOM thùng: `BOX_UOMS = ("Thùng","Box")` trong `pkd/api/utils.py` khớp site.
- [ ] `[VERIFY]` mốc Tết trong `TET_DATES` (2015–2035) khớp lịch âm.

## 10 route
| # | Route | Kỳ vọng |
|---|---|---|
| 1 | `#/` Tổng quan | KPI×4, 3 thẻ kênh, 5 hàng đợi (badge count), donut mix; thẻ Tết nếu trong cửa sổ |
| 2 | `#/npp` | coverage, bar 12m, segment chips + biến động, Pareto, SKU thiếu, quá nhịp, aging |
| 3 | `#/mt` | hygiene (ẩn siêu thị nếu addr thiếu), bảng chuỗi (trailing/MTD), tap chuỗi → outlets, im lặng |
| 4 | `#/dulich` | by territory (hoặc cảnh báo bẩn), khách mới, đơn-2, quiet regulars, 12m |
| 5 | `#/them` | menu 4 mục |
| 6 | `#/trungbay` | chương trình + rank NPP/NVBH; empty nếu chưa cài salep / thiếu Channel Manager |
| 7 | `#/tet` | chart 4 mùa theo D-N, thẻ tiến độ, MT chưa đơn |
| 8 | `#/chitieu` | ma trận 12×3 + đèn; tap ô → modal nhập → lưu → refresh |
| 9 | `#/khampha` | filter → bảng + bar top15; nút Tải CSV ra file |
| 10 | `#/khach/<id>` | hồ sơ + badges + 12m + SKU + aging + 20 HĐ (mở từ mọi bảng/queue) |

## Đối chiếu số liệu (Gate 2)
- [ ] Doanh số MTD 1 tháng bất kỳ khớp report chuẩn ERPNext (đã loại `is_opening`).
- [ ] So kỳ period-aligned (MTD vs prev cùng số ngày; YoY dịch 12 tháng).
- [ ] Công nợ giữ opening; aging theo `COALESCE(due_date, posting_date)`.
- [ ] Không có cột giá vốn/margin ở bất kỳ số nào (grep `incoming_rate` = 0).

## Chặn quyền
- [ ] User KHÔNG có `Sales Dashboard` mở `/kd` → trang 403 (server chặn, không chỉ ẩn nút).
