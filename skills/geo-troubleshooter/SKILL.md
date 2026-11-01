---
name: geo-troubleshooter
description: GEO 故障排查技能。排查配置、接口、上传、发布和收录问题，输出问题、原因、证据和下一步。当用户说"失败了但不知道原因""发布失败怎么办""上传报错""收录查不到"或任何 geo-* 流程卡住时使用。
---

# GEO 故障排查技能

## 排查方法

按「现象 → 检查命令 → 可能原因 → 下一步」定位，每一步给出证据（命令输出），不猜测。

### 1. 环境/CLI 问题

```bash
node --version          # 需要 20+
geo version --check     # CLI_UPDATE_REQUIRED → 按 nextAction.command 升级
geo auth status         # AUTH_REQUIRED → 重新 geo auth login
```

服务暂时不可达 → 报告连通性异常，检查平台是否启动；不把已安装的程序误判为缺失，不反复重装。**不要安装 Python。**

### 2. 权限/项目问题

```bash
geo call projects.list
```

- 项目不在列表 → 让用户去平台「密钥管理」编辑该密钥授权的项目（立即生效，不用重新登录）；或在另一个账号下则需重建密钥。
- `WRITE_REQUIRES_PLAN` → 写操作必须 `geo plan` → 用户确认 → `geo apply`。
- `PLAN_EXPIRED` / `PLAN_USED` → 重新 plan，把新摘要再确认一次；不要拿旧 planId 重试。

### 3. 发布失败

检查顺序（课程卡点表原文）：**账号 → 额度 → 素材 → 链接 → 发布范围**。

```bash
geo call publishTasks.get --input '{"taskId":…}'    # 读 failReason
geo call accounts.list --input '{"projectId":…}'     # 账号授权状态与额度
geo call articles.get --input '{"articleId":…}'      # 文章版本与状态
```

常见原因：未通过三道审核就发布、账号未授权/额度不足、文章版本不对、正式链接承接方式未确认。处理后重新走 `geo-content-to-publish-pipeline`。

### 4. 没有监测结果

检查任务、平台、问题和完成状态（`geo call monitorTasks.get`），**不要凭想象诊断**。任务 pending 不等于失败；刚提交那一刻查不到结果是正常的。

### 5. 知识库没有证据

回到 `geo-knowledge` 补资料，**不能让 AI 编造事实**；缺什么向业务方要，标注「待补充」。

## 输出格式

```text
问题：<一句话现象>
原因：<最可能的原因，附证据>
证据：<命令输出摘要>
下一步：<具体动作（命令/找谁）>
```
