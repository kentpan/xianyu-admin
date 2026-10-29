#!/usr/bin/env node
/**
 * xianyu-proxy.mjs — 闲鱼监听独立代理 (单文件, 零 npm 依赖, Node ≥ 20)。
 *
 * 定位: 与 xianyu-admin 后台配套的"纯消息监听与转发"进程。所有业务规则
 * (关键词/AI 回复链/卡券/订单) 只存在于后台; 代理只做:
 *   1. GET  /api/engine/config  — 拉取账号连接配置 (30s 轮询, 非活动自动下线)
 *   2. 对每个启用账号建立闲鱼消息长连接 (协议与后台内置引擎同源)
 *   3. POST /api/engine/events  — 上报连接状态/聊天/交易/风控事件, 回收决策动作
 *   4. 按 delay_ms 人化执行动作 (发文本/发图片, 串行队列 + 滑动窗口限速)
 *
 * 部署: 上传本文件到任意能出网的机器 (Node ≥ 20; Node 20 若无内置 WebSocket
 * 请在同目录 `npm i ws`), 配好环境变量后 `node xianyu-proxy.mjs`。
 * 代理主动外呼后台, 无需公网入站端口。
 *
 * 环境变量:
 *   XY_ADMIN_URL     后台地址 (必填, 如 https://xianyu-admin.pages.dev)
 *   XY_ENGINE_TOKEN  引擎接入令牌 (必填, 后台「监听服务」页该代理行的接入令牌)
 *   XY_PROXY_PORT    本地健康检查端口 (选填, 默认关闭; 绑定全部网卡, /health 返回运行状态 JSON, Bearer 鉴权)
 *   XY_POLL_SECONDS  配置轮询间隔秒 (选填, 默认 30, 后台下发的 intervals 优先)
 *
 * 风控硬约束 (与后台内置引擎完全同源):
 *   设备指纹持久化 (后台下发 cookies.device_id) / 心跳与重连随机抖动 /
 *   指数退避重连 (5s→300s) / 风控冷却阶梯 (5/10/20/30min, 连败加码) /
 *   发送人化队列 (随机 0.8~2.5s 间隔 + 12 条/分钟滑动窗口) / 每条下行必 ack。
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import dns from 'node:dns'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* --------------------------------- 配置 --------------------------------- */

/**
 * .env 文件加载(零依赖, dotenv 同语义: 真实环境变量优先, 文件值不覆盖已有 env)。
 * 为什么必须有: Wispbyte/Pterodactyl 等面板的「环境变量」编辑页实际只把变量写进
 * 容器内的 .env 文件, 启动命令(node xianyu-proxy.mjs)不会自动读取 —— 面板里配了
 * 变量, process.env 里依然什么都没有, 脚本缺配置退出即被面板判为 crash。
 * 查找顺序: 进程工作目录/.env → 脚本同目录/.env, 取第一个存在的文件。
 * 支持: export 前缀 / 单双引号包裹(闭引号后的内容连同行内注释一并丢弃) /
 * 未加引号值的行内 # 注释; 空行与 # 注释行跳过; 不做转义展开(URL/令牌/数字无需)。
 */
const dotenvInfo = (() => {
  let scriptDir = ''
  try { scriptDir = path.dirname(fileURLToPath(import.meta.url)) } catch {}
  for (const p of [path.join(process.cwd(), '.env'), scriptDir ? path.join(scriptDir, '.env') : ''].filter(Boolean)) {
    if (!existsSync(p)) continue
    try {
      const injected = []
      for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
        if (!m) continue
        let val = m[2].trim()
        const q = val[0]
        if ((q === '"' || q === "'") && val.length >= 2) {
          const end = val.indexOf(q, 1)
          val = end > 0 ? val.slice(1, end) : val.slice(1)
        } else {
          val = val.replace(/\s+#.*$/, '').trim()
        }
        if (process.env[m[1]] === undefined || process.env[m[1]] === '') {
          process.env[m[1]] = val
          injected.push(m[1])
        }
      }
      return { path: p, injected }
    } catch { /* 文件不可读视作未提供, 继续找下一个 */ }
  }
  return null
})()

const ADMIN_URL = String(process.env.XY_ADMIN_URL || '').replace(/\/+$/, '')
const ENGINE_TOKEN = String(process.env.XY_ENGINE_TOKEN || '')
const PROXY_PORT = Math.round(Number(process.env.XY_PROXY_PORT || 0)) || 0
const DEFAULT_POLL_SECONDS = Math.max(10, Math.round(Number(process.env.XY_POLL_SECONDS || 30)) || 30)

if (!ADMIN_URL || !ENGINE_TOKEN) {
  console.error('[xianyu-proxy] 缺少配置: XY_ADMIN_URL / XY_ENGINE_TOKEN 为必填项, 进程退出')
  console.error('  三种配置方式任选其一:')
  console.error('  ① 真实环境变量: XY_ADMIN_URL=... XY_ENGINE_TOKEN=... node xianyu-proxy.mjs')
  console.error('  ② .env 文件: 工作目录或脚本同目录放 .env(每行 KEY=VALUE), 启动时自动加载' + (dotenvInfo ? '' : '(当前两处均未找到 .env)'))
  console.error('  ③ 面板变量页: Wispbyte 等面板「Environment」页写入的就是 .env 文件, 本脚本会自动读取; Startup/启动页的变量才是真环境变量, 两处是分开的')
  console.error('  示例 .env:')
  console.error('    XY_ADMIN_URL=https://你的后台域名')
  console.error('    XY_ENGINE_TOKEN=后台「监听服务」页该代理行的接入令牌')
  process.exit(1)
}

if (dotenvInfo && dotenvInfo.injected.length) {
  log(`.env 配置文件已加载: ${dotenvInfo.path} (注入: ${dotenvInfo.injected.join(', ')}; 已存在的环境变量优先不被覆盖)`)
}

const CONFIG_URL = `${ADMIN_URL}/api/engine/config`
const EVENTS_URL = `${ADMIN_URL}/api/engine/events`

/* ----------------- 协议常量与纯函数 (与后台 server/utils/xianyu/protocol.ts 同源) ----------------- */

const APP_KEY = '444e9908a51d1cb236a27862abc769c9'
const SIGN_APP_KEY = '34839810'
const WEBSOCKET_URL = 'wss://wss-goofish.dingtalk.com/'
const TOKEN_API = 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.pc.login.token/1.0/'

/**
 * UA 真源 (与后台 server/utils/xianyu/chrome-ua.ts 同源): 优先探测本机 Playwright
 * Chromium (--version) 取真实版本号, 探测失败回退静态值。风控硬约束: mtop /
 * WS 握手 / 注册包三者 UA 必须恒定一致, 且尽量与真实浏览器版本一致。
 */
const FALLBACK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

let _uaInfo = null

function findChromiumBinary() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH || '', path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean)
  for (const root of roots) {
    if (!existsSync(root)) continue
    let entries = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!/^chromium-\d+$/.test(name)) continue
      for (const sub of ['chrome-linux64', 'chrome-linux']) {
        const cand = path.join(root, name, sub, 'chrome')
        if (existsSync(cand)) return cand
      }
    }
  }
  return null
}

function platformParts() {
  switch (process.platform) {
    case 'win32':
      return { uaPlatform: 'Windows NT 10.0; Win64; x64', chPlatform: '"Windows"', osTag: 'Windows/10' }
    case 'darwin':
      return { uaPlatform: 'Macintosh; Intel Mac OS X 10_15_7', chPlatform: '"macOS"', osTag: 'macOS' }
    default:
      return { uaPlatform: 'X11; Linux x86_64', chPlatform: '"Linux"', osTag: 'Linux' }
  }
}

function resolveChromeUA() {
  if (_uaInfo) return _uaInfo
  const p = platformParts()
  let version = ''
  try {
    const bin = findChromiumBinary()
    if (bin) {
      const out = execFileSync(bin, ['--version'], { timeout: 5000, encoding: 'utf8' })
      const m = String(out).match(/(\d+\.\d+\.\d+\.\d+)/)
      if (m) version = m[1]
    }
  } catch {}
  if (!version) {
    version = FALLBACK_UA.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '133.0.0.0'
  }
  const major = version.split('.')[0]
  _uaInfo = {
    ua: `Mozilla/5.0 (${p.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
    secChUa: `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not?A_Brand";v="99"`,
    secChUaPlatform: p.chPlatform,
    version,
  }
  log(`UA 真源: Chrome/${version} (${p.chPlatform})`)
  return _uaInfo
}

function mtopHeaders(cookieStr) {
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

function wsHeaders(cookieStr) {
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

function registerUA() {
  const info = resolveChromeUA()
  const p = platformParts()
  return `${info.ua} DingTalk(2.1.5) OS(${p.osTag}) Browser(Chrome/${info.version}) DingWeb/2.1.5 IMPaaS DingWeb/2.1.5`
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

/* --------------------- mtop token (与后台 ws-client.ts 同源) --------------------- */

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
      signal: AbortSignal.timeout(30_000),
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

/* ------------- 单账号长连接客户端 (与后台 ws-client.ts 同源, 去人工验证依赖) ------------- */

const RISK_LADDER_SECONDS = [300, 600, 1200, 1800]
const RISK_LADDER_WINDOW_MS = 30 * 60 * 1000
const TOKEN_REFRESH_MS = 3600 * 1000
const SEND_WINDOW_MS = 60_000
const SEND_MAX_PER_WINDOW = 12

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

async function createWsSocket(url, headers) {
  try {
    return new WebSocket(url, { headers })
  } catch {
    const mod = await import('ws').catch(() => null)
    if (!mod?.default) {
      throw new Error('当前 Node 无内置 WebSocket (需 ≥ 21) 且未安装 ws 包: 同目录执行 npm i ws')
    }
    return new mod.default(url, { headers })
  }
}

class XianyuAccountClient {
  constructor(account, sink) {
    this.cookieId = String(account.id)
    this.sink = sink
    this.cookieStr = String(account.cookies || '')
    this.deviceId = String(account.device_id || '') || generateDeviceId(transCookies(this.cookieStr)['unb'] || this.cookieId)
    const cookies = transCookies(this.cookieStr)
    this.myId = cookies['unb'] || ''
    if (!this.myId) throw new Error(`账号 ${this.cookieId} Cookie 缺少 unb 字段, 无法监听`)

    this.ws = null
    this.state = 'connecting'
    this.stopped = false
    this.token = ''
    this.lastTokenRefresh = 0
    this.tokenTimer = null
    this.heartbeatTimer = null
    this.riskCooldownUntil = 0
    this.riskLadderIndex = 0
    this.lastRiskTripAt = 0
    this.riskStreak = 0
    this.connectionFailures = 0
    this.generation = 0

    this.sendChain = Promise.resolve()
    this.sendTimestamps = []
    this.pendingRequests = new Map()
  }

  getState() {
    return this.state
  }
  getCookieStr() {
    return this.cookieStr
  }
  setCookieStr(value) {
    this.cookieStr = value
  }

  setState(state, detail = '') {
    if (this.state !== state || detail) {
      this.state = state
      this.sink.onState(this.cookieId, state, detail)
    }
  }

  start() {
    if (this.stopped) return
    void this.connectLoop()
    this.tokenTimer = setInterval(() => {
      if (!this.stopped) void this.refreshTokenSafely()
    }, jitter(TOKEN_REFRESH_MS, 0.08))
  }

  async stop() {
    this.stopped = true
    for (const t of [this.tokenTimer, this.heartbeatTimer]) {
      if (t) clearTimeout(t)
      if (t) clearInterval(t)
    }
    this.tokenTimer = this.heartbeatTimer = null
    this.generation++
    this.setState('disabled', '已停止')
    try {
      this.ws?.close?.()
    } catch {}
    this.ws = null
  }

  async connectLoop() {
    while (!this.stopped) {
      const remainMs = this.riskCooldownUntil - Date.now()
      if (remainMs > 0) {
        this.setState('risk_cooldown', `风控冷却 ${Math.ceil(remainMs / 1000)}s`)
        await sleep(Math.min(remainMs, 30_000))
        continue
      }
      try {
        await this.connectOnce()
      } catch (e) {
        const msg = String(e?.message || e)
        this.connectionFailures++
        if (this.stopped) return
        const delay = backoffDelay(this.connectionFailures)
        this.setState('reconnecting', `第 ${this.connectionFailures} 次断开, ${Math.round(delay / 1000)}s 后重连`)
        log(`账号 ${this.cookieId} 连接断开: ${msg} → ${Math.round(delay / 1000)}s 后重连`)
        await sleep(delay)
      }
    }
  }

  async connectOnce() {
    const gen = ++this.generation
    this.setState('connecting', '建立连接')

    if (!this.token || Date.now() - this.lastTokenRefresh > TOKEN_REFRESH_MS) {
      await this.refreshTokenSafely()
      if (!this.token) throw new Error('Token 获取失败')
    }

    const ws = await createWsSocket(WEBSOCKET_URL, wsHeaders(this.cookieStr))
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
    try {
      const stateResp = await this.requestRaw(buildSyncStateMsg(), 8000)
      const serverState = Array.isArray(stateResp?.body) ? stateResp.body[0] : stateResp?.body
      ws.send(buildAckDiffMsg(serverState))
    } catch {
      ws.send(buildAckDiffMsg())
    }

    this.connectionFailures = 0
    this.riskLadderIndex = 0
    this.setState('listening', '监听中')
    log(`账号 ${this.cookieId} 闲鱼消息通道已建立`)

    this.startHeartbeat(gen, ws)
    await this.receiveLoop(gen, ws)
  }

  startHeartbeat(gen, ws) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    const tick = () => {
      if (this.stopped || gen !== this.generation) return
      try {
        if (ws.readyState === 1) ws.send(buildHeartbeatMsg())
      } catch {}
      this.heartbeatTimer = setTimeout(tick, jitter(15_000, 0.15))
    }
    this.heartbeatTimer = setTimeout(tick, jitter(15_000, 0.15))
  }

  async receiveLoop(gen, ws) {
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
                if (parsed.kind === 'chat') this.sink.onChat(this.cookieId, parsed)
                else this.sink.onSystem(this.cookieId, parsed)
              } catch (e) {
                log(`账号 ${this.cookieId} 同步包解析失败: ${e?.message}`)
              }
            }
          }
        } catch (e) {
          log(`账号 ${this.cookieId} 消息处理异常: ${e?.message}`)
        }
      })
      const done = () => resolve()
      ws.addEventListener('close', done)
      ws.addEventListener('error', done)
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
        this.sink.onCookieRotated(this.cookieId, mergedStr)
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
      log(`账号 ${this.cookieId} token 刷新未成功: ${ret.join('; ') || '空响应'}`)
    } catch (e) {
      log(`账号 ${this.cookieId} token 刷新异常: ${e?.message}`)
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
    this.sink.onRisk(this.cookieId, `${description}${punishUrl ? ` (挑战页: ${punishUrl.slice(0, 120)})` : ''} → 冷却 ${seconds}s`)
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
      this.pendingRequests.set(mid, { resolve, reject, timer })
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
}

/* ------------- 代理主循环: 配置轮询 / 账号对齐 / 事件上报 / 动作回收 ------------- */

const clients = new Map()
const latestCookies = new Map()
let engineActive = false
let pollSeconds = DEFAULT_POLL_SECONDS
let stopped = false
let configFailStreak = 0
let pollOkCount = 0

// 上报队列: 状态变化/事件即时入队, 合并窗口批量 POST (后台限速 120/min)
const reportQueue = []
const accountStates = new Map()
let flushTimer = null
let lastFlushAt = 0

function log(msg) {
  console.log(`[xianyu-proxy] ${new Date().toLocaleString('zh-CN', { hour12: false })} ${msg}`)
}


async function apiCall(url, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${ENGINE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
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

function enqueueReport(entry) {
  if (stopped) return
  reportQueue.push(entry)
  if (reportQueue.length > 500) reportQueue.splice(0, reportQueue.length - 500)
  scheduleFlush(250)
}

function scheduleFlush(minGapMs) {
  if (flushTimer || stopped) return
  const wait = Math.max(minGapMs, 500 - (Date.now() - lastFlushAt))
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushReports()
  }, wait)
  flushTimer.unref?.()
}

async function flushReports() {
  if (stopped || !reportQueue.length) return
  const now = Date.now()
  if (now - lastFlushAt < 450) {
    scheduleFlush(500)
    return
  }
  lastFlushAt = now
  const events = reportQueue.splice(0, 100)
  const status = {
    accounts: [...accountStates.entries()].map(([id, s]) => ({ id, state: s.state, detail: s.detail || '' })),
  }
  try {
    const resp = await apiCall(EVENTS_URL, { status, events })
    const actions = Array.isArray(resp?.actions) ? resp.actions : []
    await executeActions(actions)
  } catch (e) {
    if (e?.fatal) {
      log(`致命错误: ${e.message} — 代理退出 (修正配置后重启)`)
      process.exit(1)
    }
    reportQueue.unshift(...events)
    if (e?.rateLimited) {
      log(`上报被限速: ${e.message}`)
      await sleep(Math.min(e.rateLimited * 1000, 30_000))
    } else {
      log(`上报失败: ${e?.message} — 事件已回队重试`)
      await sleep(3000)
    }
    scheduleFlush(500)
  }
}

async function executeActions(actions) {
  for (const action of actions) {
    const client = clients.get(String(action.account || ''))
    if (!client) {
      log(`动作丢弃: 账号 ${action.account} 不由本代理托管`)
      continue
    }
    try {
      const delay = Math.max(0, Math.round(Number(action.delay_ms || 0)))
      if (action.type === 'send_text') {
        await client.sendText(String(action.chat_id), String(action.to_user_id), String(action.text || ''), delay)
        log(`已发送文本 → 账号 ${action.account} 会话 ${action.chat_id}`)
      } else if (action.type === 'send_image') {
        await client.sendImage(
          String(action.chat_id),
          String(action.to_user_id),
          String(action.image_url || ''),
          Number(action.width || 800),
          Number(action.height || 600),
          delay,
        )
        log(`已发送图片 → 账号 ${action.account} 会话 ${action.chat_id}`)
      }
    } catch (e) {
      log(`动作执行失败 (${action.type} → ${action.account}): ${e?.message}`)
    }
  }
}

const sink = {
  onState(cookieId, state, detail) {
    accountStates.set(cookieId, { state, detail })
    if (state !== 'disabled') enqueueReport({ type: '__state__' })
  },
  onChat(cookieId, msg) {
    enqueueReport({
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
  onSystem(cookieId, msg) {
    enqueueReport({
      type: 'system',
      account: cookieId,
      red_reminder: msg.redReminder,
      item_id: msg.itemId,
      buyer_id: msg.buyerId,
      order_id: msg.orderId,
      chat_id: msg.chatId,
    })
  },
  onRisk(cookieId, description) {
    enqueueReport({ type: 'risk', account: cookieId, description })
  },
  onCookieRotated(cookieId, mergedStr) {
    latestCookies.set(cookieId, mergedStr)
  },
}

function accountEntryFromConfig(a) {
  return { id: String(a.id), cookies: String(a.cookies || ''), device_id: String(a.device_id || '') }
}

function createClient(account) {
  if (clients.has(account.id)) return
  try {
    const cookieStr = latestCookies.get(account.id) || account.cookies
    const client = new XianyuAccountClient({ ...account, cookies: cookieStr }, sink)
    clients.set(account.id, client)
    latestCookies.set(account.id, cookieStr)
    client.start()
    log(`账号 ${account.id} 客户端已启动`)
  } catch (e) {
    log(`账号 ${account.id} 客户端创建失败: ${e?.message}`)
  }
}

async function stopClient(id) {
  const client = clients.get(id)
  if (!client) return
  await client.stop().catch(() => {})
  clients.delete(id)
  accountStates.set(id, { state: 'disabled', detail: '已下线' })
  log(`账号 ${id} 客户端已停止`)
}

/**
 * 配置拉取(带快速重试): 后台域名(pages.dev 等)在公网链路存在间歇性丢包/限速
 * (实测同域名静态与接口均 ~半数请求超时, 而 TCP/边缘 trace 全通), 单次失败不
 * 代表不可达 —— 同一轮询内 3s 后立即重试一次, 把高丢包链路下的轮空率压到最低。
 * 致命(鉴权)与限速错误不重试, 原样上抛。
 */
async function fetchConfigWithRetry() {
  try {
    return await apiCall(CONFIG_URL)
  } catch (e) {
    if (e?.fatal || e?.rateLimited) throw e
    await sleep(3000)
    return await apiCall(CONFIG_URL)
  }
}

async function pollConfigOnce() {
  try {
    const cfg = await fetchConfigWithRetry()
    configFailStreak = 0
    const wasActive = engineActive
    engineActive = !!cfg.active
    if (cfg.intervals?.poll_seconds) {
      pollSeconds = Math.max(10, Math.round(Number(cfg.intervals.poll_seconds) || DEFAULT_POLL_SECONDS))
    }

    if (!engineActive) {
      if (wasActive || clients.size) {
        log('当前引擎非使用中 (备用状态), 全部账号下线 (多引擎互斥)')
        for (const id of [...clients.keys()]) await stopClient(id)
      }
      return
    }

    // 账号对齐: cookie 以后台下发的为准 (用户重新扫码生效), 本地滚动合并值
    // 仅作连接期使用; 后台值有变化时热替换 (下轮重连生效)
    const wanted = new Map(
      (Array.isArray(cfg.accounts) ? cfg.accounts : []).map((a) => [a.id && String(a.id), accountEntryFromConfig(a)]),
    )

    for (const [id] of [...clients]) {
      if (!wanted.has(id)) await stopClient(id)
    }
    for (const [, account] of wanted) {
      const client = clients.get(account.id)
      if (client) {
        const effective = latestCookies.get(account.id) || ''
        if (account.cookies && account.cookies !== effective) {
          client.setCookieStr(account.cookies)
          latestCookies.set(account.id, account.cookies)
          log(`账号 ${account.id} Cookie 已按后台更新热替换`)
        }
        continue
      }
      createClient(account)
    }

    if (!wasActive && engineActive) log(`引擎已激活: 托管 ${wanted.size} 个账号`)
    pollOkCount += 1
    if (pollOkCount % 10 === 1) {
      log(`配置轮询正常: active=${engineActive}, 下发账号 ${wanted.size}, 本地连接 ${clients.size}` + (pollOkCount === 1 ? '' : ` (连续成功 ${pollOkCount}; 成功默认静默, 每 10 次打印一次)`))
    }
  } catch (e) {
    if (e?.fatal) {
      log(`致命错误: ${e.message} — 代理退出 (修正配置后重启)`)
      process.exit(1)
    }
    if (e?.rateLimited) {
      log(`配置拉取被限速: ${e.message}`)
      return
    }
    log(`配置拉取失败: ${e?.message} — 下轮重试`)
    // 连续失败自动网络自检(第 2 次触发, 此后每 10 次复查): 定位 DNS/TCP/SNI 过滤/整机断路
    configFailStreak += 1
    if (configFailStreak === 2 || configFailStreak % 10 === 0) await diagnoseNetwork()
  }
}

/* ------------- 网络自检 (连续超时自动触发: 四层定位 DNS/TCP/TLS-域名过滤/整机断路) ------------- */

async function fetchTraceOk(url, timeoutMs = 8000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': FALLBACK_UA } })
    return res.ok
  } catch {
    return false
  }
}

function tcpConnectMs(host, port = 443, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const started = Date.now()
    const sock = net.connect({ host, port })
    const done = (ok) => {
      try { sock.destroy() } catch {}
      resolve(ok ? Date.now() - started : 0)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

let diagRunning = false

async function diagnoseNetwork() {
  if (diagRunning) return
  diagRunning = true
  try {
    const u = new URL(ADMIN_URL)
    const host = u.hostname
    const port = Number(u.port) || 443
    log('网络自检: 拉取连续失败, 自动定位断点 (DNS → TCP → Cloudflare 对照 → 后台域名)...')
    const [ips, tcpMs, cfOk, targetOk] = await Promise.all([
      dns.promises.lookup(host, { all: true }).catch(() => []),
      tcpConnectMs(host, port),
      fetchTraceOk('https://www.cloudflare.com/cdn-cgi/trace'),
      fetchTraceOk(`${ADMIN_URL}/cdn-cgi/trace`),
    ])
    const ipText = (Array.isArray(ips) && ips.length ? ips : []).map((r) => `${r.address}(v${r.family})`).join(' ') || '解析失败'
    log(`网络自检结果: DNS=${ipText}; TCP443=${tcpMs ? tcpMs + 'ms' : '不通'}; Cloudflare对照站=${cfOk ? '通' : '不通'}; 后台域名=${targetOk ? '通' : '不通'}`)
    if (!Array.isArray(ips) || !ips.length) {
      log('自检结论: DNS 解析失败 — 检查容器/系统 DNS 配置 (可换 1.1.1.1 / 8.8.8.8)')
    } else if (!tcpMs) {
      log('自检结论: ' + (cfOk
        ? `能连 Cloudflare 其它站点, 但到 ${host}:${port} 的 TCP 不通 — 该机房/上游拦截了目标网段, 换出口机器或联系机房`
        : 'TCP 全不通 — 这台机器到 Cloudflare 整体断路, 此机器无法运行代理; 换出口 (家用电脑/住宅 IP 更优, 闲鱼风控面也更友好)'))
    } else if (!targetOk) {
      log('自检结论: ' + (cfOk
        ? `TCP 通且 Cloudflare 其它站点可达, 唯独 ${host} 被丢包 — 该网络对此域名(SNI)过滤; 最有效解法: 给 Pages 项目绑定自定义域名(Custom domains), XY_ADMIN_URL 换成自定义域名`
        : `到 ${host} 与 Cloudflare 对照站均丢包 — 该机房到 CF 骨干路由异常, 换出口机器`))
    } else {
      log('自检结论: DNS/TCP/TLS 全部可达 — 此前失败应为瞬时抖动; 若仍持续失败, 检查后台服务状态与日志')
    }
  } finally {
    diagRunning = false
  }
}

async function configLoop() {
  while (!stopped) {
    await pollConfigOnce()
    await sleep(jitter(pollSeconds * 1000, 0.1))
  }
}

/* --------------------- 健康检查 (选填) --------------------- */

if (PROXY_PORT > 0) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          ok: true,
          engine_active: engineActive,
          accounts: [...accountStates.entries()].map(([id, s]) => ({ id, state: s.state })),
          uptime_seconds: Math.round(process.uptime()),
        }),
      )
      return
    }
    res.writeHead(404)
    res.end()
  })
  server.listen(PROXY_PORT, () => log(`健康检查端口已监听: http://0.0.0.0:${PROXY_PORT}/health (绑定全部网卡, 容器外可访问)`))
}

/* --------------------- 启动 --------------------- */

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`收到 ${sig}, 停止全部账号连接并退出…`)
    stopped = true
    for (const client of clients.values()) void client.stop()
    setTimeout(() => process.exit(0), 1000)
  })
}

log(`独立代理已启动 → 后台 ${ADMIN_URL}`)
log(`配置轮询 ${DEFAULT_POLL_SECONDS}s (以后台下发的 intervals 为准), 事件上报合并窗口 250ms`)
configLoop().catch((e) => {
  log(`主循环异常退出: ${e?.message}`)
  process.exit(1)
})
