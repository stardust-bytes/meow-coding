# Katalon Studio MCP + Skill integration (Meow Coding native agent)

Date: 2026-08-21
Status: Approved by user (2026-08-21)

## Goal

Cho phép native Meow agent trong Meow Coding tự động viết và chạy test script trên
Katalon Studio local (Web UI, API, Mobile) thông qua:

1. **Katalon Studio MCP server** — server MCP mà Katalon Studio ≥ 11.1.0 tự host
   (mặc định port `33699`, không auth, tất cả tools bật khi GUI mở; hoặc host qua CLI
   standalone khi đóng GUI).
2. **Skill `katalon-studio`** — skill markdown (định dạng skill chuẩn của Meow:
   frontmatter `name` + `description`) hướng dẫn agent cách thao tác đúng trên
   Katalon Studio.

## Bối cảnh đã xác minh

- Meow Coding đã có sẵn hạ tầng: `McpManager` (`src/main/agent/mcp/manager.ts`) hỗ trợ
  MCP server dạng stdio command hoặc HTTP URL; Settings UI (McpTab) để thêm server;
  `syncTools()` trong `src/main/meow-agent-manager.ts` kết nối mọi server trong
  `mcp` section của `userData/meow.json` và expose tools cho agent loop.
- Skill loader (`src/main/agent/skill.ts`) nạp skill markdown từ:
  `<cwd>/.meow/skills/`, `userData/skills/` (global), và `resources/skills/` (builtin).
- Katalon Studio MCP (local): tự host tại `localhost:33699`, mỗi server gắn với **một
  project Katalon**; muốn đổi project phải khởi động lại server. Có nút **Copy** trong
  Preferences để lấy JSON cấu hình chính xác.
- Bộ 18 skill chính thức `katalon-labs/true-skills` nhắm vào **True Platform MCP
  (cloud)** — không dùng trực tiếp được với MCP Studio local → cần skill riêng.

## Quyết định (đã được user duyệt)

- Dùng **Katalon Studio MCP local** (không dùng True Platform cloud).
- Agent đích: **native Meow agent**.
- Viết **skill `katalon-studio` mới** cho Meow, đặt tại **global**
  `userData/skills/katalon-studio/SKILL.md` (dùng được cho mọi project).
- Tùy chọn: thêm server **docs MCP** `https://mcp.katalon.com/mcp` (free, không auth)
  để agent tra cứu tài liệu Katalon chính xác khi cần.

## Thiết kế

### Phần 1 — Cấu hình MCP server

| Bước | Chi tiết |
|---|---|
| 1 | Mở Katalon Studio → Preferences → Katalon → AI Configuration → Katalon Studio MCP → đảm bảo status **Running** (port mặc định `33699`), bấm **Copy** lấy JSON cấu hình. |
| 2 | Meow Coding → Settings → MCP tab → thêm server tên `katalon-studio`, URL lấy từ JSON đã copy (dạng `http://localhost:33699/...`). |
| 3 | (Tùy chọn) Thêm server `katalon-docs` với URL `https://mcp.katalon.com/mcp`. |
| 4 | Save → `syncTools()` kết nối → MCP tools xuất hiện, trạng thái connected trong Settings. |

Ràng buộc:
- Studio GUI phải mở (hoặc MCP host qua CLI standalone) thì server mới chạy.
- Server gắn với 1 project Katalon duy nhất.

### Phần 2 — Skill `katalon-studio`

File: `userData/skills/katalon-studio/SKILL.md` (có thể copy sang `.meow/skills/`
của từng project nếu muốn travel cùng project).

Nội dung:
- Frontmatter: `name: katalon-studio`, `description` mô tả khi nào dùng
  (viết/chạy/sửa test script Katalon, phân tích kết quả test).
- Cách dùng MCP tools: agent liệt kê tools trước khi gọi (`list tools`), đọc kết
  quả/error, xử lý lỗi "server not connected" (nhắc mở Studio).
- Quy ước Katalon Studio:
  - Test Case (script Groovy + keywords), Test Suite, Object Repository,
    Test Data (CSV/Excel), custom Keywords, Profiles, Run config
    (Chrome/Firefox/Edge), report.
  - API testing: Request/Response object, JSON path assertion.
  - Mobile: device profile, Appium capabilities.
- Workflow chuẩn: phân tích yêu cầu → thiết kế test case → tạo/sửa → chạy →
  đọc log/report → sửa lỗi → re-run → báo cáo.
- Best practices: đặt tên chuẩn, dùng Object Repository thay vì hard-code selector,
  data-driven test, tránh duplicated case, sử dụng waits hợp lý.
- Boundaries: server gắn 1 project; không tự tạo requirement; Studio phải mở.

### Phần 3 — Kiểm thử tích hợp

1. `npm run typecheck` + `npm test` (đảm bảo không phá vỡ repo).
2. Test thực tế với Studio đang mở:
   - Hỏi agent liệt kê tools Katalon → xác nhận MCP connected.
   - Tạo 1 test case mẫu (đăng nhập) → chạy → phân tích kết quả.
   - Sửa lỗi (nếu có) → re-run → báo cáo.

## Ngoài scope

- Không sửa code nguồn Meow Coding (chỉ dùng hạ tầng có sẵn).
- Không tích hợp True Platform / TestOps cloud.
- Không cài đặt/thay đổi Katalon Studio bên trong repo này.

## Các file liên quan

- `src/main/agent/mcp/manager.ts` — hạ tầng MCP hiện có (không sửa).
- `src/main/agent/skill.ts` — skill loader (không sửa).
- `src/renderer/src/components/settings/McpTab.tsx` — UI cấu hình MCP (không sửa).
- `userData/skills/katalon-studio/SKILL.md` — skill mới (tạo mới, ngoài repo).
