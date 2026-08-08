# Meow Coding — Landing page cho GitHub Pages (docs/index.html) — Design

Ngày: 2026-08-08 · Trạng thái: chờ duyệt · Bước: sau brainstorm (đã chốt thiết kế với user)

## 1. Mục tiêu

Tạo 1 trang landing page giới thiệu repo Meow Coding, đặt tại `docs/index.html`, để cài đặt GitHub
Pages (chế độ "Deploy from branch → folder `/docs`"). Trang nhắm tới người xem GitHub repo / landing
công khai.

## 2. Quyết định chính (đã chốt với user qua brainstorm)

| Câu hỏi | Quyết định |
|---|---|
| Ngôn ngữ | Tiếng Anh (README cũng tiếng Anh, hướng tới cộng đồng quốc tế) |
| Phong cách | **Dark + glassmorphism** — nền tối, thẻ glass (blur + border mờ), glow gradient |
| Nội dung | Hero + tagline · Screenshot app · Key features · Sources/credits · Footer + links |
| Cách làm | **Tailwind Play CDN** (`cdn.tailwindcss.com`) + Google Fonts + CSS tùy chỉnh + JS nhỏ |
| GitHub Pages | **Chỉ tạo file**, không thêm workflow; user tự bật Pages trong Settings |

## 3. Phạm vi

### File tạo mới
- `docs/index.html` — toàn bộ trang (HTML + CSS inline + JS inline).
- `docs/meow-app-screen.png` — **copy** từ `media/meow-app-screen.png`.

> **Bắt buộc:** GitHub Pages chế độ `/docs` chỉ serve nội dung trong `docs/`. Nếu ảnh nằm ở
> `media/`, sẽ 404. Vì vậy phải copy screenshot vào `docs/` để trang self-contained.

### Không làm
- Không thêm workflow Pages (user tự bật trong Settings).
- Không đụng tới `src/`, package.json, build pipeline.
- Không dùng framework build (Vite/11ty) — 1 file tĩnh là đủ.

## 4. Kiến trúc trang

### 4a. Kỹ thuật
- **Tailwind Play CDN** (`<script src="https://cdn.tailwindcss.com"></script>`) với `tailwind.config`
  inline (theme: font, màu accent).
- **Google Fonts**: Inter (UI) + JetBrains Mono (code/terminal accent).
- **CSS tùy chỉnh** (~50 dòng): `.glass` (backdrop-filter blur + semi-transparent bg + border),
  gradient glow nền, animation reveal-on-scroll, gradient text.
- **JS nhỏ** (~30 dòng): smooth scroll cho anchor links, `IntersectionObserver` reveal, năm hiện tại
  ở footer, hiệu ứng glow nhẹ (mousemove optional — giữ đơn giản).
- **Đường dẫn tương đối** (`./meow-app-screen.png`, `#features`...) — hoạt động dưới subpath
  `https://stardust-bytes.github.io/meow-coding/`.

### 4b. Bố cục

1. **Navbar** — glass, sticky top. Trái: logo 🐱 + "Meow Coding". Phải: links `Features`, `Sources`,
   nút **View on GitHub** (trỏ `https://github.com/stardust-bytes/meow-coding`).
2. **Hero** — badge `v0.16.0 · Open source`; H1 *"Run multiple coding agents, side by side."*; tagline
   1–2 câu (tóm tắt từ README: chạy opencode / Claude Code / aider / bất kỳ CLI agent nào trong các
   pane song song, kèm native Meow agent); 2 CTA: **View on GitHub** + **Releases** (link repo
   `/releases`); dòng chip tech stack: `Electron · React · TypeScript · PTY · xterm.js`; nền gradient
   glow (tím/amber) mờ phía sau.
3. **App screenshot** — `docs/meow-app-screen.png` trong khung glass bo góc lớn + glow border, có
   caption ngắn.
4. **Key features** — grid 3 cột × 6 card glass (responsive 1→2→3 cột):
   - **Multi-agent panes** — spawn nhiều CLI agent, stop/restart/inject/zoom per pane, kill cả cây
     process khi thoát.
   - **Native Meow agent** — chat UI, streaming, markdown, tool-call cards, image attachment,
     undo/redo.
   - **Slash commands & skills** — `/init`, `/review`, `/new`, `/frontend-design`, `/sp-*`, custom
     command với `$1..$N`, `@path`, `!cmd`.
   - **Sessions** — create/switch/rename/delete, auto-title, undo/redo qua file snapshots.
   - **MCP & LSP** — stdio/HTTP MCP servers; diagnostics từ language server.
   - **Cost tracking** — token & chi phí theo session/model qua models.dev catalog.
   - Strip nhỏ bên dưới: "Also includes: Office documents (.docx/.xlsx/.pptx) · ChatGPT Web provider
     (experimental)".
5. **Sources / credits** — danh sách dự án nguồn (mỗi mục: tên + mô tả ngắn + link):
   - Superpowers (workflow skills)
   - anthropics/skills (front-end & design skills)
   - iOfficeAI/OfficeCLI (office tool)
   - @lydell/node-pty & xterm.js (PTY & terminal)
   - Electron / electron-vite / React / TypeScript (shell & UI)
6. **Footer** — link repo, ghi chú open-source, "Built with ❤️" + năm động.

### 4c. Màu sắc & typography
- Nền: `#0b0d12` (gần đen xanh), gradient glow mờ (violet `#7c3aed`, amber `#f59e0b` — tông
  cat/meow).
- Text: trắng/xám (slate), accent gradient text cho từ khóa.
- Font: Inter (body/heading), JetBrains Mono (badge/chip/code).

## 5. Tiêu chí thành công

- `docs/index.html` + `docs/meow-app-screen.png` mở được trong trình duyệt, không lỗi console.
- Ảnh screenshot hiển thị (đường dẫn tương đối đúng).
- Responsive: mobile (1 cột) → desktop (3 cột features).
- Không phụ thuộc file ngoài `docs/`; chỉ phụ thuộc CDN (Tailwind, Google Fonts) — chấp nhận được.
- Nội dung tiếng Anh, khớp thông tin trong README.

## 6. Xử lý rủi ro

- **Tailwind CDN down / offline**: trang vẫn hiển thị nội dung (fallback CSS tối thiểu: nền tối,
  text đọc được) — chấp nhận, không over-engineer.
- **Google Fonts chặn**: font fallback system-ui/sans-serif/monospace.
- **Pages cache**: nếu user đổi file mà chưa thấy, force refresh / chờ vài phút — không nằm phạm vi.
