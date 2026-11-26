/**
 * GET /api/kb — AI 知识库 (v2.4.0 商品分组模型) 全量数据。
 *
 * 分组 = 商品组: 成员是商品 (cookie_id + item_id), 多账号商品可同组, 同一商品可进多组。
 * AI 回复时按当前商品所属分组聚合读取组内全部商品的历史真实对话作知识库
 * (买家=客户 / 卖家, 排除自动发货回复与系统消息, 见 brain.loadGroupKbContext)。
 * 分组与成员为人工精选规模, 全量拉取最简单可靠; 成员行 LEFT JOIN item_info/cookies
 * 补齐商品标题与账号备注供前端展示。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    const [groups, members] = await Promise.all([
      db.all('SELECT id, name, sort, created_at, updated_at FROM kb_groups ORDER BY sort ASC, id ASC').catch(() => []),
      db
        .all(
          `SELECT gi.id, gi.group_id, gi.cookie_id, gi.item_id,
                  COALESCE(i.item_title, '') AS item_title,
                  COALESCE(c.remark, '') AS cookie_remark,
                  gi.created_at
           FROM kb_group_items gi
           LEFT JOIN item_info i ON i.cookie_id = gi.cookie_id AND i.item_id = gi.item_id
           LEFT JOIN cookies c ON c.id = gi.cookie_id
           ORDER BY gi.group_id ASC, gi.id ASC`,
        )
        .catch(() => []),
    ])

    return ok({
      groups,
      members,
      stats: {
        groups: groups.length,
        members: members.length,
      },
    })
  }),
)
