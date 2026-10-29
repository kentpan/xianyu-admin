/**
 * useSchemaDiagram — returns the DB schema definition for the ER diagram.
 * Single source of truth for table structure visualization.
 */
export interface SchemaTable {
  name: string
  category: 'main' | 'business' | 'system'
  columns: { name: string; type: string; pk?: boolean; fk?: boolean }[]
  relations: string[]
}

const SCHEMA: SchemaTable[] = [
  {
    name: 'users',
    category: 'system',
    columns: [
      { name: 'id', type: 'INT', pk: true },
      { name: 'username', type: 'VARCHAR' },
      { name: 'email', type: 'VARCHAR' },
      { name: 'password_hash', type: 'VARCHAR' },
      { name: 'is_admin', type: 'BOOL' },
    ],
    relations: [],
  },
  {
    name: 'cookies',
    category: 'main',
    columns: [
      { name: 'id', type: 'VARCHAR', pk: true },
      { name: 'value', type: 'TEXT' },
      { name: 'user_id', type: 'INT', fk: true },
      { name: 'auto_confirm', type: 'BOOL' },
      { name: 'remark', type: 'VARCHAR' },
    ],
    relations: ['→ users.id'],
  },
  {
    name: 'cookie_status',
    category: 'main',
    columns: [
      { name: 'cookie_id', type: 'VARCHAR', pk: true, fk: true },
      { name: 'enabled', type: 'BOOL' },
    ],
    relations: ['→ cookies.id'],
  },
  {
    name: 'keywords',
    category: 'business',
    columns: [
      { name: 'id', type: 'INT', pk: true },
      { name: 'cookie_id', type: 'VARCHAR', fk: true },
      { name: 'keyword', type: 'VARCHAR' },
      { name: 'reply', type: 'TEXT' },
      { name: 'item_id', type: 'VARCHAR' },
    ],
    relations: ['→ cookies.id'],
  },
  {
    name: 'item_info',
    category: 'business',
    columns: [
      { name: 'id', type: 'INT', pk: true },
      { name: 'cookie_id', type: 'VARCHAR', fk: true },
      { name: 'item_id', type: 'VARCHAR' },
      { name: 'item_title', type: 'TEXT' },
      { name: 'item_price', type: 'VARCHAR' },
    ],
    relations: ['→ cookies.id'],
  },
  {
    name: 'orders',
    category: 'main',
    columns: [
      { name: 'order_id', type: 'VARCHAR', pk: true },
      { name: 'cookie_id', type: 'VARCHAR', fk: true },
      { name: 'item_id', type: 'VARCHAR' },
      { name: 'buyer_id', type: 'VARCHAR' },
      { name: 'amount', type: 'VARCHAR' },
      { name: 'order_status', type: 'VARCHAR' },
    ],
    relations: ['→ cookies.id'],
  },
  {
    name: 'cards',
    category: 'business',
    columns: [
      { name: 'id', type: 'INT', pk: true },
      { name: 'name', type: 'VARCHAR' },
      { name: 'type', type: 'VARCHAR' },
      { name: 'text_content', type: 'TEXT' },
      { name: 'user_id', type: 'INT', fk: true },
    ],
    relations: ['→ users.id'],
  },
  {
    name: 'delivery_rules',
    category: 'business',
    columns: [
      { name: 'id', type: 'INT', pk: true },
      { name: 'keyword', type: 'VARCHAR' },
      { name: 'card_id', type: 'INT', fk: true },
      { name: 'delivery_count', type: 'INT' },
      { name: 'enabled', type: 'BOOL' },
    ],
    relations: ['→ cards.id'],
  },
  {
    name: 'notification_channels',
    category: 'system',
    columns: [
      { name: 'id', type: 'INT', pk: true },
      { name: 'name', type: 'VARCHAR' },
      { name: 'type', type: 'VARCHAR' },
      { name: 'config', type: 'TEXT' },
      { name: 'enabled', type: 'BOOL' },
    ],
    relations: [],
  },
  {
    name: 'message_notifications',
    category: 'business',
    columns: [
      { name: 'id', type: 'INT', pk: true },
      { name: 'cookie_id', type: 'VARCHAR', fk: true },
      { name: 'channel_id', type: 'INT', fk: true },
      { name: 'enabled', type: 'BOOL' },
    ],
    relations: ['→ cookies.id', '→ notification_channels.id'],
  },
  {
    name: 'ai_reply_settings',
    category: 'business',
    columns: [
      { name: 'cookie_id', type: 'VARCHAR', pk: true, fk: true },
      { name: 'ai_enabled', type: 'BOOL' },
      { name: 'model_name', type: 'VARCHAR' },
      { name: 'api_key', type: 'VARCHAR' },
    ],
    relations: ['→ cookies.id'],
  },
  {
    name: 'system_settings',
    category: 'system',
    columns: [
      { name: 'key_name', type: 'VARCHAR', pk: true },
      { name: 'value', type: 'TEXT' },
      { name: 'description', type: 'TEXT' },
    ],
    relations: [],
  },
  {
    name: 'system_logs',
    category: 'system',
    columns: [
      { name: 'id', type: 'INT', pk: true },
      { name: 'level', type: 'VARCHAR' },
      { name: 'module', type: 'VARCHAR' },
      { name: 'message', type: 'TEXT' },
    ],
    relations: [],
  },
  {
    name: 'risk_control_logs',
    category: 'system',
    columns: [
      { name: 'id', type: 'INT', pk: true },
      { name: 'cookie_id', type: 'VARCHAR', fk: true },
      { name: 'event_type', type: 'VARCHAR' },
      { name: 'processing_status', type: 'VARCHAR' },
    ],
    relations: ['→ cookies.id'],
  },
  {
    name: 'in_app_notifications',
    category: 'system',
    columns: [
      { name: 'id', type: 'INT', pk: true },
      { name: 'user_id', type: 'INT', fk: true },
      { name: 'type', type: 'VARCHAR' },
      { name: 'title', type: 'VARCHAR' },
      { name: 'read', type: 'BOOL' },
    ],
    relations: ['→ users.id'],
  },
  {
    name: 'user_settings',
    category: 'system',
    columns: [
      { name: 'id', type: 'INT', pk: true },
      { name: 'user_id', type: 'INT', fk: true },
      { name: 'key_name', type: 'VARCHAR' },
      { name: 'value', type: 'TEXT' },
    ],
    relations: ['→ users.id'],
  },
]

export function useSchemaDiagram() {
  const tables = computed(() => SCHEMA)
  return { tables }
}
