/**
 * xianyu/cookie-store — 账号 Cookie 的唯一写入出口 (轮换合并)。
 *
 * 一个账号的 Cookie 有多个并发轮换来源: 监听引擎 3 分钟 token 保活 / 30 分钟 web 会话保活 /
 * 后台发货·拉单·拉详情等 mtop 调用 / 远程代理上报。各处直接 `UPDATE cookies SET value = ?`
 * 覆盖时, 晚到的旧快照会把刚轮换的新 Cookie 顶掉 (_m_h5_tk 与 _m_h5_tk_enc 成对失效),
 * 监听被踢下线、后台发货带着过期 Cookie 被平台拒绝。
 *
 * 口径: base = 本次请求实际使用的快照, next = 响应 Set-Cookie 合并后的快照。
 * 库里仍是 base → 写 next; 库里已被其它链路改成 current → 只把本次观测到的变化项合并进 current。
 */
import { parseCookieStr, cookieHeader } from './mtop'

function logWarn(msg: string): void {
  console.log(`[xianyu-cookie] ${msg}`)
}

type DbLike = {
  get: <T = any>(sql: string, params?: any[]) => Promise<T | null>
  run: (sql: string, params?: any[]) => Promise<unknown>
}

function readCurrent(db: DbLike, cookieId: string): Promise<string> {
  return db
    .get<{ value: string }>('SELECT value FROM cookies WHERE id = ?', [cookieId])
    .then((row) => String(row?.value || ''))
}

async function writeValue(db: DbLike, cookieId: string, value: string): Promise<void> {
  try {
    await db.run('UPDATE cookies SET value = ? WHERE id = ?', [value, cookieId])
  } catch (e: any) {
    // Cookie 落库失败不影响本次业务请求的返回值 (调用方已持有可用快照),
    // 但必须可见: 静默失败会让保活轮换在下一次请求时白做一次。
    logWarn(`[${cookieId}] Cookie 轮换落库失败: ${String(e?.message || e).slice(0, 160)}`)
  }
}

/** 持久化一次 Cookie 轮换, 返回最终落库值 (调用方后续请求应使用它)。 */
export async function persistCookieRotation(
  db: DbLike,
  cookieId: string,
  base: string,
  next: string,
): Promise<string> {
  if (!cookieId || !next || next === base) return next || base

  const current = await readCurrent(db, cookieId)
  let value = next
  if (current && current !== base) {
    const baseJar = parseCookieStr(base)
    const nextJar = parseCookieStr(next)
    const currentJar = parseCookieStr(current)
    for (const [k, v] of nextJar) {
      if (baseJar.get(k) !== v) currentJar.set(k, v)
    }
    value = cookieHeader(currentJar)
  }

  if (value !== current) await writeValue(db, cookieId, value)
  return value
}

/**
 * 外部上报的完整 Cookie jar (远程代理是唯一持有活跃会话的一方) 合并进库内值。
 * 逐 key 覆盖: 上报方持有的字段以它为准, 库内其它字段原样保留 —
 * 代理的 jar 可能不含后台 mtop 刚换到的 token, 整串覆盖会把新 token 顶回旧的。
 */
export async function mergeReportedCookies(db: DbLike, cookieId: string, reported: string): Promise<void> {
  if (!cookieId || !reported) return
  const current = await readCurrent(db, cookieId)
  if (!current) {
    await writeValue(db, cookieId, reported)
    return
  }
  const jar = parseCookieStr(current)
  let changed = false
  for (const [k, v] of parseCookieStr(reported)) {
    if (jar.get(k) !== v) {
      // (v2.3.8) 空值覆盖守卫: 上报方把已有非空字段清成空值 = 会话清理指令 (合并缺陷/
      // 风控响应), 采纳会把 unb/cookie2 等身份字段清空 — 配置重新下发毒化 Cookie,
      // 客户端构造函数 (Cookie 缺少 unb) 恒抛异常, 账号永久无法建连。拒绝空值覆盖,
      // 库内真源保持完整; 真实登录态变更由重新扫码全量覆盖, 不走逐 key 合并。
      if (!v && jar.get(k)) continue
      jar.set(k, v)
      changed = true
    }
  }
  if (changed) await writeValue(db, cookieId, cookieHeader(jar))
}
