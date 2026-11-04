/** POST /api/delivery/simulate — 自动发货仿真全链路测试 (v2.2.4)。
 *
 * Body: { rule_id: number, account: string }
 *   rule_id: 自动发货页下拉选定的发货规则 id (直接执行该规则, 跳过自动匹配)
 *   account: 测试账号 (cookie_id) — 规则/商品/卡券均按该账号的真实配置执行
 *
 * 行为: 构造与买家付款卡片等价的聊天事件, 从 handleChatEvent 真实入口进入
 * deliverOnPaymentCard → autoDeliver 一路跑到已发货状态。链路与真实发货完全同构,
 * 仅四处模拟: ①平台待发货列表 ②无需邮寄发货接口 ③消息发送 ④通知推送 —
 * 不真实发货/不真实发送/不扣卡券库存/不计规则次数。
 *
 * 执行为后台 fire-and-forget (链路含卡券延迟 sleep, 最多数秒): 接口立即返回,
 * 前端轮询 GET /api/auto-reply-logs?test=1&since_id= 增量拉取测试决策日志
 * (与回复决策日志列表带棕色[测试]徽章的是同一份日志数据)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const body = await readBody(event) || {}
    const ruleId = Number(body?.rule_id || 0)
    const account = String(body?.account || '').trim()
    if (!ruleId) throw new ApiError(400, '请选择要测试的发货规则')
    if (!account) throw new ApiError(400, '请选择测试使用的账号')

    const db = await getDb()
    const rule = await db.get('SELECT id FROM delivery_rules WHERE id = ?', [ruleId])
    if (!rule) throw new ApiError(404, `发货规则 #${ruleId} 不存在`)
    const acct = await db.get('SELECT id FROM cookies WHERE id = ?', [account])
    if (!acct) throw new ApiError(404, `测试账号 ${account} 不存在`)

    const { simulateAutoDelivery } = await import('../../utils/xianyu/brain')
    // 后台执行: 决策日志 (is_test=1) 由前端轮询实时展示; 异常也走链路自身的
    // delivery_failed 决策日志留痕 (simulateAutoDelivery 内部 catch 不到的极少数场景除外)
    void simulateAutoDelivery(ruleId, account).catch((e: any) => {
      console.log(`[delivery-simulate] 仿真测试执行异常 (规则 #${ruleId} / ${account}): ${e?.message}`)
    })

    return ok({ started: true, rule_id: ruleId, account })
  }),
)
