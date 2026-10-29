/** Whitelist of tables exposed via /api/admin/data — used by data management + backup. */
export const DATA_TABLE_WHITELIST: string[] = [
  'cookies', 'cookie_status', 'keywords', 'item_info', 'cards', 'orders',
  'delivery_rules', 'default_replies', 'item_replay', 'notification_channels',
  'message_notifications', 'system_settings', 'users', 'system_logs',
  'risk_control_logs', 'ai_reply_settings', 'ai_conversations', 'item_ai_settings',
  'ai_configs',
  // API Key 管理 + 卡密生成记录 (兼核销账本)
  'api_keys', 'api_key_logs', 'card_code_logs',
  // 返佣分销系统
  'dock_records', 'dock_code_bindings', 'agent_orders', 'fund_flows',
  'settlement_records',
  // 闲鱼扫码登录会话
  'qr_login_sessions',
  // 佣金联盟选品系统
  'affiliate_accounts', 'affiliate_products',
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
  item_ai_settings: 'id',
  ai_configs: 'id',
  api_keys: 'id',
  api_key_logs: 'id',
  card_code_logs: 'id',
  // 返佣分销系统
  dock_records: 'id',
  dock_code_bindings: 'id',
  agent_orders: 'id',
  fund_flows: 'id',
  settlement_records: 'id',
  qr_login_sessions: 'id',
  affiliate_accounts: 'id',
  affiliate_products: 'id',
}

export function isWhitelistedTable(name: string): boolean {
  return DATA_TABLE_WHITELIST.includes(name)
}

export function pkOf(name: string): string {
  return TABLE_PK[name] || 'id'
}
