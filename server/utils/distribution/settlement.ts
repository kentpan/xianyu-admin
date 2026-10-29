/**
 * 代理订单结算引擎 — 一级 / 二级分销链路资金流
 *
 * 核心规则 (与原 Python settlement_service 一致):
 *
 * 一级分销 (level=1, fee_payer=distributor 货主付手续费):
 *   1. 分销商余额 -= card_price (支付卡券成本给货主)
 *   2. 货主余额   += card_price
 *   3. 货主余额   -= fee (手续费)
 *
 * 一级分销 (fee_payer=dealer 分销商付手续费):
 *   1. 分销商余额 -= card_price
 *   2. 分销商余额 -= fee
 *   3. 货主余额   += card_price
 *
 * 二级分销 (fee_payer=distributor):
 *   1. 二级代理余额 -= level2_cost (支付对接成本给一级)
 *   2. 一级代理余额 += level2_cost
 *   3. 一级代理余额 -= card_price (支付卡券成本给货主)
 *   4. 货主余额     += card_price
 *   5. 货主余额     -= fee
 *
 * 二级分销 (fee_payer=dealer):
 *   1. 二级代理余额 -= level2_cost
 *   2. 二级代理余额 -= fee
 *   3. 一级代理余额 += level2_cost
 *   4. 一级代理余额 -= card_price
 *   5. 货主余额     += card_price
 *
 * 重要: 必须在调用方 db.transaction() 内执行, 以保证原子性
 */
import { addBalance, deductBalance } from './balance'
import { toDecimal } from './decimal'

export interface SettleLevel1Opts {
  db: DatabaseAdapter
  orderNo: string
  dealerUserId: number
  ownerUserId: number
  dockRecordId: number
  agentOrderId: number
  salePrice: string
  cardPrice: string
  feePayer: string // 'distributor' | 'dealer'
  feeAmount: string
}

export interface SettleLevel2Opts {
  db: DatabaseAdapter
  orderNo: string
  dealerUserId: number
  level1UserId: number
  ownerUserId: number
  dockRecordId: number
  parentDockRecordId: number
  agentOrderId: number
  salePrice: string
  level2Cost: string
  level1Cost: string // = card_price
  feePayer: string
  feeAmount: string
}

/** 一级分销结算 */
export async function settleLevel1Order(opts: SettleLevel1Opts): Promise<void> {
  const {
    db, orderNo, dealerUserId, ownerUserId, dockRecordId, agentOrderId,
    salePrice, cardPrice, feePayer, feeAmount,
  } = opts

  const cost = toDecimal(cardPrice)
  const fee = toDecimal(feeAmount)
  // salePrice 暂未参与资金移动 (Python 实现中利润 = sale - dock_price, 仅作为 agent_order.profit 字段记录)

  void salePrice // 显式标注未使用, 避免被误删

  if (feePayer === 'distributor') {
    // 1. 分销商余额 -= card_price
    if (cost.gt(0)) {
      await deductBalance(db, dealerUserId, cost, `支付卡券成本给货主（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'expense',
      })
    }
    // 2. 货主余额 += card_price
    if (cost.gt(0)) {
      await addBalance(db, ownerUserId, cost, `收到一级代理卡券成本（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'income',
      })
    }
    // 3. 货主余额 -= fee
    if (fee.gt(0)) {
      await deductBalance(db, ownerUserId, fee, `分销手续费-货主承担（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'fee',
      })
    }
  } else {
    // fee_payer='dealer' 分销商付手续费
    // 1. 分销商余额 -= card_price
    if (cost.gt(0)) {
      await deductBalance(db, dealerUserId, cost, `支付卡券成本给货主（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'expense',
      })
    }
    // 2. 分销商余额 -= fee
    if (fee.gt(0)) {
      await deductBalance(db, dealerUserId, fee, `分销手续费-分销商承担（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'fee',
      })
    }
    // 3. 货主余额 += card_price
    if (cost.gt(0)) {
      await addBalance(db, ownerUserId, cost, `收到一级代理卡券成本（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'income',
      })
    }
  }
}

/** 二级分销结算 */
export async function settleLevel2Order(opts: SettleLevel2Opts): Promise<void> {
  const {
    db, orderNo, dealerUserId, level1UserId, ownerUserId, dockRecordId,
    parentDockRecordId, agentOrderId, salePrice, level2Cost, level1Cost,
    feePayer, feeAmount,
  } = opts

  void salePrice
  void parentDockRecordId

  const l2 = toDecimal(level2Cost)
  const cardPrice = toDecimal(level1Cost)
  const fee = toDecimal(feeAmount)

  if (feePayer === 'distributor') {
    // 1. 二级代理余额 -= level2_cost
    if (l2.gt(0)) {
      await deductBalance(db, dealerUserId, l2, `支付对接成本给一级（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'expense',
      })
    }
    // 2. 一级代理余额 += level2_cost
    if (l2.gt(0)) {
      await addBalance(db, level1UserId, l2, `收到二级代理对接成本（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'income',
      })
    }
    // 3. 一级代理余额 -= card_price
    if (cardPrice.gt(0)) {
      await deductBalance(db, level1UserId, cardPrice, `支付卡券成本给货主（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'expense',
      })
    }
    // 4. 货主余额 += card_price
    if (cardPrice.gt(0)) {
      await addBalance(db, ownerUserId, cardPrice, `收到一级代理卡券成本（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'income',
      })
    }
    // 5. 货主余额 -= fee
    if (fee.gt(0)) {
      await deductBalance(db, ownerUserId, fee, `分销手续费-货主承担（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'fee',
      })
    }
  } else {
    // fee_payer='dealer' 分销商付手续费
    // 1. 二级代理余额 -= level2_cost
    if (l2.gt(0)) {
      await deductBalance(db, dealerUserId, l2, `支付对接成本给一级（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'expense',
      })
    }
    // 2. 二级代理余额 -= fee
    if (fee.gt(0)) {
      await deductBalance(db, dealerUserId, fee, `分销手续费-分销商承担（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'fee',
      })
    }
    // 3. 一级代理余额 += level2_cost
    if (l2.gt(0)) {
      await addBalance(db, level1UserId, l2, `收到二级代理对接成本（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'income',
      })
    }
    // 4. 一级代理余额 -= card_price
    if (cardPrice.gt(0)) {
      await deductBalance(db, level1UserId, cardPrice, `支付卡券成本给货主（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'expense',
      })
    }
    // 5. 货主余额 += card_price
    if (cardPrice.gt(0)) {
      await addBalance(db, ownerUserId, cardPrice, `收到一级代理卡券成本（订单: ${orderNo}）`, {
        orderId: agentOrderId, dockRecordId, flowType: 'income',
      })
    }
  }
}
