/**
 * xianyu/engine-manager — 内置监听引擎调度器 (与后台同进程, 默认引擎)。
 *
 * 职责:
 *   - 每 5s 门控巡检: engines.is_active === builtin 才服务; 切到远程代理时自动停全部账号 (互斥防重复回复)
 *   - 账号对齐: cookies ∩ cookie_status.enabled → 建/停/热换 XianyuAccountClient (device_id 持久化, 风控指纹稳定)
 *   - 每 10s 心跳回写: engines.last_seen_at (内置行) + cookies.cookie_status_text/last_check_at
 *   - 事件 → brain 决策 → 动作执行 (发文本/发图片)
 */
import { getDb } from '../db'
import { generateEngineToken } from '../engine-auth'
import { XianyuAccountClient, type AccountState, type ManualTokenOutcome } from './ws-client'
import { generateDeviceId, transCookies, type ParsedChatMessage, type ParsedSystemMessage } from './protocol'
import { fetchItemList, polishItem, fetchSellerOrders } from './mtop'
import { upsertSoldOrders } from './order-sync'
import { isProxyEngineMode, sendTextViaProxy } from './order-task'
import { probeRemoteEngine } from './engine-probe'
import { handleChatEvent, handleSystemEvent, type EngineAction } from './brain'
import { dispatchNotify } from '../notify'
import { publishChatEvent, publishSystemEvent, publishRiskEvent } from './publisher'
import { persistChatMessage, persistSystemMessage, persistOutgoingMessage } from './im-store'
import { persistCookieRotation } from './cookie-store'
import { getFailoverOwner, setFailoverOwner, FAILOVER_BUILTIN, FAILOVER_REMOTE } from './failover'

const POLL_INTERVAL_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 10_000
const ITEM_SYNC_MIN_INTERVAL_S = 60
/** 擦亮/订单同步的门控巡检周期 (每 5 分钟读一次设置, 由各自 interval 决定是否真正执行)。 */
const MAINTENANCE_TICK_MS = 5 * 60_000
/** 远程代理心跳失联阈值: 超此时间无 last_seen_at 更新即视为未在服务本后台 (内置接管)。 */
const REMOTE_STALE_MS = 5 * 60_000
/**
 * 远程代理失联接管确认窗口: probe 结果有 30s 缓存,
 * 瞬时网络抖动/边缘波动 <90s 一律不接管 — 误接管会与代理形成两条闲鱼长连接
 * (双设备指纹双出口 IP), 平台风控直接判「环境异常, 重新登录 + 人脸核验」。
 * 持续失联 ≥90s (跨越 ≥3 个探测缓存周期) 才认定代理真实死亡。
 */
const REMOTE_DOWN_CONFIRM_MS = 90_000
/**
 * 接管排水窗 (v2.3.2 双连接根治): 接管时先经 engine_failover 吊销代理授权
 * (config.active=false), 存活代理会在其下一轮配置轮询 (≤30s) 收到并退避全部连接;
 * 内置引擎再等一个排水窗 (45s > 最大轮询周期 30s, 覆盖代理在途请求) 才建连接 —
 * 与代理的在途连接时间错开, 结构性杜绝双连接, 而不是靠运气。
 */
const REMOTE_DRAIN_MS = 45_000
/**
 * 交回稳定窗 (v2.3.2): 心跳恢复新鲜后须持续稳定 ≥90s 才把所有权交回代理 —
 * 防代理反复闪断导致所有权来回翻转 (每次翻转都是一次重连 = 一次风控信号)。
 * 交回顺序: 先停内置连接 → 再归还授权 (config.active=true) → 代理 ≤30s 自行拉起。
 */
const REMOTE_HANDBACK_STABLE_MS = 90_000

interface EngineRuntime {
  pollTimer: NodeJS.Timeout | null
  heartbeatTimer: NodeJS.Timeout | null
  itemSyncTimer: NodeJS.Timeout | null
  polishTimer: NodeJS.Timeout | null
  orderSyncTimer: NodeJS.Timeout | null
  clients: Map<string, XianyuAccountClient>
  /** 缓存账号 Cookie 串, 变更时热替换 */
  cookieCache: Map<string, string>
  /** 客户端侧最近一次轮换 Cookie 的时刻 (热替换竞态守卫, v2.3.11) */
  lastClientRotateAt: Map<string, number>
  standby: boolean
  starting: boolean
  itemSyncRunning: boolean
  polishRunning: boolean
  orderSyncRunning: boolean
  /** 远程代理首次失联时刻 (0=健康): 接管确认窗口计时 */
  remoteDownSince: number
  /** 心跳恢复新鲜的起始时刻 (0=非新鲜): 交回稳定窗计时 */
  remoteFreshSince: number
  /** 接管排水截止时刻 (0=无): 吊销代理授权后等代理退避, 到点才建内置连接 */
  takeoverDrainUntil: number
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
    lastClientRotateAt: new Map(),
    standby: true,
    starting: false,
    itemSyncRunning: false,
    polishRunning: false,
    orderSyncRunning: false,
    remoteDownSince: 0,
    remoteFreshSince: 0,
    takeoverDrainUntil: 0,
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
  console.log('[xianyu-engine] 内置监听引擎调度器已启动 (5s 门控巡检/远程失联自愈 / 10s 心跳 / 60s 商品同步门控 / 5min 擦亮·订单同步门控)')
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
      // 远程代理健康实测 (登记 host:port 的 /health, 30s 缓存) + 心跳新鲜度 (可靠通道):
      // 失联确认后内置引擎自动接管, 代理恢复后自动交回 — 消灭「远程引擎失联 → 监听/商品
      // 同步/风控全链路静默停摆却无人知晓」(v2.1.15 线上实证)。
      const probe = await probeActiveRemote(db)
      if (probe.serving) {
        // 代理存活 (心跳新鲜): 所有权必须归代理。若内置引擎还持有连接 (上一轮接管残留/
        // 升级瞬间的双连接状态), 按稳定窗交回 — 先停内置连接再归还授权, 顺序不可反,
        // 否则代理拉起时内置还没停干净, 又是双连接。
        runtime.remoteDownSince = 0
        if (!runtime.remoteFreshSince) runtime.remoteFreshSince = Date.now()
        if (!runtime.standby && Date.now() - runtime.remoteFreshSince >= REMOTE_HANDBACK_STABLE_MS) {
          for (const client of runtime.clients.values()) await client.stop()
          runtime.clients.clear()
          runtime.cookieCache.clear()
          runtime.standby = true
          runtime.takeoverDrainUntil = 0
          await setFailoverOwner(db, FAILOVER_REMOTE)
          await db
            .run(
              "UPDATE engines SET last_status = 'standby', updated_at = CURRENT_TIMESTAMP WHERE slug = 'builtin'",
            )
            .catch(() => {})
          const msg = '远程代理心跳持续稳定, 内置引擎交回服务权 (先停内置连接 → 归还授权, 代理 ≤30s 自行拉起)'
          console.log(`[xianyu-engine] ${msg}`)
          await db
            .run("INSERT INTO system_logs (level, module, message) VALUES ('INFO', 'engine', ?)", [msg])
            .catch(() => {})
        }
        return
      }
      runtime.remoteFreshSince = 0
      // 失联确认窗口: 心跳陈旧/代理确认空转 <90s 一律不接管 —
      // 误接管会与代理形成两条闲鱼长连接 (双设备指纹双出口 IP), 平台风控直接判
      // 「环境异常, 重新登录 + 人脸核验」。持续失联 ≥90s 才认定代理无力服务。
      if (!runtime.remoteDownSince) runtime.remoteDownSince = Date.now()
      if (Date.now() - runtime.remoteDownSince < REMOTE_DOWN_CONFIRM_MS) return
      // 接管 (v2.3.2 源头修复): 立即经 engine_failover 吊销代理授权 — config 接口对代理
      // 返回 active=false, 存活的代理 (哪怕 /health 直连不通, 只要它还能轮询本后台) 会在
      // 下一轮轮询 (≤30s) 收到吊销并退避全部连接。内置引擎再等一个排水窗 (45s > 代理
      // 最大轮询周期) 才建连接 — 与代理在途连接时间错开, 结构性无重叠。
      if (runtime.standby) {
        const msg = `活跃引擎为远程代理但${probe.reason} (持续失联超过 ${Math.round(REMOTE_DOWN_CONFIRM_MS / 1000)}s), 内置引擎自动接管 (已吊销代理授权 + 45s 排水, 代理恢复后自动交回)`
        console.log(`[xianyu-engine] ${msg}`)
        await db
          .run("INSERT INTO system_logs (level, module, message) VALUES ('WARN', 'engine', ?)", [msg])
          .catch(() => {})
        // 接管必须让用户可感知: 授权已吊销, 代理存活时将自动退避; 若代理连本后台都
        // 无法到达 (收不到吊销), 其侧连接由代理自身 90s 授权失联释放兜住 (v2.3.2 配套)
        dispatchNotify({
          type: 'risk',
          cookieId: '',
          title: '内置引擎接管监听 · 远程代理失联',
          fields: {
            原因: probe.reason.slice(0, 200),
            机制: '已吊销代理授权 (config.active=false), 存活代理 ≤30s 自动退避; 内置引擎 45s 排水后才建连接, 不会双连接',
            处理: '代理真实恢复后心跳转新鲜, 内置引擎 90s 稳定期满自动交回',
          },
          link: '/listener',
        })
        await setFailoverOwner(db, FAILOVER_BUILTIN)
        runtime.takeoverDrainUntil = Date.now() + REMOTE_DRAIN_MS
      }
      runtime.standby = false
      // 排水窗内不建连接 (账号对齐跳过创建, 仅保留停用对齐)
      if (Date.now() < runtime.takeoverDrainUntil) return
    } else {
      runtime.standby = false
      runtime.remoteDownSince = 0
      runtime.remoteFreshSince = 0
      runtime.takeoverDrainUntil = 0
      // 内置引擎是活跃引擎: 所有权归内置 (config 对代理返回 active=false, 与 is_active=0 双保险)
      const owner = await getFailoverOwner(db).catch(() => FAILOVER_REMOTE)
      if (owner !== FAILOVER_BUILTIN) await setFailoverOwner(db, FAILOVER_BUILTIN)
    }

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
        runtime.lastClientRotateAt.delete(id)
      }
    }

    for (const account of accounts) {
      const existing = runtime.clients.get(account.id)
      if (existing) {
        if (runtime.cookieCache.get(account.id) !== account.value) {
          // 热替换竞态守卫 (v2.3.11): 客户端保活轮换先写 cache (合并写 DB 在途),
          // 此刻 DB 短暂落后于 cache — 若立即把 DB 旧快照顶回客户端, 会把刚滚动的
          // _m_h5_tk/_enc 成对回退 (配对失效 → 监听被踢)。轮换后 60s 内的 DB≠cache
          // 视为落库在途, 跳过本轮推送; QR 重扫码/后台改 Cookie 等外部写入不写
          // lastClientRotateAt, 不受影响 (最多延退一轮巡检)。
          const rotatedAt = runtime.lastClientRotateAt.get(account.id) || 0
          if (Date.now() - rotatedAt < 60_000) {
            console.log(`[xianyu-engine] 账号 ${account.id} 保活轮换落库在途, 本轮跳过 Cookie 热替换`)
          } else {
            existing.setCookieStr(account.value)
            runtime.cookieCache.set(account.id, account.value)
            console.log(`[xianyu-engine] 账号 ${account.id} Cookie 已更新, 热替换生效`)
          }
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
          // 保活轮换是 Cookie 的主要来源, 但必须走合并写: 发货/拉单等 mtop 调用可能刚写过
          // 更新的 _m_h5_tk, 整串覆盖会把新 token 顶回旧的 (下一次请求即被判失效)
          const base = runtime.cookieCache.get(cookieId) || ''
          runtime.cookieCache.set(cookieId, merged)
          runtime.lastClientRotateAt.set(cookieId, Date.now())
          void persistCookieRotation(db, cookieId, base, merged)
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
        void persistOutgoingMessage(action.account, action.chat_id, action.to_user_id, action.text, 'text', !!(action as any).is_ai)
      } else {
        await client.sendImage(action.chat_id, action.to_user_id, action.image_url, action.width, action.height, action.delay_ms)
        void persistOutgoingMessage(action.account, action.chat_id, action.to_user_id, action.image_url, 'image', !!(action as any).is_ai)
      }
      await markActionResult(action, true, '')
    } catch (e: any) {
      console.log(`[xianyu-engine] 动作执行失败 (${action.type} → ${action.account}): ${e?.message}`)
      await markActionResult(action, false, String(e?.message || '').slice(0, 300))
    }
  }
}

/**
 * 后台手动发送 (消息管理页): 内置引擎托管账号直发; 独立代理模式走任务通道
 * (engine_tasks → 代理本地 WS 发送 → task_result 回报) — 代理部署形态主动外呼,
 * 后台无法直连代理, WS 发送只能由长连接所在代理执行。
 */
export async function sendTextToAccount(
  cookieId: string,
  chatId: string,
  toUserId: string,
  text: string,
): Promise<void> {
  const client = runtime.clients.get(cookieId)
  if (client) {
    await client.sendText(chatId, toUserId, text)
    await persistOutgoingMessage(cookieId, chatId, toUserId, text, 'text')
    return
  }
  const db = await getDb()
  if (await isProxyEngineMode(db)) {
    const r = await sendTextViaProxy(db, cookieId, chatId, toUserId, text)
    if (!r.ok) throw new Error(r.error || '代理发送失败')
    await persistOutgoingMessage(cookieId, chatId, toUserId, text, 'text')
    return
  }
  throw new Error(`账号 ${cookieId} 不由内置引擎托管 (切换引擎或账号未启用)`)
}

/** 账号 WS 客户端直取 (会话列表拉取等协议请求用)。 */
export function getAccountClient(cookieId: string): XianyuAccountClient | null {
  return runtime.clients.get(cookieId) || null
}

/** 内置引擎发送结果回写: 按决策日志 id 精确更新, 不再猜“该账号最新一条”。 */
async function markActionResult(action: EngineAction, sent: boolean, error: string): Promise<void> {
  const logId = Number((action as { log_id?: number }).log_id || 0)
  if (!logId) return
  const db = await getDb().catch(() => null)
  if (!db) return
  await db
    .run(
      'UPDATE auto_reply_logs SET send_status = ?, error_message = ? WHERE id = ?',
      [sent ? 'success' : 'failed', sent ? null : error, logId],
    )
    .catch(() => {})
}

/* ---------------------------------- 引擎健康探测 ---------------------------------- */

/**
 * 探测当前活跃的远程代理是否真实在服务。
 *
 * v2.3.2 信任裁决修正 (双连接根治): 代理 → 本后台的配置轮询/事件心跳走同一出口链路
 * (经 Cloudflare, ≤30s/次), 是唯一可靠的存活证据; 而本后台 → 代理登记地址的 /health
 * 是另一条直连链路 (NAT/防火墙/端口未放行都会永久不通), 两条链路可达性毫无因果关系。
 * 旧逻辑让 /health 失败覆盖新鲜心跳 → 代理明明活着并持有连接, 内置引擎却接管 →
 * 双连接 → 风控 → 「重新登录 + 人脸核验」循环 (线上实证)。
 *
 * 新裁决:
 *   - 心跳新鲜 → 代理存活。/health 仅用于识别「进程活着但没挂任何账号」(engine_active=
 *     false, 如令牌不匹配/未激活), 该状态接管才安全; /health 不可达一律按在服务处理
 *     (绝不因探测链路故障去和活代理抢连接)。
 *   - 心跳陈旧/从未上报 → serving=false (走 90s 确认接管)。
 */
async function probeActiveRemote(db: Awaited<ReturnType<typeof getDb>>): Promise<{ serving: boolean; reason: string }> {
  try {
    const row = await db.get<{ host: string; port: number; last_seen_at: string | null }>(
      `SELECT host, port, last_seen_at FROM engines
       WHERE is_active = 1 AND type != 'builtin' AND enabled = 1
         AND host IS NOT NULL AND host != '' AND port IS NOT NULL AND port > 0
       LIMIT 1`,
    )
    if (!row) return { serving: true, reason: '' }
    if (row.last_seen_at) {
      const raw = String(row.last_seen_at)
      const seenMs = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z')
      if (Number.isFinite(seenMs) && Date.now() - seenMs <= REMOTE_STALE_MS) {
        // 心跳新鲜 → 代理存活。/health 只做「是否挂着账号」的细化判定:
        const r = await probeRemoteEngine(String(row.host), Number(row.port))
        if (r.ok && !r.engine_active) {
          return { serving: false, reason: '代理进程存活但未在服务 (engine_active=false, 常见为接入令牌不匹配或代理未激活)' }
        }
        // /health 可达且在服务, 或 /health 不可达 (探测链路故障 ≠ 代理死亡) → 都按在服务
        return { serving: true, reason: '' }
      }
    }
    const staleMin = row.last_seen_at
      ? Math.round((Date.now() - Date.parse(String(row.last_seen_at).includes('T') ? String(row.last_seen_at) : String(row.last_seen_at).replace(' ', 'T') + 'Z')) / 60_000)
      : NaN
    return {
      serving: false,
      reason: row.last_seen_at
        ? `心跳陈旧 (${Number.isFinite(staleMin) ? staleMin : '?'} 分钟无上报, 代理可能在服务其他后台或上报中断)`
        : '代理从未上报心跳 (登记后从未连通本后台)',
    }
  } catch {
    return { serving: true, reason: '' }
  }
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
  if (runtime.itemSyncRunning) return
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

/**
 * 同步链路风控如实落账: 命中闲鱼用户验证/风控拦截时记 risk_control_logs (风控日志页可见)
 * + WARN 系统日志 — 同步不再静默吞风控 (风控日志停止记录的一半根因: 同步 catch{} 无声)。
 */
async function recordSyncRisk(db: Awaited<ReturnType<typeof getDb>>, cookieId: string, source: string, message: string): Promise<void> {
  const m = String(message || '')
  if (!/FAIL_SYS_USER_VALIDATE|RGV587|SESSION_EXPIRED|风控|验证码|punish/i.test(m)) return
  await db
    .run(
      `INSERT INTO risk_control_logs (cookie_id, event_type, event_description, processing_result, processing_status)
       VALUES (?, 'token_captcha', ?, '同步链路被风控拦截, 将随下轮同步自动重试', 'handled')`,
      [cookieId, `[${source}] ${m.slice(0, 480)}`],
    )
    .catch(() => {})
}

async function warnSyncLog(db: Awaited<ReturnType<typeof getDb>>, message: string): Promise<void> {
  console.log(`[xianyu-engine] ${message}`)
  await db.run("INSERT INTO system_logs (level, module, message) VALUES ('WARN', 'item_sync', ?)", [message.slice(0, 500)]).catch(() => {})
}

async function runItemSyncForAllAccounts(db: Awaited<ReturnType<typeof getDb>>, maxPages: number): Promise<void> {
  // 全账号 = 启用的 cookies (后台定时任务, 不依赖内置 WS 客户端):
  // 内置引擎托管/远程代理在服务/远程失联接管三形态下统一从后台拉取 (网关优先→直连兑底)。
  let accountRows: { id: string; value: string }[] = []
  try {
    accountRows = await db.all<{ id: string; value: string }>(
      `SELECT c.id, c.value FROM cookies c
       LEFT JOIN cookie_status cs ON cs.cookie_id = c.id
       WHERE COALESCE(cs.enabled, 1) = 1 AND c.value IS NOT NULL AND c.value != ''`,
    )
  } catch {
    return
  }
  if (!accountRows.length) {
    const msg = '商品同步跳过: 无启用账号 (账号管理页启用账号后自动恢复)'
    console.log(`[xianyu-engine] ${msg}`)
    await db.run("INSERT INTO system_logs (level, module, message) VALUES ('INFO', 'item_sync', ?)", [msg]).catch(() => {})
    return
  }
  let totalUpserted = 0
  const failed: string[] = []
  for (const acct of accountRows) {
    const cookieId = String(acct.id)
    const cookieStr = String(acct.value)
    try {
      const unb = transCookies(cookieStr)['unb'] || ''
      if (!unb) continue
      const { items, finalCookieStr } = await fetchItemList(cookieStr, String(unb), maxPages)
      if (finalCookieStr && finalCookieStr !== cookieStr) {
        await persistCookieRotation(db, cookieId, cookieStr, finalCookieStr)
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
    } catch (e: any) {
      failed.push(cookieId)
      const msg = `账号 ${cookieId} 商品同步失败: ${String(e?.message || e).slice(0, 200)}`
      await warnSyncLog(db, msg)
      await recordSyncRisk(db, cookieId, '商品同步', String(e?.message || e))
    }
    // 账号间随机间隔 1~3s, 避免机节拍
    await new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 2000)))
  }
  const summary = `商品同步完成: ${totalUpserted} 件 / ${accountRows.length} 账号${failed.length ? `, 失败 ${failed.length} 个` : ''}`
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
  if (runtime.polishRunning) return
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
  // 与商品同步同语义: 后台定时任务不依赖内置 WS 客户端, 遍历启用账号 (擦亮走网关优先→直连兑底)
  let cookieIds: string[] = []
  try {
    const rows = await db.all<{ id: string }>(
      `SELECT c.id FROM cookies c
       LEFT JOIN cookie_status cs ON cs.cookie_id = c.id
       WHERE COALESCE(cs.enabled, 1) = 1 AND c.value IS NOT NULL AND c.value != ''`,
    )
    cookieIds = rows.map((r) => String(r.id))
  } catch {
    return
  }
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
          const base = cookieStr
          cookieStr = r.finalCookieStr
          await persistCookieRotation(db, cookieId, base, r.finalCookieStr)
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
  if (runtime.orderSyncRunning) return
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
  // 第一步: 每账号拉取闲鱼卖家全部状态订单列表 (ALL) upsert 入库 (v2.2.5: 由仅拉待发货
  // NOT_SHIP 改为全部状态, 闲鱼趋势/订单管理需要全状态数据) —
  // 待发货订单仍包含其中, 交易卡片丢失/解析失败时 "已付款待发货" 订单照旧在此自愈落库,
  // 自动发货兜底数据源不受影响 (超集拉取, 链路语义不变)
  let accountRows: { id: string; value: string }[] = []
  try {
    accountRows = await db.all<{ id: string; value: string }>(
      "SELECT id, value FROM cookies WHERE value IS NOT NULL AND value != ''",
    )
  } catch {
    return
  }
  for (const acct of accountRows) {
    try {
      const pg = await fetchSellerOrders(String(acct.value), 1, 'ALL')
      if (pg.finalCookieStr && pg.finalCookieStr !== String(acct.value)) {
        await persistCookieRotation(db, String(acct.id), String(acct.value), pg.finalCookieStr)
        runtime.cookieCache.set(String(acct.id), pg.finalCookieStr)
        runtime.clients.get(String(acct.id))?.setCookieStr(pg.finalCookieStr)
      }
      if (pg.retMsg) {
        await db
          .run("INSERT INTO system_logs (level, module, message) VALUES ('WARN', 'order_sync', ?)", [
            `账号 ${acct.id} 全状态订单列表拉取失败: ${pg.retMsg.slice(0, 120)}`,
          ])
          .catch(() => {})
        continue
      }
      if (pg.items.length) {
        const r = await upsertSoldOrders(db, String(acct.id), pg.items)
        if (r.inserted > 0) {
          console.log(`[xianyu-engine] 账号 ${acct.id} 全状态订单列表同步: 新入库 ${r.inserted} 单`)
        }
      }
    } catch {
      // 单账号列表拉取失败不阻断详情刷新
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  // 详情精修能力已全链路移除 (按用户需求): 定时同步只做纯列表拉取入库, 不再逐单调
  // order.detail 精修 (批量逐单实查动辄数百次请求, 是超时/风控元凶)。单个订单需要
  // 详情精修时在订单页点单条「详情精修」按钮走 /api/orders/:id/refresh。
  const summary = `订单定时同步完成: 全状态订单列表已按账号拉取入库 (纯列表同步, 无逐单精修)`
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
    await db.run('UPDATE engines SET token = ? WHERE id = ?', [generateEngineToken(), row.id]).catch(() => {})
  }
}
