/**
 * POST /api/engine/orders-sync — 代理定时触发的订单自动同步 (v2.2.5: 拉全部状态订单)。
 *
 * 背景: 内置引擎 (自托管 Node) 时代, engine-manager orderSyncTick 每 30 分钟按
 * NOT_SHIP 每账号拉 1 页待发货订单入库 — 新单自动到账的核心通道。上 CF Pages 后
 * 内置引擎不启动 (serverless 无长驻进程), 该通道断供, 新订单只能靠手动一键同步。
 *
 * 恢复方式 (v2.1.12): 唯一的长驻进程 = 独立代理。代理按后台下发的
 * intervals.order_sync_seconds 定时 POST 本端点 (Bearer 引擎令牌), 后台收到触发后
 * 走既有任务通道 (dispatchProxyTask http_fetch → 代理转发 → 后台解析入库) 完成
 * 全状态订单拉单 — 代理零解析不变, 解析/入库主权 100% 在后台。
 *
 * v2.2.5: queryCode 由 NOT_SHIP 改为 ALL (订单管理「闲鱼趋势」需要全状态数据);
 * 待发货订单仍包含其中, 新单自动到账/自动发货兜底链路语义不变 (超集拉取)。
 *
 * 鉴权: 标准 Authorization: Bearer <token> (requireEngine, 与 /api/engine/* 同源)。
 * 仅「使用中」(is_active=1) 引擎可触发; 并发触发以进程内闸门防重 (CF 多隔离实例下
 * 极端双触发也只是幂等 upsert, 无害)。
 */
import { fetchOrdersViaProxy } from '../../utils/xianyu/order-task'
import { upsertSoldOrders } from '../../utils/xianyu/order-sync'
import { cookieIdentityMismatch } from '../../utils/xianyu/mtop'
import { consumeRate } from '../../utils/rate-limit'

let inFlight = false

export default defineEventHandler(
  withApi(async (event) => {
    const engine = await requireEngine(event)

    const rl = consumeRate(`engine-sync:${engine.id}`, { capacity: 10, perMinute: 6 })
    if (!rl.ok) {
      setHeader(event, 'Retry-After', String(rl.retryAfterSeconds))
      throw new ApiError(429, `订单同步触发过于频繁, 请 ${rl.retryAfterSeconds}s 后重试`)
    }

    if (!engine.is_active) {
      return ok({ skipped: 'standby' }, '当前引擎非使用中, 跳过订单同步')
    }
    if (inFlight) {
      return ok({ skipped: 'in_flight' }, '上一轮订单同步仍在进行, 跳过本次触发')
    }
    inFlight = true
    try {
      const db = await getDb()
      const accounts = await db
        .all<{ id: string; value: string }>(
          "SELECT id, value FROM cookies WHERE value IS NOT NULL AND value != ''",
        )
        .catch(() => [] as { id: string; value: string }[])

      let inserted = 0
      let updated = 0
      let blocked = 0
      let skippedDeleted = 0
      const errors: string[] = []
      const synced: string[] = []

      for (const acct of accounts) {
        // 会话身份校验 (与一键同步同源): 防串号 Cookie 拉入他人订单
        const mismatch = cookieIdentityMismatch(String(acct.id), String(acct.value || ''))
        if (mismatch) {
          errors.push(`${acct.id}: ${mismatch.slice(0, 120)}`)
          continue
        }
        const r = await fetchOrdersViaProxy(db, String(acct.id), {
          queryCode: 'ALL',
          pages: 2,
          timeoutMs: 25_000,
        })
        if (r.errors.length) errors.push(`${acct.id}: ${r.errors.join('; ').slice(0, 200)}`)
        if (r.items.length) {
          const ur = await upsertSoldOrders(db, String(acct.id), r.items)
          inserted += ur.inserted
          updated += ur.updated
          blocked += ur.blocked
          skippedDeleted += ur.skippedDeleted
          synced.push(String(acct.id))
        }
      }

      return ok(
        {
          accounts: accounts.length,
          synced_accounts: synced,
          inserted,
          updated,
          blocked,
          skipped_deleted: skippedDeleted,
          errors,
        },
        inserted ? `全状态订单自动同步: 新增 ${inserted}, 更新 ${updated}` : '全状态订单自动同步完成 (无新单)',
      )
    } finally {
      inFlight = false
    }
  }),
)
