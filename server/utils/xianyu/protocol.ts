/**
 * xianyu/protocol — 闲鱼消息 WebSocket 协议核心 (TS 复刻自 xianyu-super-butler, AGPL 同源)。
 *
 * 覆盖: 签名 / 设备指纹 / MessagePack 解码 / 同步包解密 / 注册-心跳-确认-发消息报文构造 /
 *       聊天消息与交易卡片字段解析。本模块为纯函数, 无 IO, 供内置引擎与远程代理共同复用。
 */

import { createHash } from 'node:crypto'
import { registerUA, resolveChromeUA } from './chrome-ua'

export const APP_KEY = '444e9908a51d1cb236a27862abc769c9'
export const SIGN_APP_KEY = '34839810'
export const WEBSOCKET_URL = 'wss://wss-goofish.dingtalk.com/'
export const TOKEN_API = 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.pc.login.token/1.0/'

/** mtop 请求默认头 (与求解浏览器 UA/Sec-CH-UA 全一致, 风控关键项 — 见 chrome-ua.ts 说明)。 */
export function mtopHeaders(cookieStr: string): Record<string, string> {
  const info = resolveChromeUA()
  return {
    accept: 'application/json',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    'content-type': 'application/x-www-form-urlencoded',
    pragma: 'no-cache',
    priority: 'u=1, i',
    'sec-ch-ua': info.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': info.secChUaPlatform,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': info.ua,
    referer: 'https://www.goofish.com/',
    origin: 'https://www.goofish.com',
    cookie: cookieStr,
  }
}

/** WebSocket 握手头 (Origin/UA/Cookie 与官方网页端一致, 风控关键项)。 */
export function wsHeaders(cookieStr: string): Record<string, string> {
  return {
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    Origin: 'https://www.goofish.com',
    Pragma: 'no-cache',
    'User-Agent': resolveChromeUA().ua,
    Cookie: cookieStr,
  }
}

/** generate_sign — md5(token&t&34839810&data)。 */
export function md5Sign(t: string, token: string, data: string): string {
  return createHash('md5').update(`${token}&${t}&${SIGN_APP_KEY}&${data}`, 'utf8').digest('hex')
}

/** transCookies — "k=v; k2=v2" → dict。 */
export function transCookies(cookieStr: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(cookieStr || '').split(';')) {
    const seg = part.trim()
    if (!seg) continue
    const eq = seg.indexOf('=')
    if (eq > 0) out[seg.slice(0, eq)] = seg.slice(eq + 1)
  }
  return out
}

/** generate_mid — 随机前缀 + 毫秒时间戳 + " 0"。 */
export function generateMid(): string {
  return `${Math.floor(Math.random() * 1000)}${Date.now()} 0`
}

/** generate_uuid — "-{ms}1"。 */
export function generateUuid(): string {
  return `-${Date.now()}1`
}

const DEVICE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * generate_device_id — 36 位类 UUID 设备指纹。
 * 风控关键: 同一账号必须复用同一 device_id (由调用方持久化到 cookies.device_id)。
 */
export function generateDeviceId(userId: string): string {
  const chars: string[] = []
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

/* ---------------------------------- MessagePack 解码 (纯 TS 实现) ---------------------------------- */

class MsgPackReader {
  pos = 0
  constructor(private data: Uint8Array) {}

  private need(n: number): void {
    if (this.pos + n > this.data.length) throw new Error('unexpected end of msgpack data')
  }
  readByte(): number {
    this.need(1)
    return this.data[this.pos++]
  }
  readBytes(n: number): Uint8Array {
    this.need(n)
    const out = this.data.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  u16(): number {
    return (this.readByte() << 8) | this.readByte()
  }
  u32(): number {
    return ((this.u16() << 16) | this.u16()) >>> 0
  }
  u64(): number {
    const hi = this.u32()
    const lo = this.u32()
    return hi * 0x1_0000_0000 + lo
  }
  i64(): number {
    // 负数与大于 2^53 的值在闲鱼消息中不出现, 按 u64 语义处理足够
    return this.u64()
  }
  str(n: number): string {
    return new TextDecoder('utf-8').decode(this.readBytes(n))
  }
  readValue(): any {
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
      case 0xd3: return this.i64()
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
  private readArray(n: number): any[] {
    return Array.from({ length: n }, () => this.readValue())
  }
  private readMap(n: number): Record<string, any> {
    const out: Record<string, any> = {}
    for (let i = 0; i < n; i++) {
      const k = this.readValue()
      out[String(k)] = this.readValue()
    }
    return out
  }
}

/** 解码 MessagePack 字节流 (对应 python MessagePackDecoder.decode)。 */
export function decodeMessagePack(bytes: Uint8Array): any {
  return new MsgPackReader(bytes).readValue()
}

/**
 * 解密同步包数据 — base64 → 优先按 UTF-8 JSON 解析 (未加密系统消息),
 * 失败则走 MessagePack 解码 (加密业务消息)。返回解析后的对象。
 */
export function decodeSyncData(data: string): any {
  const cleaned = String(data || '').replace(/[\u0100-\uffff]/g, '')
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0))
  } catch {
    // 补齐 base64 padding 重试
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

/* ---------------------------------- 报文构造 ---------------------------------- */

/** 注册报文 (连接建立后第一条)。 */
export function buildRegisterMsg(token: string, deviceId: string): string {
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

/** 注册后 1s 的同步状态查询 (服务端回传 pts 后再 ackDiff, 离线期消息不丢)。 */
export function buildSyncStateMsg(): string {
  return JSON.stringify({
    lwp: '/r/SyncStatus/getState',
    headers: { mid: generateMid() },
    body: [{ topic: 'sync' }],
  })
}

/**
 * 补差同步报文 — 用服务端 getState 回传的状态 (离线补差), 无状态时回退当前时间。
 * 注意: 用当前时间戳 ackDiff 会把离线期间未推送的消息全部确认掉 (丢消息根因)。
 */
export function buildAckDiffMsg(serverState?: any): string {
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

/** 会话列表分页拉取 (真实协议: /r/Conversation/listNewestPagination, body=[startTimeStamp, limit])。
 * startTimeStamp 从 Number.MAX_SAFE_INTEGER (最新一页) 起翻, 后续页用响应里的 nextCursor。 */
export function buildConversationListMsg(startTimestamp = 0, limit = 30): string {
  return JSON.stringify({
    lwp: '/r/Conversation/listNewestPagination',
    headers: { mid: generateMid() },
    body: [startTimestamp > 0 ? startTimestamp : Number.MAX_SAFE_INTEGER, limit],
  })
}

/** 心跳报文 (15s 周期, 由调用方加抖动)。 */
export function buildHeartbeatMsg(): string {
  return JSON.stringify({ lwp: '/!', headers: { mid: generateMid() } })
}

/** 对任意下行消息回执确认 (风控关键: 每条必 ack, 否则服务端判定异常客户端)。 */
export function buildAckMsg(message: any): string {
  const headers = (message && message.headers) || {}
  const ack: any = {
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

/** UTF-8 → base64 (btoa 分块, Node/Workers 通用, 不依赖 Buffer)。 */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function messageSendFrame(cid: string, toid: string, myid: string, contentBase64: string): string {
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

/** 文本消息发送帧。 */
export function buildSendTextMsg(cid: string, toid: string, myid: string, text: string): string {
  const payload = JSON.stringify({ contentType: 1, text: { text } })
  return messageSendFrame(cid, toid, myid, utf8ToBase64(payload))
}

/** 图片消息发送帧 (url 需为可公网访问的 CDN 链接)。 */
export function buildSendImageMsg(
  cid: string,
  toid: string,
  myid: string,
  imageUrl: string,
  width = 800,
  height = 600,
): string {
  const payload = JSON.stringify({
    contentType: 2,
    image: { pics: [{ height: Math.round(height), type: 0, url: imageUrl, width: Math.round(width) }] },
  })
  return messageSendFrame(cid, toid, myid, utf8ToBase64(payload))
}

/* ---------------------------------- 下行消息解析 ---------------------------------- */

/** 是否为同步推送包。 */
export function isSyncPackage(message: any): boolean {
  try {
    const data = message?.body?.syncPushPackage?.data
    return Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

export interface ParsedChatMessage {
  kind: 'chat'
  chatId: string
  senderUserId: string
  senderNick: string
  content: string
  itemId: string
  createTime: number
  sessionType: string
  isSelf: boolean
  raw: any
}

export interface ParsedSystemMessage {
  kind: 'system'
  redReminder: string
  itemId: string
  buyerId: string
  orderId: string
  chatId: string
  /** 交易卡片标题 (如 等待买家付款/我已小刀，待刀成), 来自 dxCard.item.main.exContent.title */
  cardTitle: string
  /** 从卡片/全文提取的金额 (元, 纯文本) */
  amount: string
  raw: any
}

export type ParsedMessage = ParsedChatMessage | ParsedSystemMessage | null

/**
 * 从整条消息 JSON 中提取订单号 (语义对齐 butler _extract_order_id):
 *   1. 结构化提取: dxCard.item.main.exContent.button.targetUrl 的 orderId= 参数
 *   2. 结构化提取: dxCard.item.main.targetUrl 的 order_detail?id= 参数
 *   3. 结构化提取: dynamicOperation.changeContent 内的 button/main targetUrl
 *   4. 全文兜底: orderId= / orderId: / bizOrderId= / order_detail?id= / "id":数字 (10位以上)
 */
export function extractOrderId(message: any): string {
  try {
    // ---- 结构化提取: message['1']['6']['3']['5'] 为卡片 JSON ----
    const contentJsonStr = String(message?.['1']?.['6']?.['3']?.['5'] ?? '')
    if (contentJsonStr) {
      let card: any = null
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

    // ---- 全文兜底 (与 butler 相同的模式优先级) ----
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

/**
 * 解析交易卡片 (message['1']['6']['3']['5'] JSON) 的标题与金额。
 * 标题: dxCard.item.main.exContent.title (butler 同路径)
 * 金额: exContent.price / priceText / amount 字段, 兜底从卡片全文提取 ¥xx.xx / xx.xx元
 */
export function parseTradeCard(message: any): { title: string; amount: string } {
  try {
    const contentJsonStr = String(message?.['1']?.['6']?.['3']?.['5'] ?? '')
    if (!contentJsonStr) return { title: '', amount: '' }
    let card: any = null
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

/**
 * 从消息字典提取商品 ID (语义对齐 butler extract_item_id_from_message):
 *   1. reminderUrl 的 itemId 参数 (主路径)
 *   2. message['3'].extension / bizData 的 itemId 字段
 *   3. message['3'].content 中的 10 位以上数字
 */
function extractItemId(message: any): string {
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
          const v = (value as any).itemId || (value as any).item_id
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

/**
 * 解析同步包内一条 data:
 *   - chatType 结 构 = 平台系统引导消息 (小闲鱼提示等), 不含业务事件, 返回 null
 *   - message['3'].redReminder = 交易状态提醒 (等待买家付款/等待卖家发货/交易关闭) → system
 *   - message['1']['10'] = 聊天消息体 → chat
 */
export function parseSyncItem(data: string, myId: string): ParsedMessage {
  const message = decodeSyncData(data)
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null

  // 未加密系统引导消息 (chatType 结构)
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
        raw: message,
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
      raw: message,
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
    raw: message,
  }
}

/** 判断 token 刷新响应是否命中风控/登录失效/令牌滚动。 */
export function classifyTokenError(retList: string[]): 'ok' | 'risk' | 'auth' | 'token_roll' | 'unknown' {
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
  // 令牌缺失/过期: mtop 已在 set-cookie 滚动新 _m_h5_tk, 合并后重试即可, 不是登录失效
  if (joined.includes('FAIL_SYS_TOKEN_EMPTY') || joined.includes('FAIL_SYS_TOKEN_EXOIRED')) {
    return 'token_roll'
  }
  if (joined.includes('SESSION_EXPIRED') || joined.includes('未登录')) {
    return 'auth'
  }
  return 'unknown'
}
