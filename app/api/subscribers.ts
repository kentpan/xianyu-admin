import { useApi } from '~/composables/useApi'

export interface SubscriberRow {
  id: number
  name: string
  token: string
  webhook_url: string
  remark: string
  enabled: boolean
  total_delivered: number
  total_failed: number
  consecutive_failures: number
  muted_until: string | null
  muted: boolean
  last_delivery_at: string | null
  created_at: string
}

export function getSubscribers() {
  return useApi().get<{ subscribers: SubscriberRow[] }>('/api/engine/subscribers')
}

export interface SubscriberInput {
  name: string
  webhook_url: string
  remark?: string
  enabled?: boolean
  regenerate_token?: boolean
}

export function createSubscriber(input: SubscriberInput) {
  return useApi().post<SubscriberRow>('/api/engine/subscribers', input)
}

export function updateSubscriber(id: number, input: Partial<SubscriberInput>) {
  return useApi().put<SubscriberRow>(`/api/engine/subscribers/${id}`, input)
}

export function deleteSubscriber(id: number) {
  return useApi().del(`/api/engine/subscribers/${id}`)
}

export function testSubscriber(id: number) {
  return useApi().post<{ ok: boolean; message: string }>(`/api/engine/subscribers/${id}/test`)
}
