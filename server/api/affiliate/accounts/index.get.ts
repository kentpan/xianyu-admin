/** GET /api/affiliate/accounts — 列出当前用户的联盟账号 (脱敏凭据)。 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const rows = await db.all<any>(
      'SELECT id, user_id, network_id, display_name, credentials, enabled, remark, last_sync_at, created_at, updated_at FROM affiliate_accounts WHERE user_id = ? ORDER BY created_at DESC',
      [payload.userId],
    )
    // 脱敏: password 类型字段显示为 ******, 其余保留
    const { getNetworkById } = await import('../../../utils/affiliate-networks')
    const safe = rows.map((r) => {
      const net = getNetworkById(r.network_id)
      const creds: Record<string, string> = {}
      try {
        const raw = JSON.parse(r.credentials || '{}')
        for (const f of net?.fields || []) {
          if (f.type === 'password' && raw[f.key]) {
            creds[f.key] = '******'
          } else {
            creds[f.key] = raw[f.key] || ''
          }
        }
      } catch { creds._error = 'invalid credentials' }
      return { ...r, credentials: creds, network_name: net?.nameCn || net?.name || r.network_id, network_meta: net }
    })
    return ok(safe)
  }),
)
