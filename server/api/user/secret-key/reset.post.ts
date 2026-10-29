/**
 * POST /api/user/secret-key/reset — 重置提货秘钥
 *
 * 重置后旧秘钥立即失效, 之前发出的提货链接将无法使用
 */

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    const newKey = await generateUniqueSecretKey(db)
    await db.run('UPDATE users SET secret_key = ? WHERE id = ?', [newKey, payload.userId])

    return ok({ secret_key: newKey }, '提货秘钥已重置, 旧秘钥立即失效')
  }),
)
