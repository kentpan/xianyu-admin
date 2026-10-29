import { useApi } from '~/composables/useApi'

export interface DefaultReplyConfig {
  cookie_id: string
  enabled: number
  reply_content: string
  reply_image_url: string
  reply_once: number
  records_count: number
}

export interface SaveDefaultReplyPayload {
  enabled: boolean | number
  reply_content: string
  reply_image_url: string
  reply_once: boolean | number
}

/** 读取账号级默认回复配置 */
export function getDefaultReply(cookieId: string) {
  return useApi().get<DefaultReplyConfig>(`/api/default-replies/${encodeURIComponent(cookieId)}`)
}

/** 保存账号级默认回复 */
export function saveDefaultReply(cookieId: string, payload: SaveDefaultReplyPayload) {
  return useApi().put<DefaultReplyConfig>(`/api/default-replies/${encodeURIComponent(cookieId)}`, payload)
}

/** 清空"只回复一次"记录 (重新对全部会话生效) */
export function clearDefaultReplyRecords(cookieId: string) {
  return useApi().del<{ cookie_id: string; cleared: number }>(`/api/default-replies/${encodeURIComponent(cookieId)}`)
}
