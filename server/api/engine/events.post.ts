/**
 * POST /api/engine/events — 远程代理事件上报 + 指令回收 (纯监听转发的数据面)。
 *
 * 鉴权: 标准 `Authorization: Bearer <token>` (engines.token, 逐引擎独立)。
 * 限速: 每令牌令牌桶 120 次/分钟 (突发 40), 超限 429 + Retry-After。
 *
 * 代理只做纯粹的消息监听与转发, 不持有任何业务状态:
 *   - 上报: 账号连接状态 / 风控事件 / 解密后的聊天与交易消息 (转发, 不决策)
 *   - 回收: 本后台大脑 (回复链/发货链) 决策出的动作列表, 代理按 delay_ms 人化执行
 *
 * Body:
 * {
 *   "status": { "accounts": [{ "id": "xy_1", "state": "listening", "detail": "" }] },   // 可选
 *   "events": [
 *     { "type": "chat",   "account": "xy_1", "chat_id", "sender_user_id", "sender_nick",
 *       "content", "item_id", "create_time", "session_type", "is_self" },
 *     { "type": "system", "account": "xy_1", "red_reminder", "item_id", "buyer_id",
 *       "order_id", "chat_id" }
 *   ]
 * }
 * Response: { "actions": [ { "type": "send_text"|"send_image", ... , "delay_ms" } ] }
 */
import { handleChatEvent, handleSystemEvent, type EngineAction } from '../../utils/xianyu/brain'
import { dispatchNotify } from '../../utils/notify'
import { publishChatEvent, publishSystemEvent, publishRiskEvent } from '../../utils/xianyu/publisher'
import { consumeRate } from '../../utils/rate-limit'

export default defineEventHandler(
  withApi(async (event) => {
    const engine = await requireEngine(event)

    const rl = consumeRate(`engine:${engine.id}`, { capacity: 40, perMinute: 120 })
    if (!rl.ok) {
      setHeader(event, 'Retry-After', String(rl.retryAfterSeconds))
      throw new ApiError(429, `事件上报过于频繁, 请 ${rl.retryAfterSeconds}s 后重试`)
    }

    const body = await readBody(event) || {}
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

    for (const ev of events) {
      const account = String(ev?.account || '')
      if (!account) continue
      try {
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
          // 事件发布 (旁路): 转发给订阅项目, 不影响大脑决策
          publishChatEvent(account, parsed, engine.slug)
          actions.push(...(await handleChatEvent(account, parsed, { source: engine.slug })))
        } else if (ev.type === 'system') {
          const parsed = {
            kind: 'system' as const,
            redReminder: String(ev.red_reminder || ''),
            itemId: String(ev.item_id || ''),
            buyerId: String(ev.buyer_id || ''),
            orderId: String(ev.order_id || ''),
            chatId: String(ev.chat_id || ''),
            raw: ev,
          }
          publishSystemEvent(account, parsed, engine.slug)
          actions.push(...(await handleSystemEvent(account, parsed, { source: engine.slug })))
        } else if (ev.type === 'risk') {
          publishRiskEvent(account, String(ev.description || ''), engine.slug)
          // 风控通知 (与内置引擎 persistRisk 同语义, 冷却去重在 notify 内)
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
        }
      } catch (e: any) {
        console.log(`[engine-api] 事件处理失败 (${ev?.type}/${account}): ${e?.message}`)
      }
    }

    await db
      .run(
        'UPDATE engines SET last_seen_at = CURRENT_TIMESTAMP, last_status = ? WHERE id = ?',
        [`events=${events.length} actions=${actions.length}`, engine.id],
      )
      .catch(() => {})

    return ok({ actions })
  }),
)
