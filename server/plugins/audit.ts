/**
 * Audit Log Plugin — uses Nitro's `onAfterResponse` hook to automatically audit
 * ALL successful write operations (POST/PUT/DELETE) without requiring each
 * handler to call auditLog() manually.
 *
 * This is the single source of truth for operation tracking. It fires after
 * the response is sent, inspects the request + response status, and logs
 * the operation if it was a successful mutation.
 */
import { ensureTable } from '../utils/audit'

const SKIP_PATHS = [
  '/api/auth/verify',
  '/api/auth/logout',
  '/api/notifications/center/read',
  '/api/notifications/center/seed',
  '/api/system/status',
  '/api/settings/public',
  '/api/dashboard/',
  '/api/about/',
  '/api/accounts/health',
  '/api/audit/logs',
  '/api/export/',
]

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('afterResponse', async (event, { response }) => {
    try {
      const method = getMethod(event)
      if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) return

      const url = getRequestURL(event)
      const path = url.pathname
      if (!path.startsWith('/api/')) return

      const apiPath = path
      if (SKIP_PATHS.some((p) => apiPath.startsWith(p))) return

      // Only audit successful (2xx) responses (response may be undefined for some requests)
      const status = response?.status || getResponseStatus(event)
      if (status < 200 || status >= 300) return

      // Get user from JWT
      const token = extractToken(event)
      const payload = token ? verifyToken(token) : null
      if (!payload) return // don't audit unauthenticated requests

      await ensureTable()
      const db = await getDb()

      // Derive module + action from path + method
      const segs = apiPath.replace(/^\/api\//, '').split('/').filter(Boolean)
      const module = segs[0] || 'unknown'
      const action = method === 'POST' ? 'create'
        : method === 'PUT' || method === 'PATCH' ? 'update'
        : method === 'DELETE' ? 'delete'
        : 'write'

      // Extract target ID from path (last non-action segment)
      let targetId = ''
      for (let i = segs.length - 1; i >= 1; i--) {
        const seg = segs[i]
        if (['batch', 'import', 'export', 'status', 'auto-confirm', 'refresh', 'manual-ship', 'test', 'read', 'seed', 'login', 'register', 'change-password', 'clear'].includes(seg)) continue
        targetId = seg
        break
      }

      const ip = getRequestIP(event, { xForwardedFor: true }) || ''
      const ua = getHeader(event, 'user-agent') || ''
      const desc = `${action} ${module}${targetId ? `/${targetId}` : ''}`

      await db.run(
        `INSERT INTO audit_logs (user_id, username, action, module, target_type, target_id, description, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [payload.userId, payload.username, action, module, module, targetId || null, desc, ip, ua.slice(0, 500)],
      )
    } catch (e) {
      // audit logging should never break anything
      console.log('[audit plugin] error:', e)
    }
  })
})
