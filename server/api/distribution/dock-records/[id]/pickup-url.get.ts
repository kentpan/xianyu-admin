/**
 * GET /api/distribution/dock-records/:id/pickup-url — 获取对接记录的提货链接
 *
 * 返回 { url, secret_key }
 * URL 格式: /api/distribution/pickup?key=<secret_key>&dock_id=<id>
 * secret_key 来自对接记录创建者 (当前用户)
 */

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的对接记录 ID')
    const db = await getDb()

    const dock = await db.get<{ id: number; user_id: number; status: number }>(
      'SELECT id, user_id, status FROM dock_records WHERE id = ?',
      [id],
    )
    if (!dock) throw new ApiError(404, '对接记录不存在')

    if (dock.user_id !== payload.userId && !payload.isAdmin) {
      throw new ApiError(403, '无权查看该对接记录的提货链接')
    }

    const secretKey = await getOrCreateSecretKey(db, dock.user_id)
    const url = `/api/distribution/pickup?key=${secretKey}&dock_id=${id}`

    return ok({ url, secret_key: secretKey, dock_id: id })
  }),
)
