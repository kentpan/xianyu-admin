/** GET /api/admin/backup/list — 备份列表 (R2 或本地快照目录)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const store = await getBackupStore(event)
    const items = await store.list()
    return ok({ driver: store.driver, storage: store.label, items })
  }),
)
