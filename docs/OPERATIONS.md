# 运维手册

> 读者：运维 / 值班人员。部署步骤见 `DEPLOYMENT.md`；本文覆盖上线后的日常运维、备份恢复与故障处理（Runbook）。

## 1. 服务拓扑与关键路径

```
浏览器 / AI 工具 → Nginx(443) → node server.js(3438) → SQLite(WAL) + data/uploads/
```

健康探针：`GET /healthz` → `{"ok":true}`（进程存活即返回，不查库）。
日志：systemd 部署下 `journalctl -u geo -f`；错误带 `[server]` / `[openapi]` / `[publish:settle]` 前缀。

## 2. 日常巡检（建议每日）

| 项 | 命令/位置 | 正常标准 |
|---|---|---|
| 存活 | `curl -s http://127.0.0.1:3438/healthz` | ok:true |
| 进程 | `systemctl status geo` | active (running)，无 Restart 风暴 |
| 磁盘 | `df -h` + `du -sh /opt/geo/platform/data` | 使用 < 80%；uploads 增长符合预期 |
| 备份 | 检查备份目录当日文件存在且非 0 字节 | 每日 1 份 |
| 错误日志 | `journalctl -u geo --since today \| grep -c ERROR` | 无连续 ERROR |
| 发布任务积压 | 平台「内容发布」页：状态「发布中」超过 1 分钟的条数 | mock 模式应为 0（4s 内结算）；持续积压见 Runbook R3 |

## 3. 备份与恢复

- **备份对象**：`data/geo.db`（+`-wal`/`-shm`）与 `data/uploads/`。
- **在线备份**（不停服）：`sqlite3 data/geo.db ".backup '/backup/geo-$(date +%F).db'"`
- **恢复**：停服 → 替换库文件（删除 -wal/-shm）→ 还原 uploads → 启服 → `/healthz` + 登录冒烟。全步骤见 `DEPLOYMENT.md §5`。
- **演练频率**：每季度一次完整恢复演练，记录 RTO（目标 < 10 分钟）。

## 4. 故障处理 Runbook

### R1 服务无响应 / 502
1. `systemctl status geo`——挂了看 `journalctl -u geo -n 200` 尾部异常；
2. 常见原因：磁盘满（uploads 爆量）→ 清理/扩容；Node 崩溃 → 看 panic 日志，`Restart=always` 会自动拉起；
3. 恢复后冒烟：`/healthz` + 登录 + 打开任一项目页。

### R2 数据库锁 / 写入报 SQLITE_BUSY
SQLite WAL 下罕见；多为备份脚本直接拷贝 -wal 造成。规范：备份用 `.backup` 命令（§3）。若已发生：`systemctl stop geo` → 移除 -wal/-shm（确认已 checkpoint）→ 启动。

### R3 发布任务长时间「发布中」
1. 这是 mock 发布器：确认进程是否中途重启——重启时 `catchUpOnStartup` 会自动结算超时任务，等待 1 分钟刷新；
2. 仍卡住：查 `publishTasks` 表该任务 status 与 `createdAt`，手动触发修复：
   `node -e "import('./platform/src/services.js').then(m=>console.log(m.confirmPublishTask('<taskId>')))"`（仅限 status=1 卡住的旧任务）；
3. 生产接真实渠道后此 Runbook 由渠道回调逻辑替代。

### R4 监测任务「运行中」但无结果
1. 检查任务 checkpoints：第 0 天检查点是否 status=1 未执行（创建时 runNow=false 的场景）→ 平台点「执行下个复测点」；
2. 检查问题是否仍属于该项目（跨项目问题在创建时已被拒绝，历史数据除外）。

### R5 学员反馈「密钥无效 / 设备不匹配」
1. `AUTH_REQUIRED`：密钥被吊销或输错 → 网页重建密钥 → `geo auth login` 重新绑定；
2. `DEVICE_MISMATCH`：换机器/重装系统 → 重建密钥重新绑定（密钥与设备一一对应是设计行为）；
3. 项目不在列表：网页「Open Key → 编辑授权项目」勾选即可，立即生效。

### R6 `PLAN_EXPIRED / PLAN_USED` 咨询
设计行为：plan 30 分钟有效、只能执行一次。让学员重新 plan → 重新确认 → apply。

### R7 登录会话频繁失效
检查是否多实例部署共用同一库但 Cookie 域不一致；`SESSION_SECURE=1` 必须在 HTTPS 下使用（HTTP 下加 Secure 会导致 Cookie 不发送）。

## 5. 监控建议（接现有告警体系）

| 指标 | 采集方式 | 告警阈值 |
|---|---|---|
| 存活 | HTTP 拨测 `/healthz` | 连续 3 次失败 |
| 磁盘 | data/ 目录用量 | > 80% |
| 错误速率 | journalctl ERROR 关键字 | > 10/小时 |
| 备份新鲜度 | 备份文件 mtime | > 26 小时 |

## 6. 变更管理

- 升级流程与回滚见 `DEPLOYMENT.md §6/§8`；
- 数据库结构变更为幂等建表，升级无需手工迁移；重大版本升级先在测试实例跑 `node scripts/e2e.mjs`；
- 配置变更（环境变量）= 改 systemd unit → `daemon-reload` → `restart`，属于变更操作需记录。
