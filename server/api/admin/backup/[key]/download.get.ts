/** GET /api/admin/backup/:key/download — 下载一个备份对象 (原始字节流)。 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const key = decodeURIComponent(getRouterParam(event, 'key') || '')
  if (!key) throw new ApiError(400, '缺少备份文件名')
  const store = await getBackupStore(event)
  const data = await store.get(key)
  if (!data) throw new ApiError(404, `备份不存在: ${key}`)
  setHeader(event, 'content-type', key.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream')
  setHeader(event, 'content-disposition', `attachment; filename="${key}"`)
  setHeader(event, 'content-length', String(data.byteLength))
  return data
})
