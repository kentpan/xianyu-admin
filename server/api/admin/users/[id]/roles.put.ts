/** PUT /api/admin/users/:id/roles — 替换用户的角色挂载 (RBAC 用户侧授权)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的用户 ID')
    const body = await readBody(event) || {}
    const db = await getDb()
    const user = await db.get('SELECT id FROM users WHERE id = ?', [id])
    if (!user) throw new ApiError(404, '用户不存在')
    const roleIds = Array.isArray(body.role_ids) ? body.role_ids.map((v: any) => Number(v)).filter((v: number) => v > 0) : []
    for (const rid of roleIds) {
      const exists = await db.get('SELECT id FROM roles WHERE id = ?', [rid])
      if (!exists) throw new ApiError(400, `角色不存在: #${rid}`)
    }
    await db.run('DELETE FROM user_roles WHERE user_id = ?', [id])
    for (const rid of roleIds) {
      await db.run('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, rid]).catch(() => {})
    }
    return ok({ id, role_ids: roleIds }, '用户角色已更新')
  }),
)
