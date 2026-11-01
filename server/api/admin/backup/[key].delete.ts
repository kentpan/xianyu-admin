/** DELETE /api/admin/backup/:key — 删除一个备份对象。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const key = decodeURIComponent(getRouterParam(event, 'key') || '')
    if (!key) throw new ApiError(400, '缺少备份文件名')
    const store = await getBackupStore(event)
    const existed = (await store.list()).some((o) => o.key === key)
    if (!existed) throw new ApiError(404, `备份不存在: ${key}`)
    await store.delete(key)
    return ok({ key }, `备份已删除: ${key}`)
  }),
)
