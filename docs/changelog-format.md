# Format Changelog

Quy ước viết changelog giữa các version (VD: `v0.21.4 → v0.25.1`) để tái sử dụng.

## Cấu trúc

```markdown
# Changelog — Meow Coding v<old> → v<new>

## 🚀 New Features

### <Tên tính năng lớn>
- Mô tả từng thay đổi người dùng thấy được.
- Viết bằng tiếng Anh, ngắn gọn, tập trung vào giá trị người dùng.

### <Tên tính năng lớn khác>
- ...

## 📱 Mobile Remote Control — Coming Soon
- Mô tả ngắn những gì đang được phát triển (WS relay, pairing code, đồng bộ chat...).
- Kết thúc bằng dòng "Stay tuned — ... 🚧".

## 🐛 Bug Fixes
- Từng fix một, ngắn gọn theo phạm vi (VD: "Chat: ...", "Remote: ...").

## 🧹 Internal & Docs
- Refactor, docs, specs, plans, chore.
```

## Quy tắc

- **Ngôn ngữ**: tiếng Anh (TA).
- **Mobile**: LUÔN ghi `Coming Soon` — chưa quảng bá là đã có.
- Gom commit theo nhóm tính năng (dùng `git log --oneline <range>` để liệt kê), không liệt kê từng commit.
- Mỗi mục 1 dòng, không quá 2 câu; bắt đầu bằng động từ hoặc cụm người dùng thấy được.
- Emoji ở header mục chính (`🚀`, `📱`, `🐛`, `🧹`).
- Header: `# Changelog — Meow Coding v<old> → v<new>`.

## Cách tạo

```bash
git log --oneline <old-tag>..<new-commit>
```

Gom commit theo chủ đề (feat → fix → docs) rồi viết theo cấu trúc trên.
