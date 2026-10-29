/**
 * xianyu-edge-listener — 闲鱼监听 Cloudflare Edge 版 (Durable Object)。
 *
 * 形态依据 (Edgechat 同款): Cloudflare Pages 无法定义 DO 类, 监听器必须是
 * 独立 Worker (wrangler deploy 一次, 之后零维护, 免费额度外需 Workers Paid)。
 *
 * 平台能力 (已实测/官方文档背书):
 *   - workerd 出站 WebSocket: fetch(url, { headers: { Upgrade: 'websocket', ...自定义 } })
 *     → response.webSocket → accept()。实测 Cookie/UA/Origin/Authorization 全部
 *     原样透传到上游握手 (workerd 本地模式验证)。
 *   - 出站连接打开期间 DO 不会被驱逐 (官方: an open outbound WebSocket connection
 *     prevents eviction for up to 15 minutes; 任意 I/O 延长驻留) → 1s alarm tick
 *     永续保活, 消息事件全程可收。
 *
 * 对接协议与 scripts/xianyu-proxy.mjs 完全一致:
 *   GET  /api/engine/config — 拉账号配置 (30s 轮询)
 *   POST /api/engine/events — 上报状态/事件, 回收决策动作
 * 业务规则全部在后台; 本 Worker 只做监听转发与动作执行。
 *
 * 运行时差异 (相对 Node 版): setInterval 主循环 → DO alarm 状态机;
 * node:crypto md5 → nodejs_compat 提供; UA 用恒定 Chrome 串 (edge 无本地
 * Chromium 可探测, 风控硬约束是"恒定一致", 恒定满足)。
 */

import { createHash } from 'node:crypto'

/* ----------------- 协议常量与纯函数 (与 server/utils/xianyu/protocol.ts 同源) ----------------- */

const APP_KEY = '444e9908a51d1cb236a27862abc769c9'
const SIGN_APP_KEY = '34839810'
const WEBSOCKET_URL = 'wss://wss-goofish.dingtalk.com/'
const TOKEN_API = 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.pc.login.token/1.0/'

const FALLBACK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

function chromeVersion() {
  return FALLBACK_UA.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '133.0.0.0'
}

function mtopHeaders(cookieStr) {
  const version = chromeVersion()
  const major = version.split('.')[0]
  return {
    accept: 'application/json',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    'content-type': 'application/x-www-form-urlencoded',
    pragma: 'no-cache',
    priority: 'u=1, i',
    'sec-ch-ua': `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not?A_Brand";v="99"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': FALLBACK_UA,
    referer: 'https://www.goofish.com/',
    origin: 'https://www.goofish.com',
    cookie: cookieStr,
  }
}

function wsHeaders(cookieStr) {
  return {
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    Origin: 'https://www.goofish.com',
    Pragma: 'no-cache',
    'User-Agent': FALLBACK_UA,
    Cookie: cookieStr,
  }
}

function registerUA() {
  const version = chromeVersion()
  return `${FALLBACK_UA} DingTalk(2.1.5) OS(Windows/10) Browser(Chrome/${version}) DingWeb/2.1.5 IMPaaS DingWeb/2.1.5`
}

function md5Sign(t, token, data) {
  return createHash('md5').update(`${token}&${t}&${SIGN_APP_KEY}&${data}`, 'utf8').digest('hex')
}

function transCookies(cookieStr) {
  const out = {}
  for (const part of String(cookieStr || '').split(';')) {
    const seg = part.trim()
    if (!seg) continue
    const eq = seg.indexOf('=')
    if (eq > 0) out[seg.slice(0, eq)] = seg.slice(eq + 1)
  }
  return out
}

function generateMid() {
  return `${Math.floor(Math.random() * 1000)}${Date.now()} 0`
}

function generateUuid() {
  return `-${Date.now()}1`
}

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

/* --------------------- MessagePack 解码 (与后台 protocol.ts 同源) --------------------- */

class MsgPackReader {
  pos = 0
  constructor(data) {
    this.data = data
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
    return hi * 0x1_0000_0000 + lo
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
      case 0xca: {
        const view = new DataView(this.readBytes(4).slice().buffer)
        return view.getFloat32(0, false)
      }
      case 0xcb: {
        const view = new DataView(this.readBytes(8).slice().buffer)
        return view.getFloat64(0, false)
      }
      case 0xcc: return this.readByte()
      case 0xcd: return this.u16()
      case 0xce: return this.u32()
      case 0xcf: return this.u64()
      case 0xd0: return (this.readByte() << 24) >> 24
      case 0xd1: return (this.u16() << 16) >> 16
      case 0xd2: return (this.u32() | 0)
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

function decodeMessagePack(bytes) {
  return new MsgPackReader(bytes).readValue()
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
    const decoded = decodeMessagePack(bytes)
    if (decoded && typeof decoded === 'object') return decoded
    return JSON.parse(String(decoded))
  }
}

/* --------------------- 报文构造 (与后台 protocol.ts 同源) --------------------- */

function buildRegisterMsg(token, deviceId) {
  return JSON.stringify({
    lwp: '/reg',
    headers: {
      'cache-header': 'app-key token ua wv',
      'app-key': APP_KEY,
      token,
      ua: registerUA(),
      dt: 'j',
      wv: 'im:3,au:3,sy:6',
      sync: '0,0;0;0;',
      did: deviceId,
      mid: generateMid(),
    },
  })
}

function buildSyncStateMsg() {
  return JSON.stringify({
    lwp: '/r/SyncStatus/getState',
    headers: { mid: generateMid() },
    body: [{ topic: 'sync' }],
  })
}

function buildAckDiffMsg(serverState) {
  const now = Date.now()
  const state =
    serverState && typeof serverState === 'object'
      ? serverState
      : {
          pipeline: 'sync',
          tooLong2Tag: 'PNM,1',
          channel: 'sync',
          topic: 'sync',
          highPts: 0,
          pts: now * 1000,
          seq: 0,
          timestamp: now,
        }
  return JSON.stringify({
    lwp: '/r/SyncStatus/ackDiff',
    headers: { mid: generateMid() },
    body: [state],
  })
}

function buildHeartbeatMsg() {
  return JSON.stringify({ lwp: '/!', headers: { mid: generateMid() } })
}

function buildAckMsg(message) {
  const headers = (message && message.headers) || {}
  const ack = {
    code: 200,
    headers: {
      mid: headers.mid ?? generateMid(),
      sid: headers.sid ?? '',
    },
  }
  if ('app-key' in headers) ack.headers['app-key'] = headers['app-key']
  if ('ua' in headers) ack.headers.ua = headers.ua
  if ('dt' in headers) ack.headers.dt = headers.dt
  return JSON.stringify(ack)
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

function buildSendTextMsg(cid, toid, myid, text) {
  const payload = JSON.stringify({ contentType: 1, text: { text } })
  return messageSendFrame(cid, toid, myid, utf8ToBase64(payload))
}

function buildSendImageMsg(cid, toid, myid, imageUrl, width = 800, height = 600) {
  const payload = JSON.stringify({
    contentType: 2,
    image: { pics: [{ height: Math.round(height), type: 0, url: imageUrl, width: Math.round(width) }] },
  })
  return messageSendFrame(cid, toid, myid, utf8ToBase64(payload))
}

/* --------------------- 下行解析 (与后台 protocol.ts 同源) --------------------- */

function isSyncPackage(message) {
  try {
    const data = message?.body?.syncPushPackage?.data
    return Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

function extractOrderId(message) {
  try {
    const contentJsonStr = String(message?.['1']?.['6']?.['3']?.['5'] ?? '')
    if (contentJsonStr) {
      let card = null
      try {
        card = JSON.parse(contentJsonStr)
      } catch {}
      if (card) {
        const ex = card?.dxCard?.item?.main?.exContent
        const main = card?.dxCard?.item?.main
        const dyn = card?.dynamicOperation?.changeContent?.dxCard?.item?.main
        for (const url of [ex?.button?.targetUrl, main?.targetUrl, dyn?.exContent?.button?.targetUrl, dyn?.targetUrl]) {
          if (typeof url !== 'string' || !url) continue
          const m = url.match(/orderId=(\d+)/) || url.match(/order_detail\?id=(\d+)/)
          if (m) return m[1]
        }
      }
    }
    const raw = JSON.stringify(message)
    const patterns = [
      /orderId[=:](\d{10,})/,
      /order_detail\?id=(\d{10,})/,
      /bizOrderId[=:](\d{10,})/,
      /"id"\s*:\s*"?(\d{10,})"?/,
    ]
    for (const p of patterns) {
      const m = raw.match(p)
      if (m) return m[1]
    }
    return ''
  } catch {
    return ''
  }
}

function parseTradeCard(message) {
  try {
    const contentJsonStr = String(message?.['1']?.['6']?.['3']?.['5'] ?? '')
    if (!contentJsonStr) return { title: '', amount: '' }
    let card = null
    try {
      card = JSON.parse(contentJsonStr)
    } catch {
      return { title: '', amount: '' }
    }
    const ex = card?.dxCard?.item?.main?.exContent || {}
    const title = String(ex.title || '')
    let amount = ''
    for (const key of ['price', 'priceText', 'amount', 'payAmount']) {
      const v = ex[key]
      if (v != null && String(v).trim()) {
        amount = String(v).replace(/[¥￥\s]/g, '')
        break
      }
    }
    if (!amount) {
      const priceList = Array.isArray(ex.priceList) ? ex.priceList : []
      for (const p of priceList) {
        const t = String(p?.text || p?.price || '')
        if (/[\d.]/.test(t)) {
          amount = t.replace(/[¥￥\s]/g, '')
          break
        }
      }
    }
    if (!amount) {
      const m = contentJsonStr.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/)
      if (m) amount = m[1]
    }
    return { title, amount }
  } catch {
    return { title: '', amount: '' }
  }
}

function extractItemId(message) {
  try {
    const url = message?.['1']?.['10']?.reminderUrl
    if (typeof url === 'string' && url.includes('itemId=')) {
      return url.split('itemId=')[1].split('&')[0] || ''
    }
  } catch {}
  try {
    const m3 = message?.['3']
    if (m3 && typeof m3 === 'object') {
      for (const seg of [m3.extension, m3.bizData]) {
        if (seg && typeof seg === 'object') {
          const v = seg.itemId || seg.item_id
          if (v != null && String(v).trim()) return String(v)
        }
      }
      for (const value of Object.values(m3)) {
        if (value && typeof value === 'object') {
          const v = value.itemId || value.item_id
          if (v != null && String(v).trim()) return String(v)
        }
      }
      const content = m3.content
      if (typeof content === 'string' && content) {
        const m = content.match(/(\d{10,})/)
        if (m) return m[1]
      }
    }
  } catch {}
  return ''
}

function parseSyncItem(data, myId) {
  const message = decodeSyncData(data)
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null
  if ('chatType' in message) return null

  const redReminder = message?.['3']?.redReminder || ''
  const itemId = extractItemId(message)
  const card = parseTradeCard(message)

  const m1 = message['1']
  const m10 = m1 && typeof m1 === 'object' ? m1['10'] : null
  if (!m10 || typeof m10 !== 'object') {
    if (redReminder) {
      return {
        kind: 'system',
        redReminder,
        itemId,
        buyerId: '',
        orderId: extractOrderId(message),
        chatId: '',
        cardTitle: card.title,
        amount: card.amount,
      }
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
      cardTitle: card.title,
      amount: card.amount,
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
  if (joined.includes('FAIL_SYS_TOKEN_EMPTY') || joined.includes('FAIL_SYS_TOKEN_EXOIRED')) {
    return 'token_roll'
  }
  if (joined.includes('SESSION_EXPIRED') || joined.includes('未登录')) {
    return 'auth'
  }
  return 'unknown'
}

/* --------------------- mtop token (与 ws-client.ts 同源) --------------------- */

async function fetchTokenDetailed(cookieStr, deviceId) {
  const dataVal = JSON.stringify({ appKey: APP_KEY, deviceId })

  const callOnce = async (useCookie) => {
    const cookies = transCookies(useCookie)
    const h5tk = cookies['_m_h5_tk'] || ''
    const signToken = h5tk ? h5tk.split('_')[0] : ''
    const t = String(Date.now())
    const params = new URLSearchParams({
      jsv: '2.7.2',
      appKey: '34839810',
      t,
      sign: md5Sign(t, signToken, dataVal),
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
    const res = await fetch(`${TOKEN_API}?${params.toString()}`, {
      method: 'POST',
      headers: mtopHeaders(useCookie),
      body: new URLSearchParams({ data: dataVal }).toString(),
    })
    const json = await res.json().catch(() => ({}))
    const ret = Array.isArray(json?.ret) ? json.ret : []
    const merged = { ...cookies }
    try {
      const setCookies = res.headers.getSetCookie?.() || []
      for (const sc of setCookies) {
        const [pair] = sc.split(';')
        const eq = pair.indexOf('=')
        if (eq > 0) merged[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
      }
    } catch {}
    const token = json?.data?.accessToken || ''
    const punishUrl = typeof json?.data?.url === 'string' ? json.data.url : ''
    return { token, mergedCookies: merged, ret, punishUrl }
  }

  const first = await callOnce(cookieStr)
  const firstVerdict = classifyTokenError(first.ret)
  if (firstVerdict === 'token_roll') {
    const rolled = Object.entries(first.mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
    const second = await callOnce(rolled)
    const finalCookies = { ...first.mergedCookies, ...second.mergedCookies }
    return { ...second, mergedCookies: finalCookies }
  }
  return first
}

/* --------------------- workerd 出站 WebSocket 适配 --------------------- */

/**
 * workerd 里建立带自定义握手头的出站 WebSocket:
 * fetch + Upgrade: websocket (fetch 的 headers 不受浏览器限制, 实测 Cookie/UA 透传)
 * → response.webSocket → accept()。握手失败 (非 101) 时 webSocket 为 null。
 */
async function connectWs(url, headers) {
  const resp = await fetch(url, {
    headers: {
      ...headers,
      Upgrade: 'websocket',
    },
  })
  const ws = resp.webSocket
  if (!ws) {
    throw new Error(`WS 握手失败 (HTTP ${resp.status})`)
  }
  ws.accept()
  return ws
}

/* --------------------- 账号客户端 (proxy.mjs 状态机化) --------------------- */

const RISK_LADDER_SECONDS = [300, 600, 1200, 1800]
const RISK_LADDER_WINDOW_MS = 30 * 60 * 1000
const TOKEN_REFRESH_MS = 3600 * 1000
const SEND_WINDOW_MS = 60_000
const SEND_MAX_PER_WINDOW = 12
const HANDSHAKE_TIMEOUT_MS = 20_000

function jitter(ms, ratio = 0.15) {
  return Math.round(ms * (1 - ratio + Math.random() * ratio * 2))
}

function backoffDelay(failures) {
  const base = Math.min(300_000, 5_000 * Math.pow(2, Math.min(failures, 6)))
  return jitter(base, 0.2)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

class XianyuAccountClient {
  /**
   * @param account {id, cookies, device_id}
   * @param host DO 宿主 (提供 env/log/sink/markDirty)
   */
  constructor(account, host) {
    this.cookieId = String(account.id)
    this.host = host
    this.cookieStr = String(account.cookies || '')
    this.deviceId = String(account.device_id || '') || generateDeviceId(transCookies(this.cookieStr)['unb'] || this.cookieId)
    const cookies = transCookies(this.cookieStr)
    this.myId = cookies['unb'] || ''
    if (!this.myId) throw new Error(`账号 ${this.cookieId} Cookie 缺少 unb 字段, 无法监听`)

    this.ws = null
    this.state = 'connecting'
    this.stateDetail = ''
    this.stopped = false
    this.token = ''
    this.lastTokenRefresh = 0
    this.nextHeartbeatAt = 0
    this.riskCooldownUntil = 0
    this.riskLadderIndex = 0
    this.lastRiskTripAt = 0
    this.riskStreak = 0
    this.connectionFailures = 0
    this.nextConnectAt = 0
    this.generation = 0
    this.connecting = false

    this.sendChain = Promise.resolve()
    this.sendTimestamps = []
    this.pendingRequests = new Map()
  }

  restoreRuntime(rt) {
    if (!rt || typeof rt !== 'object') return
    if (rt.cookieStr) this.cookieStr = String(rt.cookieStr)
    if (rt.deviceId) this.deviceId = String(rt.deviceId)
    if (rt.token) this.token = String(rt.token)
    if (rt.lastTokenRefresh) this.lastTokenRefresh = Number(rt.lastTokenRefresh) || 0
    if (rt.riskCooldownUntil) this.riskCooldownUntil = Number(rt.riskCooldownUntil) || 0
    if (rt.riskLadderIndex) this.riskLadderIndex = Number(rt.riskLadderIndex) || 0
    if (rt.riskStreak) this.riskStreak = Number(rt.riskStreak) || 0
    if (rt.lastRiskTripAt) this.lastRiskTripAt = Number(rt.lastRiskTripAt) || 0
    if (rt.state && rt.state !== 'listening') {
      this.state = String(rt.state)
      this.stateDetail = String(rt.detail || '')
    }
    // 重启后强制走一次重连调度 (连接在内存里, 不会随 DO 恢复)
    this.nextConnectAt = 0
  }

  snapshotRuntime() {
    return {
      cookieStr: this.cookieStr,
      deviceId: this.deviceId,
      token: '',
      lastTokenRefresh: this.lastTokenRefresh,
      riskCooldownUntil: this.riskCooldownUntil,
      riskLadderIndex: this.riskLadderIndex,
      riskStreak: this.riskStreak,
      lastRiskTripAt: this.lastRiskTripAt,
      state: this.state,
      detail: this.stateDetail,
    }
  }

  setState(state, detail = '') {
    if (this.state !== state || detail !== this.stateDetail) {
      this.state = state
      this.stateDetail = detail
      this.host.sink.onState(this.cookieId, state, detail)
      this.host.markDirty(this.cookieId)
    }
  }

  /** 每秒 tick: 按时间戳调度 (风控冷却/重连/心跳/token 刷新)。 */
  async onTick(now) {
    if (this.stopped) return

    if (this.riskCooldownUntil > now) {
      if (this.state !== 'risk_cooldown') {
        this.setState('risk_cooldown', `风控冷却 ${Math.ceil((this.riskCooldownUntil - now) / 1000)}s`)
      }
      return
    }
    if (this.state === 'risk_cooldown') {
      this.setState('connecting', '冷却结束, 重连中')
      this.nextConnectAt = 0
    }

    // 协议请求超时清理
    for (const [mid, pending] of [...this.pendingRequests]) {
      if (pending.dueAt <= now) {
        this.pendingRequests.delete(mid)
        clearTimeout(pending.timer)
        pending.reject(new Error('WS 协议请求超时'))
      }
    }

    // token 定期刷新
    if (now - this.lastTokenRefresh > jitter(TOKEN_REFRESH_MS, 0.08)) {
      await this.refreshTokenSafely()
    }

    // 心跳
    if (this.ws && this.ws.readyState === 1 && this.nextHeartbeatAt && now >= this.nextHeartbeatAt) {
      try {
        this.ws.send(buildHeartbeatMsg())
      } catch {}
      this.nextHeartbeatAt = now + jitter(15_000, 0.15)
    }

    // 重连调度 (互斥: 同一时刻只有一个 connectOnce 在跑)
    if (!this.ws || this.ws.readyState !== 1) {
      if (!this.connecting && now >= this.nextConnectAt) {
        this.connecting = true
        const gen = ++this.generation
        try {
          await this.connectOnce(gen, now)
        } catch (e) {
          this.connectionFailures++
          const delay = backoffDelay(this.connectionFailures)
          this.nextConnectAt = Date.now() + delay
          this.setState('reconnecting', `第 ${this.connectionFailures} 次断开, ${Math.round(delay / 1000)}s 后重连`)
          this.host.log(`账号 ${this.cookieId} 连接异常: ${e?.message} → ${Math.round(delay / 1000)}s 后重连`)
        } finally {
          this.connecting = false
        }
      }
    }
  }

  async connectOnce(gen, now) {
    this.setState('connecting', '建立连接')

    if (!this.token || now - this.lastTokenRefresh > TOKEN_REFRESH_MS) {
      await this.refreshTokenSafely()
      if (this.stopped || gen !== this.generation) return
      if (!this.token) throw new Error('Token 获取失败')
    }

    const ws = await connectWs(WEBSOCKET_URL, wsHeaders(this.cookieStr))
    if (gen !== this.generation || this.stopped) {
      try { ws.close(1000, 'superseded') } catch {}
      return
    }
    this.ws = ws

    ws.send(buildRegisterMsg(this.token, this.deviceId))
    await sleep(1000)
    if (gen !== this.generation || this.stopped) return
    try {
      const stateResp = await this.requestRaw(buildSyncStateMsg(), 8000)
      const serverState = Array.isArray(stateResp?.body) ? stateResp.body[0] : stateResp?.body
      ws.send(buildAckDiffMsg(serverState))
    } catch {
      ws.send(buildAckDiffMsg())
    }

    this.connectionFailures = 0
    this.riskLadderIndex = 0
    this.nextHeartbeatAt = Date.now() + jitter(15_000, 0.15)
    this.setState('listening', '监听中')
    this.host.log(`账号 ${this.cookieId} 闲鱼消息通道已建立 (edge)`)

    this.attachReceiveHandlers(gen, ws)
  }

  attachReceiveHandlers(gen, ws) {
    ws.addEventListener('message', (ev) => {
      if (gen !== this.generation || this.stopped) return
      const raw = typeof ev.data === 'string' ? ev.data : ''
      if (!raw) return
      let message
      try {
        message = JSON.parse(raw)
      } catch {
        return
      }
      try {
        const mid = message?.headers?.mid
        if (mid && this.pendingRequests.has(mid)) {
          const pending = this.pendingRequests.get(mid)
          this.pendingRequests.delete(mid)
          clearTimeout(pending.timer)
          pending.resolve(message)
          return
        }
        if (!('code' in message)) {
          try {
            ws.send(buildAckMsg(message))
          } catch {}
        }
        if (isSyncPackage(message)) {
          const items = message.body.syncPushPackage.data || []
          for (const item of items) {
            if (!item?.data) continue
            try {
              const parsed = parseSyncItem(item.data, this.myId)
              if (!parsed) continue
              if (parsed.kind === 'chat') this.host.sink.onChat(this.cookieId, parsed)
              else this.host.sink.onSystem(this.cookieId, parsed)
            } catch (e) {
              this.host.log(`账号 ${this.cookieId} 同步包解析失败: ${e?.message}`)
            }
          }
        }
      } catch (e) {
        this.host.log(`账号 ${this.cookieId} 消息处理异常: ${e?.message}`)
      }
    })
    ws.addEventListener('close', () => {
      if (gen !== this.generation) return
      this.ws = null
      this.nextConnectAt = 0
      this.host.log(`账号 ${this.cookieId} 连接关闭 → 调度重连`)
    })
    ws.addEventListener('error', () => {
      if (gen !== this.generation) return
      this.ws = null
      this.nextConnectAt = 0
    })
  }

  async refreshTokenSafely() {
    if (Date.now() < this.riskCooldownUntil) return
    try {
      const { token, mergedCookies, ret, punishUrl } = await fetchTokenDetailed(this.cookieStr, this.deviceId)
      const verdict = classifyTokenError(ret)
      const mergedStr = Object.entries(mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
      if (mergedStr !== this.cookieStr) {
        this.cookieStr = mergedStr
        this.host.markDirty(this.cookieId)
      }
      if (verdict === 'ok' && token) {
        this.token = token
        this.lastTokenRefresh = Date.now()
        this.riskLadderIndex = 0
        this.riskStreak = 0
        if (this.state === 'need_relogin') this.setState('connecting', '登录态恢复')
        return
      }
      if (verdict === 'risk') {
        this.tripRisk(`token 接口风控拦截: ${ret.join('; ')}`, punishUrl)
        return
      }
      if (verdict === 'auth') {
        this.setState('need_relogin', ret.join('; ') || '登录态失效, 请重新扫码')
        return
      }
      this.host.log(`账号 ${this.cookieId} token 刷新未成功: ${ret.join('; ') || '空响应'}`)
    } catch (e) {
      this.host.log(`账号 ${this.cookieId} token 刷新异常: ${e?.message}`)
    }
  }

  tripRisk(description, punishUrl = '') {
    const now = Date.now()
    if (now - this.lastRiskTripAt > RISK_LADDER_WINDOW_MS) this.riskLadderIndex = 0
    this.lastRiskTripAt = now
    let seconds = RISK_LADDER_SECONDS[Math.min(this.riskLadderIndex, RISK_LADDER_SECONDS.length - 1)]
    this.riskLadderIndex++
    this.riskStreak++
    if (this.riskStreak >= 6) seconds = 7200
    else if (this.riskStreak >= 3) seconds = 1800
    this.riskCooldownUntil = now + seconds * 1000
    this.token = ''
    this.setState('risk_cooldown', `风控冷却 ${seconds}s`)
    this.host.sink.onRisk(this.cookieId, `${description}${punishUrl ? ` (挑战页: ${punishUrl.slice(0, 120)})` : ''} → 冷却 ${seconds}s`)
    this.host.markDirty(this.cookieId)
  }

  enqueue(frame, delayMs) {
    const run = async () => {
      if (delayMs > 0) await sleep(delayMs)
      const now = Date.now()
      this.sendTimestamps = this.sendTimestamps.filter((t) => now - t < SEND_WINDOW_MS)
      if (this.sendTimestamps.length >= SEND_MAX_PER_WINDOW) {
        const wait = SEND_WINDOW_MS - (now - this.sendTimestamps[0]) + 500
        await sleep(wait)
      }
      await sleep(800 + Math.floor(Math.random() * 1700))
      const ws = this.ws
      if (!ws || ws.readyState !== 1) throw new Error('连接未就绪, 发送取消')
      ws.send(frame)
      this.sendTimestamps.push(Date.now())
    }
    const next = this.sendChain.then(run, run)
    this.sendChain = next.catch(() => {})
    return next
  }

  sendText(chatId, toUserId, text, delayMs = 0) {
    return this.enqueue(buildSendTextMsg(chatId, toUserId, this.myId, text), delayMs)
  }

  sendImage(chatId, toUserId, imageUrl, width = 800, height = 600, delayMs = 0) {
    return this.enqueue(buildSendImageMsg(chatId, toUserId, this.myId, imageUrl, width, height), delayMs)
  }

  requestRaw(frame, timeoutMs = 10_000) {
    const ws = this.ws
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error('连接未就绪'))
    let mid = ''
    try {
      mid = String(JSON.parse(frame)?.headers?.mid || '')
    } catch {}
    if (!mid) return Promise.reject(new Error('报文缺少 mid'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(mid)
        reject(new Error('WS 协议请求超时'))
      }, timeoutMs)
      this.pendingRequests.set(mid, { resolve, reject, timer, dueAt: Date.now() + timeoutMs })
      try {
        ws.send(frame)
      } catch (e) {
        clearTimeout(timer)
        this.pendingRequests.delete(mid)
        reject(new Error(e?.message || 'WS 发送失败'))
      }
    })
  }

  isOnline() {
    return !!this.ws && this.ws.readyState === 1
  }

  async stop(reason = '已停止') {
    this.stopped = true
    this.generation++
    this.setState('disabled', reason)
    try {
      this.ws?.close?.()
    } catch {}
    this.ws = null
  }
}

/* --------------------- Durable Object: alarm 状态机主循环 --------------------- */

const CONFIG_TTL_MS = 30_000
const DIRTY_DEBOUNCE_MS = 2_000
const REPORT_FLUSH_MIN_GAP_MS = 450
const REPORT_BATCH = 100

export class XianyuEdgeDO {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.clients = new Map()
    this.latestCookies = new Map()
    this.engineActive = false
    this.pollSeconds = 30
    this.started = false
    this.tickMs = Math.max(1000, Math.round(Number(env.XY_TICK_MS || 1000)) || 1000)
    this.adminUrl = String(env.XY_ADMIN_URL || '').replace(/\/+$/, '')
    this.engineToken = String(env.XY_ENGINE_TOKEN || '')
    this.configUrl = this.adminUrl ? `${this.adminUrl}/api/engine/config` : ''
    this.eventsUrl = this.adminUrl ? `${this.adminUrl}/api/engine/events` : ''

    this.reportQueue = []
    this.accountStates = new Map()
    this.lastFlushAt = 0
    this.flushing = false
    this.lastConfigPollAt = 0
    this.nextDirtySaveAt = 0
    this.dirtyAccounts = new Set()

    this.sink = {
      onState: (cookieId, state, detail) => {
        this.accountStates.set(cookieId, { state, detail })
        if (state !== 'disabled') this.enqueueReport({ type: '__state__' })
      },
      onChat: (cookieId, msg) => {
        this.enqueueReport({
          type: 'chat',
          account: cookieId,
          chat_id: msg.chatId,
          sender_user_id: msg.senderUserId,
          sender_nick: msg.senderNick,
          content: msg.content,
          item_id: msg.itemId,
          create_time: msg.createTime,
          session_type: msg.sessionType,
          is_self: msg.isSelf,
        })
      },
      onSystem: (cookieId, msg) => {
        this.enqueueReport({
          type: 'system',
          account: cookieId,
          red_reminder: msg.redReminder,
          item_id: msg.itemId,
          buyer_id: msg.buyerId,
          order_id: msg.orderId,
          chat_id: msg.chatId,
        })
      },
      onRisk: (cookieId, description) => {
        this.enqueueReport({ type: 'risk', account: cookieId, description })
      },
    }
  }

  log(msg) {
    console.log(`[xianyu-edge] ${new Date().toISOString()} ${msg}`)
  }

  markDirty(cookieId) {
    this.dirtyAccounts.add(cookieId)
    if (!this.nextDirtySaveAt) this.nextDirtySaveAt = Date.now() + DIRTY_DEBOUNCE_MS
  }

  /* ---------- 生命周期 ---------- */

  async start() {
    if (this.started) return
    this.started = true
    await this.restoreFromStorage()
    await this.state.storage.setAlarm(Date.now() + this.tickMs)
    this.log(`监听器已启动 → 后台 ${this.adminUrl}, tick ${this.tickMs}ms`)
  }

  async restoreFromStorage() {
    try {
      const snap = await this.state.storage.get('xy:config')
      if (snap && typeof snap === 'object') {
        this.engineActive = !!snap.active
        this.pollSeconds = Math.max(10, Number(snap.pollSeconds) || 30)
        for (const entry of Array.isArray(snap.accounts) ? snap.accounts : []) {
          if (!entry?.id) continue
          const id = String(entry.id)
          const rt = await this.state.storage.get(`xy:acct:${id}`)
          this.spawnClient({ id, cookies: String(entry.cookies || ''), device_id: String(entry.device_id || '') }, rt)
        }
        if (snap.accounts?.length) {
          this.log(`从存储恢复 ${snap.accounts.length} 个账号配置 (连接将在 tick 中重建)`)
        }
      }
    } catch (e) {
      this.log(`存储恢复失败: ${e?.message}`)
    }
  }

  spawnClient(account, runtime) {
    if (this.clients.has(account.id)) return
    try {
      const cookieStr = this.latestCookies.get(account.id) || account.cookies
      const client = new XianyuAccountClient({ ...account, cookies: cookieStr }, this)
      if (runtime) client.restoreRuntime(runtime)
      this.clients.set(account.id, client)
      this.latestCookies.set(account.id, client.cookieStr)
      if (!runtime) client.setState('connecting', '等待连接调度')
    } catch (e) {
      this.log(`账号 ${account.id} 客户端创建失败: ${e?.message}`)
    }
  }

  async stopClient(id) {
    const client = this.clients.get(id)
    if (!client) return
    await client.stop('已下线').catch(() => {})
    this.clients.delete(id)
    this.latestCookies.delete(id)
    this.accountStates.set(id, { state: 'disabled', detail: '已下线' })
    await this.state.storage.delete(`xy:acct:${id}`).catch(() => {})
    this.log(`账号 ${id} 客户端已停止`)
  }

  /* ---------- HTTP: 启动/健康检查 ---------- */

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/start' || url.pathname === '/wake') {
      await this.start()
      return Response.json({ ok: true, started: true })
    }
    if (url.pathname === '/health') {
      const accounts = [...this.accountStates.entries()].map(([id, s]) => ({ id, state: s.state, detail: s.detail || '' }))
      return Response.json({
        ok: true,
        engine_active: this.engineActive,
        admin_url_configured: !!this.adminUrl,
        token_configured: !!this.engineToken,
        accounts,
        alarm: await this.state.storage.getAlarm().catch(() => null),
      })
    }
    return Response.json({ ok: false, error: 'not found' }, { status: 404 })
  }

  /* ---------- alarm 主循环 ---------- */

  async alarm() {
    const now = Date.now()
    try {
      await this.tick(now)
    } catch (e) {
      this.log(`tick 异常 (继续保活): ${e?.message}`)
    }
    // 无条件重排 alarm — alarm 链是监听器生命线, 任何异常都不能断
    try {
      await this.state.storage.setAlarm(Date.now() + this.tickMs)
    } catch (e) {
      this.log(`alarm 重排失败 (等待 cron 兜底唤醒): ${e?.message}`)
    }
  }

  async tick(now) {
    // 1. 脏账号运行时状态落盘 (2s 去抖)
    if (this.nextDirtySaveAt && now >= this.nextDirtySaveAt) {
      const ids = [...this.dirtyAccounts]
      this.dirtyAccounts.clear()
      this.nextDirtySaveAt = 0
      for (const id of ids) {
        const client = this.clients.get(id)
        if (!client) continue
        try {
          await this.state.storage.put(`xy:acct:${id}`, client.snapshotRuntime())
        } catch {}
      }
    }

    // 2. 配置轮询 (30s ± 抖动)
    if (now - this.lastConfigPollAt >= jitter(this.pollSeconds * 1000, 0.05)) {
      this.lastConfigPollAt = now
      await this.pollConfigOnce(now)
    }

    // 3. 各账号调度 (心跳/重连/token)
    for (const client of [...this.clients.values()]) {
      await client.onTick(now).catch((e) => this.log(`账号 ${client.cookieId} tick 异常: ${e?.message}`))
    }

    // 4. 上报 flush (队列非空时立即, 有 450ms 节流)
    if (this.reportQueue.length && !this.flushing && now - this.lastFlushAt >= REPORT_FLUSH_MIN_GAP_MS) {
      this.flushing = true
      try {
        await this.flushReports()
      } finally {
        this.flushing = false
      }
    }
  }

  /* ---------- 配置轮询与账号对齐 (与 proxy.mjs 同语义) ---------- */

  async apiCall(url, body) {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${this.engineToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || 5) || 5
      throw Object.assign(new Error(`后台限速, ${retryAfter}s 后重试`), { rateLimited: retryAfter })
    }
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error(`鉴权失败 (${res.status}): 令牌无效/引擎被停用, 请核对 XY_ENGINE_TOKEN`), { fatal: true })
    }
    if (!res.ok) throw new Error(`后台响应异常 ${res.status}`)
    const json = await res.json().catch(() => ({}))
    return json?.data ?? json ?? {}
  }

  async pollConfigOnce(now) {
    if (!this.configUrl || !this.engineToken) return
    try {
      const cfg = await this.apiCall(this.configUrl)
      const wasActive = this.engineActive
      this.engineActive = !!cfg.active
      if (cfg.intervals?.poll_seconds) {
        this.pollSeconds = Math.max(10, Math.round(Number(cfg.intervals.poll_seconds) || 30))
      }

      if (!this.engineActive) {
        if (wasActive || this.clients.size) {
          this.log('当前引擎非使用中 (备用状态), 全部账号下线 (多引擎互斥)')
          for (const id of [...this.clients.keys()]) await this.stopClient(id)
          await this.state.storage.put('xy:config', { active: false, pollSeconds: this.pollSeconds, accounts: [] })
        }
        return
      }

      const wanted = new Map(
        (Array.isArray(cfg.accounts) ? cfg.accounts : []).map((a) => [a.id && String(a.id), {
          id: String(a.id),
          cookies: String(a.cookies || ''),
          device_id: String(a.device_id || ''),
        }]),
      )

      for (const [id] of [...this.clients]) {
        if (!wanted.has(id)) await this.stopClient(id)
      }
      for (const [, account] of wanted) {
        const client = this.clients.get(account.id)
        if (client) {
          const effective = this.latestCookies.get(account.id) || ''
          if (account.cookies && account.cookies !== effective) {
            client.cookieStr = account.cookies
            this.latestCookies.set(account.id, account.cookies)
            this.markDirty(account.id)
            this.log(`账号 ${account.id} Cookie 已按后台更新热替换`)
          }
          continue
        }
        this.spawnClient(account)
      }

      await this.state.storage.put('xy:config', {
        active: true,
        pollSeconds: this.pollSeconds,
        accounts: [...wanted.values()],
      })

      if (!wasActive && this.engineActive) this.log(`引擎已激活: 托管 ${wanted.size} 个账号`)
    } catch (e) {
      if (e?.fatal) {
        this.log(`致命配置错误: ${e.message} — 停止监听 (修正 Worker 环境变量后重新部署)`)
        for (const id of [...this.clients.keys()]) await this.stopClient(id)
        this.engineActive = false
        return
      }
      if (e?.rateLimited) {
        this.log(`配置拉取被限速: ${e.message}`)
        return
      }
      this.log(`配置拉取失败: ${e?.message} — 下轮重试`)
    }
  }

  /* ---------- 事件上报与动作回收 (与 proxy.mjs 同语义) ---------- */

  enqueueReport(entry) {
    this.reportQueue.push(entry)
    if (this.reportQueue.length > 500) this.reportQueue.splice(0, this.reportQueue.length - 500)
  }

  async flushReports() {
    if (!this.reportQueue.length) return
    this.lastFlushAt = Date.now()
    const events = this.reportQueue.splice(0, REPORT_BATCH)
    const status = {
      accounts: [...this.accountStates.entries()].map(([id, s]) => ({ id, state: s.state, detail: s.detail || '' })),
    }
    try {
      const resp = await this.apiCall(this.eventsUrl, { status, events })
      const actions = Array.isArray(resp?.actions) ? resp.actions : []
      if (actions.length) await this.executeActions(actions)
    } catch (e) {
      this.reportQueue.unshift(...events)
      if (e?.fatal) {
        this.log(`上报鉴权失败: ${e.message} — 事件保留队列 (修正配置后自动恢复)`)
        return
      }
      if (e?.rateLimited) {
        this.log(`上报被限速: ${e.message}`)
      } else {
        this.log(`上报失败: ${e?.message} — 事件已回队重试`)
      }
    }
  }

  async executeActions(actions) {
    for (const action of actions) {
      const client = this.clients.get(String(action.account || ''))
      if (!client) {
        this.log(`动作丢弃: 账号 ${action.account} 不由本监听器托管`)
        continue
      }
      try {
        const delay = Math.max(0, Math.round(Number(action.delay_ms || 0)))
        if (action.type === 'send_text') {
          await client.sendText(String(action.chat_id), String(action.to_user_id), String(action.text || ''), delay)
          this.log(`已发送文本 → 账号 ${action.account} 会话 ${action.chat_id}`)
        } else if (action.type === 'send_image') {
          await client.sendImage(
            String(action.chat_id),
            String(action.to_user_id),
            String(action.image_url || ''),
            Number(action.width || 800),
            Number(action.height || 600),
            delay,
          )
          this.log(`已发送图片 → 账号 ${action.account} 会话 ${action.chat_id}`)
        }
      } catch (e) {
        this.log(`动作执行失败 (${action.type} → ${action.account}): ${e?.message}`)
      }
    }
  }
}

/* --------------------- Worker 入口: 健康检查 + 启动触发 + cron 兜底 --------------------- */

export default {
  async fetch(request, env) {
    const stub = env.XIANYU_LISTENER.get(env.XIANYU_LISTENER.idFromName('default'))
    const url = new URL(request.url)
    if (url.pathname === '/health') {
      return stub.fetch('https://do.internal/health')
    }
    return stub.fetch('https://do.internal/start')
  },
  async scheduled(controller, env, ctx) {
    const stub = env.XIANYU_LISTENER.get(env.XIANYU_LISTENER.idFromName('default'))
    ctx.waitUntil(stub.fetch('https://do.internal/start'))
  },
}
