# Git Hooks

启用（每台开发机一次性配置）：

```bash
git config core.hooksPath ops/git-hooks
```

- `pre-commit`：cargo clippy（警告即拒绝）。
- 完整质量门（clippy + 单测 + 全量测试 + HTML 审计 + 渲染截图）：`make verify`。
