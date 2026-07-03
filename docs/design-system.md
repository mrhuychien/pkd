# Design System — Frappe Portal SPA (phong cách thiết kế tái dùng)

> File **độc lập, tự chứa**. Gói toàn bộ *phong cách thiết kế* (design language)
> của NPP Portal (`/npp`) để **áp dụng nguyên cho các SPA portal khác** chạy trên
> Frappe/ERPNext v16 www page. Đây là phần **thị giác + tương tác**; phần kiến
> trúc/asset/cache xem `SKILL.md` + `references/cache-busting.md`.
>
> Term giữ nguyên tiếng Anh: design token, glassmorphism, gradient, skeleton,
> bottom-sheet, breakpoint, season.

---

## 0. Triết lý thiết kế (5 nguyên tắc)

1. **Mobile-first thật sự.** Thiết kế cho điện thoại 1 tay trước; desktop chỉ là
   *override* qua đúng **một** breakpoint `@media (min-width: 768px)`. NPP là
   nhân viên/chủ đại lý cầm điện thoại ngoài thị trường, không ngồi máy tính.
2. **Glassmorphism nhẹ + nền theo mùa.** Header/nav/overlay là kính mờ
   (`backdrop-filter: blur`) nổi trên nền gradient mùa. Tạo cảm giác "app" chứ
   không phải "trang web ERP".
3. **Thẻ bo tròn, bóng mềm, viền mảnh.** Mọi khối nội dung là `card`: nền trắng,
   `border 1px`, bo góc 10–28px, shadow rất nhẹ. Không kẻ bảng cứng, không khung đậm.
4. **Một accent màu "sống" theo mùa.** Nút chính, tab active, link nhấn, glow…
   đều lấy `--npp-season-*`. Đổi mùa = đổi toàn bộ tông app trong 0.6s mà không
   sửa 1 dòng JS.
5. **Vanilla, không framework UI.** Toàn bộ là CSS thường + template literal.
   Không Tailwind, không Bootstrap component (ERPNext đã kéo Bootstrap → ta
   **prefix mọi class** để không đụng nó). Nhẹ, tải nhanh, dễ port.

---

## 1. PORT sang portal mới trong 1 phút

Toàn bộ stylesheet này tự chứa trong **một file** `public/<app>/shell.css`.

```bash
# 1) Đổi prefix namespace (tránh đụng Bootstrap của ERPNext) — npp → mã app mới
sed 's/npp-/myapp-/g; s/NPP_/MYAPP_/g' npp/public/npp/shell.css > myapp/public/myapp/shell.css

# 2) Đổi palette: chỉ sửa block :root + 4 class .myapp-app.myapp-<season> (Mục 2–3)
# 3) (tuỳ chọn) Đổi font ở www page nếu không dùng Inter
```

**3 quy ước bất biến khi port** (vi phạm là vỡ giao diện trong Desk/web ERPNext):

| Quy ước | Lý do |
|---|---|
| **Mọi** class & biến prefix `myapp-` / `--myapp-` | ERPNext kéo Bootstrap; `.card/.btn/.table` trần sẽ bị đè. |
| Class mùa đặt trên `.myapp-app` **không phải `body`** | ERPNext sở hữu class list của `<body>`. |
| Reset (`margin/padding/box-sizing`) **scope trong `.myapp-app`** | Không được reset global — sẽ phá Desk. |

> Phần còn lại của file dùng nguyên prefix thật `npp-` để **copy-paste chính xác
> 100%** bản đã chạy thật. Khi port chỉ cần `sed` như trên.

---

## 2. Design tokens (nguồn chân lý duy nhất)

Tất cả màu/bóng/bo góc/kích thước khai báo **một chỗ** trong `:root`. Component
không bao giờ hard-code hex (trừ vài sắc thái badge/policy). Đổi thương hiệu =
sửa block này.

```css
:root {
    /* ── Nền & chữ (thang xám slate) ── */
    --npp-bg:        #f8fafc;   /* nền tổng (thường bị nền mùa phủ) */
    --npp-surface:   #ffffff;   /* mặt thẻ/card */
    --npp-surface-2: #f1f5f9;   /* mặt phụ: th của bảng, nút phụ, input nền */
    --npp-text:      #0f172a;   /* chữ chính (gần đen) */
    --npp-text-2:    #475569;   /* chữ phụ */
    --npp-text-3:    #94a3b8;   /* chữ mờ / label / placeholder */
    --npp-border:    #e2e8f0;   /* viền mảnh toàn app */

    /* ── Màu ngữ nghĩa (semantic — KHÔNG đổi theo mùa) ── */
    --npp-primary: #3b82f6;     /* xanh — link, hành động trung tính */
    --npp-success: #10b981;     /* xanh lá — thành công, "trong hạn" */
    --npp-danger:  #ef4444;     /* đỏ — công nợ, xoá, quá hạn nặng */
    --npp-warning: #f59e0b;     /* hổ phách — cảnh báo, sắp tới hạn */

    /* ── Bóng (mềm, tông slate, KHÔNG đen thuần) ── */
    --npp-shadow-sm: 0 1px 2px  rgba(15, 23, 42, 0.04);  /* card tĩnh */
    --npp-shadow-md: 0 4px 12px rgba(15, 23, 42, 0.06);  /* hover lift */
    --npp-shadow-lg: 0 12px 32px rgba(15, 23, 42, 0.10); /* modal/toast/menu nổi */

    /* ── Bo góc (thang 10/14/20/28) ── */
    --npp-radius-sm: 10px;   /* input, nút nhỏ, ảnh thumbnail */
    --npp-radius-md: 14px;   /* card, nút, modal desktop */
    --npp-radius-lg: 20px;   /* banner, modal desktop lớn */
    --npp-radius-xl: 28px;   /* mép trên bottom-sheet modal (mobile) */

    /* ── Kích thước thanh cố định ── */
    --npp-header-h: 56px;
    --npp-bottom-h: 64px;

    /* ── Token mùa (mặc định = Xuân; xem Mục 3) ── */
    --npp-season-1:   #ff6b9d;
    --npp-season-2:   #ffc371;
    --npp-season-grad: linear-gradient(135deg, #ff6b9d, #ffc371);
    --npp-season-bg:   linear-gradient(135deg, #fff5f7 0%, #ffe8f0 30%, #fff0e6 70%, #fef7ff 100%);
    --npp-season-glow: rgba(255, 107, 157, 0.15);
}
```

**Nguyên tắc dùng token:**
- Màu **ngữ nghĩa** (primary/success/danger/warning) cố định — báo trạng thái,
  KHÔNG đổi theo mùa. Đừng dùng đỏ cho nút "lưu", đừng dùng `season-1` cho lỗi.
- Màu **thương hiệu/accent** = `season-*` — đổi theo mùa. Nút chính, tab active,
  CTA, link nhấn, focus ring, glow.
- 3 cấp chữ (`text` → `text-2` → `text-3`) tạo phân cấp; label luôn `text-3`
  + uppercase + letter-spacing.

---

## 3. Hệ thống mùa (Seasonal theming) — chữ ký của design này

4 mùa, mỗi mùa đổi **accent (season-1/2), gradient nút, nền app, glow**. Đây là
đặc trưng nhận diện; portal mới có thể giữ 4 mùa hoặc rút còn 1 theme (chỉ cần
1 bộ token mùa).

```css
.npp-app.npp-spring {  /* 🌸 Xuân — hồng/cam đào */
    --npp-season-1: #ff6b9d; --npp-season-2: #ffc371;
    --npp-season-grad: linear-gradient(135deg, #ff6b9d, #ffc371);
    --npp-season-bg:   linear-gradient(135deg, #fff5f7 0%, #ffe8f0 30%, #fff0e6 70%, #fef7ff 100%);
    --npp-season-glow: rgba(255, 107, 157, 0.15);
}
.npp-app.npp-summer {  /* ☀️ Hạ — xanh biển/vàng */
    --npp-season-1: #4facfe; --npp-season-2: #ffd93d;
    --npp-season-grad: linear-gradient(135deg, #4facfe, #00f2fe);
    --npp-season-bg:   linear-gradient(135deg, #e0f7ff 0%, #fff9e6 50%, #e1f5fe 100%);
    --npp-season-glow: rgba(79, 172, 254, 0.15);
}
.npp-app.npp-autumn {  /* 🍂 Thu — cam/vàng nắng */
    --npp-season-1: #ff9a56; --npp-season-2: #ffd56b;
    --npp-season-grad: linear-gradient(135deg, #ff6a00, #ffa500);
    --npp-season-bg:   linear-gradient(135deg, #fff8f0 0%, #ffe8d6 30%, #fff5eb 70%, #fffaf5 100%);
    --npp-season-glow: rgba(255, 154, 86, 0.15);
}
.npp-app.npp-winter {  /* ❄️ Đông — lam/xanh băng */
    --npp-season-1: #4dd0e1; --npp-season-2: #81d4fa;
    --npp-season-grad: linear-gradient(135deg, #4dd0e1, #81d4fa);
    --npp-season-bg:   linear-gradient(135deg, #f0f9ff 0%, #e0f7fa 50%, #f5fbff 100%);
    --npp-season-glow: rgba(77, 208, 225, 0.15);
}
```

**Cơ chế (JS — `components/season-picker.js`):**
- Class `npp-<season>` gắn lên `#npp-app` (KHÔNG body).
- Lưu lựa chọn `localStorage['npp_season']`; lần đầu **auto theo tháng** (lịch VN:
  4/2→4/5 Xuân, 5/5→6/8 Hạ, 7/8→6/11 Thu, còn lại Đông).
- Nút mùa trên header đổi emoji theo mùa hiện tại; mở modal lưới 2×2 để chọn.
- `.npp-app { transition: background 0.6s ease }` → đổi mùa **mượt**, không giật.

**Nền mùa = 2 lớp:**
1. `.npp-app { background: var(--npp-season-bg) }` — gradient pastel nhạt toàn trang.
2. `.npp-app::before` — 2 vệt `radial-gradient` glow ở góc trên-trái & dưới-phải
   (`var(--npp-season-glow)`), `position: fixed; inset: 0; z-index: 0;
   pointer-events: none`. Nội dung nằm `z-index: 1` đè lên.

> **Port thành single-theme:** bỏ 4 block `.npp-app.npp-*`, chỉ giữ token mùa
> trong `:root`, bỏ nút + picker. Mọi component vẫn chạy vì chúng chỉ đọc
> `--npp-season-*`.

---

## 4. Typography

- **Font:** `Inter` (Google Fonts, weight 400/500/600/700/800), fallback
  `-apple-system, BlinkMacSystemFont, sans-serif`. Nạp ở www page với `preconnect`.
- **Body:** `line-height: 1.5`, `-webkit-font-smoothing: antialiased`.
- **Không có thang `font-size` toàn cục** — mỗi component tự khai (rem). Thang
  thực tế đang dùng:

| Vai trò | size / weight | Ghi chú |
|---|---|---|
| Header title | `1.05rem` / 700 | `letter-spacing: -0.01em`, ellipsis 1 dòng |
| Banner title | `1.25rem` / 700 | trên nền tối |
| KPI value (số to) | `1.35rem` / **800** | con số chủ đạo |
| Debt total (hero) | `2rem` / 800 | màu danger |
| Card value | `1.15rem` / 700 | |
| Body / input | `0.875–0.95rem` | |
| Text-sm | `0.85rem` | phụ |
| **Label** | `0.68–0.72rem` / 700 | **UPPERCASE** + `letter-spacing: 0.5px`, màu `text-3` |
| Nav item (bottom) | `0.65rem` / 500 | |
| Badge / pill | `0.7–0.75rem` / 600–700 | |

**Quy tắc label:** mọi nhãn nhỏ ("CÔNG NỢ HIỆN TẠI", "ĐỘ PHỦ") = `text-3` +
uppercase + letter-spacing + weight 700. Giá trị bên dưới = to, đậm 800, màu `text`.
Cặp *label mờ nhỏ / value đậm to* là nhịp điệu lặp lại khắp app.

---

## 5. Layout shell (khung 3 phần cố định)

```
┌─────────────────────────────────┐  .npp-header  (fixed top, 56px, glass blur)
│ [←]  Tiêu đề        [↻][season][👤]│  back ẩn ở route gốc; actions phải
├─────────────────────────────────┤
│                                 │  .npp-main (scroll, max-width 1200, padding 1rem)
│   <view render vào đây>         │  z-index:1 (đè lớp glow ::before)
│                                 │
├─────────────────────────────────┤  .npp-bottom-nav (fixed bottom, 64px, grid 5 cột, glass)
│  🏠      🛒      📦     💰     🎁  │  item active = màu season-1
└─────────────────────────────────┘
```

```css
.npp-app {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    color: var(--npp-text);
    background: var(--npp-season-bg);
    min-height: 100vh;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    transition: background 0.6s ease;
    padding-top: var(--npp-header-h);      /* chừa chỗ header fixed */
    padding-bottom: var(--npp-bottom-h);   /* chừa chỗ bottom-nav fixed */
}
.npp-header, .npp-bottom-nav {
    position: fixed; left: 0; right: 0; z-index: 100;
    background: rgba(255, 255, 255, 0.92);     /* glass */
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
}
.npp-header { top: 0; height: var(--npp-header-h); border-bottom: 1px solid var(--npp-border); }
.npp-bottom-nav {
    bottom: 0; height: var(--npp-bottom-h);
    border-top: 1px solid var(--npp-border);
    display: grid; grid-template-columns: repeat(5, 1fr);
}
.npp-header-inner, .npp-main { max-width: 1200px; margin: 0 auto; }
.npp-main { position: relative; z-index: 1; padding: 1rem; }
```

**4 điểm cốt:**
1. Header + nav **fixed + glass**; `.npp-app` bù `padding-top/bottom` đúng chiều
   cao để nội dung không bị che.
2. `max-width: 1200px; margin: 0 auto` cho cả header-inner lẫn main → desktop căn giữa.
3. **Mount point toàn cục** đặt cuối shell, render-một-lần (không nằm trong view):
   `#npp-toast-mount`, `#npp-modal-mount`, `#npp-loading-mount`.
4. View được router thay vào `#npp-view` (= `.npp-main`); mỗi view chỉ lo phần
   ruột, không đụng header/nav.

**Header actions** (icon button 40×40, bo 10px, hover nền `surface-2`,
`:active { transform: scale(0.96) }`): refresh, season, (manager nếu có), account.

---

## 6. Spacing, bo góc & utility

- **Spacing scale (rem):** `0.25 / 0.5 / 0.75 / 1` — gần như mọi `gap`,
  `margin`, `padding` rơi vào 4 mốc này. Padding card chuẩn = `1rem`.
- **Radius scale:** `sm 10 / md 14 / lg 20 / xl 28` (Mục 2).
- **Utility tối giản** (chỉ những cái hay lặp — KHÔNG làm cả Tailwind):

```
.npp-flex .npp-flex-col .npp-flex-wrap .npp-items-center .npp-justify-between
.npp-gap-1..4   (0.25/0.5/0.75/1rem)
.npp-mt-1..4
.npp-text-center .npp-text-end .npp-text-muted .npp-text-sm .npp-text-lg .npp-font-bold
```

Layout phức tạp hơn → viết class component riêng (vd `.npp-kpi-grid`), không
nhồi 10 utility vào markup.

---

## 7. Màu ngữ nghĩa & ánh xạ trạng thái

| Ý nghĩa | Token / màu | Dùng ở |
|---|---|---|
| Trung tính / link | `--npp-primary` #3b82f6 | link, nút thường, card "balance" |
| Tốt / trong hạn | `--npp-success` #10b981 | badge thành công, "đến hạn" |
| Nguy / nợ / xoá | `--npp-danger` #ef4444 | công nợ, nút xoá, quá hạn |
| Cảnh báo / sắp tới | `--npp-warning` #f59e0b | KPI cảnh báo, link "xem chi tiết nợ" |

**Badge** (pill `border-radius: 50px`, `0.7rem`/700, padding `4px 10px`) — cặp
nền nhạt + chữ đậm cùng tông:

```css
.npp-badge-success { background:#d1fae5; color:#065f46; }
.npp-badge-warning { background:#fef3c7; color:#92400e; }
.npp-badge-danger  { background:#fee2e2; color:#991b1b; }
.npp-badge-primary { background:#dbeafe; color:#1e40af; }
.npp-badge-muted   { background:#e2e8f0; color:#475569; }
```

Map trạng thái nghiệp vụ → badge: `Đã duyệt/Hoàn thành`→success, `Chờ/Nháp`→
warning, `Từ chối/Quá hạn`→danger, `Đang xử lý`→primary, còn lại→muted.

---

## 8. Catalog component (phần lõi — copy là chạy)

Mỗi component: **mục đích → markup → CSS**. Tất cả render bằng template literal
`html\`...\`` và `escapeHtml()` cho dữ liệu người dùng (xem Mục 12).

### 8.1 Card — khối nền tảng
Mọi nội dung bọc trong card. Nền trắng, viền mảnh, bóng rất nhẹ.
```css
.npp-card {
    background: var(--npp-surface);
    border: 1px solid var(--npp-border);
    border-radius: var(--npp-radius-md);
    padding: 1rem;
    box-shadow: var(--npp-shadow-sm);
}
```

### 8.2 View banner — đầu mỗi trang (nền tối + blob mùa)
Dải tối gradient slate, có "quả cầu" màu mùa mờ ở góc phải, badge tròn bên phải.
```css
.npp-view-banner {
    background: linear-gradient(135deg, #1e293b, #334155);
    color: #fff; border-radius: var(--npp-radius-lg);
    padding: 1.25rem; margin-bottom: 1rem;
    display: flex; justify-content: space-between; align-items: center; gap: 1rem;
    position: relative; overflow: hidden;
}
.npp-view-banner::before {            /* blob mùa mờ */
    content:''; position:absolute; top:-50%; right:-20%; width:70%; height:200%;
    background: var(--npp-season-grad); opacity:.15; border-radius:50%; filter: blur(50px);
}
.npp-view-banner > * { position: relative; z-index: 1; }
.npp-view-banner-title { font-size:1.25rem; font-weight:700; letter-spacing:-.01em; }
.npp-view-banner-subtitle { font-size:.85rem; margin-top:2px; }
/* BẮT BUỘC: ép màu chữ sáng + !important để THẮNG CSS heading/p của web template */
.npp-view-banner .npp-view-banner-title    { color:#fff !important; }
.npp-view-banner .npp-view-banner-subtitle { color: rgba(255,255,255,.8) !important; }
.npp-view-banner-badge {
    background: rgba(255,255,255,.15); padding:6px 12px; border-radius:50px;
    font-size:.75rem; font-weight:600; border:1px solid rgba(255,255,255,.2);
}
```
> ⚠️ Banner/text trên nền tối **phải** ép `color … !important` — nếu không
> Bootstrap/Frappe của web.html sẽ nhuộm chữ tối → "chữ lẫn vào nền".

### 8.3 Dashboard card — icon + thông tin + chevron (clickable)
Hàng: icon emoji to · (label/value/sub) · chevron. Hover nhấc nhẹ.
```css
.npp-dashboard-grid { display:flex; flex-direction:column; gap:.75rem; }
@media (min-width:768px){ .npp-dashboard-grid{ display:grid; grid-template-columns:1fr 1fr; } }
.npp-dash-card { display:flex; align-items:center; gap:1rem; text-decoration:none; color:var(--npp-text);
    transition: transform .15s ease, box-shadow .15s ease; }
.npp-dash-card:hover { transform: translateY(-1px); box-shadow: var(--npp-shadow-md); }
.npp-dash-icon { font-size:2rem; flex-shrink:0; }
.npp-dash-info { flex:1; }
.npp-dash-label { font-size:.7rem; color:var(--npp-text-3); text-transform:uppercase; letter-spacing:.5px; font-weight:700; }
.npp-dash-value { font-size:1.15rem; font-weight:700; margin-top:2px; }
.npp-dash-sub   { font-size:.75rem; color:var(--npp-text-2); margin-top:2px; }
.npp-dash-chev  { color: var(--npp-text-3); }
.npp-dash-debt .npp-dash-value { color: var(--npp-danger); }  /* card công nợ → đỏ */
```

### 8.4 KPI grid — lưới số liệu (2 cột mobile)
```css
.npp-kpi-grid  { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; margin-top:1rem; }
.npp-kpi-card  { background:var(--npp-surface); border:1px solid var(--npp-border);
                 border-radius:var(--npp-radius-md); padding:1rem; }
.npp-kpi-label { font-size:.7rem; color:var(--npp-text-3); text-transform:uppercase; letter-spacing:.5px; font-weight:700; }
.npp-kpi-value { font-size:1.35rem; font-weight:800; margin-top:4px; color:var(--npp-text); }
.npp-kpi-value.warning { color: var(--npp-warning); }
.npp-kpi-value.danger  { color: var(--npp-danger); }
.npp-kpi-sub   { font-size:.72rem; color:var(--npp-text-2); margin-top:2px; }
```

### 8.5 Data table — **bảng desktop → thẻ mobile** (đặc trưng quan trọng)
Trên ≥768px là bảng thường; ≤767px **mỗi hàng bung thành card**, ô hiện
`label: value` nhờ `td[data-label]::before`. Component JS tự gắn `data-label`.
```css
.npp-table { width:100%; border-collapse:collapse; font-size:.875rem; }
.npp-table th, .npp-table td { padding:.75rem; text-align:left; border-bottom:1px solid var(--npp-border); }
.npp-table th { background:var(--npp-surface-2); font-size:.7rem; font-weight:700;
    color:var(--npp-text-2); text-transform:uppercase; letter-spacing:.5px; }
.npp-table-row-clickable { cursor:pointer; }
.npp-table-row-clickable:hover { background: var(--npp-surface-2); }

@media (max-width:767px){
    .npp-table thead { display:none; }
    .npp-table, .npp-table tbody, .npp-table tr, .npp-table td { display:block; width:100%; }
    .npp-table tr { background:var(--npp-surface); border:1px solid var(--npp-border);
        border-radius:var(--npp-radius-md); padding:.75rem; margin-bottom:.5rem; }
    .npp-table td { display:flex; justify-content:space-between; align-items:center;
        border:none; padding:.25rem 0; }
    .npp-table td::before { content: attr(data-label); font-weight:600;
        color:var(--npp-text-2); font-size:.75rem; text-transform:uppercase; }
}
```
> Markup phải có `<td data-label="Tên cột">` thì layout mobile mới hiện nhãn.

### 8.6 Pill nav (sub-tabs) — điều hướng trong trang
Hàng "viên thuốc" bo tròn; cái active đổ gradient mùa. Dùng cho tab con
(vd `/ql-km`: Cần duyệt / Chương trình / Điểm bán / Nhân viên).
```css
.npp-ql-nav { display:flex; flex-wrap:wrap; gap:.5rem; margin:.75rem 0; }
.npp-ql-nav a { padding:8px 14px; border-radius:100px; text-decoration:none;
    background:var(--npp-surface); border:1px solid var(--npp-border);
    color:var(--npp-text-2); font-weight:600; font-size:.85rem; }
.npp-ql-nav a.npp-active { background: var(--npp-season-grad); color:#fff; border-color:transparent; }
```

### 8.7 Tab bar — tab chia đều full-width
```css
.npp-dh-tabs { display:flex; gap:.5rem; margin-bottom:.75rem; }
.npp-dh-tab  { flex:1; padding:.75rem; background:var(--npp-surface);
    border:1px solid var(--npp-border); border-radius:var(--npp-radius-md);
    font-weight:700; cursor:pointer; color:var(--npp-text); }
.npp-dh-tab.npp-active { background: var(--npp-season-grad); color:#fff; border-color:transparent; }
```

### 8.8 Filter bar + ô tìm kiếm có icon
```css
.npp-ql-filters { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; }
.npp-ql-filters select { padding:8px 10px; border-radius:10px; border:1px solid var(--npp-border);
    background:var(--npp-surface); color:var(--npp-text); font-weight:600; font-size:.85rem; }

.npp-dh-search-wrap { position:relative; margin-bottom:1rem; }
.npp-dh-search-wrap i { position:absolute; top:50%; left:1rem; transform:translateY(-50%); color:var(--npp-text-3); }
.npp-dh-search { width:100%; padding:.75rem 1rem .75rem 2.75rem;  /* chừa chỗ icon trái */
    border:1px solid var(--npp-border); border-radius:var(--npp-radius-md);
    background:var(--npp-surface); font-size:.95rem; }
```

### 8.9 Buttons
```css
/* Chính — gradient mùa, full-width, icon + label căn giữa */
.npp-btn-primary { background:var(--npp-season-grad); color:#fff; border:none;
    padding:.75rem 1.5rem; border-radius:var(--npp-radius-md); font-weight:700; cursor:pointer;
    width:100%; display:flex; align-items:center; justify-content:center; gap:.5rem; }
/* Nguy hiểm — đỏ đặc */
.npp-btn-danger { background:var(--npp-danger); color:#fff; border:none;
    padding:.75rem 1rem; border-radius:var(--npp-radius-md); font-weight:700; cursor:pointer;
    flex:1; display:flex; align-items:center; justify-content:center; gap:.5rem; }
/* Icon button (header) */
.npp-icon-btn { width:40px; height:40px; border:none; background:transparent; border-radius:10px;
    color:var(--npp-text-2); font-size:1rem; cursor:pointer;
    display:flex; align-items:center; justify-content:center; transition: background .15s ease; }
.npp-icon-btn:hover { background: var(--npp-surface-2); }
.npp-icon-btn:active { transform: scale(0.96); }
```

### 8.10 Input / textarea — focus ring màu mùa
```css
.npp-textarea { width:100%; border:1px solid var(--npp-border); border-radius:var(--npp-radius-sm);
    padding:.75rem; font-family:inherit; font-size:.875rem; background:var(--npp-surface); resize:vertical; }
.npp-textarea:focus { outline:none; border-color:var(--npp-season-1);
    box-shadow: 0 0 0 3px var(--npp-season-glow); }   /* ring = glow mùa */
```
> Mẫu focus chuẩn: `border-color: season-1` + `box-shadow: 0 0 0 3px season-glow`.

### 8.11 Modal — bottom-sheet (mobile) → centered (desktop)
Mobile: trượt từ đáy lên, bo góc trên `xl`. Desktop: hiện giữa, scale-in.
```css
.npp-modal-mount { position:fixed; inset:0; background: rgba(15,23,42,.5);
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    z-index:9999; display:none; align-items:flex-end; justify-content:center; }
.npp-modal-mount.npp-show { display:flex; }
.npp-modal-content { background:var(--npp-surface);
    border-radius: var(--npp-radius-xl) var(--npp-radius-xl) 0 0;  /* bo 2 góc trên */
    width:100%; max-height:90vh; overflow-y:auto; padding:1.25rem; animation: nppModalUp .25s ease; }
@keyframes nppModalUp { from{ transform:translateY(100%);} to{ transform:translateY(0);} }
@media (min-width:768px){
    .npp-modal-mount { align-items:center; }                      /* giữa màn hình */
    .npp-modal-content { max-width:600px; border-radius:var(--npp-radius-lg); max-height:85vh; }
    @keyframes nppModalUp { from{ transform:scale(.95); opacity:0;} to{ transform:scale(1); opacity:1;} }
}
```
API JS: `showModal({title, body, footer})` / `closeModal()`; click nền (backdrop)
hoặc nút × để đóng; có `setModalCloseHandler(fn)` để cleanup.

### 8.12 Toast — góc trên-phải, trượt ngang, viền trái màu trạng thái
```css
.npp-toast-mount { position:fixed; top: calc(var(--npp-header-h) + .5rem); right:.75rem;
    z-index:1000; display:flex; flex-direction:column; gap:.5rem; pointer-events:none; }
.npp-toast { background:var(--npp-surface); border:1px solid var(--npp-border);
    border-left:4px solid var(--npp-primary); box-shadow:var(--npp-shadow-lg);
    border-radius:var(--npp-radius-md); padding:.75rem 1rem; font-size:.875rem; font-weight:500;
    max-width:320px; pointer-events:auto; animation: nppToastIn .25s ease; }
.npp-toast.npp-success { border-left-color: var(--npp-success); }
.npp-toast.npp-error   { border-left-color: var(--npp-danger); }
.npp-toast.npp-warning { border-left-color: var(--npp-warning); }
@keyframes nppToastIn  { from{opacity:0; transform:translateX(100%);} to{opacity:1; transform:translateX(0);} }
@keyframes nppToastOut { to{opacity:0; transform:translateX(100%);} }
```
API: `showToast(msg, 'success'|'error'|'warning'|'info')`, tự biến mất sau ~3.5s.

### 8.13 Loading overlay — full-screen blur + spinner
```css
.npp-loading-mount { position:fixed; inset:0; background: rgba(15,23,42,.7);
    backdrop-filter: blur(6px); z-index:10000; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:1rem; }
.npp-loading-mount[hidden] { display:none !important; }
.npp-loading-spinner { width:48px; height:48px; border:3px solid rgba(255,255,255,.3);
    border-top-color:#fff; border-radius:50%; animation: nppSpin .9s linear infinite; }
.npp-loading-text { color:#fff; font-weight:600; }
@keyframes nppSpin { to { transform: rotate(360deg); } }
```
Dùng cho hành động chặn (submit). Còn **tải dữ liệu trong trang → dùng skeleton**.

### 8.14 Skeleton — shimmer khi đang tải (KHÔNG để màn trắng)
```css
.npp-skeleton { background: linear-gradient(90deg, var(--npp-surface-2) 25%, var(--npp-border) 50%, var(--npp-surface-2) 75%);
    background-size: 200% 100%; animation: nppSkeleton 1.4s ease-in-out infinite; border-radius: var(--npp-radius-sm); }
@keyframes nppSkeleton { 0%{ background-position:200% 0;} 100%{ background-position:-200% 0;} }
```
Mẫu dùng: render ngay khung skeleton (`<div class="npp-skeleton" style="height:90px">`),
gọi API, rồi thay nội dung thật. Router cũng đặt skeleton 200px khi nạp view.

### 8.15 Empty state
```css
.npp-empty { display:flex; flex-direction:column; align-items:center; gap:.5rem;
    padding:3rem 1rem; text-align:center; color:var(--npp-text-3); }
.npp-empty-icon  { font-size:3rem; }                 /* emoji: 📭 / ⚠️ */
.npp-empty-title { font-size:1.1rem; font-weight:700; color:var(--npp-text); }
```

### 8.16 Detail list — danh sách key/value (modal chi tiết)
```css
.npp-detail-list { display:grid; grid-template-columns: max-content 1fr; gap:.5rem 1rem; margin:0; font-size:.875rem; }
.npp-detail-list dt { color:var(--npp-text-3); font-weight:600; }
.npp-detail-list dd { color:var(--npp-text); margin:0; word-break:break-word; }
```

### 8.17 CTA block — dải kêu gọi hành động (gradient mùa)
```css
.npp-cta-block { display:flex; align-items:center; justify-content:center; gap:.75rem;
    background:var(--npp-season-grad); color:#fff; text-decoration:none; padding:1rem;
    border-radius:var(--npp-radius-md); font-weight:700; margin-top:1rem; box-shadow:var(--npp-shadow-md); }
```

### 8.18 Risk / alert bar — dải cảnh báo đỏ
```css
.npp-risk-bar { display:flex; flex-wrap:wrap; gap:1rem; align-items:center;
    background:#fef2f2; border:1px solid #fecaca; color:#991b1b;
    border-radius:var(--npp-radius-md); padding:.75rem 1rem; margin-bottom:.75rem; font-size:.85rem; }
.npp-risk-bar strong { color:#b91c1c; }
```

### 8.19 Policy card — khối thông điệp 2 sắc thái (Tết/thường)
```css
.npp-policy-card { display:flex; gap:.75rem; align-items:flex-start;
    border-radius:var(--npp-radius-md); padding:1rem; margin-top:1rem; }
.npp-policy-card.tet    { background:#fff1f2; border:1px solid #fecdd3; }  /* hồng Tết */
.npp-policy-card.normal { background:#ecfdf5; border:1px solid #bbf7d0; }  /* xanh thường */
.npp-policy-icon { font-size:1.6rem; line-height:1; }
```

### 8.20 Account / logout menu — dropdown góc phải header
```css
.npp-acct-menu { position:fixed; top: calc(var(--npp-header-h) + 6px); right:8px; z-index:1200;
    background:var(--npp-surface); border:1px solid var(--npp-border); border-radius:14px;
    box-shadow:var(--npp-shadow-lg); padding:12px 14px; min-width:190px; }
.npp-acct-menu[hidden] { display:none; }
.npp-acct-name   { font-weight:700; font-size:.92rem; }
.npp-acct-sub    { font-size:.78rem; color:var(--npp-text-3); margin-top:2px; }
.npp-acct-logout { margin-top:12px; width:100%; padding:8px 10px; border:1px solid var(--npp-border);
    border-radius:10px; background:var(--npp-surface-2); color:var(--npp-danger); font-weight:700; cursor:pointer; }
.npp-acct-logout:hover { background: var(--npp-danger); color:#fff; }
```

### 8.21 Product card + price chip + qty control (màn đặt hàng)
```css
.npp-dh-grid { display:grid; grid-template-columns: repeat(2,1fr); gap:.5rem; padding-bottom:6rem; }
@media (min-width:768px){ .npp-dh-grid{ grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); gap:1rem; } }
.npp-product-card { background:var(--npp-surface); border:1px solid var(--npp-border);
    border-radius:var(--npp-radius-md); padding:.75rem; display:flex; flex-direction:column; gap:.5rem; }
.npp-product-img { aspect-ratio:4/3; background-size:cover; background-position:center;
    background-color:var(--npp-surface-2); border-radius:var(--npp-radius-sm); }
.npp-product-card h6 { font-size:.85rem; font-weight:600; line-height:1.3;
    overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }  /* clamp 2 dòng */
.npp-product-price { font-size:.7rem; font-weight:600; color:var(--npp-season-1);
    background:var(--npp-season-glow); padding:4px 8px; border-radius:6px; align-self:flex-start; }
.npp-qty-control { display:flex; align-items:center; gap:4px; margin-top:auto; }
.npp-qty-btn { width:28px; height:28px; border:1px solid var(--npp-border); border-radius:8px;
    background:var(--npp-surface-2); cursor:pointer; font-weight:700; }
.npp-qty-input { flex:1; min-width:0; height:28px; text-align:center;
    border:1px solid var(--npp-border); border-radius:8px; font-weight:600; }
```

### 8.22 Sticky summary + CTA (thanh tổng đơn dính đáy, trên bottom-nav)
```css
.npp-dh-summary { position:fixed; bottom: calc(var(--npp-bottom-h) + 60px); left:0; right:0;
    background: rgba(255,255,255,.96); backdrop-filter: blur(10px);
    border-top:1px solid var(--npp-border); padding:.75rem 1rem; text-align:center; z-index:50; font-size:.875rem; }
.npp-dh-cta { position:fixed; bottom: var(--npp-bottom-h); left:0; right:0;
    background:var(--npp-season-grad); color:#fff; border:none; padding:1rem; font-weight:700;
    cursor:pointer; z-index:51; display:flex; justify-content:center; align-items:center; gap:.5rem; }
```

### 8.23 Aging bar — thanh tiến độ tuổi nợ
```css
.npp-aging-bar { height:8px; background:var(--npp-surface-2); border-radius:4px; overflow:hidden; margin-top:4px; }
.npp-aging-bar > div { height:100%; transition: width .3s ease; }  /* set width % + màu inline */
```

### 8.24 Chart wrap (Chart.js lazy-load)
```css
.npp-chart-wrap { position:relative; height:240px; margin-top:.75rem; }
@media (min-width:768px){ .npp-chart-wrap{ height:300px; } }
```
> Chart.js nạp lazy từ CDN 1 lần; **destroy chart cũ** trước khi vẽ lại (tránh leak).

---

## 9. Chuyển động & tương tác (motion)

| Hiệu ứng | Giá trị | Áp ở |
|---|---|---|
| Nhấn (tactile) | `:active { transform: scale(0.95–0.96) }` | icon-btn, nav item |
| Hover nhấc | `translateY(-1px..-2px)` + shadow `md` | card, dash-card, các card click được |
| Transition chuẩn | `0.15s ease` | màu nền, transform nhỏ |
| Transition mượt vừa | `0.2s–0.3s` | hover card, aging bar width |
| Đổi mùa | `background 0.6s ease` (cả `::before`) | `.npp-app` |
| Glass | `backdrop-filter: blur(4–20px)` | header/nav/modal/loading/summary |
| Modal vào | slide-up `.25s` (mobile) / scale-in (desktop) | |
| Toast | slide-in/out ngang `.25s` | |
| Spinner | `rotate 0.9s linear infinite` | |
| Skeleton | shimmer `1.4s ease-in-out infinite` | |

Triết lý motion: **nhanh, nhẹ, có phản hồi xúc giác**. Mọi nút bấm phải "lún" nhẹ;
mọi card click được phải "nhấc" khi hover; chuyển trạng thái không bao giờ giật.

---

## 10. Chiến lược responsive

- **Mobile-first**: CSS gốc viết cho điện thoại. Desktop = override trong **một**
  `@media (min-width: 768px)` (vài chỗ dùng `max-width: 767/640/820px` cho lưới co lại).
- **Mẫu lặp:** mobile 1 cột → desktop 2 cột (`.npp-dashboard-grid`, `.npp-grid-2`,
  `.npp-cn-summary` 3 cột desktop / 1 cột mobile).
- **Bảng:** desktop bảng thật → mobile mỗi hàng thành card (Mục 8.5).
- **Modal:** mobile bottom-sheet → desktop hộp giữa (Mục 8.11).
- **Grid sản phẩm:** mobile 2 cột cố định → desktop `auto-fill minmax(220px)`.
- `max-width: 1200px; margin: 0 auto` giữ nội dung không giãn quá rộng trên màn lớn.
- `<meta viewport ... maximum-scale=1, user-scalable=no>` — app-like, chặn zoom lệch.

---

## 11. Icon & emoji

- **Font Awesome 6** (`fas`) cho icon chức năng: `fa-house, fa-cart-plus, fa-box,
  fa-coins, fa-gift, fa-arrow-left, fa-sync-alt, fa-users, fa-circle-user,
  fa-right-from-bracket, fa-chevron-right, fa-times, fa-search`.
- **Emoji** cho: icon mùa (🌸☀️🍂❄️), icon danh mục dashboard (💰📦🎁📊),
  empty/error (📭⚠️), policy (🎁), tab (🔔🎯🏪👥). Emoji = nhận diện nhanh, không
  cần asset, đa nền tảng.
- Quy ước: **chevron phải** (`fa-chevron-right`, màu `text-3`) ở cuối mọi card
  điều hướng được.

---

## 12. Accessibility & i18n (bắt buộc)

- **`escapeHtml()` mọi dữ liệu người dùng** trước khi nhét vào `innerHTML`
  (template literal KHÔNG tự escape). Có sẵn trong `lib/format.js`.
- **aria** trên icon button: `aria-label` tiếng Việt ("Quay lại", "Làm mới",
  "Đổi mùa", "Đóng"); modal `role="dialog" aria-modal="true"`.
- **Định dạng VN tập trung** (`lib/format.js`):
  - `formatNumber` — `Intl.NumberFormat('vi-VN')` + `Math.round`, 0 chữ số thập phân.
  - `formatCurrency` — `… ₫`.
  - `formatVNDShort` — thẻ lớn: `1.600.000.000 → "1,6 tỷ"`, `33.000.000 → "33 tr"`.
  - `formatDate / formatDateTime` — `vi-VN` `dd/mm/yyyy`.
- Toàn bộ chữ UI tiếng Việt; term kỹ thuật giữ tiếng Anh khi cần.

---

## 13. Cheat-sheet class (tra nhanh)

```
KHUNG     .npp-app .npp-header .npp-header-inner .npp-header-title .npp-header-actions
          .npp-main .npp-bottom-nav .npp-nav-item(.npp-active) .npp-icon-btn .npp-season-icon
KHỐI      .npp-card  .npp-view-banner(-title/-subtitle/-badge)
          .npp-dashboard-grid .npp-dash-card(-icon/-info/-label/-value/-sub/-chev) .npp-dash-debt
KPI       .npp-kpi-grid .npp-kpi-card .npp-kpi-label .npp-kpi-value(.warning/.danger) .npp-kpi-sub
BẢNG      .npp-table .npp-table-row-clickable   (td[data-label] cho mobile)
ĐIỀU HƯỚNG .npp-ql-nav a(.npp-active)  .npp-dh-tabs .npp-dh-tab(.npp-active)
FORM      .npp-ql-filters  .npp-dh-search-wrap .npp-dh-search  .npp-textarea  .npp-cn-input
NÚT       .npp-btn-primary .npp-btn-danger .npp-icon-btn .npp-qty-btn .npp-cn-btn
TRẠNG THÁI .npp-badge-(success/warning/danger/primary/muted)
          .npp-risk-bar .npp-policy-card(.tet/.normal) .npp-note-(npp/internal)
OVERLAY   .npp-modal-mount(.npp-show) .npp-modal-content  .npp-toast(-mount)  .npp-loading-mount
TẢI       .npp-skeleton  .npp-empty(-icon/-title)
KHÁC      .npp-detail-list .npp-cta-block .npp-link .npp-acct-menu
          .npp-product-card(-img) .npp-product-price .npp-qty-control .npp-qty-input
          .npp-dh-grid .npp-dh-summary .npp-dh-cta .npp-aging-bar .npp-chart-wrap
UTILITY   .npp-flex(-col/-wrap) .npp-items-center .npp-justify-between .npp-gap-1..4
          .npp-mt-1..4 .npp-text-(center/end/muted/sm/lg) .npp-font-bold
```

---

## 14. Checklist reskin portal mới

- [ ] `sed 's/npp-/<app>-/g'` cho `shell.css` (+ đổi `NPP_CONTEXT` global ở www/shell).
- [ ] Reset & class mùa scope trong `.<app>-app`, **không** đụng `body`.
- [ ] Sửa `:root` palette + (giữ/rút) 4 block mùa; semantic color giữ nguyên ý nghĩa.
- [ ] Nạp font (Inter hoặc khác) + Font Awesome ở `head_include`.
- [ ] Header 56px + bottom-nav 64px + `padding-top/bottom` khớp; 3 mount point cuối shell.
- [ ] Banner mỗi view ép `color … !important` (thắng Bootstrap web template).
- [ ] Tải dữ liệu → **skeleton**; hành động chặn → **loading overlay**; lỗi/ok → **toast**.
- [ ] Bảng có `td[data-label]` để bung card trên mobile.
- [ ] `escapeHtml` mọi dữ liệu; tiền/ngày qua `format.js`; aria-label cho icon button.
- [ ] Test thật trên **điện thoại** trước, desktop sau.

---

---

## 15. Reskin #2 (npp → kd, app `pkd`) — bài học port + component mới nhập hệ

Hệ này đã reskin thành công lần 2 cho dashboard PKD (`/kd`, prefix `kd-`).
Port đúng 1 lệnh sed như Mục 1 **NHƯNG** có 2 bẫy sed không bắt được:

```bash
# ⚠️ sed 's/npp-/kd-/g' KHÔNG đụng tới identifier camelCase — phải rename riêng:
sed 's/npp-/kd-/g; s/NPP_/PKD_/g;
     s/nppToast/kdToast/g; s/nppModalUp/kdModalUp/g;
     s/nppSpin/kdSpin/g; s/nppSkeleton/kdSkeleton/g' \
    npp/public/npp/shell.css > <app>/public/<app>/shell.css
# (liệt kê trước khi port:  grep -oE "npp[A-Za-z]+" shell.css | sort -u)
```
- **@keyframes camelCase** (`nppToastIn/Out`, `nppModalUp`, `nppSpin`,
  `nppSkeleton`) và mọi `animation:` tham chiếu chúng — thiếu là toast/modal/
  skeleton đứng hình mà không lỗi console.
- **localStorage key mùa** trong season-picker (`npp_season` → `<app>_season`)
  — không đổi thì 2 portal cùng site giẫm theme của nhau.

Verify sau port (0 mới đạt): `grep -c "npp-" shell.css` **và**
`grep -oE "npp[A-Za-z]+" shell.css` — bắt cả dạng gạch nối lẫn camelCase.

### Component mới nhập hệ từ pkd (viết prefix gốc `npp-`, port thì sed như thường)

```css
/* Queue row — hàng đợi hành động ("hôm nay làm gì"), tap cả dòng đi drill-down */
.npp-queue-list { display: flex; flex-direction: column; }
.npp-queue-row { display: flex; align-items: center; justify-content: space-between;
    gap: 8px; padding: 9px 4px; border-bottom: 1px solid var(--npp-border);
    color: var(--npp-text); text-decoration: none; }
.npp-queue-row:last-child { border-bottom: 0; }
.npp-queue-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.npp-queue-val  { font-weight: 700; color: var(--npp-text-2); flex-shrink: 0; font-size: .9rem; }

/* Đèn pace (ô ma trận chỉ tiêu): xanh ≥ nhịp, vàng ≥ 80% nhịp, đỏ < 80% nhịp.
   LUÔN semantic color — KHÔNG dùng màu mùa cho ngữ nghĩa đạt/hụt. */
.npp-cell-light { display: inline-block; min-width: 42px; padding: 1px 6px;
    border-radius: 8px; font-weight: 800; font-size: .8rem; }
.npp-cell-green { background: rgba(16,185,129,.15); color: #047857; }
.npp-cell-amber { background: rgba(245,158,11,.16); color: #b45309; }
.npp-cell-red   { background: rgba(239,68,68,.14);  color: #b91c1c; }
.npp-matrix-cell { cursor: pointer; }          /* ô tap được → modal nhập */

/* Pager — phân trang bảng dài (đi kèm paged()/pagedTable(), xem pagination.md) */
.npp-pager { display: flex; align-items: center; justify-content: center;
    gap: 12px; padding: 10px 0 2px; }
.npp-pager-btn { padding: 6px 14px; border: 1px solid var(--npp-border);
    border-radius: 999px; background: var(--npp-surface); color: var(--npp-text);
    font-weight: 700; font-size: .85rem; cursor: pointer; }
.npp-pager-btn:disabled { opacity: .35; cursor: default; }
.npp-pager-info { font-size: .82rem; font-weight: 600; color: var(--npp-text-2); }

/* Progress bar mảnh (tiến độ chương trình) — fill dùng gradient mùa (trang trí) */
.npp-progress { height: 8px; border-radius: 6px; background: var(--npp-surface-2); overflow: hidden; }
.npp-progress > span { display: block; height: 100%; background: var(--npp-season-grad); }

/* Menu list — màn "Thêm" (emoji + tiêu đề + mô tả, cả khối tap được) */
.npp-menu-list { display: flex; flex-direction: column; gap: 10px; }
.npp-menu-item { display: flex; align-items: center; gap: 14px; padding: 16px;
    background: var(--npp-surface); border: 1px solid var(--npp-border);
    border-radius: var(--npp-radius-md); color: var(--npp-text);
    text-decoration: none; font-weight: 600; box-shadow: var(--npp-shadow-sm); }
.npp-menu-item .npp-menu-emoji { font-size: 1.5rem; }

/* Desktop nav ngang — đủ mọi mục khi màn rộng (bottom-nav mobile chỉ 5 slot) */
.npp-desktop-nav { display: none; }
@media (min-width: 768px) {
    .npp-desktop-nav { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 0; }
    .npp-desktop-nav a { padding: 7px 14px; border-radius: 999px; text-decoration: none;
        font-weight: 700; color: var(--npp-text-2); background: var(--npp-surface);
        border: 1px solid var(--npp-border); }
    .npp-desktop-nav a.npp-active { background: var(--npp-season-grad); color: #fff; border-color: transparent; }
}

/* Hàng pills chọn ngữ cảnh (vd đổi kênh) — biến thể đậm của pill nav 8.6,
   đặt NGAY TRÊN hàng tab thường để phân cấp "chọn phạm vi → chọn màn" */
.npp-ql-channels { margin-bottom: 4px; }
.npp-ql-channels a { font-weight: 800; }
.npp-ql-channels a.npp-active { box-shadow: var(--npp-shadow-md); }

/* Filter bar dạng label-trên-control (Khám phá/Tết) — biến thể của 8.8 */
.npp-filter-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.npp-filter-bar label { display: flex; flex-direction: column; gap: 3px;
    font-size: .78rem; font-weight: 600; color: var(--npp-text-2); }
.npp-filter-bar select, .npp-filter-bar input { padding: 8px 10px; border-radius: 10px;
    border: 1px solid var(--npp-border); background: var(--npp-surface);
    font-weight: 600; color: var(--npp-text); font-size: .9rem; }
```

Utility bổ sung: `.npp-mb-2/-3` (margin-bottom 8/16px), `.npp-w-full`.

### UX pattern đã chuẩn hoá thêm ở pkd

- **Bảng >10 dòng → phân trang** `paged()/pagedTable()` (pager ở trên) — chi
  tiết pagination.md. Bảng có input dùng pending-edits Map + badge "nháp"
  (`npp-badge-warning`).
- **Hygiene warning card**: dữ liệu bẩn (thiếu địa chỉ giao, territory generic)
  → card `border-left: 4px solid var(--npp-warning)` + nền vàng nhạt, **ẨN bảng
  sai** và hướng dẫn làm sạch — không bao giờ vẽ số liệu sai.
- **Banner lệch phiên bản** (đỏ `#b91c1c`, fixed top, z-index 99999) khi shell
  chạy bản cũ do cache — xem stale-shell-defense.md.
- Drill-down panel nền `--npp-surface-2` + nút ✕ đóng, `scrollIntoView` khi mở.

## 16. Checklist reskin — bổ sung sau reskin #2

- [ ] Rename **keyframes camelCase** + mọi `animation:` tham chiếu (sed prefix không bắt).
- [ ] Đổi **localStorage key mùa** (`<app>_season`) trong season-picker.
- [ ] Verify: `grep -c "<prefix_cũ>-"` = 0 **và** `grep -oE "<prefix_cũ>[A-Za-z]+"` rỗng.
- [ ] Đối chiếu class blueprint cần dùng có mặt trong shell.css (script for-loop grep).
- [ ] Đèn/badge ngữ nghĩa (pace, nợ, segment) dùng **semantic color**, không màu mùa.
- [ ] Component mới sinh ra trong app → **append vào file này** để portal sau kế thừa.

---

*Nguồn: NPP Portal `npp/public/npp/shell.css` (hệ gốc) + PKD Dashboard
`pkd/public/pkd/shell.css` (reskin #2, prefix `kd-`, thêm Mục 15). Đồng bộ file
này khi shell.css đổi token/thêm component để các portal sau kế thừa đúng phong cách.*
