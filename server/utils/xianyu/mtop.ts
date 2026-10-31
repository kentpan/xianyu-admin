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

/** mtop 响应 JSON 宽松解析 (空体/非 JSON 返空对象, 与 res.json().catch 同语义)。 */
function parseMtopJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
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
  opts: { v?: string; method?: string; headers?: Record<string, string>; extraParams?: Record<string, string> } = {},
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

  const res = await mtopFetch(`${url}?${params.toString()}`, {
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
    const retryRes = await mtopFetch(`${url}?${retryParams.toString()}`, {
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
 * @returns { success, message, finalCookieStr } — 系统侧订单状态置为已发货
 */
export async function confirmOrderShipped(
  cookieStr: string,
  orderId: string,
): Promise<{ success: boolean; message: string; finalCookieStr: string }> {
  if (!orderId) return { success: false, message: '缺少订单号', finalCookieStr: cookieStr }
  const data = { orderId: String(orderId), tradeText: '', picList: [], newUnconsign: true }
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
  return { success: false, message: retStr || '确认发货失败', finalCookieStr: r.cookieStr }
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
  const data = { bizOrderId: String(orderId), itemId: Number(itemId) || String(itemId), buyerId: Number(buyerId) || String(buyerId) }
  const r = await mtopCall<any>('mtop.idle.groupon.activity.seller.freeshipping', data, cookieStr, {
    method: 'POST',
  })
  const retStr = Array.isArray(r.raw?.ret) ? r.raw.ret.join(' ') : ''
  if (retStr.includes('SUCCESS')) {
    return { success: true, message: '免拼发货成功', finalCookieStr: r.cookieStr }
  }
  return { success: false, message: retStr || '免拼发货失败', finalCookieStr: r.cookieStr }
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
  receiver_name: string
  receiver_phone: string
  receiver_city: string
  receiver_address: string
  can_rate: boolean
}

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
 * @returns { detail, retMsg, finalCookieStr } — detail 为 null 表示未取到 (风控/无权限), retMsg 携带平台原始错误
 */
export async function fetchOrderDetail(
  cookieStr: string,
  orderId: string,
): Promise<{ detail: XianyuOrderDetail | null; retMsg: string; finalCookieStr: string }> {
  if (!orderId) return { detail: null, retMsg: '缺少订单号', finalCookieStr: cookieStr }
  const r = await mtopCall<any>(
    'mtop.idle.web.trade.order.detail',
    { orderId: String(orderId), role: 'seller' },
    cookieStr,
    { method: 'POST' },
  )
  const retStr = Array.isArray(r.raw?.ret) ? r.raw.ret.join(' ') : ''
  if (!retStr.includes('SUCCESS')) {
    return { detail: null, retMsg: retStr || '订单详情查询失败', finalCookieStr: r.cookieStr }
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
  receiver_name: string
  receiver_phone: string
  receiver_address: string
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
    buyer_nick: String(buyer.userNick || ''),
    receiver_name: String(buyer.name || ''),
    receiver_phone: String(buyer.phone || ''),
    receiver_address: String(buyer.address || ''),
    amount: String(priceVo.totalPrice ?? ''),
    quantity: String(priceVo.buyNum ?? '1'),
    is_bargain: btnList.some((b: any) => b?.tradeAction === 'SKIP_PIN'),
    created_at_text: String(common.createTime || ''),
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
    },
  )
  const retStr = Array.isArray(r.raw?.ret) ? r.raw.ret.join(' ') : ''
  if (!retStr.includes('SUCCESS')) {
    return { ...empty, retMsg: retStr || '卖家订单列表查询失败', finalCookieStr: r.cookieStr }
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
