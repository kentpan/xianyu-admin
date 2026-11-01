/**
 * card-api — API 类型卡券的配置拉取逻辑 (唯一实现)。
 * brain.ts 发货提取与 /api/cards/test-api 配置测试共用, 避免两处漂移。
 */

export interface ApiCardFetchResult {
  ok: boolean
  /** 从响应 JSON 按 data_path 提取出的发货文本 (空串表示无内容) */
  text: string
  /** HTTP 状态码 (网络异常时 0) */
  status: number
  message: string
}

/** 卡券发货上下文变量: 发货请求 (url/头/体) 与发货文案/消息回复共用。 */
export interface ApiCardVars {
  /** 商品名称 */
  title?: string
  /** 商品价格 */
  price?: string
  /** 鉴权密钥 (API 卡券配置的 api_key) */
  apikey?: string
  /** 买家闲鱼昵称 */
  username?: string
  /** 买家用户 ID */
  userid?: string
  /** API 接口返回的资源交付分享 URL (data_path 提取结果) */
  shareURL?: string
  /** 其余启用变量 (item_id/desc/detail/seller_nick/card_name/order_id/自定义变量…) */
  [key: string]: string | undefined
}

/** 变量键合法性 (var_key/模板占位符均为字母数字下划线, 防注入): */
const VAR_KEY_RE = /^\w+$/

/**
 * 卡券变量替换: 遍历 vars 的全部键做 {key} 整值替换 (键来自 card_variables 启用集合,
 * 不再固定六变量); 数值型纯占位由 deepApplyVars 转数字。
 */
export function applyCardVars(text: unknown, vars?: ApiCardVars): string {
  let out = String(text ?? '')
  if (!out || !vars) return out
  for (const k of Object.keys(vars)) {
    if (!VAR_KEY_RE.test(k)) continue
    const token = `{${k}}`
    if (!out.includes(token)) continue
    out = out.replaceAll(token, String(vars[k] ?? ''))
  }
  return out
}

/** 递归替换配置对象中所有字符串值 (url/headers/body 共用); 纯占位整值替换后为数字则转数字。 */
function deepApplyVars(value: unknown, vars: ApiCardVars): unknown {
  if (typeof value === 'string') {
    const out = applyCardVars(value, vars)
    if (/^-?\d+(\.\d+)?$/.test(out) && /^\{\w+\}$/.test(value.trim())) return Number(out)
    return out
  }
  if (Array.isArray(value)) return value.map((v) => deepApplyVars(v, vars))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepApplyVars(v, vars)
    return out
  }
  return value
}

/**
 * 按 api_config 配置请求外部接口并提取发货文本。
 * conf: { url, method?, headers?, body?, api_key?, data_path? } — data_path 默认 'data',
 * 如 cards-hub 的 /api/issue 响应用 data.url 取加密提取页链接。
 * vars 提供时 url/headers/body 中的 {title}/{price}/{apikey}/{username}/{userid} 先行替换。
 */
export async function fetchApiCardContent(conf: unknown, vars?: ApiCardVars): Promise<ApiCardFetchResult> {
  const c = (conf && typeof conf === 'object' ? conf : {}) as Record<string, unknown>
  const rawUrl = String(c.url || '').trim()
  if (!rawUrl) return { ok: false, text: '', status: 0, message: '缺少 url' }

  const v = vars || {}
  const url = applyCardVars(rawUrl, { ...v, apikey: v.apikey ?? String(c.api_key || '') })
  try {
    const isPost = String(c.method || 'GET').toUpperCase() === 'POST'
    const headers = deepApplyVars(
      c.headers && typeof c.headers === 'object' && !Array.isArray(c.headers)
        ? c.headers
        : { 'content-type': 'application/json' },
      { ...v, apikey: v.apikey ?? String(c.api_key || '') },
    ) as Record<string, string>
    const body = isPost && c.body != null ? JSON.stringify(deepApplyVars(c.body, { ...v, apikey: v.apikey ?? String(c.api_key || '') })) : undefined
    const res = await fetch(url, {
      method: isPost ? 'POST' : 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    })
    const rawBody = await res.text().catch(() => '')
    let json: any = null
    try {
      json = rawBody ? JSON.parse(rawBody) : null
    } catch {}
    const path = String(c.data_path || 'data')
    let value: any = json
    for (const seg of path.split('.')) {
      if (value == null) break
      value = value[seg]
    }
    const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
    if (!res.ok) {
      // 上游错误原因透明化: data_path 在错误响应上通常提取为空, 回退 error/message 字段与原始响应体, 否则只看到状态码无从排查
      const fallback = String(json?.error || json?.message || rawBody || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200)
      const detail = text || fallback
      return { ok: false, text, status: res.status, message: `接口返回 ${res.status}${detail ? `: ${detail}` : ''}` }
    }
    return {
      ok: !!text,
      text,
      status: res.status,
      message: text ? '提取成功' : `响应里没有 ${path} 字段内容`,
    }
  } catch (e: any) {
    return { ok: false, text: '', status: 0, message: e?.message || '请求失败' }
  }
}
