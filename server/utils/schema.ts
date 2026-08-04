/**
 * Database schema — portable across SQLite / MySQL / D1.
 *
 * Uses `?` placeholders and standard types. Auto-increment column is written
 * with the `{AUTO}` marker which the initializer replaces per-driver.
 */
import type { DatabaseAdapter } from './db'

const AUTO = {
  sqlite: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  mysql: 'INTEGER PRIMARY KEY AUTO_INCREMENT',
  d1: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  memory: 'INTEGER PRIMARY KEY',
}

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id __AUTO__,
    username VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(128) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active INTEGER DEFAULT 1,
    is_admin INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS cookies (
    id VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    auto_confirm INTEGER DEFAULT 1,
    remark VARCHAR(255) DEFAULT '',
    pause_duration INTEGER DEFAULT 10,
    username VARCHAR(128) DEFAULT '',
    password VARCHAR(255) DEFAULT '',
    show_browser INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS cookie_status (
    cookie_id VARCHAR(64) PRIMARY KEY,
    enabled INTEGER DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS keywords (
    id __AUTO__,
    cookie_id VARCHAR(64) NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    reply TEXT NOT NULL,
    item_id VARCHAR(64) DEFAULT '',
    type VARCHAR(16) DEFAULT 'text',
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS item_info (
    id __AUTO__,
    cookie_id VARCHAR(64) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    item_title TEXT,
    item_description TEXT,
    item_category VARCHAR(128),
    item_price VARCHAR(32),
    item_detail TEXT,
    is_multi_spec INTEGER DEFAULT 0,
    multi_quantity_delivery INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cookie_id, item_id)
  )`,
  `CREATE TABLE IF NOT EXISTS cards (
    id __AUTO__,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(16) NOT NULL,
    api_config TEXT,
    text_content TEXT,
    data_content TEXT,
    image_url TEXT,
    description TEXT,
    enabled INTEGER DEFAULT 1,
    delay_seconds INTEGER DEFAULT 0,
    is_multi_spec INTEGER DEFAULT 0,
    spec_name VARCHAR(128),
    spec_value VARCHAR(128),
    user_id INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    order_id VARCHAR(64) PRIMARY KEY,
    item_id VARCHAR(64),
    buyer_id VARCHAR(64),
    spec_name VARCHAR(128),
    spec_value VARCHAR(128),
    quantity VARCHAR(16),
    amount VARCHAR(32),
    order_status VARCHAR(32) DEFAULT 'unknown',
    cookie_id VARCHAR(64),
    chat_id VARCHAR(64) DEFAULT '',
    is_bargain INTEGER DEFAULT 0,
    receiver_name VARCHAR(128) DEFAULT '',
    receiver_phone VARCHAR(32) DEFAULT '',
    receiver_address TEXT,
    receiver_city VARCHAR(64) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS delivery_rules (
    id __AUTO__,
    keyword VARCHAR(255) NOT NULL,
    card_id INTEGER NOT NULL,
    delivery_count INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1,
    description TEXT,
    delivery_times INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS default_replies (
    cookie_id VARCHAR(64) PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    reply_content TEXT,
    reply_image_url TEXT,
    reply_once INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS item_replay (
    id __AUTO__,
    item_id VARCHAR(64) NOT NULL,
    cookie_id VARCHAR(64) NOT NULL,
    reply_content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS notification_channels (
    id __AUTO__,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(32) NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS message_notifications (
    id __AUTO__,
    cookie_id VARCHAR(64) NOT NULL,
    channel_id INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cookie_id, channel_id)
  )`,
  `CREATE TABLE IF NOT EXISTS system_settings (
    key_name VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    id __AUTO__,
    user_id INTEGER NOT NULL,
    key_name VARCHAR(64) NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, key_name)
  )`,
  `CREATE TABLE IF NOT EXISTS risk_control_logs (
    id __AUTO__,
    cookie_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL DEFAULT 'slider_captcha',
    event_description TEXT,
    processing_result TEXT,
    processing_status VARCHAR(32) DEFAULT 'processing',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ai_reply_settings (
    cookie_id VARCHAR(64) PRIMARY KEY,
    ai_enabled INTEGER DEFAULT 0,
    model_name VARCHAR(64) DEFAULT 'qwen-plus',
    api_key VARCHAR(255),
    base_url VARCHAR(255) DEFAULT 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    max_discount_percent INTEGER DEFAULT 10,
    max_discount_amount INTEGER DEFAULT 100,
    max_bargain_rounds INTEGER DEFAULT 3,
    custom_prompts TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ai_conversations (
    id __AUTO__,
    cookie_id VARCHAR(64) NOT NULL,
    chat_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    intent VARCHAR(32),
    bargain_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS system_logs (
    id __AUTO__,
    level VARCHAR(16) DEFAULT 'INFO',
    module VARCHAR(64),
    message TEXT,
    meta TEXT,
    user_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id __AUTO__,
    user_id INTEGER,
    username VARCHAR(64),
    action VARCHAR(64) NOT NULL,
    module VARCHAR(64),
    target_type VARCHAR(32),
    target_id VARCHAR(128),
    description TEXT,
    ip_address VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS in_app_notifications (
    id __AUTO__,
    user_id INTEGER NOT NULL,
    type VARCHAR(32) DEFAULT 'info',
    title VARCHAR(255) NOT NULL,
    message TEXT,
    read INTEGER DEFAULT 0,
    link VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
]

const DEFAULT_SETTINGS: { key: string; value: string; description: string }[] = [
  { key: 'theme_color', value: 'amber', description: '主题颜色' },
  { key: 'registration_enabled', value: 'false', description: '是否开启用户注册' },
  { key: 'show_default_login_info', value: 'false', description: '是否显示默认登录信息' },
  { key: 'login_captcha_enabled', value: 'false', description: '登录验证码开关' },
  { key: 'smtp_server', value: '', description: 'SMTP服务器地址' },
  { key: 'smtp_port', value: '587', description: 'SMTP端口' },
  { key: 'smtp_user', value: '', description: 'SMTP用户名' },
  { key: 'smtp_password', value: '', description: 'SMTP密码' },
  { key: 'smtp_from', value: '', description: '发件人地址' },
  { key: 'ai_model', value: 'qwen-plus', description: '默认AI模型' },
  { key: 'ai_api_url', value: 'https://dashscope.aliyuncs.com/compatible-mode/v1', description: 'AI API地址' },
  { key: 'default_reply', value: '亲爱的老板你好！所有宝贝都可以拍，秒发货的哈~不满意可以直接申请退款哈~', description: '默认回复内容' },
  { key: 'item_sync_enabled', value: 'true', description: '商品自动同步开关' },
  { key: 'item_sync_interval', value: '600', description: '商品同步间隔(秒)' },
  { key: 'item_sync_max_pages', value: '5', description: '商品同步最大页数' },
  { key: 'app_name', value: '闲鱼超级管家', description: '应用名称' },
]

export async function initSchema(db: DatabaseAdapter): Promise<void> {
  const auto = AUTO[db.driver] || AUTO.sqlite
  for (const stmt of SCHEMA) {
    const finalSql = stmt.replace(/__AUTO__/g, auto)
    await db.exec(finalSql)
  }

  // Seed default system settings (idempotent, cross-driver)
  for (const s of DEFAULT_SETTINGS) {
    const exists = await db.get('SELECT key_name FROM system_settings WHERE key_name = ?', [s.key])
    if (!exists) {
      await db.run(
        'INSERT INTO system_settings (key_name, value, description) VALUES (?, ?, ?)',
        [s.key, s.value, s.description],
      )
    }
  }
}

/**
 * NOTE: column is `key_name` (not `key`) to avoid MySQL reserved word.
 * Repositories must use `key_name` in all WHERE/SELECT on system_settings.
 */
