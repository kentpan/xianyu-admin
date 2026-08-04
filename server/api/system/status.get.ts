/** GET /api/system/status — public install/health probe. */
export default defineEventHandler(
  withApi(async () => {
    const config = useRuntimeConfig()
    const state = getRuntimeState()
    return ok({
      installed: isInstalled(),
      driver: state.dbDriver || 'sqlite',
      appName: config.public.appName,
      appVersion: config.public.appVersion,
      runtime: detectRuntime(),
    })
  }),
)
