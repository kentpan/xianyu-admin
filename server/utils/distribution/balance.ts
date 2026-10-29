/**
 * 余额读写 + 资金流水
 *
 * 余额存储在 user_settings 表 key_name='balance' (默认 '0.00')
 * 每次扣/增都更新 user_settings.balance 并插入 fund_flows 流水记录
 *
 * 重要: addBalance / deductBalance 不自己开事务,
 * 调用方 (settleLevel1Order / settleLevel2Order / withdraw 等)
 * 应将多个余额变更包在 `db.transaction(async () => { ... })` 中以保证原子性
 */
import { toDecimal, fmtMoney } from './decimal'
import { getUserSetting, setUserSetting } from './helpers'

/** 读取用户余额 (默认 '0.00') */
export async function getBalance(db: DatabaseAdapter, userId: number): Promise<string> {
  const v = await getUserSetting(db, userId, 'balance')
  return v && v !== '' ? fmtMoney(v) : '0.00'
}

export interface BalanceChangeOpts {
  /** 关联代理订单 id */
  orderId?: number | null
  /** 关联对接记录 id */
  dockRecordId?: number | null
  /** 流水类型: income|expense|fee (默认根据 add/deduct 推断) */
  flowType?: 'income' | 'expense' | 'fee'
}

/**
 * 增加余额 (income)
 * - 读当前余额 → 计算 balance_after → UPSERT user_settings → INSERT fund_flows
 */
export async function addBalance(
  db: DatabaseAdapter,
  userId: number,
  amount: string | number,
  description: string,
  opts: BalanceChangeOpts = {},
): Promise<{ balanceBefore: string; balanceAfter: string }> {
  const delta = toDecimal(amount)
  if (delta.lte(0)) {
    // 不做无变化操作 (调用方应已过滤)
    if (delta.eq(0)) {
      const cur = await getBalance(db, userId)
      return { balanceBefore: cur, balanceAfter: cur }
    }
    throw new ApiError(400, '增加金额必须大于 0')
  }

  const before = toDecimal(await getBalance(db, userId))
  const after = before.add(delta)
  const beforeStr = fmtMoney(before)
  const afterStr = fmtMoney(after)

  await setUserSetting(db, userId, 'balance', afterStr)
  await db.run(
    `INSERT INTO fund_flows
      (user_id, type, amount, balance_before, balance_after, order_id, dock_record_id, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      userId,
      opts.flowType || 'income',
      fmtMoney(delta),
      beforeStr,
      afterStr,
      opts.orderId ?? null,
      opts.dockRecordId ?? null,
      description.slice(0, 500),
    ],
  )

  return { balanceBefore: beforeStr, balanceAfter: afterStr }
}

/**
 * 扣减余额 (expense / fee)
 * - 余额不足抛 ApiError(400, '余额不足')
 */
export async function deductBalance(
  db: DatabaseAdapter,
  userId: number,
  amount: string | number,
  description: string,
  opts: BalanceChangeOpts = {},
): Promise<{ balanceBefore: string; balanceAfter: string }> {
  const delta = toDecimal(amount)
  if (delta.lte(0)) {
    if (delta.eq(0)) {
      const cur = await getBalance(db, userId)
      return { balanceBefore: cur, balanceAfter: cur }
    }
    throw new ApiError(400, '扣减金额必须大于 0')
  }

  const before = toDecimal(await getBalance(db, userId))
  if (before.lt(delta)) {
    throw new ApiError(400, '余额不足')
  }
  const after = before.sub(delta)
  const beforeStr = fmtMoney(before)
  const afterStr = fmtMoney(after)

  await setUserSetting(db, userId, 'balance', afterStr)
  await db.run(
    `INSERT INTO fund_flows
      (user_id, type, amount, balance_before, balance_after, order_id, dock_record_id, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      userId,
      opts.flowType || 'expense',
      fmtMoney(delta),
      beforeStr,
      afterStr,
      opts.orderId ?? null,
      opts.dockRecordId ?? null,
      description.slice(0, 500),
    ],
  )

  return { balanceBefore: beforeStr, balanceAfter: afterStr }
}
