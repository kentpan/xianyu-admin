/**
 * GET /api/engine/tasks — 远程代理任务领取 (独立代理模式数据面)。
 *
 * 通道: 独立代理模式下, CF Pages 出口无法直连闲鱼 mtop 网关 (h5api 被墙),
 * 订单拉取等"需可达闲鱼的机器执行"的工作以 engine_tasks 任务行中转:
 * 后台写任务 (pending) → 代理本端点领取 (pending→running) → 本地执行 →
 * POST /api/engine/events {type:'task_result', task_id, ok, data} 回报。
 *
 * 鉴权: 标准 `Authorization: Bearer <token>` (与 /api/engine/* 同源, requireEngine)。
 * 限速: 代理轮询 3s/次, 20 次/分钟, 在 events 同级令牌桶内余量充足, 不另设。
 * 领取语义: 只下发本引擎 (engine_id 匹配) 且未过期的 pending 任务, 领取即置 running
 * (updated_at 刷新作过期基线); 同一任务不会被并发领取 (UPDATE ... WHERE status='pending')。
 */
import { requireEngine } from '../../utils/engine-auth'

export default defineEventHandler(
  withApi(async (event) => {
    const engine = await requireEngine(event)
    const db = await getDb()

    // 过期清理: 写入/领取超 120s 仍 pending/running 判 expired (代理中断/无代理在线)
    await db
      .run(
        `UPDATE engine_tasks SET status = 'expired', updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('pending', 'running')
           AND updated_at < datetime('now', '-120 seconds')`,
      )
      .catch(() => {})

    // 原子领取: 先查候选再逐条 CAS 置 running (SQLite/D1 无 RETURNING 多行兼容写法,
    // 代理单实例轮询下竞争窗口极小; CAS 保证幂等, 双领不可能)
    const candidates = await db
      .all<{ id: number; type: string; payload: string }>(
        `SELECT id, type, payload FROM engine_tasks
         WHERE status = 'pending' AND engine_id = ? AND updated_at >= datetime('now', '-120 seconds')
         ORDER BY id ASC LIMIT 10`,
        [engine.id],
      )
      .catch(() => [])

    const tasks: { id: number; type: string; payload: string }[] = []
    for (const c of candidates) {
      const r = await db
        .run(
          `UPDATE engine_tasks SET status = 'running', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'pending'`,
          [c.id],
        )
        .catch(() => null)
      if (r && Number(r.changes) > 0) tasks.push({ id: Number(c.id), type: String(c.type), payload: String(c.payload || '') })
    }

    return ok({ tasks, active: engine.is_active === 1 })
  }),
)
