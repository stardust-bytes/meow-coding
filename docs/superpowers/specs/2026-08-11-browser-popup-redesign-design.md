# Redesign popup Browser Bridge / Install Guide + viết hoa nút: Design Spec

Ngày: 2026-08-11 · Trạng thái: đã duyệt (mockup xem trong visual companion, user chốt "ok duyệt")

## 1. Mục tiêu

Hai popup liên quan browser (`BrowserDialog.tsx` — Browser Bridge, `InstallGuideDialog.tsx` — Install
Guide) đang có bố cục dồn hết vào 1 cột dọc, không phân nhóm rõ ràng, và nhãn nút toàn viết thường
("open install guide", "pair with code"...) trong khi phần lớn dialog khác trong app dùng Title Case
("Save", "Cancel"). Redesign 2 popup này cho gọn gàng, phân nhóm rõ, và sửa nhãn nút.

**Ngoài phạm vi:** `StatusBar.tsx` — label trạng thái mono ("browser: paired") không phải nút, giữ nguyên.
Không đụng tới `AddProjectDialog.tsx`/`AddAgentDialog.tsx` dù cũng đang viết thường — không thuộc scope
"popup browser".

## 2. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Độ rộng dialog | Modifier riêng cho 2 popup này, ~540px (thay vì 420px mặc định của `.dialog`) — không đổi width dialog khác |
| Bố cục | Chia theo section có nhãn uppercase nhỏ (tái dùng pattern `.label` sẵn có), phân cách bằng hairline border-top giữa các section |
| Header | Tên dialog + status pill cùng hàng (thay vì câu "Status: X" riêng dòng) |
| Nút "Pair With Code" | Co theo nội dung (không full-width), canh giữa trong section Pairing |
| Sau khi có mã pairing | Mã code + dòng "Expires..." xếp dọc, canh giữa (thay vì nằm ngang) |
| Nhãn nút | Title Case toàn bộ: "Open Install Guide", "Extension Folder", "Pair With Code", "New Pairing Code", "Close", "Open chrome://extensions" (giữ `chrome://extensions` viết thường vì là URL literal) |

## 3. Bố cục chi tiết theo trạng thái

### BrowserDialog — chưa pair, chưa có mã

```
┌─ Browser Bridge ──────────────────────── ● off ─┐
│ SETUP                                            │
│ Install the extension in Chrome, then pair it    │
│ with a one-time code.                            │
│ [Open Install Guide] [Extension Folder]          │
│ ─────────────────────────────────────────────── │
│ PAIRING                                          │
│              [Pair With Code]                    │
│ ─────────────────────────────────────────────── │
│                                          [Close]  │
└───────────────────────────────────────────────────┘
```

### BrowserDialog — đã có mã pairing

Section PAIRING thay bằng khối canh giữa theo cột:

```
│ PAIRING                                          │
│                  7F K2 Q9                        │
│              Expires 14:32:05                    │
```

### BrowserDialog — đã paired

```
┌─ Browser Bridge ──── ● paired (port 58732) ─────┐
│ CONNECTION                                       │
│ Extension is paired and ready.                   │
│ ─────────────────────────────────────────────── │
│                    [New Pairing Code]   [Close]  │
└───────────────────────────────────────────────────┘
```

### InstallGuideDialog

Giữ nguyên danh sách 4 bước (ordered list) + khối đường dẫn folder — chỉ đổi width (540px) và nhãn nút
sang Title Case. Không cần chia section thêm (nội dung đã tuyến tính, danh sách số thứ tự đã đủ rõ).

## 4. Thay đổi kỹ thuật

- `src/renderer/src/styles.css`:
  - Thêm modifier `.dialog.browser-dialog { width: 540px; }`, không đổi `.dialog` mặc định.
  - Thêm class cho section (`.browser-section`, `.browser-section-label` — tái dùng style của `.label`
    đã có) và pill trạng thái (`.browser-pill`, biến thể `.browser-pill-on`/`.browser-pill-off` màu theo
    `--green`/`--accent` giống pattern `sb-browser-on`/`sb-browser-off` ở StatusBar).
  - Cập nhật `.browser-pairing` để xếp cột + canh giữa (`flex-direction: column; align-items: center;`)
    thay vì hàng ngang hiện tại.
  - Nút primary trong section Pairing không còn full-width: bọc trong wrapper
    `.browser-pairing-cta { display: flex; justify-content: center; }`.
- `src/renderer/src/components/BrowserDialog.tsx`: áp class `browser-dialog` lên `.dialog`, tách JSX theo
  section như bố cục trên, đổi toàn bộ nhãn nút sang Title Case.
- `src/renderer/src/components/InstallGuideDialog.tsx`: áp class `browser-dialog`, đổi nhãn nút sang
  Title Case, không đổi cấu trúc nội dung.

## 5. Testing

Không có logic mới (thuần UI/CSS), không cần unit test. Verify bằng cách chạy dev app
(`npm run dev`), mở Browser Bridge dialog ở cả 3 trạng thái (chưa pair / đang có mã / đã paired) và
Install Guide dialog, so khớp với mockup đã duyệt.
