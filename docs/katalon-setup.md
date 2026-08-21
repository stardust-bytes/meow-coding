# Setup Katalon Studio automation with Meow Coding

Hướng dẫn dành cho **người dùng mới** muốn dùng native Meow agent để viết và chạy
test script tự động trên Katalon Studio (Web UI, API, Mobile) qua MCP.

## Yêu cầu tối thiểu

| Thứ | Điều kiện |
|---|---|
| Meow Coding | Đã cài đặt, cấu hình **LLM provider + API key** (Settings → Providers) |
| Katalon Studio | **≥ 11.1.0** (bản có MCP server; bản Free license là đủ) |
| Project Katalon | Một project thật (Test Cases, Object Repository, ...) |

## Các bước cài đặt

### 1. Cài & mở Katalon Studio

Cài Katalon Studio ≥ 11.1.0, mở project cần làm test. Giữ cửa sổ Studio mở trong
khi dùng Meow agent (hoặc host MCP standalone qua CLI nếu muốn đóng GUI).

### 2. Bật MCP server trong Katalon Studio

1. **Preferences → Katalon → AI Configuration → Katalon Studio MCP**.
2. Đảm bảo status **Running** (mặc định port `33699`, không auth, tất cả tools bật).
3. Bấm **Copy** để lấy JSON cấu hình kết nối (dạng
   `{"url": "http://localhost:33699/..."}`) — đây là nguồn chính xác duy nhất,
   path endpoint có thể khác giữa các phiên bản.

### 3. Thêm MCP server vào Meow Coding

1. Meow Coding → **Settings → MCP tab**.
2. Thêm server:
   - Tên: `katalon-studio`
   - URL: giá trị từ nút **Copy** ở bước 2 (mặc định `http://localhost:33699/mcp`)
3. (Khuyến nghị) Thêm server `katalon-docs` với URL `https://mcp.katalon.com/mcp`
   để agent tra cứu tài liệu Katalon khi cần.
4. **Save**. Vào lại Settings → MCP tab: `katalon-studio` phải hiện **connected**
   và danh sách tools hiện ra.

> Không cần cài skill thủ công — `katalon-studio` đã là builtin skill của app,
> agent tự biết dùng khi bạn nhắc tới Katalon.

### 4. Chạy thử

Hỏi agent (native Meow agent):

- "Liệt kê các tools Katalon có sẵn" — xác nhận MCP connected.
- "Tạo test case đăng nhập cho project Katalon và chạy thử" — kiểm tra luồng
  tạo → chạy → phân tích kết quả.

## Lưu ý quan trọng

- **MCP server gắn với 1 project Katalon duy nhất.** Đổi project → khởi động lại
  server (mở lại Studio hoặc chạy lại CLI standalone).
- Studio phải mở (hoặc MCP host standalone) thì agent mới gọi được tools; nếu tool
  trả về "Not connected", mở Studio và kiểm tra status MCP server.
- Không paste mật khẩu/API token vào chat; dùng Profiles + GlobalVariable trong
  Katalon.

## Tài liệu tham khảo

- Katalon Docs: *Connect to Katalon Studio MCP Server* (Studio ≥ 11.1.0)
  — docs.katalon.com → Katalon Studio → StudioAssist → MCP Servers.
- Spec thiết kế: `docs/superpowers/specs/2026-08-21-katalon-mcp-skill-design.md`.
