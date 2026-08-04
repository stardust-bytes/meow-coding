# Meow Coding — Redesign Provider + Model (Provider popup + auto-sync + grouped model search)

**Goal:** (1) Thay Settings bằng nút **Providers** → popup danh sách provider đã connected + tìm provider để kết nối (chỉ nhập key, hệ thống auto-sync models từ models.dev, tự điền baseUrl); (2) click provider connected → xem models; (3) khung chat hiển thị nút **tên model đã chọn**, click → popup danh sách model **group theo provider + search input**.

**Phạm vi:** `src/shared/types.ts`, `src/main/models-catalog.ts`, `src/main/meow-agent-manager.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `Sidebar.tsx`, `ProvidersDialog.tsx` (mới, thay SettingsDialog), `ModelPicker.tsx` (redesign), `styles.css`, tests.

---

## Thiết kế

### shared/types.ts
```ts
export interface CatalogProviderSummary { id: string; name: string; api?: string; modelCount: number }
```
`ProviderSettings` giữ nguyên (`id, apiKey, baseUrl?, models[]`).

### models-catalog.ts
`CatalogProvider` thêm `api?: string` (base URL từ models.dev). Thêm `list()` trả `{ id, name, api, modelCount }[]`.

### manager
- `listProviderCatalog(): Promise<CatalogProviderSummary[]>`.
- `connectProvider(id, apiKey, baseUrl?): Promise<MeowSettings>` — fetch catalog; models = catalog[id].models; baseUrl = user ?? catalog[id].api; ghi vào settings (thay/thêm provider); defaultProvider = existing nếu còn, else id; `saveSettings` (reload); trả settings.
- `disconnectProvider(id): Promise<MeowSettings>` — xóa khỏi settings; save; trả settings.

### IPC (4 chỗ + test)
- `ProviderCatalog: 'provider:catalog'` → `listProviderCatalog()`.
- `ProviderConnect: 'provider:connect'` → `connectProvider(id, apiKey, baseUrl?)`.
- `ProviderDisconnect: 'provider:disconnect'` → `disconnectProvider(id)`.
- Bỏ SettingsDialog; MCP status chuyển vào ProvidersDialog (dùng `getMcpStatus` sẵn có).

### ProvidersDialog (mới, thay SettingsDialog)
- Hộp tìm kiếm provider + danh sách catalog (từ models.dev): mỗi row `name (id) · N models`; nếu connected → nhãn "connected"; click "connect" → inline form `api key` (+ `baseUrl` optional) + Save → `connectProvider`.
- Mục "Connected": row provider (click → expand hiện models qua `fetchProviderModels`) + nút remove → `disconnectProvider`.
- Mục MCP servers (giữ từ Settings cũ).
- Sidebar menu: "settings" → "providers" mở ProvidersDialog.

### ModelPicker (redesign)
- Nút hiển thị **tên model đã chọn** (`current.model`).
- Popup: input **search** + danh sách model **group theo provider** (từ `getProviderModels()`); filter theo tên model/provider; click → `setAgentModel`.

## Kiểm thử
- ipc-contract: 3 method/channel mới.
- manager: connectProvider (auto models + baseUrl + default), disconnectProvider.
- models-catalog: `list()`.
- e2e settings → e2e providers (mở providers dialog, connect provider deepseek + key, save/connected).
- `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.

---

## Task 1: Main (types + catalog.list + manager connect/disconnect + IPC)
- [ ] shared types + catalog.list + CatalogProvider.api.
- [ ] manager: listProviderCatalog / connectProvider / disconnectProvider.
- [ ] ipc/preload/index + ipc-contract + unit tests.
- [ ] typecheck + test.

## Task 2: ProvidersDialog + Sidebar
- [ ] ProvidersDialog (search catalog, connect form, connected list + view models, MCP).
- [ ] Sidebar menu "providers"; xóa SettingsDialog usage.
- [ ] Update e2e settings → providers.
- [ ] typecheck + test + build.

## Task 3: ModelPicker redesign
- [ ] Search + grouped popup.
- [ ] typecheck + build.

## Task 4: Verify
- [ ] npm test + build + e2e.
- [ ] Script: connect deepseek (chỉ key) → models tự sync → picker group + search + switch.
