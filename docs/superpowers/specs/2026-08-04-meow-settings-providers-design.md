# Meow Settings — Provider API Keys UI: Design Spec

Ngày: 2026-08-04 · Trạng thái: chờ duyệt

## 1. Mục tiêu

- Người dùng nhập/đổi **API key** từ giao diện app (không phải sửa file `meow.json` thủ công).
- Hỗ trợ **nhiều provider/model** (Anthropic, OpenAI, DeepSeek, local...), chọn provider mặc định.
- Lưu vào `userData/meow.json` như cũ; áp dụng ngay sau khi lưu (reload config agent).

## 2. Quyết định

| Chủ đề | Quyết định |
|---|---|
| UI | Dialog **Settings** mở từ sidebar (nút "settings") |
| Dữ liệu | `MeowSettings { providers: ProviderSettings[], defaultProvider }`; map qua lại với `MeowConfig` |
| ProviderSettings | `{ id, apiKey, baseUrl?, model }` |
| Provider engine | Anthropic → `@ai-sdk/anthropic`; mọi provider khác → openai-compatible (`createOpenAICompatible`) → DeepSeek/local đều dùng được |
| Key | `apiKey` inline trong meow.json (plaintext, chấp nhận như các tool khác); nếu rỗng → dùng env `{ID}_API_KEY` |
| Áp dụng | Sau `saveSettings` → `MeowAgentManager.reload()` re-resolve config agent hiện có |
| Preset | Dropdown "Add provider" có sẵn: DeepSeek (`https://api.deepseek.com/v1`, `deepseek-chat`), OpenAI, Anthropic, Custom |

## 3. IPC / API

- `Channels`: `SettingsGet: 'settings:get'`, `SettingsSave: 'settings:save'`.
- `AgentApi`: `getSettings(): Promise<MeowSettings>`, `saveSettings(s): Promise<MeowSettings>`.
- Main handler gọi `MeowAgentManager.getSettings()` / `saveSettings()`.

## 4. Luồng

1. Sidebar → "settings" → `getSettings()` → render form (provider rows + default radio).
2. User sửa key/model/baseUrl, thêm/xóa provider, chọn default → Save.
3. `saveSettings(s)` → main merge vào config hiện có (giữ agents/permission) → ghi `meow.json` →
   `reload()` → return settings mới.
4. Lần sau gõ prompt, agent dùng provider mặc định + key vừa lưu.

## 5. Kiểm thử

- Unit: round-trip `configToSettings`/`settingsToConfig`, apiKey↔apiKeyEnv, provider rỗng → fallback default,
  write `meow.json` thật, manager reload.
- E2E: mở settings dialog → sửa key → save → dialog đóng, không crash.

## 6. Tiêu chí thành công

1. Nhập key DeepSeek/OpenAI/Anthropic từ UI, chọn default, lưu → dùng được ngay.
2. `meow.json` ghi đúng; env vẫn fallback khi key rỗng.
3. Test + typecheck + e2e xanh.
