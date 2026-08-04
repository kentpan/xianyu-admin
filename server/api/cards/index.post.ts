/** POST /api/cards — create a new card. */
export default defineEventHandler(
  withApi(async (event) => {
    const u = requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const name = (body.name || '').toString().trim()
    const type = (body.type || '').toString().trim()
    if (!name) throw new ApiError(400, '卡券名称不能为空')
    if (!['api', 'text', 'data', 'image'].includes(type)) {
      throw new ApiError(400, '卡券类型无效，可选 api / text / data / image')
    }

    const r = await db.run(
      `INSERT INTO cards (
        name, type, api_config, text_content, data_content, image_url,
        description, enabled, delay_seconds, is_multi_spec, spec_name, spec_value, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        type,
        body.api_config ?? null,
        body.text_content ?? null,
        body.data_content ?? null,
        body.image_url ?? null,
        body.description ?? null,
        body.enabled === false || body.enabled === 0 ? 0 : 1,
        Number(body.delay_seconds ?? 0) || 0,
        body.is_multi_spec ? 1 : 0,
        body.spec_name ?? null,
        body.spec_value ?? null,
        u.userId,
      ],
    )

    return ok({ id: r.lastInsertId }, '卡券已创建')
  }),
)
