import { useApi } from '~/composables/useApi'

export interface XianyuItemsSyncResult {
  synced: number
  total: number
}

export interface XianyuItemRefreshResult {
  success: boolean
  message: string
  alreadyPolished: boolean
}

export function syncXianyuItems(cookieId: string) {
  return useApi().post<XianyuItemsSyncResult>('/api/xianyu/items/sync', { cookie_id: cookieId })
}

export function refreshXianyuItem(itemId: string, cookieId: string) {
  return useApi().post<XianyuItemRefreshResult>(
    `/api/xianyu/items/${encodeURIComponent(itemId)}/refresh`,
    { cookie_id: cookieId },
  )
}

export interface PublishTemplateResult {
  template: string
  tips: string[]
}

export function generatePublishTemplate(body: {
  title: string
  price: string
  description?: string
  category?: string
  delivery_method?: string
}) {
  return useApi().post<PublishTemplateResult>('/api/xianyu/items/publish-template', body)
}
