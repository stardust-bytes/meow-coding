# Chat Bubble — Slash Command Highlight — Design

Ngày: 2026-08-19 · Trạng thái: chờ duyệt · Bước: sau brainstorm (đã chốt với user)

## 1. Mục tiêu

Highlight lệnh slash (`/init`, `/review`, ...) trên bubble chat của tin nhắn **user** bằng màu
accent — tương tự cách `@mention` được highlight hiện tại. Chỉ thay đổi visual, không đổi logic
gửi/dispatch command hay IPC contract.

## 2. Hiện trạng

- `ChatPanel.tsx` — `MentionText` tách user text bằng `MENTION_SPLIT_RE = /(@[\w./\\-]+)/g`, bọc
  `@path` trong `<span className="chat-mention">` (CSS: `color: var(--accent)`, font mono).
- `styles.css` — `.chat-mention { color: var(--accent); font-family: var(--font-mono); font-size: 0.92em; }`.
- User bubble hiển thị raw text (kể cả `/command`) qua `MentionText` (chỉ dùng cho role `user`;
  assistant dùng `MarkdownText`).

## 3. Thiết kế

### ChatPanel.tsx

- Thêm module-level: `SLASH_RE = /^(\/[\w-]+)/` — bắt token slash ở đầu tin nhắn.
- `MentionText` nhận thêm prop `commands: Command[]`; nếu leading token khớp
  `commands.some(c => c.name === token.slice(1))` (case-sensitive, đồng bộ logic dispatch hiện tại)
  → bọc `<span className="chat-slash">{token}</span>`, phần còn lại split `@mention` như cũ.
- `FeedMessage` nhận thêm prop `commands`; render site truyền `commands={commands}` từ state
  (state ổn định — chỉ load trong effect `[agentId, cwd]` — nên không phá `React.memo`).

### styles.css

```css
.chat-slash { color: var(--accent); font-family: var(--font-mono); font-size: 0.92em; }
```

### Giữ nguyên

- Không đụng main process (`meow-agent-manager.ts`, `commands.ts`), preload, IPC contract.
- Không đổi `MENTION_SPLIT_RE` / `.chat-mention`.
- Không highlight slash trên bubble assistant (chỉ user).

## 4. Edge cases

- `/new` (system command) — vẫn highlight (có trong danh sách command).
- `/hello` không phải command thật — **không** highlight (chỉ khi khớp `commands`).
- Text bắt đầu bằng slash nhưng là path (`/home/...`) — không khớp command → không highlight.
- Command tên có hyphen (`/dispatching-parallel-agents`) — khớp `[\w-]+`.

## 5. Kiểm thử

- `npm run typecheck`
- `npm test` (unit + integration)
- (Không ảnh hưởng e2e; bỏ qua `npm run e2e`.)
