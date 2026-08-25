# Codex OAuth — Provider-Synced Model Effort: Design Spec

Ngày: 2026-08-08 · Trạng thái: đã duyệt

## 1. Mục tiêu

Cho phép người dùng chọn reasoning effort (variant) khi dùng model qua tài khoản Codex OAuth. Danh sách
lựa chọn phải được đồng bộ độc quyền từ model registry của CLIProxyAPI — sidecar đang phục vụ tài khoản
Codex OAuth — thay vì catalog `models.dev` hoặc một preset hardcode trong Meow.

Một model không có metadata effort trong registry sẽ không hiển thị picker. Meow không đoán hoặc fallback
sang danh sách effort chung.

## 2. Bối cảnh hiện tại

- Tích hợp Codex OAuth sử dụng `CodexProxyManager` để chạy CLIProxyAPI theo account và cấp endpoint
  OpenAI-compatible cục bộ cho native agent.
- Model variant chung của Meow đã là dữ liệu theo model, renderer hiển thị picker động và ẩn nó khi danh
  sách variant rỗng.
- `LlmClient.stream()` nhận `variantOptions`; nhánh OpenAI-compatible có thể chuyển options đó sang
  request cho proxy.
- Registry CLIProxyAPI là nguồn sự thật phù hợp cho Codex OAuth: tên model cũng như capability/effort có
  thể thay đổi theo phiên bản sidecar.

## 3. Quyết định thiết kế

| Chủ đề | Quyết định |
|---|---|
| Nguồn effort | CLIProxyAPI model registry duy nhất |
| Nơi đọc/chuẩn hoá | Main process, cạnh lifecycle của Codex proxy |
| Dữ liệu UI | Catalog/IPC hiện có, model Codex mang `variants: string[]` |
| Model không có effort | Ẩn picker hoàn toàn |
| Variant stale khi đổi model/account | Reset về `undefined` (Default) |
| Wire format | OpenAI-compatible `reasoningEffort` được forward tới account-scoped Codex proxy |
| Fallback | Không fallback sang models.dev hay preset hardcode |

## 4. Luồng dữ liệu

1. Khi Codex proxy/registry sẵn sàng, main process đọc model registry của CLIProxyAPI.
2. Một adapter thuần chuẩn hoá metadata registry thành catalog model công khai tối thiểu, gồm ID, label và
   `variants` effort được registry tuyên bố.
3. Main publish catalog này qua IPC contract hiện có; preload chỉ bridge typed API và renderer chỉ tiêu thụ
   dữ liệu đã chuẩn hoá.
4. Khi người dùng chọn account Codex OAuth, danh sách model lấy từ catalog account-scoped đó. Picker lấy
   trực tiếp `selectedModel.variants`.
5. Khi user gửi chat, manager resolve model + selected variant. Nếu variant thuộc danh sách registry của
   model thì tạo OpenAI-compatible provider option `reasoningEffort`; nếu không thuộc thì bỏ option.
6. LLM client forward provider option tới local Codex proxy. Không chọn variant nghĩa là không gửi trường
   reasoning effort, để CLIProxyAPI/provider dùng default.

## 5. Hành vi UI và state

- Không thêm UI control riêng: tái sử dụng picker variant hiện có.
- Chỉ render picker nếu Codex model hiện tại có ít nhất một effort trong registry.
- Picker render nguyên thứ tự/value registry cung cấp; label có thể title-case để nhất quán UI nhưng value
  wire giữ nguyên.
- Khi đổi account hoặc model, nếu state variant không thuộc `variants` mới, renderer reset state và request
  tiếp theo không có reasoning option.
- Nếu registry chưa sẵn sàng hoặc không đọc được, Codex catalog không tuyên bố variants; picker bị ẩn. Lỗi
  registry không ngăn kết nối OAuth hoặc chat cơ bản nếu proxy vẫn phục vụ model.

## 6. Phạm vi và phi phạm vi

**Bao gồm**

- Parse/normalize effort capabilities từ CLIProxyAPI registry.
- Expose model variants của Codex OAuth qua dữ liệu catalog typed và IPC.
- Chuyển variant hợp lệ thành request option đến Codex proxy.
- Reset và render state picker đúng theo metadata Codex account/model.
- Unit, integration, renderer coverage cho các luồng trên.

**Không bao gồm**

- Thay đổi metadata hoặc API của CLIProxyAPI.
- Runtime discovery bằng endpoint OpenAI/Codex bên ngoài sidecar.
- Fallback variants từ `models.dev` hoặc OpenAI preset.
- Hỗ trợ numeric reasoning budget hay toggle ngoài effort strings, trừ khi registry biểu diễn chúng dưới dạng
  effort option tương thích.

## 7. Xử lý lỗi và tính tương thích

- Chỉ public string variant đã được adapter validate từ registry; bỏ qua capability malformed hoặc rỗng.
- Không được gửi effort stale/tự nhập vào wire. Main process revalidate trước khi tạo provider options.
- Giữ nguyên behavior các provider API-key, ChatGPT web và model Codex không hỗ trợ reasoning.
- Không expose đường dẫn runtime, credential proxy, hoặc chi tiết nội bộ registry cho renderer.

## 8. Kiểm thử

1. **Unit adapter:** registry fixture có effort, không có effort và malformed metadata; xác nhận output variants.
2. **Unit request resolution:** variant hợp lệ sinh `reasoningEffort`; variant thiếu/stale không sinh option.
3. **Integration catalog/IPC:** account Codex OAuth nhận model list và variants từ fixture registry.
4. **Renderer:** picker xuất hiện với đúng options; ẩn nếu variants rỗng; reset selection khi đổi model/account.
5. **Regression:** các provider không phải Codex giữ nguyên catalog variant và provider options.
