/**
 * PUT /api/engines/:id — 编辑监听引擎 (名称/地址/端口/备注/启用/重置令牌)。
 * 内置引擎只允许改名称与备注。
 * Body 支持 regenerate_token: true → 重置该引擎 Bearer 令牌 (旧令牌即时作废)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的引擎 ID')
    const db = await getDb()

    const row = await db.get<any>('SELECT * FROM engines WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '引擎不存在')

    const body = await readBody(event) || {}

    if (body.regenerate_token) {
      const token = generateEngineToken()
      await db.run('UPDATE engines SET token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [token, id])
      const updated = await db.get<any>('SELECT * FROM engines WHERE id = ?', [id])
      return ok(updated, '接入令牌已重置, 请同步更新代理的 XY_ENGINE_TOKEN 环境变量')
    }

    const name = body.name !== undefined ? String(body.name).trim() : null
    if (name === '') throw new ApiError(400, '引擎名称不能为空')

    // (v2.2.2) 取消启用 = 立即退出「使用中」: is_active 不清零时配置接口仍按
    // is_active=1 持续下发账号 (代理继续监听/自动发货), 页面却显示已停用 —
    // 状态自相矛盾, 且该引擎会一直挡着「使用中」导致无法删除。
    let deactivated = false

    if (row.type === 'builtin') {
      await db.run(
        'UPDATE engines SET name = COALESCE(?, name), remark = COALESCE(?, remark), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [name, body.remark !== undefined ? String(body.remark).trim() : null, id],
      )
    } else {
      const host = body.host !== undefined ? String(body.host).trim() : null
      const port = body.port !== undefined ? Math.round(Number(body.port) || 0) : null
      const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : null
      await db.run(
        `UPDATE engines SET name = COALESCE(?, name), host = COALESCE(?, host),
           port = COALESCE(?, port), remark = COALESCE(?, remark), enabled = COALESCE(?, enabled),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [name, host, port, body.remark !== undefined ? String(body.remark).trim() : null, enabled, id],
      )

      if (enabled === 0 && row.is_active) {
        await db.run('UPDATE engines SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id])
        deactivated = true
      }
    }

    const updated = await db.get<any>('SELECT * FROM engines WHERE id = ?', [id])
    return ok(updated, deactivated ? '引擎已更新: 已停用并退出「使用中」, 监听由其它引擎自动接管' : '引擎已更新')
  }),
)
