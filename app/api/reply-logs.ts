import { useApi } from '~/composables/useApi'

/** 回复决策日志 (监听引擎 auto_reply_logs) */
export interface ReplyLog {
  id: number
  cookie_id: string
  chat_id: string
  item_id: string
  source_message_id: string
  sender_user_id: string
  sender_user_name: string
  source_message: string
  process_status: string
  decision_reason: string
  reply_strategy: string
  matched_keyword: string
  reply_text: string
  error_message: string
  send_status: string
  created_at: string
}

export function getReplyLogs(params?: { cookie_id?: string; keyword?: string; strategy?: string; limit?: number; offset?: number }) {
  const query: Record<string, string | number> = {}
  if (params?.cookie_id) query.cookie_id = params.cookie_id
  if (params?.keyword) query.keyword = params.keyword
  if (params?.strategy) query.strategy = params.strategy
  query.limit = params?.limit ?? 100
  query.offset = params?.offset ?? 0
  return useApi().get<{ logs: ReplyLog[]; total: number; limit: number; offset: number }>(
    `/api/auto-reply-logs?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()}`,
  )
}
