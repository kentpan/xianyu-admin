/**
 * realtime — 实时推送通道桥接 (edge = Cloudflare Durable Object hub)。
 *
 * 三种运行时的实时数据面:
 *   - node            : 进程内事件总线 (im-store onImEvent) → /api/messages/stream SSE, 行为不变
 *   - workers(自承载) : 事件 isolate 与 WS 连接分属不同 isolate, 进程内总线跨不过去,
 *                       事件统一经 publishToHub 转发进 $DurableObject 单例广播
 *                       (nitro `cloudflare-durable` 预设自动导出, 绑定/类/实例名均为预设约定)
 *   - pages(配套模式) : Pages 项目不能在自身内承载 DO 类(平台限制), 由配套 edge-realtime
 *                       Worker 独立承载 DO hub; 站点经 REALTIME_DO 绑定(script_name)直呼其 DO
 *                       —— 广播走同一 publishToHub, WS 升级在 ws.get.ts 内转发进外部 DO
 */

export const REALTIME_DO_BINDING = '$DurableObject'
export const REALTIME_EXTERNAL_BINDING = 'REALTIME_DO'
export const REALTIME_DO_INSTANCE = 'server'

/** 当前 env 中的 DO hub 绑定(自承载优先, 配套模式其次); globalThis.__env__ 由 nitro 每次请求刷新。 */
export function realtimeHubBinding(): any | null {
  const env = (globalThis as any).__env__
  return env?.[REALTIME_DO_BINDING] || env?.[REALTIME_EXTERNAL_BINDING] || null
}

/** 是否部署在带 DO hub 的边缘环境 (决定前端实时通道形态 / system.status realtime 字段)。 */
export function isRealtimeHubEnabled(): boolean {
  return !!realtimeHubBinding()
}

/**
 * 把一帧推送扇出到 DO hub (fire-and-forget)。
 * node 运行时无 DO 绑定 → 静默跳过 (SSE 通道负责); 转发失败只丢弃本帧, 绝不影响业务主流程。
 * publish 路由两种承载同协议: 自承载 = nitro app 内 /api/realtime/publish (仅 DO isolate 生效);
 * 配套模式 = edge-realtime DO 原生实现同名路由 (外部直连该路由为 404, 不外泄)。
 */
export function publishToHub(payload: Record<string, any>): void {
  try {
    const binding = realtimeHubBinding()
    if (!binding) return
    const stub = binding.get(binding.idFromName(REALTIME_DO_INSTANCE))
    void stub
      .fetch('https://realtime.hub/api/realtime/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      .catch(() => {})
  } catch {}
}
