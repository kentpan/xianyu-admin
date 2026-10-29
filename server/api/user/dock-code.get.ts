/**
 * GET /api/user/dock-code — 获取我的对接码 (自动生成)
 */

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const dockCode = await getOrCreateDockCode(db, payload.userId)
    return ok({ dock_code: dockCode })
  }),
)
