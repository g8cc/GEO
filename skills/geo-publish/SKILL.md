---
name: geo-publish
description: 发布任务技能。创建和回查自媒体、付费媒体发布任务，查询发布状态、publishedUrl 和失败原因。当用户说"创建发布任务""查一下文章发了没有""帮我拿正式链接""回查发布状态"时使用。
---

# 发布任务技能

## 创建发布任务

```bash
geo plan publishTasks.create --input '{"projectId":…,"articleId":…,"platform":1,"accountId":…}'
# 展示发布包摘要（7 字段）→ 学员确认 → geo apply
geo plan publishTasks.confirm --input '{"taskId":…}'   # 人工确认预览/账号/素材/链接 → apply
```

平台枚举：1 今日头条 / 2 搜狐 / 3 网易 / 4 抖音 / 5 知乎 / 6 小红书 / 7 微信公众号 / 8 什么值得买 / 9 官网。

## 回查发布状态

```bash
geo call publishTasks.get --input '{"taskId":…}'
geo call publishTasks.list --input '{"projectId":…}'
```

- 「已发布」→ 记录 publishedUrl，交给 `geo-indexing` 做收录监测。
- 「失败」→ 读 failReason；检查账号、额度、素材、链接和发布范围，再用 `geo-troubleshooter`。
- 「发布中」→ 这是正常异步过程，回话告知学员在跑，不要反复查询，更不要重新创建任务。

## 铁律

- **创建发布任务成功，只代表平台已接受任务**，不代表文章已审核完成或已拿到发布链接。
- 文章 ID ≠ 已发布；publishedUrl ≠ AI 已看见。
- 发布任务创建后不要重复运行完整流水线；一件事拆多份计划时，把每份摘要合在一条消息里让学员一次确认，再逐个 apply。
