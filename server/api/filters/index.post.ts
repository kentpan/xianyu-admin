/**
 * POST /api/filters — 新增消息过滤规则。
 * Body: { cookie_id, keyword, filter_type: 'skip_reply'|'skip_notify', enabled? }
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const cookie_id = (body.cookie_id || '').toString().trim()
    const keyword = (body.keyword || '').toString().trim()
    const filter_type = (body.filter_type || 'skip_reply').toString().trim()
    const enabled = body.enabled === undefined ? 1 : (body.enabled ? 1 : 0)

    if (!cookie_id) throw new ApiError(400, '缺少账号 (cookie_id)')
    if (!keyword) throw new ApiError(400, '缺少过滤关键词')
    if (!['skip_reply', 'skip_notify'].includes(filter_type)) {
      throw new ApiError(400, '过滤类型必须是 skip_reply 或 skip_notify')
    }

    const account = await db.get('SELECT id FROM cookies WHERE id = ?', [cookie_id])
    if (!account) throw new ApiError(404, '账号不存在')

    const dup = await db.get(
      'SELECT id FROM message_filters WHERE cookie_id = ? AND keyword = ? AND filter_type = ?',
      [cookie_id, keyword, filter_type],
    )
    if (dup) throw new ApiError(409, '该账号下已存在相同关键词与类型的过滤规则')

    const result = await db.run(
      'INSERT INTO message_filters (cookie_id, keyword, filter_type, enabled) VALUES (?, ?, ?, ?)',
      [cookie_id, keyword, filter_type, enabled],
    )

    return ok({ id: (result as any)?.lastInsertId ?? null }, '过滤规则已添加')
  }),
)
