/**
 * POST /api/engine/events — 远程代理事件上报 + 指令回收 (纯监听转发的数据面)。
 *
 * 鉴权: 标准 `Authorization: Bearer <token>` (engines.token, 逐引擎独立)。
 * 限速: 每令牌令牌桶 120 次/分钟 (突发 40), 超限 429 + Retry-After。
 *
 * 代理只做纯粹的消息监听与转发, 不持有任何业务状态:
 *   - 上报: 账号连接状态 / 风控事件 / 解密后的聊天与交易消息 / 动作执行结果 (转发, 不决策)
 *   - 回收: 本后台大脑 (回复链/发货链) 决策出的动作列表, 代理按 delay_ms 人化执行
 *
 * 两种决策模式 (按代理版本自动协商):
 *   - 快速 ACK + 拉取 (新版代理, 请求带 `x-engine-pull: 1` 头): 聊天/交易事件先在
 *     engine_event_dedup 原子占位 (pending=1) 立即应答, 大脑决策 (AI 外呼/卡券 API 可达
 *     20~30s) 挂后台执行, 代理按 event_id 轮询 `pull` 回收动作。决策再慢也不会拖垮上报
 *     请求, 消灭「上报超时→回队重试→重复决策」风暴。
 *   - 内联决策 (旧版代理, 无头): 同步算完动作随响应返回 (原语义不变, 完全兼容)。
 *
 * 幂等: 事件带 event_id 以 engine_event_dedup 表去重 — 首次处理即固化决策动作,
 * 重试/重报原样重放 (不重算决策、不重复执行)。占位后 3 分钟仍无决策结果 (进程中断)
 * 则释放占位, 代理收到 expired 后重报自愈。
 *
 * Body:
 * {
 *   "status": { "accounts": [{ "id": "xy_1", "state": "listening", "detail": "" }] },   // 可选
 *   "events": [
 *     { "type": "chat",   "account": "xy_1", "event_id", "chat_id", "sender_user_id", "sender_nick",
 *       "content", "item_id", "create_time", "session_type", "is_self" },
 *     { "type": "system", "account": "xy_1", "event_id", "red_reminder", "item_id", "buyer_id",
 *       "order_id", "chat_id" },
 *     { "type": "risk",   "account": "xy_1", "event_id", "description" },
 *     { "type": "action_result", "account": "xy_1", "log_id", "ok", "error" },
 *     { "type": "task_result", "task_id", "ok", "data" }   // engine_tasks 通道回报
 *   ],
 *   "pull": ["evt_1", ...]   // 新版代理: 拉取这些事件的决策结果 (快速 ACK 模式的回收通道)
 * }
 * Response: { "actions": [...], "pending": ["evt_2"], "expired": ["evt_3"] }
 */
import type { H3Event } from 'h3'
import { handleChatEvent, handleSystemEvent, type EngineAction } from '../../utils/xianyu/brain'
import { persistChatMessage, persistSystemMessage, persistOutgoingMessage } from '../../utils/xianyu/im-store'
import { dispatchNotify } from '../../utils/notify'
import { publishChatEvent, publishSystemEvent, publishRiskEvent } from '../../utils/xianyu/publisher'
import { consumeRate } from '../../utils/rate-limit'

/** 占位超时: 决策挂后台后超过此时长仍无结果视为进程中断, 释放占位由代理重报自愈 */
const PENDING_TTL_MS = 3 * 60_000

/** 后台决策整体超时预算 (v2.1.6): 兜底任何未知挂起点 (网关+任务+直连全超时/外部 API 卡死),
 *  必须 < PENDING_TTL_MS — 保证代理在本预算内拿到失效信号重报自愈, 而不是黑箱等满 3 分钟。 */
const DECISION_BUDGET_MS = 150_000

export default defineEventHandler(
  withApi(async (event) => {
    const engine = await requireEngine(event)

    const rl = consumeRate(`engine:${engine.id}`, { capacity: 40, perMinute: 120 })
    if (!rl.ok) {
      setHeader(event, 'Retry-After', String(rl.retryAfterSeconds))
      throw new ApiError(429, `事件上报过于频繁, 请 ${rl.retryAfterSeconds}s 后重试`)
    }

    const body = await readBody(event) || {}

    // 新版代理的决策结果拉取通道 (快速 ACK 模式的回收)
    if (Array.isArray(body.pull) && body.pull.length) {
      const pullIds = body.pull.slice(0, 100).map((v: any) => String(v || '').slice(0, 80)).filter(Boolean)
      if (pullIds.length) return ok(await pullDecisionActions(event, engine, pullIds))
    }

    const events: any[] = Array.isArray(body.events) ? body.events.slice(0, 100) : []
    const actions: EngineAction[] = []

    // 多引擎互斥鉴权门控: 非使用中引擎 (备用状态) 的事件一律不处理不发布,
    // 防止备用代理绕过 config 门控上报事件引发重复回复/风控雪崩。
    if (!engine.is_active) {
      return ok({ actions: [], standby: true })
    }

    const db = await getDb()

    // 状态上报 → cookies/engines 心跳回写
    const statusAccounts: any[] = body?.status?.accounts || []
    for (const acc of statusAccounts.slice(0, 200)) {
      if (!acc?.id) continue
      await db
        .run('UPDATE cookies SET cookie_status_text = ?, last_check_at = CURRENT_TIMESTAMP WHERE id = ?', [
          String(acc.state || 'connecting').slice(0, 32),
          String(acc.id),
        ])
        .catch(() => {})
      // 登录态失效 (与内置引擎 onCookieInvalid 同语义): 通知用户重新扫码, 否则监听静默死亡
      if (String(acc.state) === 'need_relogin') {
        dispatchNotify({
          type: 'cookie_invalid',
          cookieId: String(acc.id),
          title: '登录态失效 · 请重新扫码',
          fields: {
            详情: String(acc.detail || 'Session 过期').slice(0, 200),
            影响: '该账号监听已停止, 消息无法收发',
            处理: '在「账号管理」页对该账号重新扫码登录即可自动恢复监听',
          },
          link: '/accounts',
        })
      }
    }

    // 快速 ACK 模式: 新版代理声明拉取能力 → 决策挂后台; 旧版代理 → 内联决策 (原语义)
    const pullMode = (getHeader(event, 'x-engine-pull') || '') === '1'
    const pending: string[] = []

    for (const ev of events) {
      // ---- 任务执行结果回报 (engine_tasks 通道): fetch_orders 等代理侧执行的落库任务 ----
      // (必须在 account 守卫之前: task_result 不携带账号且不走去重/决策链)
      if (ev.type === 'task_result') {
        const taskId = Number(ev.task_id || 0)
        if (taskId > 0) {
          const resultJson = JSON.stringify(ev.data ?? {}).slice(0, 500_000)
          await db
            .run(
              `UPDATE engine_tasks SET result = ?, status = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND status IN ('pending', 'running')`,
              [resultJson, ev.ok ? 'done' : 'failed', taskId],
            )
            .catch(() => {})
        }
        continue
      }

      const account = String(ev?.account || '')
      if (!account) continue
      try {
        // 动作执行结果回报: 代理按 log_id 回写发送结果, 决策日志的发送状态由此闭环
        if (ev.type === 'action_result') {
          const logId = Number(ev.log_id || 0)
          if (logId > 0) {
            await db
              .run('UPDATE auto_reply_logs SET send_status = ?, error_message = ? WHERE id = ?', [
                ev.ok ? 'success' : 'failed',
                String(ev.error || '').slice(0, 300),
                logId,
              ])
              .catch(() => {})
            // 发送成功 → 出站消息落库 (代理链路与内置引擎 executeActions 同语义, 消息页可见回复内容)
            if (ev.ok) {
              const logRow = await db
                .get<{ cookie_id: string; chat_id: string; sender_user_id: string; reply_text: string }>(
                  'SELECT cookie_id, chat_id, sender_user_id, reply_text FROM auto_reply_logs WHERE id = ?',
                  [logId],
                )
                .catch(() => null)
              if (logRow?.chat_id && logRow.reply_text) {
                void persistOutgoingMessage(logRow.cookie_id || account, logRow.chat_id, logRow.sender_user_id || '', logRow.reply_text, 'text')
              }
            }
          }
          continue
        }

        // ---- 任务执行结果回报 (engine_tasks 通道): 已前移至 account 守卫之前 (task_result 不带账号) ----
        if (ev.type !== 'chat' && ev.type !== 'system' && ev.type !== 'risk') continue

        // 风控事件轻量 (无外呼决策), 内联处理
        if (ev.type === 'risk') {
          publishRiskEvent(account, String(ev.description || ''), engine.slug)
          dispatchNotify({
            type: 'risk',
            cookieId: account,
            title: '风控触发 · 监听进入冷却',
            fields: {
              原因: String(ev.description || '').slice(0, 300),
              处理: '已自动进入冷却期, 冷却结束后自动重连 (无需人工干预)',
            },
            link: '/listener',
          })
          await db
            .run(
              `INSERT INTO risk_control_logs (cookie_id, event_type, event_description, processing_result, processing_status)
               VALUES (?, 'token_captcha', ?, '代理已进入风控冷却', 'handled')`,
              [account, String(ev.description || '').slice(0, 500)],
            )
            .catch(() => {})
          continue
        }

        const eventId = String(ev.event_id || '').slice(0, 80)

        // ---- 快速 ACK 模式: 原子占位 + 后台决策, 代理按 event_id 拉取回收 ----
        if (pullMode && eventId) {
          const claimSql = "INSERT OR IGNORE INTO engine_event_dedup (event_id, actions_json, pending) VALUES (?, '', 1)"
          let claim = await db.run(claimSql, [eventId]).catch(() => ({ changes: 0 }))
          if (claim.changes === 0) {
            const seen = await db
              .get<{ actions_json: string }>('SELECT actions_json FROM engine_event_dedup WHERE event_id = ?', [eventId])
              .catch(() => null)
            if (seen?.actions_json) {
              actions.push(...parseActions(seen.actions_json))
              continue
            }
            if (seen) {
              pending.push(eventId) // 决策仍在后台进行
              continue
            }
            // 占位行不存在 (例行清理恰好清掉): 重新占位
            claim = await db.run(claimSql, [eventId]).catch(() => ({ changes: 0 }))
          }
          if (claim.changes > 0) {
            runDetached(event, decideInBackground(db, engine, ev, account, eventId))
            pending.push(eventId)
          }
          continue
        }

        // ---- 内联决策 (旧版代理/无 event_id): 同步算完随响应返回 ----
        if (eventId) {
          const seen = await db
            .get<{ actions_json: string }>('SELECT actions_json FROM engine_event_dedup WHERE event_id = ?', [eventId])
            .catch(() => null)
          if (seen) {
            actions.push(...parseActions(seen.actions_json))
            continue
          }
        }
        const eventActions = await decideEvent(db, engine, ev, account)
        if (eventId) {
          await db
            .run('INSERT OR IGNORE INTO engine_event_dedup (event_id, actions_json, pending) VALUES (?, ?, 0)', [
              eventId,
              JSON.stringify(eventActions),
            ])
            .catch(() => {})
          if (Math.random() < 0.02) {
            await db
              .run("DELETE FROM engine_event_dedup WHERE created_at < datetime('now', '-2 days')")
              .catch(() => {})
          }
        }
        actions.push(...eventActions)
      } catch (e: any) {
        console.log(`[engine-api] 事件处理失败 (${ev?.type}/${account}): ${e?.message}`)
      }
    }

    await touchEngine(db, event, engine, `events=${events.length} pending=${pending.length} actions=${actions.length}`)
    markDelivered(db, actions)

    return ok({ actions, pending })
  }),
)

/* ----------------------- 快速 ACK 模式: 后台决策与拉取回收 ----------------------- */

/** 单个 chat/system 事件的大脑决策 (事件发布 + 消息落库 + 回复/发货链), 内联与后台共用 */
async function decideEvent(
  db: Awaited<ReturnType<typeof getDb>>,
  engine: { slug: string },
  ev: any,
  account: string,
): Promise<EngineAction[]> {
  if (ev.type === 'chat') {
    const parsed = {
      kind: 'chat' as const,
      chatId: String(ev.chat_id || ''),
      senderUserId: String(ev.sender_user_id || ''),
      senderNick: String(ev.sender_nick || '未知用户'),
      content: String(ev.content || ''),
      itemId: String(ev.item_id || ''),
      createTime: Number(ev.create_time || 0),
      sessionType: String(ev.session_type || '1'),
      isSelf: !!ev.is_self,
      raw: ev,
    }
    // 事件发布 (旁路): 转发给订阅项目; IM 会话/消息落库 (与内置引擎 onChat 同源, 消息页实时可见)
    publishChatEvent(account, parsed, engine.slug)
    void persistChatMessage(account, parsed)
    return handleChatEvent(account, parsed, { source: engine.slug })
  }
  const parsed = {
    kind: 'system' as const,
    redReminder: String(ev.red_reminder || ''),
    itemId: String(ev.item_id || ''),
    buyerId: String(ev.buyer_id || ''),
    orderId: String(ev.order_id || ''),
    chatId: String(ev.chat_id || ''),
    cardTitle: '',
    amount: '',
    raw: ev,
  }
  publishSystemEvent(account, parsed, engine.slug)
  void persistSystemMessage(account, parsed)
  return handleSystemEvent(account, parsed, { source: engine.slug })
}

/** 后台决策任务: 完成后固化动作到占位行 (代理拉取回收); 失败释放占位由代理重报自愈 */
async function decideInBackground(
  db: Awaited<ReturnType<typeof getDb>>,
  engine: { slug: string },
  ev: any,
  account: string,
  eventId: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const decided = await Promise.race([
      decideEvent(db, engine, ev, account),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`决策整体超时 (${Math.round(DECISION_BUDGET_MS / 1000)}s)`)), DECISION_BUDGET_MS)
      }),
    ])
    await db
      .run('UPDATE engine_event_dedup SET actions_json = ?, pending = 0 WHERE event_id = ?', [
        JSON.stringify(decided),
        eventId,
      ])
      .catch(() => {})
  } catch (e: any) {
    console.log(`[engine-api] 后台决策失败 (${ev?.type}/${account}): ${e?.message}`)
    // 决策日志留痕 (v2.1.6): 决策挂死/失败不再黑箱 — 回复日志页可见 decision_timeout,
    // 付款/回复卡住有据可查; 占位释放后代理重报自愈 (发货/回复均有业务层防重, 重试安全)
    if (ev?.type === 'chat' || ev?.type === 'system') {
      await db
        .run(
          `INSERT INTO auto_reply_logs
           (cookie_id, chat_id, item_id, sender_user_id, sender_user_name, source_message,
            process_status, decision_reason, reply_strategy, matched_keyword, reply_text, error_message, send_status)
           VALUES (?, ?, ?, ?, ?, ?, 'skipped', 'decision_timeout', 'none', '', '', ?, 'unknown')`,
          [
            account,
            String(ev.chat_id || ''),
            String(ev.item_id || ''),
            String(ev.sender_user_id || ev.buyer_id || ''),
            String(ev.sender_nick || ''),
            String(ev.content || ev.red_reminder || '').slice(0, 500),
            `决策超时或失败: ${String(e?.message || '').slice(0, 200)}`,
          ],
        )
        .catch(() => {})
    }
    await db.run("DELETE FROM engine_event_dedup WHERE event_id = ? AND actions_json = ''", [eventId]).catch(() => {})
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 新版代理的决策结果拉取: 已完成→重放动作; 进行中→保持 pending; 占位超时→expired 由代理重报 */
async function pullDecisionActions(
  event: H3Event,
  engine: { id: number; is_active: number },
  ids: string[],
): Promise<{ actions: EngineAction[]; pending: string[]; expired: string[] }> {
  if (!engine.is_active) {
    return { actions: [], pending: [], expired: [] }
  }
  const db = await getDb()
  const actions: EngineAction[] = []
  const pending: string[] = []
  const expired: string[] = []
  for (const eventId of ids) {
    const row = await db
      .get<{ actions_json: string; created_at: string }>(
        'SELECT actions_json, created_at FROM engine_event_dedup WHERE event_id = ?',
        [eventId],
      )
      .catch(() => null)
    if (!row) {
      expired.push(eventId)
      continue
    }
    if (row.actions_json) {
      actions.push(...parseActions(row.actions_json))
      continue
    }
    const created = Date.parse(String(row.created_at || '').includes('T') || String(row.created_at || '').includes('Z')
      ? String(row.created_at)
      : `${String(row.created_at).replace(' ', 'T')}Z`)
    if (Date.now() - (Number.isFinite(created) ? created : 0) > PENDING_TTL_MS) {
      await db.run("DELETE FROM engine_event_dedup WHERE event_id = ? AND actions_json = ''", [eventId]).catch(() => {})
      expired.push(eventId)
    } else {
      pending.push(eventId)
    }
  }
  await touchEngine(db, event, engine, `pull=${ids.length} pending=${pending.length} actions=${actions.length}`)
  markDelivered(db, actions)
  return { actions, pending, expired }
}

function parseActions(json: string): EngineAction[] {
  try {
    const stored = JSON.parse(json || '[]')
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

/** 后台任务挂载: CF Workers 用 waitUntil 保活 (响应返回后继续执行), Node 直接执行 */
function runDetached(event: H3Event, task: Promise<void>): void {
  const cf: any = (event.context as any)?.cloudflare
  const waitUntil: ((p: Promise<any>) => void) | undefined =
    cf?.context?.waitUntil?.bind(cf.context) ?? cf?.waitUntil?.bind(cf)
  if (waitUntil) waitUntil(task.catch(() => {}))
  else void task
}

async function touchEngine(
  db: Awaited<ReturnType<typeof getDb>>,
  event: H3Event,
  engine: { id: number },
  status: string,
): Promise<void> {
  await db
    .run('UPDATE engines SET last_seen_at = CURRENT_TIMESTAMP, last_status = ?, last_poll_ip = ? WHERE id = ?', [
      status,
      enginePollIp(event),
      engine.id,
    ])
    .catch(() => {})
}

/** 动作已随响应/拉取投递给代理 → 决策日志标记「已下发」(代理回报后升级为已发送/发送失败) */
async function markDelivered(db: Awaited<ReturnType<typeof getDb>>, actions: EngineAction[]): Promise<void> {
  const deliveredLogIds = [...new Set(actions.map((a) => Number((a as any).log_id || 0)).filter((v) => v > 0))]
  if (deliveredLogIds.length) {
    await db
      .run(
        `UPDATE auto_reply_logs SET send_status = 'sent' WHERE send_status = 'pending' AND id IN (${deliveredLogIds.map(() => '?').join(',')})`,
        deliveredLogIds,
      )
      .catch(() => {})
  }
}
