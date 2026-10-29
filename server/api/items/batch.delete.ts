/** DELETE /api/items/batch — batch delete items by ids[]. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}
    const ids: any[] = Array.isArray(body.ids) ? body.ids : []

    if (ids.length === 0) throw new ApiError(400, '请选择要删除的商品')

    const placeholders = ids.map(() => '?').join(',')
    const r = await db.run(
      `DELETE FROM item_info WHERE id IN (${placeholders})`,
      ids.map((x) => Number(x)),
    )

    return ok({ deleted: r.changes }, `已删除 ${r.changes} 件商品`)
  }),
)
