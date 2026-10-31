/**
 * qr-login.ts — pure-HTTP xianyu (goofish) passport QR-code login client.
 *
 * Implements the multi-step passport QR login flow WITHOUT any mtop signing:
 * the passport endpoints
 *   - GET  /newlogin/qrcode/generate.do
 *   - POST /newlogin/qrcode/query.do
 *   - POST /login_token/login.do
 * DO NOT require x-s / x-mini-wua / x-sgext headers (confirmed by grepping
 * all three reference repos — see RESEARCH-QR in worklog.md). Only the
 * post-login mtop API calls need a sign, and those are not part of the
 * cookie-acquisition phase.
 *
 * State is held in a module-level in-memory `Map<string, QrSession>` (Nitro
 * is single-process; survives across requests). Status is mirrored to the
 * `qr_login_sessions` table for visibility + survival across restarts.
 *
 * Reference impl: `.refs/xianyu-auto-reply-fix/utils/qr_login_lite.py`.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

const PASSPORT_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en,zh-CN;q=0.9,zh;q=0.8,zh-TW;q=0.7,ja;q=0.6',
  'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  priority: 'u=1, i',
}

const MTOP_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'application/json',
  'Accept-Language': 'en,zh-CN;q=0.9,zh;q=0.8,zh-TW;q=0.7,ja;q=0.6',
  'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  Origin: 'https://www.goofish.com',
  Referer: 'https://www.goofish.com/',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  priority: 'u=1, i',
  'Content-Type': 'application/x-www-form-urlencoded',
}

const BIZ_PARAMS = 'taobaoBizLoginFrom=web&renderRefer=https%3A%2F%2Fwww.goofish.com%2F'

/** 核验等待上限: 人脸/滑块核验期间会话不降级, 超过此时长才判超时 */
const VERIFY_WAIT_MS = 15 * 60 * 1000
/** 核验等待期内用 loginToken 重试换 cookie 的最小间隔 (过频会加重风控) */
const LOGIN_RETRY_MS = 10 * 1000
/** 连续轮询失败判死阈值 (瞬断不杀会话, 连续失败才判) */
const MAX_POLL_ERRORS = 8

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
  /** cookie jar — name → value, mirrors `.goofish.com` + `.mmstat.com` cookies */
  jar: Map<string, string>
  cna: string
  cookie2: string
  csrf: string
  t: string
  ck: string
  qrUrl: string
  status: QrStatus
  createdAt: number
  errorMessage?: string
  /** Populated on success */
  xianyuUid?: string
  xianyuNick?: string
  cookieValue?: string
  /** Populated when status === 'verification_required' */
  iframeRedirectUrl?: string
  /** CONFIRMED 时 passport 下发的登录令牌 (核验通过后靠它换 cookie) */
  loginToken?: string
  /** 进入核验等待的时间戳 (超时判定) */
  verificationSince?: number
  /** 上次用 loginToken 换 cookie 的时间戳 (节流) */
  lastLoginAttempt?: number
  /** query.do 连续失败计数 (成功响应归零) */
  pollErrors?: number
}

/** In-memory sessions — survives across requests in single-process Nitro. */
const sessions = new Map<string, QrSession>()

/**
 * 持久化登录设备指纹 (cna, 存 system_settings)。
 * 真实浏览器的 cna 长期不变; 每次登录都现取新 cna = 每次都是「陌生设备」发起登录,
 * 闲鱼风控会升级为 ivCheckLogin 人脸二次核验。复用同一设备标识从源头降低核验触发率。
 */
async function loadPersistentCna(): Promise<string> {
  try {
    const db = await getDb()
    const row = await db.get<{ value: string }>(
      "SELECT value FROM system_settings WHERE key_name = 'qr_login_cna'",
    )
    return String(row?.value || '')
  } catch {
    return ''
  }
}

async function savePersistentCna(cna: string): Promise<void> {
  if (!cna) return
  try {
    const db = await getDb()
    await db.run(
      `INSERT INTO system_settings (key_name, value) VALUES ('qr_login_cna', ?)
       ON CONFLICT(key_name) DO UPDATE SET value = excluded.value`,
      [cna],
    )
  } catch {
    // 设置表不可用时退回每次新 cna (仅影响风控友好度, 不影响登录功能)
  }
}

/** Generate a random session key. */
function newSessionKey(): string {
  return 'qr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/** Parse a Set-Cookie list (`name=value; Path=/; Domain=...`) into name→value and merge into jar. */
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

/** Build a `a=1; b=2` cookie header string from jar. */
function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/** Merge accumulated cookies into a headers object. */
function withCookieHeader(
  extra: Record<string, string>,
  jar: Map<string, string>,
): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const ck = cookieHeader(jar)
  if (ck) h.Cookie = ck
  return h
}

/** Fetch with safe Set-Cookie extraction (Node 18+: `headers.getSetCookie()`). */
async function fetchSetCookies(
  url: string,
  init: RequestInit,
): Promise<{ res: Response; setCookies: string[] }> {
  const res = await fetch(url, init)
  let setCookies: string[] = []
  try {
    setCookies = (res.headers as any).getSetCookie?.() ?? []
  } catch {
    setCookies = []
  }
  return { res, setCookies }
}

/** Insert a row into qr_login_sessions (idempotent on session_key). */
async function persistSessionStart(s: QrSession): Promise<void> {
  try {
    const db = await getDb()
    await db.run(
      `INSERT INTO qr_login_sessions (session_key, user_id, status, qr_url)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_key) DO UPDATE SET
         status = excluded.status,
         qr_url = excluded.qr_url,
         updated_at = CURRENT_TIMESTAMP`,
      [s.sessionKey, s.userId, s.status, s.qrUrl],
    )
  } catch (e) {
    console.error('[qr-login] persistSessionStart error:', e)
  }
}

/** Update qr_login_sessions row in place. */
async function persistSessionUpdate(
  sessionKey: string,
  fields: {
    status?: string
    cookieValue?: string
    xianyuUid?: string
    xianyuNick?: string
    errorMessage?: string
  },
): Promise<void> {
  try {
    const db = await getDb()
    const sets: string[] = []
    const params: any[] = []
    if (fields.status !== undefined) {
      sets.push('status = ?')
      params.push(fields.status)
    }
    if (fields.cookieValue !== undefined) {
      sets.push('cookie_value = ?')
      params.push(fields.cookieValue)
    }
    if (fields.xianyuUid !== undefined) {
      sets.push('xianyu_uid = ?')
      params.push(fields.xianyuUid)
    }
    if (fields.xianyuNick !== undefined) {
      sets.push('xianyu_nick = ?')
      params.push(fields.xianyuNick)
    }
    if (fields.errorMessage !== undefined) {
      sets.push('error_message = ?')
      params.push(fields.errorMessage)
    }
    sets.push('updated_at = CURRENT_TIMESTAMP')
    params.push(sessionKey)
    await db.run(
      `UPDATE qr_login_sessions SET ${sets.join(', ')} WHERE session_key = ?`,
      params,
    )
  } catch (e) {
    console.error('[qr-login] persistSessionUpdate error:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. startQrLogin
// ─────────────────────────────────────────────────────────────────────────────
export async function startQrLogin(
  userId: number,
): Promise<{ sessionKey: string; qrUrl: string }> {
  const jar = new Map<string, string>()
  const sessionKey = newSessionKey()

  // (1) 设备指纹 cna: 优先复用持久化值 (同设备反复登录是正常浏览器形态, 风控友好);
  //     首次登录才从 mmstat 现取并回写持久化, 此后所有扫码都携带同一设备标识
  let cna = await loadPersistentCna()
  if (cna) {
    jar.set('cna', cna)
  } else {
    try {
      const { setCookies } = await fetchSetCookies('https://log.mmstat.com/eg.js', {
        method: 'GET',
        headers: { 'User-Agent': UA, Accept: '*/*' },
      })
      mergeSetCookies(jar, setCookies)
    } catch (e) {
      console.error('[qr-login] cna fetch error:', e)
    }
    cna = jar.get('cna') || ''
    await savePersistentCna(cna)
  }
  // cna is mirrored onto .goofish.com by the browser — the jar is flat, so we already have it.

  // (2) warm mtop feed → _m_h5_tk, _m_h5_tk_enc, cookie2
  const t1 = Date.now().toString()
  const feedUrl =
    `https://h5api.m.goofish.com/h5/mtop.taobao.idlehome.home.webpc.feed/1.0/` +
    `?jsv=2.7.2&appKey=34839810&t=${t1}&sign=&v=1.0&type=originaljson` +
    `&dataType=json&timeout=20000&api=mtop.taobao.idlehome.home.webpc.feed` +
    `&sessionOption=AutoLoginOnly&spm_cnt=a21ybx.home.0.0`
  try {
    const { res, setCookies } = await fetchSetCookies(feedUrl, {
      method: 'POST',
      headers: withCookieHeader(MTOP_HEADERS, jar),
      body: 'data=%7B%7D',
    })
    mergeSetCookies(jar, setCookies)
    await res.text().catch(() => {})
  } catch (e) {
    console.error('[qr-login] mtop feed warm error:', e)
  }
  const cookie2 = jar.get('cookie2') || ''

  // (3) mini_login.htm → XSRF-TOKEN
  const rnd = Math.random().toString(36).slice(2)
  const miniLoginUrl =
    `https://passport.goofish.com/mini_login.htm?lang=zh_cn&appName=xianyu` +
    `&appEntrance=web&styleType=vertical&bizParams=&notLoadSsoView=false` +
    `&notKeepLogin=false&isMobile=false&qrCodeFirst=false&stie=77&rnd=${rnd}`
  try {
    const { res, setCookies } = await fetchSetCookies(miniLoginUrl, {
      method: 'GET',
      headers: withCookieHeader(
        {
          ...PASSPORT_HEADERS,
          Referer: 'https://www.goofish.com/',
          'sec-fetch-site': 'same-site',
          'sec-fetch-dest': 'iframe',
          'sec-fetch-mode': 'navigate',
        },
        jar,
      ),
    })
    mergeSetCookies(jar, setCookies)
    await res.text().catch(() => {})
  } catch (e) {
    console.error('[qr-login] mini_login.htm error:', e)
  }
  // XSRF-TOKEN often URL-encoded; passport expects the decoded form in _csrf_token
  let csrf = jar.get('XSRF-TOKEN') || ''
  if (csrf) {
    try {
      csrf = decodeURIComponent(csrf)
    } catch {
      // keep as-is
    }
  }

  // (4) generate.do → qrUrl, t, ck
  const genParams = new URLSearchParams({
    appName: 'xianyu',
    fromSite: '77',
    appEntrance: 'web',
    _csrf_token: csrf,
    umidToken: '',
    hsiz: cookie2,
    bizParams: BIZ_PARAMS,
    mainPage: 'false',
    isMobile: 'false',
    lang: 'zh_CN',
    returnUrl: '',
    umidTag: 'SERVER',
  })
  const genUrl = `https://passport.goofish.com/newlogin/qrcode/generate.do?${genParams.toString()}`

  let qrUrl = ''
  let qrT = ''
  let qrCk = ''
  let genError = ''
  try {
    const { res, setCookies } = await fetchSetCookies(genUrl, {
      method: 'GET',
      headers: withCookieHeader(
        {
          ...PASSPORT_HEADERS,
          Referer: 'https://passport.goofish.com/mini_login.htm',
        },
        jar,
      ),
    })
    mergeSetCookies(jar, setCookies)
    const json = (await res.json().catch(() => ({}))) as any
    const data = json?.content?.data || {}
    qrUrl = data.codeContent || ''
    qrT = String(data.t || '')
    qrCk = String(data.ck || '')
    if (!qrUrl || !qrT || !qrCk) {
      genError = `generate.do 响应不完整: ${JSON.stringify(json).slice(0, 500)}`
    }
  } catch (e: any) {
    genError = e?.message || String(e)
  }

  if (genError) {
    const session: QrSession = {
      sessionKey,
      userId,
      jar,
      cna,
      cookie2,
      csrf,
      t: qrT,
      ck: qrCk,
      qrUrl,
      status: 'expired',
      createdAt: Date.now(),
      errorMessage: genError,
    }
    sessions.set(sessionKey, session)
    await persistSessionStart(session)
    await persistSessionUpdate(sessionKey, {
      status: 'expired',
      errorMessage: genError,
    })
    throw new ApiError(502, `生成二维码失败: ${genError}`)
  }

  const session: QrSession = {
    sessionKey,
    userId,
    jar,
    cna,
    cookie2,
    csrf,
    t: qrT,
    ck: qrCk,
    qrUrl,
    status: 'waiting',
    createdAt: Date.now(),
  }
  sessions.set(sessionKey, session)
  await persistSessionStart(session)

  return { sessionKey, qrUrl }
}

// ─────────────────────────────────────────────────────────────────────────────
// tryCompleteLogin — CONFIRMED 后用登录令牌换取正式 cookie (正常路径与核验等待期重试共用)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 用 loginToken 换取正式 cookie (login_token/login.do → 刷新 _m_h5_tk → unb 校验)。
 * 成功回 true (会话已置 success 并落库); 失败回 false (不改会话状态, 由调用方决定)。
 * 核验等待期内登录令牌保留在会话中, 用户完成人脸/滑块后由本函数的节流重试自动完成登录。
 */
async function tryCompleteLogin(session: QrSession): Promise<boolean> {
  if (!session.loginToken) return false
  // (1) login_token/login.do — 用令牌换正式登录 cookie
  try {
    const loginUrl =
      `https://passport.goofish.com/login_token/login.do` +
      `?token=${encodeURIComponent(session.loginToken)}` +
      `&subFlow=DIALOG_CHECK_LOGIN_RPC&nextCode=0018&bizScene=qrcode&confirm=true`
    const { setCookies } = await fetchSetCookies(loginUrl, {
      method: 'POST',
      headers: withCookieHeader(
        {
          ...PASSPORT_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://passport.goofish.com',
          Referer: 'https://passport.goofish.com/mini_login.htm',
        },
        session.jar,
      ),
      body: `deviceId=${encodeURIComponent(session.cna)}`,
    })
    mergeSetCookies(session.jar, setCookies)
  } catch (e) {
    console.error('[qr-login] login_token exchange error:', e)
    // 继续 — cookie 可能已随 query.do 落袋
  }

  // (2) 刷新 _m_h5_tk (登录后令牌轮换)
  try {
    const t2 = Date.now().toString()
    const navUrl =
      `https://h5api.m.goofish.com/h5/mtop.idle.web.user.page.nav/1.0/` +
      `?jsv=2.7.2&appKey=34839810&t=${t2}&sign=&v=1.0&type=originaljson` +
      `&dataType=json&timeout=20000&api=mtop.idle.web.user.page.nav` +
      `&sessionOption=AutoLoginOnly&spm_cnt=a21ybx.home.0.0`
    const { res, setCookies } = await fetchSetCookies(navUrl, {
      method: 'POST',
      headers: withCookieHeader(MTOP_HEADERS, session.jar),
      body: 'data=%7B%7D',
    })
    mergeSetCookies(session.jar, setCookies)
    await res.text().catch(() => {})
  } catch (e) {
    console.error('[qr-login] nav refresh error:', e)
  }

  // (3) unb cookie 是登录完成的唯一标志
  const unb = session.jar.get('unb') || ''
  if (!unb) return false

  const cookieValue = cookieHeader(session.jar)
  const tracknickRaw = session.jar.get('tracknick') || ''
  let xianyuNick = ''
  try {
    xianyuNick = tracknickRaw ? decodeURIComponent(tracknickRaw) : ''
  } catch {
    xianyuNick = tracknickRaw
  }

  session.status = 'success'
  session.xianyuUid = unb
  session.xianyuNick = xianyuNick
  session.cookieValue = cookieValue
  await persistSessionUpdate(session.sessionKey, {
    status: 'success',
    cookieValue,
    xianyuUid: unb,
    xianyuNick,
  })
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. pollQrStatus
// ─────────────────────────────────────────────────────────────────────────────
export interface QrPollResult {
  status: QrStatus
  qrUrl?: string
  xianyuUid?: string
  xianyuNick?: string
  cookieValue?: string
  errorMessage?: string
  iframeRedirectUrl?: string
}

export async function pollQrStatus(sessionKey: string): Promise<QrPollResult> {
  let session = sessions.get(sessionKey)

  // Restore-from-DB fallback when the in-memory session has been evicted
  // (e.g. after server restart).
  if (!session) {
    const db = await getDb()
    const row = await db.get<{
      session_key: string
      user_id: number
      status: string
      qr_url: string
      cookie_value: string | null
      xianyu_uid: string | null
      xianyu_nick: string | null
      updated_at: string | null
    }>(
      'SELECT session_key, user_id, status, qr_url, cookie_value, xianyu_uid, xianyu_nick, updated_at FROM qr_login_sessions WHERE session_key = ?',
      [sessionKey],
    )
    if (!row) throw new ApiError(404, '二维码会话不存在')
    if (row.status === 'success' && row.cookie_value) {
      return {
        status: 'success',
        qrUrl: row.qr_url || undefined,
        xianyuUid: row.xianyu_uid || undefined,
        xianyuNick: row.xianyu_nick || undefined,
        cookieValue: row.cookie_value,
      }
    }
    if (row.status === 'cancelled') return { status: 'cancelled' }
    if (row.status === 'expired') return { status: 'expired' }
    if (row.status === 'verification_required') {
      // 重启后 cookie jar 已丢, 核验无法完成 — 超过等待上限只报过期, 不无限悬挂
      const updated = Date.parse((row.updated_at || '').replace(' ', 'T') + 'Z')
      if (Number.isFinite(updated) && Date.now() - updated > VERIFY_WAIT_MS) {
        return { status: 'expired', errorMessage: '核验等待超时，请重新扫码' }
      }
      return { status: 'verification_required' }
    }
    // waiting/scanned but jar is gone — cannot continue polling
    throw new ApiError(409, '二维码会话已失效，请重新生成')
  }

  // Terminal states — short-circuit
  if (session.status === 'success') {
    return {
      status: 'success',
      xianyuUid: session.xianyuUid,
      xianyuNick: session.xianyuNick,
      cookieValue: session.cookieValue,
    }
  }
  if (session.status === 'cancelled') return { status: 'cancelled' }
  if (session.status === 'expired') {
    return { status: 'expired', errorMessage: session.errorMessage }
  }

  // 核验等待期: 会话状态绝不降级 — 唯一出口是换 cookie 成功 (success)、等待超时或用户主动关闭/重生成。
  // 手机端确认后 passport 会在核验通过前持续返回无令牌的 CONFIRMED 甚至 EXPIRED,
  // 这些响应都不得把会话打成 expired 杀掉 (用户正在新标签页做人脸核验)。
  const verifying = session.status === 'verification_required'
  if (verifying && session.verificationSince && Date.now() - session.verificationSince > VERIFY_WAIT_MS) {
    session.status = 'expired'
    session.errorMessage = '核验等待超时，请重新扫码'
    await persistSessionUpdate(sessionKey, {
      status: 'expired',
      errorMessage: session.errorMessage,
    })
    return { status: 'expired', errorMessage: session.errorMessage }
  }

  // Build the query.do body — base fields + t/ck
  const baseBody: Record<string, string> = {
    appName: 'xianyu',
    fromSite: '77',
    appEntrance: 'web',
    _csrf_token: session.csrf,
    umidToken: '',
    hsiz: session.cookie2,
    bizParams: BIZ_PARAMS,
    mainPage: 'false',
    isMobile: 'false',
    lang: 'zh_CN',
    returnUrl: '',
    umidTag: 'SERVER',
    navlanguage: 'en',
    navUserAgent: UA,
    navPlatform: 'Win32',
    isIframe: 'true',
    documentReferer: 'https://www.goofish.com/',
    defaultView: 'sms',
    deviceId: session.cna,
    t: session.t,
    ck: session.ck,
  }

  const queryUrl =
    'https://passport.goofish.com/newlogin/qrcode/query.do?appName=xianyu&fromSite=77'
  let qdata: any = {}
  try {
    const formBody = new URLSearchParams(baseBody).toString()
    const { res, setCookies } = await fetchSetCookies(queryUrl, {
      method: 'POST',
      headers: withCookieHeader(
        {
          ...PASSPORT_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://passport.goofish.com',
          Referer: 'https://passport.goofish.com/mini_login.htm',
        },
        session.jar,
      ),
      body: formBody,
    })
    mergeSetCookies(session.jar, setCookies)
    const json = (await res.json().catch(() => ({}))) as any
    qdata = json?.content?.data || {}
  } catch (e: any) {
    // 瞬断不杀会话: 单次失败保持最后已知状态, 连续失败达到阈值才判死
    session.pollErrors = (session.pollErrors || 0) + 1
    if (session.pollErrors >= MAX_POLL_ERRORS) {
      session.status = 'expired'
      session.errorMessage = e?.message || String(e)
      await persistSessionUpdate(sessionKey, {
        status: 'expired',
        errorMessage: session.errorMessage,
      })
      return { status: 'expired', errorMessage: session.errorMessage }
    }
    return verifying
      ? { status: 'verification_required', iframeRedirectUrl: session.iframeRedirectUrl }
      : { status: session.status, qrUrl: session.qrUrl }
  }
  session.pollErrors = 0

  const rawStatus = String(qdata.qrCodeStatus || '').toUpperCase()
  const iframeRedirect =
    qdata.iframeRedirect === true || qdata.iframeRedirect === 'true'

  // 登录令牌与核验链接: 每次响应都捕获 — 这是核验等待期完成登录的原料
  // (手机端确认+风控时 CONFIRMED 与 iframeRedirect 同帧下发, 令牌在核验通过前不可换 cookie)
  const incomingToken = String(qdata.token || qdata.lgToken || '')
  const tokenIsNew = !!incomingToken && incomingToken !== session.loginToken
  if (incomingToken) session.loginToken = incomingToken
  if (qdata.iframeRedirectUrl) session.iframeRedirectUrl = String(qdata.iframeRedirectUrl)

  // 核验等待期: 任何轮询响应 (CONFIRMED/EXPIRED/等待/未知) 都不改变会话状态;
  // 只按节流重试 (新令牌立即重试) 用保留的 loginToken 换 cookie — 用户完成人脸后下一次重试即成功
  if (verifying) {
    if (
      session.loginToken &&
      (tokenIsNew || !session.lastLoginAttempt || Date.now() - session.lastLoginAttempt >= LOGIN_RETRY_MS)
    ) {
      session.lastLoginAttempt = Date.now()
      if (await tryCompleteLogin(session)) {
        return {
          status: 'success',
          xianyuUid: session.xianyuUid,
          xianyuNick: session.xianyuNick,
          cookieValue: session.cookieValue,
        }
      }
    }
    return { status: 'verification_required', iframeRedirectUrl: session.iframeRedirectUrl }
  }

  // Risk-control / face verification branch — 伴随状态而非终态:
  // 前端把核验页 (ivCheckLogin.htm) 链接做成按钮, 用户点击在新标签页 (顶部框架, 第一方
  // cookie 可用; iframe 内第三方 cookie 被拦截会导致官方页报过期, 故不用 iframe)
  // 完成人脸/滑块; 会话进入核验等待, 由上方 verifying 分支节流重试换 cookie 自动完成登录
  if (iframeRedirect) {
    const isFirstVerify = session.status !== 'verification_required'
    if (isFirstVerify) session.verificationSince = Date.now()
    session.status = 'verification_required'
    if (isFirstVerify) {
      await persistSessionUpdate(sessionKey, { status: 'verification_required' })
    }
    return {
      status: 'verification_required',
      iframeRedirectUrl: session.iframeRedirectUrl,
    }
  }

  if (rawStatus === 'EXPIRED') {
    session.status = 'expired'
    await persistSessionUpdate(sessionKey, { status: 'expired' })
    return { status: 'expired' }
  }

  if (rawStatus === 'SCANNED') {
    session.status = 'scanned'
    await persistSessionUpdate(sessionKey, { status: 'scanned' })
    return { status: 'scanned', qrUrl: session.qrUrl }
  }

  if (rawStatus === 'NEW' || !rawStatus) {
    session.status = 'waiting'
    return { status: 'waiting', qrUrl: session.qrUrl }
  }

  if (rawStatus !== 'CONFIRMED') {
    // Unknown status — keep waiting, don't error out
    session.status = 'waiting'
    return { status: 'waiting', qrUrl: session.qrUrl }
  }

  // CONFIRMED — 用令牌换正式 cookie (login.do → 刷新 _m_h5_tk → unb 校验)
  if (await tryCompleteLogin(session)) {
    return {
      status: 'success',
      xianyuUid: session.xianyuUid,
      xianyuNick: session.xianyuNick,
      cookieValue: session.cookieValue,
    }
  }

  // 换 cookie 未成功: 若已持有核验链接则进入核验等待 (用户需要人脸/滑块), 完全无链接才判过期
  if (session.iframeRedirectUrl) {
    session.verificationSince = Date.now()
    session.status = 'verification_required'
    await persistSessionUpdate(sessionKey, { status: 'verification_required' })
    return { status: 'verification_required', iframeRedirectUrl: session.iframeRedirectUrl }
  }
  session.status = 'expired'
  session.errorMessage = '登录链路完成但未拿到 unb cookie'
  await persistSessionUpdate(sessionKey, {
    status: 'expired',
    errorMessage: session.errorMessage,
  })
  return { status: 'expired', errorMessage: session.errorMessage }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. cancelQrSession
// ─────────────────────────────────────────────────────────────────────────────
export async function cancelQrSession(sessionKey: string): Promise<void> {
  const session = sessions.get(sessionKey)
  if (session) {
    session.status = 'cancelled'
  }
  await persistSessionUpdate(sessionKey, { status: 'cancelled' })
}

/** Get a session from the in-memory map (if still alive). */
export function getQrSession(sessionKey: string): QrSession | undefined {
  return sessions.get(sessionKey)
}

/** Get the userId that owns a session (memory or DB fallback). */
export async function getSessionUserId(
  sessionKey: string,
): Promise<number | null> {
  const mem = sessions.get(sessionKey)
  if (mem) return mem.userId
  try {
    const db = await getDb()
    const row = await db.get<{ user_id: number }>(
      'SELECT user_id FROM qr_login_sessions WHERE session_key = ?',
      [sessionKey],
    )
    return row?.user_id ?? null
  } catch {
    return null
  }
}
