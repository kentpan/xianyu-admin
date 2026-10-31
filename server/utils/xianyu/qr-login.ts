/**
 * qr-login.ts — 闲鱼扫码登录 (流程逻辑复刻 zhinianboke/xianyu-auto-reply qr_login 模块,
 * 按本系统两种部署形态 (node-server / cloudflare-pages) 梳理驱动模型):
 *
 *   - 状态机: 参考项目由服务端 asyncio 后台任务 0.8s 轮询 query.do 驱动; 本版把驱动权
 *     交给前端串行轮询 (在途 ≤1) — status 端点每次读库 → 推进一步 → 写库 → 返回。
 *     CF Workers 无长驻进程且 waitUntil ≤30s, 后台循环在 serverless 上必死; 轮询牵引
 *     在 node 与 CF 上行为一致, query.do 实测 20~90ms, status 响应始终毫秒级。
 *   - 会话落库 qr_login_sessions (表单参数/cookie jar/人脸二维码序列化存列):
 *     serverless 多隔离实例与进程重启下状态不丢 (v2.1.1 已实证该模式)。
 *   - 服务端全自动人脸核验 (对齐 face_verification.py): 跟随 iframeRedirectUrl 302 链
 *     提取人脸二维码 → 用户手机闲鱼 App 扫码 → 轮询 check.do → ivCheckLogin 收全量
 *     登录 cookie — 核验全程不出服务端 cookie jar, 登录 cookie 完整, 不会 need_relogin。
 *     核验链全部跳转均在 passport.goofish.com 域。
 *   - 上游降级: 参考项目跑在闲鱼可达服务器上; CF 边缘出口到 h5api.m.goofish.com 被闲鱼
 *     mtop 网关墙死 (tarpit, 实测 90s+ 零响应), 而 passport.goofish.com 与
 *     log.mmstat.com 可达。cna 与 m_h5_tk 两跳为「尽力而为」(失败不阻塞 passport 链,
 *     v2.1.1 实证无 m_h5_tk 亦可出码/轮询/核验); 闲鱼可达环境两跳正常成功, 行为与
 *     参考项目一致。token 刷新与 cookie 保活不在此处 (h5api) — 由监听引擎侧承担。
 */
import { createHash } from 'node:crypto'
import { getDb } from '../db'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** 参考项目 generate_headers(): passport 系请求统一头 */
const PASSPORT_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  Referer: 'https://passport.goofish.com/',
  Origin: 'https://passport.goofish.com',
}

const HOST = 'https://passport.goofish.com'
const API_MINI_LOGIN = `${HOST}/mini_login.htm`
const API_GENERATE_QR = `${HOST}/newlogin/qrcode/generate.do`
const API_SCAN_STATUS = `${HOST}/newlogin/qrcode/query.do`
const API_FACE_CHECK = `${HOST}/iv/photoVerify/check.do`
const API_CNA = 'https://log.mmstat.com/eg.js'
const API_H5_TK = 'https://h5api.m.goofish.com/h5/mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get/1.0/'

/** passport 域单请求硬超时 (健康网络下闲鱼接口 20~90ms 返回, 8s 为链路异常兜底) */
const UPSTREAM_TIMEOUT_MS = 8_000
/** 降级跳 (cna / m_h5_tk) 硬超时 — CF 出口被墙时快速跳过, 不拖死出码 */
const FALLBACK_TIMEOUT_MS = 4_000
/** 二维码会话有效期 (5 分钟) */
const SESSION_EXPIRE_MS = 300_000
/** 人脸核验有效期 (进入核验态起 5 分钟, 对齐参考项目核验窗口重置) */
const VERIFY_EXPIRE_MS = 300_000

export type QrStatus =
  | 'waiting'
  | 'scanned'
  | 'success'
  | 'expired'
  | 'verification_required'
  | 'cancelled'

/** 落库会话 (qr_login_sessions 行) */
interface QrSessionRow {
  sessionKey: string
  userId: number
  status: QrStatus
  qrUrl: string
  cookieValue: string
  xianyuUid: string
  xianyuNick: string
  errorMessage: string
  params: Record<string, string>
  jar: Map<string, string>
  faceQrUrl: string
  verificationUrl: string
  createdAtMs: number
  updatedAtMs: number
}

function mergeSetCookies(jar: Map<string, string>, setCookieList: string[]): void {
  for (const sc of setCookieList) {
    const pair = sc.split(';', 1)[0]
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (!name) continue
    jar.set(name, value)
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

function withCookieHeader(extra: Record<string, string>, jar: Map<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const ck = cookieHeader(jar)
  if (ck) h.Cookie = ck
  return h
}

/** Fetch with hard timeout + Set-Cookie extraction (Node 18+: `headers.getSetCookie()`). */
async function fetchSetCookies(
  url: string,
  init: RequestInit,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
): Promise<{ res: Response; setCookies: string[] }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  let setCookies: string[] = []
  try {
    setCookies = (res.headers as any).getSetCookie?.() ?? []
  } catch {
    setCookies = []
  }
  return { res, setCookies }
}

/**
 * 跟随 30x 重定向链并把每一跳的 Set-Cookie 合入 jar (对齐 httpx follow_redirects
 * 的 cookie jar 行为 — 核验链路中间跳转下发的 cookie 是登录身份锚点, 一跳都不能丢)。
 */
async function fetchRedirectJar(
  url: string,
  init: RequestInit,
  jar: Map<string, string>,
  maxRedirects = 10,
): Promise<Response> {
  let current = url
  for (let i = 0; i < maxRedirects; i++) {
    const { res, setCookies } = await fetchSetCookies(current, { ...init, redirect: 'manual' })
    mergeSetCookies(jar, setCookies)
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString()
      continue
    }
    return res
  }
  throw new Error('重定向次数超限')
}

/** UTF-8 安全 base64 (纯 Web API, Node/workerd 通吃)。 */
function utf8ToBase64(str: string): string {
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(str)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)) as any)
    }
    return btoa(bin)
  }
  return Buffer.from(str, 'utf8').toString('base64')
}

/** 服务端渲染二维码 (纯 JS 内核 + SVG 字符串渲染 → data-url)。
 *
 * 为什么必须深导入 (qrcode/lib/core/qrcode + qrcode/lib/renderer/svg-tag):
 *   包入口 qrcode/lib/server.js 顶层 require png 渲染器 → pngjs → 顶层
 *   util.inherits(stream mock) — 在 Cloudflare workerd 的 unenv 层上评估期即炸
 *   ("superCtor.prototype must be of type object"), 模块评估失败逃逸 withApi,
 *   线上表现为 nitro 裸 500 "Server Error"。core/qrcode + svg-tag 是官方浏览器
 *   构建的同款组合 (browser.js 即此二者), 零 node 内建依赖, Node/workerd 通吃;
 *   SVG 产物避开 png 的 node:zlib (unenv notImplemented) — 一并免疫。
 * 产物仍为 data-url, 前端 <img :src> 无感。
 */
async function renderQrDataUrl(content: string): Promise<string> {
  const core: any = await import('qrcode/lib/core/qrcode')
  const svgTag: any = await import('qrcode/lib/renderer/svg-tag')
  const qr = core.create(content, { errorCorrectionLevel: 'L' })
  const svg: string = svgTag.render(qr, { margin: 2 })
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`
}

/** 上游异常分级包装: fetch 裸异常一律转 ApiError(502) 统一 JSON, 前端可见真实原因 */
function upstreamError(scope: string, e: any): ApiError {
  const raw = String(e?.message || e)
  const cause = /timeout|abort|timed?\s*out/i.test(raw)
    ? '上游连接超时 (网络不可达或被网关拦截)'
    : /fetch failed|network|socket|econn/i.test(raw)
        ? '上游网络不可达'
        : raw.slice(0, 200)
  return new ApiError(502, `${scope}: ${cause}`)
}

function parseTs(v: any): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  return new Date(String(v).includes('T') || String(v).includes('Z') ? v : v + 'Z').getTime() || new Date(v).getTime() || 0
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. startQrLogin — cna/m_h5_tk (降级) → loginFormData → generate.do → 落库
// ─────────────────────────────────────────────────────────────────────────────

/** 参考项目 jar 初始化的 m_h5_tk 一跳 (对齐 _get_mh5tk): GET h5api 收 cookie → md5 sign POST 一次 */
async function tryGetMh5tk(jar: Map<string, string>): Promise<void> {
  const dataStr = '{"bizScene":"home"}'
  const { setCookies } = await fetchSetCookies(API_H5_TK, { method: 'GET', headers: { ...PASSPORT_HEADERS } }, FALLBACK_TIMEOUT_MS)
  mergeSetCookies(jar, setCookies)
  const mH5Tk = jar.get('m_h5_tk') || ''
  const token = mH5Tk.includes('_') ? mH5Tk.split('_')[0] : ''
  const t = Date.now().toString()
  const sign = md5Hex(`${token}&${t}&34839810&${dataStr}`)
  const params = new URLSearchParams({
    jsv: '2.7.2',
    appKey: '34839810',
    t,
    sign,
    v: '1.0',
    type: 'originaljson',
    dataType: 'json',
    timeout: '20000',
    api: 'mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get',
    data: dataStr,
  })
  const { res } = await fetchSetCookies(
    `${API_H5_TK}?${params.toString()}`,
    { method: 'POST', headers: withCookieHeader(PASSPORT_HEADERS, jar) },
    FALLBACK_TIMEOUT_MS,
  )
  await res.text().catch(() => {})
}

/** v2.1.1 实证可用的 cna 一跳 (log.mmstat.com/eg.js, CF 可达): GET 收 cna cookie */
async function tryGetCna(jar: Map<string, string>): Promise<void> {
  const { setCookies } = await fetchSetCookies(API_CNA, { method: 'GET', headers: { ...PASSPORT_HEADERS } }, FALLBACK_TIMEOUT_MS)
  mergeSetCookies(jar, setCookies)
}

/** mini_login.htm 提取 viewData.loginFormData (对齐 _get_login_params) */
async function getLoginParams(jar: Map<string, string>): Promise<Record<string, string>> {
  const params = new URLSearchParams({
    lang: 'zh_cn',
    appName: 'xianyu',
    appEntrance: 'web',
    styleType: 'vertical',
    bizParams: '',
    notLoadSsoView: 'False',
    notKeepLogin: 'False',
    isMobile: 'False',
    qrCodeFirst: 'False',
    stie: '77',
    rnd: String(Math.random()),
  })
  const { res } = await fetchSetCookies(`${API_MINI_LOGIN}?${params.toString()}`, {
    method: 'GET',
    headers: withCookieHeader(PASSPORT_HEADERS, jar),
  })
  const html = await res.text().catch(() => '')
  const match = html.match(/window\.viewData\s*=\s*(\{.*?\});/)
  if (!match) throw new Error('获取登录参数失败: mini_login 页面无 viewData')
  let viewData: any
  try {
    viewData = JSON.parse(match[1])
  } catch {
    throw new Error('获取登录参数失败: viewData 解析失败')
  }
  const loginFormData = viewData?.loginFormData
  if (!loginFormData || typeof loginFormData !== 'object') {
    throw new Error('获取登录参数失败: 未找到 loginFormData')
  }
  const flat: Record<string, string> = {}
  for (const [k, v] of Object.entries(loginFormData)) flat[k] = v == null ? '' : String(v)
  flat.umidTag = 'SERVER'
  return flat
}

export async function startQrLogin(userId: number): Promise<{ sessionKey: string; qrUrl: string }> {
  const db = await getDb()
  // 清理 30 分钟前的陈旧会话行 (对齐参考项目 cleanup_expired_sessions)
  await db.run(`DELETE FROM qr_login_sessions WHERE created_at < datetime('now', '-30 minutes')`).catch(() => {})

  const jar = new Map<string, string>()
  // 降级跳: 失败不阻塞 passport 链 (CF 出口 h5api 被墙 / 偶发网络抖动)
  await tryGetCna(jar).catch(() => console.warn('[qr-login] cna 获取失败, 降级继续'))
  await tryGetMh5tk(jar).catch(() => console.warn('[qr-login] m_h5_tk 获取失败, 降级继续'))

  // passport 主链: 任何裸异常统一转 ApiError(502) — 上游抖动对用户是「可重试」,
  // 不该以未分类 500 的形状出现 (对齐参考项目 generate_qr_code 的 except 链文案)
  let params: Record<string, string>
  let qrUrl: string
  try {
    params = await getLoginParams(jar)

    const genUrl = `${API_GENERATE_QR}?${new URLSearchParams(params).toString()}`
    const { res, setCookies } = await fetchSetCookies(genUrl, {
      method: 'GET',
      headers: withCookieHeader(PASSPORT_HEADERS, jar),
    })
    mergeSetCookies(jar, setCookies)
    const json = (await res.json().catch(() => ({}))) as any
    const data = json?.content?.data || {}
    const qrContent = String(data.codeContent || '')
    if (!(json?.content?.success === true) || !qrContent) {
      throw new Error(`上游拒绝出码: ${JSON.stringify(json).slice(0, 300)}`)
    }
    params.t = String(data.t || '')
    params.ck = String(data.ck || '')
    qrUrl = await renderQrDataUrl(qrContent)
  } catch (e: any) {
    if (e instanceof ApiError) throw e
    throw upstreamError('获取登录二维码失败', e)
  }

  const sessionKey = 'qr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  await db.run(
    `INSERT INTO qr_login_sessions (session_key, user_id, status, qr_url, params_json, jar_json)
     VALUES (?, ?, 'waiting', ?, ?, ?)
     ON CONFLICT(session_key) DO NOTHING`,
    [sessionKey, userId, qrUrl, JSON.stringify(params), JSON.stringify(Object.fromEntries(jar))],
  ).catch((e: any) => {
    throw new Error(`保存二维码会话失败: ${e?.message || e}`)
  })
  return { sessionKey, qrUrl }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. getSessionStatus — 读库 → 驱动一步状态机 → 写库 → 返回 (轮询牵引)
// ─────────────────────────────────────────────────────────────────────────────

async function loadSession(db: any, sessionKey: string): Promise<QrSessionRow | null> {
  const r = await db.get<any>(
    `SELECT session_key, user_id, status, qr_url, cookie_value, xianyu_uid, xianyu_nick,
            error_message, params_json, jar_json, face_qr_url, verification_url, created_at, updated_at
     FROM qr_login_sessions WHERE session_key = ?`,
    [sessionKey],
  )
  if (!r) return null
  let params: Record<string, string> = {}
  let jarData: Record<string, string> = {}
  try {
    params = r.params_json ? JSON.parse(r.params_json) : {}
  } catch {}
  try {
    jarData = r.jar_json ? JSON.parse(r.jar_json) : {}
  } catch {}
  return {
    sessionKey: r.session_key,
    userId: r.user_id,
    status: (r.status || 'waiting') as QrStatus,
    qrUrl: r.qr_url || '',
    cookieValue: r.cookie_value || '',
    xianyuUid: r.xianyu_uid || '',
    xianyuNick: r.xianyu_nick || '',
    errorMessage: r.error_message || '',
    params,
    jar: new Map(Object.entries(jarData)),
    faceQrUrl: r.face_qr_url || '',
    verificationUrl: r.verification_url || '',
    createdAtMs: parseTs(r.created_at),
    updatedAtMs: parseTs(r.updated_at),
  }
}

async function saveSession(db: any, s: QrSessionRow, fields: { status?: boolean; result?: boolean; face?: boolean }): Promise<void> {
  const sets: string[] = []
  const vals: any[] = []
  if (fields.status) {
    sets.push('status = ?')
    vals.push(s.status)
  }
  if (fields.result) {
    sets.push('cookie_value = ?', 'xianyu_uid = ?', 'xianyu_nick = ?', 'error_message = ?', 'jar_json = ?')
    vals.push(s.cookieValue, s.xianyuUid, s.xianyuNick, s.errorMessage, JSON.stringify(Object.fromEntries(s.jar)))
  }
  if (fields.face) {
    sets.push('face_qr_url = ?', 'verification_url = ?', 'params_json = ?')
    vals.push(s.faceQrUrl, s.verificationUrl, JSON.stringify(s.params))
  }
  if (!sets.length) return
  sets.push('updated_at = CURRENT_TIMESTAMP')
  vals.push(s.sessionKey)
  await db.run(`UPDATE qr_login_sessions SET ${sets.join(', ')} WHERE session_key = ?`, vals).catch(() => {})
}

/** 置 success 并固定 cookie 快照 (unb 是登录完成的唯一标志, 对齐参考项目) */
function completeLogin(s: QrSessionRow, note: string): void {
  const unb = s.jar.get('unb') || ''
  if (!unb) {
    s.status = 'expired'
    s.errorMessage = '登录链路完成但未获取到账号身份'
    return
  }
  s.xianyuUid = unb
  const tracknickRaw = s.jar.get('tracknick') || ''
  try {
    s.xianyuNick = tracknickRaw ? decodeURIComponent(tracknickRaw) : ''
  } catch {
    s.xianyuNick = tracknickRaw
  }
  s.cookieValue = cookieHeader(s.jar)
  s.status = 'success'
  console.log(`[qr-login] ${note}: ${s.sessionKey}, UID: ${unb}`)
}

/**
 * 服务端自动核验链 (对齐 face_verification.py, 全程 passport 域): 提取 htoken →
 * verify_modes → identity_verify → 人脸二维码渲染。check.do 轮询由后续 status
 * 驱动 (每步一跳), 通过后跟 ivCheckLogin 收全量登录 cookie。
 */
async function runFaceVerificationChain(s: QrSessionRow, iframeUrl: string): Promise<void> {
  // 步骤1: 跟随风控跳转落到 normal_validate.htm
  const normalRes = await fetchRedirectJar(iframeUrl, { method: 'GET', headers: { ...PASSPORT_HEADERS } }, s.jar)
  const normalHtml = await normalRes.text().catch(() => '')

  // 步骤2: 提取 htoken 与下一跳 verify_modes.htm 链接
  const htoken = normalHtml.match(/htoken=([A-Za-z0-9_-]+)/)?.[1]
  if (!htoken) throw new Error('人脸验证: 未能提取 htoken')
  let verifyModesUrl = normalHtml.match(
    /window\.location\.href\s*=\s*"(https:\/\/[^"]*?\/iv\/mini\/verify_modes\.htm\?[^"]*)"/,
  )?.[1]
  if (!verifyModesUrl) throw new Error('人脸验证: 未能提取 verify_modes 链接')
  if (verifyModesUrl.endsWith('_umidfg=')) verifyModesUrl += '1'

  // 步骤3: verify_modes.htm 302 落到 identity_verify.htm
  const identityRes = await fetchRedirectJar(verifyModesUrl, { method: 'GET', headers: { ...PASSPORT_HEADERS } }, s.jar)
  const identityHtml = await identityRes.text().catch(() => '')

  // 步骤4: 提取人脸验证二维码内容并渲染 (用户手机闲鱼 App 扫码)
  const faceQrContent = identityHtml.match(/new\s+Qrcode\(\{\s*text:\s*"([^"]+)"/)?.[1]
  if (!faceQrContent) throw new Error('人脸验证: 未能提取人脸验证二维码')
  s.faceQrUrl = await renderQrDataUrl(faceQrContent)
  // htoken 存 params 供后续 check.do 驱动使用 (核验态下 query.do 不再被调用, 无副作用)
  s.params.htoken = htoken
  s.verificationUrl = iframeUrl
  console.log(`[qr-login] 人脸验证二维码已生成, 等待手机扫码: ${s.sessionKey}`)
}

/** 核验态驱动一跳: check.do 查询 → code=3 跟 ivCheckLogin 收 jar → success */
async function driveFaceVerification(s: QrSessionRow): Promise<void> {
  const htoken = s.params.htoken || ''
  if (!htoken) {
    s.status = 'expired'
    s.errorMessage = '人脸验证会话异常: 缺少 htoken'
    return
  }
  const checkHeaders = withCookieHeader(
    {
      ...PASSPORT_HEADERS,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${HOST}/iv/mini/identity_verify.htm?htoken=${htoken}`,
    },
    s.jar,
  )
  const { res } = await fetchSetCookies(`${API_FACE_CHECK}?htoken=${encodeURIComponent(htoken)}`, {
    method: 'GET',
    headers: checkHeaders,
  })
  const json = (await res.json().catch(() => ({}))) as any
  const code = String(json?.content?.code ?? '')
  if (code === '3') {
    const ivCheckUrl = String(json?.content?.url || '')
    console.log(`[qr-login] 人脸验证通过: ${s.sessionKey}`)
    if (!ivCheckUrl) {
      s.status = 'expired'
      s.errorMessage = '人脸验证通过但未获取到登录跳转'
      return
    }
    // 步骤6: 跟随 ivCheckLogin.htm 完成登录 — 登录 cookie 全部落入服务端 jar
    await fetchRedirectJar(ivCheckUrl, { method: 'GET', headers: checkHeaders }, s.jar)
    completeLogin(s, '人脸验证登录成功')
    return
  }
  if (code !== '0' && code !== '') {
    console.warn(`[qr-login] check.do code=${code}: ${s.sessionKey}`)
  }
  // code=0: 等待用户手机完成 — 不写库 (保持进入核验态的时间戳用于过期判定)
}

export interface QrPollResult {
  status: QrStatus
  qrUrl?: string
  xianyuUid?: string
  xianyuNick?: string
  cookieValue?: string
  errorMessage?: string
  /** 服务端跟随核验链提取的人脸验证二维码 (手机闲鱼 App 扫码) */
  faceQrUrl?: string
  verificationUrl?: string
}

export async function getSessionStatus(sessionKey: string): Promise<QrPollResult> {
  const db = await getDb()
  const s = await loadSession(db, sessionKey)
  if (!s) throw new ApiError(404, '二维码会话不存在')

  const now = Date.now()
  if (s.status !== 'success') {
    const expireMs = s.status === 'verification_required' ? VERIFY_EXPIRE_MS : SESSION_EXPIRE_MS
    const sinceMs = s.status === 'verification_required' ? s.updatedAtMs : s.createdAtMs
    if (sinceMs && now - sinceMs > expireMs) {
      s.status = 'expired'
      s.errorMessage = s.errorMessage || '二维码已过期'
    }
  }

  try {
    if (s.status === 'waiting' || s.status === 'scanned') {
      const { res, setCookies } = await fetchSetCookies(API_SCAN_STATUS, {
        method: 'POST',
        headers: withCookieHeader(
          { ...PASSPORT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
          s.jar,
        ),
        body: new URLSearchParams(s.params).toString(),
      })
      mergeSetCookies(s.jar, setCookies)
      const json = (await res.json().catch(() => ({}))) as any
      const qdata = json?.content?.data || {}
      const qrStatus = String(qdata.qrCodeStatus || '')

      if (qrStatus === 'CONFIRMED') {
        if (qdata.iframeRedirect === true || qdata.iframeRedirect === 'true') {
          // 风控/人脸核验: 保留本响应 cookie (身份锚点), 交给服务端核验链
          s.status = 'verification_required'
          console.log(`[qr-login] 触发身份核验, 服务端自动处理: ${s.sessionKey}`)
          await runFaceVerificationChain(s, String(qdata.iframeRedirectUrl || ''))
          await saveSession(db, s, { status: true, result: true, face: true })
        } else {
          completeLogin(s, '扫码登录成功')
          await saveSession(db, s, { status: true, result: true })
        }
      } else if (qrStatus === 'SCANED' && s.status === 'waiting') {
        s.status = 'scanned'
        await saveSession(db, s, { status: true })
      } else if (qrStatus === 'EXPIRED') {
        s.status = 'expired'
        await saveSession(db, s, { status: true, result: true })
      } else if (qrStatus !== 'NEW' && qrStatus !== 'SCANED') {
        s.status = 'cancelled'
        await saveSession(db, s, { status: true })
      }
    } else if (s.status === 'verification_required') {
      await driveFaceVerification(s)
      if (s.status !== 'verification_required') {
        await saveSession(db, s, { status: true, result: true })
      }
    }
  } catch (e: any) {
    console.error(`[qr-login] 状态驱动异常 (${s.sessionKey}): ${e?.message}`)
    // 驱动失败不改变状态 — 下一次轮询重试 (上游瞬时抖动自愈)
  }

  return {
    status: s.status,
    qrUrl: s.status === 'waiting' || s.status === 'scanned' ? s.qrUrl : undefined,
    xianyuUid: s.xianyuUid || undefined,
    xianyuNick: s.xianyuNick || undefined,
    cookieValue: s.cookieValue || undefined,
    errorMessage: s.errorMessage || undefined,
    faceQrUrl: s.faceQrUrl || undefined,
    verificationUrl: s.verificationUrl || undefined,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. cancel + helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function cancelQrSession(sessionKey: string): Promise<void> {
  const db = await getDb()
  await db
    .run(`UPDATE qr_login_sessions SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE session_key = ?`, [sessionKey])
    .catch(() => {})
}

/** Get the userId that owns a session (for ownership checks). */
export async function getSessionUserId(sessionKey: string): Promise<number | null> {
  const db = await getDb()
  const r = await db
    .get<{ user_id: number }>(`SELECT user_id FROM qr_login_sessions WHERE session_key = ?`, [sessionKey])
    .catch(() => null)
  return r?.user_id ?? null
}

function md5Hex(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex')
}
