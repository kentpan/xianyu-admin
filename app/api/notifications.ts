import { useApi } from '~/composables/useApi'

export interface NotifItem {
  id: number
  type: string
  title: string
  message: string
  read: number
  link: string | null
  created_at: string
}

export interface NotificationCenterResponse {
  items: NotifItem[]
  unread: number
}

export interface Channel {
  id: number
  name: string
  type: string
  config: string
  enabled: number
  created_at: string
}

export interface ChannelLite {
  id: number
  name: string
  type: string
  enabled: number
}

export interface CreateChannelPayload {
  name: string
  type: string
  config: string
  enabled: boolean
}

export type UpdateChannelPayload = Partial<CreateChannelPayload>

export interface TestChannelResult {
  sent?: boolean
  error?: string
  message?: string
}

export interface MessageNotification {
  id: number
  cookie_id: string
  channel_id: number
  enabled: number
}

export function getNotifications() {
  return useApi().get<NotificationCenterResponse>('/api/notifications/center')
}

export function markAllNotificationsRead() {
  return useApi().post('/api/notifications/center/read', { all: true })
}

export function markNotificationRead(id: number) {
  return useApi().post('/api/notifications/center/read', { id })
}

export function seedNotifications() {
  return useApi().post('/api/notifications/center/seed')
}

export function getChannels() {
  return useApi().get<Channel[]>('/api/notifications/channels')
}

export function createChannel(body: CreateChannelPayload) {
  return useApi().post<{ id: number }>('/api/notifications/channels', body)
}

export function updateChannel(id: number, body: UpdateChannelPayload) {
  return useApi().put(`/api/notifications/channels/${id}`, body)
}

export function toggleChannelEnabled(id: number, enabled: boolean) {
  return useApi().put(`/api/notifications/channels/${id}`, { enabled })
}

export function deleteChannel(id: number) {
  return useApi().del(`/api/notifications/channels/${id}`)
}

export function testChannel(id: number) {
  return useApi().post<TestChannelResult>(`/api/notifications/channels/${id}/test`)
}

export function getMessageNotifications() {
  return useApi().get<MessageNotification[]>('/api/notifications/messages')
}

export function saveMessageNotification(cookieId: string, body: { channel_id: number; enabled: boolean }) {
  return useApi().post(`/api/notifications/messages/${encodeURIComponent(cookieId)}`, body)
}
