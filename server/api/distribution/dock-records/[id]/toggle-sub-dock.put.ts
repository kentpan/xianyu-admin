/**
 * PUT /api/distribution/dock-records/:id/toggle-sub-dock — 一级对接记录开启/关闭二级分销
 *
 * Body: { allow: boolean, sub_dock_price?, sub_dock_visibility? }
 * 仅一级对接记录创建者或管理员可操作
 * 关闭时同时禁用所有引用此一级记录的二级对接记录
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的对接记录 ID')
    const db = await getDb()
    const body = await readBody(event) || {}

    const dock = await db.get<{ id: number; user_id: number; level: number }>(
      'SELECT id, user_id, level FROM dock_records WHERE id = ?',
      [id],
    )
    if (!dock) throw new ApiError(404, '对接记录不存在')
    if (dock.level !== 1) throw new ApiError(400, '仅一级对接记录可开启二级分销')

    if (dock.user_id !== payload.userId && !payload.isAdmin) {
      throw new ApiError(403, '无权修改该对接记录')
    }

    const allow = !!body.allow
    const subDockPrice = body.sub_dock_price !== undefined ? String(body.sub_dock_price) : null
    const subDockVisibility =
      body.sub_dock_visibility && ['public', 'dealer_only'].includes(String(body.sub_dock_visibility))
        ? String(body.sub_dock_visibility)
        : null

    if (allow && !subDockPrice) {
      throw new ApiError(400, '开启二级分销时必须指定 sub_dock_price')
    }

    await db.transaction(async () => {
      await db.run(
        `UPDATE dock_records
         SET allow_sub_dock = ?, sub_dock_price = ?, sub_dock_visibility = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [allow ? 1 : 0, allow ? subDockPrice : null, allow ? subDockVisibility : null, id],
      )

      if (!allow) {
        // 关闭时禁用所有引用此一级记录的二级对接记录
        await db.run(
          `UPDATE dock_records SET status = 0, disable_reason = '一级关闭二级分销', updated_at = CURRENT_TIMESTAMP
           WHERE parent_dock_id = ?`,
          [id],
        )
      }
    })

    return ok({ id, allow_sub_dock: allow, sub_dock_price: subDockPrice, sub_dock_visibility: subDockVisibility }, '已更新')
  }),
)
