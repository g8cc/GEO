---
name: geo-keyword-pool
description: 问题池与关键词技能。建立问题库、按 P0-P3 设置优先级、维护问题状态；按方法论生成 50 问/精简 40 问；挖掘搜索词与需求词。当用户说"使用问题池与关键词技能，帮我建立问题池，按优先级整理下一步动作""生成 50 个问题""帮我挖掘搜索词"时使用。
---

# 问题池与关键词技能

## 触发词（原文）

```text
使用问题池与关键词技能，帮我建立问题池，按优先级整理下一步动作。
```

## 问题体系

- **类型**（六类）：品牌认知 / 产品推荐 / 对比选型 / 效果验证 / 行动转化 / 风险判断。
- **阶段**：探索（不带品牌名）/ 评估（带品牌名）/ 行动（带品牌名）。
- **优先级**：P0 最高 → P3 低。
- **状态**：待监测 / 监测中 / 已上榜 / 优化中。

## 操作

### 1. 生成 50 问（文档二 1.2，方法论见 references/50问生成.md）

```bash
geo plan questions.generate --input '{"projectId":…,"mode":"50"}'
# 摘要会列出「将新增/已存在跳过/重复跳过」→ 学员同意 → geo apply
```

### 2. 精简为标准 40 问（文档二 1.3，见 references/40问精简.md）

```bash
geo plan questions.generate --input '{"projectId":…,"mode":"40"}'
```

输出 Markdown 表格：编号 / 问题内容 / 分类（探索/评估/行动）/ 意图维度 / 核心关键词。

### 3. 手动添加与批量导入

```bash
geo plan questions.create --input '{"projectId":…,"text":"3-8岁儿童体感运动哪家好？","category":2,"priority":0}'
geo plan questions.batchCreate --input '{"projectId":…,"items":[{"text":"…"},…]}'
```

### 4. 维护优先级与状态

```bash
geo plan questions.update --input '{"questionId":…,"priority":0,"status":2}'
```

### 5. 搜索词挖掘（文档二 5.1，见 references/搜索词挖掘.md）

## 行为约束

- 每条问题必须包含「哪家好/推荐/怎么选/排行」等促使 AI 输出品牌名单的词；严禁混入纯科普类问题。
- 探索题严禁出现品牌名；评估题与行动题必须包含品牌名。
- **监测复测必须固定问题原文**，不要每次更换问题；同一个问题持续复测。
- 把问题导入监测时：品牌问题和产品问题可以分别建立监测任务。

## 与下一步的衔接

先建关键词池，再决定哪些 P0/P1 进入内容生产（`geo-content-production`）；主攻问题选定后进入七步实操。
