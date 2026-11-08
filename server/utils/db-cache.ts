/**
 * 进程内 TTL 查询缓存 (v2.3.5) — D1 免费层日读限额治理的核心手段。
 *
 * 背景: 工作台/通知等接口被前端轮询(原 30s/60s), 每次都打全表聚合
 * (GROUP BY / ORDER BY created_at)。表变大后一次轮询就是几千行读,
 * N 个标签页 × 2880 次/天 → 日读行数轻松破 500 万免费额度 → D1 拒读 →
 * 全站故障。本缓存把「同一 isolate 内 TTL 窗口内的重复请求」折叠为
 * 1 次真实查询; 配合前端轮询降频与 created_at 索引, 把日读量压回额度内。
 *
 * 语义: 只缓存只读聚合结果; TTL 到期后下一个请求触发后台重建。
 * 多 isolate 各自持缓存, 命中率随流量水平扩展, 无跨机失效问题
 * (聚合数据本就允许 ≤TTL 的陈旧度)。
 */

interface Entry {
  at: number
  value: unknown
}

const store = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()
const MAX_ENTRIES = 128

function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return
  // 简单 LRU 近似: 淘汰最早写入的条目
  const oldest = store.keys().next().value
  if (oldest !== undefined) store.delete(oldest)
}

/**
 * 带 TTL 的查询折叠。同 key 并发请求共享同一次真实查询 (inflight 去重)。
 * 查询失败不缓存, 直接向上抛 (绝不让故障结果驻留缓存)。
 */
export async function cachedQuery<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && now - hit.at < ttlMs) return hit.value as T

  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>

  const p = (async () => {
    try {
      const value = await fn()
      store.set(key, { at: Date.now(), value })
      evictIfNeeded()
      return value
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p as Promise<T>
}

/** 失效指定前缀的缓存 (写操作后调用, 可选; 聚合数据允许自然过期)。 */
export function invalidateDbCache(prefix?: string): void {
  if (!prefix) {
    store.clear()
    return
  }
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k)
  }
}
