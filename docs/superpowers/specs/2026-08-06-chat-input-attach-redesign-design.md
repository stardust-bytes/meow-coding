# Chat Input + Attach — ChatGPT-style Composer — Design

Ngày: 2026-08-06 · Trạng thái: chờ duyệt · Bước: sau brainstorm (đã chốt thiết kế với user)

## 1. Mục tiêu

Gom chat input + nút attach file thành **một cụm container** giống ChatGPT trong pane chat của
Meow Coding. Chỉ đổi UI (`ChatInput.tsx` + `styles.css`), **giữ nguyên** toàn bộ logic/backend:
`accept="image/*"`, `MAX_IMAGES=4`, giới hạn 5MB, luồng ảnh → vision model, @-mention.

## 2. Hiện trạng

`.chat-input` là **flex-hàng**: textarea + nút attach `+` (icon-only) + nút Send/Stop nằm ngang.
Image chips nằm dưới textarea. Textarea có `border-left` màu theo mode (build=xanh / plan=cam).

## 3. Thiết kế mới

```
┌────────────────────────────┐  ← .chat-input container
│ [🖼 ảnh1] [🖼 ảnh2]          │  ← image chips (chỉ khi có ảnh)
│ [@src/a.ts]                 │  ← mention chips (chỉ khi có @)
│ ┌────────────────────────┐  │
│ │ textarea (full width)   │  │
│ └────────────────────────┘  │
│ 📎 Upload file    [Stop]    │  ← toolbar: attach trái / stop phải (khi running)
└────────────────────────────┘
```

### Quyết định đã chốt (theo user)

| Điểm | Quyết định |
|---|---|
| Container | Cụm vuông, **KHÔNG border-radius**, viền `1px solid var(--hairline)`, nền `var(--bg-panel)`; focus đổi viền `var(--accent)` |
| Textarea | Bỏ `border-left` màu mode; không border riêng; Enter gửi / Shift+Enter xuống dòng |
| Image chips | Dời lên **trên textarea**, trong container (ChatGPT style) |
| Mention chips | Kèm cùng khu vực chips trên textarea |
| Nút attach | Icon paperclip (SVG) + label **"Upload file"**, góc trái toolbar dưới |
| Nút Send | **Bỏ hẳn** — gửi bằng Enter |
| Nút Stop | Chỉ hiện khi `running`, góc phải toolbar dưới, màu đỏ |
| Dropdown menu | Giữ logic command/file menu; chỉnh `position: absolute` cho khớp container mới (hiện trên container) |

### Giữ nguyên

- `accept="image/*"` + file input hidden + `FileReader` dataURL
- `MAX_IMAGES = 4`, `MAX_IMAGE_SIZE = 5MB`
- `MENTION_RE`, debounce 150ms, `suggestFiles` IPC, chips `@path` xóa được
- `onSubmit(text, images)` contract — không đổi IPC/shared types

## 4. File đụng

- `src/renderer/src/components/chat/ChatInput.tsx` — restructure JSX (container, toolbar, chips trên)
- `src/renderer/src/styles.css` — CSS mới cho `.chat-input` container, `.chat-input-toolbar`, `.chat-input-attach` (icon+label), bỏ style cũ `.chat-input-attach` (chỉ `+`)

## 5. Kiểm thử

- `npm run typecheck` — PASS
- `npm test` — PASS
- `npm run build && npm run e2e` — PASS. **E2E phải update**: `tests/e2e/context-footer.spec.ts` (2 chỗ) + `tests/e2e/smoke.spec.ts` (1 chỗ) đang `.chat-input-send`.click() → thay bằng `.chat-input-field`.fill() + `keyboard.press('Enter')`
- Manual: paste ảnh → chip trên textarea; Enter gửi; running → Stop hiện

## 6. Out of scope

- Mở rộng sang file không phải ảnh
- Thay đổi backend/IPC/ảnh hưởng model
