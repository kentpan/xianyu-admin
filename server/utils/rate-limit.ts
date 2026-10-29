/**
 * rate-limit — 进程内令牌桶限速 (引擎 API 防滥用 / 防重放风暴)。
 *
 * 用途: /api/engine/* (远程代理回连) 按令牌限速; 默认 120 次/分钟, 突发 40。
 * 超限返回 429 + Retry-After; 内存态随进程重启清零 (限速不落库, 避免写放大)。
 */

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitOptions {
  /** 桶容量 (突发上限)。 */
  capacity?: number
  /** 每分钟补充速率。 */
  perMinute?: number
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSeconds: number
}

export function consumeRate(key: string, opts: RateLimitOptions = {}): RateLimitResult {
  const capacity = Math.max(opts.capacity ?? 40, 1)
  const perMinute = Math.max(opts.perMinute ?? 120, 1)
  const refillPerMs = perMinute / 60_000

  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now }
    buckets.set(key, bucket)
  }
  bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.lastRefill) * refillPerMs)
  bucket.lastRefill = now

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return { ok: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 }
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000))
  return { ok: false, remaining: 0, retryAfterSeconds }
}

/** 定期清理不活跃桶 (10 分钟未使用即丢弃, 防内存膨胀)。 */
export function sweepStaleBuckets(maxIdleMs = 10 * 60_000): void {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > maxIdleMs) buckets.delete(key)
  }
}
