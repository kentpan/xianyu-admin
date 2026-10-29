/**
 * 分销手续费计算
 *
 * 配置存储在 system_settings:
 *   - distribution.fee_type : 'fixed' | 'percent'
 *   - distribution.fee_rate : fixed=元数, percent=百分比
 *
 * percent 模式: fee = salePrice * rate / 100
 * fixed 模式:   fee = rate
 *
 * 返回字符串形式 (2 位小数), 与 DB 一致
 */
import { toDecimal, fmtMoney } from './decimal'

export interface FeeResult {
  feeAmount: string
  feeType: string
  feeRate: string
}

/** 计算手续费 */
export async function calcFee(
  db: DatabaseAdapter,
  salePrice: string,
): Promise<FeeResult> {
  let feeType = 'fixed'
  let feeRate = '0'

  try {
    const typeRow = await db.get<{ value: string }>(
      "SELECT value FROM system_settings WHERE key_name = 'distribution.fee_type'",
    )
    if (typeRow?.value) feeType = typeRow.value
    const rateRow = await db.get<{ value: string }>(
      "SELECT value FROM system_settings WHERE key_name = 'distribution.fee_rate'",
    )
    if (rateRow?.value !== undefined && rateRow?.value !== null) {
      feeRate = String(rateRow.value)
    }
  } catch {
    // 配置读取失败 → 视为不收手续费
    return { feeAmount: '0.00', feeType: 'fixed', feeRate: '0' }
  }

  const sale = toDecimal(salePrice)
  const rate = toDecimal(feeRate)

  let fee: ReturnType<typeof toDecimal>
  if (feeType === 'percent') {
    fee = sale.mul(rate).div(100)
  } else {
    fee = rate
  }

  return {
    feeAmount: fmtMoney(fee),
    feeType,
    feeRate: feeRate || '0',
  }
}
