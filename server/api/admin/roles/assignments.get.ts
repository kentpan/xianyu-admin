/** GET /api/admin/roles/assignments — 全量用户-角色挂载 (角色管理页分配面板)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const rows = await db.all(
      `SELECT ur.user_id, ur.role_id, u.username FROM user_roles ur JOIN users u ON u.id = ur.user_id`,
    )
    return ok({ assignments: rows })
  }),
)
