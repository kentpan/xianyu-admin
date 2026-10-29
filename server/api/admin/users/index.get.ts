/** GET /api/admin/users — list all users. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const rows = await db.all(
      `SELECT id, username, email, is_active, is_admin, created_at, updated_at
       FROM users ORDER BY created_at ASC`,
    )
    return ok(rows)
  }),
)
