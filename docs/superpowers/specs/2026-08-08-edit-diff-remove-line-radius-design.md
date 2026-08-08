# Meow Coding — Remove border-radius on edit diff lines : Design Spec

Ngày: 2026-08-08 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Trong tin nhắn tool-call loại `edit` của LLM agent, mỗi dòng diff (các dòng `+`/`-` trong
`DiffView`) đang hiển thị với border radius riêng cho từng dòng — mỗi dòng là một hộp bo góc 6px.
Yêu cầu: loại bỏ border radius trên từng dòng để các dòng xếp thành khối nền vuông liên tục.

## 2. Nguyên nhân gốc

`src/renderer/src/styles.css` dòng 64 có rule global:

```css
* { box-sizing: border-box; border-radius: var(--radius); }
```

Rule này áp `border-radius: 6px` cho **mọi** element, bao gồm từng `.diff-line` trong
`DiffView.tsx` (component hiển thị diff cho tool `edit`). Kết quả: mỗi dòng `+`/`-` có nền
màu (đỏ/xanh) riêng với 4 góc bo 6px.

## 3. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Phạm vi | Chỉ các dòng diff trong view `edit` (`.diff-line`). Giữ nguyên border radius của container card tool call xung quanh. Không đổi gì với block `apply-patch`. |
| Cách sửa | Thêm `border-radius: 0` vào rule `.diff-line` hiện có trong `styles.css`. |
| Thay đổi code khác | Không — không sửa TypeScript/component nào, không thay đổi rule global `*`. |

## 4. Thay đổi cụ thể

`src/renderer/src/styles.css`, rule `.diff-line` (dòng 853):

```css
.diff-line { display: flex; gap: 6px; padding: 0 10px; white-space: pre-wrap; word-break: break-word; border-radius: 0; }
```

## 5. Phương án cân nhắc

- **Bỏ `border-radius` khỏi selector `*` toàn cục**: rủi ro cao — nhiều component phụ thuộc rule này;
  cần rà từng nơi. Không chọn.
- **Chỉ bo góc dòng đầu/cuối block**: phức tạp hơn, đi ngược yêu cầu "loại bỏ". Không chọn.

## 6. Kiểm thử

- `npm run typecheck` pass.
- `npm test` pass.
- Kiểm tra thủ công bằng mắt: view diff của tool `edit` — các dòng nền vuông, không còn góc bo.

## 7. Tiêu chí thành công

- Mỗi dòng `+`/`-` trong `DiffView` không còn border radius; các dòng liền nhau tạo khối nền liên
  tục.
- Container `.tool-call` xung quanh vẫn giữ radius như cũ.
- Không thay đổi hành vi/visual của bất kỳ phần UI nào khác.
