/**
 * GET /api/user/secret-key — 获取我的提货秘钥 (自动生成)
 */

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const secretKey = await getOrCreateSecretKey(db, payload.userId)
    return ok({ secret_key: secretKey })
  }),
)
