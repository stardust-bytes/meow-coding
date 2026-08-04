# Meow Coding — Model level / variant selector (theo opencode)

**Goal:** Cho phép chọn "cấp độ" của model (`low | medium | high | max`) cho agent native, giống opencode `--variant` (reasoning effort). Tham khảo opencode `D:\GitHub\opencode-1.18.11`:

- `packages/opencode/src/provider/transform.ts` — variant = reasoning effort tiers; phổ biến nhất `low/medium/high`, thêm `xhigh`/`none` cho model OpenAI mới.
- CLI `--variant` (model variant — provider-specific reasoning effort).
- Lưu theo session (`setAgentModel`), hiển thị ở chọn model.

**Phạm vi:** `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/meow-agent-manager.ts`, `src/main/agent/loop.ts`, `src/main/agent/llm.ts`, renderer `Pane.tsx`/`ChatPanel.tsx`/`styles.css`, tests.

---

## Thiết kế

### shared/types.ts
`export type ModelVariant = 'low' | 'medium' | 'high' | 'max'`
`AgentConfig` thêm `variant?: ModelVariant` (persist theo agent như `mode`).

### llm.ts
`LlmStreamOptions.variant?: ModelVariant`. Trong `stream()`:
- `anthropic`: `providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens } } }` — budget: low 4096, medium 8192, high 16384, max 32000.
- openai-compatible: `providerOptions: { openaiCompatible: { reasoningEffort } }` — low/medium/high; max → `xhigh` (SDK gửi `reasoning_effort` vào body — đã xác minh `@ai-sdk/openai-compatible`).
- Không set variant → không thêm providerOptions (giữ hành vi mặc định).

### loop.ts
`LoopDeps.variant?: ModelVariant`; truyền vào `llm.stream(...)`.

### meow-agent-manager.ts
`variants` theo `agent.variant` (đọc từ AgentConfig). `setVariant(agentId, variant)`: cập nhật agent + rebuild runner nếu đang không chạy (giống `setMode`). `register()`: `variant: agent.variant`.

### IPC
`AgentSetVariant: 'agent:set-variant'` + `setAgentVariant(agentId, variant): Promise<void>`; main handler lưu qua `workspaces.updateAgent`; preload; ipc-contract test.

### Renderer
- `Pane.tsx`: truyền `variant={pane.agent.variant}` + `onVariantChange`.
- `ChatPanel.tsx`: thêm prop `variant`, hiển thị select `effort` (low/medium/high/max) trong `.chat-mode` row (style flat, `.input`-like); onChange → `onVariantChange`.
- CSS: `.chat-variant-select` gọn.

## Kiểm thử
- ipc-contract: `setAgentVariant`.
- meow-agent-manager: `setVariant` cập nhật agent config + rebuild runner.
- `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.

---

## Task 1: Main process + llm
- [ ] types: `ModelVariant` + `AgentConfig.variant`.
- [ ] llm.ts: variant → providerOptions (anthropic thinking / openai reasoningEffort).
- [ ] loop.ts: `variant` truyền vào stream.
- [ ] manager: `setVariant` + register variant.
- [ ] ipc/preload/index + test.
- [ ] typecheck + test.

## Task 2: Renderer
- [ ] Pane + ChatPanel: select effort trong mode bar.
- [ ] CSS.
- [ ] typecheck + build.

## Task 3: Verify
- [ ] npm test + build + e2e.
