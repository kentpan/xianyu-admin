/**
 * POST /api/user/dock-code/reset — 重置对接码
 *
 * 级联删除: 当前用户的 dock_code_bindings (作为 user_id 或 target_user_id) +
 *           当前用户的所有 dock_records
 */

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    const newCode = await db.transaction(async () => {
      // 删除当前用户作为 distributor 或 supplier 的所有绑定
      await db.run(
        'DELETE FROM dock_code_bindings WHERE user_id = ? OR target_user_id = ?',
        [payload.userId, payload.userId],
      )
      // 删除当前用户的所有对接记录 (一级 + 二级)
      await db.run('DELETE FROM dock_records WHERE user_id = ?', [payload.userId])
      // 生成新对接码
      const code = await generateUniqueDockCode(db)
      await db.run('UPDATE users SET dock_code = ? WHERE id = ?', [code, payload.userId])
      return code
    })

    return ok({ dock_code: newCode }, '对接码已重置, 旧绑定与对接记录已清空')
  }),
)
