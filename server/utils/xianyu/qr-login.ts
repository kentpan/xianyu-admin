/**
 * qr-login.ts — 闲鱼扫码登录 (原样复刻 zhinianboke/xianyu-auto-reply qr_login 模块)。
 *
 * 架构对齐参考项目 manager.py + face_verification.py:
 *   - 会话纯内存 (Map), 前端 status 轮询只读内存 → 毫秒级响应
 *   - 服务端后台任务 0.8s 轮询 query.do 驱动状态机 (前端轮询与上游解耦)
 *   - 风控人脸核验由服务端自动完成: 跟随 iframeRedirectUrl 302 链提取人脸二维码,
 *     用户手机闲鱼 App 扫码 → 轮询 check.do → ivCheckLogin 收全量登录 cookie
 *     (核验全程不出服务端 cookie jar, 登录 cookie 完整, 不会 need_relogin)
 *   - 二维码服务端渲染成 PNG data-url, 前端 <img> 直显
 */
import { createHash } from 'node:crypto'
import QRCode from 'qrcode'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** 参考项目 generate_headers(): passport 系请求统一头 (h5api 请求也用同一组) */
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
const API_H5_TK = 'https://h5api.m.goofish.com/h5/mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get/1.0/'

/** 上游单请求硬超时 (防单次挂起拖死整个链路) */
const UPSTREAM_TIMEOUT_MS = 10_000
/** 二维码会话有效期 (5 分钟, 人脸核验启动时重置) */
const SESSION_EXPIRE_MS = 300_000
/** 服务端监控轮询间隔 (参考项目 0.8s) */
const MONITOR_INTERVAL_MS = 800
/** 人脸核验 check.do 轮询间隔 (参考项目 2s) */
const FACE_CHECK_INTERVAL_MS = 2_000

export type QrStatus =
  | 'waiting'
  | 'scanned'
  | 'success'
  | 'expired'
  | 'verification_required'
  | 'cancelled'

export interface QrSession {
  sessionKey: string
  userId: number
  /** cookie jar — 贯穿 generate/query/核验全链路, 核验后的登录 cookie 全部落在这里 */
  jar: Map<string, string>
  /** mini_login viewData.loginFormData — generate.do 与 query.do 的共用表单参数 */
  params: Record<string, string>
  qrUrl: string
  status: QrStatus
  createdAt: number
  errorMessage?: string
  xianyuUid?: string
  xianyuNick?: string
  cookieValue?: string
  verificationUrl?: string
  faceQrUrl?: string
}

/** In-memory sessions — survives across requests in single-process Nitro. */
const sessions = new Map<string, QrSession>()

function newSessionKey(): string {
  return 'qr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
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
): Promise<{ res: Response; setCookies: string[] }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
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

/** 服务端渲染二维码 PNG data-url (对齐参考项目 render_qr_base64) */
async function renderQrDataUrl(content: string): Promise<string> {
  return QRCode.toDataURL(content, { errorCorrectionLevel: 'L', margin: 2, width: 240 })
}

/** 会话清理: 超过 30 分钟的已完成/过期会话移出内存 */
function sweepSessions(): void {
  const now = Date.now()
  for (const [key, s] of sessions) {
    if (now - s.createdAt > 30 * 60_000) sessions.delete(key)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. startQrLogin — m_h5_tk → loginFormData → generate.do → 启动后台监控
// ─────────────────────────────────────────────────────────────────────────────

/** 步骤1: 取 m_h5_tk (对齐 _get_mh5tk): GET h5api 收 cookie → md5 sign POST 一次 */
async function getMh5tk(session: QrSession): Promise<void> {
  const dataStr = '{"bizScene":"home"}'
  const { setCookies } = await fetchSetCookies(API_H5_TK, { method: 'GET', headers: { ...PASSPORT_HEADERS } })
  mergeSetCookies(session.jar, setCookies)
  const mH5Tk = session.jar.get('m_h5_tk') || ''
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
  const { res } = await fetchSetCookies(`${API_H5_TK}?${params.toString()}`, {
    method: 'POST',
    headers: withCookieHeader(PASSPORT_HEADERS, session.jar),
  })
  await res.text().catch(() => {})
}

/** 步骤2: mini_login.htm 提取 viewData.loginFormData (对齐 _get_login_params) */
async function getLoginParams(session: QrSession): Promise<void> {
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
    headers: withCookieHeader(PASSPORT_HEADERS, session.jar),
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
  session.params = flat
}

export async function startQrLogin(userId: number): Promise<{ sessionKey: string; qrUrl: string }> {
  sweepSessions()
  const session: QrSession = {
    sessionKey: newSessionKey(),
    userId,
    jar: new Map(),
    params: {},
    qrUrl: '',
    status: 'waiting',
    createdAt: Date.now(),
  }
  sessions.set(session.sessionKey, session)

  try {
    await getMh5tk(session)
    await getLoginParams(session)

    const genUrl = `${API_GENERATE_QR}?${new URLSearchParams(session.params).toString()}`
    const { res, setCookies } = await fetchSetCookies(genUrl, {
      method: 'GET',
      headers: withCookieHeader(PASSPORT_HEADERS, session.jar),
    })
    mergeSetCookies(session.jar, setCookies)
    const json = (await res.json().catch(() => ({}))) as any
    const data = json?.content?.data || {}
    const qrContent = String(data.codeContent || '')
    if (!(json?.content?.success === true) || !qrContent) {
      throw new Error(`获取登录二维码失败: ${JSON.stringify(json).slice(0, 300)}`)
    }
    session.params.t = String(data.t || '')
    session.params.ck = String(data.ck || '')
    session.qrUrl = await renderQrDataUrl(qrContent)

    // 服务端后台监控驱动状态机 (对齐 _monitor_qr_status 后台任务)
    void monitorQrStatus(session.sessionKey)
    return { sessionKey: session.sessionKey, qrUrl: session.qrUrl }
  } catch (e: any) {
    session.status = 'expired'
    session.errorMessage = e?.message || String(e)
    sessions.delete(session.sessionKey)
    throw new Error(`生成二维码失败: ${session.errorMessage}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. monitorQrStatus — 服务端 0.8s 轮询 query.do (CONFIRMED → success / 核验)
// ─────────────────────────────────────────────────────────────────────────────

async function monitorQrStatus(sessionKey: string): Promise<void> {
  const session = sessions.get(sessionKey)
  if (!session) return
  while (Date.now() - session.createdAt < SESSION_EXPIRE_MS) {
    if (!sessions.has(sessionKey) || session.status === 'cancelled') return
    if (session.status === 'success' || session.status === 'expired') return
    try {
      const { res, setCookies } = await fetchSetCookies(API_SCAN_STATUS, {
        method: 'POST',
        headers: withCookieHeader(
          { ...PASSPORT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
          session.jar,
        ),
        body: new URLSearchParams(session.params).toString(),
      })
      mergeSetCookies(session.jar, setCookies)
      const json = (await res.json().catch(() => ({}))) as any
      const qdata = json?.content?.data || {}
      const qrStatus = String(qdata.qrCodeStatus || '')
      const redirectUrl = qdata.iframeRedirectUrl ? String(qdata.iframeRedirectUrl) : ''

      if (qrStatus === 'CONFIRMED') {
        if (qdata.iframeRedirect === true || qdata.iframeRedirect === 'true') {
          // 风控/人脸核验: 保留本响应 cookie (身份锚点), 重置有效期窗口,
          // 交给服务端人脸核验任务完成后自动登录 (对齐参考项目)
          session.status = 'verification_required'
          session.verificationUrl = redirectUrl
          session.createdAt = Date.now()
          console.log(`[qr-login] 触发身份核验, 服务端自动处理: ${sessionKey}`)
          await runFaceVerification(sessionKey, redirectUrl)
          return
        }
        completeLogin(session, '扫码登录成功')
        return
      }
      if (qrStatus === 'SCANED' && session.status === 'waiting') {
        session.status = 'scanned'
      } else if (qrStatus === 'EXPIRED') {
        session.status = 'expired'
        return
      } else if (qrStatus !== 'NEW' && qrStatus !== 'SCANED') {
        session.status = 'cancelled'
        return
      }
    } catch (e: any) {
      console.error(`[qr-login] 轮询异常 (${sessionKey}): ${e?.message}`)
      await sleep(2_000)
      continue
    }
    await sleep(MONITOR_INTERVAL_MS)
  }
  if (session.status !== 'success') {
    session.status = 'expired'
    session.errorMessage = '二维码已过期'
  }
}

/** 置 success 并固定 cookie 快照 (unb 是登录完成的唯一标志) */
function completeLogin(session: QrSession, note: string): void {
  const unb = session.jar.get('unb') || ''
  if (!unb) {
    session.status = 'expired'
    session.errorMessage = '登录链路完成但未获取到账号身份'
    return
  }
  session.xianyuUid = unb
  const tracknickRaw = session.jar.get('tracknick') || ''
  try {
    session.xianyuNick = tracknickRaw ? decodeURIComponent(tracknickRaw) : ''
  } catch {
    session.xianyuNick = tracknickRaw
  }
  session.cookieValue = cookieHeader(session.jar)
  session.status = 'success'
  console.log(`[qr-login] ${note}: ${session.sessionKey}, UID: ${unb}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. runFaceVerification — 服务端自动核验链 (对齐 face_verification.py)
// ─────────────────────────────────────────────────────────────────────────────

async function runFaceVerification(sessionKey: string, iframeUrl: string): Promise<void> {
  const session = sessions.get(sessionKey)
  if (!session) return
  try {
    // 步骤1: 跟随风控跳转落到 normal_validate.htm
    const normalRes = await fetchRedirectJar(iframeUrl, { method: 'GET', headers: { ...PASSPORT_HEADERS } }, session.jar)
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
    const identityRes = await fetchRedirectJar(
      verifyModesUrl,
      { method: 'GET', headers: { ...PASSPORT_HEADERS } },
      session.jar,
    )
    const identityHtml = await identityRes.text().catch(() => '')

    // 步骤4: 提取人脸验证二维码内容并渲染 (用户手机闲鱼 App 扫码)
    const faceQrContent = identityHtml.match(/new\s+Qrcode\(\{\s*text:\s*"([^"]+)"/)?.[1]
    if (!faceQrContent) throw new Error('人脸验证: 未能提取人脸验证二维码')
    session.faceQrUrl = await renderQrDataUrl(faceQrContent)
    console.log(`[qr-login] 人脸验证二维码已生成, 等待手机扫码: ${sessionKey}`)

    // 步骤5: 轮询 check.do 直到手机端完成人脸 (code=3)
    const checkHeaders = withCookieHeader(
      {
        ...PASSPORT_HEADERS,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${HOST}/iv/mini/identity_verify.htm?htoken=${htoken}`,
      },
      session.jar,
    )
    let ivCheckUrl = ''
    while (Date.now() - session.createdAt < SESSION_EXPIRE_MS) {
      if (!sessions.has(sessionKey) || session.status === 'cancelled') return
      try {
        const { res } = await fetchSetCookies(`${API_FACE_CHECK}?htoken=${encodeURIComponent(htoken)}`, {
          method: 'GET',
          headers: checkHeaders,
        })
        const json = (await res.json().catch(() => ({}))) as any
        const code = String(json?.content?.code ?? '')
        if (code === '3') {
          ivCheckUrl = String(json?.content?.url || '')
          console.log(`[qr-login] 人脸验证通过: ${sessionKey}`)
          break
        }
        if (code !== '0' && code !== '') {
          console.warn(`[qr-login] check.do code=${code}: ${sessionKey}`)
        }
      } catch (e: any) {
        console.warn(`[qr-login] 人脸验证轮询异常: ${sessionKey}, ${e?.message}`)
      }
      await sleep(FACE_CHECK_INTERVAL_MS)
    }
    if (!ivCheckUrl) {
      session.status = 'expired'
      session.errorMessage = '人脸验证超时或未完成'
      return
    }

    // 步骤6: 跟随 ivCheckLogin.htm 完成登录 — 登录 cookie 全部落入服务端 jar
    await fetchRedirectJar(ivCheckUrl, { method: 'GET', headers: checkHeaders }, session.jar)
    completeLogin(session, '人脸验证登录成功')
    if (session.status !== 'success') {
      console.warn(`[qr-login] 人脸验证完成但未获取到 unb: ${sessionKey}`)
    }
  } catch (e: any) {
    console.error(`[qr-login] 人脸验证处理失败 (${sessionKey}): ${e?.message}`)
    session.status = 'expired'
    session.errorMessage = e?.message || '人脸验证处理失败'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. getSessionStatus — 纯内存读 (零上游请求, status 端点毫秒级响应)
// ─────────────────────────────────────────────────────────────────────────────

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
  const session = sessions.get(sessionKey)
  if (!session) throw new ApiError(404, '二维码会话不存在')
  if (Date.now() - session.createdAt > SESSION_EXPIRE_MS && session.status !== 'success') {
    session.status = 'expired'
    session.errorMessage = session.errorMessage || '二维码已过期'
  }
  return {
    status: session.status,
    qrUrl: session.status === 'waiting' || session.status === 'scanned' ? session.qrUrl : undefined,
    xianyuUid: session.xianyuUid,
    xianyuNick: session.xianyuNick,
    cookieValue: session.cookieValue,
    errorMessage: session.errorMessage,
    faceQrUrl: session.faceQrUrl,
    verificationUrl: session.verificationUrl,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. cancel + helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function cancelQrSession(sessionKey: string): Promise<void> {
  const session = sessions.get(sessionKey)
  if (session) {
    session.status = 'cancelled'
    // 从内存移除, 监控/核验循环经 sessions.has 检查自行退出
    sessions.delete(sessionKey)
  }
}

/** Get the userId that owns a session (for ownership checks). */
export function getSessionUserId(sessionKey: string): number | null {
  return sessions.get(sessionKey)?.userId ?? null
}

function md5Hex(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
