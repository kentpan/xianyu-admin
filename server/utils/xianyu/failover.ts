/**
 * xianyu/failover — 监听所有权仲裁 (v2.3.2 双连接根治)。
 *
 * 背景: 同一账号可能同时被「独立代理」与「内置引擎」两类进程建立闲鱼长连接 —
 * 双设备指纹 + 双出口 IP, 平台风控直接判「环境异常, 重新登录 + 人脸核验」。
 * 根治方式 = 所有权唯一真源: engine_failover 表单行 owner 字段,
 *   - 'remote'  = 代理持有授权 (/api/engine/config 对代理返回 active=true)
 *   - 'builtin' = 内置引擎持有授权 (config 返回 active=false, 代理 ≤30s 退避)
 * 写入方只有本后台自身 (engine-manager 接管/交回 + activate 切换), 读取方为
 * config 接口 (授权裁决) — 代理无需任何感知, 旧版代理天然兼容。
 */
import type { DatabaseAdapter } from '../db'

export const FAILOVER_REMOTE = 'remote'
export const FAILOVER_BUILTIN = 'builtin'
export type FailoverOwner = typeof FAILOVER_REMOTE | typeof FAILOVER_BUILTIN

/** 读当前所有权 (行缺失时原子补种为 remote — 幂等)。 */
export async function getFailoverOwner(db: DatabaseAdapter): Promise<FailoverOwner> {
  try {
    const row = await db.get<{ owner: string }>('SELECT owner FROM engine_failover WHERE id = 1')
    if (row?.owner === FAILOVER_BUILTIN) return FAILOVER_BUILTIN
    if (row?.owner === FAILOVER_REMOTE) return FAILOVER_REMOTE
  } catch {
    /* 表未就绪: 视为 remote (保守 — 不吊销代理授权) */
  }
  try {
    await db.run("INSERT OR IGNORE INTO engine_failover (id, owner) VALUES (1, 'remote')")
  } catch {
    /* 下轮重试 */
  }
  return FAILOVER_REMOTE
}

/** 写所有权 (仅在值变化时落库, 巡检高频调用零写放大)。 */
export async function setFailoverOwner(db: DatabaseAdapter, owner: FailoverOwner): Promise<void> {
  const current = await getFailoverOwner(db).catch(() => FAILOVER_REMOTE)
  if (current === owner) return
  // 可移植写法 (SQLite/MySQL/D1 通用): 行已由 getFailoverOwner 幂等补种, 直接 UPDATE
  await db
    .run('UPDATE engine_failover SET owner = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [owner])
    .catch(() => {})
}
