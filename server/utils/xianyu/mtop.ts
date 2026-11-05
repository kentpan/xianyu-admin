/**
 * mtop.ts — 闲鱼 (goofish) mtop API 调用客户端。
 *
 * 统一封装：
 *  - cookie 字符串解析 / 合并
 *  - mtop sign 生成 (md5(token + "&" + t + "&" + appKey + "&" + data))
 *  - mtopCall 通用调用 (自动处理 _m_h5_tk 轮换、token 过期重试)
 *  - fetchItemList / polishItem 业务封装
 *
 * 所有 mtop 端点均使用同一套 md5 sign, 无需 AWSC x-s/x-mini-wua/x-sgext。
 *
 * 参考:
 *  - .refs/xianyu-auto-reply/common/utils/xianyu_utils.py (sign)
 *  - .refs/xianyu-auto-reply/common/utils/item_info_manager.py (item list)
 *  - .refs/xianyu-auto-reply/scheduler/app/services/scheduler/polish_task.py (擦亮)
 */
import crypto from 'node:crypto'
import { relayMtopRequest } from './gateway'
import { parseLosslessJson } from './lossless-json'

/** 闲鱼 H5 appKey (全项目硬编码值)。 */
const APP_KEY = '34839810'

/** mtop 单请求硬超时 (上游参数自身约定 20000ms; 防不可达网络下 fetch 永久挂起拖死引擎) */
const MTOP_TIMEOUT_MS = 20_000

/** mtop 通用请求头。 */
const MTOP_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en,zh-CN;q=0.9,zh;q=0.8',
  'Content-Type': 'application/x-www-form-urlencoded',
  Origin: 'https://www.goofish.com',
  Referer: 'https://www.goofish.com/',
}

/** 把 cookie 字符串 ("a=1; b=2") 解析为 Map。 */
export function parseCookieStr(cookieStr: string): Map<string, string> {
  const jar = new Map<string, string>()
  if (!cookieStr) return jar
  for (const part of cookieStr.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k) jar.set(k, v)
  }
  return jar
}

/** 从 cookie_id ("xy_2214722801206") 提取账号 uid (去 xy_ 前缀)。 */
export function cookieIdUid(cookieId: string): string {
  const id = String(cookieId || '')
  return id.startsWith('xy_') ? id.slice(3) : id
}

/**
 * Cookie 会话身份校验: cookie 内 unb (淘宝账号 uid) 必须与账号 id 一致。
 *
 * 背景 (线上实锤事故): sold.get 等卖家接口按「请求 Cookie 的会话」返回数据 ——
 * 当 cookies 表里存的 Cookie 实际属于另一个账号 (手动粘贴串号 / 共享会话 /
 * 多点登录被顶号后旧凭证残留) 时, 卖家订单列表拉回来的全是他人店铺的订单,
 * 且被静默 upsert 到本账号名下。此校验在拉单入口拦截串号 Cookie, 让问题
 * 显性报错而不是静默污染订单库。
 *
 * @returns 串号错误文案; '' = 通过 (unb 缺失的极旧 cookie 无法判定, 放行)
 */
export function cookieIdentityMismatch(cookieId: string, cookieStr: string): string {
  const unb = parseCookieStr(cookieStr).get('unb') || ''
  const uid = cookieIdUid(cookieId)
  if (!unb || !uid) return ''
  if (unb !== uid) {
    return `Cookie 身份与账号不符 (cookie unb=${unb}, 账号 ${cookieId}) — Cookie 属于其他账号会话, 已拦截同步防串号; 请到「账号管理」删除该账号后重新扫码登录`
  }
  return ''
}

/** 把 jar 序列化为 cookie 字符串。 */
export function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/** 把 Set-Cookie 列表合并进 jar。 */
export function mergeSetCookies(jar: Map<string, string>, setCookieList: string[]): void {
  for (const sc of setCookieList) {
    const pair = sc.split(';', 1)[0]
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (name) jar.set(name, value)
  }
}

/** 提取 response 的 Set-Cookie (Node 18+)。 */
function getSetCookies(res: Response): string[] {
  try {
    return (res.headers as any).getSetCookie?.() ?? []
  } catch {
    return []
  }
}

/** mtop 响应 JSON 宽松解析 (空体/非 JSON 返空对象, 与 res.json().catch 同语义)。
 *  无损解析: 超安全整数范围的订单号等数字字面量按原文保留为字符串 (订单号精度丢失根治点)。 */
function parseMtopJson(text: string): any {
  try {
    return parseLosslessJson(text)
  } catch {
    return {}
  }
}

/** 请求载荷里的 ID 数值化: 能无损往返才转 number, 否则原样字符串 (避免 Number() 精度丢失)。 */
function numericIdOrSelf(v: unknown): number | string {
  const s = String(v ?? '').trim()
  if (!s) return 0
  const num = Number(s)
  return Number.isSafeInteger(num) && String(num) === s ? num : s
}

/**
 * 平台错误/传输异常 → 一眼清的人话原因 (v2.1.19):
 * 回复决策日志/发货失败留痕/拉单报错统一由本函数翻译 — 原始错误码保留在括号内供深度排查,
 * 人话在前让「Cookie 失效/风控/订单状态不对/代理不在线」无需查表即可定位处置动作。
 * 识别不了的原样返回 (不编造原因); 已含人话翻译的输入幂等 (原始码子串仍在, 不重复拼接)。
 */
export function describeMtopFailure(raw: string): string {
  const s = String(raw || '')
  if (!s) return ''
  if (/SESSION_EXPIRED|SESSION_OUT|NOTLOGGEDIN|NOT_LOGIN|FAIL_SYS_ACCESS_TOKEN|未登录|登录态失效|login\s*required/i.test(s))
    return 'Cookie 已失效 (登录会话过期), 需要到「账号管理」重新扫码登录'
  if (/FAIL_SYS_TOKEN_EXOIRED|FAIL_SYS_TOKEN_EXPIRED/i.test(s))
    return '签名令牌 (_m_h5_tk) 过期且轮换重试仍失败, 请到「账号管理」重新扫码登录'
  if (/FAIL_SYS_USER_VALIDATE|RGV587|punish|x5sec|验证码|滑块/i.test(s))
    return '触发平台风控 (滑块/身份验证), 已按冷却自动退避; 持续出现请到「账号管理」检查账号状态'
  if (/ORDER_STATUS_ERROR|订单状态不正确|ORDER_NOT_EXIST|订单不存在/i.test(s))
    return '平台拒绝: 订单状态不正确 (可能未付款/已关闭/已退款, 或发货早于平台状态同步)'
  if (/ILLEGAL_ACCESS|FORBIDDEN|无权限|PERMISSION/i.test(s))
    return '平台拒绝: 当前会话无此操作权限 (常见为 Cookie 会话权限不足)'
  if (/TIMEOUT|TimeoutError|aborted?|ETIMEDOUT/i.test(s))
    return '网络请求超时 (代理模式请检查代理网关/任务通道在线状态; 直连模式请检查服务器出口网络)'
  if (/fetch\s*failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket\s*hang|network|EPROTO/i.test(s))
    return '网络连接失败 (代理模式请检查代理在线状态; 直连模式请检查服务器出口网络)'
  return ''
}

/** 组合输出: 「人话原因 (原始错误)」— 人话一眼清, 原始码不丢; 无匹配人话时原样返回。
 *  幂等守卫: 输入已是「人话前置」形态时原样返回, 绝不二次包裹 (链路上游已翻译的文本
 *  再次经过翻译点 <如拉单 retMsg → 异常透传> 不产生嵌套括号)。 */
export function mtopFailMessage(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return '未知错误'
  const reason = describeMtopFailure(s)
  if (!reason) return s
  if (s.startsWith(reason)) return s
  return `${reason} (${s.slice(0, 100)})`
}

/**
 * mtop 单次 HTTP 传输层: 独立代理「POST 透传网关」优先。
 *
 * 引擎行登记了 host:port (isGatewayMode) 时, 请求原样 POST 给代理网关由可达闲鱼的
 * 机器转发 (CF Pages 出口到 h5api 被墙, 直连必 500 超时 — 与 H5 扫码登录同一可达性
 * 思路); 未登记/库不可用时返回 null → 本机直连 (原语义)。
 * sign / _m_h5_tk 轮换 / token 过期重试等业务逻辑全部留在本文件, 网关零业务逻辑。
 */
async function mtopFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<{ status: number; text: string; setCookie: string[] }> {
  // (v2.1.6) 网关失败不再直接抛错: 曾致发货决策整体异常 (占位被删, 代理无限重报,
  // 不发货无日志死循环)。回退本机直连兜底: CF 直连被墙时 20s 超时后决策仍能完成
  // 并落 delivery_failed 日志, 由代理重报自愈; 网关正常/本地引擎时行为不变。
  let relayed: Awaited<ReturnType<typeof relayMtopRequest>> = null
  try {
    relayed = await relayMtopRequest(url, init)
  } catch {
    relayed = null
  }
  if (relayed) return relayed
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(MTOP_TIMEOUT_MS),
  })
  return { status: res.status, text: await res.text(), setCookie: getSetCookies(res) }
}

/**
 * 生成 mtop sign。
 * sign = md5(token + "&" + t + "&" + appKey + "&" + data)
 * 其中 token = `_m_h5_tk` cookie 第一段 (下划线前部分)。
 */
export function generateSign(token: string, t: string, data: string): string {
  const msg = `${token}&${t}&${APP_KEY}&${data}`
  return crypto.createHash('md5').update(msg).digest('hex')
}

/** 从 jar 中提取 _m_h5_tk 的 token 部分 (下划线前)。 */
function mtopToken(jar: Map<string, string>): string {
  const tk = jar.get('_m_h5_tk') || ''
  return tk.split('_')[0] || ''
}

/**
 * mtop HTTP 传输层抽象: 默认 mtopFetch (代理透传网关优先 → 本机直连)。
 * 任务通道 (order-task) 注入自己的实现: 把请求打包为 http_fetch 任务由代理原样
 * 转发 — sign/轮换/token 重试等业务逻辑仍全部留在本模块, 传输通道可插拔。
 */
export type MtopTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text: string; setCookie: string[] }>

/** mtop 调用结果。 */
export interface MtopResult<T = any> {
  data: T
  /** 调用后最新的 cookie 字符串 (可能含轮换后的 _m_h5_tk)。 */
  cookieStr: string
  /** 原始响应。 */
  raw: any
}

/**
 * 调用一个 mtop 接口。
 *
 * @param api     mtop API 名, 如 "mtop.idle.web.xyh.item.list"
 * @param data    请求 data 对象 (会被 JSON.stringify 成紧凑 JSON)
 * @param cookieStr  当前账号的 cookie 字符串
 * @param opts    可选: v (版本, 默认 "1.0"), method (默认 POST)
 * @returns MtopResult (含轮换后的 cookie)
 */
export async function mtopCall<T = any>(
  api: string,
  data: object,
  cookieStr: string,
  opts: { v?: string; method?: string; headers?: Record<string, string>; extraParams?: Record<string, string>; transport?: MtopTransport } = {},
): Promise<MtopResult<T>> {
  const v = opts.v || '1.0'
  const method = opts.method || 'POST'
  const jar = parseCookieStr(cookieStr)

  const dataStr = JSON.stringify(data)
  const t = String(Date.now())
  const sign = generateSign(mtopToken(jar), t, dataStr)

  const url = `https://h5api.m.goofish.com/h5/${api}/${v}/`
  const params = new URLSearchParams({
    jsv: '2.7.2',
    appKey: APP_KEY,
    t,
    sign,
    v,
    type: 'originaljson',
    dataType: 'json',
    timeout: '20000',
    api,
    sessionOption: 'AutoLoginOnly',
    spm_cnt: 'a21ybx.home.0.0',
    ...opts.extraParams,
  })
  const body = `data=${encodeURIComponent(dataStr)}`

  const transport = opts.transport ?? mtopFetch
  const res = await transport(`${url}?${params.toString()}`, {
    method,
    headers: { ...MTOP_HEADERS, ...opts.headers, Cookie: cookieHeader(jar) },
    body: method === 'POST' ? body : undefined,
  })

  // 合并轮换后的 cookie (尤其是 _m_h5_tk)
  mergeSetCookies(jar, res.setCookie)
  const raw = parseMtopJson(res.text)

  // token 过期: FAIL_SYS_TOKEN_EXOIRED (闲鱼官方拼写错误, 含 O) 或 FAIL_SYS_TOKEN_EXPIRED
  const retStr = Array.isArray(raw?.ret) ? raw.ret[0] : ''
  if (retStr.includes('FAIL_SYS_TOKEN_EXOIRED') || retStr.includes('FAIL_SYS_TOKEN_EXPIRED')) {
    // 用轮换后的 _m_h5_tk 重试一次
    const newCookieStr = cookieHeader(jar)
    const newToken = mtopToken(jar)
    const newSign = generateSign(newToken, t, dataStr)
    const retryParams = new URLSearchParams({
      jsv: '2.7.2',
      appKey: APP_KEY,
      t,
      sign: newSign,
      v,
      type: 'originaljson',
      dataType: 'json',
      timeout: '20000',
      api,
      sessionOption: 'AutoLoginOnly',
      spm_cnt: 'a21ybx.home.0.0',
      ...opts.extraParams,
    })
    const retryRes = await transport(`${url}?${retryParams.toString()}`, {
      method,
      headers: { ...MTOP_HEADERS, ...opts.headers, Cookie: newCookieStr },
      body: method === 'POST' ? body : undefined,
    })
    mergeSetCookies(jar, retryRes.setCookie)
    const retryRaw = parseMtopJson(retryRes.text)
    return {
      data: retryRaw?.data ?? ({} as T),
      cookieStr: cookieHeader(jar),
      raw: retryRaw,
    }
  }

  return {
    data: raw?.data ?? ({} as T),
    cookieStr: cookieHeader(jar),
    raw,
  }
}

// ============ 业务封装 ============

/** 商品列表项 (从 mtop 响应映射)。 */
export interface XianyuItem {
  item_id: string
  item_title: string
  item_price: string
  item_category: string
  item_description: string
  pic_url: string
  status: string
}

/**
 * 拉取一个闲鱼账号的全部在售商品 (分页循环)。
 *
 * @param cookieStr  账号 cookie 字符串
 * @param userId     unb (闲鱼数字 uid)
 * @param maxPages   最大页数 (防失控, 默认 10)
 * @returns { items, finalCookieStr } — finalCookieStr 含轮换后的 _m_h5_tk, 需回写 DB
 */
export async function fetchItemList(
  cookieStr: string,
  userId: string,
  maxPages = 10,
): Promise<{ items: XianyuItem[]; finalCookieStr: string }> {
  const items: XianyuItem[] = []
  let curCookie = cookieStr
  const pageSize = 20

  for (let page = 1; page <= maxPages; page++) {
    const r = await mtopCall<any>(
      'mtop.idle.web.xyh.item.list',
      {
        needGroupInfo: false,
        pageNumber: page,
        pageSize,
        groupName: '在售',
        groupId: '58877261',
        defaultGroup: true,
        userId: String(userId),
      },
      curCookie,
    )
    curCookie = r.cookieStr

    const cardList = r.data?.cardList || r.data?.data?.cardList || []
    if (!Array.isArray(cardList) || cardList.length === 0) break

    for (const card of cardList) {
      const d = card.cardData || card.data || card
      const id = String(d.id || d.itemId || '')
      if (!id || id.startsWith('auto_')) continue // 跳过系统占位
      items.push({
        item_id: id,
        item_title: d.title || '',
        item_price: d.priceInfo?.price || d.price || '',
        item_category: String(d.categoryId || d.category || ''),
        item_description: d.desc || d.description || '',
        pic_url: d.picUrl || d.mainPic || '',
        status: d.status || d.itemStatus || '',
      })
    }
    if (cardList.length < pageSize) break
  }

  return { items, finalCookieStr: curCookie }
}

/** 擦亮结果。 */
export interface PolishResult {
  success: boolean
  message: string
  /** 是否今日已擦亮 (视为成功)。 */
  alreadyPolished: boolean
  finalCookieStr: string
}

/**
 * 擦亮一个宝贝 (提升搜索排名)。
 *
 * 真实实现 (照搬 .refs/xianyu-auto-reply scheduler/polish_task.py):
 *  - URL 路径版本: /1.0/ (注意: 不是 2.0!)
 *  - params v=2.0 (查询参数版本, 与 URL 路径版本不同)
 *  - 额外参数: accountSite=xianyu, spm_cnt, spm_pre, log_id
 *  - 成功判断: ret[0]=='SUCCESS::调用成功' 或 'FAIL_BIZ_IDLEITEM_POLISH_AGAIN'(今日已擦亮)
 *
 * 擦亮效果说明:
 *  - 擦亮是提升商品在搜索结果中的排名, 不是改变商品状态
 *  - 每个商品每天只能擦亮一次, 重复擦亮返回 IDLEITEM_POLISH_AGAIN
 *  - 手机端在"我的发布"可查看商品擦亮时间; 搜索排名提升需等待几分钟生效
 *
 * @param cookieStr  账号 cookie
 * @param itemId     宝贝 id
 */
export async function polishItem(cookieStr: string, itemId: string): Promise<PolishResult> {
  const jar = parseCookieStr(cookieStr)
  const token = (jar.get('_m_h5_tk') || '').split('_')[0]
  if (!token) {
    return { success: false, message: 'Cookie 中缺少 _m_h5_tk 令牌, 请重新扫码登录', alreadyPolished: false, finalCookieStr: cookieStr }
  }

  const t = String(Date.now())
  const data = { itemId: String(itemId) }
  const dataStr = JSON.stringify(data)
  const sign = generateSign(token, t, dataStr)

  // 关键: URL 路径用 1.0, params v=2.0 (照搬参考代码)
  const params = new URLSearchParams({
    jsv: '2.7.2',
    appKey: APP_KEY,
    t,
    sign,
    v: '2.0',
    type: 'originaljson',
    accountSite: 'xianyu',
    dataType: 'json',
    timeout: '20000',
    api: 'mtop.taobao.idle.item.polish',
    sessionOption: 'AutoLoginOnly',
    spm_cnt: 'a21ybx.item.0.0',
    spm_pre: 'a21ybx.personal.feeds.1.42f86ac21eZ9zd',
    log_id: '42f86ac21eZ9zd',
  })

  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-language': 'en,zh-CN;q=0.9,zh;q=0.8',
    'cache-control': 'no-cache',
    'content-type': 'application/x-www-form-urlencoded',
    pragma: 'no-cache',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Win32"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    cookie: cookieStr,
    Referer: 'https://www.goofish.com/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }

  let raw: any = {}
  let newCookieStr = cookieStr
  try {
    const res = await mtopFetch(`https://h5api.m.goofish.com/h5/mtop.taobao.idle.item.polish/1.0/?${params.toString()}`, {
      method: 'POST',
      headers,
      body: `data=${encodeURIComponent(dataStr)}`,
    })
    // 合并轮换后的 cookie (尤其是 _m_h5_tk)
    mergeSetCookies(jar, res.setCookie)
    newCookieStr = cookieHeader(jar)
    raw = parseMtopJson(res.text)
  } catch (e: any) {
    return { success: false, message: `网络请求失败: ${e.message}`, alreadyPolished: false, finalCookieStr: newCookieStr }
  }

  const retStr = Array.isArray(raw?.ret) ? raw.ret[0] : ''

  // 令牌过期重试一次 (用轮换后的 _m_h5_tk)
  if (retStr.includes('FAIL_SYS_TOKEN_EXOIRED') || retStr.includes('FAIL_SYS_TOKEN_EXPIRED')) {
    const newToken = (jar.get('_m_h5_tk') || '').split('_')[0]
    if (newToken && newToken !== token) {
      const t2 = String(Date.now())
      const sign2 = generateSign(newToken, t2, dataStr)
      const params2 = new URLSearchParams(params)
      params2.set('t', t2)
      params2.set('sign', sign2)
      try {
        const res2 = await mtopFetch(`https://h5api.m.goofish.com/h5/mtop.taobao.idle.item.polish/1.0/?${params2.toString()}`, {
          method: 'POST',
          headers: { ...headers, cookie: newCookieStr },
          body: `data=${encodeURIComponent(dataStr)}`,
        })
        mergeSetCookies(jar, res2.setCookie)
        newCookieStr = cookieHeader(jar)
        raw = parseMtopJson(res2.text)
      } catch {}
      const ret2 = Array.isArray(raw?.ret) ? raw.ret[0] : ''
      if (ret2.includes('SUCCESS')) {
        return { success: true, message: '擦亮成功', alreadyPolished: false, finalCookieStr: newCookieStr }
      }
      if (ret2.includes('IDLEITEM_POLISH_AGAIN') || ret2.includes('已经擦亮')) {
        return { success: true, message: '今日已擦亮过, 每个商品每天限擦亮一次', alreadyPolished: true, finalCookieStr: newCookieStr }
      }
      return { success: false, message: ret2 || '擦亮失败', alreadyPolished: false, finalCookieStr: newCookieStr }
    }
  }

  // SUCCESS::调用成功
  if (retStr.includes('SUCCESS')) {
    return { success: true, message: '擦亮成功, 搜索排名将在几分钟内提升', alreadyPolished: false, finalCookieStr: newCookieStr }
  }
  // IDLEITEM_POLISH_AGAIN / 宝贝已经擦亮过了 — 今日已擦亮, 视为成功
  if (retStr.includes('IDLEITEM_POLISH_AGAIN') || retStr.includes('已经擦亮')) {
    return { success: true, message: '今日已擦亮过, 每个商品每天限擦亮一次', alreadyPolished: true, finalCookieStr: newCookieStr }
  }
  // 下架商品
  if (retStr.includes('UNSUPPORTED_ITEM_STATUS') || retStr.includes('已下架')) {
    return { success: false, message: '商品已下架, 不支持擦亮', alreadyPolished: false, finalCookieStr: newCookieStr }
  }
  return {
    success: false,
    message: retStr || '擦亮失败',
    alreadyPolished: false,
    finalCookieStr: newCookieStr,
  }
}

// ============ 监听引擎业务封装 (语义对齐 butler) ============

/** 商品详情 (mtop.taobao.idle.pc.detail 响应映射)。 */
export interface XianyuItemDetail {
  item_id: string
  item_title: string
  item_desc: string
  item_price: string
  pic_url: string
}

/**
 * 拉取单个商品详情 (语义对齐 butler get_item_info, api=mtop.taobao.idle.pc.detail)。
 * 用于发货前商品归属校验失败时按需补齐 item_info, 以及回复链商品上下文。
 *
 * @returns { detail, finalCookieStr } — detail 为 null 表示未取到 (风控/下架/非本账号商品)
 */
export async function fetchItemDetail(cookieStr: string, itemId: string): Promise<{ detail: XianyuItemDetail | null; finalCookieStr: string }> {
  if (!itemId) return { detail: null, finalCookieStr: cookieStr }
  const r = await mtopCall<any>('mtop.taobao.idle.pc.detail', { itemId: String(itemId) }, cookieStr, {
    method: 'POST',
  })
  const retStr = Array.isArray(r.raw?.ret) ? r.raw.ret.join(' ') : ''
  if (!retStr.includes('SUCCESS')) return { detail: null, finalCookieStr: r.cookieStr }

  const d = r.data?.data || r.data || {}
  const title = String(d.title || d.itemTitle || d.item?.title || '')
  const desc = String(d.desc || d.itemDesc || d.item?.desc || '')
  const price = String(d.price || d.priceInfo?.price || d.item?.price || '')
  const pic = String(d.picUrl || d.mainPic || d.item?.mainPic || '')
  const id = String(d.itemId || d.id || d.item?.id || itemId)
  if (!title && !desc) return { detail: null, finalCookieStr: r.cookieStr }
  return {
    detail: { item_id: id, item_title: title, item_desc: desc, item_price: price, pic_url: pic },
    finalCookieStr: r.cookieStr,
  }
}

/**
 * 虚拟发货确认 (语义对齐 butler auto_confirm / secure_confirm_decrypted)。
 * api=mtop.taobao.idle.logistic.consign.dummy, data={"orderId":...,"tradeText":"","picList":[],"newUnconsign":true}
 *
 * (v2.1.7) tradeText = 无需邮寄发货凭证内容 (语义对齐参考项目 confirm_service.py "无需邮寄凭证内容"):
 * 卡密/验证码等发货内容随本接口提交平台, 买家在闲鱼订单的发货信息(发货凭证)中查看;
 * 传空时请求与原实现字节级一致 (人工发货等场景零影响)。
 *
 * @param tradeText 发货凭证内容 (默认空串 = 不带凭证, 与历史行为完全一致)
 * @returns { success, message, finalCookieStr } — 系统侧订单状态置为已发货
 */
export async function confirmOrderShipped(
  cookieStr: string,
  orderId: string,
  tradeText = '',
): Promise<{ success: boolean; message: string; finalCookieStr: string }> {
  if (!orderId) return { success: false, message: '缺少订单号', finalCookieStr: cookieStr }
  const data = { orderId: String(orderId), tradeText: String(tradeText || ''), picList: [], newUnconsign: true }
  const r = await mtopCall<any>('mtop.taobao.idle.logistic.consign.dummy', data, cookieStr, {
    method: 'POST',
  })
  const retStr = Array.isArray(r.raw?.ret) ? r.raw.ret.join(' ') : ''
  if (retStr.includes('SUCCESS')) {
    return { success: true, message: '确认发货成功', finalCookieStr: r.cookieStr }
  }
  // 已发货幂等语义: 平台侧订单本就处于已发货 = 无需邮寄发货达成 (实测响应 ORDER_ALREADY_DELIVERY)
  if (retStr.includes('ORDER_ALREADY_DELIVERY') || retStr.includes('已发货成功')) {
    return { success: true, message: '订单已是已发货状态 (无需邮寄发货达成)', finalCookieStr: r.cookieStr }
  }
  // (v2.1.19) 失败原因一眼清: 原始码 + 人话翻译 (Cookie 失效/风控/订单状态/网络/代理)
  return { success: false, message: mtopFailMessage(retStr || '确认发货失败'), finalCookieStr: r.cookieStr }
}

/**
 * 免拼/小刀订单发货 (语义对齐 butler auto_freeshipping, secure_freeshipping 解混淆实测)。
 * api=mtop.idle.groupon.activity.seller.freeshipping, data={"bizOrderId","itemId","buyerId"}
 * 仅对拼单/小刀订单有效, 非拼单订单返回 GROUPON_INSTANCE_QUERY_ERROR (实测)。
 */
export async function freeshippingOrder(
  cookieStr: string,
  orderId: string,
  itemId: string,
  buyerId: string,
): Promise<{ success: boolean; message: string; finalCookieStr: string }> {
  if (!orderId) return { success: false, message: '缺少订单号', finalCookieStr: cookieStr }
  const data = { bizOrderId: String(orderId), itemId: numericIdOrSelf(itemId), buyerId: numericIdOrSelf(buyerId) }
  const r = await mtopCall<any>('mtop.idle.groupon.activity.seller.freeshipping', data, cookieStr, {
    method: 'POST',
  })
  const retStr = Array.isArray(r.raw?.ret) ? r.raw.ret.join(' ') : ''
  if (retStr.includes('SUCCESS')) {
    return { success: true, message: '免拼发货成功', finalCookieStr: r.cookieStr }
  }
  // (v2.1.19) 失败原因一眼清 (同 confirmOrderShipped)
  return { success: false, message: mtopFailMessage(retStr || '免拼发货失败'), finalCookieStr: r.cookieStr }
}

// ============ 订单查询 (语义对齐 butler order_fetcher_optimized._parse_api_response) ============

/** 订单详情 (mtop.idle.web.trade.order.detail 响应映射)。 */
export interface XianyuOrderDetail {
  order_id: string
  /** 统一状态: processing / pending_ship / shipped / completed / cancelled / refunding / unknown */
  order_status: string
  /** 平台原始状态名 (utArgs.orderStatusName) */
  status_text: string
  item_id: string
  item_title: string
  /** 实付金额 (priceInfo.amount.value) */
  price: string
  buyer_id: string
  /** 卖家身份 uid (v2.3.0 存量订单核验回填用; 响应未携带为空串) */
  seller_id: string
  /** 真实下单时间原文 (v2.3.0 存量时间堆积回填用; 响应未携带为空串, 绝不伪造) */
  create_time_text: string
  receiver_name: string
  receiver_phone: string
  receiver_city: string
  receiver_address: string
  can_rate: boolean
}

/** 订单详情下单时间候选键名 (受限深扫 orderInfoVO 范围, 绝不扫到状态时间)。 */
const ORDER_DETAIL_CREATETIME_KEYS = /^(createTime|createTimeText|orderCreateTime|orderCreatedTime|createdTime|timeCreate)$/i

/** 闲鱼订单数字状态码 → 统一状态 (与 butler STATUS_CODE_MAP 一致)。 */
const ORDER_STATUS_CODE_MAP: Record<string, string> = {
  '1': 'processing',
  '2': 'pending_ship',
  '3': 'shipped',
  '4': 'completed',
  '7': 'refunding',
  '8': 'cancelled',
  '9': 'refunding',
  '10': 'cancelled',
  '11': 'completed',
  '12': 'cancelled',
}

function normalizeOrderStatus(raw: unknown): string {
  if (raw === null || raw === undefined) return 'unknown'
  const s = String(raw)
  if (['processing', 'pending_ship', 'shipped', 'completed', 'cancelled', 'refunding', 'unknown'].includes(s)) return s
  return ORDER_STATUS_CODE_MAP[s] || 'unknown'
}

/**
 * 实查一个订单的详情 (api=mtop.idle.web.trade.order.detail, 与 goofish 订单详情页同源接口)。
 * 用于订单刷新: 状态 / 买家 / 金额 / 收货人信息对账。
 *
 * @param opts.transport 可插拔传输通道 (与 fetchSellerOrdersFull 同构): 默认 mtopFetch
 *        (代理透传网关优先 → 本机直连); Cloudflare Pages 等直连不可达运行时, 调用方
 *        注入任务通道 (order-task.taskChannelTransport) 经代理转发, 否则直连必失败。
 * @returns { detail, retMsg, finalCookieStr } — detail 为 null 表示未取到 (风控/无权限), retMsg 携带平台原始错误;
 *          detail.seller_id / detail.create_time_text 为存量订单核验修复数据源 (v2.3.0)
 */
export async function fetchOrderDetail(
  cookieStr: string,
  orderId: string,
  opts: { transport?: MtopTransport } = {},
): Promise<{ detail: XianyuOrderDetail | null; retMsg: string; finalCookieStr: string }> {
  if (!orderId) return { detail: null, retMsg: '缺少订单号', finalCookieStr: cookieStr }
  let r = await mtopCall<any>(
    'mtop.idle.web.trade.order.detail',
    { orderId: String(orderId), role: 'seller' },
    cookieStr,
    { method: 'POST', transport: opts.transport },
  )
  let retStr = Array.isArray(r.raw?.ret) ? r.raw.ret.join(' ') : ''
  // 瞬时风控重试 (v2.1.12): 闲鱼对该接口限流时返回 FAIL_BIZ_COMMON_SYSTEM_ERROR2
  // ("闲鱼太累了,休息一会儿吧!") — 系统级瞬时错误, 等 2.5s 重试一次通常即过;
  // 仅对系统错误重试 (状态/鉴权/参数类错误重试无意义)
  if (/FAIL_BIZ_COMMON_SYSTEM_ERROR|FAIL_SYS_SYSTEM_ERROR|SYSTEM_ERROR/i.test(retStr)) {
    await new Promise((resolve) => setTimeout(resolve, 2500))
    r = await mtopCall<any>(
      'mtop.idle.web.trade.order.detail',
      { orderId: String(orderId), role: 'seller' },
      r.cookieStr || cookieStr,
      { method: 'POST', transport: opts.transport },
    )
    retStr = Array.isArray(r.raw?.ret) ? r.raw.ret.join(' ') : ''
  }
  if (!retStr.includes('SUCCESS')) {
    // (v2.1.19) 查单失败原因一眼清 (同 fetchSellerOrders, 流向订单刷新报错/详情对账留痕)
    return { detail: null, retMsg: mtopFailMessage(retStr || '订单详情查询失败'), finalCookieStr: r.cookieStr }
  }

  const d = r.data || {}
  const out: XianyuOrderDetail = {
    order_id: String(orderId),
    order_status: normalizeOrderStatus(d.status),
    status_text: String(d?.utArgs?.orderStatusName || ''),
    item_id: '',
    item_title: '',
    price: '',
    buyer_id: '',
    seller_id: '',
    create_time_text: String(
      d?.utArgs?.createTime || d?.utArgs?.createTimeText || d?.createTime || d?.orderCreateTime || '',
    ).trim(),
    receiver_name: '',
    receiver_phone: '',
    receiver_city: '',
    receiver_address: '',
    can_rate: false,
  }

  const components = Array.isArray(d.components) ? d.components : []
  for (const comp of components) {
    if (comp?.render !== 'orderInfoVO') continue
    const cd = comp?.data || {}
    const itemInfo = cd.itemInfo || {}
    out.item_title = String(itemInfo.title || '')
    out.item_id = String(itemInfo.itemId || '')
    // 卖家身份 + 真实下单时间 (v2.3.0 存量订单核验修复数据源): 已知候选 → 受限深扫兑底
    out.seller_id = String(
      cd.sellerInfo?.userId || cd.sellerInfo?.sellerId || cd.sellerId || cd.seller_id || out.seller_id || '',
    ).trim()
    if (!out.create_time_text) {
      const tHit =
        deepScanString(cd, ORDER_DETAIL_CREATETIME_KEYS, new Set(['priceInfo', 'addressInfo', 'itemInfo']), 3) ||
        deepScanString(comp?.data || {}, ORDER_DETAIL_CREATETIME_KEYS, new Set(['priceInfo', 'addressInfo', 'itemInfo']), 2)
      out.create_time_text = String(tHit || '').trim()
    }
    const amount = cd.priceInfo?.amount
    if (amount && amount.value !== undefined && amount.value !== null) {
      // butler 同源: amount.value 直接作为金额使用 (实测响应为元字符串, 不做 /100)
      out.price = String(amount.value)
    }
    const addr = cd.addressInfo
    if (addr) {
      out.receiver_name = String(addr.receiverName || '')
      out.receiver_phone = String(addr.receiverMobile || '')
      out.receiver_city = String(addr.city || '')
      if (addr.fullAddress) {
        out.receiver_address = String(addr.fullAddress)
      } else {
        out.receiver_address = [addr.province, addr.city, addr.district, addr.detailAddress]
          .map((p: unknown) => String(p || '').trim())
          .filter(Boolean)
          .join(' ')
      }
    }
    out.buyer_id = String(cd.buyerInfo?.userId || '')
  }

  const buttons = d.bottomBarVO?.buttonList
  out.can_rate = Array.isArray(buttons) && buttons.some((b: any) => b?.tradeAction === 'RATE')

  if (!out.order_status || out.order_status === 'unknown') {
    // 无有效载荷: 视为未取到, 避免把 unknown 覆盖写回
    return { detail: null, retMsg: retStr || '订单详情响应无有效数据', finalCookieStr: r.cookieStr }
  }
  return { detail: out, retMsg: '', finalCookieStr: r.cookieStr }
}

/* ---------------------------------- 卖家订单列表 (mtop.taobao.idle.trade.merchant.sold.get) ---------------------------------- */

/** 卖家订单列表单条标准化结果。 */
export interface SellerOrderItem {
  order_id: string
  order_status: string
  item_id: string
  buyer_id: string
  buyer_nick: string
  /** 卖家身份 (响应中能提取到的: 卖家 uid); 空串 = 响应未携带, 无法判定。 */
  seller_id: string
  receiver_name: string
  receiver_phone: string
  receiver_address: string
  /** 状态时间 (列表接口能提取到的): 空串 = 响应未携带, 不伪造。 */
  paid_at_text: string
  shipped_at_text: string
  finished_at_text: string
  cancelled_at_text: string
  amount: string
  quantity: string
  is_bargain: boolean
  created_at_text: string
}

/** 闲鱼订单中文状态 → 本库状态码 (语义对齐 butler _XIANYU_STATUS_MAP)。 */
export const SELLER_ORDER_STATUS_MAP: Record<string, string> = {
  待付款: 'pending_payment',
  待发货: 'pending_ship',
  已发货: 'shipped',
  交易成功: 'completed',
  交易关闭: 'cancelled',
  退款中: 'refunding',
  退款成功: 'refunded',
  已退款: 'refunded',
  退款关闭: 'cancelled',
}

/** 卖家订单列表单页结果。 */
export interface SellerOrdersPage {
  items: SellerOrderItem[]
  nextPage: boolean
  totalCount: number
  retMsg: string
  finalCookieStr: string
}

/**
 * 从订单列表 item 尽力提取状态时间 (付款/发货/完成/取消)。
 * sold 列表接口各版本携带的时间字段名不统一, 这里按候选键名在
 * commonData 与 item 顶层做大小写不敏感的浅层扫描; 取到即返回原文
 * (毫秒时间戳/ISO/"YYYY-MM-DD HH:MM:SS" 均可, 由入库方归一化),
 * 取不到返回空串 — 绝不用当前时刻冒充状态时间。
 */
function pickTimeText(sources: any[], keys: string[]): string {
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue
    for (const [k, v] of Object.entries(src)) {
      if (!keys.includes(String(k).toLowerCase())) continue
      if (v === null || v === undefined || v === '' || v === 0) continue
      return String(v)
    }
  }
  return ''
}

/** 卖家身份深扫禁入容器: 买家相关容器绝不可能是卖家身份来源。 */
const SELLER_SCAN_EXCLUDE_KEYS = new Set(['buyerInfoVO', 'buyerVO', 'buyer', 'buyerUserVO'])

/**
 * 卖家身份提取 (v2.3.0 增强): 响应各版本卖家字段位置不统一
 * (commonData.sellerId / sellerInfoVO / sellerVO / 顶层), 已知候选落空后在订单
 * item 范围内受限深扫 (sellerId/seller_id/userNumberId 等身份键名锚定, 排除买家
 * 容器)。取到即返回纯数字 uid (供账号隔离复核与趋势卖家维度统计), 取不到返回空串。
 */
function extractSellerIdFromItem(item: any, common: any): string {
  const sellerVO = item?.sellerInfoVO || item?.sellerVO || {}
  const candidates = [
    common?.sellerId,
    common?.seller_id,
    sellerVO?.userId,
    sellerVO?.sellerId,
    sellerVO?.userNumberId,
    item?.sellerId,
    item?.seller_id,
  ]
  for (const c of candidates) {
    const s = String(c ?? '').trim()
    if (s && /^\d+$/.test(s)) return s
  }
  const hit = deepScanString(item, /^(sellerId|seller_id|userNumberId)$/i, SELLER_SCAN_EXCLUDE_KEYS, 4)
  return hit && /^\d+$/.test(hit) ? hit : ''
}

/**
 * 买家昵称提取 (v2.3.0 增强): buyerInfoVO 多候选 → buyerInfoVO 范围内深扫 →
 * item 顶层 buyerNick 类键名深扫 (响应各版本昵称字段位置不统一, 绝不静默丢昵称)。
 */
function extractBuyerNickFromItem(item: any, buyer: any): string {
  const direct = pickBuyerNick(buyer)
  if (direct) return direct
  const inBuyer = deepScanString(buyer, /^(userNick|nick|nickname|buyerNick|nickName|userNickName)$/i, new Set(), 3)
  if (inBuyer) return inBuyer
  return deepScanString(item, /^(buyerNick|buyer_nick|buyerUserNick)$/i, new Set(), 3)
}

/** 解析卖家订单列表单条 item (语义对齐 butler _parse_sold_order_item)。 */
export function parseSoldOrderItem(item: any): SellerOrderItem | null {
  const common = item?.commonData || {}
  const orderId = String(common.orderId || '')
  if (!orderId) return null
  const buyer = item?.buyerInfoVO || {}
  const priceVo = item?.priceVO || {}
  const btnList = Array.isArray(item?.rightVO?.btnList) ? item.rightVO.btnList : []
  const rawStatus = String(common.orderStatus || '')
  return {
    order_id: orderId,
    order_status: String(common.inRefund) === 'true' ? 'refunding' : SELLER_ORDER_STATUS_MAP[rawStatus] || 'unknown',
    item_id: String(common.itemId || ''),
    buyer_id: String(buyer.buyerId || ''),
    buyer_nick: extractBuyerNickFromItem(item, buyer),
    seller_id: extractSellerIdFromItem(item, common),
    receiver_name: String(buyer.name || ''),
    receiver_phone: String(buyer.phone || ''),
    receiver_address: String(buyer.address || ''),
    amount: String(priceVo.totalPrice ?? ''),
    quantity: String(priceVo.buyNum ?? '1'),
    is_bargain: btnList.some((b: any) => b?.tradeAction === 'SKIP_PIN'),
    created_at_text: String(common.createTime || ''),
    paid_at_text: pickTimeText([common, item], ['paytime', 'paidtime', 'pay_time', 'paid_time']),
    shipped_at_text: pickTimeText([common, item], ['shiptime', 'shippedtime', 'consigntime', 'delivertime', 'deliverytime', 'sendtime']),
    finished_at_text: pickTimeText([common, item], ['successtime', 'finishtime', 'confirmtime', 'dealsuccesstime', 'confirmreceivetime', 'receivedtime']),
    cancelled_at_text: pickTimeText([common, item], ['closetime', 'canceltime', 'closedtime']),
  }
}

/**
 * 拉取闲鱼卖家已售订单列表单页 (语义对齐 butler _fetch_sold_orders_page)。
 * api = mtop.taobao.idle.trade.merchant.sold.get; 卖家端接口会校验来源,
 * Origin/Referer 必须为 seller.goofish.com, 且 query 参数需带 valueType=string。
 *
 * @param queryCode "ALL"=全部订单, "NOT_SHIP"=待发货订单
 */
export async function fetchSellerOrders(
  cookieStr: string,
  page: number,
  queryCode: 'ALL' | 'NOT_SHIP' = 'ALL',
  opts: { transport?: MtopTransport } = {},
): Promise<SellerOrdersPage> {
  const empty: SellerOrdersPage = { items: [], nextPage: false, totalCount: 0, retMsg: '', finalCookieStr: cookieStr }
  if (!cookieStr) return { ...empty, retMsg: 'Cookie 为空' }
  const r = await mtopCall<any>(
    'mtop.taobao.idle.trade.merchant.sold.get',
    { pageNumber: page, rowsPerPage: 30, orderIds: '', queryCode, orderSearchParam: '{}' },
    cookieStr,
    {
      headers: {
        Origin: 'https://seller.goofish.com',
        Referer: 'https://seller.goofish.com/',
      },
      extraParams: { valueType: 'string', spm_cnt: 'a21107h.42826273.0.0' },
      transport: opts.transport,
    },
  )
  const retStr = Array.isArray(r.raw?.ret) ? r.raw.ret.join(' ') : ''
  if (!retStr.includes('SUCCESS')) {
    // (v2.1.19) 拉单失败原因一眼清: retMsg 流向决策日志/一键同步报错/发货兑底留痕, 统一人话翻译
    return { ...empty, retMsg: mtopFailMessage(retStr || '卖家订单列表查询失败'), finalCookieStr: r.cookieStr }
  }
  const module = r.data?.module || {}
  const rawItems = Array.isArray(module.items) ? module.items : []
  const items = rawItems.map(parseSoldOrderItem).filter((x: SellerOrderItem | null): x is SellerOrderItem => !!x)
  return {
    items,
    nextPage: String(module.nextPage ?? 'false') === 'true',
    totalCount: parseInt(String(module.totalCount ?? '0'), 10) || 0,
    retMsg: '',
    finalCookieStr: r.cookieStr,
  }
}

/* --------------------- 全量订单同步 (v2.2.6): 完整真实解析 ---------------------
 * 背景: 2.1.7 的 parseSoldOrderItem 只解析订单号/状态/金额等基础字段, 商品名称从未
 * 解析 (SellerOrderItem 无 item_title 字段), 买家昵称丢失 — 订单页商品列只能拿
 * item_id 去 item_info 表 JOIN 兑底, 非已添加账号的订单没有 item_info 记录,
 * 商品列永远显示裸 ID。本节按同一接口响应做完整字段真实解析, 供全量订单同步
 * (/api/orders/sync-all, 闲鱼趋势 tab) 与独立代理 fetch_orders_full 任务共用。
 * 与既有 parseSoldOrderItem 完全独立 (互不影响), 已证实可用的字段路径
 * (commonData/buyerInfoVO/priceVO) 保持同源, 新增字段用多候选+受限深扫提取。 */

/** 卖家订单列表单条完整解析结果 (v2.2.6 全量同步口径)。 */
export interface SellerOrderItemFull extends SellerOrderItem {
  /** 商品名称 (响应真实携带才写入; 空串 = 响应未携带, 绝不伪造)。 */
  item_title: string
  /** 买家昵称 (响应真实携带才写入; 空串 = 响应未携带)。 */
  buyer_nick: string
  /** 商品真实单价 (响应真实携带才写入; 空串 = 响应未携带; amount 仍为 totalPrice 总额)。 */
  item_price: string
}

/** 卖家订单列表完整解析单页结果。 */
export interface SellerOrdersFullPage {
  items: SellerOrderItemFull[]
  nextPage: boolean
  totalCount: number
  retMsg: string
  finalCookieStr: string
}

/** 深扫禁入容器: 按钮区/操作区/底部栏等 UI 控件自带的 title 文案 (「发货」「修改价格」) 绝不是商品名。 */
const TITLE_SCAN_EXCLUDE_KEYS = new Set([
  'rightVO', 'btnList', 'buttonList', 'btn', 'buttons', 'bottomBarVO', 'toolBarVO',
  'operationVO', 'topBarVO', 'actionList', 'menuList', 'tagBarVO', 'cardBtnVO', 'linkBtnVO',
])

/**
 * 在订单 item 对象内受限深扫指定正则键名的首个非空字符串值。
 * 仅扫描纯数据容器, UI 控件容器 (按钮/操作区) 一律跳过 — 防止把「发货」等按钮
 * 文案当商品名。返回值原样取自响应 (真实解析), 扫不到返回空串。
 */
function deepScanString(
  root: any,
  keyPattern: RegExp,
  exclude: Set<string>,
  maxDepth = 4,
): string {
  const walk = (node: any, depth: number): string => {
    if (!node || typeof node !== 'object' || depth > maxDepth) return ''
    if (Array.isArray(node)) {
      for (const el of node) {
        const hit = walk(el, depth + 1)
        if (hit) return hit
      }
      return ''
    }
    for (const [k, v] of Object.entries(node)) {
      if (exclude.has(String(k))) continue
      if (keyPattern.test(String(k)) && typeof v === 'string' && v.trim()) return String(v).trim()
    }
    for (const [k, v] of Object.entries(node)) {
      if (exclude.has(String(k))) continue
      if (v && typeof v === 'object') {
        const hit = walk(v, depth + 1)
        if (hit) return hit
      }
    }
    return ''
  }
  return walk(root, 0)
}

/**
 * 商品名称真实解析: 响应各版本字段位置不统一 (itemVO/fullActivityVO/commonData/顶层),
 * 按已知候选位置优先 → 受限深扫兜底, 值全部原样取自响应; 全部落空返回空串 (不伪造)。
 * 候选排除 chatEdgeTitle 等会话/卡片场景文案 (深扫正则不匹配含 chat/card 的键名)。
 */
function pickItemTitle(item: any, common: any): string {
  const candidates = [
    item?.itemVO?.title,
    item?.item?.title,
    item?.itemInfoVO?.title,
    item?.fullActivityVO?.itemTitle,
    item?.fullActivityVO?.title,
    item?.itemFullActivityVO?.title,
    common?.title,
    common?.itemTitle,
    item?.titleInfo?.title,
    item?.title,
  ]
  for (const c of candidates) {
    const s = String(c ?? '').trim()
    if (s) return s
  }
  // 深扫兜底: 键名含 title 但排除会话/卡片/操作类命名 (chatTitle/cardTitle/btnTitle...)
  return deepScanString(
    item,
    /^(title|itemTitle|item_title|soldItemTitle)$/i,
    new Set([...TITLE_SCAN_EXCLUDE_KEYS, 'titleInfo']),
    4,
  )
}

/**
 * 买家昵称真实解析: buyerInfoVO 内多候选 (userNick/nick/nickname/buyerNick),
 * 落空再在 buyerInfoVO 范围内受限深扫 (范围收窄, 绝不扫到卖家字段)。空串 = 未携带。
 */
function pickBuyerNick(buyer: any): string {
  const candidates = [buyer?.userNick, buyer?.nick, buyer?.nickname, buyer?.buyerNick, buyer?.nickName]
  for (const c of candidates) {
    const s = String(c ?? '').trim()
    if (s) return s
  }
  return deepScanString(buyer, /^(userNick|nick|nickname|buyerNick|nickName)$/i, new Set(), 3)
}

/** 单价深扫禁入容器: 与商品名深扫同源 (按钮/操作区文案绝不可能是价格)。 */
const PRICE_SCAN_EXCLUDE_KEYS = new Set([...TITLE_SCAN_EXCLUDE_KEYS])

/** 价格形状校验: 纯数字/小数 (响应真实价格值全部为此形状), 文案/带单位文本一律拒收。 */
function isPriceShape(v: unknown): boolean {
  return /^\d+(?:\.\d+)?$/.test(String(v ?? '').trim())
}

/**
 * 商品真实单价解析 (v2.2.6 全量同步): amount 是 priceVO.totalPrice 总额, 单价在
 * 响应各版本字段位置不统一 (priceVO.itemPrice/price/buyPrice、commonData.itemPrice
 * 等), 按已知候选位置优先 → 受限深扫兜底; 值全部原样取自响应且必须通过价格形状
 * 校验 (数字/小数), 全部落空返回空串 (不伪造 — 单价列显示交由前端兜底展示总额)。
 */
function pickItemPrice(item: any, common: any): string {
  const priceVo = item?.priceVO || {}
  const candidates = [
    priceVo.itemPrice,
    priceVo.item_price,
    priceVo.unitPrice,
    priceVo.buyPrice,
    priceVo.salePrice,
    priceVo.price,
    common?.itemPrice,
    common?.item_price,
    common?.unitPrice,
    common?.buyPrice,
  ]
  for (const c of candidates) {
    const s = String(c ?? '').trim()
    if (s && isPriceShape(s)) return s
  }
  // 深扫兜底: 精确键名锚定 (绝不匹配 totalPrice/postFee/discountFee 等非单价字段)
  const hit = deepScanString(item, /^(itemPrice|item_price|unitPrice|buyPrice|salePrice)$/i, PRICE_SCAN_EXCLUDE_KEYS, 4)
  return hit && isPriceShape(hit) ? hit : ''
}

/**
 * 解析卖家订单列表单条 item → 完整字段 (v2.2.6 全量同步)。
 * 基础字段提取路径与 parseSoldOrderItem 同源 (已证实可用), 新增商品名称/买家昵称/
 * 商品真实单价真实解析 (时间字段: 下单/付款/发货/收货/取消, 响应携带才写入)。
 */
export function parseSoldOrderItemFull(item: any): SellerOrderItemFull | null {
  const common = item?.commonData || {}
  const orderId = String(common.orderId || '')
  if (!orderId) return null
  const buyer = item?.buyerInfoVO || {}
  const priceVo = item?.priceVO || {}
  const btnList = Array.isArray(item?.rightVO?.btnList) ? item.rightVO.btnList : []
  const rawStatus = String(common.orderStatus || '')
  return {
    order_id: orderId,
    order_status: String(common.inRefund) === 'true' ? 'refunding' : SELLER_ORDER_STATUS_MAP[rawStatus] || 'unknown',
    item_id: String(common.itemId || ''),
    item_title: pickItemTitle(item, common),
    buyer_id: String(buyer.buyerId || ''),
    buyer_nick: extractBuyerNickFromItem(item, buyer),
    item_price: pickItemPrice(item, common),
    seller_id: extractSellerIdFromItem(item, common),
    receiver_name: String(buyer.name || ''),
    receiver_phone: String(buyer.phone || ''),
    receiver_address: String(buyer.address || ''),
    amount: String(priceVo.totalPrice ?? ''),
    quantity: String(priceVo.buyNum ?? '1'),
    is_bargain: btnList.some((b: any) => b?.tradeAction === 'SKIP_PIN'),
    created_at_text: String(common.createTime || ''),
    paid_at_text: pickTimeText([common, item], ['paytime', 'paidtime', 'pay_time', 'paid_time']),
    shipped_at_text: pickTimeText([common, item], ['shiptime', 'shippedtime', 'consigntime', 'delivertime', 'deliverytime', 'sendtime']),
    finished_at_text: pickTimeText([common, item], ['successtime', 'finishtime', 'confirmtime', 'dealsuccesstime', 'confirmreceivetime', 'receivedtime']),
    cancelled_at_text: pickTimeText([common, item], ['closetime', 'canceltime', 'closedtime']),
  }
}

/**
 * 拉取闲鱼卖家已售订单列表单页 (完整解析版, v2.2.6 全量订单同步)。
 * 接口与 fetchSellerOrders 完全同源 (mtop.taobao.idle.trade.merchant.sold.get,
 * 卖家端 Origin/Referer + valueType=string), 仅解析层换 parseSoldOrderItemFull —
 * 商品名称/买家昵称/卖家身份随单返回, 供「不判断区分账号」的全量同步入库。
 *
 * @param queryCode "ALL"=全部订单, "NOT_SHIP"=待发货订单
 */
export async function fetchSellerOrdersFull(
  cookieStr: string,
  page: number,
  queryCode: 'ALL' | 'NOT_SHIP' = 'ALL',
  opts: { transport?: MtopTransport } = {},
): Promise<SellerOrdersFullPage> {
  const empty: SellerOrdersFullPage = { items: [], nextPage: false, totalCount: 0, retMsg: '', finalCookieStr: cookieStr }
  if (!cookieStr) return { ...empty, retMsg: 'Cookie 为空' }
  const r = await mtopCall<any>(
    'mtop.taobao.idle.trade.merchant.sold.get',
    { pageNumber: page, rowsPerPage: 30, orderIds: '', queryCode, orderSearchParam: '{}' },
    cookieStr,
    {
      headers: {
        Origin: 'https://seller.goofish.com',
        Referer: 'https://seller.goofish.com/',
      },
      extraParams: { valueType: 'string', spm_cnt: 'a21107h.42826273.0.0' },
      transport: opts.transport,
    },
  )
  const retStr = Array.isArray(r.raw?.ret) ? r.raw.ret.join(' ') : ''
  if (!retStr.includes('SUCCESS')) {
    return { ...empty, retMsg: mtopFailMessage(retStr || '卖家订单列表查询失败'), finalCookieStr: r.cookieStr }
  }
  const module = r.data?.module || {}
  const rawItems = Array.isArray(module.items) ? module.items : []
  const items = rawItems.map(parseSoldOrderItemFull).filter((x: SellerOrderItemFull | null): x is SellerOrderItemFull => !!x)
  return {
    items,
    nextPage: String(module.nextPage ?? 'false') === 'true',
    totalCount: parseInt(String(module.totalCount ?? '0'), 10) || 0,
    retMsg: '',
    finalCookieStr: r.cookieStr,
  }
}

/* ------------------- 全平台商品搜索 (v2.3.0, 闲鱼趋势·热门商品数据源) -------------------
 * api = mtop.taobao.idle.pc.search (goofish.com 搜索页同源接口): 账号 Cookie 调用,
 * 按关键词搜索**全平台**在售商品 — 这是"全平台数据"的真实来源 (卖家订单接口
 * merchant.sold.get 是账号维度, 只返回该账号自己的订单, 不存在全平台订单接口)。
 * 搜索结果聚合 (同款在售卖家数/价格带/想要人数) 进 trend_hot_items 表做热门商品趋势。
 * 响应结构多版本: BFS 定位"元素含 itemId+title 的数组"再逐条多候选解析, 落空显性报错。 */

/** 闲鱼站内搜索单条商品标准化结果。 */
export interface IdleSearchItem {
  item_id: string
  title: string
  price: string
  /** 想要人数 (响应真实携带才写; 空串 = 未携带)。 */
  want_count: string
  seller_id: string
  seller_nick: string
  area: string
  pic_url: string
}

/** 闲鱼站内搜索单页结果。 */
export interface IdleSearchPage {
  items: IdleSearchItem[]
  nextPage: boolean
  totalCount: number
  retMsg: string
  finalCookieStr: string
}

/**
 * 在搜索响应内定位商品数组: BFS ≤5 层, 返回首个"元素为对象且可解析出商品 ID+标题"
 * 的非空数组 — 实测容器路径为 data.resultList (元素含 data.item.main), 兼容后续版本变化。
 */
function locateSearchItems(root: any): any[] {
  const queue: any[] = [root]
  let depth = 0
  while (queue.length && depth <= 5) {
    const size = queue.length
    for (let i = 0; i < size; i++) {
      const node = queue.shift()
      if (!node || typeof node !== 'object') continue
      if (Array.isArray(node)) {
        if (
          node.length &&
          node.some((el) => {
            if (!el || typeof el !== 'object' || Array.isArray(el)) return false
            const dp = el?.data?.item?.main?.exContent?.detailParams || {}
            const args = el?.data?.item?.main?.clickParam?.args || {}
            return String(dp.itemId || args.id || el.itemId || '') && String(dp.title || el.title || '')
          })
        ) {
          return node
        }
        for (const el of node) queue.push(el)
      } else {
        for (const v of Object.values(node)) queue.push(v)
      }
    }
    depth++
  }
  return []
}

/** 高亮标签剥离 (搜索结果 title 常带 <hl>/<em> 高亮片段)。 */
function stripHighlight(s: string): string {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .trim()
}

/**
 * 解析搜索结果单条商品 (v2.3.0, 实测 goofish.com 搜索页同源结构):
 * el.data.item.main.{exContent.detailParams, clickParam.args} 为主路径, 多候选兑底;
 * 字段全部原样取自响应 (title 剥离高亮标签, price/形状校验), 不伪造。
 * 已实测字段位置: itemId/title/userNick(卖家昵称)/soldPrice 在 detailParams,
 * price/wantNum/id/seller_id(加密串) 在 clickParam.args, 地区在 exContent.area。
 */
function parseSearchItem(el: any): IdleSearchItem | null {
  if (!el || typeof el !== 'object') return null
  const main = el?.data?.item?.main || el?.item?.main || el?.main || el
  const dp = main?.exContent?.detailParams || {}
  const args = main?.clickParam?.args || {}
  const itemId = String(dp.itemId || args.id || main?.itemId || el?.itemId || '').trim()
  if (!itemId || !/^\d+$/.test(itemId)) return null
  const title = stripHighlight(String(dp.title || main?.title || el?.title || ''))
  const priceRaw = String(args.price ?? dp.soldPrice ?? main?.price ?? '').trim()
  const price = /^[\d.]+$/.test(priceRaw) ? priceRaw : ''
  const wantRaw = String(args.wantNum ?? main?.wantNum ?? '').trim()
  const want = /^\d+$/.test(wantRaw) ? wantRaw : ''
  const sellerNick = stripHighlight(String(dp.userNick || main?.userNick || args.sellerNick || ''))
  const area = stripHighlight(String(main?.exContent?.area || args.area || ''))
  // 卖家 uid: 搜索响应为加密串 (不可比对该无明文 uid), 仅原样保留备查
  const sellerId = String(args.seller_id || args.sellerId || main?.sellerId || '').trim()
  const pic = String(main?.picUrl || dp.picUrl || main?.mainPic || '').trim()
  return { item_id: itemId, title, price, want_count: want, seller_id: sellerId, seller_nick: sellerNick, area, pic_url: pic }
}

/**
 * 闲鱼站内搜索单页 (v2.3.0 全平台热门商品趋势): 实测 goofish.com 搜索页同源接口
 * mtop.taobao.idlemtopsearch.pc.search v1.0 (2026-11 从搜索页 JS p_search-index.js
 * 逆向确认 + 真实调用验证), 按关键词搜索全平台在售商品。落空时 retMsg 显性报错。
 *
 * @param keyword   搜索关键词 (如 "TG API" / 商品品类词)
 * @param page      页码 (rowsPerPage 与搜索页一致为 30)
 */
export async function fetchIdleSearch(
  cookieStr: string,
  keyword: string,
  page: number,
  opts: { transport?: MtopTransport } = {},
): Promise<IdleSearchPage> {
  const empty: IdleSearchPage = { items: [], nextPage: false, totalCount: 0, retMsg: '', finalCookieStr: cookieStr }
  if (!cookieStr) return { ...empty, retMsg: 'Cookie 为空' }
  const kw = String(keyword || '').trim()
  if (!kw) return { ...empty, retMsg: '搜索关键词为空' }
  const r = await mtopCall<any>(
    'mtop.taobao.idlemtopsearch.pc.search',
    {
      pageNumber: page,
      keyword: kw,
      fromFilter: false,
      rowsPerPage: 30,
      sortValue: '',
      sortField: '',
      customDistance: '',
      gps: '',
      propValueStr: {},
      customGps: '',
      searchReqFromPage: 'pcSearch',
    },
    cookieStr,
    {
      headers: {
        Origin: 'https://www.goofish.com',
        Referer: 'https://www.goofish.com/search',
      },
      extraParams: { spm_cnt: 'a21ybx.search.0.0' },
      transport: opts.transport,
    },
  )
  const retStr = Array.isArray(r.raw?.ret) ? r.raw.ret.join(' ') : ''
  if (!retStr.includes('SUCCESS')) {
    return { ...empty, retMsg: mtopFailMessage(retStr || '闲鱼搜索查询失败'), finalCookieStr: r.cookieStr }
  }
  const rawItems = locateSearchItems(r.data)
  if (!rawItems.length) {
    return {
      ...empty,
      retMsg: '搜索响应未定位到商品列表 (接口结构变更或关键词无结果)',
      finalCookieStr: r.cookieStr,
    }
  }
  const items = rawItems.map(parseSearchItem).filter((x: IdleSearchItem | null): x is IdleSearchItem => !!x)
  const numFound = parseInt(String(r.data?.resultInfo?.searchResControlFields?.numFound ?? '0'), 10) || 0
  return {
    items,
    nextPage: items.length >= 15 && numFound > page * 30,
    totalCount: numFound || items.length,
    retMsg: '',
    finalCookieStr: r.cookieStr,
  }
}
