/**
 * TTL 内存缓存 (v2.3.5「D1 免费额度保卫战」)
 *
 * 服务端 isolate 级响应缓存: 同一 isolate 内多个请求/多个客户端标签页
 * 在 TTL 窗口内共享同一次查询结果 (single-flight, 并发请求只触发一次 DB 查询)。
 * 用于 dashboard 高频轮询端点 — 前端轮询间隔 × 服务端 TTL 双层节流,
 * 即使同 isolate 承载多个轮询源也不会放大 D1 行读。
 *
 * 容量封顶防泄漏: 超过 64 条时丢弃最旧条目 (按写入时间)。
 */

interface CacheEntry {
  at: number
  promise: Promise<any>
}

const store = new Map<string, CacheEntry>()
const MAX_ENTRIES = 64

/**
 * 带 TTL 的 promise 缓存。
 * - 命中且未过期 → 直接返回已缓存的 promise (包括它正在 pending 的状态)
 * - 失败的 promise 会立即出缓存, 下次调用重新执行 (不缓存错误)
 */
export function withTtlCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key)
  const now = Date.now()
  if (hit && now - hit.at < ttlMs) return hit.promise as Promise<T>

  const p = fn().catch((e) => {
    // 失败即出缓存: 下次请求重试, 不让一次抖动冻住整个 TTL 窗口
    if (store.get(key)?.promise === p) store.delete(key)
    throw e
  })
  if (store.size >= MAX_ENTRIES) {
    let oldestKey: string | null = null
    let oldestAt = Infinity
    for (const [k, v] of store) {
      if (v.at < oldestAt) {
        oldestAt = v.at
        oldestKey = k
      }
    }
    if (oldestKey) store.delete(oldestKey)
  }
  store.set(key, { at: now, promise: p })
  return p
}

/** 清空缓存 (测试/管理端手动刷新用) */
export function clearTtlCache(): void {
  store.clear()
}
