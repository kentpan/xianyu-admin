/**
 * proxy-mode — PROXY_MODE 运行时状态解析 (唯一真源)。
 *
 * 部署契约 (.github/workflows/pages-deploy.yml "Detect PROXY_MODE" 步骤):
 * 值非空且非 false/False/0 即代理透传模式; 值格式 `<apiKey>@<upstream>`
 * (apiKey@http(s)://host[:port], apiKey 属敏感值不落日志)。
 *
 * Nuxt 形态的消费方 (v2.3.12 补齐缺口; v2.3.13 修正 env 读取通道):
 *   - server/middleware/proxy-passthrough.ts  /api/* 整体透传 (不触本地数据库)
 *   - server/middleware/install.ts            透传模式站点不持有数据, 跳过本地安装判定
 *   - server/plugins/init.ts                  透传模式无本地库, 跳过 schema 初始化
 *   - server/plugins/audit.ts                 透传模式站点不持有数据, 审计由上游负责
 *
 * env 读取通道 (v2.3.13 线上实锤修正): Cloudflare Pages 上 Nitro cloudflare-pages
 * 运行时把 Pages env vars 注入 event.context.cloudflare.env (onRequest 展开
 * _platform, nitropack runtime/internal/app.mjs #3335) 与 globalThis.__env__
 * (入口每请求设置) —— 与 server/utils/db.ts 获取 D1 binding 的通道完全一致;
 * 而 process.env 的填充依赖 workerd nodejs_compat_populate_process_env
 * (compatibility_date >= 2025-04-01) 的桥接行为, Pages 项目实际兼容日期不受
 * 代码控制时该通道不可靠 (线上实锤: Pages vars 已注入但 process.env 读不到,
 * 透传被误判关闭 → /api/* 落入本地处理器 → "D1 binding \"DB\" not found")。
 * 因此按「请求上下文 → 入口 env → process.env」顺序读取, 三通道同源于
 * Pages vars, 空值即回落; 启动期 (无请求上下文) 自动走 process.env (Node 语义),
 * 首个请求起以运行时真源为准。
 * 解析结果按原始值缓存 (值变化/控制台轮换后 isolate 重建自动重新解析),
 * 开关语义与工作流 Detect 步骤逐字一致 (空/false/False/0 = 关闭)。
 */
import type { H3Event } from 'h3'

export type ProxyModeState =
  | { kind: 'off'; raw: string }
  | { kind: 'on'; raw: string; apiKey: string; upstream: string; upstreamOrigin: string }
  | { kind: 'invalid'; raw: string; reason: string }

let _cache: { raw: string; state: ProxyModeState } | null = null

/**
 * PROXY_MODE 原始值多通道读取: 与 db.ts 获取 D1 binding 的通道语义严格一致
 * (请求上下文 cloudflare.env → globalThis.__env__ → process.env)。
 * 三通道同源于 Pages/Worker env vars, 空值即继续回落。
 */
function readProxyModeRaw(event?: H3Event): string {
  if (event) {
    const ctx = event.context as any
    const viaContext = ctx?.cloudflare?.env?.PROXY_MODE ?? ctx?._platform?.cloudflare?.env?.PROXY_MODE
    if (viaContext != null && String(viaContext) !== '') return String(viaContext)
  }
  const viaGlobal = (globalThis as any).__env__?.PROXY_MODE
  if (viaGlobal != null && String(viaGlobal) !== '') return String(viaGlobal)
  return String(process.env.PROXY_MODE || '')
}

export function proxyModeState(event?: H3Event): ProxyModeState {
  const raw = readProxyModeRaw(event).trim().replace(/^["']|["']$/g, '')
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
