# 运维手册（Rust 版）

> 读者：运维 / 值班人员。部署步骤见 `DEPLOYMENT.md`；本文覆盖上线后的日常运维、备份恢复与故障处理（Runbook）。
> 所有命令假设已通过 `ops/install.sh` 安装（服务名 `geo-rust`，安装目录 `/opt/geo-rust`，端口 3438）；不同配置请 `source ops/geo.env` 或设置对应环境变量。

## 1. 服务拓扑与关键路径

```
浏览器 / AI 工具 → :3438 geo-platform(Rust/Axum) → SQLite(WAL) + data/uploads/
                  （可选）Nginx(443) 反代在前
```

健康探针：`GET /healthz` → `{"ok":true}`（进程存活即返回）。
日志：systemd 部署下 `journalctl -u geo-rust`；启动日志含 `[seed]` 与 `GEO Platform (Rust) started`。

## 2. geo-ctl 命令参考

统一入口：`/opt/geo-rust/ops/geo-ctl.sh <命令>`（下文简称 `geo-ctl`；可 `ln -s` 到 `/usr/local/bin/geo-ctl`）。

| 命令 | 作用 | 示例输出要点 |
|---|---|---|
| `geo-ctl status` | 服务状态（systemd / 本地进程）+ 端口监听 | active (running)、`*:3438 geo-platform` |
| `geo-ctl start` / `stop` / `restart` | 服务启停 | — |
| `geo-ctl logs [-f] [N]` | 查看日志（默认 100 行） | journalctl 或 geo.out.log |
| `geo-ctl health` | 五项健康检查：服务 / healthz / 登录页 / 数据库 / 磁盘 | 全部 ✓ 时「健康检查通过」 |
| `geo-ctl backup [目录]` | **在线备份**：sqlite3 backup API（WAL 一致，不停服）+ uploads 归档 + 轮转保留 14 份 | `geo-20261102-*.db` |
| `geo-ctl restore <备份.db>` | 恢复（需输入 YES；自动停服→覆盖→起服→健康检查） | 恢复前自动留 `*.pre-restore-*` |
| `geo-ctl version` | 二进制构建时间 / 端口 / 数据库路径 / healthz | — |
| `geo-ctl demo-reset` | ⚠️ 清库重建演示数据（输入 RESET 确认；自动先备份） | — |

开发机上等价命令（读取 `ops/geo.env`）：`make status | health | backup | logs | restart`。

## 3. 日常巡检（建议每日）

| 项 | 命令 | 正常标准 |
|---|---|---|
| 存活 | `geo-ctl health` | 五项全部 ✓ |
| 进程 | `systemctl status geo-rust` | active (running)，无 Restart 风暴（`systemctl show geo-rust -p NRestarts` 应为个位数） |
| 磁盘 | `df -h`（DB 与备份分区） | < 80% |
| 备份 | `ls -lt /opt/geo-backup/geo-*.db \| head -3` | 当日 1 份且 > 4KB |
| 错误日志 | `journalctl -u geo-rust --since today \| grep -ci error` | 0 或无连续增长 |
| 内存 | `ps -o rss= -p $(pgrep -f geo-platform)` | 常态 < 100 MB（空载 ≈ 10 MB） |

**每日备份 cron**（安装后一次性配置）：

```bash
sudo crontab -e
# 每日 02:30 备份；每 5 分钟巡检告警（需配置 ops/alert.env 的 ALERT_WEBHOOK 才外发）
30 2 * * * /opt/geo-rust/ops/backup.sh
*/5 * * * * /opt/geo-rust/ops/monitor.sh
```

备份策略：每日 1 份全量 + 保留 14 天 + 审计日志自动清理 90 天；恢复演练每季度一次（目标 RTO < 10 分钟）。

## 4. 备份与恢复

```bash
# 在线备份（不停服）
geo-ctl backup                          # → /opt/geo-backup/geo-<时间戳>.db + uploads-<时间戳>.tgz
# 恢复
geo-ctl restore /opt/geo-backup/geo-20261102-023001.db
# 手动校验备份可用性（只读打开并数关键表）
python3 -c "import sqlite3;c=sqlite3.connect('file:/opt/geo-backup/geo-XXXX.db?mode=ro',uri=True);print(c.execute('SELECT COUNT(*) FROM projects').fetchone())"
```

注意：**不要用 `cp geo.db` 做备份** —— WAL 模式下主库文件可能落后于 `-wal`，会得到过期快照。统一走 `geo-ctl backup` / `ops/backup.sh`（sqlite3 backup API）。

## 5. 故障排查 Runbook

| 症状 | 排查 | 处理 |
|---|---|---|
| 页面打不开 / 连接拒绝 | `geo-ctl status`、`ss -tlnp \| grep 3438` | 服务未起 → `geo-ctl start`；端口被占 → 改 `PORT` 或杀占用进程 |
| healthz 200 但页面 5xx | `geo-ctl logs 200` 找 panic | 重启 `geo-ctl restart`；复现则反馈开发（附日志片段） |
| 登录报「邮箱或密码错误」 | 确认账号存在：`python3 -c "import sqlite3;c=sqlite3.connect('<DB>');print(c.execute('SELECT email,lockedUntil FROM users').fetchall())"` | 密码遗忘且唯一账号 → 用 scrypt 重置（见下）；连续失败 5 次锁定 → 清 `failedAttempts/lockedUntil` |
| 登录后跳回登录页 | 浏览器 Cookie 被禁 / 域名变更 | 清 Cookie 重试；反代场景保持 Host 透传 |
| 「数据库锁定」类错误 | `lsof <DB>` 看其他进程 | 备份脚本并发 → 错峰；异常残留连接 → 重启服务 |
| 磁盘 ≥ 85% 告警 | `du -sh /opt/geo-rust/data/uploads /opt/geo-backup` | 清旧备份（脚本自动轮转 14 份）、归档 uploads |
| 备份未生成 | `cat /opt/geo-backup/backup.log` | 多为 python3 缺失或 DB 路径变更；`geo-ctl version` 核对路径 |
| 内存持续增长 | `ps -o rss= -p $(pgrep -f geo-platform)` | 正常峰值 < 100MB；异常增长 → 记录复现步骤并重启反馈 |

**重置 demo 密码（应急，需服务器 root）**：

```bash
python3 - <<'PY'
import sqlite3, hashlib, secrets
DB = "/opt/geo/platform/data/geo.db"     # ← 改为实际 GEO_DB_PATH
c = sqlite3.connect(DB, timeout=10)
salt = secrets.token_hex(16)
h = hashlib.scrypt(b"<新密码>", salt=salt.encode(), n=16384, r=8, p=1, dklen=32, maxmem=64*1024*1024).hex()
c.execute("UPDATE users SET passwordHash=?, salt=?, failedAttempts=0, lockedUntil=NULL WHERE email=?", (h, salt, "demo@geo.local"))
c.commit(); print("done")
PY
```

**清库重建演示数据**：`geo-ctl demo-reset`（自动先备份）。

## 6. 监控与告警

- 探针接入：`GET /healthz`（存活）、`GET /login`（应用层 200）。
- 巡检告警：`ops/monitor.sh`（crontab 每 5 分钟）检查 healthz / systemd / 磁盘 / 备份新鲜度，异常写 `/var/log/geo-alerts.log` 并推送 `ops/alert.env` 里的 `ALERT_WEBHOOK`（企微机器人格式）。
- 关键指标参考：空载 RSS ≈ 10 MB；healthz P99 < 5ms（本机）；构建产物约 7 MB。

## 7. 数据维护备忘

- 审计日志：`backup.sh` 每次运行自动清理 90 天前的 `auditLog`。
- 测试残留清理（对生产库执行写操作测试后）：按公司/项目级联删除 `projects → monitorResults/monitorCheckpoints/monitorTasks/auditRecords/publishTasks/publishAccounts/materials/articles/questions/kbDocuments/knowledgeBases/sourceAssets/reports`，再删 `projects`、`companies`；涉及套餐兑换需还原 `orgs` 的 `planCode/planExpiresAt/quotaMonitorMonthly`。
- 版本确认：`geo-ctl version`（二进制构建时间应与最近一次升级时间一致）。
