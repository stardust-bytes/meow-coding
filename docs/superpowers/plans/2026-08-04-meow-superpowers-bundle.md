# Meow Coding — Pre-install Superpowers skills

**Goal:** Cài sẵn bộ skill **Superpowers** (obra/superpowers — opencode plugin) vào app để agent native "meow" luôn có thể gọi qua tool `skill` (chỉ cần gọi tên là dùng được). Mỗi skill là file `.md` frontmatter `name/description` — đúng format meow đang load (`collectSkills`).

**Nguồn:** `https://github.com/obra/superpowers/tree/main/skills/<name>/SKILL.md` — 14 skill: brainstorming, dispatching-parallel-agents, executing-plans, finishing-a-development-branch, receiving-code-review, requesting-code-review, subagent-driven-development, systematic-debugging, test-driven-development, using-git-worktrees, using-superpowers, verification-before-completion, writing-plans, writing-skills.

**Phạm vi:** `resources/skills/*.md` (mới, bundle), `src/main/agent/skill.ts`, `src/main/agent/tools/skill.ts`, `src/main/agent/tools/registry.ts`, `src/main/meow-agent-manager.ts`, `src/main/index.ts`, tests.

---

## Thiết kế

### Bundle
- Download 14 `SKILL.md` → `resources/skills/<name>.md` (giữ nguyên nội dung + frontmatter).

### skill.ts
`collectSkills(cwd, userSkillsDir, builtinSkillsDir?)` — thêm thư mục builtin (giữa project `.meow/skills` và userSkillsDir; user override builtin).

### tools/skill.ts + registry.ts
`createSkillTool(getUserSkillsDir, getBuiltinSkillsDir?)`; `DefaultToolsOptions` thêm `getBuiltinSkillsDir`.

### manager + main
- `MeowAgentManagerDeps.builtinSkillsDir?`; `register()`: `collectSkills(agent.cwd, userSkillsDir, builtinSkillsDir)`.
- `main/index.ts`: `builtinSkillsDir = path.join(app.getAppPath(), 'resources', 'skills')`, truyền vào `createDefaultTools` + deps.

### Hệ quả
- System prompt liệt kê 14 skill → model gọi `skill(name)` → tool trả nội dung → agent thực thi theo quy trình superpowers (brainstorm → spec → plan → execute). Không cần cấu hình gì thêm.

## Kiểm thử
- Unit `skill.ts`: collectSkills nhận builtin dir (giả lập thư mục tạm).
- Verify: trong app, `getSkills`/system prompt chứa `brainstorming`, `writing-plans`, `executing-plans`, `using-superpowers`.

---

## Task 1: Download skills + bundle
- [ ] Download 14 SKILL.md vào `resources/skills/`.
- [ ] Kiểm tra frontmatter name đủ.

## Task 2: Wire builtinSkillsDir (skill.ts, tool, registry, manager, main)
- [ ] skill.ts collectSkills + builtin param.
- [ ] tools/skill.ts + registry.
- [ ] manager deps + main index.
- [ ] typecheck + test.

## Task 3: Verify
- [ ] npm test + build + e2e.
- [ ] Script: check system prompt / skill tool có thể load `using-superpowers`.
