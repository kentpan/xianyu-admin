/**
 * POST /api/xianyu/items/:itemId/refresh — 擦亮一个宝贝 (提升排名)。
 * Body: { cookie_id }
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const itemId = getRouterParam(event, 'itemId') || ''
    const body = await readBody(event)
    const cookieId = String(body?.cookie_id || '').trim()
    if (!itemId) throw new ApiError(400, 'itemId 不能为空')
    if (!cookieId) throw new ApiError(400, 'cookie_id 不能为空')

    const row = await db.get<any>(
      'SELECT id, value, user_id FROM cookies WHERE id = ?',
      [cookieId],
    )
    if (!row) throw new ApiError(404, '账号不存在')
    if (!payload.isAdmin && row.user_id !== payload.userId) throw new ApiError(403, '无权操作此账号')
    if (!row.value) throw new ApiError(400, '账号 Cookie 为空')

    // polishItem is auto-imported by Nitro from server/utils/xianyu/mtop.ts
    const result = await polishItem(row.value, itemId)

    // 回写轮换后的 cookie
    if (result.finalCookieStr && result.finalCookieStr !== row.value) {
      await db.run('UPDATE cookies SET value = ? WHERE id = ?', [result.finalCookieStr, cookieId])
    }

    await auditLog(event, {
      action: 'refresh',
      module: 'xianyu-items',
      targetType: 'item',
      targetId: itemId,
      desc: `擦亮宝贝 ${itemId}: ${result.message}`,
    })

    return ok({ success: result.success, message: result.message, alreadyPolished: result.alreadyPolished }, result.message)
  }),
)
