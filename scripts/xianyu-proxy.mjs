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
 *   7. Web 管理面板 (v2.2.0, 选填 XY_PROXY_ADMIN_SECRET) — 与 /health、/gateway 共用
 *      XY_PROXY_PORT 端口: 登录密钥鉴权 (HttpOnly 会话 + 防爆破) / 配置编辑 (直写 .env,
 *      保存后重启进程生效) / 详细日志手动刷新 / 上传 xianyu-proxy.mjs 覆盖 (旧文件时间戳
 *      改名备份, node --check 预检) / 停止·启动·重启服务 / 重启进程
 *
 * 部署: 上传本文件到任意能出网的机器 (Node ≥ 20; Node 20 若无内置 WebSocket
 * 请在同目录 `npm i ws`), 配好环境变量后 `node xianyu-proxy.mjs`。
 * 代理主动外呼后台, 无需公网入站端口。
 *
 * 两种用法 (同一脚本, 区别只在是否填 XY_PROXY_PORT):
 *   ① 任务模式 (默认, 不填 XY_PROXY_PORT): 代理主动外呼后台 — 配置轮询 + WS 消息监听
 *      + 任务通道 (http_fetch 透传走任务领取/回报), 无需公网入站端口。
 *   ② 任务模式 + 透传网关 + Web 面板 (填 XY_PROXY_PORT): 在 ① 基础上, 同端口额外开启
 *      POST /gateway 透传网关 — 后台 (CF Pages) 直连本机转发 mtop 请求 (解决 CF 出口
 *      到 h5api 被墙 500 超时), 需服务器公网固定 IP + 防火墙放行端口, 引擎行登记该地址;
 *      再配 XY_PROXY_ADMIN_SECRET 即同端口开启 Web 管理面板 (http://代理IP:端口/)。
 *
 * 多后台并行推送 (v2.2.0):
 *   XY_ADMIN_URL=地址1|地址2|地址3  — `|` 分隔最多 3 个, 拆分后 trim() 去头尾空格,
 *   Set 去重, 超限取前 3 并告警; 单后台配置行为与旧版完全一致。
 *   - 消息/会话/风控/状态事件并行推送 (Promise.allSettled) 到全部活跃后台 (活跃集合由
 *     各后台 config.active 驱动); 部分失败只回队失败后台的事件; 某后台连续 5 次失败
 *     自动暂停推送 (防一个死后台堵死队列拖累其它后台), 配置轮询成功自动恢复
 *   - 同账号只建一条闲鱼连接 (XY_ADMIN_URL 靠前的后台优先, 重复下发 10 分钟限频告警)
 *     — 两个后台对同一账号并行决策会给买家发两份消息, 连接层必须唯一
 *   - 决策/任务按后台隔离绝不串号: action_result 带后台下标只回执决策所属后台
 *     (log_id/task_id 各后台独立编号, 去重 key 加 a{后台}: 前缀防跨后台误判「已执行过」);
 *     任务通道逐后台领取, 哪家下发回哪家
 *   - 容错分级: 鉴权致命错误 (401/403) — 单后台保持旧契约退出进程; 多后台只停推该后台
 *     不拖死其它; 网络自检逐后台执行
 *
 * 环境变量:
 *   XY_ADMIN_URL     后台地址 (必填, 如 https://xianyu-admin.pages.dev; 多后台 | 分隔最多 3 个)
 *   XY_ENGINE_TOKEN  引擎接入令牌 (必填, 后台「监听服务」页该代理行的接入令牌;
 *                    透传网关鉴权复用同一令牌, Bearer XY_ENGINE_TOKEN)
 *   XY_PROXY_PORT    本地 HTTP 端口 (选填, 默认关闭; 绑定全部网卡, 开启后同端口提供
 *                    GET /health 运行状态 + POST /gateway mtop 透传网关 (Bearer 鉴权)
 *                    + Web 管理面板 (需 XY_PROXY_ADMIN_SECRET))
 *   XY_PROXY_ADMIN_SECRET Web 管理面板登录密钥 (选填; 配置后访问 http://代理IP:端口/ 打开面板)
 *   XY_POLL_SECONDS  配置轮询间隔秒 (选填, 默认 30, 后台下发的 intervals 优先)
 *   XY_TASK_POLL_SECONDS 任务轮询间隔秒 (选填, 默认 3, 越短后台等待任务结果越快)
 *   XY_PKG_VERSION   脚本版本号 (选填, 默认 2.3.13; /health 的 script_version 上报;
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

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import dns from 'node:dns'
import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* --------------------------------- 日志基础设施 (v2.2.0 面板依赖) ---------------------------------
 * console 之外同步双写: ① 脚本同目录 xianyu-proxy.log (5MB 轮转为 .log.1, 跨进程重启留存);
 * ② 进程内存环形缓冲 (最近 1500 行, 无盘可写时面板仍有日志可看)。
 * 必须定义在配置解析之前: dotenv 加载提示/启动配置行都会先于其余常量调用 log()。 */
const SCRIPT_PATH = (() => {
  try { return fileURLToPath(import.meta.url) } catch { return 'xianyu-proxy.mjs' }
})()
const SCRIPT_DIR = path.dirname(SCRIPT_PATH) || '.'
const LOG_FILE = path.join(SCRIPT_DIR, 'xianyu-proxy.log')
const LOG_FILE_MAX_BYTES = 5 * 1024 * 1024
const LOG_RING_MAX = 1500
const logRing = []
let logWriteCount = 0

function log(msg) {
  const line = `[xianyu-proxy] ${new Date().toLocaleString('zh-CN', { hour12: false })} ${msg}`
  console.log(line)
  logRing.push(line)
  if (logRing.length > LOG_RING_MAX) logRing.splice(0, logRing.length - LOG_RING_MAX)
  try {
    // 每 256 行查一次体积做轮转 (statSync 每行调太浪费), 超 5MB 改名 .1 留档
    if (++logWriteCount % 256 === 1) {
      try {
        if (statSync(LOG_FILE).size > LOG_FILE_MAX_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.1`)
      } catch {}
    }
    appendFileSync(LOG_FILE, line + '\n')
  } catch {}
}

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
// XY_PKG_VERSION 读取, 缺省 2.3.13 (容忍手误带 v 前缀)。
const SCRIPT_VERSION = String(process.env.XY_PKG_VERSION || '').trim().replace(/^v/i, '') || '2.3.13'

const ENGINE_TOKEN = String(process.env.XY_ENGINE_TOKEN || '')
const PROXY_PORT = Math.round(Number(process.env.XY_PROXY_PORT || 0)) || 0
const DEFAULT_POLL_SECONDS = Math.max(10, Math.round(Number(process.env.XY_POLL_SECONDS || 30)) || 30)
/**
 * 授权失联释放阈值 (v2.3.2 双连接根治 · 代理侧):
 * 连接的所有权来自后台 config 下发的 active 授权, 授权必须保持新鲜 (config 轮询
 * 默认 ≤30s 一次)。后台连续 90s 拉不到配置 = 授权已不可续 — 此时绝不能继续持有
 * 该后台账号的闲鱼连接: 后台侧会因心跳陈旧接管监听, 双连接 = 双设备指纹双出口 IP,
 * 平台风控直接判「环境异常, 重新登录 + 人脸核验」。释放后后台恢复下发 (active=true)
 * 账号自动重连 (丢了的消息由重连后的同步包补齐, 无监听空窗风险)。
 */
const OWNERSHIP_RELEASE_MS = 90_000
/** 任务轮询间隔秒 (选填, 默认 3): http_fetch 等下发任务的领取频率, 越短后台等得越短 */
const DEFAULT_TASK_POLL_SECONDS = Math.max(2, Math.round(Number(process.env.XY_TASK_POLL_SECONDS || 3)) || 3)
// Web 管理面板登录密钥 (选填): 配置后 XY_PROXY_PORT 端口同源开启 Web 面板。
// let: 面板内修改后热生效 (其余配置改动需重启进程读取)。
let PANEL_SECRET = String(process.env.XY_PROXY_ADMIN_SECRET || '').trim()

/**
 * v2.2.0 多后台解析: XY_ADMIN_URL=地址1|地址2|地址3
 * `|` 分隔最多 3 个, 拆分后 trim() 去头尾空格, Set 去重, 超限取前 3 并告警。
 * 消息/会话数据只发往本处解析出的后台 — 未列入 .env 的服务器永远收不到任何数据。
 */
function parseAdminUrls(raw) {
  const list = []
  const seen = new Set()
  for (const part of String(raw || '').split('|')) {
    const url = part.trim().replace(/\/+$/, '')
    if (!url || seen.has(url)) continue
    seen.add(url)
    list.push(url)
  }
  if (list.length > 3) {
    const total = list.length
    list.length = 3
    log(`XY_ADMIN_URL 配置了 ${total} 个后台, 最多支持 3 个, 已取前 3 个: ${list.join(' | ')}`)
  }
  return list
}

const ADMIN_URLS = parseAdminUrls(process.env.XY_ADMIN_URL)

if (!ADMIN_URLS.length || !ENGINE_TOKEN) {
  console.error('[xianyu-proxy] 缺少配置: XY_ADMIN_URL / XY_ENGINE_TOKEN 为必填项, 进程退出')
  console.error('  三种配置方式任选其一:')
  console.error('  ① 真实环境变量: XY_ADMIN_URL=... XY_ENGINE_TOKEN=... node xianyu-proxy.mjs')
  console.error('  ② .env 文件: 工作目录或脚本同目录放 .env(每行 KEY=VALUE), 启动时自动加载' + (dotenvInfo ? '' : '(当前两处均未找到 .env)'))
  console.error('  ③ 面板变量页: Wispbyte 等面板「Environment」页写入的就是 .env 文件, 本脚本会自动读取; Startup/启动页的变量才是真环境变量, 两处是分开的')
  console.error('  示例 .env (多后台并行推送用 | 分隔, 最多 3 个):')
  console.error('    XY_ADMIN_URL=https://主后台域名|https://备用后台域名')
  console.error('    XY_ENGINE_TOKEN=后台「监听服务」页该代理行的接入令牌')
  console.error('    XY_PROXY_PORT=8880                  # 选填: 开启 HTTP 服务 (/health + /gateway + Web 面板)')
  console.error('    XY_PROXY_ADMIN_SECRET=你的面板密码   # 选填: 配置后 http://代理IP:端口/ 打开 Web 管理面板')
  process.exit(1)
}

if (dotenvInfo && dotenvInfo.injected.length) {
  log(`.env 配置文件已加载: ${dotenvInfo.path} (注入: ${dotenvInfo.injected.join(', ')}; 已存在的环境变量优先不被覆盖)`)
}

/** 多后台形态: >1 = 消息/会话并行推送到全部活跃后台; 单后台所有行为与旧版契约完全一致 */
const MULTI_ADMIN = ADMIN_URLS.length > 1

/* --------------------- 来源域名检测 (v2.2.5) ---------------------
 * XY_ADMIN_URL 配置的后台域名白名单 (最多 3 个, 精准匹配 host[:非标端口])。
 * 规则: 浏览器发起的请求携带 Origin/Referer 头, 其来源域名若既不是本代理自身
 * (Host 头 = 直连面板的正常访问形态), 也不在 XY_ADMIN_URL 后台域名白名单内,
 * 则直接 403 拒绝 — 任意第三方网页/站点对代理 HTTP 服务 (/health /gateway 面板)
 * 的浏览器侧访问一律拦截。
 * 服务端到服务端请求 (无 Origin/Referer 头, 如 /health 探测、/gateway 转发、curl)
 * 不携带浏览器来源, 不受本检测影响, 各端点原有鉴权 (Bearer/会话) 照常生效。 */

/** host 规范化: 统一小写, 剥离默认端口 (80/443) 后精准比对; 非标端口参与匹配 */
function normalizeHostForCompare(rawHost) {
  let host = String(rawHost || '').trim().toLowerCase()
  if (!host) return ''
  host = host.replace(/\/+$/, '')
  try {
    const u = new URL(host.includes('://') ? host : `http://${host}`)
    const hostname = u.hostname.toLowerCase()
    let port = u.port
    if (port === '80' || port === '443') port = ''
    return port ? `${hostname}:${port}` : hostname
  } catch {
    return host
  }
}

const ADMIN_ALLOWED_HOSTS = new Set(ADMIN_URLS.map((u) => normalizeHostForCompare(u)).filter(Boolean))

/** 提取请求来源域名: Origin 优先, Referer 兜底; 无浏览器来源头返回 '' (服务端调用形态) */
function requestSourceHost(req) {
  const origin = String(req.headers.origin || '').trim()
  const referer = String(req.headers.referer || '').trim()
  const raw = origin || referer
  if (!raw) return ''
  return normalizeHostForCompare(raw)
}

/** 来源不在白名单 → 返回 true 并已写 403 响应; 来源合法/无来源 → 返回 false 放行 */
function rejectForeignSource(req, res, pathname) {
  const source = requestSourceHost(req)
  if (!source) return false
  const selfHost = normalizeHostForCompare(req.headers.host)
  if (selfHost && source === selfHost) return false
  if (ADMIN_ALLOWED_HOSTS.has(source)) return false
  log(`⚠ 来源拦截: ${req.method} ${pathname} 来源域名 ${source} 不在 XY_ADMIN_URL 后台域名白名单 (${[...ADMIN_ALLOWED_HOSTS].join(' | ')}), 已拒绝 (仅本代理自身直连与已配置后台域名放行)`)
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({
    ok: false,
    error: `来源域名 ${source} 不在代理后台域名白名单内, 已拒绝 (XY_ADMIN_URL 配置的 ${ADMIN_ALLOWED_HOSTS.size} 个域名与本代理自身可访问)`,
  }))
  return true
}

/**
 * 后台登记表 (v2.2.0): 每个后台独立的连接信息/活跃态/推送健康。
 * 活跃 (active) 由各后台自己的 config.active 驱动 — 某后台把本代理「设为使用」才推送它;
 * paused = 连续 5 次推送失败自动暂停 (轮询成功自动恢复); fatalDisabled = 鉴权致命停用
 * (仅多后台模式, 单后台保持旧契约直接退出)。
 */
const backends = ADMIN_URLS.map((url, index) => {
  let host = url
  try { host = new URL(url).host } catch {}
  return {
    index,
    url,
    host,
    configUrl: `${url}/api/engine/config`,
    eventsUrl: `${url}/api/engine/events`,
    tasksUrl: `${url}/api/engine/tasks`,
    active: false,
    everActive: false,
    paused: false,
    fatalDisabled: false,
    rateLimitedUntil: 0,
    failStreak: 0,
    pushFailStreak: 0,
    configFailStreak: 0,
    pollOkCount: 0,
    lastOkAt: 0,
    lastConfig: null,
    /** 最后一次 config 轮询成功时刻 (0=从未成功): 所有权授权新鲜度的唯一时钟 */
    lastConfigOkAt: 0,
    accounts: [],
  }
})

// 启动即打印生效配置全貌: 后台地址是排查「全部超时」的第一现场 —— 配错了/指向了旧
// 后台, 这一行日志直接可见, 不用再猜。
log(
  `启动配置: 后台(${ADMIN_URLS.length})=${ADMIN_URLS.join(' | ')} | 接入令牌=${ENGINE_TOKEN.slice(0, 6)}…(长度 ${ENGINE_TOKEN.length}) | 脚本版本=v${SCRIPT_VERSION} | ` +
    `配置轮询=${DEFAULT_POLL_SECONDS}s | 任务轮询=${DEFAULT_TASK_POLL_SECONDS}s | HTTP服务=${PROXY_PORT ? `开启 (端口 ${PROXY_PORT}${PANEL_SECRET ? ' + Web面板' : ''})` : '关闭'} | ` +
    `配置来源=${dotenvInfo ? dotenvInfo.path : '进程环境变量'}`,
)
if (MULTI_ADMIN) {
  log(`多后台模式: 消息/会话/风控/状态事件并行推送到以上 ${ADMIN_URLS.length} 个后台 (各自 config.active 才推); 同账号只建一条闲鱼连接 (列表靠前的后台优先, 重复下发 10 分钟限频告警)`)
}

/* ------------- 监听开关 (v2.2.2 面板): 主服务器/账号级 启用/禁用监听 -------------
 * 场景: 同一账号登记在两个后台 (如沙盒 + 线上主服务器) 时, 连接只建一条且归「靠前」
 * 后台 — 另一台收不到消息/无法自动发货。面板按后台/按账号禁用监听后, 该后台即刻
 * 退出接收 (不再拉配置/推事件/领任务, 独有账号连接释放), 另一台立即接管。
 * 开关持久化在代理本机 JSON 文件, 重启进程后保持; 逐项立即生效 (面板操作即触发重对齐)。 */

const LISTEN_FILE = path.join(SCRIPT_DIR, 'xianyu-proxy.listen.json')
/** 只存「被禁用」项: 缺席 = 启用。backends 以后台 URL 为键 (改序/改端口不受影响), accounts 以账号 id 为键 */
const listenOverrides = { backends: {}, accounts: {} }

function loadListenOverrides() {
  try {
    const raw = JSON.parse(readFileSync(LISTEN_FILE, 'utf8'))
    if (raw && typeof raw === 'object') {
      for (const k of ['backends', 'accounts']) {
        if (raw[k] && typeof raw[k] === 'object') {
          for (const [key, v] of Object.entries(raw[k])) if (v === false) listenOverrides[k][key] = false
        }
      }
    }
    const nb = Object.keys(listenOverrides.backends).length
    const na = Object.keys(listenOverrides.accounts).length
    if (nb || na) log(`监听开关已加载: ${nb} 个主服务器 / ${na} 个账号处于「禁用监听」状态 (来源 ${path.basename(LISTEN_FILE)}, 重启进程后保持)`)
  } catch {}
}

function saveListenOverrides() {
  try {
    writeFileSync(LISTEN_FILE, JSON.stringify({ version: 1, backends: listenOverrides.backends, accounts: listenOverrides.accounts, updated_at: new Date().toISOString() }, null, 2))
  } catch (e) {
    log(`⚠ 监听开关持久化失败 (本次运行内仍生效, 重启后回退): ${e?.message}`)
  }
}

/** 后台监听是否启用 (面板禁用 = 整个后台退出接收, 与 paused/fatalDisabled 互不影响) */
function backendListenEnabled(b) {
  return listenOverrides.backends[b.url] !== false
}

/** 账号监听是否启用 (面板禁用 = 所有后台都停止监听该账号, 连接下线) */
function accountListenEnabled(id) {
  return listenOverrides.accounts[String(id || '')] !== false
}

loadListenOverrides()

/* -------------- 逐后台可达性追踪 (失败日志一眼判断: 断在哪一层 / 后台挂了多久) -------------- */

const processStartedAt = Date.now()

function fmtClock(ts) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

/** 失败日志附注: 连续失败次数 + 持续时长 + 上次成功时刻 (或从未成功), 不成功不恢复期间每次失败都带 */
function adminHealthNote(b) {
  if (b.failStreak <= 1) return ''
  const since = b.lastOkAt
    ? `上次成功 ${fmtClock(b.lastOkAt)} (${Math.round((Date.now() - b.lastOkAt) / 1000)}s 前)`
    : `启动 ${Math.round((Date.now() - processStartedAt) / 1000)}s 以来没有任何请求成功过`
  return ` — ⚠ 后台[${b.index}] ${b.host} 已连续失败 ${b.failStreak} 次 (${since})`
}

/**
 * 鉴权致命错误容错分级 (v2.2.0):
 * 单后台 — 保持旧契约: 进程退出 (修正配置后重启);
 * 多后台 — 只停推该后台 (fatalDisabled), 不拖死其它后台; 账号集合立即重新对齐
 * (该后台独有的账号下线, 其余账号连接不动)。
 */
function handleFatalError(b, err) {
  if (!MULTI_ADMIN) {
    log(`致命错误: ${err.message} — 代理退出 (修正配置后重启)`)
    process.exit(1)
  }
  if (b.fatalDisabled) return
  b.fatalDisabled = true
  b.active = false
  b.accounts = []
  log(`后台[${b.index}] ${b.host} 鉴权致命错误, 多后台模式仅停用该后台推送 (其它后台不受影响, 修正该后台令牌/引擎配置后重启进程恢复): ${err.message}`)
  reconcileAccounts()
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

// UA 版本跨进程持久化 (v2.2.4 账号保活加固, 与后台 chrome-ua.ts 同源): 缓存文件与脚本同目录。
// 部署机 Chromium 升级/容器重建导致的 UA 版本跳变 = 闲鱼视角「设备环境变化」,
// 会触发「登录环境异常 → 重新登录 + 人脸核验」; 同一账号 UA 稳定是风控底线。
const UA_CACHE_FILE = (() => {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    return path.join(dir, '.xy-ua-cache.json')
  } catch {
    return path.join(process.cwd(), '.xy-ua-cache.json')
  }
})()

function loadCachedUAVersion() {
  try {
    if (!existsSync(UA_CACHE_FILE)) return { version: '', detected: false }
    const raw = JSON.parse(readFileSync(UA_CACHE_FILE, 'utf8'))
    const v = String(raw?.version || '')
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(v)) return { version: '', detected: false }
    return { version: v, detected: raw?.source === 'detected' }
  } catch {
    return { version: '', detected: false }
  }
}

function saveCachedUAVersion(version, detected) {
  try {
    writeFileSync(UA_CACHE_FILE, JSON.stringify({ version, source: detected ? 'detected' : 'fallback', platform: process.platform, at: new Date().toISOString() }))
  } catch {}
}

function resolveChromeUA() {
  if (_uaInfo) return _uaInfo
  const p = platformParts()
  let version = ''
  let source = 'fallback'
  // 文件缓存优先: 上次探测到真实浏览器版本时直接复用 (跨重启稳定, 不随部署机 Chromium 升级漂移)
  const cached = loadCachedUAVersion()
  if (cached.detected && cached.version) {
    version = cached.version
    source = 'cached'
  } else {
    try {
      const bin = findChromiumBinary()
      if (bin) {
        const out = execFileSync(bin, ['--version'], { timeout: 5000, encoding: 'utf8' })
        const m = String(out).match(/(\d+\.\d+\.\d+\.\d+)/)
        if (m) {
          version = m[1]
          source = 'detected'
        }
      }
    } catch {}
    if (!version) {
      version = FALLBACK_UA.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '133.0.0.0'
    }
    // 探测成功或首次回退都落盘 (下次启动不再漂移)
    saveCachedUAVersion(version, source === 'detected')
  }
  const major = version.split('.')[0]
  _uaInfo = {
    ua: `Mozilla/5.0 (${p.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
    secChUa: `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not?A_Brand";v="99"`,
    secChUaPlatform: p.chPlatform,
    version,
    source,
  }
  log(`UA 真源: Chrome/${version} (${p.chPlatform}) source=${source}`)
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

/** passport 续期链专用: 过滤 Max-Age=0 / Expires 1970 删除型 Set-Cookie (参考项目同款 — 保留旧值不清掉)。 */
function filterDeletionSetCookies(setCookieList) {
  return (setCookieList || []).filter((sc) => {
    const s = String(sc || '')
    if (/max-age=0/i.test(s) || /expires=.*1970/i.test(s)) return false
    // 空值/占位值同步过滤 (与 applySetCookies 毒化防护同语义, v2.3.8): passport 链
    // 的 Set-Cookie 常含 cookie2= 空值清理指令, 放行会毒化仍在生效的登录态。
    const pair = s.split(';')[0] || ''
    const eq = pair.indexOf('=')
    if (eq <= 0) return false
    const v = pair.slice(eq + 1).trim().toLowerCase()
    return Boolean(v) && v !== 'deleted' && v !== 'null' && v !== 'undefined'
  })
}

/**
 * 登录态触摸: 调 mtop.taobao.idlemessage.pc.loginuser.get (参数级照抄参考项目
 * login_renew_task)。响应 Set-Cookie 合并返回, 调用方按 verdict 决定是否回写。
 */
async function fetchLoginUserDetailed(cookieStr) {
  const callOnce = async (useCookie) => {
    const cookies = transCookies(useCookie)
    const dataVal = '{}'
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
      api: 'mtop.taobao.idlemessage.pc.loginuser.get',
      sessionOption: 'AutoLoginOnly',
      spm_cnt: 'a21ybx.im.0.0',
      spm_pre: 'a21ybx.item.want.1.12523da6waCtUp',
      log_id: '12523da6waCtUp',
    })
    const res = await fetch(`${LOGINUSER_API}?${params.toString()}`, {
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
    return { ret, mergedCookies: merged }
  }

  const first = await callOnce(cookieStr)
  if (classifyTokenError(first.ret) === 'token_roll') {
    const rolled = Object.entries(first.mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
    const second = await callOnce(rolled)
    return { ret: second.ret, mergedCookies: { ...first.mergedCookies, ...second.mergedCookies } }
  }
  return first
}

/**
 * 长登录续期链 (参数级照抄参考项目 cookie_renew_api_service):
 *   ① hasLogin.do (web) → ② silentHasLogin.do (sdkSilent) → ③ setLoginSettings.do (status=0)
 * ③ 下发新 havana_lgc2_77 (30 天长登录), 每次调用即续期; 各接口 Set-Cookie 逐一合并
 * (删除指令过滤), 后续接口使用合并后的最新 Cookie — 与后台 ws-client.ts 同源实现。
 */
async function renewLongLoginChain(cookieStr) {
  const notes = []
  const ua = resolveChromeUA()
  let working = cookieStr
  const jar = transCookies(working)

  if (!jar['unb']) {
    return { cookieStr: working, notes: ['Cookie 缺少 unb, 跳过续期链'] }
  }

  const passportHeaders = (extra = {}) => ({
    'user-agent': ua.ua,
    'sec-ch-ua': ua.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': ua.secChUaPlatform,
    cookie: working,
    ...extra,
  })

  const applyResult = (res, label) => {
    const list = filterDeletionSetCookies(res.headers.getSetCookie?.() || [])
    if (list.length) {
      const merged = transCookies(working)
      applySetCookies(merged, list)
      working = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ')
      notes.push(`${label}:+${list.length}cookie`)
    } else {
      notes.push(`${label}:无SetCookie`)
    }
  }

  // ① hasLogin.do — web 入口登录态确认续期
  try {
    const pageTraceId = `21504${Date.now()}${Math.floor(100000 + Math.random() * 900000)}`
    const body = new URLSearchParams({
      hid: jar['unb'] || '',
      ltl: 'true',
      appName: 'xianyu',
      appEntrance: 'web',
      _csrf_token: jar['_tb_token_'] || '',
      umidToken: jar['_uab_collina'] || jar['cna'] || '',
      hsiz: jar['cookie2'] || '',
      bizParams: 'taobaoBizLoginFrom=web&renderRefer=https://www.goofish.com/',
      mainPage: 'false',
      isMobile: 'false',
      lang: 'zh_CN',
      returnUrl: '',
      fromSite: '77',
      isIframe: 'true',
      documentReferer: 'https://www.goofish.com/',
      defaultView: 'hasLogin',
      umidTag: 'SERVER',
      deviceId: '',
      pageTraceId,
    }).toString()
    const rnd = String(Math.random())
    const res = await fetch(`${PASSPORT_HAS_LOGIN_URL}?appName=xianyu&fromSite=77`, {
      method: 'POST',
      redirect: 'manual',
      headers: passportHeaders({
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN',
        'content-type': 'application/x-www-form-urlencoded',
        'bx-v': '2.5.31',
        referer: `https://passport.goofish.com/mini_login.htm?lang=zh_cn&appName=xianyu&appEntrance=web&styleType=vertical&bizParams=&notLoadSsoView=false&notKeepLogin=false&isMobile=false&qrCodeFirst=false&stie=77&rnd=${rnd}`,
        ...(jar['XSRF-TOKEN'] ? { 'x-xsrf-token': jar['XSRF-TOKEN'] } : {}),
      }),
      body,
      signal: AbortSignal.timeout(PASSPORT_TIMEOUT_MS),
    })
    applyResult(res, 'hasLogin')
  } catch (e) {
    notes.push(`hasLogin:${String(e?.message || e).slice(0, 80)}`)
  }

  // ② silentHasLogin.do — 静默续短登录
  try {
    const params = new URLSearchParams({
      documentReferer: 'https://www.goofish.com/',
      appName: 'xianyu',
      appEntrance: 'xianyu_sdkSilent',
      fromSite: '0',
      ltl: 'true',
    }).toString()
    const res = await fetch(`${PASSPORT_SILENT_HAS_LOGIN_URL}?${params}`, {
      method: 'POST',
      redirect: 'manual',
      headers: passportHeaders({
        accept: '*/*',
        'accept-language': 'en,zh-CN;q=0.9,zh;q=0.8',
        Referer: 'https://www.goofish.com/',
      }),
      signal: AbortSignal.timeout(PASSPORT_TIMEOUT_MS),
    })
    applyResult(res, 'silentHasLogin')
  } catch (e) {
    notes.push(`silentHasLogin:${String(e?.message || e).slice(0, 80)}`)
  }

  // ③ setLoginSettings.do (status=0) — 下发新 havana_lgc2_77 (30 天长登录)
  try {
    const res = await fetch(`${PASSPORT_SET_LOGIN_SETTINGS_URL}?fromSite=77&appName=xianyu&bizEntrance=web`, {
      method: 'POST',
      redirect: 'manual',
      headers: passportHeaders({
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'content-type': 'application/x-www-form-urlencoded',
        referer: 'https://www.goofish.com/',
      }),
      body: 'status=0',
      signal: AbortSignal.timeout(PASSPORT_TIMEOUT_MS),
    })
    applyResult(res, 'setLoginSettings')
  } catch (e) {
    notes.push(`setLoginSettings:${String(e?.message || e).slice(0, 80)}`)
  }

  return { cookieStr: working, notes }
}

/* ------------- 单账号长连接客户端 (与后台 ws-client.ts 同源, 去人工验证依赖) ------------- */

const RISK_LADDER_SECONDS = [300, 600, 1200, 1800]
const RISK_LADDER_WINDOW_MS = 30 * 60 * 1000
// token TTL 上界 (仅用于重连时判断是否需要刷新, 常规滚动由 3min 任务完成)
const TOKEN_REFRESH_MS = 3600 * 1000
//
// ── 凭证保活三层模型 (v2.3.11 统一执行器, 与后台 ws-client.ts 同源) ──
// 闲鱼登录态由三层独立凭证构成, 缺一层就在该层寿命到期时死:
//   ① _m_h5_tk 签名令牌 (小时级) — token API 调用即滚动, Set-Cookie 回写;
//   ② cookie2/skt 短登录会话 (~24h 滑动过期) — 只有被 web 侧接口触摸才续期;
//   ③ havana_lgc2_77 长登录 (30 天) — passport 三接口链续期 (短会话死亡后无感拉活)。
// v2.3.11 执行层根因: 旧实现「收到下游消息后 5 分钟冷却」的守卫写在
// lastDownstreamAt (含 15s 心跳回包的任意下行帧) 上 → 连接健康期间续期链
// 全部永久短路 → 短会话 ~24h 必死。消息冷却彻底删除 (消息走 WS 帧, cookie
// 轮换走 HTTPS, 互不干扰), 30min 主站 GET 删除 (v2.3.6 实证续不了登录态),
// 三任务统一串行执行器, 守卫只在执行器一处。
// 请求量: 每账号每日 480(token)+144(触摸)+72(passport) ≈ 696 次。
// ① token 滚动周期 3 分钟 ±10% (参考项目 cookie_refresh_interval=180s)
const TOKEN_ROLL_MS = 180 * 1000

/**
 * 登录态触摸周期 (v2.3.6 根治「每天 SESSION_EXPIRED」): 10 分钟 — 与后台 ws-client.ts
 * 同源。cookie2/skt 短登录会话只有被 web 侧接口触摸才会滑动续期 (参考项目
 * login_renew_task 默认 600s); token API 只滚 _m_h5_tk、主站 GET 续不了登录态本身,
 * 短登录态 ~24h 自然死亡 → 每天重扫码 (叠加风控触发人脸核验)。
 */
const SESSION_TOUCH_MS = 600 * 1000
/** loginuser.get (登录态触摸接口)。 */
const LOGINUSER_API = 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.pc.loginuser.get/1.0/'
/** 长登录续期周期 (v2.3.6): 1 小时 — passport 三接口链续 30 天长登录 havana_lgc2_77。 */
const LONG_LOGIN_RENEW_MS = 3600 * 1000
const PASSPORT_HAS_LOGIN_URL = 'https://passport.goofish.com/newlogin/hasLogin.do'
const PASSPORT_SILENT_HAS_LOGIN_URL = 'https://passport.goofish.com/newlogin/silentHasLogin.do'
const PASSPORT_SET_LOGIN_SETTINGS_URL = 'https://passport.goofish.com/ac/account/setLoginSettings.do'
const PASSPORT_TIMEOUT_MS = 20_000
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
    else {
      // 空值/占位值不覆盖 (毒化防护, v2.3.8, 与后台 ws-client.ts 同源): 服务端对
      // 失效/异常会话常下发空值清理指令 (如 cookie2=、xxx=deleted), 照单全收会把
      // 仍在生效的登录态核心 cookie 写成空值并经轮换链上报持久化入库 → 账号永久
      // SESSION_EXPIRED、重启也无法恢复监听。一律保留旧值, 真正的删除语义只由
      // expired 分支 (Max-Age=0/Expires 已过) 负责。
      const lv = value.toLowerCase()
      if (!value || lv === 'deleted' || lv === 'null' || lv === 'undefined') continue
      record[name] = value
    }
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
    this.sessionTouchTimer = null
    this.longLoginTimer = null
    // 统一保活执行器: 串行队列 (同名去重, 含执行中任务) + 单 drain (v2.3.11)
    this.keepAliveQueue = []
    this.keepAliveDraining = false
    this.keepAliveActive = null
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
    // ① token 滚动 (3min): _m_h5_tk/WS token 保活 + cookie 轮换上报 (无消息冷却)
    this.tokenTimer = setInterval(() => {
      if (!this.stopped) void this.submitKeepAlive('token')
    }, jitter(TOKEN_ROLL_MS, 0.1))
    // ② 登录态触摸 (10min): loginuser.get 续 cookie2/skt 短登录会话 (无消息冷却)
    this.sessionTouchTimer = setInterval(() => {
      if (!this.stopped) void this.submitKeepAlive('touch')
    }, jitter(SESSION_TOUCH_MS, 0.1))
    // ③ 长登录续期 (1h): passport 三接口链续 havana_lgc2_77 (30 天长登录)
    this.longLoginTimer = setInterval(() => {
      if (!this.stopped) void this.submitKeepAlive('passport')
    }, jitter(LONG_LOGIN_RENEW_MS, 0.15))
  }

  /* ---------------- 统一保活执行器 (v2.3.11, 与后台 ws-client.ts 同源) ---------------- */

  /**
   * 提交保活任务 (串行, 同名去重 — 含执行中任务): 同一账号同一时刻最多一个
   * 出站保活请求, 执行中的同名提交跟随其完成 (不重复实调)。守卫统一在 drain。
   */
  submitKeepAlive(task) {
    if (this.keepAliveActive?.task === task) return this.keepAliveActive.done
    return new Promise((resolve) => {
      const queued = this.keepAliveQueue.find((q) => q.task === task)
      if (queued) {
        const prev = queued.resolve
        queued.resolve = () => {
          prev()
          resolve()
        }
      } else {
        this.keepAliveQueue.push({ task, resolve })
      }
      void this.drainKeepAlive()
    })
  }

  async drainKeepAlive() {
    if (this.keepAliveDraining) return
    this.keepAliveDraining = true
    try {
      while (this.keepAliveQueue.length > 0) {
        const { task, resolve } = this.keepAliveQueue.shift()
        let done
        const doneP = new Promise((r) => (done = r))
        this.keepAliveActive = { task, done: doneP }
        try {
          // 守卫唯一收口: 停止 / 风控冷却期 (零请求, 静默是让风控衰减的唯一方式)
          if (!this.stopped && Date.now() >= this.riskCooldownUntil) {
            if (task === 'token') await this.refreshTokenSafely()
            else if (task === 'touch') await this.sessionTouch()
            else await this.renewLongLogin()
          }
        } catch {
          // 任务体已自兜底, 此处防调度器死亡
        }
        done()
        this.keepAliveActive = null
        resolve()
      }
    } finally {
      this.keepAliveDraining = false
    }
  }

  /**
   * ② 登录态触摸任务 (v2.3.6 引入, v2.3.11 去守卫/去判死): loginuser.get 续
   * cookie2/skt 短登录会话 (10min 周期, 参数级照抄参考项目 login_renew_task)。
   * Set-Cookie 照旧经 sink.onCookieRotated 上报后台落库; verdict 仅供观测 —
   * auth 不据此判死, 账号生死由 token 链 (3min 周期) 唯一判定 (端点特异性
   * 误报会吓迫用户重扫码)。守卫统一在执行器。
   */
  async sessionTouch() {
    try {
      const { ret, mergedCookies } = await fetchLoginUserDetailed(this.cookieStr)
      const verdict = classifyTokenError(ret)
      // 登录失效 (auth) 响应的 Set-Cookie 不回写 (清理指令/空值, 合并只会毒化会话)
      if (verdict !== 'auth') {
        const mergedStr = Object.entries(mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
        if (mergedStr !== this.cookieStr) {
          this.cookieStr = mergedStr
          this.sink.onCookieRotated(this.cookieId, mergedStr)
        }
      }
      if (verdict === 'ok') return
      if (verdict === 'risk') {
        log(`账号 ${this.cookieId} 登录态触摸被风控拦截 (仅跳过本次触摸, 不影响监听链路): ${ret.join('; ')}`)
        return
      }
      log(`账号 ${this.cookieId} 登录态触摸未成功 (以 token 链判定为准, 不据此判死): ${ret.join('; ') || '空响应'}`)
    } catch (e) {
      log(`账号 ${this.cookieId} 登录态触摸异常: ${e?.message}`)
    }
  }

  /**
   * ③ 长登录续期任务 (v2.3.6 引入, v2.3.11 去守卫): passport 三接口链续 30 天
   * 长登录 (havana_lgc2_77), need_relogin 状态下照常执行 — 长登录 token 是
   * 会话死亡后无感拉活的通道; 拉活后 token 链下次成功刷新会自动带回 connecting。
   */
  async renewLongLogin() {
    try {
      const { cookieStr: mergedStr, notes } = await renewLongLoginChain(this.cookieStr)
      if (mergedStr !== this.cookieStr) {
        this.cookieStr = mergedStr
        this.sink.onCookieRotated(this.cookieId, mergedStr)
      }
      log(`账号 ${this.cookieId} 长登录续期: ${notes.join('; ')}`)
    } catch (e) {
      log(`账号 ${this.cookieId} 长登录续期异常: ${e?.message}`)
    }
  }

  async stop() {
    this.stopped = true
    for (const t of [this.tokenTimer, this.heartbeatTimer, this.sessionTouchTimer, this.longLoginTimer]) {
      if (t) clearTimeout(t)
      if (t) clearInterval(t)
    }
    this.tokenTimer = this.heartbeatTimer = null
    this.sessionTouchTimer = this.longLoginTimer = null
    // 排空执行器队列 (resolve 挂起的等待者)
    for (const q of this.keepAliveQueue.splice(0)) q.resolve()
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

    // token 缺失或接近 TTL 上界先刷新 (经执行器串行, 与保活任务零竞态)
    if (!this.token || Date.now() - this.lastTokenRefresh > TOKEN_REFRESH_MS) {
      await this.submitKeepAlive('token')
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

  /**
   * ① token 滚动任务 (守卫统一在执行器): 全账号唯一的两个状态裁决点 —
   * risk → tripRisk 冷却阶梯; auth → need_relogin (唯一判死点, 状态已标记时
   * 绝不重复上报)。Set-Cookie 经 sink.onCookieRotated 上报后台落库。
   */
  async refreshTokenSafely() {
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
        // 全账号唯一判死点 (v2.3.11): 状态已标记时绝不重复 setState — 否则会话
        // 死亡期间每 3 分钟重发一次「登录态失效」状态上报。
        if (this.state !== 'need_relogin') this.setState('need_relogin', ret.join('; ') || '登录态失效, 请重新扫码')
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

/* ------------- 代理主循环: 配置轮询 / 账号对齐 / 事件上报 / 动作回收 -------------
 * (v2.2.0 多后台: engineActive 由各后台 b.active 取代, 失败计数移入各后台登记表) */

const clients = new Map()
const latestCookies = new Map()
let pollSeconds = DEFAULT_POLL_SECONDS
let heartbeatSeconds = 15
let stopped = false

// 上报队列: 状态变化/事件即时入队, 合并窗口批量 POST (后台限速 120/min)
const reportQueue = []
const accountStates = new Map()
let flushTimer = null
let lastFlushAt = 0

/** 请求标签: "POST engine/events @ 后台host:port" — 带上请求目标主机与端口,
 * 多后台同主机不同端口时指错后台一眼可见。 */
function apiLabel(url) {
  try {
    const u = new URL(url)
    const path = u.pathname.split('/').filter(Boolean).slice(-2).join('/')
    return `${path} @ ${u.host}`
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

async function apiCall(b, url, body, timeoutMs = 30_000) {
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
    b.failStreak += 1
    throw Object.assign(new Error(describeApiError(e, label, startedAt, timeoutMs)), { label, network: true })
  }
  const elapsed = Date.now() - startedAt
  // 收到任何 HTTP 响应 (含 429/401/5xx) 都证明网络通、后台进程活着, 连败计数清零
  if (b.failStreak > 0) {
    log(`后台[${b.index}] ${b.host} 已恢复: 连续失败 ${b.failStreak} 次后重新收到响应 (${label}, HTTP ${res.status}, 耗时 ${elapsed}ms)`)
  }
  b.failStreak = 0
  b.lastOkAt = Date.now()
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') || 5) || 5
    throw Object.assign(new Error(`${label}: 后台[${b.index}] 限速 429, ${retryAfter}s 后重试`), { rateLimited: retryAfter, label })
  }
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error(`${label}: 后台[${b.index}] ${b.host} 鉴权失败 (${res.status}): 令牌无效/引擎被停用, 请核对该后台的 XY_ENGINE_TOKEN`), { fatal: true, label })
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw Object.assign(
      new Error(`${label}: 后台[${b.index}] 响应异常 HTTP ${res.status} (${elapsed}ms)${errText ? ` — ${errText.slice(0, 160)}` : ''}`),
      { label },
    )
  }
  const json = await res.json().catch(() => ({}))
  return json?.data ?? json ?? {}
}

/**
 * 事件入队 (v2.2.0 带路由): target = -1 广播 (同步包/风控/状态 → 全部活跃后台);
 * >=0 定向 (action_result/task_result → 只回决策/任务所属后台, 其它后台绝不错收)。
 */
function enqueueReport(entry, target = -1) {
  if (stopped) return
  reportQueue.push({ ev: entry, target })
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

/** 当前可推送的后台: 活跃 + 未暂停 + 未停用 + 面板监听启用 + 不在限速冷却期 */
function pushableBackends() {
  const now = Date.now()
  return backends.filter((b) => b.active && !b.paused && !b.fatalDisabled && backendListenEnabled(b) && now >= b.rateLimitedUntil)
}

/** 指定后台的事件回队 (保持原有顺序, 只回该后台 — 其它后台已成功绝不错收重报) */
function requeueFor(target, events) {
  if (!events.length) return
  reportQueue.unshift(...events.map((ev) => ({ ev, target })))
  if (reportQueue.length > 500) reportQueue.splice(0, reportQueue.length - 500)
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
  // 事件批次画像: 条数 / 类型分布 / 首尾 event_id, 失败日志一眼可定位是哪批什么事件
  const typeCount = {}
  for (const { ev } of batch) typeCount[String(ev?.type || '?')] = (typeCount[String(ev?.type || '?')] || 0) + 1
  const eventSummary = `${batch.length}条 [${Object.entries(typeCount).map(([t, n]) => `${t}×${n}`).join(' ')}]`

  // ---- 按后台分发 (v2.2.0): 广播事件进每个可推后台; 定向事件只进所属后台。
  // 所属后台已暂停/停用 → 定向事件丢弃 (该后台不再收货, 决策方自有超时重报兜底);
  // 仅在限速冷却中 → 定向事件暂存回队绝不丢弃 (它是唯一副本), 冷却结束自动重试。
  const perBackend = new Map()
  const deferred = []
  let droppedTargeted = 0
  for (const entry of batch) {
    const targets = entry.target === -1 ? pushableBackends().map((b) => b.index) : [entry.target]
    for (const idx of targets) {
      const b = backends[idx]
      if (!b || !b.active || b.paused || b.fatalDisabled || !backendListenEnabled(b)) {
        if (entry.target >= 0) droppedTargeted += 1
        continue
      }
      if (Date.now() < b.rateLimitedUntil) {
        if (entry.target >= 0) deferred.push({ ev: entry.ev, target: idx })
        continue
      }
      if (!perBackend.has(idx)) perBackend.set(idx, [])
      perBackend.get(idx).push(entry.ev)
    }
  }
  if (droppedTargeted) log(`定向回执丢弃 ${droppedTargeted} 条 (所属后台已暂停/停用, 恢复后由决策方超时重报自愈)`)
  if (deferred.length) reportQueue.push(...deferred)

  const status = {
    accounts: [...accountStates.entries()].map(([id, s]) => ({ id, state: s.state, detail: s.detail || '' })),
  }

  // ---- 并行推送 (Promise.allSettled): 一个后台死/慢绝不拖累其它后台
  const jobs = [...perBackend.entries()].map(([idx, events]) => ({ b: backends[idx], events }))
  const results = await Promise.allSettled(
    jobs.map(async ({ b, events }) => {
      // 30s 超时 + 失败换新连接重试一次 (与配置轮询同款链路加固, 高丢包链路实测半数请求超时);
      // 快速 ACK 模式下后台秒回, 决策 (AI 可达 20~30s) 由 pullActions 异步回收; 重报因
      // event_id 去重安全 (服务端原样重放不重算)。旧版后台无拉取协议时同步返回动作, 同样兼容
      const resp = await apiCallWithRetry(b, b.eventsUrl, { status, events }, 30_000)
      return { b, resp, events }
    }),
  )

  let anyRequeue = false
  for (let i = 0; i < jobs.length; i++) {
    const r = results[i]
    const { b, events } = jobs[i]
    if (r.status === 'fulfilled') {
      const { resp } = r.value
      b.pushFailStreak = 0
      if (b.paused) {
        b.paused = false
        log(`后台[${b.index}] ${b.host} 推送已恢复 (本次上报成功)`)
      }
      const actions = Array.isArray(resp?.actions) ? resp.actions : []
      await executeActions(actions, b)
      const pullIds = Array.isArray(resp?.pending) ? resp.pending.map(String) : []
      if (pullIds.length) await pullActions(b, pullIds, events)
    } else {
      const e = r.reason
      if (e?.fatal) {
        // 容错分级: 单后台旧契约退出; 多后台只停推该后台 (其事件一并丢弃, 不拖死其它后台)
        handleFatalError(b, e)
        continue
      }
      b.pushFailStreak += 1
      if (e?.rateLimited) {
        b.rateLimitedUntil = Date.now() + Math.min(e.rateLimited, 30) * 1000
        requeueFor(b.index, events)
        log(`上报限速: 后台[${b.index}] ${b.host} 批次 ${eventSummary} (仅回队该后台, 队列 ${reportQueue.length} 条) — ${e.message}`)
      } else if (b.pushFailStreak >= 5) {
        // 连续 5 次失败自动暂停该后台推送 (事件丢弃): 防一个死后台堵死队列拖累其它后台;
        // 该后台配置轮询成功后自动恢复
        b.paused = true
        log(`后台[${b.index}] ${b.host} 连续 ${b.pushFailStreak} 次推送失败, 自动暂停推送 (积压事件丢弃防堵队列; 配置轮询成功自动恢复) — ${e?.message}${adminHealthNote(b)}`)
      } else {
        b.rateLimitedUntil = Date.now() + 3000
        requeueFor(b.index, events)
        log(`上报失败: 后台[${b.index}] ${b.host} 批次 ${eventSummary} (第 ${b.pushFailStreak}/5 次连续失败, 仅回队该后台) — ${e?.message}${adminHealthNote(b)}`)
      }
      anyRequeue = true
    }
  }
  if (anyRequeue) scheduleFlush(500)
  else if (deferred.length) {
    // 本轮只暂存了限速后台的定向事件: 定时到最早冷却结束后重试 (不空转)
    const earliest = Math.min(...deferred.map(({ target }) => backends[target].rateLimitedUntil))
    scheduleFlush(Math.max(600, earliest - Date.now() + 200))
  }
}

/** 决策结果按后台回收 (v2.2.0): 后台大脑 (AI/发货链) 完成前, 按 event_id 每 2.5s 轮询
 * 该后台拉取, 动作随拉取响应返回后照常人化执行 (按 a{后台}:log_id 去重, 重放绝不重发);
 * 占位超时被该后台判失效 (expired) → 事件只回队该后台重新上报自愈。 */
async function pullActions(b, ids, originEvents) {
  let remaining = ids.slice()
  for (let attempt = 0; attempt < 72 && remaining.length && !stopped; attempt++) {
    await sleep(attempt === 0 ? 1200 : 2500)
    let resp
    try {
      resp = await apiCallWithRetry(b, b.eventsUrl, { pull: remaining }, 30_000)
    } catch (e) {
      if (e?.fatal) {
        handleFatalError(b, e)
        return
      }
      continue // 网络抖动继续拉, 拉取上限兜底
    }
    const actions = Array.isArray(resp?.actions) ? resp.actions : []
    if (actions.length) await executeActions(actions, b)
    const expired = Array.isArray(resp?.expired) ? resp.expired.map(String) : []
    if (expired.length) {
      log(`后台[${b.index}] ${b.host} 决策超时失效 ${expired.length} 个事件, 只回队该后台重新上报`)
      requeueFor(b.index, originEvents)
      scheduleFlush(500)
    }
    remaining = Array.isArray(resp?.pending) ? resp.pending.map(String) : []
  }
  if (remaining.length) {
    log(`后台[${b.index}] ${b.host} ${remaining.length} 个事件决策未完成, 只回队该后台重新上报`)
    requeueFor(b.index, originEvents)
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

async function executeActions(actions, b) {
  const logCounter = new Map()
  for (const action of actions) {
    const client = clients.get(String(action.account || ''))
    if (!client) {
      log(`动作丢弃: 账号 ${action.account} 不由本代理托管 (来自后台[${b.index}] ${b.host})`)
      continue
    }
    const logId = Number(action.log_id || 0)
    let actionKey = ''
    if (logId > 0) {
      const seq = logCounter.get(logId) || 0
      logCounter.set(logId, seq + 1)
      // v2.2.0: 去重 key 加 a{后台}: 前缀 — log_id/task_id 各后台独立编号,
      // 防止后台 A 的 log_id 撞上后台 B 同号日志被误判「已执行过」而漏发
      actionKey = `a${b.index}:${logId}#${seq}`
      const done = executedActions.get(actionKey)
      if (done) {
        // 同一动作的重放 (上轮响应丢失后的重试): 不重发, 仅补报执行结果 (只回决策所属后台)
        if (done.ok) log(`动作已执行过, 跳过重发 (后台[${b.index}] log ${logId})`)
        enqueueReport({ type: 'action_result', account: String(action.account || ''), log_id: logId, ok: done.ok, error: done.error || '', backend: b.index }, b.index)
        continue
      }
    }
    let ok = true
    let err = ''
    try {
      const delay = Math.max(0, Math.round(Number(action.delay_ms || 0)))
      if (action.type === 'send_text') {
        await client.sendText(String(action.chat_id), String(action.to_user_id), String(action.text || ''), delay)
        log(`已发送文本 → 账号 ${action.account} 会话 ${action.chat_id} (后台[${b.index}] 决策)`)
      } else if (action.type === 'send_image') {
        await client.sendImage(
          String(action.chat_id),
          String(action.to_user_id),
          String(action.image_url || ''),
          Number(action.width || 800),
          Number(action.height || 600),
          delay,
        )
        log(`已发送图片 → 账号 ${action.account} 会话 ${action.chat_id} (后台[${b.index}] 决策)`)
      }
    } catch (e) {
      ok = false
      err = String(e?.message || '').slice(0, 300)
      log(`动作执行失败 (${action.type} → ${action.account}, 后台[${b.index}] 决策): ${err}`)
    }
    if (logId > 0) {
      executedActions.set(actionKey, { ok, error: err, at: Date.now() })
      pruneExecutedActions()
      enqueueReport({ type: 'action_result', account: String(action.account || ''), log_id: logId, ok, error: err, backend: b.index }, b.index)
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
    // 会话轮换必须回报后台: 代理是唯一持有活跃会话的一方, 后台发货/拉单用的库内 Cookie
    // 不跟随轮换就会带着过期 _m_h5_tk 请求平台 (发货必被判订单状态不正确/登录失效)。
    // 后台按 key 合并入库 (mergeReportedCookies), 重复上报无副作用; 多后台广播 (target=-1)。
    enqueueReport({ type: 'cookie', account: cookieId, cookies: mergedStr })
  },
}

function accountEntryFromConfig(a) {
  return { id: String(a.id), cookies: String(a.cookies || ''), device_id: String(a.device_id || '') }
}

/** 创建账号客户端 (owner = 拥有该账号的后台下标, XY_ADMIN_URL 靠前者优先) */
function createClient(account, owner = 0) {
  if (clients.has(account.id)) return
  try {
    const cookieStr = latestCookies.get(account.id) || account.cookies
    const client = new XianyuAccountClient({ ...account, cookies: cookieStr }, sink)
    client.ownerBackend = owner
    clients.set(account.id, client)
    latestCookies.set(account.id, cookieStr)
    client.start()
    log(`账号 ${account.id} 客户端已启动 (归属后台[${owner}])`)
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
async function apiCallWithRetry(b, url, body, timeoutMs = 30_000) {
  try {
    return await apiCall(b, url, body, timeoutMs)
  } catch (e) {
    if (e?.fatal || e?.rateLimited) throw e
    // 重试等待期间并行做 DNS/TCP 分层诊断, 探测结果随失败日志输出 (不拖慢重试节奏)
    const [diag] = await Promise.all([
      e?.network ? probeReachability(url) : Promise.resolve(''),
      sleep(3000),
    ])
    log(`后台[${b.index}] 请求失败 (第 1 次尝试): ${e?.message}${diag ? ` ${diag}` : ''}${adminHealthNote(b)} — 现在换新连接重试`)
    try {
      return await apiCall(b, url, body, timeoutMs)
    } catch (e2) {
      log(`后台[${b.index}] 请求失败 (第 2 次尝试): ${e2?.message}${adminHealthNote(b)} — 放弃本轮`)
      throw e2
    }
  }
}

async function fetchConfigWithRetry(b) {
  return apiCallWithRetry(b, b.configUrl)
}

/** 单后台配置轮询: 各后台独立的活跃态/账号/推送健康 (一个后台挂了不影响其它后台轮询) */
async function pollBackendConfig(b) {
  if (b.fatalDisabled) return
  try {
    const cfg = await fetchConfigWithRetry(b)
    b.configFailStreak = 0
    b.lastConfigOkAt = Date.now()
    b.lastConfig = cfg
    const wasActive = b.active
    b.active = !!cfg.active
    if (b.active) {
      b.accounts = Array.isArray(cfg.accounts) ? cfg.accounts : []
      if (!wasActive) {
        log(`后台[${b.index}] ${b.host} 已激活: 下发 ${b.accounts.length} 个账号` + (b.everActive ? '' : ' (首次)'))
        b.everActive = true
      }
      // 推送暂停的后台: 配置轮询成功即自动恢复 (v2.2.0 容错约定)
      if (b.paused) {
        b.paused = false
        b.pushFailStreak = 0
        log(`后台[${b.index}] ${b.host} 推送已恢复 (配置轮询成功)`)
      }
    } else {
      if (wasActive) log(`后台[${b.index}] ${b.host} 非使用中 (备用状态, 多引擎互斥): 其 ${b.accounts.length} 个账号不再由本代理托管`)
      b.accounts = []
    }
    recomputeIntervals()
    b.pollOkCount += 1
    if (b.pollOkCount % 10 === 1) {
      log(`配置轮询正常: 后台[${b.index}] ${b.host} active=${b.active}, 下发账号 ${b.accounts.length}, 本地连接 ${clients.size}` + (b.pollOkCount === 1 ? '' : ` (连续成功 ${b.pollOkCount}; 成功默认静默, 每 10 次打印一次)`))
    }
  } catch (e) {
    if (e?.fatal) {
      handleFatalError(b, e)
      return
    }
    if (e?.rateLimited) {
      log(`配置拉取失败: 后台[${b.index}] ${b.host} — ${e.message}`)
      return
    }
    b.configFailStreak += 1
    log(`配置拉取失败: 后台[${b.index}] ${b.host} (连续第 ${b.configFailStreak} 次) — ${e?.message} — 下轮重试`)
    // 连续失败自动网络自检(第 2 次触发, 此后每 10 次复查): 定位 DNS/TCP/SNI 过滤/整机断路 (逐后台执行)
    if (b.configFailStreak === 2 || b.configFailStreak % 10 === 0) await diagnoseNetwork(b)
  }
}

/** 轮询间隔取全部活跃后台下发的最小值 (最保守的刷新频率) */
function recomputeIntervals() {
  let poll = DEFAULT_POLL_SECONDS
  let hb = 15
  for (const b of backends) {
    if (!b.active) continue
    const iv = b.lastConfig?.intervals || {}
    if (iv.poll_seconds) poll = Math.min(poll, Math.max(10, Math.round(Number(iv.poll_seconds) || DEFAULT_POLL_SECONDS)))
    if (iv.heartbeat_seconds) hb = Math.min(hb, Math.min(60, Math.max(5, Math.round(Number(iv.heartbeat_seconds) || 15))))
  }
  pollSeconds = poll
  heartbeatSeconds = hb
}

let lastDupWarnAt = 0

/**
 * 账号集合对齐 (v2.2.0): 并集 = 全部活跃后台下发的账号。
 * 同账号被多个后台下发时只建一条闲鱼连接 (XY_ADMIN_URL 靠前的后台优先 = owner) —
 * 两个后台对同一账号并行决策会给买家发两份消息, 连接层必须唯一; 重复下发 10 分钟
 * 限频告警。Cookie 热替换只认 owner 后台下发的值 (防两个后台的会话互相打摆)。
 */
function reconcileAccounts() {
  // 授权失联释放 (v2.3.2 双连接根治 · 代理侧): 连接的所有者后台 config 连续 90s 拉不到
  // = 授权不可续 — 立即释放该后台名下全部账号连接 (后台侧心跳陈旧后会接管, 双连接 =
  // 风控「重新登录 + 人脸核验」; 先释放才能让接管方安全建连)。后台恢复后账号自动重连。
  for (const [id, client] of [...clients]) {
    const ob = backends[client.ownerBackend]
    if (ob && ob.lastConfigOkAt && Date.now() - ob.lastConfigOkAt > OWNERSHIP_RELEASE_MS) {
      log(`⚠ 账号 ${id} 的后台[${ob.index}] ${ob.host} 配置授权已失联超 90s, 释放连接 (防双连接风控); 后台恢复下发后自动重连`)
      void stopClient(id)
    }
  }
  // 面板禁用监听的后台不参与账号对齐 (即使 active 尚未轮到重置也绝不创建/保留其连接)
  const actives = backends.filter((b) => b.active && backendListenEnabled(b))
  if (!actives.length) {
    if (clients.size) {
      log('全部后台均非使用中 (备用状态), 全部账号下线 (多引擎互斥)')
      for (const id of [...clients.keys()]) void stopClient(id)
    }
    return
  }
  const wanted = new Map() // id -> { account, owner }
  const owners = new Map() // id -> [后台下标...]
  for (const b of actives) {
    for (const a of b.accounts) {
      const id = a && a.id !== undefined && a.id !== null ? String(a.id) : ''
      if (!id) continue
      // 面板禁用监听的账号: 所有后台都不再托管 (连接下线/不创建), 直到重新启用
      if (!accountListenEnabled(id)) continue
      const entry = wanted.get(id)
      if (!entry) {
        wanted.set(id, { account: accountEntryFromConfig(a), owner: b.index })
        owners.set(id, [b.index])
      } else {
        if (b.index < entry.owner) {
          entry.owner = b.index
          entry.account = accountEntryFromConfig(a)
        }
        owners.get(id).push(b.index)
      }
    }
  }
  // 同账号多后台重复下发: 10 分钟限频告警 (连接唯一, 但决策会重复 — 必须让用户看见)
  const dups = [...owners.entries()].filter(([, list]) => list.length > 1)
  if (dups.length && Date.now() - lastDupWarnAt > 10 * 60_000) {
    lastDupWarnAt = Date.now()
    log(`⚠ ${dups.length} 个账号被多个后台同时下发: ${dups.slice(0, 5).map(([id, list]) => `${id}(后台${list.join('/')})`).join(', ')} — 连接只建一条 (靠前后台优先), 但各后台独立决策会给买家发重复消息, 请确认确属预期配置`)
  }
  // 下线: 不再被任何活跃后台下发的账号
  for (const [id] of [...clients.keys()]) {
    if (!wanted.has(id)) void stopClient(id)
  }
  // 创建/更新: cookie 以后台下发的为准, 仅 owner 后台的变更热替换 (下轮重连生效)
  for (const [id, { account, owner }] of wanted) {
    const client = clients.get(id)
    if (client) {
      const effective = latestCookies.get(id) || ''
      if (account.cookies && account.cookies !== effective && client.ownerBackend === owner) {
        client.setCookieStr(account.cookies)
        latestCookies.set(id, account.cookies)
        log(`账号 ${id} Cookie 已按后台[${owner}] 下发更新热替换`)
      }
      continue
    }
    createClient(account, owner)
  }
}

/** 一轮配置轮询: 全部未停用且面板监听启用的后台并行拉取 (Promise.allSettled), 完成后统一对齐账号集合 */
async function pollConfigOnce() {
  // 面板禁用监听的后台: 立即退出活跃态并清空账号 (连接由 reconcile 释放), 且不再拉取
  for (const b of backends) {
    if (!backendListenEnabled(b) && (b.active || b.accounts.length)) {
      b.active = false
      b.accounts = []
      log(`后台[${b.index}] ${b.host} 监听已被面板禁用: 本后台不再拉取配置/推送事件/领任务, 其账号已释放`)
    }
  }
  const targets = backends.filter((b) => !b.fatalDisabled && backendListenEnabled(b))
  await Promise.allSettled(targets.map((b) => pollBackendConfig(b)))
  reconcileAccounts()
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

/** 网络自检逐后台执行 (v2.2.0): 定位哪个后台断在哪一层 */
async function diagnoseNetwork(b) {
  if (diagRunning) return
  diagRunning = true
  try {
    const u = new URL(b.url)
    const host = u.hostname
    const port = Number(u.port) || 443
    log(`网络自检: 后台[${b.index}] ${b.host} 拉取连续失败, 自动定位断点 (DNS → TCP → Cloudflare 对照 → 后台域名)...`)
    const [ips, tcpMs, cfOk, targetOk] = await Promise.all([
      dns.promises.lookup(host, { all: true }).catch(() => []),
      tcpConnectMs(host, port),
      fetchTraceOk('https://www.cloudflare.com/cdn-cgi/trace'),
      fetchTraceOk(`${b.url}/cdn-cgi/trace`),
    ])
    const ipText = (Array.isArray(ips) && ips.length ? ips : []).map((r) => `${r.address}(v${r.family})`).join(' ') || '解析失败'
    log(`网络自检结果 (后台[${b.index}]): DNS=${ipText}; TCP443=${tcpMs ? tcpMs + 'ms' : '不通'}; Cloudflare对照站=${cfOk ? '通' : '不通'}; 后台域名=${targetOk ? '通' : '不通'}`)
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

async function configLoop(token) {
  while (!stopped && engineOn && token === loopToken) {
    try {
      await pollConfigOnce()
    } catch (e) {
      log(`配置轮询异常: ${e?.message}`)
    }
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

/**
 * 领取并执行一轮任务 (v2.2.0 逐后台): 任务 id 各后台独立编号 — 哪家后台下发的任务,
 * 领取与结果回报都只对哪家 (绝不串号); 无任务静默返回; 单任务异常不影响后续任务与轮询循环。
 */
async function pollTasksOnce(b) {
  if (!b.active || b.paused || b.fatalDisabled || !backendListenEnabled(b) || Date.now() < b.rateLimitedUntil) return
  let resp
  try {
    resp = await apiCallWithRetry(b, b.tasksUrl, undefined, 15_000)
  } catch (e) {
    if (e?.fatal) {
      handleFatalError(b, e)
      return
    }
    log(`任务领取失败: 后台[${b.index}] ${b.host} — ${e?.message} — 下轮重试 (已领取任务不受影响, 任务过期由后台守护)`)
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
      // v2.2.6 定稿: 仅 http_fetch (纯透传, 全量订单同步亦走此通道) / send_message 两类任务 —
      // fetch_orders_full 代理本地解析任务已废弃 (解析主权 100% 收归后台, 与 http_fetch 合并)
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
        await apiCall(b, b.eventsUrl, {
          events: [{ type: 'task_result', task_id: taskId, ok: !!result.ok, data: result.data || {}, backend: b.index }],
        }, 15_000)
        reported = true
      } catch (e) {
        lastErr = e?.message
        if (e?.fatal) {
          handleFatalError(b, e)
          return
        }
        if (attempt < 3) {
          log(`任务 #${taskId} (${task?.type}, 后台[${b.index}]) 结果回报失败 (第 ${attempt}/3 次): ${lastErr} — 2s 后重试`)
          await sleep(2000)
        }
      }
    }
    if (!reported) {
      log(`任务 #${taskId} (${task?.type}, 后台[${b.index}]) 结果回报彻底失败 (3 次均失败): ${lastErr} — 后台轮询将判过期, 请检查到后台的链路`)
    }
  }
}

/** 任务通道逐后台并行领取 (v2.2.0): 一个后台慢/死不拖累其它后台的任务时效 */
async function tasksLoop(token) {
  while (!stopped && engineOn && token === loopToken) {
    const targets = backends.filter((b) => b.active && !b.paused && !b.fatalDisabled && backendListenEnabled(b))
    await Promise.allSettled(targets.map((b) => pollTasksOnce(b).catch((e) => log(`任务轮询异常 (后台[${b.index}]): ${e?.message}`))))
    await sleep(jitter(DEFAULT_TASK_POLL_SECONDS * 1000, 0.1))
  }
}

/**
 * 状态心跳: 空闲期也定期上报连接状态, 后台账号心跳 (cookies.last_check_at) 由此保持
 * 新鲜 —— 否则静默 60s 后监听页会把在线账号误判为 engine_offline (监听中归零)。
 * 队列非空时跳过 (上报本身就携带 status)。
 */
async function statusHeartbeatLoop(token) {
  while (!stopped && engineOn && token === loopToken) {
    await sleep(jitter(Math.max(5, heartbeatSeconds) * 1000, 0.15))
    if (stopped || !engineOn) continue
    if (!backends.some((b) => b.active)) continue
    if (!reportQueue.length) enqueueReport({ type: '__state__' })
  }
}

/* ------------- 引擎启停 (v2.2.0 Web 面板服务控制): 进程内停启, 停机状态跨重启保持 ------------- */

let engineOn = false
let loopToken = 0
// 面板「停止服务」落停机标记文件: 进程被宝塔/systemd 拉起或机器重启后, 引擎保持停止
// (与宝塔面板「停止」语义一致), 打开面板点「启动服务」恢复。
const ENGINE_STOP_FLAG = path.join(SCRIPT_DIR, 'xianyu-proxy.engine-stopped')

function anyEngineActive() {
  return backends.some((b) => b.active)
}

function startEngine(reason = '面板操作') {
  if (engineOn) return false
  engineOn = true
  try {
    if (existsSync(ENGINE_STOP_FLAG)) unlinkSync(ENGINE_STOP_FLAG)
  } catch {}
  const token = ++loopToken
  log(`引擎启动 (${reason}): 配置轮询 / 任务通道 / 状态心跳全部恢复`)
  void configLoop(token)
  void tasksLoop(token)
  void statusHeartbeatLoop(token)
  return true
}

async function stopEngine(reason = '面板操作') {
  if (!engineOn) return false
  engineOn = false
  loopToken += 1
  try {
    writeFileSync(ENGINE_STOP_FLAG, new Date().toISOString())
  } catch {}
  for (const id of [...clients.keys()]) await stopClient(id)
  log(`引擎停止 (${reason}): 全部账号连接已下线, 轮询循环退出 (本进程与 Web 面板保持运行; 点「启动服务」恢复)`)
  return true
}

let processRestartScheduled = false

/** 完整进程重启 (面板): 派生独立新进程加载当前脚本与 .env, 本进程退出。 */
function scheduleProcessRestart(reason) {
  if (processRestartScheduled) return
  processRestartScheduled = true
  log(`进程重启 (${reason}): 3s 后派生新进程并退出本进程 (加载当前脚本与 .env, 面板短暂中断后自动恢复)…`)
  setTimeout(() => {
    try {
      const child = spawn(process.execPath, [SCRIPT_PATH], { detached: true, stdio: 'ignore', cwd: SCRIPT_DIR, env: process.env })
      child.unref()
      log(`新进程已派生 (PID ${child.pid}), 本进程退出`)
    } catch (e) {
      processRestartScheduled = false
      log(`进程重启失败: ${e?.message} — 请手动重启 (面板/宝塔/systemd)`)
      return
    }
    setTimeout(() => process.exit(0), 500)
  }, 3000)
}

/* ------------- Web 管理面板 (v2.2.0): 与 /health、/gateway 共用 XY_PROXY_PORT ------------- */

const PANEL_COOKIE = 'xyp_admin'
const PANEL_SESSION_TTL_MS = 7 * 24 * 3600 * 1000
const PANEL_LOGIN_MAX_FAILS = 5
const PANEL_LOGIN_LOCK_MS = 15 * 60 * 1000
const panelSessions = new Map() // token -> { expires, ip }
const panelLoginFails = new Map() // ip -> { count, lockUntil }

// 会话过期清理 (每小时, 不阻止进程退出)
setInterval(() => {
  const now = Date.now()
  for (const [t, s] of panelSessions) if (s.expires < now) panelSessions.delete(t)
}, 3600_000).unref?.()

function panelClientIp(req) {
  return (req.socket && req.socket.remoteAddress) || '?'
}

function parseCookies(req) {
  const out = {}
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()) } catch { out[part.slice(0, i).trim()] = '' }
    }
  }
  return out
}

/** 登录密钥比对 (常数时间): sha256 后 timingSafeEqual, 不泄露长度/前缀时序 */
function panelSecretMatches(input) {
  if (!PANEL_SECRET) return false
  const a = createHash('sha256').update(String(input ?? '')).digest()
  const b = createHash('sha256').update(PANEL_SECRET).digest()
  return timingSafeEqual(a, b)
}

function panelValidSession(req) {
  const token = parseCookies(req)[PANEL_COOKIE]
  if (!token) return false
  const s = panelSessions.get(token)
  if (!s) return false
  if (Date.now() > s.expires) {
    panelSessions.delete(token)
    return false
  }
  return true
}

function maskSecret(s) {
  s = String(s || '')
  if (!s) return ''
  if (s.length <= 8) return '****'
  return `${s.slice(0, 4)}****${s.slice(-4)}`
}

/** 面板可编辑的 .env 键 (v2.2.0) */
const PANEL_ENV_KEYS = ['XY_ADMIN_URL', 'XY_ENGINE_TOKEN', 'XY_PROXY_PORT', 'XY_PROXY_ADMIN_SECRET', 'XY_POLL_SECONDS', 'XY_TASK_POLL_SECONDS', 'XY_PKG_VERSION']

function panelCurrentEnv() {
  const out = {}
  for (const k of PANEL_ENV_KEYS) out[k] = k === 'XY_PROXY_ADMIN_SECRET' ? PANEL_SECRET : String(process.env[k] || '')
  return out
}

/** 配置校验: 返回 { errors, clean } — clean 只含通过校验且确有变更的键 */
function panelValidateUpdates(updates) {
  const errors = []
  const clean = {}
  const v = (k) => String(updates?.[k] ?? '').trim()
  const adminUrl = v('XY_ADMIN_URL')
  if (adminUrl) {
    const parts = adminUrl.split('|').map((s) => s.trim()).filter(Boolean)
    if (!parts.length) errors.push('XY_ADMIN_URL 不能为空')
    else if (parts.length > 3) errors.push(`XY_ADMIN_URL 最多 3 个后台 (当前 ${parts.length} 个)`)
    for (const u of parts) {
      if (!/^https?:\/\//i.test(u)) errors.push(`后台地址必须以 http(s):// 开头: ${u.slice(0, 60)}`)
    }
    if (!errors.length) clean.XY_ADMIN_URL = parts.join('|')
  }
  const token = v('XY_ENGINE_TOKEN')
  if (token) clean.XY_ENGINE_TOKEN = token
  const port = v('XY_PROXY_PORT')
  if (port !== '') {
    const n = Math.round(Number(port))
    if (!Number.isFinite(n) || n < 0 || n > 65535) errors.push('XY_PROXY_PORT 须为 0~65535 整数 (0=关闭 HTTP 服务)')
    else clean.XY_PROXY_PORT = String(n)
  }
  const poll = v('XY_POLL_SECONDS')
  if (poll !== '') {
    const n = Math.round(Number(poll))
    if (!Number.isFinite(n) || n < 10) errors.push('XY_POLL_SECONDS 须为 ≥ 10 的整数')
    else clean.XY_POLL_SECONDS = String(n)
  }
  const tpoll = v('XY_TASK_POLL_SECONDS')
  if (tpoll !== '') {
    const n = Math.round(Number(tpoll))
    if (!Number.isFinite(n) || n < 2) errors.push('XY_TASK_POLL_SECONDS 须为 ≥ 2 的整数')
    else clean.XY_TASK_POLL_SECONDS = String(n)
  }
  const ver = v('XY_PKG_VERSION')
  if (ver) clean.XY_PKG_VERSION = ver.replace(/^v/i, '')
  const secret = v('XY_PROXY_ADMIN_SECRET')
  if (secret) clean.XY_PROXY_ADMIN_SECRET = secret
  return { errors, clean }
}

/** .env 直写 (保留原有行/行内注释, 变更键原位改值, 缺失键末尾追加); 值含空白/# 时双引号包裹 */
function panelWriteEnv(clean) {
  const envPath = (dotenvInfo && dotenvInfo.path) || path.join(SCRIPT_DIR, '.env')
  let lines = []
  try {
    lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  } catch {}
  const pending = new Map(Object.entries(clean))
  const changed = []
  const wrap = (val) => (/\s|#/.test(val) ? `"${val.replace(/"/g, '')}"` : val)
  const out = lines.map((line) => {
    const m = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)(\s+#.*)?$/)
    if (!m || !pending.has(m[2])) return line
    const key = m[2]
    const val = pending.get(key)
    pending.delete(key)
    changed.push(key)
    return `${m[1]}${key}=${wrap(val)}${m[4] || ''}`
  })
  for (const [key, val] of pending) {
    out.push(`${key}=${wrap(val)}`)
    changed.push(key)
  }
  writeFileSync(envPath, out.join('\n').replace(/\n*$/, '\n'))
  // 同步注入当前进程 env (面板所见即所得; 真实启动环境变量会在下次重启时重新优先)
  for (const [key, val] of Object.entries(clean)) process.env[key] = val
  return { path: envPath, changed }
}

function panelStatusPayload() {
  // 账号归属后台 (仅统计监听启用且活跃的后台): 同账号多后台下发时面板可见 (连接归靠前者)
  const ownersByAccount = new Map()
  for (const b of backends) {
    if (!b.active || !backendListenEnabled(b)) continue
    for (const a of b.accounts) {
      const id = String(a?.id || '')
      if (!id) continue
      if (!ownersByAccount.has(id)) ownersByAccount.set(id, [])
      ownersByAccount.get(id).push(b.index)
    }
  }
  // 账号表 = 实时连接状态 ∪ 活跃后台已下发账号 (含被面板禁用监听而未连接的, 面板可见可重新启用)
  const accountRows = new Map()
  for (const [id, s] of accountStates) accountRows.set(id, { state: s.state, detail: s.detail || '' })
  for (const b of backends) {
    if (!b.active || !backendListenEnabled(b)) continue
    for (const a of b.accounts) {
      const id = String(a?.id || '')
      if (!id || accountRows.has(id)) continue
      accountRows.set(id, accountListenEnabled(id) ? { state: '待连接', detail: '已下发待连接' } : { state: '已禁用', detail: '面板已禁用监听 (连接不建立)' })
    }
  }
  return {
    ok: true,
    version: SCRIPT_VERSION,
    multi_admin: MULTI_ADMIN,
    engine_running: engineOn,
    engine_active: anyEngineActive(),
    uptime_seconds: Math.round(process.uptime()),
    backends: backends.map((b) => ({
      index: b.index,
      host: b.host,
      url: b.url,
      active: b.active,
      paused: b.paused,
      disabled: b.fatalDisabled,
      listen_enabled: backendListenEnabled(b),
      push_fail_streak: b.pushFailStreak,
      config_fail_streak: b.configFailStreak,
      accounts: b.accounts.length,
      last_ok_at: b.lastOkAt || 0,
    })),
    accounts: [...accountRows.entries()].map(([id, s]) => ({
      id,
      state: s.state,
      detail: s.detail || '',
      listen_enabled: accountListenEnabled(id),
      owners: ownersByAccount.get(id) || [],
    })),
    connections: clients.size,
    queue: reportQueue.length,
    engine_stopped_flag: existsSync(ENGINE_STOP_FLAG),
    panel_enabled: !!PANEL_SECRET,
    token_masked: maskSecret(ENGINE_TOKEN),
  }
}

/** 面板 API 路由: /api/panel/* (session/login 免鉴权, 其余需会话 + x-xy-panel 头) */
async function handlePanelApi(req, res, pathname, query, readBodyBuffer) {
  const sendJson = (code, obj, headers) => {
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}))
    res.end(JSON.stringify(obj))
  }

  if (pathname === '/api/panel/session') {
    return sendJson(200, { ok: true, authed: panelValidSession(req), need_secret: !PANEL_SECRET, version: SCRIPT_VERSION, engine_running: engineOn })
  }

  if (pathname === '/api/panel/login') {
    if (req.method !== 'POST') return sendJson(405, { ok: false, message: '仅 POST' })
    if (!PANEL_SECRET) return sendJson(503, { ok: false, message: '面板未启用: 请先在 .env 配置 XY_PROXY_ADMIN_SECRET 并重启进程' })
    const ip = panelClientIp(req)
    const rec = panelLoginFails.get(ip)
    if (rec && rec.lockUntil > Date.now()) {
      const mins = Math.ceil((rec.lockUntil - Date.now()) / 60000)
      log(`面板登录被拒绝: ${ip} 防爆破锁定中 (剩余 ${mins} 分钟)`)
      return sendJson(429, { ok: false, message: `失败次数过多, 请 ${mins} 分钟后再试` })
    }
    let body = {}
    try {
      body = JSON.parse((await readBodyBuffer(req, 64 * 1024)).toString('utf8') || '{}')
    } catch {}
    if (!panelSecretMatches(body.secret)) {
      const r = rec || { count: 0, lockUntil: 0 }
      r.count = (r.count || 0) + 1
      if (r.count >= PANEL_LOGIN_MAX_FAILS) {
        r.lockUntil = Date.now() + PANEL_LOGIN_LOCK_MS
        r.count = 0
        log(`⚠ 面板防爆破: ${ip} 连续 ${PANEL_LOGIN_MAX_FAILS} 次密钥错误, 锁定 15 分钟`)
      }
      panelLoginFails.set(ip, r)
      log(`面板登录失败 (${ip}): 密钥不匹配`)
      return sendJson(401, { ok: false, message: r.lockUntil > Date.now() ? '密钥错误, 已触发防爆破锁定 15 分钟' : '密钥错误' })
    }
    panelLoginFails.delete(ip)
    const token = randomBytes(24).toString('hex')
    panelSessions.set(token, { expires: Date.now() + PANEL_SESSION_TTL_MS, ip })
    log(`面板登录成功 (${ip}), 会话有效期 7 天`)
    return sendJson(200, { ok: true, version: SCRIPT_VERSION }, {
      'Set-Cookie': `${PANEL_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(PANEL_SESSION_TTL_MS / 1000)}`,
    })
  }

  // ---- 以下端点全部需要有效会话 ----
  if (!panelValidSession(req)) return sendJson(401, { ok: false, message: '未登录或会话已过期' })
  // CSRF 加固: 面板前端所有 POST 带自定义头 (跨站表单/富请求无法携带)
  if (req.method === 'POST' && String(req.headers['x-xy-panel'] || '') !== '1') {
    return sendJson(403, { ok: false, message: '缺少面板请求头 (x-xy-panel)' })
  }

  if (pathname === '/api/panel/logout') {
    const token = parseCookies(req)[PANEL_COOKIE]
    if (token) panelSessions.delete(token)
    return sendJson(200, { ok: true }, { 'Set-Cookie': `${PANEL_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` })
  }

  if (pathname === '/api/panel/status') {
    return sendJson(200, panelStatusPayload())
  }

  if (pathname === '/api/panel/config' && req.method === 'GET') {
    const values = panelCurrentEnv()
    return sendJson(200, {
      ok: true,
      env_path: (dotenvInfo && dotenvInfo.path) || path.join(SCRIPT_DIR, '.env'),
      values,
      masked: { XY_ENGINE_TOKEN: maskSecret(ENGINE_TOKEN), XY_PROXY_ADMIN_SECRET: maskSecret(PANEL_SECRET) },
      secret_keys: ['XY_ENGINE_TOKEN', 'XY_PROXY_ADMIN_SECRET'],
      note: '密钥类字段留空 = 保持不变; 主服务器在上方逐行增/删/改 (含端口); 主服务器/令牌/端口等修改后需重启进程生效 (面板密钥除外, 保存即生效)',
    })
  }

  if (pathname === '/api/panel/config' && req.method === 'POST') {
    let body = {}
    try {
      body = JSON.parse((await readBodyBuffer(req, 256 * 1024)).toString('utf8') || '{}')
    } catch {}
    const { errors, clean } = panelValidateUpdates(body.values || {})
    if (errors.length) return sendJson(400, { ok: false, message: errors.join('; ') })
    if (!Object.keys(clean).length) return sendJson(200, { ok: true, changed: [], message: '没有需要保存的变更' })
    const { path: envPath, changed } = panelWriteEnv(clean)
    let note = '已写入 .env (原行内注释保留): ' + changed.join(', ')
    if (clean.XY_PROXY_ADMIN_SECRET) {
      PANEL_SECRET = clean.XY_PROXY_ADMIN_SECRET
      note += '; 面板密钥已即时生效 (其它会话保持有效)'
    }
    if (Object.keys(clean).some((k) => k !== 'XY_PROXY_ADMIN_SECRET')) note += '; 其余修改需「重启进程」生效'
    log(`面板配置已保存: ${changed.join(', ')} → ${envPath}`)
    return sendJson(200, { ok: true, changed, restart_required: Object.keys(clean).some((k) => k !== 'XY_PROXY_ADMIN_SECRET'), message: note })
  }

  if (pathname === '/api/panel/logs') {
    const n = Math.min(2000, Math.max(50, Math.round(Number(query.get('lines') || 400)) || 400))
    let lines = null
    let source = 'memory'
    try {
      lines = readFileSync(LOG_FILE, 'utf8').split('\n').filter((l) => l.trim()).slice(-n)
      source = 'file'
    } catch {}
    if (!lines || !lines.length) lines = logRing.slice(-n)
    return sendJson(200, { ok: true, source, file: path.basename(LOG_FILE), count: lines.length, lines })
  }

  if (pathname === '/api/panel/service' && req.method === 'POST') {
    let body = {}
    try {
      body = JSON.parse((await readBodyBuffer(req, 8 * 1024)).toString('utf8') || '{}')
    } catch {}
    const action = String(body.action || '')
    if (action === 'stop') {
      const changed = await stopEngine('面板停止')
      return sendJson(200, { ok: true, engine_running: engineOn, message: changed ? '服务已停止: 账号连接全部下线, 轮询循环退出 (面板保持可用; 停机状态在进程重启后保持)' : '服务本就未在运行' })
    }
    if (action === 'start') {
      const changed = startEngine('面板启动')
      return sendJson(200, { ok: true, engine_running: engineOn, message: changed ? '服务已启动: 配置轮询已恢复, 账号连接按后台配置重建' : '服务本就在运行' })
    }
    if (action === 'restart') {
      await stopEngine('面板重启')
      startEngine('面板重启')
      return sendJson(200, { ok: true, engine_running: engineOn, message: '服务已重启: 账号连接重建, 轮询循环重启' })
    }
    return sendJson(400, { ok: false, message: `未知操作: ${action.slice(0, 32)} (支持 stop/start/restart)` })
  }

  if (pathname === '/api/panel/process-restart' && req.method === 'POST') {
    sendJson(200, { ok: true, message: '进程将在 3 秒后重启 (派生新进程加载当前脚本与 .env), 面板短暂中断后自动恢复' })
    scheduleProcessRestart('面板操作')
    return
  }

  // ---- 监听开关 (v2.2.2): 主服务器/账号级 启用/禁用监听, 持久化 + 立即生效 ----
  if (pathname === '/api/panel/listen' && req.method === 'POST') {
    let body = {}
    try {
      body = JSON.parse((await readBodyBuffer(req, 8 * 1024)).toString('utf8') || '{}')
    } catch {}
    const scope = String(body.scope || '')
    const key = String(body.key || '').trim()
    const enable = !!body.enabled
    if (scope === 'backend') {
      const b = backends.find((x) => x.url === key)
      if (!b) return sendJson(404, { ok: false, message: '未知后台地址 (可能已在配置中删除): ' + key.slice(0, 80) })
      if (enable) {
        delete listenOverrides.backends[key]
        saveListenOverrides()
        log(`面板操作: 后台[${b.index}] ${b.host} 监听已启用 — 立即拉取配置恢复推送 (开关持久化, 重启进程后保持)`)
        // 立即拉取一次配置, 免等下一轮轮询 (拉取内部自带重试与异常处理)
        void pollBackendConfig(b).then(() => reconcileAccounts())
      } else {
        listenOverrides.backends[key] = false
        saveListenOverrides()
        const released = b.active ? b.accounts.length : 0
        b.active = false
        b.accounts = []
        log(`面板操作: 后台[${b.index}] ${b.host} 监听已禁用 — 不再拉取配置/推送事件/领任务${released ? `, 其 ${released} 个账号连接已释放 (由其它后台接管或下线)` : ''} (开关持久化, 重启进程后保持)`)
        reconcileAccounts()
      }
      return sendJson(200, { ok: true, message: enable ? `后台[${b.index}] ${b.host} 监听已启用` : `后台[${b.index}] ${b.host} 监听已禁用, 该后台不再收到任何消息/事件` })
    }
    if (scope === 'account') {
      if (!key) return sendJson(400, { ok: false, message: '缺少账号 id' })
      if (enable) {
        delete listenOverrides.accounts[key]
        saveListenOverrides()
        log(`面板操作: 账号 ${key} 监听已启用 — 重新对齐账号集合 (下一轮配置轮询后按后台下发恢复连接)`)
        void pollConfigOnce()
      } else {
        listenOverrides.accounts[key] = false
        saveListenOverrides()
        if (clients.has(key)) {
          await stopClient(key)
          accountStates.set(key, { state: 'disabled', detail: '面板已禁用监听' })
        }
        log(`面板操作: 账号 ${key} 监听已禁用 — 所有后台停止监听该账号${clients.has(key) ? ', 连接已下线' : ''} (不再自动回复/自动发货; 开关持久化, 重启进程后保持)`)
        reconcileAccounts()
      }
      return sendJson(200, { ok: true, message: enable ? `账号 ${key} 监听已启用` : `账号 ${key} 监听已禁用, 连接下线且不再自动回复/发货` })
    }
    return sendJson(400, { ok: false, message: '未知 scope: ' + scope.slice(0, 32) + ' (支持 backend/account)' })
  }

  if (pathname === '/api/panel/upload' && req.method === 'POST') {
    const name = path.basename(String(query.get('name') || ''))
    if (name !== 'xianyu-proxy.mjs') return sendJson(400, { ok: false, message: '只允许覆盖 xianyu-proxy.mjs (收到: ' + name.slice(0, 60) + ')' })
    let buf
    try {
      buf = await readBodyBuffer(req, 8 * 1024 * 1024)
    } catch (e) {
      return sendJson(400, { ok: false, message: '上传读取失败: ' + String(e?.message || e).slice(0, 120) })
    }
    if (!buf || buf.length < 64) return sendJson(400, { ok: false, message: '文件为空或过小, 拒绝覆盖' })
    if (!buf.toString('utf8').includes('xianyu-proxy')) {
      return sendJson(400, { ok: false, message: '文件内容缺少 xianyu-proxy 标识, 疑非代理脚本, 拒绝覆盖' })
    }
    // node --check 语法预检: 语法不过的脚本绝不落盘 (防止上传手滑把服务搞挂)
    const tmpPath = path.join(SCRIPT_DIR, '.xianyu-proxy.uploading.mjs')
    try {
      writeFileSync(tmpPath, buf)
      execFileSync(process.execPath, ['--check', tmpPath], { timeout: 20_000 })
    } catch (e) {
      try { unlinkSync(tmpPath) } catch {}
      const errText = String(e?.stderr || e?.message || '').split('\n').filter(Boolean).slice(0, 4).join(' | ').slice(0, 240)
      return sendJson(400, { ok: false, message: 'node --check 语法预检未通过, 已拒绝覆盖: ' + errText })
    }
    // 旧文件时间戳改名备份 → 新文件就位
    const d = new Date()
    const pad = (x) => String(x).padStart(2, '0')
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    const backup = `${SCRIPT_PATH}.bak-${stamp}`
    try {
      renameSync(SCRIPT_PATH, backup)
    } catch (e) {
      return sendJson(500, { ok: false, message: '备份旧脚本失败: ' + String(e?.message || e).slice(0, 120) })
    }
    try {
      renameSync(tmpPath, SCRIPT_PATH)
    } catch (e) {
      try { renameSync(backup, SCRIPT_PATH) } catch {}
      return sendJson(500, { ok: false, message: '写入新脚本失败 (已回滚): ' + String(e?.message || e).slice(0, 120) })
    }
    log(`脚本已更新: 新文件 ${buf.length} 字节, 旧文件备份为 ${path.basename(backup)} — 重启进程后生效`)
    return sendJson(200, { ok: true, bytes: buf.length, backup: path.basename(backup), message: `上传成功 (${buf.length} 字节), 旧文件已备份为 ${path.basename(backup)}; 请点「重启进程」加载新脚本` })
  }

  return sendJson(404, { ok: false, message: '未知面板端点' })
}

/* ------------- 面板页面 (单文件内联, 手动刷新语义: 状态/日志均点按钮刷新) ------------- */

const PANEL_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>闲鱼独立代理 · 管理面板</title>
<style>
:root { --bg:#f1f5f9; --card:#ffffff; --line:#e2e8f0; --tx:#0f172a; --mut:#64748b; --pri:#16a34a; --dan:#dc2626; --warn:#d97706; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1220; --card:#111a2c; --line:#243149; --tx:#e2e8f0; --mut:#8aa0bf; } }
* { box-sizing:border-box; margin:0; padding:0 }
body { background:var(--bg); color:var(--tx); font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; padding:16px; }
.wrap { max-width:860px; margin:0 auto; display:flex; flex-direction:column; gap:14px; }
header { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap }
h1 { font-size:19px; display:flex; align-items:center; gap:8px }
h2 { font-size:15px }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
.card-h { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap }
.muted { color:var(--mut) } .small { font-size:12.5px } .msg { margin-top:8px; font-size:13px; min-height:18px; word-break:break-all }
.badge { display:inline-block; padding:2px 9px; border-radius:999px; font-size:12px; border:1px solid var(--line); background:transparent; vertical-align:middle }
.badge.ok { color:#16a34a; border-color:#16a34a55 } .badge.bad { color:#dc2626; border-color:#dc262655 }
.badge.warn { color:#d97706; border-color:#d9770655 } .badge.dim { color:var(--mut) }
.btn { padding:7px 14px; border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--tx); font-size:13.5px; cursor:pointer; min-height:36px }
.btn:hover { border-color:var(--mut) }
.btn.primary { background:var(--pri); border-color:var(--pri); color:#fff }
.btn.danger { background:var(--dan); border-color:var(--dan); color:#fff }
.btn.warn { background:var(--warn); border-color:var(--warn); color:#fff }
.btn.ghost { background:transparent }
.btn.sm { padding:4px 10px; min-height:30px; font-size:12.5px }
.btn:disabled { opacity:.5; cursor:not-allowed }
.rowbtns { display:flex; gap:8px; flex-wrap:wrap }
input[type=text], input[type=password], input[type=number], input[type=file], select {
  width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--tx); font-size:13.5px; min-height:38px;
}
.field { margin-bottom:10px } .field label { display:block; font-size:12.5px; color:var(--mut); margin-bottom:4px }
table { width:100%; border-collapse:collapse; font-size:13px }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); word-break:break-all }
th { color:var(--mut); font-weight:500; font-size:12px }
.login { max-width:380px; margin:12vh auto 0; text-align:center; padding:26px 24px }
.login input { text-align:center; margin:14px 0 } .login .btn { width:100% }
.logbox { background:#0b1020; color:#c8e1a8; border-radius:10px; padding:12px; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; white-space:pre-wrap; word-break:break-all; max-height:420px; overflow-y:auto; }
.dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; vertical-align:middle }
.dot.g { background:#22c55e } .dot.r { background:#ef4444 } .dot.y { background:#eab308 } .dot.x { background:#94a3b8 }
.kv { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin-bottom:10px }
.kv div { border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:12.5px }
.kv b { display:block; font-size:16px; font-weight:600 }
.urlrow { display:flex; gap:8px; margin-bottom:8px; align-items:center }
.urlrow input { flex:1 }
</style>
</head>
<body>
<div class="wrap">
  <div id="loginView" style="display:none">
    <div class="card login">
      <h1>闲鱼独立代理</h1>
      <p class="muted small" style="margin-top:6px">管理面板 <span id="verText"></span> · 请输入管理密钥</p>
      <input id="secretInput" type="password" placeholder="XY_PROXY_ADMIN_SECRET" autocomplete="current-password">
      <button id="loginBtn" class="btn primary">登 录</button>
      <p id="loginMsg" class="msg"></p>
    </div>
  </div>

  <div id="mainView" style="display:none">
    <header>
      <h1>闲鱼独立代理 <span id="verBadge" class="badge dim"></span></h1>
      <div style="display:flex; gap:8px; align-items:center">
        <span id="engineBadge" class="badge"></span>
        <button id="logoutBtn" class="btn ghost sm">退出</button>
      </div>
    </header>

    <section class="card">
      <div class="card-h"><h2>运行状态</h2><button id="statusRefresh" class="btn sm">刷新</button></div>
      <div class="kv" id="kvRow"></div>
      <div id="backendTable"></div>
      <p class="muted small" style="margin:6px 0 10px">监听开关按主服务器生效: 禁用后该后台不再收到任何消息/事件 (配置持久化在代理本机, 重启进程后保持)。同账号多后台抢占时, 禁用不要的那一台即可让另一台接管。</p>
      <div id="accountTable"></div>
    </section>

    <section class="card">
      <div class="card-h"><h2>服务控制</h2></div>
      <div class="rowbtns">
        <button id="stopBtn" class="btn danger">停止服务</button>
        <button id="startBtn" class="btn primary">启动服务</button>
        <button id="restartBtn" class="btn warn">重启服务</button>
        <button id="procRestartBtn" class="btn ghost">重启进程</button>
      </div>
      <p class="muted small" style="margin-top:8px">停止/启动/重启只作用于监听引擎 (账号连接与轮询), 面板保持可用, 停止状态在进程重启后保持; 「重启进程」派生新进程加载当前脚本与 .env (约 3~6 秒, 面板短暂中断)。</p>
    </section>

    <section class="card">
      <div class="card-h"><h2>配置 (.env)</h2><button id="cfgReload" class="btn sm">重载</button></div>
      <div id="cfgBody"></div>
      <div class="rowbtns"><button id="cfgSave" class="btn primary">保存配置</button></div>
      <p class="muted small" style="margin-top:8px">主服务器支持增/删/改 (每行一个地址, 含端口, 最多 3 个并行推送); 同账号被多个后台同时下发时, 连接归「靠前」后台 — 想让某台主服务器接管, 在上方运行状态里禁用另一台的监听即可。除面板密钥保存即生效外, 其余修改需「重启进程」生效。</p>
    </section>

    <section class="card">
      <div class="card-h"><h2>运行日志</h2>
        <div style="display:flex; gap:8px; align-items:center">
          <select id="logLines" style="width:auto; min-height:30px; padding:2px 6px">
            <option value="200">200 行</option>
            <option value="400" selected>400 行</option>
            <option value="1000">1000 行</option>
          </select>
          <button id="logRefresh" class="btn sm">手动刷新</button>
        </div>
      </div>
      <pre id="logBody" class="logbox">点「手动刷新」加载日志</pre>
      <p class="muted small" style="margin-top:6px" id="logMeta"></p>
    </section>

    <section class="card">
      <div class="card-h"><h2>脚本更新</h2></div>
      <div class="field"><input id="fileInput" type="file" accept=".mjs"></div>
      <div class="rowbtns"><button id="uploadBtn" class="btn primary">上传覆盖 xianyu-proxy.mjs</button></div>
      <p id="upMsg" class="msg"></p>
      <p class="muted small">上传前自动做 node --check 语法预检 (不过不落盘); 旧文件自动按时间戳改名备份; 上传后需「重启进程」加载新脚本。</p>
    </section>
  </div>
</div>
<script>
(function () {
  'use strict'
  var CFG = { secretKeys: [], masked: {} }
  function $(id) { return document.getElementById(id) }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }
  function api(path, opts) {
    opts = opts || {}
    opts.headers = Object.assign({ 'x-xy-panel': '1' }, opts.headers || {})
    if (opts.json !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(opts.json)
      opts.method = opts.method || 'POST'
      delete opts.json
    }
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (t) {
        var j = null
        try { j = JSON.parse(t) } catch (e) {}
        if (r.status === 401 && path !== '/api/panel/login') { showLogin(); throw new Error((j && j.message) || '未登录或会话过期') }
        if (!r.ok) throw new Error((j && j.message) || ('HTTP ' + r.status))
        return j || {}
      })
    })
  }
  function fmtUptime(s) {
    s = Math.round(Number(s) || 0)
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
    return (d ? d + '天' : '') + (h ? h + '时' : '') + m + '分'
  }
  function fmtTime(ts) {
    if (!ts) return '-'
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  }

  function showLogin() { $('loginView').style.display = ''; $('mainView').style.display = 'none'; setTimeout(function () { $('secretInput').focus() }, 50) }
  function showMain() { $('loginView').style.display = 'none'; $('mainView').style.display = '' }

  function doLogin() {
    var s = $('secretInput').value
    if (!s) { $('loginMsg').textContent = '请输入管理密钥 (XY_PROXY_ADMIN_SECRET)'; return }
    $('loginBtn').disabled = true
    api('/api/panel/login', { json: { secret: s } }).then(function (j) {
      $('verText').textContent = 'v' + (j.version || '')
      showMain(); refreshAll()
    }).catch(function (e) {
      $('loginMsg').textContent = e.message
    }).finally(function () { $('loginBtn').disabled = false })
  }

  function bindToggles(container) {
    var arr = container.querySelectorAll('button[data-lscope]')
    Array.prototype.forEach.call(arr, function (btn) {
      btn.addEventListener('click', function () {
        var scope = btn.getAttribute('data-lscope'), key = btn.getAttribute('data-lkey')
        var enable = btn.getAttribute('data-lenable') === '1', confirmText = btn.getAttribute('data-lconfirm')
        if (confirmText && !window.confirm(confirmText)) return
        btn.disabled = true
        api('/api/panel/listen', { json: { scope: scope, key: key, enabled: enable } }).then(function (j) {
          appendLog(j.message || '监听开关已更新')
          refreshStatus()
        }).catch(function (e) { alert('操作失败: ' + e.message); btn.disabled = false })
      })
    })
  }

  function renderStatus(j) {
    $('verBadge').textContent = 'v' + j.version
    var eb = $('engineBadge')
    if (j.engine_running) { eb.className = 'badge ok'; eb.textContent = '● 服务运行中' }
    else { eb.className = 'badge bad'; eb.textContent = '○ 服务已停止' }
    var kv = ''
    kv += '<div><b>' + j.connections + '</b>闲鱼账号连接</div>'
    kv += '<div><b>' + j.queue + '</b>待上报事件</div>'
    kv += '<div><b>' + j.backends.filter(function (b) { return b.active }).length + '/' + j.backends.length + '</b>活跃后台</div>'
    kv += '<div><b>' + fmtUptime(j.uptime_seconds) + '</b>运行时长</div>'
    $('kvRow').innerHTML = kv
    var bt = '<table><tr><th>后台</th><th>地址</th><th>状态</th><th>下发账号</th><th>连续推送失败</th><th>最近成功</th><th>监听</th><th>操作</th></tr>'
    if (!j.backends.length) bt += '<tr><td colspan="8" class="muted">无后台配置 (配置页可添加主服务器)</td></tr>'
    for (var i = 0; i < j.backends.length; i++) {
      var b = j.backends[i]
      var st = b.listen_enabled === false ? '<span class="dot x"></span>监听已禁用'
        : b.disabled ? '<span class="dot r"></span>已停用 (鉴权致命)'
        : b.paused ? '<span class="dot y"></span>推送已暂停'
        : b.active ? '<span class="dot g"></span>活跃'
        : '<span class="dot x"></span>备用'
      var lsBtn = b.listen_enabled === false
        ? '<button class="btn sm primary" data-lscope="backend" data-lkey="' + esc(b.url) + '" data-lenable="1">启用监听</button>'
        : '<button class="btn sm danger" data-lscope="backend" data-lkey="' + esc(b.url) + '" data-lenable="0" data-lconfirm="确认禁用后台[' + b.index + '] ' + esc(b.host) + ' 的监听?\\n\\n该后台将立即退出接收: 不再拉取配置/推送事件/领任务, 其独有账号连接释放 (由其它后台接管或下线)。\\n开关持久化在代理本机, 重启进程后保持。">禁用监听</button>'
      bt += '<tr><td>[' + b.index + ']</td><td>' + esc(b.host) + '</td><td>' + st + '</td><td>' + b.accounts + '</td><td>' + b.push_fail_streak + '</td><td class="muted">' + fmtTime(b.last_ok_at) + '</td><td>' + (b.listen_enabled === false ? '<span class="badge dim">已禁用</span>' : '<span class="badge ok">启用</span>') + '</td><td>' + lsBtn + '</td></tr>'
    }
    bt += '</table>'
    $('backendTable').innerHTML = bt
    var at = '<table><tr><th>账号</th><th>归属后台</th><th>连接状态</th><th>详情</th><th>操作</th></tr>'
    if (!j.accounts.length) at += '<tr><td colspan="5" class="muted">无托管账号 (等活跃后台下发后显示)</td></tr>'
    for (var k = 0; k < j.accounts.length; k++) {
      var a = j.accounts[k]
      var ownersTxt = (a.owners && a.owners.length) ? '[' + a.owners.join('/') + ']' : '—'
      var dupBadge = (a.owners && a.owners.length > 1) ? ' <span class="badge warn">多后台同时下发·连接归靠前者</span>' : ''
      var aBtn = a.listen_enabled === false
        ? '<button class="btn sm primary" data-lscope="account" data-lkey="' + esc(a.id) + '" data-lenable="1">启用监听</button>'
        : '<button class="btn sm danger" data-lscope="account" data-lkey="' + esc(a.id) + '" data-lenable="0" data-lconfirm="确认禁用账号 ' + esc(a.id) + ' 的监听?\\n\\n该账号将在所有后台停止监听: 连接下线, 不再自动回复/自动发货, 直到重新启用。\\n若想让另一台主服务器接管该账号, 请改用「后台」行的禁用监听。">禁用监听</button>'
      at += '<tr><td>' + esc(a.id) + dupBadge + '</td><td>' + ownersTxt + '</td><td>' + esc(a.state) + '</td><td class="muted">' + esc(a.detail || '') + '</td><td>' + aBtn + '</td></tr>'
    }
    at += '</table>'
    $('accountTable').innerHTML = at
    bindToggles($('backendTable'))
    bindToggles($('accountTable'))
  }

  function refreshStatus() {
    return api('/api/panel/status').then(renderStatus).catch(function (e) { console.warn(e.message) })
  }

  function renderConfig(j) {
    CFG = j
    // 主服务器结构化编辑 (v2.2.2): 每行一个后台地址 (含端口), 增/改/删后保存时回写 XY_ADMIN_URL (| 拼接)
    CFG.urls = String(j.values.XY_ADMIN_URL || '').split('|').map(function (s) { return s.trim() }).filter(Boolean)
    if (!CFG.urls.length) CFG.urls = ['']
    var fields = [
      ['XY_ENGINE_TOKEN', '引擎接入令牌 XY_ENGINE_TOKEN (已配置: ' + (j.masked.XY_ENGINE_TOKEN || '未配置') + ')', 'secret'],
      ['XY_PROXY_PORT', 'HTTP 端口 XY_PROXY_PORT (0 = 关闭 /health + /gateway + 面板)', 'number'],
      ['XY_PROXY_ADMIN_SECRET', '面板登录密钥 XY_PROXY_ADMIN_SECRET (已配置: ' + (j.masked.XY_PROXY_ADMIN_SECRET || '未配置') + ')', 'secret'],
      ['XY_POLL_SECONDS', '配置轮询间隔秒 XY_POLL_SECONDS (≥10)', 'number'],
      ['XY_TASK_POLL_SECONDS', '任务轮询间隔秒 XY_TASK_POLL_SECONDS (≥2)', 'number'],
      ['XY_PKG_VERSION', '脚本版本号 XY_PKG_VERSION', 'text'],
    ]
    var html = ''
    html += '<div class="field"><label>主服务器列表 XY_ADMIN_URL (最多 3 个, 消息/会话并行推送到全部活跃后台; 地址含端口如 http://主服务器IP:端口, 后台路径可留空)</label>'
    html += '<div id="adminUrlList"></div>'
    html += '<div class="rowbtns" style="margin-top:6px"><button id="admAddBtn" class="btn sm" type="button">+ 添加主服务器</button><span class="muted small" id="admCount"></span></div></div>'
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i]
      var val = j.values[f[0]] || ''
      var isSecret = f[2] === 'secret'
      html += '<div class="field"><label>' + f[1] + '</label>'
      html += '<input type="' + (isSecret ? 'password' : f[2] === 'number' ? 'number' : 'text') + '" id="cfg_' + f[0] + '" ' + (isSecret ? 'placeholder="留空 = 保持不变"' : 'value="' + esc(val) + '"') + '></div>'
    }
    html += '<p class="muted small">.env 路径: ' + esc(j.env_path) + '</p>'
    $('cfgBody').innerHTML = html
    renderAdminUrls()
    $('admAddBtn').addEventListener('click', function () {
      if (CFG.urls.length >= 3) { alert('主服务器最多 3 个 (XY_ADMIN_URL 上限)'); return }
      CFG.urls.push('')
      renderAdminUrls()
    })
  }

  function renderAdminUrls() {
    var host = $('adminUrlList')
    host.innerHTML = ''
    for (var i = 0; i < CFG.urls.length; i++) {
      ;(function (idx) {
        var row = document.createElement('div')
        row.className = 'urlrow'
        var inp = document.createElement('input')
        inp.type = 'text'
        inp.value = CFG.urls[idx]
        inp.placeholder = 'http://主服务器IP或域名:端口 (必填, 含端口)'
        inp.addEventListener('input', function () { CFG.urls[idx] = inp.value })
        var del = document.createElement('button')
        del.className = 'btn sm danger'
        del.type = 'button'
        del.textContent = '删除'
        del.addEventListener('click', function () {
          CFG.urls.splice(idx, 1)
          if (!CFG.urls.length) CFG.urls = ['']
          renderAdminUrls()
        })
        row.appendChild(inp)
        row.appendChild(del)
        host.appendChild(row)
      })(i)
    }
    $('admCount').textContent = CFG.urls.filter(function (u) { return u.trim() }).length + '/3 个已填写'
    $('admAddBtn').disabled = CFG.urls.length >= 3
  }

  function loadConfig() { return api('/api/panel/config').then(renderConfig).catch(function (e) { console.warn(e.message) }) }

  function saveConfig() {
    var values = {}
    var urls = CFG.urls.map(function (s) { return s.trim() }).filter(Boolean)
    if (urls.length > 3) { alert('主服务器最多 3 个 (当前 ' + urls.length + ' 个), 请先删除多余行'); return }
    if (urls.length) values.XY_ADMIN_URL = urls.join('|')
    var keys = ['XY_ENGINE_TOKEN', 'XY_PROXY_PORT', 'XY_PROXY_ADMIN_SECRET', 'XY_POLL_SECONDS', 'XY_TASK_POLL_SECONDS', 'XY_PKG_VERSION']
    for (var k = 0; k < keys.length; k++) {
      var el = $('cfg_' + keys[k])
      if (el && el.value.trim() !== '') values[keys[k]] = el.value.trim()
    }
    $('cfgSave').disabled = true
    api('/api/panel/config', { json: { values: values } }).then(function (j) {
      alert(j.message || '已保存')
      loadConfig()
    }).catch(function (e) { alert('保存失败: ' + e.message) }).finally(function () { $('cfgSave').disabled = false })
  }

  function loadLogs() {
    var n = $('logLines').value
    $('logRefresh').disabled = true
    $('logBody').textContent = '加载中…'
    return api('/api/panel/logs?lines=' + n).then(function (j) {
      $('logBody').textContent = (j.lines || []).join('\\n') || '(暂无日志)'
      $('logBody').scrollTop = $('logBody').scrollHeight
      $('logMeta').textContent = '来源: ' + (j.source === 'file' ? '日志文件 ' + j.file : '进程内存') + ' · 共 ' + j.count + ' 行 (手动刷新, 不自动滚动覆盖)'
    }).catch(function (e) { $('logBody').textContent = '加载失败: ' + e.message }).finally(function () { $('logRefresh').disabled = false })
  }

  function service(action, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return
    api('/api/panel/service', { json: { action: action } }).then(function (j) {
      alert(j.message || '已执行')
      refreshStatus()
    }).catch(function (e) { alert('操作失败: ' + e.message) })
  }

  function upload() {
    var f = $('fileInput').files && $('fileInput').files[0]
    if (!f) { $('upMsg').textContent = '请先选择 xianyu-proxy.mjs 文件'; return }
    if (f.name !== 'xianyu-proxy.mjs') { $('upMsg').textContent = '文件名必须为 xianyu-proxy.mjs (当前: ' + f.name + ')'; return }
    if (!window.confirm('确认用所选文件覆盖当前脚本? 旧文件将按时间戳备份, 覆盖后需重启进程生效。')) return
    $('uploadBtn').disabled = true
    $('upMsg').textContent = '上传中…'
    fetch('/api/panel/upload?name=xianyu-proxy.mjs', { method: 'POST', headers: { 'x-xy-panel': '1', 'Content-Type': 'application/octet-stream' }, body: f })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
      .then(function (r) {
        $('upMsg').textContent = r.j.message || (r.ok ? '上传成功' : '上传失败')
        if (r.ok) { $('fileInput').value = ''; appendLog('脚本已上传: ' + (r.j.message || '')) }
      })
      .catch(function (e) { $('upMsg').textContent = '上传失败: ' + e.message })
      .finally(function () { $('uploadBtn').disabled = false })
  }

  function appendLog(text) {
    var ts = new Date().toLocaleString('zh-CN', { hour12: false })
    $('logBody').textContent = '[xianyu-proxy] ' + ts + ' ' + text + '\\n' + $('logBody').textContent
  }

  function refreshAll() { refreshStatus(); loadConfig(); loadLogs() }

  $('loginBtn').addEventListener('click', doLogin)
  $('secretInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin() })
  $('logoutBtn').addEventListener('click', function () { api('/api/panel/logout', { json: {} }).then(showLogin).catch(showLogin) })
  $('statusRefresh').addEventListener('click', refreshStatus)
  $('cfgReload').addEventListener('click', loadConfig)
  $('cfgSave').addEventListener('click', saveConfig)
  $('logRefresh').addEventListener('click', loadLogs)
  $('logLines').addEventListener('change', loadLogs)
  $('stopBtn').addEventListener('click', function () { service('stop', '确认停止服务? 全部账号连接将下线, 自动回复/自动发货/拉单暂停 (面板保持可用)。') })
  $('startBtn').addEventListener('click', function () { service('start', null) })
  $('restartBtn').addEventListener('click', function () { service('restart', '确认重启服务? 账号连接将重建。') })
  $('procRestartBtn').addEventListener('click', function () {
    if (!window.confirm('确认重启进程? 新进程加载当前脚本与 .env, 面板约 3~6 秒后恢复。')) return
    api('/api/panel/process-restart', { json: {} }).then(function (j) { alert(j.message || '重启中'); }).catch(function (e) { alert('操作失败: ' + e.message) })
  })
  $('uploadBtn').addEventListener('click', upload)

  api('/api/panel/session').then(function (j) {
    $('verText').textContent = 'v' + (j.version || '')
    if (!j.need_secret && j.authed) { showMain(); refreshAll() }
    else {
      showLogin()
      if (j.need_secret) $('loginMsg').textContent = '面板未启用: 请在 .env 配置 XY_PROXY_ADMIN_SECRET 后重启进程'
    }
  }).catch(function () { showLogin() })
})()
</script>
</body>
</html>`

/* --------------------- HTTP 服务: /health + /gateway 透传网关 + Web 面板 (共用 XY_PROXY_PORT) --------------------- */

if (PROXY_PORT > 0) {
  /** 请求体读取 (Buffer, 上限拒绝): 网关/面板登录/配置/上传共用 */
  const readBodyBuffer = (req, max = 512 * 1024) =>
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
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  const readGatewayBody = async (req, max) => (await readBodyBuffer(req, max)).toString('utf8')

  const server = http.createServer(async (req, res) => {
    let pathname = String(req.url || '/')
    let query = new URLSearchParams()
    try {
      const u = new URL(req.url || '/', 'http://localhost')
      pathname = u.pathname
      query = u.searchParams
    } catch {}
    // 来源域名检测 (v2.2.5): 浏览器来源非本代理自身且非 XY_ADMIN_URL 后台域名 → 直接拒绝
    if (rejectForeignSource(req, res, pathname)) return
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          ok: true,
          script_version: `v${SCRIPT_VERSION}`,
          engine_active: anyEngineActive(),
          engine_running: engineOn,
          gateway: true,
          panel: !!PANEL_SECRET,
          multi_admin: MULTI_ADMIN,
          accounts: [...accountStates.entries()].map(([id, s]) => ({ id, state: s.state })),
          uptime_seconds: Math.round(process.uptime()),
        }),
      )
      return
    }
    if (pathname === '/gateway' && req.method === 'POST') {
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
    // Web 管理面板 (v2.2.0): / 与 /panel 为面板页, /api/panel/* 为面板 API
    if ((pathname === '/' || pathname === '/panel') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      if (!PANEL_SECRET) {
        res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>面板未启用</title><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:90vh;color:#475569"><p>面板未启用: 请在本脚本同目录 .env 配置 <b>XY_PROXY_ADMIN_SECRET=你的登录密钥</b> 后重启进程 (GET /health 不受影响)</p></body></html>')
        return
      }
      res.end(PANEL_HTML)
      return
    }
    if (pathname.startsWith('/api/panel/')) {
      try {
        await handlePanelApi(req, res, pathname, query, readBodyBuffer)
      } catch (e) {
        log(`面板接口异常: ${pathname} — ${e?.message}`)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: '面板内部错误: ' + String(e?.message || e).slice(0, 120) }))
        }
      }
      return
    }
    res.writeHead(404)
    res.end()
  })
  // EADDRINUSE 重试 (v2.2.0): 面板「重启进程」派生的新进程可能在旧进程释放端口前启动 —
  // 每 1s 重试最长 20s; 也兼容宝塔/systemd 拉起实例与手动实例短时并存的竞争。
  let listenRetries = 20
  server.on('error', (e) => {
    if (e?.code === 'EADDRINUSE' && listenRetries > 0) {
      listenRetries -= 1
      log(`HTTP 端口 ${PROXY_PORT} 尚未就绪 (EADDRINUSE, 前任进程尚未退出), 1s 后重试监听 (剩余 ${listenRetries} 次)`)
      setTimeout(() => {
        try {
          server.listen(PROXY_PORT)
        } catch (err) {
          log(`HTTP 服务启动异常: ${err?.message} — 进程退出`)
          process.exit(1)
        }
      }, 1000)
      return
    }
    log(`HTTP 服务错误 (${e?.code || ''}): ${e?.message} — 端口 ${PROXY_PORT} 被占用或系统拒绝, 进程退出`)
    process.exit(1)
  })
  server.listen(PROXY_PORT, () =>
    log(`HTTP 服务已监听: http://0.0.0.0:${PROXY_PORT} (GET /health 健康检查 + POST /gateway mtop 透传网关 (Bearer 鉴权=XY_ENGINE_TOKEN)${PANEL_SECRET ? ' + Web 管理面板 http://本机:' + PROXY_PORT + '/ (密钥登录)' : ''}; 绑定全部网卡 — 公网入站须放行端口)`),
  )
} else if (PANEL_SECRET) {
  log('XY_PROXY_ADMIN_SECRET 已配置但 XY_PROXY_PORT 未开启, Web 管理面板不可用 (配置 XY_PROXY_PORT 如 8880 后重启进程)')
}

/* --------------------- 启动 --------------------- */

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`收到 ${sig}, 停止全部账号连接并退出…`)
    stopped = true
    engineOn = false
    for (const client of clients.values()) void client.stop()
    setTimeout(() => process.exit(0), 1000)
  })
}

log(`独立代理已启动 → 后台(${ADMIN_URLS.length}): ${ADMIN_URLS.join(' | ')}${PROXY_PORT > 0 ? ` (HTTP :${PROXY_PORT} = /health + /gateway 透传网关${PANEL_SECRET ? ' + Web 管理面板' : ''})` : ''}`)
log(`配置轮询 ${DEFAULT_POLL_SECONDS}s (以后台下发的 intervals 为准), 事件上报合并窗口 250ms, 任务轮询 ${DEFAULT_TASK_POLL_SECONDS}s${MULTI_ADMIN ? ', 多后台并行推送模式' : ''}`)

// 引擎自动启动 (面板「停止服务」落停机标记文件, 重启进程后保持停止 — 与宝塔面板停止语义一致)
if (existsSync(ENGINE_STOP_FLAG)) {
  log('检测到引擎停机标记 (面板此前停止了服务), 引擎保持停止 — 打开 Web 面板点「启动服务」恢复')
} else {
  startEngine('进程启动')
}
