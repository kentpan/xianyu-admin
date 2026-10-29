/** GET /api/cards — list all cards ordered by newest first. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const rows = await db.all(
      `SELECT id, name, type, api_config, text_content, data_content, image_url,
              code_length, code_letters, code_digits, code_case, code_template,
              description, enabled, delay_seconds, is_multi_spec, spec_name, spec_value,
              price, is_dockable, fee_payer, min_price, dock_visibility,
              user_id, created_at, updated_at
       FROM cards
       ORDER BY created_at DESC`,
    )
    return ok(rows)
  }),
)
