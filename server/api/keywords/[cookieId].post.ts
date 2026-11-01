/** POST /api/keywords/:cookieId — add a keyword. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    const db = await getDb()
    const body = await readBody(event) || {}

    const keyword = (body.keyword || '').toString().trim()
    const reply = (body.reply || '').toString().trim()
    if (!keyword) throw new ApiError(400, '关键词不能为空')
    if (!reply && !body.image_url) throw new ApiError(400, '回复内容不能为空')

    const item_id = (body.item_id || '').toString().trim()
    const type = (body.type || 'text').toString() === 'image' ? 'image' : 'text'
    const image_url = (body.image_url || '').toString().trim() || null
    // 延迟回复 (秒, 默认 10): 命中后延迟发送, 窗口内人工回复则取消 (brain.delayedReplyWait)
    const delay_seconds = Math.min(Math.max(Math.round(Number(body.delay_seconds ?? 10) || 0), 0), 300)

    const r = await db.run(
      `INSERT INTO keywords (cookie_id, keyword, reply, item_id, type, image_url, delay_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cookieId, keyword, reply, item_id, type, image_url, delay_seconds],
    )

    return ok({ id: r.lastInsertId }, '关键词已添加')
  }),
)
