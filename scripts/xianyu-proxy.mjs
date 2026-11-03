#!/usr/bin/env node
/**
 * xianyu-proxy.mjs — 闲鱼监听独立代理 (单文件, 零 npm 依赖, Node ≥ 20)。
 *
 * 定位: 纯粹的网关与透传服务 (无状态, 零业务解析)。所有闲鱼数据的解码/解析/业务
 * 规则 (关键词/AI 回复链/卡券/订单) 只存在于后台 — 无论走不走本代理, 后台都用自己的
 * 同一套解析层 (协议解码/无损 JSON), 代理永不做第二遍。本脚本只做:
 *   1. GET  /api/engine/config  — 拉取账号连接配置 (30s 轮询, 非活动自动下线)
 *   2. 对每个启用账号建立闲鱼消息长连接 (连接保活: 注册/心跳/ack/token 刷新)
 *   3. POST /api/engine/events  — 原样转发 WS 同步包条目 (base64 不动) + 连接状态/风控,
 *      回收决策动作; 所有解析在后台完成
 *   4. 按 delay_ms 人化执行动作 (发文本/发图片, 串行队列 + 滑动窗口限速)
 *   5. GET  /api/engine/tasks   — 领取后台下发任务: http_fetch (后台构造好的签名 HTTP
 *      请求原样转发, 原始响应文本原样回报, 不读不改) / send_message (WS 发文本)
 *   6. POST /gateway 透传网关 (选填, XY_PROXY_PORT) — 同语义: 后台构造请求, 本机转发,
 *      原始响应回传
 *
 * 部署: 上传本文件到任意能出网的机器 (Node ≥ 20; Node 20 若无内置 WebSocket
 * 请在同目录 `npm i ws`), 配好环境变量后 `node xianyu-proxy.mjs`。
 * 代理主动外呼后台, 无需公网入站端口。
 *
 * 两种用法 (同一脚本, 区别只在是否填 XY_PROXY_PORT):
 *   ① 任务模式 (默认, 不填 XY_PROXY_PORT): 代理主动外呼后台 — 配置轮询 + WS 消息监听
 *      + 任务通道 (http_fetch 透传走任务领取/回报), 无需公网入站端口。
 *   ② 任务模式 + 透传网关 (填 XY_PROXY_PORT): 在 ① 基础上, 同端口额外开启
 *      POST /gateway 透传网关 — 后台 (CF Pages) 直连本机转发 mtop 请求 (解决 CF 出口
 *      到 h5api 被墙 500 超时), 需服务器公网固定 IP + 防火墙放行端口, 引擎行登记该地址。
 *
 * 环境变量:
 *   XY_ADMIN_URL     后台地址 (必填, 如 https://xianyu-admin.pages.dev;
 *                    支持多主服务器: `|` 分隔最多 3 个, 拆分后 trim 去头尾空格,
 *                    消息/会话等事件并行推送到全部活跃后台; 同账号只建一条闲鱼连接)
 *   XY_ENGINE_TOKEN  引擎接入令牌 (必填, 后台「监听服务」页该代理行的接入令牌;
 *                    透传网关鉴权复用同一令牌, Bearer XY_ENGINE_TOKEN)
 *   XY_PROXY_PORT    本地健康检查端口 (选填, 默认关闭; 绑定全部网卡, 开启后同端口提供
 *                    GET /health 运行状态 + POST /gateway mtop 透传网关, Bearer 鉴权)
 *   XY_POLL_SECONDS  配置轮询间隔秒 (选填, 默认 30, 后台下发的 intervals 优先)
 *   XY_TASK_POLL_SECONDS 任务轮询间隔秒 (选填, 默认 3, 越短后台等待任务结果越快)
 *   XY_PKG_VERSION   脚本版本号 (选填, 默认 2.1.20; /health 的 script_version 上报;
 *                    单文件部署同目录没有 package.json, 版本号从这里配)
 *
 * 唯一触碰报文内容的地方是传输层编帧 (外层帧 JSON 的 mid/ack/心跳/注册 与发送帧构造):
 * 这些字段全是短字符串/安全范围整数, 不含闲鱼业务 ID; 同步包内层 data (base64) 从不
 * 解开 — 订单号等业务 ID 的精度主权 100% 在后台解析层。
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

// 版本号: 单文件部署 (阿里云等) 同目录没有 package.json 可依, 从 .env/环境变量
// XY_PKG_VERSION 读取, 缺省 2.1.20 (容忍手误带 v 前缀)。
const SCRIPT_VERSION = String(process.env.XY_PKG_VERSION || '').trim().replace(/^v/i, '') || '2.1.20'

// (v2.1.20) 多主服务器支持: XY_ADMIN_URL 支持 `|` 分隔最多 3 个后台地址 (拆分后 trim 去空格,
// 去重, 取前 3 个)。消息/会话等事件数据并行推送到全部「活跃」后台 — 数据只发往本 .env
// 配置的服务器, 谁配了本代理谁收数据; 多后台同账号只建一条闲鱼长连接 (靠前后台优先),
// 决策动作/任务按各自后台独立领取与回报 (log_id/task_id 各后台独立编号, 绝不串号)。
let ADMIN_URLS = [
  ...new Set(
    String(process.env.XY_ADMIN_URL || '')
      .split('|')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  ),
]
if (ADMIN_URLS.length > 3) {
  log(`XY_ADMIN_URL 配置了 ${ADMIN_URLS.length} 个后台地址, 超出上限只取前 3 个: ${ADMIN_URLS.slice(0, 3).join(' | ')}`)
  ADMIN_URLS = ADMIN_URLS.slice(0, 3)
}
const ENGINE_TOKEN = String(process.env.XY_ENGINE_TOKEN || '')
const PROXY_PORT = Math.round(Number(process.env.XY_PROXY_PORT || 0)) || 0
const DEFAULT_POLL_SECONDS = Math.max(10, Math.round(Number(process.env.XY_POLL_SECONDS || 30)) || 30)

if (!ADMIN_URLS.length || !ENGINE_TOKEN) {
  console.error('[xianyu-proxy] 缺少配置: XY_ADMIN_URL / XY_ENGINE_TOKEN 为必填项, 进程退出')
  console.error('  三种配置方式任选其一:')
  console.error('  ① 真实环境变量: XY_ADMIN_URL=... XY_ENGINE_TOKEN=... node xianyu-proxy.mjs')
  console.error('  ② .env 文件: 工作目录或脚本同目录放 .env(每行 KEY=VALUE), 启动时自动加载' + (dotenvInfo ? '' : '(当前两处均未找到 .env)'))
  console.error('  ③ 面板变量页: Wispbyte 等面板「Environment」页写入的就是 .env 文件, 本脚本会自动读取; Startup/启动页的变量才是真环境变量, 两处是分开的')
  console.error('  示例 .env:')
  console.error('    XY_ADMIN_URL=https://你的后台域名 (多主服务器用 | 分隔最多 3 个, 如 https://a|https://b)')
  console.error('    XY_ENGINE_TOKEN=后台「监听服务」页该代理行的接入令牌')
  process.exit(1)
}

if (dotenvInfo && dotenvInfo.injected.length) {
  log(`.env 配置文件已加载: ${dotenvInfo.path} (注入: ${dotenvInfo.injected.join(', ')}; 已存在的环境变量优先不被覆盖)`)
}

const CONFIG_URLS = ADMIN_URLS.map((b) => `${b}/api/engine/config`)
const EVENTS_URLS = ADMIN_URLS.map((b) => `${b}/api/engine/events`)
const TASKS_URLS = ADMIN_URLS.map((b) => `${b}/api/engine/tasks`)

/** 任务轮询间隔秒 (选填, 默认 3): http_fetch 等下发任务的领取频率, 越短后台等得越短 */
const DEFAULT_TASK_POLL_SECONDS = Math.max(2, Math.round(Number(process.env.XY_TASK_POLL_SECONDS || 3)) || 3)

// 启动即打印生效配置全貌: 后台地址是排查「全部超时」的第一现场 —— 配错了/指向了旧
// 后台, 这一行日志直接可见, 不用再猜。
log(
  `启动配置: 后台=${ADMIN_URLS.join(' | ')}${ADMIN_URLS.length > 1 ? ` (多后台并行推送 ${ADMIN_URLS.length} 个)` : ''} | 接入令牌=${ENGINE_TOKEN.slice(0, 6)}…(长度 ${ENGINE_TOKEN.length}) | 脚本版本=v${SCRIPT_VERSION} | ` +
    `配置轮询=${DEFAULT_POLL_SECONDS}s | 任务轮询=${DEFAULT_TASK_POLL_SECONDS}s | 透传网关=${PROXY_PORT ? `开启 (端口 ${PROXY_PORT})` : '关闭'} | ` +
    `配置来源=${dotenvInfo ? dotenvInfo.path : '进程环境变量'}`,
)

/* -------------- 后台可达性追踪 (失败日志一眼判断: 断在哪一层 / 后台挂了多久) -------------- */

let adminFailStreak = 0 // 对后台请求的连续失败次数 (收到任何 HTTP 响应即清零 — 能回包=后台活着)
let lastAdminOkAt = 0 // 最近一次成功请求时刻
const processStartedAt = Date.now()

function fmtClock(ts) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

/** 失败日志附注: 连续失败次数 + 持续时长 + 上次成功时刻 (或从未成功), 不成功不恢复期间每次失败都带 */
function adminHealthNote() {
  if (adminFailStreak <= 1) return ''
  const since = lastAdminOkAt
    ? `上次成功 ${fmtClock(lastAdminOkAt)} (${Math.round((Date.now() - lastAdminOkAt) / 1000)}s 前)`
    : `启动 ${Math.round((Date.now() - processStartedAt) / 1000)}s 以来没有任何请求成功过`
  return ` — ⚠ 后台已连续失败 ${adminFailStreak} 次 (${since})`
}

/**
 * 超时类失败的自动分层诊断: 依次探测 DNS 解析 → TCP 连通, 把「连不上」与「连上了但对方
 * 不回 HTTP」区分开 —— 前者是域名错/宕机/防火墙丢包, 后者是后台进程挂起或 CF 到源站故障,
 * 修复方向完全不同。探测结果直接拼进失败日志, 一眼看出该去修哪里。
 */
async function probeReachability(urlStr) {
  let host = ''
  let port = 443
  try {
    const u = new URL(urlStr)
    host = u.hostname
    port = Number(u.port) || (u.protocol === 'http:' ? 80 : 443)
  } catch {
    return ''
  }
  let ips = []
  if (net.isIP(host)) {
    ips = [host] // IP 直连无 DNS 环节, 直接测 TCP
  } else {
    try {
      ips = await new Promise((resolve, reject) =>
        dns.resolve4(host, (e, a) => (e ? reject(e) : resolve(a || []))),
      )
    } catch (e) {
      return `【诊断】DNS 解析失败 (${host} → ${e?.code || e?.message || '解析不通'}) = 域名写错 / 本机 DNS 故障, 请核对 XY_ADMIN_URL`
    }
    if (!ips.length) return `【诊断】DNS 无记录 (${host}) = 域名不存在, 请核对 XY_ADMIN_URL`
  }
  const tcpOk = await new Promise((resolve) => {
    const s = net.connect({ host: ips[0], port })
    const done = (v) => {
      try { s.destroy() } catch {}
      resolve(v)
    }
    s.setTimeout(5000)
    s.on('connect', () => done(true))
    s.on('timeout', () => done(false))
    s.on('error', () => done(false))
  })
  if (!tcpOk) {
    return `【诊断】DNS ✓ (${ips[0]}) 但 TCP ${host}:${port} 连不上 = 后台主机宕机 / 安全组或防火墙丢包`
  }
  return `【诊断】DNS ✓ (${ips[0]}) / TCP ✓ (${host}:${port} 可连通) = 网络路是通的, 后台就是不回 HTTP → 后台服务没起 / 进程挂死 / CF 到源站故障, 去检查后台`
}

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

/* --------------------- 透传网关白名单/头过滤 (任务通道与 /gateway 共用) ---------------------
 * 仅传输策略 (目标限定闲鱼/淘系域名), 无任何报文内容解析。 */

const GATEWAY_ALLOWED_HOSTS = [
  'h5api.m.goofish.com',
  'goofish.com',
  'fishy.m.taobao.com',
  'wuliao.m.taobao.com',
  'taobao.com',
  'tmall.com',
]
const gwAllowed = (h) => GATEWAY_ALLOWED_HOSTS.some((d) => h === d || h.endsWith('.' + d))
// 逐跳头/鉴权头不透传 (由 Node fetch 自行生成)
const GATEWAY_SKIP_HEADERS = new Set(['host', 'connection', 'content-length', 'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding', 'authorization'])
const GATEWAY_TIMEOUT_MS = 25_000

/* --------------------- 原始同步包条目上报 (纯透传) ---------------------
 * 同步包内层 data (base64) 从不解开, 原样上报后台 — 后台用自己的解析层统一解码
 * (与内置引擎同源同语义), 保证有代理/无代理/网关/任务通道四种部署形态下解析结果
 * 完全一致; 本代理零业务解析, 也就不存在第二套解析语义需要同步维护。 */

function syncItemId(cookieId, data) {
  return 'm:' + createHash('sha1').update([cookieId, data].join('|')).digest('hex')
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
      applySetCookies(merged, res.headers.getSetCookie?.() || [])
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
// cookie 保活 (复刻参考项目 cookie_refresh_loop): 3 分钟周期, 消息活动后 5 分钟冷却
const COOKIE_KEEPALIVE_MS = 180 * 1000
const COOKIE_MSG_COOLDOWN_MS = 300 * 1000
// web 会话保活 (与后台 ws-client.ts 同源): 30 分钟访问主站一次, 滑动续期 web 登录会话 —
// token API 不能续期 web 会话, 不做这个每 ~24h 必被服务端踢下线要求重新扫码
const WEB_KEEPALIVE_MS = 30 * 60 * 1000
const WEB_HOME_URL = 'https://www.goofish.com/'
const SEND_WINDOW_MS = 60_000
const SEND_MAX_PER_WINDOW = 12

function jitter(ms, ratio = 0.15) {
  return Math.round(ms * (1 - ratio + Math.random() * ratio * 2))
}

function backoffDelay(failures) {
  const base = Math.min(300_000, 5_000 * Math.pow(2, Math.min(failures, 6)))
  return jitter(base, 0.2)
}

/** Set-Cookie 合并 (过期删除感知): Max-Age=0 / Expires 已过 → 删除, 否则覆盖 (与后台 ws-client.ts 同源)。 */
function applySetCookies(record, setCookieList) {
  for (const sc of setCookieList || []) {
    const segments = String(sc || '').split(';')
    const pair = segments[0] || ''
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (!name) continue
    let expired = false
    for (const attr of segments.slice(1)) {
      const a = attr.trim()
      const al = a.toLowerCase()
      if (al.startsWith('max-age=')) {
        const n = Number(a.slice(8))
        if (Number.isFinite(n) && n <= 0) expired = true
      } else if (al.startsWith('expires=')) {
        const ts = Date.parse(a.slice(8))
        if (Number.isFinite(ts) && ts <= Date.now()) expired = true
      }
    }
    if (expired) delete record[name]
    else record[name] = value
  }
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
    this.cookieKeepaliveTimer = null
    this.webKeepaliveTimer = null
    this.cookieRefreshing = false
    this.riskCooldownUntil = 0
    this.riskLadderIndex = 0
    this.lastRiskTripAt = 0
    this.riskStreak = 0
    this.connectionFailures = 0
    this.generation = 0
    this.lastDownstreamAt = Date.now()

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
    // cookie 保活 (复刻参考项目 cookie_refresh_loop): 每 3 分钟调一次 token API,
    // Set-Cookie 滚动合并回写后台; 收到下游消息后 5 分钟冷却 (风控降频)
    this.cookieKeepaliveTimer = setInterval(() => {
      if (!this.stopped) void this.maybeCookieKeepalive()
    }, jitter(COOKIE_KEEPALIVE_MS, 0.1))
    // web 会话保活: 每 30 分钟访问主站一次 (滑动续期 web 登录会话, 与后台 ws-client.ts 同源)
    this.webKeepaliveTimer = setInterval(() => {
      if (!this.stopped) void this.webSessionKeepalive()
    }, jitter(WEB_KEEPALIVE_MS, 0.1))
  }

  async webSessionKeepalive() {
    if (this.stopped || this.cookieRefreshing) return
    if (Date.now() < this.riskCooldownUntil) return
    if (Date.now() - this.lastDownstreamAt < COOKIE_MSG_COOLDOWN_MS) return
    this.cookieRefreshing = true
    try {
      const res = await fetch(WEB_HOME_URL, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': resolveChromeUA().ua,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Cookie: this.cookieStr,
        },
        signal: AbortSignal.timeout(20_000),
      })
      // 只续期不回写 (v2.1.18 事故根治): 滑动续期在服务端收到请求时已完成。主站网页
      // 上下文的 Set-Cookie 与 mtop/token 链路不同上下文, 合并进本地 cookie 会污染
      // token 签名身份, 经 onCookieRotated 回写后台后更会污染后台发货链 (远程拉单/
      // 发货接口) 的签名 cookie 并引发每 30min 一次的无意义热替换 — 一律不合并。
      const location = res.headers.get('location') || ''
      if (res.status >= 300 && res.status < 400 && /passport\.(goofish|taobao)\.com/i.test(location)) {
        log(`账号 ${this.cookieId} web 会话保活: 主站重定向登录页 (会话可能已失效, 以 token 链路判定为准)`)
      }
    } catch {
      // 主站不可达/网络异常: 静默, 下一周期重试
    } finally {
      this.cookieRefreshing = false
    }
  }

  async maybeCookieKeepalive() {
    if (this.cookieRefreshing || this.stopped) return
    if (Date.now() - this.lastDownstreamAt < COOKIE_MSG_COOLDOWN_MS) return
    this.cookieRefreshing = true
    try {
      await this.refreshTokenSafely()
    } finally {
      this.cookieRefreshing = false
    }
  }

  async stop() {
    this.stopped = true
    for (const t of [this.tokenTimer, this.heartbeatTimer, this.cookieKeepaliveTimer, this.webKeepaliveTimer]) {
      if (t) clearTimeout(t)
      if (t) clearInterval(t)
    }
    this.tokenTimer = this.heartbeatTimer = this.cookieKeepaliveTimer = this.webKeepaliveTimer = null
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
      // 静默断线检测 (与后台内置引擎同源): 正常连接心跳回包 ≤15s 一帧,
      // 超过 6 个心跳周期无任何下行帧 = TCP 半开假死, 不主动重连会永远停在 listening 却收不到消息
      if (Date.now() - this.lastDownstreamAt > 90_000) {
        log(`账号 ${this.cookieId} 连接静默超过 90s (无任何下行帧), 判定假死, 主动断开重连`)
        try {
          ws.close()
        } catch {}
        return
      }
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
        this.lastDownstreamAt = Date.now()
        const raw = typeof ev.data === 'string' ? ev.data : ''
        if (!raw) return
        // 传输层编帧: 外层帧 JSON 只读 mid/ack/syncPushPackage 结构 (短字符串/安全范围
        // 整数, 不含闲鱼业务 ID); 同步包内层 data (base64) 原样上报, 零业务解析
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
              // 纯透传: 内层 base64 不动, 解码/业务解析全部在后台 (与内置引擎同一套)
              try {
                this.sink.onSyncItem(this.cookieId, String(item.data))
              } catch {}
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
      // 登录失效 (auth) 响应的 Set-Cookie 不回写 (与后台 ws-client.ts 同策略: 失效响应
      // 的往往是清理指令/空值, 合并只会毒化仍有效的会话)
      if (verdict !== 'auth') {
        const mergedStr = Object.entries(mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
        if (mergedStr !== this.cookieStr) {
          this.cookieStr = mergedStr
          this.sink.onCookieRotated(this.cookieId, mergedStr)
        }
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
let heartbeatSeconds = 15
let stopped = false
let configFailStreak = 0
let pollOkCount = 0
// (v2.1.20) 多后台运行态: 活跃后台下标集合 (配置轮询驱动, 首轮前视为全部活跃);
// 事件连续失败自动暂停推该后台 (防一个死后台把队列堵住拖累其它后台), 配置轮询成功即恢复
let activeAdmins = new Set(ADMIN_URLS.map((_, i) => i))
const adminEventFailStreak = new Map()
const dupWarnAt = new Map()

// 上报队列: 状态变化/事件即时入队, 合并窗口批量 POST (后台限速 120/min)
const reportQueue = []
const accountStates = new Map()
let flushTimer = null
let lastFlushAt = 0

function log(msg) {
  console.log(`[xianyu-proxy] ${new Date().toLocaleString('zh-CN', { hour12: false })} ${msg}`)
}


/** 请求标签: "POST engine/events @ 后台域名" — 带上请求目标主机, 指错后台一眼可见。 */
function apiLabel(url) {
  try {
    const u = new URL(url)
    const path = u.pathname.split('/').filter(Boolean).slice(-2).join('/')
    return `${path} @ ${u.hostname}`
  } catch {
    return String(url).slice(0, 80)
  }
}

/** 把底层 fetch 错误翻译成人话: 超时/断连/限速/鉴权 一眼可辨, 并附请求标签与耗时。
 *  Node fetch 表面只给 "fetch failed", 真实原因 (ETIMEDOUT/ECONNRESET/DNS…) 全藏在
 *  e.cause 链里 — 此处逐层解包后再匹配, 绝不让日志只留一句 fetch failed。 */
function describeApiError(e, label, startedAt, timeoutMs) {
  const elapsed = Date.now() - startedAt
  const causes = []
  let cur = e
  for (let i = 0; i < 4 && cur; i++) {
    causes.push(String(cur?.message || cur))
    cur = cur?.cause
  }
  const raw = causes.filter(Boolean).join(' → ')
  const cause = /aborted due to timeout|The operation was aborted|AbortError/i.test(raw)
    ? `超时 (${Math.round(timeoutMs / 1000)}s 无响应, 实际等待 ${(elapsed / 1000).toFixed(1)}s)`
    : /ETIMEDOUT|Connect Timeout|connect.*timed?out/i.test(raw)
      ? `连接超时 (TCP 握手无响应, 实际等待 ${(elapsed / 1000).toFixed(1)}s) — 网络丢包或对端防火墙丢包`
      : /ECONNRESET|socket hang up|Undici SocketError/i.test(raw)
        ? `连接被对端重置 (ECONNRESET${causes.length > 1 ? ` [${causes[1].slice(0, 80)}]` : ''})`
        : /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)
          ? `DNS 解析失败 (域名解析不通 [${causes[1]?.slice(0, 80) || raw.slice(0, 80)}])`
          : /ECONNREFUSED/i.test(raw)
            ? '连接被拒绝 (端口未监听, 服务没起)'
            : /EHOSTUNREACH|ENETUNREACH/i.test(raw)
              ? '网络不可达 (路由不通)'
              : /CERT|SSL|TLS/i.test(raw)
                ? `TLS 证书错误 [${causes[1]?.slice(0, 80) || ''}]`
                : raw.slice(0, 160)
  return `${label}: ${cause}`
}

async function apiCall(url, body, timeoutMs = 30_000) {
  const label = `${body ? 'POST' : 'GET'} ${apiLabel(url)}`
  const startedAt = Date.now()
  let res
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${ENGINE_TOKEN}`,
        'Content-Type': 'application/json',
        // 后台接口必须带浏览器 UA: 空 UA 的数据中心请求会被 CF 边缘 bot 防护拖入慢路径
        // (实测无 UA 的 POST 20s+ 无响应, Chrome UA 2~6s 返回) — 上报超时直接原因之一
        'User-Agent': resolveChromeUA().ua,
        // 声明拉取能力: 后台对聊天/交易事件快速 ACK (占位后挂后台决策), 本代理按 event_id 轮询回收
        // 决策不再阻塞上报响应, 消灭「AI 慢 → 上报超时 → 回队重试 → 重复决策」风暴
        'x-engine-pull': '1',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    // 网络层失败 (超时/DNS/断连): 带上请求标签与耗时重抛, 调用方日志直接可读
    adminFailStreak += 1
    throw Object.assign(new Error(describeApiError(e, label, startedAt, timeoutMs)), { label, network: true })
  }
  const elapsed = Date.now() - startedAt
  // 收到任何 HTTP 响应 (含 429/401/5xx) 都证明网络通、后台进程活着, 连败计数清零
  if (adminFailStreak > 0) {
    log(`后台已恢复: 连续失败 ${adminFailStreak} 次后重新收到响应 (${label}, HTTP ${res.status}, 耗时 ${elapsed}ms)`)
  }
  adminFailStreak = 0
  lastAdminOkAt = Date.now()
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') || 5) || 5
    throw Object.assign(new Error(`${label}: 后台限速 429, ${retryAfter}s 后重试`), { rateLimited: retryAfter, label })
  }
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error(`${label}: 鉴权失败 (${res.status}): 令牌无效/引擎被停用, 请核对 XY_ENGINE_TOKEN`), { fatal: true, label })
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw Object.assign(
      new Error(`${label}: 后台响应异常 HTTP ${res.status} (${elapsed}ms)${errText ? ` — ${errText.slice(0, 160)}` : ''}`),
      { label },
    )
  }
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
  const batch = reportQueue.splice(0, 100)
  // (v2.1.20) 多后台路由拆分: action_result 只回执给决策所属后台 (log_id 是各后台独立
  // 编号, 广播会串号误标记); 其余事件 (消息会话/风控/状态) 广播给全部活跃后台 —
  // 数据只发往 .env XY_ADMIN_URL 配置的服务器, 单个后台挂了不拖累其它后台
  const broadcast = []
  const perAdmin = new Map()
  for (const entry of batch) {
    const admin = Number(entry?._admin ?? -1)
    if (Number.isInteger(admin) && admin >= 0 && admin < ADMIN_URLS.length) {
      if (!perAdmin.has(admin)) perAdmin.set(admin, [])
      perAdmin.get(admin).push(entry)
    } else {
      broadcast.push(entry)
    }
  }
  const strip = (list) => list.map(({ _admin, ...rest }) => rest)
  const targets = (activeAdmins.size ? [...activeAdmins] : ADMIN_URLS.map((_, i) => i)).filter(
    (i) => broadcast.length > 0 || perAdmin.has(i),
  )
  if (!targets.length) {
    reportQueue.unshift(...batch)
    scheduleFlush(500)
    return
  }
  // 事件批次画像: 条数 / 类型分布, 失败日志一眼可定位是哪批什么事件
  const typeCount = {}
  for (const ev of broadcast) typeCount[String(ev?.type || '?')] = (typeCount[String(ev?.type || '?')] || 0) + 1
  const eventSummary = `${batch.length}条 [${Object.entries(typeCount).map(([t, n]) => `${t}×${n}`).join(' ')}]`
  const status = {
    accounts: [...accountStates.entries()].map(([id, s]) => ({ id, state: s.state, detail: s.detail || '' })),
  }
  // 并行推送全部活跃后台 (各后台独立去重, 重报安全)
  const results = await Promise.allSettled(
    targets.map((i) =>
      apiCallWithRetry(EVENTS_URLS[i], { status, events: [...strip(broadcast), ...strip(perAdmin.get(i) || [])] }, 30_000),
    ),
  )
  const failedIdx = []
  let rateLimitedSecs = 0
  for (let k = 0; k < targets.length; k++) {
    const i = targets[k]
    const r = results[k]
    if (r.status === 'rejected') {
      failedIdx.push(i)
      const e = r.reason
      if (e?.fatal) {
        handleFatalAdmin(i, e)
      } else {
        const streak = (adminEventFailStreak.get(i) || 0) + 1
        adminEventFailStreak.set(i, streak)
        if (streak >= 5) {
          activeAdmins.delete(i)
          log(`后台#${i + 1} (${adminHost(i)}) 事件上报连续失败 ${streak} 次, 暂停推送该后台 (其余后台不受影响, 配置轮询成功后自动恢复)`)
        } else {
          log(`上报失败: 后台#${i + 1} (${adminHost(i)}) POST events 批次 ${eventSummary} — ${e?.message}`)
        }
        if (e?.rateLimited) rateLimitedSecs = Math.max(rateLimitedSecs, Number(e.rateLimited) || 5)
      }
      continue
    }
    adminEventFailStreak.set(i, 0)
    try {
      const resp = r.value
      const actions = Array.isArray(resp?.actions) ? resp.actions : []
      if (actions.length) await executeActions(actions, i)
      const pullIds = Array.isArray(resp?.pending) ? resp.pending.map(String) : []
      if (pullIds.length) await pullActions(pullIds, [...broadcast, ...(perAdmin.get(i) || [])], i)
    } catch (e) {
      if (e?.fatal) handleFatalAdmin(i, e)
      else log(`后台#${i + 1} (${adminHost(i)}) 动作执行/决策拉取异常: ${e?.message}`)
    }
  }
  if (failedIdx.length) {
    // 回队: 广播事件整体回队 (成功后台按 event_id 去重安全); action_result 只回给失败的后台
    for (const ev of broadcast) reportQueue.unshift(ev)
    for (const i of failedIdx) reportQueue.unshift(...(perAdmin.get(i) || []))
    if (rateLimitedSecs) await sleep(Math.min(rateLimitedSecs * 1000, 30_000))
    else await sleep(3000)
    scheduleFlush(500)
  }
}

/** 多后台致命错误 (鉴权失效): 单后台保持旧契约退出; 多后台只停推该后台, 不拖死其它后台。 */
function handleFatalAdmin(adminIdx, e) {
  if (ADMIN_URLS.length === 1) {
    log(`致命错误: ${e.message} — 代理退出 (修正配置后重启)`)
    process.exit(1)
  }
  activeAdmins.delete(adminIdx)
  log(`后台#${adminIdx + 1} (${adminHost(adminIdx)}) 致命错误: ${e.message} — 已停推该后台 (其余后台不受影响, 修正令牌后重启生效)`)
}

function adminHost(adminIdx) {
  try {
    return new URL(ADMIN_URLS[adminIdx]).hostname
  } catch {
    return String(ADMIN_URLS[adminIdx] || '?').slice(0, 60)
  }
}

/**
 * 回收异步决策结果: 后台大脑 (AI/发货链) 完成前, 按 event_id 每 2.5s 轮询拉取,
 * 动作随拉取响应返回后照常人化执行 (executedActions 按 log_id 去重, 重放绝不重发)。
 * 占位超时被后台判失效 (expired) 或达拉取上限仍未完成 → 事件重新上报自愈。
 */
async function pullActions(ids, originEvents, adminIdx = 0) {
  let remaining = ids.slice()
  for (let attempt = 0; attempt < 72 && remaining.length && !stopped; attempt++) {
    await sleep(attempt === 0 ? 1200 : 2500)
    let resp
    try {
      resp = await apiCallWithRetry(EVENTS_URLS[adminIdx], { pull: remaining }, 30_000)
    } catch (e) {
      if (e?.fatal) throw e
      continue // 网络抖动继续拉, 拉取上限兜底
    }
    const actions = Array.isArray(resp?.actions) ? resp.actions : []
    if (actions.length) await executeActions(actions, adminIdx)
    const expired = Array.isArray(resp?.expired) ? resp.expired.map(String) : []
    if (expired.length) {
      log(`决策超时失效 ${expired.length} 个事件 (后台#${adminIdx + 1}), 重新上报`)
      reportQueue.unshift(...originEvents)
      scheduleFlush(500)
    }
    remaining = Array.isArray(resp?.pending) ? resp.pending.map(String) : []
  }
  if (remaining.length) {
    log(`${remaining.length} 个事件决策未完成 (后台#${adminIdx + 1}), 重新上报`)
    reportQueue.unshift(...originEvents)
    scheduleFlush(500)
  }
}

/** 已执行动作登记 (按决策日志 id): 重试重放同一动作时只回执不重发, 保证买家恰好收到一次 */
const executedActions = new Map()

function pruneExecutedActions() {
  if (executedActions.size <= 500) return
  const cutoff = Date.now() - 30 * 60_000
  for (const [k, v] of executedActions) {
    if (v.at < cutoff) executedActions.delete(k)
  }
  while (executedActions.size > 800) {
    const first = executedActions.keys().next().value
    if (first === undefined) break
    executedActions.delete(first)
  }
}

async function executeActions(actions, adminIdx = 0) {
  const logCounter = new Map()
  for (const action of actions) {
    const client = clients.get(String(action.account || ''))
    if (!client) {
      log(`动作丢弃 (后台#${adminIdx + 1}): 账号 ${action.account} 不由本代理托管`)
      continue
    }
    const logId = Number(action.log_id || 0)
    let actionKey = ''
    if (logId > 0) {
      // actionKey 带后台下标: log_id 是各后台独立编号, 不带前缀会跨后台误判「已执行过」
      const seq = logCounter.get(logId) || 0
      logCounter.set(logId, seq + 1)
      actionKey = `a${adminIdx}:${logId}#${seq}`
      const done = executedActions.get(actionKey)
      if (done) {
        // 同一动作的重放 (上轮响应丢失后的重试): 不重发, 仅补报执行结果 (只回决策所属后台)
        if (done.ok) log(`动作已执行过, 跳过重发 (后台#${adminIdx + 1} log ${logId})`)
        enqueueReport({ type: 'action_result', _admin: adminIdx, account: String(action.account || ''), log_id: logId, ok: done.ok, error: done.error || '' })
        continue
      }
    }
    let ok = true
    let err = ''
    try {
      const delay = Math.max(0, Math.round(Number(action.delay_ms || 0)))
      if (action.type === 'send_text') {
        await client.sendText(String(action.chat_id), String(action.to_user_id), String(action.text || ''), delay)
        log(`已发送文本 (后台#${adminIdx + 1}) → 账号 ${action.account} 会话 ${action.chat_id}`)
      } else if (action.type === 'send_image') {
        await client.sendImage(
          String(action.chat_id),
          String(action.to_user_id),
          String(action.image_url || ''),
          Number(action.width || 800),
          Number(action.height || 600),
          delay,
        )
        log(`已发送图片 (后台#${adminIdx + 1}) → 账号 ${action.account} 会话 ${action.chat_id}`)
      }
    } catch (e) {
      ok = false
      err = String(e?.message || '').slice(0, 300)
      log(`动作执行失败 (${action.type} → ${action.account}): ${err}`)
    }
    if (logId > 0) {
      executedActions.set(actionKey, { ok, error: err, at: Date.now() })
      pruneExecutedActions()
      enqueueReport({ type: 'action_result', _admin: adminIdx, account: String(action.account || ''), log_id: logId, ok, error: err })
    }
  }
}

/* ------------- 事件幂等 id (同一条原始同步包条目在重连重放与上报重试间保持稳定) ------------- */

const sink = {
  onState(cookieId, state, detail) {
    accountStates.set(cookieId, { state, detail })
    if (state !== 'disabled') enqueueReport({ type: '__state__' })
  },
  onSyncItem(cookieId, data) {
    // 纯透传: 原始 base64 条目不动, 幂等 id 由 (账号, 原文) 哈希得出 — 解码/去重决策全在后台
    enqueueReport({
      type: 'sync_item',
      account: cookieId,
      event_id: syncItemId(cookieId, data),
      data,
    })
  },
  onRisk(cookieId, description) {
    enqueueReport({ type: 'risk', account: cookieId, event_id: 'r:' + createHash('sha1').update([cookieId, description].join('|')).digest('hex') })
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
 * 后台请求(带快速重试): 后台域名(pages.dev 等)在公网链路存在间歇性丢包/限速
 * (实测同域名静态与接口均 ~半数请求超时, 而 TCP/边缘 trace 全通), 单次失败不
 * 代表不可达 —— 3s 后立即换新连接重试一次, 把高丢包链路下的轮空率压到最低。
 * 致命(鉴权)与限速错误不重试, 原样上抛。配置轮询/事件上报/决策拉取共用。
 * 每次失败都打详细日志: 哪个请求 / 第几次尝试 / 失败原因 (超时带无响应时长)。
 */
async function apiCallWithRetry(url, body, timeoutMs = 30_000) {
  try {
    return await apiCall(url, body, timeoutMs)
  } catch (e) {
    if (e?.fatal || e?.rateLimited) throw e
    // 重试等待期间并行做 DNS/TCP 分层诊断, 探测结果随失败日志输出 (不拖慢重试节奏)
    const [diag] = await Promise.all([
      e?.network ? probeReachability(url) : Promise.resolve(''),
      sleep(3000),
    ])
    log(`后台请求失败 (第 1 次尝试): ${e?.message}${diag ? ` ${diag}` : ''}${adminHealthNote()} — 现在换新连接重试`)
    try {
      return await apiCall(url, body, timeoutMs)
    } catch (e2) {
      log(`后台请求失败 (第 2 次尝试): ${e2?.message}${adminHealthNote()} — 放弃本轮`)
      throw e2
    }
  }
}

async function pollConfigOnce() {
  // (v2.1.20) 多后台配置轮询: 并行拉全部后台, 成功者参与账号合并;
  // 全部失败才走旧失败路径 (连续失败自检)。单后台行为与旧版完全一致。
  const results = await Promise.allSettled(ADMIN_URLS.map((_, i) => apiCallWithRetry(CONFIG_URLS[i])))
  const okConfigs = [] // [adminIdx, cfg] 按 XY_ADMIN_URL 配置顺序 (同账号靠前后台优先)
  const failures = []
  for (let i = 0; i < ADMIN_URLS.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') okConfigs.push([i, r.value])
    else failures.push([i, r.reason])
  }
  if (!okConfigs.length) {
    const e = failures[0][1]
    if (e?.fatal) {
      log(`致命错误: ${e.message} — 代理退出 (修正配置后重启)`)
      process.exit(1)
    }
    if (e?.rateLimited) {
      log(`配置拉取失败: GET engine/config — ${e.message}`)
      return
    }
    log(`配置拉取失败: GET engine/config (连续第 ${configFailStreak + 1} 次) — ${e?.message} — 下轮重试`)
    // 连续失败自动网络自检(第 2 次触发, 此后每 10 次复查): 定位 DNS/TCP/SNI 过滤/整机断路
    configFailStreak += 1
    if (configFailStreak === 2 || configFailStreak % 10 === 0) await diagnoseNetwork()
    return
  }
  configFailStreak = 0
  const wasActive = engineActive
  // 活跃后台集合: 配置成功且 active=true 的后台 (事件只推活跃后台; 本轮拉取失败的后台
  // 保留上一轮的活跃判定, 鉴权致命错误才即时摘除)
  const newActive = new Set()
  let intervalsApplied = false
  for (const [i, cfg] of okConfigs) {
    if (!cfg?.active) continue
    newActive.add(i)
    // 轮询/心跳间隔: 取第一个下发 intervals 的活跃后台 (靠前后台优先, 不互相覆盖)
    if (!intervalsApplied && (cfg.intervals?.poll_seconds || cfg.intervals?.heartbeat_seconds)) {
      if (cfg.intervals?.poll_seconds) {
        pollSeconds = Math.max(10, Math.round(Number(cfg.intervals.poll_seconds) || DEFAULT_POLL_SECONDS))
      }
      if (cfg.intervals?.heartbeat_seconds) {
        heartbeatSeconds = Math.min(60, Math.max(5, Math.round(Number(cfg.intervals.heartbeat_seconds) || 15)))
      }
      intervalsApplied = true
    }
  }
  activeAdmins = newActive
  engineActive = newActive.size > 0

  if (!engineActive) {
    if (wasActive || clients.size) {
      log('全部后台引擎均非使用中 (备用状态), 全部账号下线 (多引擎互斥)')
      for (const id of [...clients.keys()]) await stopClient(id)
    }
    return
  }

  // 账号对齐 (多后台合并): 只取活跃后台下发的账号; 同账号被多个后台同时下发时只建
  // 一条闲鱼长连接 (靠前后台优先) — 双后台同账号并行决策会给买家发两份消息, 连接层
  // 必须唯一; 事件仍并行推送全部活跃后台 (各后台按自己库里的账号归属自行取舍)。
  const wanted = new Map()
  for (const [i, cfg] of okConfigs) {
    if (!cfg?.active) continue
    for (const a of Array.isArray(cfg.accounts) ? cfg.accounts : []) {
      const id = a?.id && String(a.id)
      if (!id) continue
      if (wanted.has(id)) {
        const last = dupWarnAt.get(id) || 0
        if (Date.now() - last > 10 * 60_000) {
          dupWarnAt.set(id, Date.now())
          log(`账号 ${id} 被多个后台同时下发 (后台#${i + 1} 重复), 仅保留靠前后台的连接定义; 事件仍并行推送全部活跃后台`)
        }
        continue
      }
      wanted.set(id, accountEntryFromConfig(a))
    }
  }

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

  if (!wasActive && engineActive) log(`引擎已激活: 托管 ${wanted.size} 个账号 (活跃后台 ${[...newActive].map((i) => `#${i + 1}`).join(' ')})`)
  pollOkCount += 1
  if (pollOkCount % 10 === 1) {
    log(`配置轮询正常: active=${engineActive}, 活跃后台 ${newActive.size}/${ADMIN_URLS.length}, 下发账号 ${wanted.size}, 本地连接 ${clients.size}` + (pollOkCount === 1 ? '' : ` (连续成功 ${pollOkCount}; 成功默认静默, 每 10 次打印一次)`))
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
    // (v2.1.20) 逐后台自检 (多后台各查各的链路, 断哪个一眼可见)
    for (let i = 0; i < ADMIN_URLS.length; i++) await diagnoseAdminNetwork(i)
  } finally {
    diagRunning = false
  }
}

async function diagnoseAdminNetwork(adminIdx) {
  const adminUrl = ADMIN_URLS[adminIdx]
  const tag = ADMIN_URLS.length > 1 ? `后台#${adminIdx + 1} (${adminHost(adminIdx)}) ` : ''
  try {
    const u = new URL(adminUrl)
    const host = u.hostname
    const port = Number(u.port) || 443
    log(`${tag}网络自检: 拉取连续失败, 自动定位断点 (DNS → TCP → Cloudflare 对照 → 后台域名)...`)
    const [ips, tcpMs, cfOk, targetOk] = await Promise.all([
      dns.promises.lookup(host, { all: true }).catch(() => []),
      tcpConnectMs(host, port),
      fetchTraceOk('https://www.cloudflare.com/cdn-cgi/trace'),
      fetchTraceOk(`${adminUrl}/cdn-cgi/trace`),
    ])
    const ipText = (Array.isArray(ips) && ips.length ? ips : []).map((r) => `${r.address}(v${r.family})`).join(' ') || '解析失败'
    log(`${tag}网络自检结果: DNS=${ipText}; TCP443=${tcpMs ? tcpMs + 'ms' : '不通'}; Cloudflare对照站=${cfOk ? '通' : '不通'}; 后台域名=${targetOk ? '通' : '不通'}`)
    if (!Array.isArray(ips) || !ips.length) {
      log(`${tag}自检结论: DNS 解析失败 — 检查容器/系统 DNS 配置 (可换 1.1.1.1 / 8.8.8.8)`)
    } else if (!tcpMs) {
      log(`${tag}自检结论: ` + (cfOk
        ? `能连 Cloudflare 其它站点, 但到 ${host}:${port} 的 TCP 不通 — 该机房/上游拦截了目标网段, 换出口机器或联系机房`
        : 'TCP 全不通 — 这台机器到 Cloudflare 整体断路, 此机器无法运行代理; 换出口 (家用电脑/住宅 IP 更优, 闲鱼风控面也更友好)'))
    } else if (!targetOk) {
      log(`${tag}自检结论: ` + (cfOk
        ? `TCP 通且 Cloudflare 其它站点可达, 唯独 ${host} 被丢包 — 该网络对此域名(SNI)过滤; 最有效解法: 给 Pages 项目绑定自定义域名(Custom domains), XY_ADMIN_URL 换成自定义域名`
        : `到 ${host} 与 Cloudflare 对照站均丢包 — 该机房到 CF 骨干路由异常, 换出口机器`))
    } else {
      log(`${tag}自检结论: DNS/TCP/TLS 全部可达 — 此前失败应为瞬时抖动; 若仍持续失败, 检查后台服务状态与日志`)
    }
  } catch (e) {
    log(`${tag}网络自检异常: ${String(e?.message || e).slice(0, 120)}`)
  }
}

async function configLoop() {
  while (!stopped) {
    await pollConfigOnce()
    await sleep(jitter(pollSeconds * 1000, 0.1))
  }
}

/* ------------- 任务通道: 后台下发的需“可达闲鱼的机器执行”的工作 (http_fetch/send_message) -------------
 * 背景: CF Pages 出口到闲鱼 mtop 网关 (h5api) 被墙 — 后台把任务写入 engine_tasks 表,
 * 代理从此处领取并本地转发, 结果经 events task_result 回报 (后台轮询任务行取回)。
 * http_fetch 是纯透传: 请求由后台构造并签名, 代理原样转发, 原始响应文本原样回报 —
 * 代理不读不改不解析, 解析主权 100% 在后台。 */

/**
 * 执行 http_fetch 任务: 逐个转发后台构造好的 HTTP 请求 (白名单限闲鱼/淘系域名),
 * 回报原始响应 { status, text, set_cookie }。不解析不重试不重签 — 业务逻辑全在后台。
 */
async function executeHttpFetchTask(payload, taskId = 0) {
  const requests = Array.isArray(payload?.requests) ? payload.requests.slice(0, 5) : []
  if (!requests.length) return { ok: false, data: { error: '任务缺少 requests 请求列表' } }
  const responses = []
  for (const req of requests) {
    let target
    try {
      target = new URL(String(req?.url || ''))
    } catch {
      return { ok: false, data: { error: '请求 URL 非法', responses } }
    }
    if (!/^https?:$/.test(target.protocol) || !gwAllowed(target.hostname)) {
      return { ok: false, data: { error: `目标不在透传白名单 (仅闲鱼/淘系域名): ${target.hostname.slice(0, 80)}`, responses } }
    }
    const headers = {}
    for (const [k, v] of Object.entries(req?.headers || {})) if (v && !GATEWAY_SKIP_HEADERS.has(String(k).toLowerCase())) headers[k] = String(v)
    const method = String(req?.method || 'GET').toUpperCase()
    const body = method === 'GET' || method === 'HEAD' ? undefined : String(req?.body || '')
    const timeoutMs = Math.min(Math.max(Math.round(Number(req?.timeout_ms) || 20_000), 3_000), GATEWAY_TIMEOUT_MS)
    const startedAt = Date.now()
    try {
      const upstream = await fetch(target, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
      const text = (await upstream.text()).slice(0, 4 * 1024 * 1024)
      responses.push({ status: upstream.status, text, set_cookie: upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : [] })
      const ms = Date.now() - startedAt
      const kb = (text.length / 1024).toFixed(1)
      log(`透传任务${taskId ? ` #${taskId}` : ''}: ${method} ${target.host}${target.pathname.slice(0, 64)} → ${upstream.status} (${ms}ms, ${kb}KB)`)
    } catch (e) {
      const ms = Date.now() - startedAt
      const raw = String(e?.message || e)
      const cause = /aborted due to timeout/i.test(raw) ? `超时 (${Math.round(timeoutMs / 1000)}s 无响应)` : raw.slice(0, 140)
      log(`透传任务${taskId ? ` #${taskId}` : ''}: ${method} ${target.host}${target.pathname.slice(0, 64)} 失败 (${ms}ms) — ${cause}`)
      return { ok: false, data: { error: `透传请求失败: ${cause}`, responses } }
    }
    if (requests.length > 1) await sleep(400)
  }
  return { ok: true, data: { responses } }
}

/**
 * 执行 send_message 任务: 消息管理页手动发送 — 内置引擎未托管账号时由代理本地 WS 发送。
 * 复用账号长连接与 client.sendText (与决策动作发送同源协议)。
 */
async function executeSendMessageTask(payload) {
  const cookieId = String(payload?.cookie_id || '')
  const client = clients.get(cookieId)
  if (!client) return { ok: false, data: { error: `账号 ${cookieId || '未知'} 不由本代理托管 (账号未启用或未在线)` } }
  const chatId = String(payload?.chat_id || '')
  const toUserId = String(payload?.to_user_id || '')
  const text = String(payload?.text || '')
  if (!chatId || !toUserId || !text) return { ok: false, data: { error: '任务缺少会话/收件人/内容' } }
  await client.sendText(chatId, toUserId, text, 0)
  log(`任务发送文本 → 账号 ${cookieId} 会话 ${chatId} (${text.length} 字)`)
  return { ok: true, data: {} }
}

/** 领取并执行一轮任务 (无任务静默返回; 单任务异常不影响后续任务与轮询循环)。 */
async function pollTasksOnce(adminIdx = 0) {
  if (!engineActive) return
  let resp
  try {
    resp = await apiCallWithRetry(TASKS_URLS[adminIdx], undefined, 15_000)
  } catch (e) {
    if (e?.fatal) throw e
    log(`任务领取失败 (后台#${adminIdx + 1}): GET engine/tasks — ${e?.message} — 下轮重试 (已领取任务不受影响, 任务过期由后台守护)`)
    return
  }
  const tasks = Array.isArray(resp?.tasks) ? resp.tasks : []
  for (const task of tasks) {
    const taskId = Number(task?.id || 0)
    if (!taskId) continue
    let payload = {}
    try { payload = JSON.parse(String(task?.payload || '{}')) } catch {}
    let result
    try {
      result = task?.type === 'http_fetch'
        ? await executeHttpFetchTask(payload, taskId)
        : task?.type === 'send_message'
          ? await executeSendMessageTask(payload)
          : { ok: false, data: { errors: [`未知任务类型: ${String(task?.type).slice(0, 32)}`] } }
    } catch (e) {
      result = { ok: false, data: { errors: [String(e?.message || e).slice(0, 200)] } }
    }
    // 回报带重试 (3 次 × 15s): 任务结果是订单同步/手动发送的同步等待依据,
    // 回报丢失 = 后台等满超时才拿到空结果 = 一键同步「挂起感」的直接来源之一
    let reported = false
    let lastErr = ''
    for (let attempt = 1; attempt <= 3 && !reported && !stopped; attempt++) {
      try {
        await apiCall(EVENTS_URLS[adminIdx], {
          events: [{ type: 'task_result', task_id: taskId, ok: !!result.ok, data: result.data || {} }],
        }, 15_000)
        reported = true
      } catch (e) {
        lastErr = e?.message
        if (e?.fatal) throw e
        if (attempt < 3) {
          log(`任务 #${taskId} (${task?.type}) 结果回报失败 (第 ${attempt}/3 次): ${lastErr} — 2s 后重试`)
          await sleep(2000)
        }
      }
    }
    if (!reported) {
      log(`任务 #${taskId} (${task?.type}) 结果回报彻底失败 (3 次均失败): ${lastErr} — 后台轮询将判过期, 请检查到后台的链路`)
    }
  }
}

async function tasksLoop() {
  while (!stopped) {
    // (v2.1.20) 逐后台领取任务 (task_id/log_id 各后台独立编号, 哪家下发回哪家)
    for (let i = 0; i < ADMIN_URLS.length; i++) {
      if (stopped) break
      if (!activeAdmins.has(i)) continue
      try {
        await pollTasksOnce(i)
      } catch (e) {
        if (e?.fatal) {
          handleFatalAdmin(i, e)
        }
      }
    }
    await sleep(jitter(DEFAULT_TASK_POLL_SECONDS * 1000, 0.1))
  }
}

/**
 * 状态心跳: 空闲期也定期上报连接状态, 后台账号心跳 (cookies.last_check_at) 由此保持
 * 新鲜 —— 否则静默 60s 后监听页会把在线账号误判为 engine_offline (监听中归零)。
 * 队列非空时跳过 (上报本身就携带 status)。
 */
async function statusHeartbeatLoop() {
  while (!stopped) {
    await sleep(jitter(Math.max(5, heartbeatSeconds) * 1000, 0.15))
    if (stopped || !engineActive) continue
    if (!reportQueue.length) enqueueReport({ type: '__state__' })
  }
}

/* --------------------- 健康检查 + POST 透传网关 (选填, XY_PROXY_PORT) --------------------- */

if (PROXY_PORT > 0) {
  // 白名单/头过滤/超时上限为模块级常量 (与任务通道共用), 此处只负责 HTTP 服务壳
  const readGatewayBody = (req, max = 512 * 1024) =>
    new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > max) {
          reject(new Error('body too large'))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          ok: true,
          script_version: `v${SCRIPT_VERSION}`,
          engine_active: engineActive,
          gateway: true,
          accounts: [...accountStates.entries()].map(([id, s]) => ({ id, state: s.state })),
          uptime_seconds: Math.round(process.uptime()),
        }),
      )
      return
    }
    if (req.url === '/gateway' && req.method === 'POST') {
      const json = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(obj))
      }
      try {
        if (!ENGINE_TOKEN) {
          json(403, { ok: false, error: '网关未配置鉴权令牌 (XY_ENGINE_TOKEN), 已禁用透传' })
          return
        }
        if (req.headers.authorization !== `Bearer ${ENGINE_TOKEN}`) {
          json(401, { ok: false, error: '鉴权失败: Bearer 令牌须与本代理 XY_ENGINE_TOKEN (后台「监听服务」页引擎行接入令牌) 一致' })
          return
        }
        const payload = JSON.parse(await readGatewayBody(req))
        const target = new URL(String(payload?.url || ''))
        if (!/^https?:$/.test(target.protocol) || !gwAllowed(target.hostname)) {
          json(403, { ok: false, error: `目标不在透传白名单 (仅闲鱼/淘系域名): ${target.hostname.slice(0, 80)}` })
          return
        }
        const headers = {}
        for (const [k, v] of Object.entries(payload?.headers || {})) if (v && !GATEWAY_SKIP_HEADERS.has(String(k).toLowerCase())) headers[k] = String(v)
        const method = String(payload?.method || 'GET').toUpperCase()
        const body = method === 'GET' || method === 'HEAD' ? undefined : String(payload?.body || '')
        const timeoutMs = Math.min(Math.max(Math.round(Number(payload?.timeout_ms) || 20_000), 3_000), GATEWAY_TIMEOUT_MS)
        const started = Date.now()
        const upstream = await fetch(target, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
        const text = (await upstream.text()).slice(0, 4 * 1024 * 1024)
        // v2.1.16: 附带全部单值响应头 (location/content-type 等) — 后台扫码登录人脸核验链
        // 需逐跳读 location 驱动 302 链 (set_cookie 已单独返回, 此处排除防重复)
        const respHeaders = {}
        for (const [k, v] of upstream.headers.entries()) {
          const lk = String(k).toLowerCase()
          if (lk === 'set-cookie' || lk === 'content-encoding' || lk === 'content-length' || lk === 'transfer-encoding') continue
          respHeaders[lk] = v
        }
        json(200, { ok: true, status: upstream.status, text, set_cookie: upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : [], headers: respHeaders })
        log(`透传网关: ${method} ${target.host}${target.pathname.slice(0, 64)} → ${upstream.status} (${Date.now() - started}ms)`)
      } catch (e) {
        json(502, { ok: false, error: `透传转发失败: ${String(e?.message || e).slice(0, 160)}` })
        log(`透传网关转发失败: ${String(e?.message || e).slice(0, 140)}`)
      }
      return
    }
    res.writeHead(404)
    res.end()
  })
  server.listen(PROXY_PORT, () =>
    log(`HTTP 服务已监听: http://0.0.0.0:${PROXY_PORT} (GET /health 健康检查 + POST /gateway mtop 透传网关, Bearer 鉴权=XY_ENGINE_TOKEN, 绑定全部网卡 — 公网入站须放行端口)`),
  )
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

log(`独立代理已启动 → 后台 ${ADMIN_URLS.join(' | ')}${ADMIN_URLS.length > 1 ? ` (多后台并行推送 ${ADMIN_URLS.length} 个)` : ''}${PROXY_PORT > 0 ? ` (透传网关已开启 :${PROXY_PORT}/gateway)` : ''}`)
log(`配置轮询 ${DEFAULT_POLL_SECONDS}s (以后台下发的 intervals 为准), 事件上报合并窗口 250ms, 任务轮询 ${DEFAULT_TASK_POLL_SECONDS}s`)
configLoop().catch((e) => {
  log(`主循环异常退出: ${e?.message}`)
  process.exit(1)
})
tasksLoop().catch((e) => {
  log(`任务循环异常退出: ${e?.message}`)
  process.exit(1)
})
statusHeartbeatLoop().catch(() => {})
