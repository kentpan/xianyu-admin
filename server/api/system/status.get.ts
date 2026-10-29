/** GET /api/system/status — public install/health probe. */
export default defineEventHandler(
  withApi(async (event) => {
    const config = useRuntimeConfig()
    const state = getRuntimeState()
    return ok({
      installed: await isInstalledAsync(event),
      driver: state.dbDriver || 'sqlite',
      appName: config.public.appName,
      appVersion: config.public.appVersion,
      runtime: detectRuntime(),
      // 实时通道形态: edge DO hub 部署 → 'ws' (WebSocket), 其余 → 'sse'
      realtime: isRealtimeHubEnabled() ? 'ws' : 'sse',
    })
  }),
)
