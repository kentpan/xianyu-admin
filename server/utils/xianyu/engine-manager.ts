/**
 * xianyu/engine-manager — 内置监听引擎调度器 (与后台同进程, 默认引擎)。
 *
 * 职责:
 *   - 每 5s 门控巡检: engines.is_active === builtin 才服务; 切到远程代理时自动停全部账号 (互斥防重复回复)
 *   - 账号对齐: cookies ∩ cookie_status.enabled → 建/停/热换 XianyuAccountClient (device_id 持久化, 风控指纹稳定)
 *   - 每 10s 心跳回写: engines.last_seen_at (内置行) + cookies.cookie_status_text/last_check_at
 *   - 事件 → brain 决策 → 动作执行 (发文本/发图片)
 */
import crypto from 'node:crypto'
import { getDb } from '../db'
import { XianyuAccountClient, type AccountState, type ManualTokenOutcome } from './ws-client'
import { generateDeviceId, transCookies, type ParsedChatMessage, type ParsedSystemMessage } from './protocol'
import { fetchItemList, polishItem, fetchOrderDetail } from './mtop'
import { handleChatEvent, handleSystemEvent, type EngineAction } from './brain'
import { dispatchNotify } from '../notify'
import { publishChatEvent, publishSystemEvent, publishRiskEvent } from './publisher'
import { persistChatMessage, persistSystemMessage, persistOutgoingMessage } from './im-store'

const POLL_INTERVAL_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 10_000
const ITEM_SYNC_MIN_INTERVAL_S = 60
/** 擦亮/订单同步的门控巡检周期 (每 5 分钟读一次设置, 由各自 interval 决定是否真正执行)。 */
const MAINTENANCE_TICK_MS = 5 * 60_000

interface EngineRuntime {
  pollTimer: NodeJS.Timeout | null
  heartbeatTimer: NodeJS.Timeout | null
  itemSyncTimer: NodeJS.Timeout | null
  polishTimer: NodeJS.Timeout | null
  orderSyncTimer: NodeJS.Timeout | null
  clients: Map<string, XianyuAccountClient>
  /** 缓存账号 Cookie 串, 变更时热替换 */
  cookieCache: Map<string, string>
  standby: boolean
  starting: boolean
  itemSyncRunning: boolean
  polishRunning: boolean
  orderSyncRunning: boolean
}

const g = globalThis as any
if (!g.__xianyuEngineRuntime) {
  g.__xianyuEngineRuntime = {
    pollTimer: null,
    heartbeatTimer: null,
    itemSyncTimer: null,
    polishTimer: null,
    orderSyncTimer: null,
    clients: new Map(),
    cookieCache: new Map(),
    standby: true,
    starting: false,
    itemSyncRunning: false,
    polishRunning: false,
    orderSyncRunning: false,
  } as EngineRuntime
}
const runtime = g.__xianyuEngineRuntime as EngineRuntime

export function isBuiltinEngineRunning(): boolean {
  return !runtime.standby && runtime.clients.size >= 0 && !runtime.starting && runtime.pollTimer !== null
}

export function managedAccountCount(): number {
  return runtime.clients.size
}

/** 外部模块 (验证代理/手动 token) 合并 Cookie 后同步引擎运行时缓存与在线客户端。 */
export function applyExternalCookieUpdate(cookieId: string, mergedStr: string): void {
  runtime.cookieCache.set(cookieId, mergedStr)
  runtime.clients.get(cookieId)?.setCookieStr(mergedStr)
}

/**
 * 手动获取 IM token: 账号由内置引擎托管时走在线客户端 (状态一致)。
 * 返回 null = 当前无在线客户端, 调用方自行独立实调。
 */
export async function manualTokenForAccount(cookieId: string): Promise<ManualTokenOutcome | null> {
  const client = runtime.clients.get(cookieId)
  if (!client) return null
  return client.manualTokenFetch()
}

/** 启动调度器 (Nitro plugin 调用, 幂等)。 */
export function startBuiltinEngineSupervisor(): void {
  if (runtime.pollTimer) return
  runtime.pollTimer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS)
  runtime.heartbeatTimer = setInterval(() => void heartbeatOnce(), HEARTBEAT_INTERVAL_MS)
  runtime.itemSyncTimer = setInterval(() => void itemSyncTick(), ITEM_SYNC_MIN_INTERVAL_S * 1000)
  runtime.polishTimer = setInterval(() => void polishTick(), MAINTENANCE_TICK_MS)
  runtime.orderSyncTimer = setInterval(() => void orderSyncTick(), MAINTENANCE_TICK_MS)
  void pollOnce()
  console.log('[xianyu-engine] 内置监听引擎调度器已启动 (5s 门控巡检 / 10s 心跳 / 60s 商品同步门控 / 5min 擦亮·订单同步门控)')
}

export function stopBuiltinEngineSupervisor(): void {
  if (runtime.pollTimer) clearInterval(runtime.pollTimer)
  if (runtime.heartbeatTimer) clearInterval(runtime.heartbeatTimer)
  if (runtime.itemSyncTimer) clearInterval(runtime.itemSyncTimer)
  if (runtime.polishTimer) clearInterval(runtime.polishTimer)
  if (runtime.orderSyncTimer) clearInterval(runtime.orderSyncTimer)
  runtime.pollTimer = null
  runtime.heartbeatTimer = null
  runtime.itemSyncTimer = null
  runtime.polishTimer = null
  runtime.orderSyncTimer = null
  for (const client of runtime.clients.values()) void client.stop()
  runtime.clients.clear()
  runtime.cookieCache.clear()
  console.log('[xianyu-engine] 内置监听引擎调度器已停止')
}

/* ---------------------------------- 门控巡检 ---------------------------------- */

async function pollOnce(): Promise<void> {
  let db
  try {
    db = await getDb()
  } catch {
    return // 库未就绪, 下轮重试
  }
  try {
    const active = await db.get<any>('SELECT slug, type FROM engines WHERE is_active = 1 LIMIT 1')
    const builtinActive = active?.slug === 'builtin'

    if (!builtinActive) {
      // 当前使用远程代理: 内置引擎全部账号下线 (多引擎互斥)
      if (!runtime.standby) {
        for (const client of runtime.clients.values()) await client.stop()
        runtime.clients.clear()
        runtime.cookieCache.clear()
        runtime.standby = true
        await db
          .run(
            "UPDATE engines SET last_status = 'standby', updated_at = CURRENT_TIMESTAMP WHERE slug = 'builtin'",
          )
          .catch(() => {})
        console.log('[xianyu-engine] 当前引擎为远程代理, 内置引擎转入待命 (账号已全部下线)')
      }
      return
    }

    runtime.standby = false

    // 待监听账号 = 启用的 cookies
    const accounts = await db.all<any>(
      `SELECT c.id, c.value, c.device_id FROM cookies c
       LEFT JOIN cookie_status cs ON cs.cookie_id = c.id
       WHERE COALESCE(cs.enabled, 1) = 1`,
    )
    const wanted = new Map(accounts.map((a) => [a.id, a]))

    // 停掉已禁用/已删除的账号
    for (const [id, client] of [...runtime.clients]) {
      if (!wanted.has(id)) {
        await client.stop()
        runtime.clients.delete(id)
        runtime.cookieCache.delete(id)
      }
    }

    for (const account of accounts) {
      const existing = runtime.clients.get(account.id)
      if (existing) {
        if (runtime.cookieCache.get(account.id) !== account.value) {
          existing.setCookieStr(account.value)
          runtime.cookieCache.set(account.id, account.value)
          console.log(`[xianyu-engine] 账号 ${account.id} Cookie 已更新, 热替换生效`)
        }
        continue
      }
      createClient(db, account)
    }
  } catch (e: any) {
    console.log(`[xianyu-engine] 巡检异常: ${e?.message}`)
  }
}

function createClient(db: Awaited<ReturnType<typeof getDb>>, account: { id: string; value: string; device_id?: string }): void {
  if (runtime.clients.has(account.id)) return
  try {
    const deviceId = account.device_id || generateDeviceId(transCookies(account.value)['unb'] || account.id)
    if (deviceId !== account.device_id) {
      // 设备指纹持久化: 重连/重启不换设备, 风控关键
      void db.run('UPDATE cookies SET device_id = ? WHERE id = ?', [deviceId, account.id]).catch(() => {})
    }
    const client = new XianyuAccountClient({
      cookieId: account.id,
      cookieStr: account.value,
      deviceId,
      events: {
        onState: (cookieId, state, detail) => void persistAccountState(cookieId, state, detail),
        onChat: (cookieId, msg) => void onChat(cookieId, msg),
        onSystem: (cookieId, msg) => void onSystem(cookieId, msg),
        onRisk: (cookieId, description) => void persistRisk(cookieId, description),
        onCookieInvalid: (cookieId, reason) =>
          dispatchNotify({
            type: 'cookie_invalid',
            cookieId,
            title: '登录态失效 · 请重新扫码',
            fields: {
              详情: reason.slice(0, 200),
              影响: '该账号监听已停止, 消息无法收发',
              处理: '在「账号管理」页对该账号重新扫码登录即可自动恢复监听',
            },
            link: '/accounts',
          }),
        onCookieRotated: (cookieId, merged) => {
          runtime.cookieCache.set(cookieId, merged)
          void db.run('UPDATE cookies SET value = ? WHERE id = ?', [merged, cookieId]).catch(() => {})
        },
      },
    })
    runtime.clients.set(account.id, client)
    runtime.cookieCache.set(account.id, account.value)
    client.start()
  } catch (e: any) {
    console.log(`[xianyu-engine] 账号 ${account.id} 客户端创建失败: ${e?.message}`)
    void db
      .run(
        "UPDATE cookies SET cookie_status_text = 'error', last_check_at = CURRENT_TIMESTAMP WHERE id = ?",
        [account.id],
      )
      .catch(() => {})
  }
}

/* ---------------------------------- 事件 → 大脑 → 动作 ---------------------------------- */

async function onChat(cookieId: string, msg: ParsedChatMessage): Promise<void> {
  // 事件发布 (旁路 fire-and-forget): 原始事件转发给订阅项目, 不影响业务决策主流程
  publishChatEvent(cookieId, msg, 'builtin')
  // IM 会话/消息落库 (源头采集, 去重幂等, 失败不阻塞回复主链路)
  void persistChatMessage(cookieId, msg)
  try {
    const actions = await handleChatEvent(cookieId, msg, { source: 'builtin' })
    await executeActions(actions)
  } catch (e: any) {
    console.log(`[xianyu-engine] 聊天事件处理失败 (${cookieId}): ${e?.message}`)
  }
}

async function onSystem(cookieId: string, msg: ParsedSystemMessage): Promise<void> {
  publishSystemEvent(cookieId, msg, 'builtin')
  // 交易卡片落库 (订单状态/金额对账信息)
  void persistSystemMessage(cookieId, msg)
  try {
    const actions = await handleSystemEvent(cookieId, msg, { source: 'builtin' })
    await executeActions(actions)
  } catch (e: any) {
    console.log(`[xianyu-engine] 系统事件处理失败 (${cookieId}): ${e?.message}`)
  }
}

async function executeActions(actions: EngineAction[]): Promise<void> {
  for (const action of actions) {
    const client = runtime.clients.get(action.account)
    if (!client) continue
    try {
      if (action.type === 'send_text') {
        await client.sendText(action.chat_id, action.to_user_id, action.text, action.delay_ms)
        void persistOutgoingMessage(action.account, action.chat_id, action.to_user_id, action.text, 'text')
      } else {
        await client.sendImage(action.chat_id, action.to_user_id, action.image_url, action.width, action.height, action.delay_ms)
        void persistOutgoingMessage(action.account, action.chat_id, action.to_user_id, action.image_url, 'image')
      }
      markActionSent(action)
    } catch (e: any) {
      console.log(`[xianyu-engine] 动作执行失败 (${action.type} → ${action.account}): ${e?.message}`)
    }
  }
}

/** 后台手动发送 (消息管理页): 账号必须由内置引擎托管且在线。 */
export async function sendTextToAccount(
  cookieId: string,
  chatId: string,
  toUserId: string,
  text: string,
): Promise<void> {
  const client = runtime.clients.get(cookieId)
  if (!client) throw new Error(`账号 ${cookieId} 不由内置引擎托管 (切换引擎或账号未启用)`)
  await client.sendText(chatId, toUserId, text)
  await persistOutgoingMessage(cookieId, chatId, toUserId, text, 'text')
}

/** 账号 WS 客户端直取 (会话列表拉取等协议请求用)。 */
export function getAccountClient(cookieId: string): XianyuAccountClient | null {
  return runtime.clients.get(cookieId) || null
}

async function markActionSent(action: EngineAction): Promise<void> {
  const db = await getDb().catch(() => null)
  if (!db) return
  await db
    .run(
      `UPDATE auto_reply_logs SET send_status = 'success'
       WHERE id = (SELECT id FROM auto_reply_logs WHERE cookie_id = ? ORDER BY id DESC LIMIT 1)`,
      [action.account],
    )
    .catch(() => {})
}

/* ---------------------------------- 状态回写 ---------------------------------- */

async function persistAccountState(cookieId: string, state: AccountState, detail: string): Promise<void> {
  const db = await getDb().catch(() => null)
  if (!db) return
  await db
    .run(
      'UPDATE cookies SET cookie_status_text = ?, last_check_at = CURRENT_TIMESTAMP WHERE id = ?',
      [state, cookieId],
    )
    .catch(() => {})
  if (state === 'reconnecting' || state === 'error') {
    console.log(`[xianyu-engine] 账号 ${cookieId} 状态: ${state} ${detail}`)
  }
}

async function persistRisk(cookieId: string, description: string): Promise<void> {
  publishRiskEvent(cookieId, description, 'builtin')
  dispatchNotify({
    type: 'risk',
    cookieId,
    title: '风控触发 · 监听进入冷却',
    fields: {
      原因: description.slice(0, 300),
      处理: '已自动进入冷却期, 冷却结束后自动重连 (无需人工干预)',
    },
    link: '/listener',
  })
  const db = await getDb().catch(() => null)
  if (!db) return
  await db
    .run(
      `INSERT INTO risk_control_logs (cookie_id, event_type, event_description, processing_result, processing_status)
       VALUES (?, 'token_captcha', ?, '已自动进入冷却期, 冷却结束后自动重连', 'handled')`,
      [cookieId, description.slice(0, 500)],
    )
    .catch(() => {})
  await db
    .run("UPDATE cookies SET cookie_status_text = 'risk_cooldown', last_check_at = CURRENT_TIMESTAMP WHERE id = ?", [
      cookieId,
    ])
    .catch(() => {})
}

async function heartbeatOnce(): Promise<void> {
  const db = await getDb().catch(() => null)
  if (!db) return
  try {
    await db
      .run(
        "UPDATE engines SET last_seen_at = CURRENT_TIMESTAMP, last_status = ? WHERE slug = 'builtin'",
        [runtime.standby ? 'standby' : `serving accounts=${runtime.clients.size}`],
      )
    if (!runtime.standby) {
      for (const cookieId of runtime.clients.keys()) {
        await db
          .run('UPDATE cookies SET last_check_at = CURRENT_TIMESTAMP WHERE id = ?', [cookieId])
          .catch(() => {})
      }
    }
  } catch {}
}

/* ---------------------------------- 商品自动同步 (item_sync 设置落地, 语义对齐 butler item_sync_loop) ---------------------------------- */

let itemSyncLastRunAt = 0

async function itemSyncTick(): Promise<void> {
  if (runtime.standby || runtime.itemSyncRunning) return
  const db = await getDb().catch(() => null)
  if (!db) return
  try {
    const rows = await db.all<any>("SELECT key_name, value FROM system_settings WHERE key_name IN ('item_sync_enabled','item_sync_interval','item_sync_max_pages')")
    const settings: Record<string, string> = {}
    for (const r of rows) settings[r.key_name] = r.value
    if (String(settings.item_sync_enabled ?? 'true') !== 'true') return
    const intervalS = Math.max(parseInt(String(settings.item_sync_interval ?? '600'), 10) || 600, ITEM_SYNC_MIN_INTERVAL_S)
    const now = Date.now()
    if (now - itemSyncLastRunAt < intervalS * 1000) return
    itemSyncLastRunAt = now
    runtime.itemSyncRunning = true
    try {
      await runItemSyncForAllAccounts(db, Math.max(parseInt(String(settings.item_sync_max_pages ?? '5'), 10) || 5, 1))
    } finally {
      runtime.itemSyncRunning = false
    }
  } catch {}
}

async function runItemSyncForAllAccounts(db: Awaited<ReturnType<typeof getDb>>, maxPages: number): Promise<void> {
  const cookieIds = [...runtime.clients.keys()]
  if (!cookieIds.length) return
  let totalUpserted = 0
  const failed: string[] = []
  for (const cookieId of cookieIds) {
    const row = await db.get<any>('SELECT value FROM cookies WHERE id = ?', [cookieId]).catch(() => null)
    if (!row?.value) continue
    try {
      const unb = transCookies(String(row.value))['unb'] || ''
      if (!unb) continue
      const { items, finalCookieStr } = await fetchItemList(String(row.value), String(unb), maxPages)
      if (finalCookieStr && finalCookieStr !== row.value) {
        await db.run('UPDATE cookies SET value = ? WHERE id = ?', [finalCookieStr, cookieId]).catch(() => {})
        runtime.cookieCache.set(cookieId, finalCookieStr)
        runtime.clients.get(cookieId)?.setCookieStr(finalCookieStr)
      }
      for (const it of items) {
        await db
          .run(
            `INSERT INTO item_info (cookie_id, item_id, item_title, item_description, item_category, item_price, item_detail, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(cookie_id, item_id) DO UPDATE SET
               item_title = excluded.item_title,
               item_description = excluded.item_description,
               item_category = excluded.item_category,
               item_price = excluded.item_price,
               item_detail = excluded.item_detail,
               updated_at = CURRENT_TIMESTAMP`,
            [cookieId, it.item_id, it.item_title, it.item_description, it.item_category, it.item_price, it.pic_url],
          )
          .catch(() => {})
      }
      totalUpserted += items.length
    } catch {
      failed.push(cookieId)
    }
    // 账号间随机间隔 1~3s, 避免机节拍
    await new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 2000)))
  }
  const summary = `商品同步完成: ${totalUpserted} 件 / ${cookieIds.length} 账号${failed.length ? `, 失败 ${failed.length} 个` : ''}`
  console.log(`[xianyu-engine] ${summary}`)
  await db
    .run(
      "INSERT INTO system_logs (level, module, message) VALUES ('INFO', 'item_sync', ?)",
      [summary],
    )
    .catch(() => {})
}

/* ---------------------------------- 商品自动擦亮 (auto_polish 设置落地) ---------------------------------- */

let polishLastRunAt = 0

async function polishTick(): Promise<void> {
  if (runtime.standby || runtime.polishRunning) return
  const db = await getDb().catch(() => null)
  if (!db) return
  try {
    const rows = await db.all<any>("SELECT key_name, value FROM system_settings WHERE key_name IN ('auto_polish_enabled','auto_polish_interval')")
    const settings: Record<string, string> = {}
    for (const r of rows) settings[r.key_name] = r.value
    if (String(settings.auto_polish_enabled ?? 'false') !== 'true') return
    const intervalS = Math.max(parseInt(String(settings.auto_polish_interval ?? '86400'), 10) || 86400, 3600)
    const now = Date.now()
    if (now - polishLastRunAt < intervalS * 1000) return
    polishLastRunAt = now
    runtime.polishRunning = true
    try {
      await runPolishForAllAccounts(db)
    } finally {
      runtime.polishRunning = false
    }
  } catch {}
}

async function runPolishForAllAccounts(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const cookieIds = [...runtime.clients.keys()]
  if (!cookieIds.length) return
  let polished = 0
  let already = 0
  let failed = 0
  for (const cookieId of cookieIds) {
    const row = await db.get<any>('SELECT value FROM cookies WHERE id = ?', [cookieId]).catch(() => null)
    if (!row?.value) continue
    // 只擦当前账号在售商品 (每商品每天限擦一次, 平台侧幂等)
    let itemIds: string[] = []
    try {
      const items = await db.all<any>('SELECT item_id FROM item_info WHERE cookie_id = ? ORDER BY updated_at DESC LIMIT 50', [cookieId])
      itemIds = items.map((i) => String(i.item_id)).filter(Boolean)
    } catch {
      continue
    }
    let cookieStr = String(row.value)
    for (const itemId of itemIds) {
      try {
        // polishItem is auto-imported by Nitro from server/utils/xianyu/mtop.ts
        const r = await polishItem(cookieStr, itemId)
        if (r.finalCookieStr && r.finalCookieStr !== cookieStr) {
          cookieStr = r.finalCookieStr
          await db.run('UPDATE cookies SET value = ? WHERE id = ?', [r.finalCookieStr, cookieId]).catch(() => {})
          runtime.cookieCache.set(cookieId, r.finalCookieStr)
          runtime.clients.get(cookieId)?.setCookieStr(r.finalCookieStr)
        }
        if (r.success) {
          if (r.alreadyPolished) already++
          else polished++
        } else {
          failed++
        }
      } catch {
        failed++
      }
      // 商品间 1.5~3s 抖动, 避免机节拍触发风控
      await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 1500)))
    }
  }
  const summary = `商品擦亮完成: 成功 ${polished}, 今日已擦 ${already}, 失败 ${failed} / ${cookieIds.length} 账号`
  console.log(`[xianyu-engine] ${summary}`)
  await db
    .run(
      "INSERT INTO system_logs (level, module, message) VALUES ('INFO', 'auto_polish', ?)",
      [summary],
    )
    .catch(() => {})
}

/* ---------------------------------- 订单定时同步 (order_sync 设置落地, 语义对齐 butler /api/orders/refresh 批量刷新) ---------------------------------- */

let orderSyncLastRunAt = 0
const ORDER_SYNC_MIN_INTERVAL_S = 1800

async function orderSyncTick(): Promise<void> {
  if (runtime.standby || runtime.orderSyncRunning) return
  const db = await getDb().catch(() => null)
  if (!db) return
  try {
    const rows = await db.all<any>("SELECT key_name, value FROM system_settings WHERE key_name IN ('order_sync_enabled','order_sync_interval')")
    const settings: Record<string, string> = {}
    for (const r of rows) settings[r.key_name] = r.value
    if (String(settings.order_sync_enabled ?? 'true') !== 'true') return
    const intervalS = Math.max(parseInt(String(settings.order_sync_interval ?? '1800'), 10) || 1800, ORDER_SYNC_MIN_INTERVAL_S)
    const now = Date.now()
    if (now - orderSyncLastRunAt < intervalS * 1000) return
    orderSyncLastRunAt = now
    runtime.orderSyncRunning = true
    try {
      await runOrderSyncForAllAccounts(db)
    } finally {
      runtime.orderSyncRunning = false
    }
  } catch {}
}

async function runOrderSyncForAllAccounts(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  // 非稳定状态订单逐单实查 (shipped/completed/cancelled 为终态不刷新, 与 butler needs_refresh 一致)
  let targets: { order_id: string; cookie_id: string; order_status: string }[] = []
  try {
    targets = await db.all<any>(
      `SELECT order_id, cookie_id, order_status FROM orders
       WHERE order_status IN ('pending_ship','processing','refunding','unknown') OR order_status IS NULL OR order_status = ''
       ORDER BY updated_at DESC LIMIT 200`,
    )
  } catch {
    return
  }
  if (!targets.length) {
    await db.run("INSERT INTO system_logs (level, module, message) VALUES ('INFO', 'order_sync', '订单同步完成: 无待刷新订单')").catch(() => {})
    return
  }
  const cookieCache = new Map<string, string>()
  let updated = 0
  let noChange = 0
  let failed = 0
  for (const t of targets) {
    const orderId = String(t.order_id)
    const cookieId = String(t.cookie_id || '')
    try {
      let cookieStr = cookieCache.get(cookieId) || ''
      if (!cookieStr) {
        const row = await db.get<any>('SELECT value FROM cookies WHERE id = ?', [cookieId]).catch(() => null)
        if (!row?.value) throw new Error('Cookie 为空')
        cookieStr = String(row.value)
        cookieCache.set(cookieId, cookieStr)
      }
      const { detail, retMsg, finalCookieStr } = await fetchOrderDetail(cookieStr, orderId)
      if (finalCookieStr && finalCookieStr !== cookieStr) {
        cookieCache.set(cookieId, finalCookieStr)
        await db.run('UPDATE cookies SET value = ? WHERE id = ?', [finalCookieStr, cookieId]).catch(() => {})
        runtime.cookieCache.set(cookieId, finalCookieStr)
        runtime.clients.get(cookieId)?.setCookieStr(finalCookieStr)
      }
      if (!detail) throw new Error(retMsg || '接口未返回订单数据')
      if (detail.order_status && detail.order_status !== 'unknown') {
        await db
          .run(
            `UPDATE orders SET order_status = ?,
             buyer_id = CASE WHEN ? != '' THEN ? ELSE buyer_id END,
             amount = CASE WHEN ? != '' THEN ? ELSE amount END,
             receiver_name = CASE WHEN ? != '' THEN ? ELSE receiver_name END,
             receiver_phone = CASE WHEN ? != '' THEN ? ELSE receiver_phone END,
             receiver_address = CASE WHEN ? != '' THEN ? ELSE receiver_address END,
             updated_at = CURRENT_TIMESTAMP
             WHERE order_id = ?`,
            [
              detail.order_status,
              detail.buyer_id, detail.buyer_id,
              detail.price, detail.price,
              detail.receiver_name, detail.receiver_name,
              detail.receiver_phone, detail.receiver_phone,
              detail.receiver_address, detail.receiver_address,
              orderId,
            ],
          )
          .catch(() => {})
      }
      if (detail.order_status !== String(t.order_status || 'unknown')) updated++
      else noChange++
    } catch {
      failed++
    }
    // 单间 500ms 防风控
    await new Promise((r) => setTimeout(r, 500))
  }
  const summary = `订单同步完成: 共 ${targets.length} 单, 状态更新 ${updated}, 无变化 ${noChange}, 失败 ${failed}`
  console.log(`[xianyu-engine] ${summary}`)
  await db
    .run(
      "INSERT INTO system_logs (level, module, message) VALUES ('INFO', 'order_sync', ?)",
      [summary],
    )
    .catch(() => {})
}

/** 引擎令牌惰性补齐: 保证所有 engines 行都有 Bearer token (迁移存量行)。 */
export async function ensureEngineTokens(): Promise<void> {
  const db = await getDb().catch(() => null)
  if (!db) return
  const rows = await db.all<any>("SELECT id FROM engines WHERE token IS NULL OR token = ''").catch(() => [])
  for (const row of rows) {
    await db
      .run('UPDATE engines SET token = ? WHERE id = ?', [crypto.randomBytes(24).toString('hex'), row.id])
      .catch(() => {})
  }
}
