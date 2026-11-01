/** GET /api/card-variables — 卡券变量配置全量列表 (含未启用, 按分类+排序字段排列)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const rows = await db.all(
      'SELECT id, var_key, label, category, description, sample_value, builtin, enabled, sort FROM card_variables ORDER BY sort ASC, id ASC',
    )
    return ok(rows)
  }),
)
