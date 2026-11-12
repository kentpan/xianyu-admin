/**
 * xianyu/site-origin — 本站对外 host 登记 + 代理回连目标站比对。
 *
 * 背景 (线上事故): 本地开发服务器连生产库启动时, 与生产后台共享同一份 engines /
 * engine_failover 状态 — 监听页照样显示代理「已连接」, 内置引擎的失联仲裁甚至代表
 * 生产站点抢走监听所有权 (owner=builtin → config.active=false 吊销线上代理授权),
 * 线上自动发货/消息/日志全链路静默且无恢复入口。
 *
 * 根治: 记录本进程实际对外的 host (来自真实请求的 Host 头), 代理配置轮询/事件上报
 * 写入 engines.last_poll_host (实际打到的站点)。两者不符 = 代理在服务别的站点:
 * 本进程绝不仲裁接管, 监听页不显示已连接。last_poll_host 为空 (代理从未回连) 时
 * 维持旧判定, 旧版代理与全新部署完全兼容。
 */

const g = globalThis as any
if (!g.__xianyuOwnSiteHosts) g.__xianyuOwnSiteHosts = new Set<string>()
const ownHosts = g.__xianyuOwnSiteHosts as Set<string>

/** host 规范化: 小写, 去端口斜杠尾部, 默认端口 (80/443) 剥离 — 与代理侧比对口径一致 */
export function normalizeSiteHost(rawHost: string): string {
  let host = String(rawHost || '').trim().toLowerCase()
  if (!host) return ''
  host = host.replace(/\/+$/, '').replace(/\.$/, '')
  try {
    const u = new URL(host.includes('://') ? host : `http://${host}`)
    let port = u.port
    if (port === '80' || port === '443') port = ''
    return port ? `${u.hostname}:${port}` : u.hostname
  } catch {
    return host
  }
}

/** 登记一个本站对外 host (来自真实请求: 浏览器管理请求 / 代理回连请求的 Host 头) */
export function noteOwnSiteHost(rawHost: string): void {
  const host = normalizeSiteHost(rawHost)
  if (host && !ownHosts.has(host)) {
    ownHosts.add(host)
    console.log(`[site-origin] 本站对外 host 登记: ${host}`)
  }
}

/** 本进程已登记的全部对外 host */
export function getOwnSiteHosts(): string[] {
  return [...ownHosts]
}

/** 是否本站 host: 命中任一已登记 host 即是; 未登记任何 host 时恒 false (保守不接管) */
export function isOwnSiteHost(rawHost: string): boolean {
  const host = normalizeSiteHost(rawHost)
  if (!host || !ownHosts.size) return false
  return ownHosts.has(host)
}
