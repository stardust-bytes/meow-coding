# Format Changelog

Convention for writing changelogs between versions (e.g., `v0.21.4 → v0.25.1`) for reuse.

## Structure

```markdown
# Changelog — Meow Coding v<old> → v<new>

## 🚀 New Features

### <Major feature name>
- Describe each user-visible change.
- Write in English, concisely, focusing on user value.

### <Other major feature name>
- ...

## 📱 Mobile Remote Control — Coming Soon
- Brief description of what's being developed (WS relay, pairing code, chat sync...).
- End with the line "Stay tuned — ... 🚧".

## 🐛 Bug Fixes
- One fix per line, concise by scope (e.g., "Chat: ...", "Remote: ...").

## 🧹 Internal & Docs
- Refactor, docs, specs, plans, chore.
```

## Rules

- **Language**: English.
- **Mobile**: ALWAYS write `Coming Soon` — don't promote it as already available.
- Group commits by feature group (use `git log --oneline <range>` to list), don't list each commit individually.
- One line per item, no more than 2 sentences; start with a verb or a user-visible phrase.
- Emoji in main section headers (`🚀`, `📱`, `🐛`, `🧹`).
- Header: `# Changelog — Meow Coding v<old> → v<new>`.

## How to generate

```bash
git log --oneline <old-tag>..<new-commit>
```

Group commits by topic (feat → fix → docs) then write following the structure above.