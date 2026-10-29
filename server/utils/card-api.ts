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

/**
 * 按 api_config 配置请求外部接口并提取发货文本。
 * conf: { url, method?, headers?, body?, data_path? } — data_path 默认 'data',
 * 如 cards-hub 的 /api/issue 响应用 data.url 取加密提取页链接。
 */
export async function fetchApiCardContent(conf: unknown): Promise<ApiCardFetchResult> {
  const c = (conf && typeof conf === 'object' ? conf : {}) as Record<string, unknown>
  const url = String(c.url || '').trim()
  if (!url) return { ok: false, text: '', status: 0, message: '缺少 url' }

  try {
    const isPost = String(c.method || 'GET').toUpperCase() === 'POST'
    const headers =
      c.headers && typeof c.headers === 'object' && !Array.isArray(c.headers)
        ? (c.headers as Record<string, string>)
        : { 'content-type': 'application/json' }
    const res = await fetch(url, {
      method: isPost ? 'POST' : 'GET',
      headers,
      body: isPost && c.body != null ? JSON.stringify(c.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    const json: any = await res.json().catch(() => null)
    const path = String(c.data_path || 'data')
    let value: any = json
    for (const seg of path.split('.')) {
      if (value == null) break
      value = value[seg]
    }
    const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
    if (!res.ok) {
      return { ok: false, text, status: res.status, message: `接口返回 ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}` }
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
