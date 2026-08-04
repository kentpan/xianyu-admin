/**
 * Audit log helper — records who did what, when.
 * Single source of truth for operation tracking. Auto-creates the table on first use.
 */

let _ensured = false

export async function ensureTable() {
  if (_ensured) return
  _ensured = true
  const db = await getDb()
  await db.exec(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username VARCHAR(64),
    action VARCHAR(64) NOT NULL,
    module VARCHAR(64),
    target_type VARCHAR(32),
    target_id VARCHAR(128),
    description TEXT,
    ip_address VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {})
}

/**
 * Record an audit log entry. Call from any API handler after a successful mutation.
 * @example await auditLog(event, { action: 'create', module: 'accounts', targetType: 'cookie', targetId: id, desc: '新增账号 acc_001' })
 */
export async function auditLog(
  event: any,
  opts: {
    action: string
    module?: string
    targetType?: string
    targetId?: string | number
    desc?: string
  },
) {
  try {
    await ensureTable()
    const db = await getDb()
    // Get user from JWT payload (already validated by requireUser in the handler)
    const token = extractToken(event)
    const payload = token ? verifyToken(token) : null
    const ip = getRequestIP(event, { xForwardedFor: true }) || ''
    const ua = getHeader(event, 'user-agent') || ''

    await db.run(
      `INSERT INTO audit_logs (user_id, username, action, module, target_type, target_id, description, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload?.userId || null,
        payload?.username || null,
        opts.action,
        opts.module || null,
        opts.targetType || null,
        opts.targetId != null ? String(opts.targetId) : null,
        opts.desc || null,
        ip,
        ua.slice(0, 500),
      ],
    )
  } catch (e) {
    // audit logging should never break the main operation
    console.log('[auditLog] error:', e)
  }
}
