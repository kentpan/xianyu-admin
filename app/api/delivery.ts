import { useApi } from '~/composables/useApi'

export interface DeliveryRule {
  id: number
  keyword: string
  card_id: number
  delivery_count: number
  delivery_times: number
  enabled: number
  require_paid: number
  description: string | null
  trigger_type: 'keyword' | 'payment' | string
  item_id: string
  item_title: string | null
  ship_mode: string
  created_at: string
  card_name: string | null
  card_type: string | null
}

export interface CreateDeliveryPayload {
  /** 消息关键词触发时必填; 付款触发可空 */
  keyword?: string
  /** 触发方式: keyword=买家消息包含关键词(默认) / payment=购买商品支付成功后自动发货 */
  trigger_type?: 'keyword' | 'payment'
  /** 付款触发绑定的闲鱼商品 ID */
  item_id?: string
  card_id: number
  delivery_count?: number
  description?: string
  enabled?: boolean
  require_paid?: boolean
  /** 无需邮寄发货模式: dummy_consign=平台无需邮寄确认发货(推荐虚拟商品) / none=仅发消息不调平台接口; 空=沿用账号 auto_confirm */
  ship_mode?: string
}

export type UpdateDeliveryPayload = Partial<CreateDeliveryPayload>

export function getDeliveryRules() {
  return useApi().get<DeliveryRule[]>('/api/delivery')
}

export function createDeliveryRule(body: CreateDeliveryPayload) {
  return useApi().post<{ id: number }>('/api/delivery', body)
}

export function updateDeliveryRule(id: number, body: UpdateDeliveryPayload) {
  return useApi().put(`/api/delivery/${id}`, body)
}

export function toggleDeliveryRuleEnabled(id: number, enabled: boolean) {
  return useApi().put(`/api/delivery/${id}`, { enabled })
}

export function deleteDeliveryRule(id: number) {
  return useApi().del(`/api/delivery/${id}`)
}

/** 自动发货仿真全链路测试 (v2.2.4): 模拟买家付款触发选定规则, 按真实链路跑到已发货
 *  (除不真实发货/发送/扣库存外完全仿真); 后台执行, 测试决策日志轮询
 *  /api/auto-reply-logs?test=1&since_id= 实时展示 (与回复决策日志列表同一份数据) */
export function simulateDeliveryRule(body: { rule_id: number; account: string }) {
  return useApi().post<{ started: boolean; rule_id: number; account: string }>('/api/delivery/simulate', body)
}
