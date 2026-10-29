/**
 * POST /api/api-keys — 新建业务方 API Key (仅管理员)。
 * Body: { name, rate_limit_num?, rate_limit_window?, remark?, enabled?, expires_at? }
 * Key 服务端生成 (xyk_ + 48 hex), 限速默认 30 次/60s, 有效期默认永久 (null)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const name = (body.name || '').toString().trim()
    if (!name) throw new ApiError(400, '请填写业务方名称')

    const dup = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM api_keys WHERE name = ?', [name])
    if (dup?.c) throw new ApiError(400, '已存在同名业务方')

    const rate_limit_num = Math.min(100000, Math.max(1, Math.round(Number(body.rate_limit_num ?? 30) || 30)))
    const rate_limit_window = Math.min(86400, Math.max(1, Math.round(Number(body.rate_limit_window ?? 60) || 60)))
    const enabled = body.enabled === false || body.enabled === 0 ? 0 : 1
    const remark = (body.remark || '').toString().trim().slice(0, 255)
    const { generateApiKey, normalizeApiKeyExpiry } = await import('../../utils/api-key-auth')
    const expires_at = normalizeApiKeyExpiry(body.expires_at)
    const api_key = generateApiKey()

    const r = await db.run(
      `INSERT INTO api_keys (name, api_key, rate_limit_num, rate_limit_window, enabled, remark, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, api_key, rate_limit_num, rate_limit_window, enabled, remark, expires_at],
    )
    return ok({ id: Number(r.lastInsertId), api_key }, 'API Key 已生成')
  }),
)
