/** Whitelist of tables exposed via /api/admin/data — used by data management + backup. */
export const DATA_TABLE_WHITELIST: string[] = [
  'cookies', 'cookie_status', 'keywords', 'item_info', 'cards', 'orders',
  'delivery_rules', 'default_replies', 'item_replay', 'notification_channels',
  'message_notifications', 'system_settings', 'users', 'system_logs',
  'risk_control_logs', 'ai_reply_settings', 'ai_conversations',
]

/** Primary key column per table (default: id). */
export const TABLE_PK: Record<string, string> = {
  cookies: 'id',
  cookie_status: 'cookie_id',
  keywords: 'id',
  item_info: 'id',
  cards: 'id',
  orders: 'order_id',
  delivery_rules: 'id',
  default_replies: 'cookie_id',
  item_replay: 'id',
  notification_channels: 'id',
  message_notifications: 'id',
  system_settings: 'key_name',
  users: 'id',
  system_logs: 'id',
  risk_control_logs: 'id',
  ai_reply_settings: 'cookie_id',
  ai_conversations: 'id',
}

export function isWhitelistedTable(name: string): boolean {
  return DATA_TABLE_WHITELIST.includes(name)
}

export function pkOf(name: string): string {
  return TABLE_PK[name] || 'id'
}
