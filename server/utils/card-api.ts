/**
 * card-api — API 类型卡券的配置拉取逻辑 (唯一实现)。
 * brain.ts 发货提取与 /api/cards/test-api 配置测试共用, 避免两处漂移。
 */
import type { DatabaseAdapter } from './db'

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

/**
 * 发货测试模拟上下文 (test-api 配置测试 / deliver-test 卡密发货测试共用, 与真实发货渲染同源):
 * 编辑已有卡券时取其发货规则绑定的商品 (item_id/title/price — 资源交付按 item_id 匹配绑定资源,
 * 用真实商品ID测试才能命中), 新卡券回落最新同步商品; 启用变量 (card_variables) 按分类填模拟值,
 * 自定义变量用其 sample_value。apikey 由调用方按需补 (API 卡券配置的密钥, 卡密型无需)。
 */
export async function buildCardMockVars(db: DatabaseAdapter, cardId?: number): Promise<ApiCardVars> {
  let item: { item_id: string; item_title: string; item_price: string } | null = null
  if (cardId) {
    const rule = await db
      .get<{ item_id: string }>(
        "SELECT item_id FROM delivery_rules WHERE card_id = ? AND item_id != '' ORDER BY id DESC LIMIT 1",
        [cardId],
      )
      .catch(() => null)
    if (rule?.item_id) {
      item = await db
        .get<{ item_id: string; item_title: string; item_price: string }>(
          'SELECT item_id, item_title, item_price FROM item_info WHERE item_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1',
          [rule.item_id],
        )
        .catch(() => null)
    }
  }
  if (!item) {
    item = await db
      .get<{ item_id: string; item_title: string; item_price: string }>(
        'SELECT item_id, item_title, item_price FROM item_info ORDER BY updated_at DESC, rowid DESC LIMIT 1',
      )
      .catch(() => null)
  }
  const enabledVars = await db
    .all<{ var_key: string; category: string; sample_value: string }>(
      "SELECT var_key, category, sample_value FROM card_variables WHERE enabled = 1 AND var_key != 'shareURL'",
    )
    .catch(() => [] as { var_key: string; category: string; sample_value: string }[])
  const mockVars: ApiCardVars = {
    title: String(item?.item_title || '测试商品'),
    price: String(item?.item_price || '9.9'),
    item_id: String(item?.item_id || 'test_item_id'),
    username: '测试买家',
    userid: 'test_buyer_id',
  }
  for (const v of enabledVars) {
    const key = String(v.var_key || '')
    if (!key || key in mockVars) continue
    if (v.category === 'item') {
      mockVars[key] = key === 'item_id' ? 'test_item_id' : key === 'quantity' ? '1' : `测试商品${key === 'desc' ? '描述' : key === 'detail' ? '详情' : key}`
    } else if (v.category === 'account') {
      mockVars[key] = key === 'seller_nick' ? '测试卖家' : key === 'seller_id' ? 'test_seller_id' : key === 'username' ? '测试买家' : 'test_buyer_id'
    } else if (v.category === 'code') {
      mockVars[key] = key === 'code' ? 'aB3x9K' : key === 'card_name' ? '测试卡券' : key === 'card_id' ? '1' : 'test_order_id'
    } else if (v.category === 'custom') {
      mockVars[key] = String(v.sample_value || '')
    }
  }
  return mockVars
}
