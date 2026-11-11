# prisma/ 目录 — 数据库文件与 SQL 结构真源

> v2.3.13 建立本规则。此前版本曾缺失本文件（文档债），本文件由 v2.3.13 会话补齐。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `xianyu_admin.db` | 运行库（SQLite）。`XY_DATABASE_URL=file:...` 可覆盖路径/库名。运行期由 `server/utils/schema.ts` 的 initSchema 自动建表/迁移/种子，禁止手工 ALTER。 |
| `xianyu_admin.db-wal` / `-shm` | SQLite WAL 边车。**换库必删**（孤儿 WAL 重放旧页面 = "database disk image is malformed" 的根因，v2.3.12 起运行时自动隔离 + deploy.sh 晋升式部署双防线）。 |
| `d1-schema.sql` | Cloudflare D1 生产库结构真源（CREATE TABLE / INDEX / TRIGGER 全量幂等 DDL）。**schema 变更必须与本文件同步**。 |
| `seed.sql` | D1 初始种子数据。 |
| `xianyu-admin-YYYYMMDD.sql` | 全量备份 dump（CREATE TABLE + INSERT）。导入到空库即完整还原。 |

## Schema 变更规则（版本化）

1. **唯一真源**：`server/utils/schema.ts` 的 `SCHEMA` / `MIGRATIONS` / `DEFAULT_SETTINGS`。任何表/索引/列变更先改这里。
2. **同步 D1**：变更必须镜像到 `prisma/d1-schema.sql`（表定义进表区，索引按字母序进尾部索引区）。
3. **标注版本**：新增语句加 `(v2.3.x)` 前缀注释，说明动机（根因，非补丁）。
4. **自动落地**：`initSchema` 靠 `schema_fingerprint`（SCHEMA+MIGRATIONS+种子的哈希）检测变更——指纹变化即触发全量 `CREATE ... IF NOT EXISTS` 幂等补齐，无需手工迁移脚本。
5. **计数器/派生表**：涉及派生数据（如 `user_notification_state`）必须同时定义存量回填（initSchema 内幂等 `INSERT OR IGNORE ... SELECT`）并覆盖**全部**写入点，缺一处即漂移。
6. **打包前自查**：schema.ts ↔ d1-schema.sql 逐条对齐；`node:sqlite` 打开运行库跑 `PRAGMA integrity_check`；确认 `.db-wal`/`-shm` 不入包。

## 版本记录

- **v2.3.13**：
  - `in_app_notifications` 新增索引 `idx_inapp_user_created(user_id, created_at)` — 铃铛每 60s 轮询的列表查询原为全表扫描，云端行读取超日限额。
  - 新增表 `user_notification_state(user_id PK, total, unread, updated_at)` — unread/total 计数器（写点：notify.ts / seed.post.ts / read.post.ts 同笔维护；存量库 initSchema 一次性回填），替代每次轮询两条 `COUNT(*)` 全表扫描。
