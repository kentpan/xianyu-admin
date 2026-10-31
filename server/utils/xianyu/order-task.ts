/**
 * xianyu/order-task — 代理模式任务分发 (后台 → engine_tasks 表 → 代理执行 → 结果回报)。
 *
 * 背景: Cloudflare Pages 出口到闲鱼 mtop 网关 (h5api.m.goofish.com) 被墙, 且代理部署
 * 形态为"主动外呼后台、无公网入站端口" — 后台无法直连代理, 代理也无法被直连。
 * 一切"需要可达闲鱼的机器执行"的工作 (订单拉取 / 手动发送消息 / 付款拉单兜底) 都以
 * 任务行中转: 后台写任务 (pending) → 代理轮询领取 (running) → 本地执行 →
 * events task_result 回报 (done/failed) → 后台轮询行状态取回结果。
 *
 * 为什么不用"后台直连代理 HTTP 透传": 代理部署在面板/内网机器 (无需公网入站是部署
 * 硬约束), CF 后台到代理不连通; 任务通道是等价的透传通道 (代理 3s 任务轮询, 实测
 * 写任务→回报→取回全程 ~1.6s), 且天然幂等可重试。
 *
 * CF serverless 同一动因 (与扫码登录会话落库 qr_login_sessions 相同): 任务行落库,
 * 跨实例/多进程可见, 内存队列不可用。
 */
import type { SellerOrderItem } from './mtop'
import { getDb } from '../db'

export interface ProxyOrdersResult {
  items: SellerOrderItem[]
  errors: string[]
  /** 任务通道是否参与 (代理模式 true); 调用方用于区分直连失败与代理失败。 */
  viaProxy: boolean
}

export interface ProxyTaskResult {
  ok: boolean
  /** 代理回报的业务数据 (done 时解析 result JSON)。 */
  data: Record<string, any>
  /** 失败/超时原因 (errors[0] 可透出到接口响应)。 */
  errors: string[]
}

/** 当前生效引擎是否为独立代理 (非内置)。代理模式下闲鱼 mtop 直连不可用, 必须走任务通道。 */
export async function isProxyEngineMode(db: Awaited<ReturnType<typeof getDb>>): Promise<boolean> {
  try {
    const row = await db.get<{ slug: string }>('SELECT slug FROM engines WHERE is_active = 1 LIMIT 1')
    return !!row && String(row.slug) !== 'builtin'
  } catch {
    return false
  }
}

/** 过期清理: 写入/领取超 120s 仍 pending/running 判 expired (代理中断或无代理在线)。 */
async function sweepStaleTasks(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  await db
    .run(
      `UPDATE engine_tasks SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('pending', 'running')
         AND updated_at < datetime('now', '-120 seconds')`,
    )
    .catch(() => {})
}

/** 任务轮询参数硬上限 (CF 请求预算内)。 */
const TASK_TIMEOUT_CAP_MS = 25_000

/**
 * 通用任务分发: 写任务行 + 轮询等待代理回报 (同步语义, 调用方无感知)。
 * 超时/失败不抛异常 — errors 如实携带原因, data 可能为空。
 */
async function dispatchProxyTask(
  db: Awaited<ReturnType<typeof getDb>>,
  type: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<ProxyTaskResult> {
  const errors: string[] = []
  const waitMs = Math.min(Math.max(timeoutMs, 3_000), TASK_TIMEOUT_CAP_MS)

  const active = await db
    .get<{ id: number; slug: string }>('SELECT id, slug FROM engines WHERE is_active = 1 LIMIT 1')
    .catch(() => null)
  if (!active) return { ok: false, data: {}, errors: ['无生效监听引擎 (代理未激活)'] }

  await sweepStaleTasks(db)
  let taskId = 0
  try {
    const ins = await db.run(
      `INSERT INTO engine_tasks (type, payload, status, engine_id) VALUES (?, ?, 'pending', ?)`,
      [type, JSON.stringify(payload), active.id],
    )
    taskId = Number(ins?.lastInsertId || 0)
  } catch (e: any) {
    return { ok: false, data: {}, errors: [`任务写入失败: ${String(e?.message || e).slice(0, 120)}`] }
  }
  if (!taskId) return { ok: false, data: {}, errors: ['任务写入失败: 未取到任务ID'] }

  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400))
    const row = await db
      .get<{ status: string; result: string }>('SELECT status, result FROM engine_tasks WHERE id = ?', [taskId])
      .catch(() => null)
    if (!row) break
    if (row.status === 'done' || row.status === 'failed') {
      let data: any = null
      try {
        data = row.result ? JSON.parse(String(row.result)) : null
      } catch {
        data = null
      }
      if (row.status === 'failed') {
        const msg = String(data?.error || data?.errors?.[0] || '代理执行失败')
        errors.push(msg)
      }
      await db.run('DELETE FROM engine_tasks WHERE id = ?', [taskId]).catch(() => {})
      return { ok: row.status === 'done', data: data || {}, errors }
    }
    if (row.status === 'expired') {
      await db.run('DELETE FROM engine_tasks WHERE id = ?', [taskId]).catch(() => {})
      return { ok: false, data: {}, errors: ['任务过期 (代理不在线或执行中断), 请重试或检查代理运行状态'] }
    }
    // pending/running → 继续等
  }
  await db.run('DELETE FROM engine_tasks WHERE id = ?', [taskId]).catch(() => {})
  return { ok: false, data: {}, errors: ['任务等待超时 (代理未及时领取/回报), 请重试或检查代理运行状态'] }
}

export interface FetchOrdersTaskOptions {
  /** 卖家订单列表查询码: ALL=全部状态 (一键同步), NOT_SHIP=待发货 (付款拉单兜底)。 */
  queryCode?: 'ALL' | 'NOT_SHIP'
  /** 拉取页数 (每页 30 单, 代理侧逐页 400ms 限速)。 */
  pages?: number
  /** 等待代理回报超时毫秒 (CF 请求预算内: 一键同步 20s / 付款拉单兜底 12s)。 */
  timeoutMs?: number
}

/**
 * 下发 fetch_orders 任务并等待代理回报 (订单列表拉取)。
 * 超时/失败不抛异常 — errors 数组如实携带原因, items 可能为空 (部分页成功时非空)。
 */
export async function fetchOrdersViaProxy(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  opts: FetchOrdersTaskOptions = {},
): Promise<ProxyOrdersResult> {
  const r = await dispatchProxyTask(
    db,
    'fetch_orders',
    { cookie_id: String(cookieId), query_code: opts.queryCode === 'NOT_SHIP' ? 'NOT_SHIP' : 'ALL', pages: Math.min(Math.max(opts.pages || 1, 1), 5) },
    opts.timeoutMs || 20_000,
  )
  const items: SellerOrderItem[] = Array.isArray(r.data?.items) ? r.data.items : []
  const taskErrors: string[] = Array.isArray(r.data?.errors) ? r.data.errors.map(String) : []
  return { items, errors: [...r.errors, ...taskErrors], viaProxy: true }
}

/**
 * 下发 send_message 任务并等待代理回报 (消息管理页手动发送 — 代理模式下内置引擎
 * 未托管该账号, WS 发送只能由长连接所在代理执行)。
 * 返回 { ok, error }: ok=false 时 error 携带代理侧失败原因。
 */
export async function sendTextViaProxy(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  chatId: string,
  toUserId: string,
  text: string,
  timeoutMs = 12_000,
): Promise<{ ok: boolean; error: string }> {
  const r = await dispatchProxyTask(
    db,
    'send_message',
    { cookie_id: String(cookieId), chat_id: String(chatId), to_user_id: String(toUserId), text: String(text || '').slice(0, 2000) },
    timeoutMs,
  )
  if (r.ok) return { ok: true, error: '' }
  const err = String(r.data?.error || r.errors[0] || '代理发送失败')
  return { ok: false, error: err }
}
