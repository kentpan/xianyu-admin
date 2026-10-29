/** POST /api/affiliate/accounts — 新增/更新联盟账号凭据。 Body: { network_id, display_name?, credentials: {...}, remark? } */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const body = await readBody(event)
    const networkId = String(body?.network_id || '').trim()
    if (!networkId) throw new ApiError(400, 'network_id 不能为空')

    const { getNetworkById } = await import('../../../utils/affiliate-networks')
    const net = getNetworkById(networkId)
    if (!net) throw new ApiError(404, '联盟不存在')

    // 校验必填字段
    const creds: Record<string, string> = {}
    const rawCreds = body?.credentials || {}
    for (const f of net.fields) {
      const v = String(rawCreds[f.key] || '').trim()
      if (f.required && !v) throw new ApiError(400, `字段「${f.label}」不能为空`)
      if (v) creds[f.key] = v
    }

    const displayName = String(body?.display_name || net.nameCn || net.name).trim()
    const remark = String(body?.remark || '').trim()
    const credsJson = JSON.stringify(creds)

    // UPSERT (user_id + network_id 唯一)
    const existing = await db.get<any>(
      'SELECT id, credentials FROM affiliate_accounts WHERE user_id = ? AND network_id = ?',
      [payload.userId, networkId],
    )
    if (existing) {
      // 更新: password 字段如果是 ****** 则保留原值
      let finalCreds = creds
      try {
        const oldCreds = JSON.parse(existing.credentials || '{}')
        for (const f of net.fields) {
          if (f.type === 'password' && creds[f.key] === '******' && oldCreds[f.key]) {
            finalCreds[f.key] = oldCreds[f.key]
          }
        }
      } catch {}
      await db.run(
        'UPDATE affiliate_accounts SET display_name = ?, credentials = ?, remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [displayName, JSON.stringify(finalCreds), remark, existing.id],
      )
      await auditLog(event, { action: 'update', module: 'affiliate-accounts', targetType: 'affiliate-account', targetId: String(existing.id), desc: `更新联盟账号 ${displayName}` })
      return ok({ id: existing.id }, '账号已更新')
    }

    const r = await db.run(
      'INSERT INTO affiliate_accounts (user_id, network_id, display_name, credentials, remark) VALUES (?, ?, ?, ?, ?)',
      [payload.userId, networkId, displayName, credsJson, remark],
    )
    await auditLog(event, { action: 'create', module: 'affiliate-accounts', targetType: 'affiliate-account', targetId: String(r.lastInsertRowid), desc: `新增联盟账号 ${displayName}` })
    return ok({ id: r.lastInsertRowid }, '账号已添加')
  }),
)
