#!/usr/bin/env node
/**
 * xianyu-proxy.mjs — 闲鱼远程监听代理 (纯消息监听与转发, 单文件零 npm 依赖)。
 *
 * 定位: 「接线员」而非「大脑」。连接闲鱼消息长连接, 把聊天/交易事件转发给管理后台,
 * 后台 (回复链/发货链) 决策出动作后由本代理人化执行。本进程不持有任何业务状态
 * (无规则/卡券/订单), 仅保存连接所需 Cookie 与设备指纹。
 *
 * 部署 (任意有 Node >= 20 的机器, 无需公网入站端口 — 数据面为本代理主动外呼):
 *   XY_ADMIN_URL=https://你的后台地址
 *   XY_ENGINE_TOKEN=后台「监听服务」页该代理的接入令牌
 *   XY_PROXY_PORT=8765        (可选: 本地健康检查端口)
 *   XY_POLL_SECONDS=30        (可选: 配置轮询间隔, 默认 30)
 *   node xianyu-proxy.mjs
 *
 * 鉴权: 统一标准 `Authorization: Bearer <token>`, 无任何自定义 header。
 * 限速: 上报默认 1.5s 批量窗口 + 120 次/分钟对齐后台桶; 发送人化队列 0.8~2.5s + 12 条/分钟。
 * 风控: 设备指纹持久化(state.json)/心跳抖动/指数退避/风控挑战冷却阶梯/日志脱敏。
 */

import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ADMIN_URL = (process.env.XY_ADMIN_URL || '').replace(/\/+$/, '')
const ENGINE_TOKEN = process.env.XY_ENGINE_TOKEN || ''
const PROXY_PORT = Number(process.env.XY_PROXY_PORT || 0)
const POLL_SECONDS = Math.max(Number(process.env.XY_POLL_SECONDS || 30), 10)
const STATE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'xianyu-proxy.state.json')

if (!ADMIN_URL || !ENGINE_TOKEN) {
  console.error('[proxy] 缺少 XY_ADMIN_URL 或 XY_ENGINE_TOKEN 环境变量, 无法启动')
  process.exit(1)
}

/* ============================== 协议核心 (与后台 server/utils/xianyu/protocol.ts 同源) ============================== */

const APP_KEY = '444e9908a51d1cb236a27862abc769c9'
const SIGN_APP_KEY = '34839810'
const WEBSOCKET_URL = 'wss://wss-goofish.dingtalk.com/'
const TOKEN_API = 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.pc.login.token/1.0/'
const REGISTER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 DingTalk(2.1.5) OS(Windows/10) Browser(Chrome/133.0.0.0) DingWeb/2.1.5 IMPaaS DingWeb/2.1.5'
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

const md5Sign = (t, token, data) =>
  crypto.createHash('md5').update(`${token}&${t}&${SIGN_APP_KEY}&${data}`, 'utf8').digest('hex')

const transCookies = (str) => {
  const out = {}
  for (const part of String(str || '').split(';')) {
    const seg = part.trim()
    if (!seg) continue
    const eq = seg.indexOf('=')
    if (eq > 0) out[seg.slice(0, eq)] = seg.slice(eq + 1)
  }
  return out
}

const generateMid = () => `${Math.floor(Math.random() * 1000)}${Date.now()} 0`
const generateUuid = () => `-${Date.now()}1`

const DEVICE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
function generateDeviceId(userId) {
  const chars = []
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) chars.push('-')
    else if (i === 14) chars.push('4')
    else {
      const r = Math.floor(Math.random() * 16)
      chars.push(i === 19 ? DEVICE_CHARS[(r & 0x3) | 0x8] : DEVICE_CHARS[r])
    }
  }
  return chars.join('') + '-' + userId
}

class MsgPackReader {
  constructor(data) {
    this.data = data
    this.pos = 0
  }
  need(n) {
    if (this.pos + n > this.data.length) throw new Error('unexpected end of msgpack data')
  }
  readByte() {
    this.need(1)
    return this.data[this.pos++]
  }
  readBytes(n) {
    this.need(n)
    const out = this.data.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  u16() {
    return (this.readByte() << 8) | this.readByte()
  }
  u32() {
    return ((this.u16() << 16) | this.u16()) >>> 0
  }
  u64() {
    const hi = this.u32()
    const lo = this.u32()
    return hi * 0x100000000 + lo
  }
  str(n) {
    return new TextDecoder('utf-8').decode(this.readBytes(n))
  }
  readValue() {
    const b = this.readByte()
    if (b <= 0x7f) return b
    if (b >= 0xe0) return b - 0x100
    if (b >= 0x80 && b <= 0x8f) return this.readMap(b & 0x0f)
    if (b >= 0x90 && b <= 0x9f) return this.readArray(b & 0x0f)
    if (b >= 0xa0 && b <= 0xbf) return this.str(b & 0x1f)
    switch (b) {
      case 0xc0: return null
      case 0xc2: return false
      case 0xc3: return true
      case 0xc4: return this.readBytes(this.readByte())
      case 0xc5: return this.readBytes(this.u16())
      case 0xc6: return this.readBytes(this.u32())
      case 0xca: return new DataView(this.readBytes(4).slice().buffer).getFloat32(0, false)
      case 0xcb: return new DataView(this.readBytes(8).slice().buffer).getFloat64(0, false)
      case 0xcc: return this.readByte()
      case 0xcd: return this.u16()
      case 0xce: return this.u32()
      case 0xcf: return this.u64()
      case 0xd0: return (this.readByte() << 24) >> 24
      case 0xd1: return (this.u16() << 16) >> 16
      case 0xd2: return this.u32() | 0
      case 0xd3: return this.u64()
      case 0xd9: return this.str(this.readByte())
      case 0xda: return this.str(this.u16())
      case 0xdb: return this.str(this.u32())
      case 0xdc: return this.readArray(this.u16())
      case 0xdd: return this.readArray(this.u32())
      case 0xde: return this.readMap(this.u16())
      case 0xdf: return this.readMap(this.u32())
      default: throw new Error(`unknown msgpack format byte: 0x${b.toString(16)}`)
    }
  }
  readArray(n) {
    return Array.from({ length: n }, () => this.readValue())
  }
  readMap(n) {
    const out = {}
    for (let i = 0; i < n; i++) {
      const k = this.readValue()
      out[String(k)] = this.readValue()
    }
    return out
  }
}

function decodeSyncData(data) {
  const cleaned = String(data || '').replace(/[\u0100-\uffff]/g, '')
  let bytes
  try {
    bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0))
  } catch {
    const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4)
    bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
  }
  const asText = new TextDecoder('utf-8').decode(bytes)
  try {
    return JSON.parse(asText)
  } catch {
    const decoded = new MsgPackReader(bytes).readValue()
    if (decoded && typeof decoded === 'object') return decoded
    return JSON.parse(String(decoded))
  }
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

const buildRegisterMsg = (token, deviceId) =>
  JSON.stringify({
    lwp: '/reg',
    headers: {
      'cache-header': 'app-key token ua wv',
      'app-key': APP_KEY,
      token,
      ua: REGISTER_UA,
      dt: 'j',
      wv: 'im:3,au:3,sy:6',
      sync: '0,0;0;0;',
      did: deviceId,
      mid: generateMid(),
    },
  })

const buildAckDiffMsg = () => {
  const now = Date.now()
  return JSON.stringify({
    lwp: '/r/SyncStatus/ackDiff',
    headers: { mid: generateMid() },
    body: [
      {
        pipeline: 'sync',
        tooLong2Tag: 'PNM,1',
        channel: 'sync',
        topic: 'sync',
        highPts: 0,
        pts: now * 1000,
        seq: 0,
        timestamp: now,
      },
    ],
  })
}

const buildHeartbeatMsg = () => JSON.stringify({ lwp: '/!', headers: { mid: generateMid() } })

const buildAckMsg = (message) => {
  const headers = (message && message.headers) || {}
  const ack = { code: 200, headers: { mid: headers.mid ?? generateMid(), sid: headers.sid ?? '' } }
  if ('app-key' in headers) ack.headers['app-key'] = headers['app-key']
  if ('ua' in headers) ack.headers.ua = headers.ua
  if ('dt' in headers) ack.headers.dt = headers.dt
  return JSON.stringify(ack)
}

function messageSendFrame(cid, toid, myid, contentBase64) {
  return JSON.stringify({
    lwp: '/r/MessageSend/sendByReceiverScope',
    headers: { mid: generateMid() },
    body: [
      {
        uuid: generateUuid(),
        cid: `${cid}@goofish`,
        conversationType: 1,
        content: { contentType: 101, custom: { type: 1, data: contentBase64 } },
        redPointPolicy: 0,
        extension: { extJson: '{}' },
        ctx: { appVersion: '1.0', platform: 'web' },
        mtags: {},
        msgReadStatusSetting: 1,
      },
      { actualReceivers: [`${toid}@goofish`, `${myid}@goofish`] },
    ],
  })
}

const buildSendTextMsg = (cid, toid, myid, text) =>
  messageSendFrame(cid, toid, myid, utf8ToBase64(JSON.stringify({ contentType: 1, text: { text } })))

const buildSendImageMsg = (cid, toid, myid, imageUrl, width = 800, height = 600) =>
  messageSendFrame(
    cid,
    toid,
    myid,
    utf8ToBase64(
      JSON.stringify({
        contentType: 2,
        image: { pics: [{ height: Math.round(height), type: 0, url: imageUrl, width: Math.round(width) }] },
      }),
    ),
  )

const isSyncPackage = (message) => {
  try {
    const data = message?.body?.syncPushPackage?.data
    return Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

function extractOrderId(message) {
  try {
    const raw = JSON.stringify(message)
    const m = raw.match(/orderId=(\d+)/) || raw.match(/order_detail\?id=(\d+)/)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

function parseSyncItem(data, myId) {
  const message = decodeSyncData(data)
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null
  if ('chatType' in message) return null

  const redReminder = message?.['3']?.redReminder || ''
  let itemId = ''
  try {
    const url = message?.['1']?.['10']?.reminderUrl
    if (typeof url === 'string' && url.includes('itemId=')) {
      itemId = url.split('itemId=')[1].split('&')[0] || ''
    }
  } catch {}

  const m1 = message['1']
  const m10 = m1 && typeof m1 === 'object' ? m1['10'] : null
  if (!m10 || typeof m10 !== 'object') {
    if (redReminder) {
      return { kind: 'system', redReminder, itemId, buyerId: '', orderId: extractOrderId(message), chatId: '' }
    }
    return null
  }

  const senderUserId = String(m10.senderUserId ?? '')
  const senderNick = String(m10.senderNick ?? m10.reminderTitle ?? '未知用户')
  const content = String(m10.reminderContent ?? '')
  const chatIdRaw = String(m1['2'] ?? '')
  const chatId = chatIdRaw.split('@')[0] || chatIdRaw
  const createTime = Number(m1['5'] ?? 0)

  if (redReminder && !content) {
    return {
      kind: 'system',
      redReminder,
      itemId,
      buyerId: senderUserId,
      orderId: extractOrderId(message),
      chatId,
    }
  }

  return {
    kind: 'chat',
    chatId,
    senderUserId,
    senderNick,
    content,
    itemId,
    createTime,
    sessionType: String(m10.sessionType ?? '1'),
    isSelf: senderUserId === myId,
  }
}

function classifyTokenError(retList) {
  const joined = (retList || []).join(' ')
  if (!joined) return 'unknown'
  if (joined.includes('SUCCESS::调用成功')) return 'ok'
  if (
    joined.includes('FAIL_SYS_USER_VALIDATE') ||
    joined.includes('RGV587') ||
    joined.includes('x5sec') ||
    joined.includes('惩罚')
  ) {
    return 'risk'
  }
  if (joined.includes('SESSION_EXPIRED') || joined.includes('未登录') || joined.includes('FAIL_SYS_TOKEN_EMPTY')) {
    return 'auth'
  }
  return 'unknown'
}

const mtopHeaders = (cookieStr) => ({
  accept: 'application/json',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
  'content-type': 'application/x-www-form-urlencoded',
  pragma: 'no-cache',
  priority: 'u=1, i',
  'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent': CHROME_UA,
  referer: 'https://www.goofish.com/',
  origin: 'https://www.goofish.com',
  cookie: cookieStr,
})

const wsHeaders = (cookieStr) => ({
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Cache-Control': 'no-cache',
  Origin: 'https://www.goofish.com',
  Pragma: 'no-cache',
  'User-Agent': CHROME_UA,
  Cookie: cookieStr,
})

/* ============================== 本地状态 (仅设备指纹, 非业务状态) ============================== */

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
  } catch {
    return { devices: {} }
  }
}
const state = loadState()
function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (e) {
    log(`状态文件写入失败: ${e.message}`)
  }
}

/* ============================== 上行通道: 事件批量上报 + 动作执行 ============================== */

const pendingEvents = []
let flushTimer = null
const accountStates = new Map() // account -> { state, detail }
const accountClients = new Map() // account -> AccountClient

function reportStatus(account, state_, detail = '') {
  accountStates.set(account, { state: state_, detail })
}

async function postEvents(extra = {}) {
  const body = JSON.stringify({
    ...extra,
    status: { accounts: [...accountStates].map(([id, s]) => ({ id, state: s.state, detail: s.detail })) },
    events: pendingEvents.splice(0, pendingEvents.length),
  })
  const res = await fetch(`${ADMIN_URL}/api/engine/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ENGINE_TOKEN}` },
    body,
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after') || 5)
    log(`上报被限速, ${retry}s 后重试`)
    await sleep(retry * 1000)
    return postEvents(extra)
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.message || `上报失败 HTTP ${res.status}`)
  return json?.data || json || {}
}

function enqueueEvent(ev) {
  pendingEvents.push(ev)
  if (pendingEvents.length >= 100) {
    void flushNow()
    return
  }
  if (!flushTimer) flushTimer = setTimeout(() => void flushNow(), 1500)
}

async function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!pendingEvents.length) return
  try {
    const { actions = [] } = await postEvents()
    for (const action of actions) scheduleAction(action)
  } catch (e) {
    log(`事件上报失败: ${e.message} (丢弃本批 ${pendingEvents.length} 条, 下一批重试连接)`)
    pendingEvents.splice(0, pendingEvents.length)
  }
}

/* 发送人化队列: 每账号串行 + 随机间隔 + 滑动窗口限速 */
const sendQueues = new Map()
const sendTimestamps = new Map()

function scheduleAction(action) {
  const account = action.account
  const client = accountClients.get(account)
  if (!client) return
  const queue = sendQueues.get(account) || Promise.resolve()
  const run = async () => {
    if (action.delay_ms > 0) await sleep(action.delay_ms)
    let stamps = sendTimestamps.get(account) || []
    stamps = stamps.filter((t) => Date.now() - t < 60_000)
    if (stamps.length >= 12) {
      await sleep(60_000 - (Date.now() - stamps[0]) + 500)
    }
    await sleep(800 + Math.floor(Math.random() * 1700))
    if (action.type === 'send_text') await client.sendText(action.chat_id, action.to_user_id, action.text)
    else if (action.type === 'send_image')
      await client.sendImage(action.chat_id, action.to_user_id, action.image_url, action.width, action.height)
    stamps.push(Date.now())
    sendTimestamps.set(account, stamps)
    log(`已发送 ${action.type} → ${account} (${action.to_user_id})`)
  }
  const next = queue.then(run, run)
  sendQueues.set(account, next.catch(() => {}))
}

/* ============================== 账号客户端 ============================== */

const RISK_LADDER = [300, 600, 1200, 1800]

class AccountClient {
  constructor(accountId, cookieStr, deviceId) {
    this.id = accountId
    this.cookieStr = cookieStr
    this.deviceId = deviceId || state.devices[accountId] || generateDeviceId(transCookies(cookieStr).unb || accountId)
    state.devices[accountId] = this.deviceId
    saveState()
    this.myId = transCookies(cookieStr).unb || ''
    this.stopped = false
    this.token = ''
    this.lastTokenRefresh = 0
    this.riskCooldownUntil = 0
    this.riskLadderIndex = 0
    this.lastRiskTripAt = 0
    this.failures = 0
    this.generation = 0
  }

  updateCookie(cookieStr) {
    this.cookieStr = cookieStr
    this.myId = transCookies(cookieStr).unb || this.myId
  }

  async start() {
    reportStatus(this.id, 'connecting', '启动')
    this.loop()
  }

  async stop() {
    this.stopped = true
    this.generation++
    try {
      this.ws?.close?.()
    } catch {}
    reportStatus(this.id, 'disabled', '代理停止该账号')
  }

  async loop() {
    while (!this.stopped) {
      const remainMs = this.riskCooldownUntil - Date.now()
      if (remainMs > 0) {
        reportStatus(this.id, 'risk_cooldown', `冷却 ${Math.ceil(remainMs / 1000)}s`)
        await sleep(Math.min(remainMs, 30_000))
        continue
      }
      try {
        await this.connectOnce()
      } catch (e) {
        if (this.stopped) return
        this.failures++
        const delay = Math.min(300_000, 5_000 * 2 ** Math.min(this.failures, 6)) * (0.8 + Math.random() * 0.4)
        reportStatus(this.id, 'reconnecting', `${Math.round(delay / 1000)}s 后重连`)
        log(`[${this.id}] 断开: ${e.message} → ${Math.round(delay / 1000)}s 后重连`)
        await sleep(delay)
      }
    }
  }

  async refreshToken() {
    const cookies = transCookies(this.cookieStr)
    const t = String(Date.now())
    const h5tk = cookies['_m_h5_tk'] || ''
    const dataVal = JSON.stringify({ appKey: '444e9908a51d1cb236a27862abc769c9', deviceId: this.deviceId })
    const params = new URLSearchParams({
      jsv: '2.7.2',
      appKey: '34839810',
      t,
      sign: md5Sign(t, h5tk ? h5tk.split('_')[0] : '', dataVal),
      v: '1.0',
      type: 'originaljson',
      accountSite: 'xianyu',
      dataType: 'json',
      timeout: '20000',
      api: 'mtop.taobao.idlemessage.pc.login.token',
      sessionOption: 'AutoLoginOnly',
      dangerouslySetWindvaneParams: '%5Bobject%20Object%5D',
      smToken: 'token',
      queryToken: 'sm',
      sm: 'sm',
      spm_cnt: 'a21ybx.im.0.0',
      spm_pre: 'a21ybx.home.sidebar.1.4c053da6vYwnmf',
      log_id: '4c053da6vYwnmf',
    })
    const res = await fetch(`${TOKEN_API}?${params}`, {
      method: 'POST',
      headers: mtopHeaders(this.cookieStr),
      body: new URLSearchParams({ data: dataVal }).toString(),
      signal: AbortSignal.timeout(30_000),
    })
    const json = await res.json().catch(() => ({}))
    const ret = Array.isArray(json?.ret) ? json.ret : []
    const merged = { ...cookies }
    try {
      for (const sc of res.headers.getSetCookie?.() || []) {
        const [pair] = sc.split(';')
        const eq = pair.indexOf('=')
        if (eq > 0) merged[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
      }
    } catch {}
    const verdict = classifyTokenError(ret)
    if (verdict === 'ok' && json?.data?.accessToken) {
      this.token = json.data.accessToken
      this.lastTokenRefresh = Date.now()
      const mergedStr = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ')
      if (mergedStr !== this.cookieStr) this.cookieStr = mergedStr
      return
    }
    if (verdict === 'risk') {
      this.tripRisk(`token 接口风控拦截: ${ret.join('; ')}`)
      return
    }
    if (verdict === 'auth') {
      reportStatus(this.id, 'need_relogin', '登录态失效, 请在后台重新扫码')
      throw new Error('登录态失效')
    }
    throw new Error(`token 刷新未成功: ${ret.join('; ') || '空响应'}`)
  }

  tripRisk(description) {
    const now = Date.now()
    if (now - this.lastRiskTripAt > 30 * 60_000) this.riskLadderIndex = 0
    this.lastRiskTripAt = now
    const seconds = RISK_LADDER[Math.min(this.riskLadderIndex, RISK_LADDER.length - 1)]
    this.riskLadderIndex++
    this.riskCooldownUntil = now + seconds * 1000
    this.token = ''
    enqueueEvent({ type: 'risk', account: this.id, description })
    log(`[${this.id}] 触发风控: ${description} → 静默 ${seconds}s`)
  }

  async connectOnce() {
    const gen = ++this.generation
    reportStatus(this.id, 'connecting', '建立连接')
    if (!this.token || Date.now() - this.lastTokenRefresh > 3600_000) {
      await this.refreshToken()
    }
    if (!this.token) {
      // token 获取失败(含风控冷却): 立即中止本轮建连, 由冷却/退避机制控制重试节奏
      throw new Error('Token 获取失败')
    }

    const ws = await createWs(WEBSOCKET_URL, wsHeaders(this.cookieStr))
    this.ws = ws
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onErr = (err) => {
        cleanup()
        reject(new Error(err?.message || 'WebSocket 握手失败'))
      }
      const cleanup = () => {
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onErr)
      }
      ws.addEventListener('open', onOpen)
      ws.addEventListener('error', onErr)
      setTimeout(() => {
        cleanup()
        reject(new Error('WebSocket 握手超时'))
      }, 20_000).unref?.()
    })

    ws.send(buildRegisterMsg(this.token, this.deviceId))
    await sleep(1000)
    if (gen !== this.generation || this.stopped) return
    ws.send(buildAckDiffMsg())

    this.failures = 0
    this.riskLadderIndex = 0
    reportStatus(this.id, 'listening', '监听中')
    log(`[${this.id}] 闲鱼消息通道已建立`)

    // 心跳 (15s ± 15% 抖动)
    let hbTimer = null
    const tick = () => {
      if (this.stopped || gen !== this.generation) return
      try {
        if (ws.readyState === 1) ws.send(buildHeartbeatMsg())
      } catch {}
      hbTimer = setTimeout(tick, 15_000 * (0.85 + Math.random() * 0.3))
    }
    hbTimer = setTimeout(tick, 15_000 * (0.85 + Math.random() * 0.3))

    await new Promise((resolve) => {
      ws.addEventListener('message', (ev) => {
        if (gen !== this.generation || this.stopped) return resolve()
        const raw = typeof ev.data === 'string' ? ev.data : ''
        if (!raw) return
        let message
        try {
          message = JSON.parse(raw)
        } catch {
          return
        }
        try {
          if (!('code' in message)) {
            try {
              ws.send(buildAckMsg(message))
            } catch {}
          }
          if (isSyncPackage(message)) {
            for (const item of message.body.syncPushPackage.data || []) {
              if (!item?.data) continue
              try {
                const parsed = parseSyncItem(item.data, this.myId)
                if (!parsed) continue
                if (parsed.kind === 'chat') {
                  enqueueEvent({
                    type: 'chat',
                    account: this.id,
                    chat_id: parsed.chatId,
                    sender_user_id: parsed.senderUserId,
                    sender_nick: parsed.senderNick,
                    content: parsed.content,
                    item_id: parsed.itemId,
                    create_time: parsed.createTime,
                    session_type: parsed.sessionType,
                    is_self: parsed.isSelf,
                  })
                } else {
                  enqueueEvent({
                    type: 'system',
                    account: this.id,
                    red_reminder: parsed.redReminder,
                    item_id: parsed.itemId,
                    buyer_id: parsed.buyerId,
                    order_id: parsed.orderId,
                    chat_id: parsed.chatId,
                  })
                }
              } catch (e) {
                log(`[${this.id}] 同步包解析失败: ${e.message}`)
              }
            }
          }
        } catch (e) {
          log(`[${this.id}] 消息处理异常: ${e.message}`)
        }
      })
      ws.addEventListener('close', () => resolve())
      ws.addEventListener('error', () => resolve())
    })

    if (hbTimer) clearTimeout(hbTimer)
  }

  sendText(chatId, toUserId, text) {
    this.wsSend(buildSendTextMsg(chatId, toUserId, this.myId, text))
  }
  sendImage(chatId, toUserId, imageUrl, width = 800, height = 600) {
    this.wsSend(buildSendImageMsg(chatId, toUserId, this.myId, imageUrl, width, height))
  }
  wsSend(frame) {
    const ws = this.ws
    if (!ws || ws.readyState !== 1) throw new Error('连接未就绪, 发送取消')
    ws.send(frame)
  }
}

async function createWs(url, headers) {
  try {
    return new WebSocket(url, { headers })
  } catch {
    let Ws
    try {
      Ws = (await import('ws')).default
    } catch {
      throw new Error('当前 Node 版本不支持原生 WebSocket, 请升级 Node >= 22 或在本目录 npm i ws')
    }
    return new Ws(url, { headers })
  }
}

/* ============================== 配置轮询 + 健康服务 ============================== */

async function pollConfig() {
  const res = await fetch(`${ADMIN_URL}/api/engine/config`, {
    headers: { authorization: `Bearer ${ENGINE_TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 401 || res.status === 403) {
    log('令牌无效/被停用, 请检查后台「监听服务」页配置')
    return
  }
  const json = await res.json().catch(() => ({}))
  const data = json?.data || json || {}

  if (!data.active) {
    for (const [id, client] of accountClients) {
      await client.stop()
      accountClients.delete(id)
    }
    log('本代理当前非使用中引擎, 已全部下线待命')
    return
  }

  const wanted = new Map((data.accounts || []).map((a) => [a.id, a]))
  for (const [id, client] of [...accountClients]) {
    if (!wanted.has(id)) {
      await client.stop()
      accountClients.delete(id)
    }
  }
  for (const account of data.accounts || []) {
    const existing = accountClients.get(account.id)
    if (existing) {
      if (existing.cookieStr !== account.cookies) {
        existing.updateCookie(account.cookies)
        log(`[${account.id}] Cookie 已从后台更新`)
      }
      continue
    }
    const client = new AccountClient(account.id, account.cookies, account.device_id || '')
    accountClients.set(account.id, client)
    void client.start()
  }
}

function startHealthServer() {
  if (!PROXY_PORT) return
  const healthHits = new Map() // ip -> [ts] 滑动窗口限速 60 次/分钟
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    const okAuth =
      token.length === ENGINE_TOKEN.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ENGINE_TOKEN))
    if (!okAuth) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: '需要 Authorization: Bearer <token>' }))
      return
    }
    const ip = req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    const hits = (healthHits.get(ip) || []).filter((t) => now - t < 60_000)
    if (hits.length >= 60) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' })
      res.end(JSON.stringify({ error: '请求过于频繁, 限速 60 次/分钟' }))
      return
    }
    hits.push(now)
    healthHits.set(ip, hits)
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: true,
          accounts: [...accountStates].map(([id, s]) => ({ id, state: s.state })),
          uptime_s: Math.round(process.uptime()),
        }),
      )
      return
    }
    res.writeHead(404)
    res.end()
  })
  server.on('error', (e) => {
    // 健康服务为可选功能: 端口被占等情况只告警, 绝不影响监听主流程
    log(`健康检查服务启动失败(${e.code || e.message}), 继续以无健康服务模式运行`)
  })
  server.listen(PROXY_PORT, () => log(`健康检查服务已启动: http://0.0.0.0:${PROXY_PORT}/health (Bearer 鉴权 + 60 次/分钟限速)`))
}

function log(msg) {
  console.log(`[xianyu-proxy ${new Date().toLocaleString('zh-CN')}] ${msg}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ============================== 入口 ============================== */

// 守护进程健壮性: 瞬时网络错误/未处理拒绝绝不允许击杀监听主流程
process.on('unhandledRejection', (reason) => {
  log(`未处理的 Promise 拒绝 (已兜底): ${reason?.message || reason}`)
})
process.on('uncaughtException', (err) => {
  log(`未捕获异常 (已兜底): ${err?.message || err}`)
})

log(`远程监听代理启动 → 后台 ${ADMIN_URL}`)
startHealthServer()

let pollBusy = false
setInterval(async () => {
  if (pollBusy) return
  pollBusy = true
  try {
    await pollConfig()
  } catch (e) {
    log(`配置轮询失败: ${e.message}`)
  } finally {
    pollBusy = false
  }
}, POLL_SECONDS * 1000)

// 空闲心跳: 无消息时也保持 engines.last_seen_at 新鲜
setInterval(() => void flushNow(), 30_000)

void pollConfig()

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('收到退出信号, 正在停止全部账号连接…')
    for (const client of accountClients.values()) void client.stop()
    process.exit(0)
  })
}
