/** POST /api/accounts/:id/verify-cookie — lightweight cookie validity check.
 *
 * Strategy:
 *   1. GET `https://www.goofish.com/` with `redirect: 'manual'` so we can
 *      detect a 302 to passport (logged-out users get bounced there).
 *   2. If the response is a redirect to a passport URL → invalid.
 *   3. Otherwise (200), inspect the HTML body:
 *        - If it contains the user's `unb` value → logged in → valid.
 *        - Else if it contains `isLogin":true` or `"loginStatus":true` → valid.
 *        - Else if it contains `"isLogin":false` → invalid.
 *        - Else (ambiguous) → fall back to "valid" only if `unb` cookie
 *          is present in the stored cookie string.
 *
 * Updates `cookies.cookie_status_text` and `last_check_at`. Returns
 * `{ valid: boolean, checkedAt, reason }`.
 */
const VERIFY_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const db = await getDb()

    const cookie = await db.get<{ id: string; value: string; user_id: number; xianyu_uid: string }>(
      'SELECT id, value, user_id, xianyu_uid FROM cookies WHERE id = ?',
      [id],
    )
    if (!cookie) throw new ApiError(404, '账号不存在')
    if (!payload.isAdmin && cookie.user_id !== payload.userId) {
      throw new ApiError(403, '无权操作此账号')
    }

    const cookieValue = (cookie.value || '').trim()
    if (!cookieValue) {
      await markInvalid(db, id, 'cookie 内容为空')
      return ok({ valid: false, checkedAt: new Date().toISOString(), reason: 'cookie 内容为空' })
    }

    // Extract `unb` from the cookie string so we can match it against the page HTML.
    const unbFromCookie = extractCookieValue(cookieValue, 'unb') || cookie.xianyu_uid || ''

    let valid = false
    let reason = 'unknown'

    try {
      const res = await fetch('https://www.goofish.com/', {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': VERIFY_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Cookie: cookieValue,
        },
      })

      const status = res.status
      const location = res.headers.get('location') || ''

      // 3xx redirect to passport → logged out
      if (status >= 300 && status < 400 && /passport\.(goofish|taobao)\.com/i.test(location)) {
        valid = false
        reason = `重定向至登录页 (${status})`
      } else if (status === 200 || (status >= 300 && status < 400)) {
        const html = await res.text().catch(() => '')
        if (unbFromCookie && html.includes(`"unb":"${unbFromCookie}"`)) {
          valid = true
          reason = '页面包含当前 unb'
        } else if (/"isLogin"\s*:\s*true/i.test(html) || /"loginStatus"\s*:\s*true/i.test(html)) {
          valid = true
          reason = '页面标记 isLogin=true'
        } else if (/"isLogin"\s*:\s*false/i.test(html)) {
          valid = false
          reason = '页面标记 isLogin=false'
        } else if (unbFromCookie) {
          // Ambiguous HTML but unb is present → optimistically valid
          valid = true
          reason = 'cookie 含 unb（页面无明确登录标记）'
        } else {
          valid = false
          reason = '页面无登录信息且 cookie 缺少 unb'
        }
      } else {
        valid = false
        reason = `HTTP ${status}`
      }
    } catch (e: any) {
      valid = false
      reason = `校验请求失败: ${e?.message || String(e)}`
    }

    const checkedAt = new Date().toISOString()
    if (valid) {
      await db.run(
        `UPDATE cookies SET cookie_status_text = 'valid', last_check_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id],
      )
    } else {
      await db.run(
        `UPDATE cookies SET cookie_status_text = 'invalid', last_check_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id],
      )
    }

    await auditLog(event, {
      action: 'verify',
      module: 'accounts',
      targetType: 'cookie',
      targetId: id,
      desc: `Cookie 校验: ${valid ? '有效' : '无效'} (${reason})`,
    })

    return ok({ valid, checkedAt, reason })
  }),
)

/** Update cookie_status_text = 'invalid' + last_check_at without a network call. */
async function markInvalid(db: any, id: string, reason: string) {
  await db.run(
    `UPDATE cookies SET cookie_status_text = 'invalid', last_check_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [id],
  ).catch(() => {})
  // reason is logged via the caller — kept out of DB for simplicity
  void reason
}

/** Extract a single cookie value from a `k=v; k=v` string. */
function extractCookieValue(cookieString: string, name: string): string {
  const parts = cookieString.split(';')
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq <= 0) continue
    const k = p.slice(0, eq).trim()
    if (k === name) return p.slice(eq + 1).trim()
  }
  return ''
}
