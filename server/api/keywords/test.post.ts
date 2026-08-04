/**
 * POST /api/keywords/test — test keyword matching against a sample message.
 * Body: { cookie_id, message }
 * Returns matched keywords with their reply text.
 *
 * Matching rules (mirrors the source xianyu-super-butler logic):
 *  - Exact match: message === keyword
 *  - Contains match: message includes keyword (case-insensitive)
 *  - If keyword starts with '*', treat as suffix match (message ends with keyword[1:])
 *  - If keyword ends with '*', treat as prefix match (message starts with keyword[:-1])
 *  - If keyword starts and ends with '*', treat as contains match
 *  - item_id-bound keywords only match for that item (returned separately)
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const body = await readBody(event)
    const { cookie_id, message } = body || {}
    if (!cookie_id) throw new ApiError(400, '请选择账号')
    if (!message || typeof message !== 'string') throw new ApiError(400, '请输入测试消息')

    const db = await getDb()
    const keywords = await db.all<{
      id: number; keyword: string; reply: string; item_id: string; type: string; image_url: string | null
    }>(
      'SELECT id, keyword, reply, item_id, type, image_url FROM keywords WHERE cookie_id=?',
      [cookie_id],
    ).catch(() => [])

    const msg = message.trim().toLowerCase()
    const matched: { id: number; keyword: string; reply: string; type: string; item_id: string; matchType: string }[] = []

    for (const kw of keywords) {
      const k = (kw.keyword || '').trim().toLowerCase()
      if (!k) continue
      let isMatch = false
      let matchType = ''

      if (k.startsWith('*') && k.endsWith('*') && k.length > 2) {
        // contains match
        if (msg.includes(k.slice(1, -1))) { isMatch = true; matchType = '包含' }
      } else if (k.startsWith('*')) {
        // suffix match
        if (msg.endsWith(k.slice(1))) { isMatch = true; matchType = '后缀' }
      } else if (k.endsWith('*')) {
        // prefix match
        if (msg.startsWith(k.slice(0, -1))) { isMatch = true; matchType = '前缀' }
      } else {
        // exact or contains
        if (msg === k) { isMatch = true; matchType = '精确' }
        else if (msg.includes(k)) { isMatch = true; matchType = '包含' }
      }

      if (isMatch) {
        matched.push({
          id: kw.id,
          keyword: kw.keyword,
          reply: kw.reply,
          type: kw.type,
          item_id: kw.item_id || '',
          matchType,
        })
      }
    }

    // Also check default reply
    const defaultReply = await db.get<{ enabled: number; reply_content: string; reply_image_url: string | null }>(
      'SELECT enabled, reply_content, reply_image_url FROM default_replies WHERE cookie_id=?',
      [cookie_id],
    ).catch(() => null)

    return ok({
      matched,
      total: keywords.length,
      hasDefaultReply: !!defaultReply?.enabled && !!defaultReply?.reply_content,
      defaultReply: defaultReply?.reply_content || '',
    })
  }),
)
