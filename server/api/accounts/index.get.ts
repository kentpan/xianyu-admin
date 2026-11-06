/** GET /api/accounts — list cookies joined with cookie_status + keyword count.
 *
 * Visibility:
 *   - admin users see ALL cookies (legacy behaviour)
 *   - regular users see only their own cookies (filtered by user_id)
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    const params: any[] = []
    let where = ''
    if (!payload.isAdmin) {
      where = 'WHERE c.user_id = ?'
      params.push(payload.userId)
    }

    const rows: any[] = await db.all(
      `SELECT
        c.id,
        SUBSTR(c.value, 1, 24) AS value_preview,
        c.user_id,
        c.auto_confirm,
        c.remark,
        c.pause_duration,
        c.username,
        c.created_at,
        c.login_type,
        c.xianyu_uid,
        c.avatar,
        c.cookie_status_text,
        c.last_check_at,
        COALESCE(cs.enabled, 1) AS enabled,
        (SELECT COUNT(*) FROM keywords k WHERE k.cookie_id = c.id) AS keyword_count
      FROM cookies c
      LEFT JOIN cookie_status cs ON cs.cookie_id = c.id
      ${where}
      ORDER BY c.created_at DESC`,
      params,
    )

    // (v2.3.4) 引擎账号心跳快照合并 (输出层, 不动表): 代理状态心跳自 v2.3.4 起写单行
    // 快照, cookies 逐账号行仅在状态变化时落库 — 账号页监听徽章 (listenerBadge) 消费
    // last_check_at 60s 新鲜度, 快照新鲜时以快照值覆盖输出 (与监听页判定同源同语义);
    // 快照缺失/陈旧 (旧版代理) 时维持 cookies 原值, 完全兼容。
    let hbSnap: Record<string, { t: number; s: string }> | null = null
    try {
      const hbRow = await db.get<{ value: string }>(
        "SELECT value FROM system_settings WHERE key_name = 'engine_account_heartbeat'",
      )
      if (hbRow?.value) {
        const parsed = JSON.parse(String(hbRow.value))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) hbSnap = parsed
      }
    } catch {
      /* 快照缺失/损坏 → 维持 cookies 原值 */
    }
    if (hbSnap) {
      const nowMs = Date.now()
      const FRESH_MS = 60_000
      // 快照时间戳 → SQLite CURRENT_TIMESTAMP 同格式 (前端按 +Z 解析)
      const fmtTs = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        if (Number(r.enabled) === 0) continue
        const hb = hbSnap[String(r.id)]
        if (!hb || !Number.isFinite(hb.t) || nowMs - hb.t >= FRESH_MS) continue
        rows[i] = {
          ...r,
          cookie_status_text: hb.s || r.cookie_status_text,
          last_check_at: fmtTs(hb.t),
        }
      }
    }

    return ok(rows)
  }),
)
