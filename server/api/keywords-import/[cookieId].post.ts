/** POST /api/keywords-import/:cookieId — bulk import keywords. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    const db = await getDb()
    const body = await readBody(event) || {}
    const list: any[] = Array.isArray(body.keywords) ? body.keywords : (Array.isArray(body) ? body : [])

    if (list.length === 0) throw new ApiError(400, '没有可导入的关键词')

    let inserted = 0
    await db.transaction(async () => {
      for (const k of list) {
        const keyword = (k.keyword || '').toString().trim()
        const reply = (k.reply || '').toString().trim()
        if (!keyword || (!reply && !k.image_url)) continue
        const type = (k.type || 'text').toString() === 'image' ? 'image' : 'text'
        await db.run(
          `INSERT INTO keywords (cookie_id, keyword, reply, item_id, type, image_url)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [cookieId, keyword, reply, (k.item_id || '').toString().trim(), type, (k.image_url || '').toString().trim() || null],
        )
        inserted++
      }
    })

    return ok({ inserted, total: list.length }, `已导入 ${inserted} 条关键词`)
  }),
)
