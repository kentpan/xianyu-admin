import { useApi } from '~/composables/useApi'

export interface Xian18Commodity {
  id: number
  name: string
  description: string
  price: number
  userPrice: number
  factoryPrice: number
  code: string
  categoryId: number
  categoryName: string
  cover: string
  stock: number
  cardStock: number
  sort: number
  minimum: number
  maximum: number
}

export interface ConsumeResult {
  commodityId: number
  commodityName: string
  quantity: number
  cards: { id: number; secret: string }[]
}

export interface SyncXian18Response {
  commodities: Xian18Commodity[]
  total: number
  syncedAt: string
}

export interface ConsumeXian18Payload {
  commodityId: number
  quantity: number
  externalOrderNo: string
}

export function syncXian18() {
  return useApi().get<SyncXian18Response>('/api/sync/xian18')
}

export function consumeXian18(body: ConsumeXian18Payload) {
  return useApi().post<ConsumeResult>('/api/sync/xian18-consume', body)
}
