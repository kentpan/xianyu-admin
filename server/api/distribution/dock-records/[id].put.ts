/**
 * PUT /api/distribution/dock-records/:id — 更新自己的对接记录
 *
 * Body: { dock_name?, markup_amount?, remark?, status?, disable_reason? }
 * 仅创建者或管理员可操作
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的对接记录 ID')
    const db = await getDb()
    const body = await readBody(event) || {}

    const dock = await db.get<{ id: number; user_id: number }>(
      'SELECT id, user_id FROM dock_records WHERE id = ?',
      [id],
    )
    if (!dock) throw new ApiError(404, '对接记录不存在')

    if (dock.user_id !== payload.userId && !payload.isAdmin) {
      throw new ApiError(403, '无权修改该对接记录')
    }

    const fields: string[] = []
    const params: any[] = []

    if (body.dock_name !== undefined) {
      const n = String(body.dock_name).trim()
      if (!n) throw new ApiError(400, '对接名称不能为空')
      fields.push('dock_name = ?'); params.push(n)
    }
    if (body.markup_amount !== undefined) {
      fields.push('markup_amount = ?'); params.push(String(body.markup_amount))
    }
    if (body.remark !== undefined) {
      fields.push('remark = ?'); params.push(body.remark ? String(body.remark) : null)
    }
    if (body.status !== undefined) {
      fields.push('status = ?'); params.push(body.status ? 1 : 0)
    }
    if (body.disable_reason !== undefined) {
      fields.push('disable_reason = ?'); params.push(body.disable_reason ? String(body.disable_reason) : null)
    }

    if (!fields.length) throw new ApiError(400, '没有需要更新的字段')
    params.push(id)

    await db.run(
      `UPDATE dock_records SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params,
    )
    return ok({ id }, '已更新')
  }),
)
