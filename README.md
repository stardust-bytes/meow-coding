# Meow Coding

Desktop app quản lý nhiều CLI coding agent (opencode, Claude Code, aider, ...) trong các
pane terminal song song trên một cửa sổ.

## Yêu cầu

- Node.js 20+
- Git
- Các CLI agent bạn muốn chạy đã có trong `PATH` (VD: `opencode`, `claude`)

## Chạy dev

```bash
npm install
npx @electron/rebuild -f -w @lydell/node-pty
npm run dev
```

## Cách dùng

1. `+ project` → chọn folder project (có git) → mở workspace.
2. `+ agent` → chọn template (hoặc thêm template riêng trong `templates`) → agent spawn trong pane.
3. Gõ trực tiếp vào pane để tương tác; dùng `stop` / `restart` / `inject` / `log` / `zoom` trên header pane.
4. Badge mỗi pane hiển thị trạng thái + branch git + số file dirty.

## Kiểm thử

```bash
npm test          # unit + integration (Vitest)
npm run typecheck
npm run build && npm run e2e   # Playwright smoke
```

## Lưu ý

- Đóng app sẽ kill toàn bộ agent (kể cả process con).
- Log mỗi agent nằm trong thư mục `userData/logs/`.
- Workspace + template lưu trong `userData/*.json`.
