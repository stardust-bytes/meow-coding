# AGENTS.md — src/renderer/src/components/chat

The native-agent chat panel: message feed, streaming deltas, tool-call cards, permission/question
prompts, message queue, and the composer (input + image attach + @-mention). Renders `ChatEvent`s
pushed from main over IPC (`window.api.onChatEvent`).

## Key files

| File | Responsibility |
|---|---|
| `ChatPanel.tsx` | Main container: subscribes to chat events, owns feed state (items/todos/queue/pendingPrompt), rAF-batches stream deltas, renders feed + composer + context footer. Transient status lines (compaction, retry) live only in feed state — never written to the transcript. On mount it restores an in-flight permission/question prompt via `window.api.getPendingPrompt` so a remounted panel (tab switch) doesn't leave the agent hanging. Memoized. |
| `useChatScroll.ts` | Feed scroll controller: follow/anchored/manual modes, turn-top anchoring, jump-to-end, jump button. `chat-scroll-geometry.ts` holds the pure geometry helpers. |
| `ChatInput.tsx` | Composer: textarea (Enter to send), paste/drop image chips (≤4, ≤5MB), `@` file-mention dropdown + chips, edit-queued flow. Memoized. |
| `parseCommandInput.ts` | `parseCommandInput(raw)` → `{ isCommand, prefix }` for the `/`-command menu. |
| `SessionBar.tsx` | Session list bar (create/switch/rename/delete sessions). |
| `ToolCallCard.tsx` | Renders a tool call: input JSON, diff (for edit/apply-patch), output/error. Memoized. |
| `MarkdownText.tsx` | Markdown rendering via `marked` + `DOMPurify.sanitize`. |
| `DiffView.tsx` | Inline diff view for edit tool calls. |
| `ContextFooter.tsx` | Token/context usage + session cost footer. |
| `ModelPicker.tsx` | Model selector for the agent. |
| `VariantPicker.tsx` | Variant selector (reasoning effort etc.) for the agent. |
| `Dropdown.tsx` | Reusable dropdown menu (used by ModelPicker/VariantPicker). |
| `questionAnswer.ts` | `buildQuestionAnswer` — helper for permission/question answers. |
| `markdownTable.ts` | `normalizeMarkdownTables` — repairs markdown table pipes before rendering. |

## Conventions

- Feed updates are batched per animation frame (`flushDeltas`) to avoid input lag — keep streaming hot paths cheap.
- `FeedMessage`/`ToolCallCard` are memoized; update copy-on-write (never mutate items in place) so memo works.
- Message queue: prompts sent while a turn runs are queued in main; renderer shows `queued` badge rows and supports remove/edit via `window.api.removeQueued/editQueued`.
- Images travel as dataURL strings in `ImageAttachment`; only image/* accepted.
