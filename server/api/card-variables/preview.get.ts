/** GET /api/card-variables/preview — 变量配置弹窗的真实数据预览: 商品列表(带商品ID)/闲鱼账号/卡密样例。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    const items = await db
      .all(
        `SELECT i.item_id, i.item_title, i.item_price, i.item_description, c.remark AS account_remark, i.updated_at
         FROM item_info i LEFT JOIN cookies c ON c.id = i.cookie_id
         ORDER BY i.updated_at DESC LIMIT 30`,
      )
      .catch(() => [])
    const accounts = await db
      .all('SELECT id, username, remark FROM cookies ORDER BY created_at ASC LIMIT 30')
      .catch(() => [])
    const codes = await db
      .all('SELECT code, card_name, created_at FROM card_code_logs ORDER BY id DESC LIMIT 5')
      .catch(() => [])

    return ok({ items, accounts, codes })
  }),
)
