/**
 * POST /api/admin/backup/:key/restore — 把一个备份对象导入当前库 (按表 PK upsert)。
 * 与手动导入共用 backup-restore.restoreTables 语义。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const key = decodeURIComponent(getRouterParam(event, 'key') || '')
    if (!key) throw new ApiError(400, '缺少备份文件名')
    if (!key.endsWith('.json')) throw new ApiError(400, '仅支持导入 JSON 格式备份 (.json) — .sql/.db 请在本地工具执行后再用 JSON 导入回灌')
    const store = await getBackupStore(event)
    const data = await store.get(key)
    if (!data) throw new ApiError(404, `备份不存在: ${key}`)
    let parsed: any
    try {
      parsed = JSON.parse(new TextDecoder().decode(data))
    } catch (e: any) {
      throw new ApiError(400, `备份文件解析失败: ${String(e?.message || e)}`)
    }
    const incoming: Record<string, any[]> = parsed?.tables || parsed
    const db = await getDb()
    const report = await restoreTables(db, incoming)
    return ok({ key, report }, `备份 ${key} 已导入`)
  }),
)
