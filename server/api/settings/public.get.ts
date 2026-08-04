/** GET /api/settings/public — public system settings (no secrets) for the client. */
export default defineEventHandler(
  withApi(async () => {
    const config = useRuntimeConfig()
    return ok({
      installed: isInstalled(),
      appName: config.public.appName,
      appVersion: config.public.appVersion,
      brandColor: config.public.brandColor,
      settings: isInstalled() ? await getPublicSettings() : {},
    })
  }),
)
