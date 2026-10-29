import { useApi } from '~/composables/useApi'

export interface ItemReply {
  id: number
  item_id: string
  cookie_id: string
  reply_content: string
  created_at: string
  updated_at: string
  item_title?: string | null
  item_price?: string | null
  item_category?: string | null
  cookie_remark?: string | null
}

export interface UpsertItemReplyPayload {
  reply_content: string
}

export function getItemReplies() {
  return useApi().get<ItemReply[]>('/api/item-replies')
}

export function upsertItemReply(cookieId: string, itemId: string, body: UpsertItemReplyPayload) {
  return useApi().put(`/api/item-replies/${encodeURIComponent(cookieId)}/${encodeURIComponent(itemId)}`, body)
}

export function deleteItemReply(cookieId: string, itemId: string) {
  return useApi().del(`/api/item-replies/${encodeURIComponent(cookieId)}/${encodeURIComponent(itemId)}`)
}
