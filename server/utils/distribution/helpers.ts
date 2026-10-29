/**
 * 分销系统通用工具函数
 * - 生成对接码 / 提货秘钥
 * - 用户设置读写 (基于 user_settings 表)
 *
 * 约定: user_settings 表的 key 列名为 `key_name` (避免 MySQL 保留字冲突)
 */
import { randomBytes } from 'node:crypto'

const DOCK_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** 生成 8 位对接码 (A-Z, 0-9) */
export function genDockCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += DOCK_CODE_ALPHABET[bytes[i] % DOCK_CODE_ALPHABET.length]
  }
  return out
}

/** 生成 32 位十六进制提货秘钥 */
export function genSecretKey(): string {
  return randomBytes(16).toString('hex')
}

/** 读取用户设置 (不存在返回 null) */
export async function getUserSetting(
  db: DatabaseAdapter,
  userId: number,
  key: string,
): Promise<string | null> {
  const row = await db.get<{ value: string }>(
    'SELECT value FROM user_settings WHERE user_id = ? AND key_name = ?',
    [userId, key],
  )
  return row?.value ?? null
}

/** 写入用户设置 (UPSERT) */
export async function setUserSetting(
  db: DatabaseAdapter,
  userId: number,
  key: string,
  value: string,
): Promise<void> {
  await db.run(
    `INSERT INTO user_settings (user_id, key_name, value, created_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, key_name) DO UPDATE SET value = excluded.value`,
    [userId, key, value],
  )
}

/** 获取或自动生成对接码 */
export async function getOrCreateDockCode(
  db: DatabaseAdapter,
  userId: number,
): Promise<string> {
  const row = await db.get<{ dock_code: string | null }>(
    'SELECT dock_code FROM users WHERE id = ?',
    [userId],
  )
  if (!row) throw new Error('用户不存在')
  if (row.dock_code) return row.dock_code

  for (let i = 0; i < 5; i++) {
    const code = genDockCode()
    const exists = await db.get<{ id: number }>(
      'SELECT id FROM users WHERE dock_code = ?',
      [code],
    )
    if (!exists) {
      await db.run('UPDATE users SET dock_code = ? WHERE id = ?', [code, userId])
      return code
    }
  }
  throw new Error('生成对接码失败，请重试')
}

/** 获取或自动生成提货秘钥 */
export async function getOrCreateSecretKey(
  db: DatabaseAdapter,
  userId: number,
): Promise<string> {
  const row = await db.get<{ secret_key: string | null }>(
    'SELECT secret_key FROM users WHERE id = ?',
    [userId],
  )
  if (!row) throw new Error('用户不存在')
  if (row.secret_key) return row.secret_key

  for (let i = 0; i < 5; i++) {
    const key = genSecretKey()
    const exists = await db.get<{ id: number }>(
      'SELECT id FROM users WHERE secret_key = ?',
      [key],
    )
    if (!exists) {
      await db.run('UPDATE users SET secret_key = ? WHERE id = ?', [key, userId])
      return key
    }
  }
  throw new Error('生成提货秘钥失败，请重试')
}

/** 生成新对接码并校验唯一性 (供 reset 接口使用) */
export async function generateUniqueDockCode(db: DatabaseAdapter): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = genDockCode()
    const exists = await db.get<{ id: number }>(
      'SELECT id FROM users WHERE dock_code = ?',
      [code],
    )
    if (!exists) return code
  }
  throw new Error('生成对接码失败，请重试')
}

/** 生成新提货秘钥并校验唯一性 (供 reset 接口使用) */
export async function generateUniqueSecretKey(db: DatabaseAdapter): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const key = genSecretKey()
    const exists = await db.get<{ id: number }>(
      'SELECT id FROM users WHERE secret_key = ?',
      [key],
    )
    if (!exists) return key
  }
  throw new Error('生成提货秘钥失败，请重试')
}
