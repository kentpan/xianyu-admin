/**
 * proxy-mode — PROXY_MODE 运行时状态解析 (唯一真源)。
 *
 * 部署契约 (.github/workflows/pages-deploy.yml "Detect PROXY_MODE" 步骤):
 * 值非空且非 false/False/0 即代理透传模式; 值格式 `<apiKey>@<upstream>`
 * (apiKey@http(s)://host[:port], apiKey 属敏感值不落日志)。
 *
 * Next.js 形态由其专用适配层消费该配置; Nuxt 形态的消费方 (v2.3.12 补齐缺口):
 *   - server/middleware/proxy-passthrough.ts  /api/* 整体透传 (不触本地数据库)
 *   - server/plugins/init.ts                  透传模式无本地库, 跳过 schema 初始化
 *   - server/plugins/audit.ts                 透传模式站点不持有数据, 审计由上游负责
 *
 * workerd 说明: Cloudflare Pages env vars 经 nodejs_compat_populate_process_env
 * (compatibility_date >= 2025-04-01) 桥接进 process.env, 运行时读取即生效。
 * 解析结果按原始值缓存 (控制台轮换 env 后自动重新解析), 开关语义与工作流 Detect
 * 步骤逐字一致 (空/false/False/0 = 关闭)。
 */
export type ProxyModeState =
  | { kind: 'off'; raw: string }
  | { kind: 'on'; raw: string; apiKey: string; upstream: string; upstreamOrigin: string }
  | { kind: 'invalid'; raw: string; reason: string }

let _cache: { raw: string; state: ProxyModeState } | null = null

export function proxyModeState(): ProxyModeState {
  const raw = String(process.env.PROXY_MODE || '').trim().replace(/^["']|["']$/g, '')
  if (_cache && _cache.raw === raw) return _cache.state

  let state: ProxyModeState
  if (!raw || /^(false|0)$/i.test(raw)) {
    state = { kind: 'off', raw }
  } else {
    const at = raw.indexOf('@')
    const apiKey = at > 0 ? raw.slice(0, at).trim() : ''
    const upstream = at > 0 ? raw.slice(at + 1).trim() : ''
    let reason = ''
    if (at <= 0) reason = '缺少 <apiKey>@ 前缀'
    else if (!apiKey) reason = 'apiKey 为空'
    else if (!/^https?:\/\//i.test(upstream)) reason = '上游地址必须是 http(s):// 开头'
    else {
      try {
        const u = new URL(upstream)
        state = { kind: 'on', raw, apiKey, upstream, upstreamOrigin: u.origin }
      } catch {
        reason = '上游地址不是合法 URL'
      }
    }
    if (reason) state = { kind: 'invalid', raw, reason }
  }

  _cache = { raw, state }
  return state
}
