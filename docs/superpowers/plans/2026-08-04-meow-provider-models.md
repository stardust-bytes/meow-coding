# Meow Coding — Provider + Model quản lý theo opencode (models picker, bỏ preset)

**Goal:** Giống opencode: (1) hiển thị model đang dùng + **switch model** từ UI; (2) mỗi provider có **danh sách model** để chọn; (3) **không có preset mặc định** anthropic/openai — người dùng tự thêm provider + API key. Tham khảo opencode `D:\GitHub\opencode-1.18.11`:

- Provider: người dùng thêm API key (`opencode auth login`); model chọn theo `provider/model` từ models.dev.
- TUI hiển thị model hiện tại (status bar) + model picker liệt kê `provider/model`.

**Phạm vi:** `src/shared/types.ts`, `src/main/agent/config.ts`, `src/main/meow-agent-manager.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `SettingsDialog.tsx`, renderer (ModelPicker mới + ChatPanel + styles), tests.

---

## Thiết kế

### shared/types.ts
```ts
export interface ProviderSettings { id: string; apiKey: string; baseUrl?: string; models: string[] }
export interface MeowSettings { providers: ProviderSettings[]; defaultProvider: string }
export interface ModelRef { provider: string; model: string }
```
`AgentConfig` thêm `model?: string` — định dạng `provider/model` (model đang dùng của agent, giống opencode).

### config.ts
- `MeowProviderConfig`: `model: string` → `models: string[]`.
- `MeowAgentConfig`: `{ provider?: string; model?: string; systemPrompt }`.
- `DEFAULT_MEOW_CONFIG.provider = {}` (bỏ preset anthropic/openai); `model = ''`.
- Migration trong `mergeDefaults`: provider cũ có `model` (string) → `models: [model]`; agent cũ có `model` (tên provider) → `provider`.
- `resolveAgentConfig(cfg, agentName, env, agentModel?)`: `agentModel` ("provider/model") override; split `/` → provider + model; nếu không có provider → trả `{ provider:'', model:'', apiKey:null }`.
- `configToSettings` / `settingsToConfig` theo shape mới.

### meow-agent-manager.ts
- `register()`: resolve với `agent.model`.
- `getProviderModels(): ModelRef[]` (từ settings, tất cả provider × models).
- `getAgentModel(agentId): ModelRef | null` (resolved hiện tại).
- `setModel(agentId, provider, model)`: set `agent.model = provider/model`, rebuild runner.
- `send()`: message lỗi → "[meow] Chưa cấu hình provider/API key. Mở Settings để thêm provider và API key." (không hardcode env var).

### IPC (4 chỗ + test)
- `AgentSetModel: 'agent:set-model'` → `setAgentModel(agentId, provider, model)`.
- `AgentGetModel: 'agent:get-model'` → `getAgentModel(agentId): ModelRef | null`.
- `ProviderModels: 'provider:models'` → `getProviderModels(): ModelRef[]`.
- Main handler `setAgentModel` persist qua `workspaces.updateAgent(..., { model: 'provider/model' })`.

### SettingsDialog (rework)
- Row provider: **id | apiKey | baseUrl | models** (comma-separated input) | default radio | remove.
- Nút "+ Add provider" thêm row rỗng; bỏ PRESETS + select preset.
- Save: cần id + ≥1 model cho mỗi provider.

### Renderer
- `ModelPicker.tsx` (mới): button hiển thị model hiện tại (`provider/model`) + dropdown liệt kê `provider/model` từ `getProviderModels()`; click → `setAgentModel`. Đặt cạnh variant select trong mode bar.
- `ChatPanel.tsx`: fetch `getAgentModel` + `getProviderModels` khi mount; state `currentModel`, `availableModels`; onChange → set + update local.
- CSS: `.model-picker` + dropdown (flat, giống session-menu).

## Kiểm thử
- ipc-contract: 3 method/channel mới.
- meow-agent-manager: getSettings trả provider rỗng (không preset); saveSettings với `models`; `resolveAgentConfig` với agentModel.
- Settings e2e: cập nhật luồng mới (add provider → fill id/models/apiKey → Save).
- `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.

---

## Task 1: config + types + manager + IPC
- [ ] types.ts: ProviderSettings/ModelRef/AgentConfig.model.
- [ ] config.ts: models[], migration, resolve với agentModel, bỏ preset.
- [ ] manager: getProviderModels/getAgentModel/setModel + send message.
- [ ] ipc/preload/index handlers + test.
- [ ] typecheck + test.

## Task 2: SettingsDialog rework
- [ ] Rework rows + "+ Add provider" + save.
- [ ] Update e2e settings test.
- [ ] typecheck + test.

## Task 3: Renderer ModelPicker + ChatPanel
- [ ] ModelPicker component + CSS.
- [ ] ChatPanel wiring.
- [ ] typecheck + build.

## Task 4: Verify
- [ ] npm test + build + e2e.
- [ ] Script: thêm provider qua settings → model picker hiện + switch.
