# Meow Coding — Studio Dark: Instrument Panel — Design

Ngày: 2026-08-07 · Trạng thái: chờ duyệt · Bước: sau brainstorm (đã chốt hướng với user)

## 1. Mục tiêu

Redesign toàn app từ theme "VS Code Dark+ clone" (flat `#1e1e1e`, mono-only, `radius: 0`, không cá
tính) sang **Studio Dark — Instrument Panel**: bảng điều khiển tối màu hiện đại, chuyên nghiệp, có
điểm nhấn mạnh, phù hợp tool dev quản lý agent/terminal.

## 2. Quyết định đã chốt với user

- **Hướng thẩm mỹ**: Studio Dark — Instrument Panel (near-black pha xanh lạnh, 1 accent acid-lime,
  font display đặc trưng + mono cho dữ liệu/terminal, grain nhẹ, layered depth).
- **Phạm vi**: toàn app (tokens, base, title bar, sidebar, panes, status bar, chat, settings, dialogs).
- **Font**: cho phép bundle font mới qua `@fontsource` (không thêm dependency khác).

## 3. Design tokens

### Typography (3 family — display + UI + mono)

| Token | Giá trị | Dùng |
|---|---|---|
| `--font-display` | `Bricolage Grotesque` (variable) | Tiêu đề, panel title, brand, số lớn |
| `--font-ui` | `Instrument Sans` (variable) | Body, button, input, mọi UI text |
| `--font-mono` | `JetBrains Mono` (giữ nguyên) | Terminal, số liệu, code, keys |

Bundle: `@fontsource-variable/instrument-sans`, `@fontsource-variable/bricolage-grotesque` — variable
font giữ bundle nhỏ, cấp nhiều weight.

### Color (near-black green-cast + acid lime accent)

```
--bg             #0c0f0d    nền app (gần đen, pha lục)
--bg-panel       #111512    panel / surface 1
--bg-raised      #161b17    surface cao hơn (card, composer)
--bg-hover       #1a201b
--bg-active      #222a24
--bg-input       #1a211c
--bg-input-hover #232c25
--bg-code        #0a0d0b
--bg-chat        #0a0c0b
--bg-bubble      #141815
--bg-bubble-user #1c231e

--text        #d6ddd6
--text-strong #f2f6f1
--text-dim    #93a098
--text-faint  #5a6a60

--accent      #bdf25b   acid lime — accent chủ đạo
--accent-strong #cdff70
--accent-dim  rgba(189,242,91,0.12)
--focus-ring  rgba(189,242,91,0.35)

--blue   #6cb6ff   info / session / link
--green  #4ce3a1   running / success
--yellow #ffb454   warn / todo / attention
--orange #ffb454
--red    #ff5c63   error / danger

--status-bg #121713  status bar (bỏ xanh VS Code #007acc)

--hairline rgba(210,240,220,0.08)
--radius-sm 4px · --radius 6px · --radius-lg 10px
```

### Motion & atmosphere

- **Load**: staggered fade+rise cho title bar → sidebar → pane grid → status bar (CSS `animation-delay`,
  `prefers-reduced-motion` tắt).
- **Grain/noise**: overlay `body::before` feTurbulence SVG data-URI, opacity thấp.
- **Vignette**: radial gradient nhẹ phía trên.
- Hover: button/row có accent glow nhẹ; focus ring accent.

## 4. Files đụng

| File | Thay đổi |
|---|---|
| `package.json` | Thêm `@fontsource-variable/instrument-sans`, `@fontsource-variable/bricolage-grotesque` |
| `src/renderer/src/main.tsx` | Import font CSS |
| `src/renderer/src/styles.css` | Rewrite toàn bộ design system (giữ nguyên class name → không vỡ component) |
| `src/renderer/src/components/XtermHost.tsx` | Đổi theme màu terminal cho khớp palette |

Không đổi JSX component (trừ khi cần thêm class); giữ nguyên cấu trúc class để rủi ro thấp.

## 5. Không đổi

- IPC / contract / logic main / renderer logic.
- Class name hiện có (chỉ đổi style).
- Các quy ước: UI label tiếng Anh, spacing thang 4px.

## 6. Kiểm thử

- `npm run typecheck` PASS.
- `npm test` PASS.
- `npm run build && npm run e2e` PASS (e2e không phụ thuộc màu/class).
- Manual: dev mode xem toàn bộ màn hình (sidebar, panes, chat, composer, todos, settings, dialogs,
  prompt, command menu, model picker).

## 7. Out of scope

- Đổi layout/logic component (chỉ restyle).
- Sáng theme / auto theme.
