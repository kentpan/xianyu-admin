/** GET /api/auth/menus — 当前登录用户的可见菜单 (SSR 中间件/侧边栏消费, 服务端权限过滤)。 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const menus = await getMenusForUser(db, payload.userId, payload.isAdmin)
    return ok({ menus })
  }),
)
