---
name: geo-knowledge-sync
description: 知识库同步技能。把本地整理好的品牌/产品知识库文档与 GEO 平台知识库做上传同步，或从平台拉取知识库内容到本地。当用户说"把知识库同步到平台""上传知识库""同步知识库"，或 geo-knowledge 整理完成需要入库时使用。
---

# 知识库同步技能

## 本地 → 平台（上传）

单篇文档：

```bash
geo plan knowledge.uploadDoc --input '{"projectId":…,"type":1,"module":2,"title":"02_产品与服务事实","content":"…","evidence":["原始链接"],"pending":"待补充说明"}'
# 展示摘要 → 学员同意 → geo apply <planId>
```

批量整理（六模块一步到位）：

```bash
geo plan knowledge.organize --input '{"projectId":…,"type":1,"raw":"<原始资料>"}'
```

## 平台 → 本地（下载）

```bash
geo call knowledge.list --input '{"projectId":…,"type":1}'
```

把返回的六模块文档写到本地项目文件夹（如 `知识库/品牌知识库/01_定位与业务边界.md`），便于离线查看和版本管理。

## 约束

- type：1=品牌知识库，2=产品知识库。
- module 取值：1 定位与业务边界 / 2 产品与服务事实 / 3 客户与使用场景 / 4 优势与竞品差异 / 5 案例与结果 / 6 权威背书与外部证据。
- 上传是写操作：必须 plan → 学员明确同意 → apply；数组字段是整体覆盖不是追加，摘要要完整展示。
- 不编造：没有证据支撑的内容标「待补充」，不同口径列冲突清单。
