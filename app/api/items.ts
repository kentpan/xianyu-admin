import { useApi } from '~/composables/useApi'

export interface Item {
  id: number
  cookie_id: string
  item_id: string
  item_title: string | null
  item_category: string | null
  item_price: string | null
  is_multi_spec: number
  multi_quantity_delivery: number
  created_at: string
  updated_at: string
  cookie_remark: string | null
}

export interface UpdateItemPayload {
  is_multi_spec?: number
  multi_quantity_delivery?: number
  [key: string]: any
}

export function getItems() {
  return useApi().get<Item[]>('/api/items')
}

export function updateItem(cookieId: string, itemId: string, body: UpdateItemPayload) {
  return useApi().put(`/api/items/${encodeURIComponent(cookieId)}/${encodeURIComponent(itemId)}`, body)
}

export function deleteItem(cookieId: string, itemId: string) {
  return useApi().del(`/api/items/${encodeURIComponent(cookieId)}/${encodeURIComponent(itemId)}`)
}

export function batchDeleteItems(ids: number[]) {
  return useApi().del<{ deleted: number }>('/api/items/batch', { body: { ids } })
}
