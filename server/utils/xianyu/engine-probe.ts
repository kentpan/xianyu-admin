/**
 * xianyu/engine-probe — 远程代理登记地址的真实健康探测。
 *
 * 在线判定以登记 host:port 的 /health 实测为准, 而非令牌轮询心跳:
 * 轮询心跳只证明"某处有实例持有该令牌在回连", 地址可能是随便填的 —
 * 只有 /health 应答才能证明登记地址上的代理进程真实存活。
 *
 * 结果按 host:port 缓存 30s: 改地址立即换 key 重探, 页面刷新不触发探测风暴。
 */
export interface EngineProbeResult {
  ok: boolean
  /** 代理是否已拉到 active 配置 (false = 进程活着但未在服务, 常见为令牌不匹配/未激活) */
  engine_active?: boolean
  accounts?: { id: string; state: string }[]
  uptime_seconds?: number
  script_version?: string
  error?: string
}

const PROBE_TIMEOUT_MS = 2_500
const CACHE_TTL_MS = 30_000

const g = globalThis as any
if (!g.__xianyuEngineProbeCache) g.__xianyuEngineProbeCache = new Map<string, { at: number; result: EngineProbeResult }>()
const cache = g.__xianyuEngineProbeCache as Map<string, { at: number; result: EngineProbeResult }>

async function probeOnce(host: string, port: number): Promise<EngineProbeResult> {
  try {
    const res = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: 'manual',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body: any = await res.json().catch(() => null)
    if (!body || body.ok !== true) return { ok: false, error: '非健康检查应答' }
    return {
      ok: true,
      engine_active: !!body.engine_active,
      accounts: Array.isArray(body.accounts) ? body.accounts.slice(0, 20) : [],
      uptime_seconds: Math.round(Number(body.uptime_seconds) || 0),
      script_version: String(body.script_version || '').slice(0, 32),
    }
  } catch (e: any) {
    return { ok: false, error: String(e?.cause?.code || e?.name || e?.message || '不可达').slice(0, 80) }
  }
}

/** 单个地址探测 (30s 缓存)。 */
export async function probeRemoteEngine(host: string, port: number): Promise<EngineProbeResult> {
  const key = `${host}:${port}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result
  const result = await probeOnce(host, port)
  cache.set(key, { at: Date.now(), result })
  return result
}

/** 批量并发探测 (引擎列表 / 监听状态共用)。 */
export async function probeEngines(
  rows: { id: number; host: string; port: number }[],
): Promise<Map<number, EngineProbeResult>> {
  const out = new Map<number, EngineProbeResult>()
  await Promise.all(
    rows.map(async (r) => {
      out.set(r.id, await probeRemoteEngine(r.host, r.port))
    }),
  )
  return out
}
