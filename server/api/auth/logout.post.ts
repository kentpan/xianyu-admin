/** POST /api/auth/logout — clear auth cookie. */
export default defineEventHandler(
  withApi(async (event) => {
    deleteCookie(event, 'admin_token', { path: '/' })
    return ok({}, '已退出登录')
  }),
)
