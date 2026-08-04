# Meow Coding — Sync model list thật từ models.dev (giống opencode connector)

**Goal:** Thay vì người dùng tự gõ tên model (dễ sai, VD "deepseek-chat"), sync **danh sách model thật** của provider từ models.dev — giống opencode fetch catalog (`https://models.dev/api.json`, cache 5 phút). Tham khảo `D:\GitHub\opencode-1.18.11\packages\core\src\models-dev.ts`.

**Phạm vi:** `src/main/models-catalog.ts` (mới), `src/main/meow-agent-manager.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `SettingsDialog.tsx`, tests.

---

## Thiết kế

### `src/main/models-catalog.ts` (mới)
```ts
export interface CatalogProvider { name: string; models: string[] }
export class ModelsCatalog {
  constructor(private cacheFile: string, private fetchFn?: typeof fetch) {}
  async fetch(): Promise<Record<string, CatalogProvider>>
}
```
- Fetch `https://models.dev/api.json` (timeout 10s, `AbortSignal.timeout`), map `Record<providerId, { name, models: Record<modelId,...> }>` → `{ name, models: string[] }`.
- Cache `userData/models.json` `{ fetchedAt, providers }`, TTL 5 phút (giống opencode).
- Lỗi/offline → trả `{}` (không crash); dùng lại cache cũ nếu quá TTL? → đơn giản trả `{}`.
- `fetchFn` inject cho test.

### manager
- `deps.catalog: ModelsCatalog`.
- `async fetchProviderModels(providerId): Promise<string[]>` → `catalog.fetch()[providerId]?.models ?? []`.

### IPC (4 chỗ + test)
- `ProviderFetchModels: 'provider:fetch-models'` → `fetchProviderModels(providerId): Promise<string[]>`.

### main/index.ts
- Tạo `catalog = new ModelsCatalog(path.join(userData, 'models.json'))`; truyền vào deps; handler.

### SettingsDialog
- Mỗi row provider thêm nút **"fetch"** cạnh ô models → `window.api.fetchProviderModels(p.id)` → điền `models` (nếu có). Nếu rỗng → hint "unknown provider / offline".

### Renderer
- ModelPicker không đổi (đọc models từ settings — giờ là list thật đã fetch).

## Kiểm thử
- ipc-contract: `fetchProviderModels`.
- Unit `models-catalog.test.ts`: mock `fetchFn` (provider có models, provider không tồn tại → [], cache TTL).
- `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.

---

## Task 1: catalog + manager + IPC
- [ ] models-catalog.ts + unit test.
- [ ] manager fetchProviderModels + deps.catalog.
- [ ] ipc/preload/index + ipc-contract.
- [ ] typecheck + test.

## Task 2: SettingsDialog fetch button
- [ ] Nút "fetch" per row.
- [ ] typecheck + build.

## Task 3: Verify
- [ ] npm test + build + e2e.
- [ ] Script: thêm provider id "deepseek" → fetch → models thật hiện trong picker.
