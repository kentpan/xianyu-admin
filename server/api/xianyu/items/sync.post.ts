/**
 * POST /api/xianyu/items/sync — 用 cookie 调闲鱼商品列表 API, 同步到 item_info 表。
 * Body: { cookie_id }
 * 流程: 加载 cookie → 解析 unb 作为 userId → 分页拉取 → upsert item_info → 回写轮换后的 cookie。
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const body = await readBody(event)
    const cookieId = String(body?.cookie_id || '').trim()
    if (!cookieId) throw new ApiError(400, 'cookie_id 不能为空')

    const row = await db.get<any>(
      'SELECT id, value, user_id, xianyu_uid, remark FROM cookies WHERE id = ?',
      [cookieId],
    )
    if (!row) throw new ApiError(404, '账号不存在')
    if (!payload.isAdmin && row.user_id !== payload.userId) throw new ApiError(403, '无权操作此账号')
    if (!row.value) throw new ApiError(400, '账号 Cookie 为空')

    // 从 cookie 解析 unb (闲鱼数字 uid)
    // parseCookieStr + fetchItemList are auto-imported by Nitro from server/utils/xianyu/mtop.ts
    const jar = parseCookieStr(row.value)
    const unb = jar.get('unb') || row.xianyu_uid || ''
    if (!unb) throw new ApiError(400, 'Cookie 中缺少 unb, 无法确定闲鱼 uid, 请重新扫码登录')

    const { items, finalCookieStr } = await fetchItemList(row.value, String(unb), 10)

    // upsert 到 item_info
    let upserted = 0
    for (const it of items) {
      await db.run(
        `INSERT INTO item_info (cookie_id, item_id, item_title, item_description, item_category, item_price, item_detail, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(cookie_id, item_id) DO UPDATE SET
           item_title = excluded.item_title,
           item_description = excluded.item_description,
           item_category = excluded.item_category,
           item_price = excluded.item_price,
           item_detail = excluded.item_detail,
           updated_at = CURRENT_TIMESTAMP`,
        [cookieId, it.item_id, it.item_title, it.item_description, it.item_category, it.item_price, it.pic_url],
      )
      upserted++
    }

    // 回写轮换后的 cookie (含新的 _m_h5_tk)
    if (finalCookieStr && finalCookieStr !== row.value) {
      await db.run('UPDATE cookies SET value = ? WHERE id = ?', [finalCookieStr, cookieId])
    }

    await auditLog(event, {
      action: 'sync',
      module: 'xianyu-items',
      targetType: 'cookie',
      targetId: cookieId,
      desc: `同步闲鱼商品 ${upserted} 件`,
    })

    return ok({ synced: upserted, total: items.length }, `已同步 ${upserted} 件商品`)
  }),
)
