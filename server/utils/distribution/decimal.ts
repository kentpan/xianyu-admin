/**
 * Decimal.js 统一导出
 * 分销系统所有金额运算必须经过 Decimal (避免 JS number 精度损失)
 */
import Decimal from 'decimal.js'

export default Decimal
export { Decimal }

/** 将任意值转为 Decimal，失败返回 0 */
export function toDecimal(v: any): Decimal {
  try {
    if (v === null || v === undefined || v === '') return new Decimal(0)
    return new Decimal(v)
  } catch {
    return new Decimal(0)
  }
}

/** 格式化为 2 位小数字符串 */
export function fmtMoney(v: any): string {
  return toDecimal(v).toFixed(2)
}
