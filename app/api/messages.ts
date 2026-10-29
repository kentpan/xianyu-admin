import { useApi } from '~/composables/useApi'

export interface ImConversation {
  id: number
  cookie_id: string
  chat_id: string
  peer_user_id: string
  peer_nick: string
  item_id: string
  last_message: string
  last_message_type: string
  last_message_time: string | null
  unread: number
  total_messages: number
  updated_at: string
  cookie_remark?: string
  item_title?: string
}

export interface ImMessage {
  id: number
  direction: 'in' | 'out' | 'system'
  sender_user_id: string
  sender_nick: string
  content: string
  content_type: string
  item_id: string
  order_id: string
  amount: string
  status_text: string
  msg_time: string | null
}

export function getConversations(cookieId?: string, keyword?: string) {
  const params = new URLSearchParams()
  if (cookieId) params.set('cookie_id', cookieId)
  if (keyword) params.set('keyword', keyword)
  const qs = params.toString()
  return useApi().get<ImConversation[]>(`/api/messages${qs ? `?${qs}` : ''}`)
}

export function getMessages(cookieId: string, chatId: string, beforeId = 0, limit = 50) {
  const params = new URLSearchParams({ cookie_id: cookieId, chat_id: chatId, limit: String(limit) })
  if (beforeId > 0) params.set('before_id', String(beforeId))
  return useApi().get<ImMessage[]>(`/api/messages/list?${params}`)
}

export function sendMessage(cookieId: string, chatId: string, text: string) {
  return useApi().post<{ sent: boolean }>('/api/messages/send', { cookie_id: cookieId, chat_id: chatId, text })
}

export function syncConversations(cookieId: string, limit = 30) {
  return useApi().post<{ fetched: number; stored: number }>('/api/messages/sync', { cookie_id: cookieId, limit })
}
