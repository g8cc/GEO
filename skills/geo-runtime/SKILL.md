---
name: geo-runtime
description: GEO 技能检查 / 环境诊断。检查 GEO Skills 是否安装完整、Node.js 是否正常、geo CLI 是否可用、平台连通性。当用户说"使用 GEO 技能检查功能，检查我的 GEO Skills 是否安装成功""检查环境""装完技能了帮我检查一下"，或任何 geo-* 技能报错前的第一响应时使用。
---

# GEO 技能检查（环境诊断）

## 检查顺序

1. **Skills 完整性**：确认 `geo-student-workflow`、`geo-runtime`、`geo-config`、`geo-brand`、`geo-knowledge`、`geo-knowledge-sync`、`geo-keyword-pool`、`geo-content-production`、`geo-ai-answer-card`、`geo-content-audit`、`geo-content-to-publish-pipeline`、`geo-publish`、`geo-indexing`、`geo-source-assets`、`geo-analysis`、`geo-brand-diagnosis`、`geo-troubleshooter` 都能被发现。
2. **Node.js**：`node --version`，需要 20+。**不要求也不允许安装 Python、pip 或运行 Python 脚本**。
3. **CLI 可用**：`geo version --check`。返回 `CLI_UPDATE_REQUIRED` 时按 `nextAction.command` 升级后再继续；服务暂时不可达时报告连通性异常，不把已安装的程序误判为缺失，不反复重装。
4. **平台连通性**：`geo call projects.list`（需要已配置密钥）。

## 触发词

```text
使用 GEO 技能检查功能，检查我的 GEO Skills 是否安装成功。
```

## 输出格式

逐项汇报：✅/❌ + 证据（版本号、命令输出摘要）+ 下一步。全部通过后提示：`下一步用 GEO 配置技能初始化密钥并选择公司和产品`。

## 卡点对照（来自课程卡点处理表）

| 问题 | 处理 |
|---|---|
| Skills 不可用 | 先检查安装和环境，再找助教；**不要安装 Python** |
| CLI 服务不可达 | 报告连通性异常；检查平台是否启动、地址是否正确 |
| Node 版本过低 | 升级 Node 20+；不要用 Python 脚本替代 |
