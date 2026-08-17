# Meow Coding — Studio Dark: Slate Panel — Design

Ngày: 2026-08-17 · Trạng thái: đã duyệt với user (2026-08-17) · Bước: sau brainstorm

## 1. Mục tiêu

Tinh chỉnh design system **Studio Dark** hiện có (coral accent, đã tokenized) thay vì thay mới:
- Bỏ mô-típ "đen tuyền + neon" — thêm chiều sâu bằng **cool-slate (xanh đen)** giữa các layer.
- Giữ **coral** làm nhận diện, chỉ ấm hơn một chút (`#ff7a7a` → `#ff8a66`) cho khác biệt với "AI pink".
- Dồn toàn bộ "táo bạo" vào **state edge của pane** (signature element); phần còn lại yên tĩnh, mật độ cao.
- Lấp lỗ hổng: terminal (xterm) đang dùng màu mặc định, chưa khớp palette nào.

**Thesis:** Một cái nhìn là biết "khoang lái" đang ở trạng thái nào — agent nào chạy/idle/lỗi, pane nào
active, git thế nào — đọc trong 1 giây, không cần đọc chữ.

## 2. Quyết định đã chốt với user

- **Hướng**: giữ skeleton layout (title bar 34px · sidebar 268px · pane grid · status bar 26px), không
  restructure. Chat/trace vẫn là tab bên trong pane.
- **Màu**: neutrals → cool-slate cast; coral `#ff8a66`; status green/amber/red giữ ngữ nghĩa.
- **Type**: giữ nguyên 3 font đã ship (Bricolage Grotesque display · Instrument Sans UI · JetBrains Mono),
  phân vai gắt: mono cho MỌI dữ liệu, display chỉ brand + panel title.
- **Signature element**: State Edge trên pane (lựa chọn A). Quy tắc ưu tiên màu:
  `error > active (coral) > running (green) > idle (amber) > spawning (coral-pulse) > stopped/exited (xám)`.
- **Cấu trúc tối thiểu** (3 mục, rủi ro thấp):
  1. `Pane.tsx`: thêm class `status-${state.status}` và `active` vào root `.pane` (1 dòng) để CSS
     state edge hoạt động.
  2. `XtermHost.tsx`: thêm theme màu xterm khớp palette (hiện đang dùng màu default).
  3. `styles.css`: micro-tokens layout + restyle pane/header/status theo state edge.

## 3. Design tokens

### Color — layered cool-slate + coral

```
--bg             #0b0e13   nền app (xanh đen, không đen tuyền)
--bg-panel       #10141b   panel / surface 1
--bg-raised      #161b24   surface 2 (card, dropdown, header active)
--bg-hover       #1b212c
--bg-active      #242b38   row đang chọn
--bg-tab-inactive #0e1218
--bg-input       #1a1f29   hover #232a37
--bg-code        #090c11   sâu hơn app 1 bậc → pane có "hốc"
--bg-chat        #090c11
--bg-bubble      #141922
--bg-bubble-user #1d2330
--status-bg      #0e1218

--text        #cdd3de
--text-strong #eef1f6
--text-dim    #8b93a3
--text-faint  #565e6e

--accent        #ff8a66   cam-coral (từ #ff7a7a)
--accent-strong #ffa88c
--accent-dim    rgba(255,138,102,0.12)
--accent-border rgba(255,138,102,0.32)
--focus-ring    rgba(255,138,102,0.38)

--blue   #6cb6ff
--green  #4ade9f   running / success
--yellow #ffb454   idle / warn
--red    #ff5f56   error (ấm hơn #ff4d4f, hợp coral)

--hairline rgba(186,202,230,0.08)   nhạt xanh (từ trắng thuần)
--shadow-1/2/3 pha xanh rgba(4,6,12,…)
```

### Typography — giữ 3 font, phân vai gắt

| Font | Vai trò duy nhất |
|---|---|
| Instrument Sans | 100% UI: label, button, dialog, sidebar, chat |
| JetBrains Mono | MỌI dữ liệu: pane title, status, git branch, exit code, count, path, timestamp, tool-call, terminal (`tabular-nums`) |
| Bricolage Grotesque | Chỉ brand + panel-title uppercase |

Scale: thêm `--fs-xs 11px` (path, exit code, timestamp) · `--fs-sm 12px` · `--fs-base 14px` ·
`--fs-md 15px` · `--fs-lg 18px`. Line-height UI 1.4 · chat 1.5.

### Layout

- Giữ khung: title bar 34px, sidebar 268px, status bar 26px, radius 4/6/10, thang 4px.
- Pane grid: gap 6px → **8px** (ranh giới rõ khi nhiều terminal), padding 8px.
- Pane: border 1px hairline, **top edge 2px theo state** (state edge), active = raised header +
  **coral left edge** (inset 2px) + shadow đậm hơn.
- Hairline & scrollbar tint theo palette mới.

### Signature element — State Edge

- Mép trên mỗi pane 2px, màu theo trạng thái agent: spawning=coral-pulse, running=green,
  idle=amber, error=red, stopped/exited=xám.
- Active pane: coral **left** edge + raised header (không chồng lên top edge).
- Kênh đọc trạng thái (3 lớp): màu (edge) + icon (status-dot có sẵn) + text (mono readout có sẵn).
- Kèm **theme xterm** khớp palette (bg `#0b0e13`, fg `#cdd3de`, cursor coral, selection coral-dim,
  ANSI 16 màu theo palette).

## 4. Files đụng

| File | Thay đổi |
|---|---|
| `src/renderer/src/styles.css` | `:root` tokens (màu, thêm `--fs-xs`), pane grid gap, state edge CSS, status dot glow, hardcoded rgba còn sót |
| `src/renderer/src/components/Pane.tsx` | Thêm `status-${state.status}` + `active` vào class root `.pane` |
| `src/renderer/src/components/XtermHost.tsx` | Thêm `theme` object vào `new Terminal({...})` |

Không đổi IPC / contract / logic main / class name hiện có.

## 5. Không đổi

- Layout skeleton, cấu trúc component, class name.
- Status dot, mono readout, sidebar active row, background pills (chỉ đổi màu qua token).
- UI label tiếng Anh, spacing thang 4px (trừ gap grid 6→8px như đã chốt).

## 6. Kiểm thử

- `npm run typecheck` PASS.
- `npm test` PASS.
- Manual (dev mode): sidebar, pane grid (active/inactive/backgrounded), chat, tool-call card,
  settings dialog, status bar, zoom, terminal màu khớp.

## 7. Out of scope

- Light mode (chỉ token block tham khảo, không triển khai).
- Restructure layout, đổi font, animation mới.
