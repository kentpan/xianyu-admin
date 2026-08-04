/** GET /api/cards — list all cards ordered by newest first. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const rows = await db.all(
      `SELECT id, name, type, api_config, text_content, data_content, image_url,
              description, enabled, delay_seconds, is_multi_spec, spec_name, spec_value,
              user_id, created_at, updated_at
       FROM cards
       ORDER BY created_at DESC`,
    )
    return ok(rows)
  }),
)
