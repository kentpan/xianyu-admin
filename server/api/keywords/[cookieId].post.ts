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
    // 回复随机延时 (秒; 都空/0=立即, min==max=固定, min<max=高斯随机)
    const delay_min = Math.max(0, Number(body.delay_min) || 0)
    const delay_max = Math.max(0, Number(body.delay_max) || 0)

    const r = await db.run(
      `INSERT INTO keywords (cookie_id, keyword, reply, item_id, type, image_url, delay_min, delay_max)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cookieId, keyword, reply, item_id, type, image_url, delay_min, delay_max],
    )

    return ok({ id: r.lastInsertId }, '关键词已添加')
  }),
)
