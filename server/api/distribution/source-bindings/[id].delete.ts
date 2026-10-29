/**
 * DELETE /api/distribution/source-bindings/:id — 取消对接码绑定
 *
 * 级联: 同时删除该上货主下, 当前用户的所有对接记录 (dock_records.user_id=current AND card.user_id=target_user_id)
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的绑定 ID')
    const db = await getDb()

    const binding = await db.get<{ id: number; user_id: number; target_user_id: number }>(
      'SELECT id, user_id, target_user_id FROM dock_code_bindings WHERE id = ?',
      [id],
    )
    if (!binding) throw new ApiError(404, '绑定记录不存在')
    if (binding.user_id !== payload.userId && !payload.isAdmin) {
      throw new ApiError(403, '无权删除该绑定')
    }

    await db.transaction(async () => {
      // 删除当前用户对接该上货主卡券的所有 dock_record (一级 + 二级)
      // 一级: 直接删除
      await db.run(
        `DELETE FROM dock_records
         WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE user_id = ?)`,
        [binding.user_id, binding.target_user_id],
      )
      // 删除绑定
      await db.run('DELETE FROM dock_code_bindings WHERE id = ?', [id])
    })

    return ok({ id }, '已取消绑定')
  }),
)
