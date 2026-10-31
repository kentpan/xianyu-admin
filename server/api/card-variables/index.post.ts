/** POST /api/card-variables — 新增自定义变量 (var_key 唯一, builtin 固定值变量用 sample_value)。 */
const VAR_KEY_RE = /^\w{1,64}$/

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const varKey = (body.var_key || '').toString().trim()
    const label = (body.label || '').toString().trim()
    if (!VAR_KEY_RE.test(varKey)) throw new ApiError(400, '变量名只能包含字母/数字/下划线 (1-64 位)')
    if (!label) throw new ApiError(400, '变量显示名不能为空')
    const category = ['item', 'account', 'code', 'api', 'custom'].includes(String(body.category))
      ? String(body.category)
      : 'custom'

    const dup = await db.get<{ id: number }>('SELECT id FROM card_variables WHERE var_key = ?', [varKey])
    if (dup) throw new ApiError(400, `变量名 {${varKey}} 已存在`)

    const r = await db.run(
      `INSERT INTO card_variables (var_key, label, category, description, sample_value, builtin, enabled, sort)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        varKey,
        label,
        category,
        (body.description || '').toString().slice(0, 500),
        (body.sample_value ?? '').toString().slice(0, 2000),
        body.enabled === false || body.enabled === 0 ? 0 : 1,
        Math.round(Number(body.sort ?? 100)) || 100,
      ],
    )
    return ok({ id: r.lastInsertId }, '变量已新增')
  }),
)
