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
    code_length INTEGER DEFAULT 6,
    code_letters INTEGER DEFAULT 1,
    code_digits INTEGER DEFAULT 1,
    code_case VARCHAR(8) DEFAULT 'mixed',
    code_template TEXT,
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
    require_paid INTEGER DEFAULT 1,
    description TEXT,
    delivery_times INTEGER DEFAULT 0,
    trigger_type VARCHAR(16) DEFAULT 'keyword',
    item_id VARCHAR(64) DEFAULT '',
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
  // AI 配置中心: 多套可复用的模型接入配置, 账号级/商品级通过 ai_config_id 引用
  `CREATE TABLE IF NOT EXISTS ai_configs (
    id __AUTO__,
    name VARCHAR(128) NOT NULL,
    model_name VARCHAR(64) DEFAULT 'qwen-plus',
    api_key VARCHAR(255) DEFAULT '',
    base_url VARCHAR(255) DEFAULT 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    enabled INTEGER DEFAULT 1,
    remark VARCHAR(255) DEFAULT '',
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

  // ===== 返佣分销系统 (Commission / Distribution) =====
  `CREATE TABLE IF NOT EXISTS dock_records (
    id __AUTO__,
    user_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    dock_name VARCHAR(255) NOT NULL,
    markup_amount VARCHAR(32) DEFAULT '0.00',
    remark TEXT,
    delivery_count INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    disable_reason VARCHAR(255),
    owner_disabled INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    parent_dock_id INTEGER,
    source_user_id INTEGER,
    allow_sub_dock INTEGER DEFAULT 0,
    sub_dock_price VARCHAR(32),
    sub_dock_visibility VARCHAR(16),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dock_user ON dock_records(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dock_card ON dock_records(card_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dock_parent ON dock_records(parent_dock_id)`,
  `CREATE TABLE IF NOT EXISTS dock_code_bindings (
    id __AUTO__,
    user_id INTEGER NOT NULL,
    dock_code VARCHAR(32) NOT NULL,
    target_user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, target_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_orders (
    id __AUTO__,
    user_id INTEGER NOT NULL,
    order_no VARCHAR(64) NOT NULL,
    item_id VARCHAR(64),
    card_id INTEGER NOT NULL,
    dock_record_id INTEGER NOT NULL,
    dock_level INTEGER NOT NULL,
    sale_price VARCHAR(32) NOT NULL,
    dock_price VARCHAR(32) NOT NULL,
    card_price VARCHAR(32),
    level2_cost VARCHAR(32),
    profit VARCHAR(32) DEFAULT '0.00',
    fee_amount VARCHAR(32),
    fee_payer VARCHAR(16),
    upstream_user_id INTEGER,
    upstream_dock_record_id INTEGER,
    owner_user_id INTEGER,
    delivery_content TEXT,
    buyer_id VARCHAR(64),
    status VARCHAR(32) DEFAULT 'delivered',
    settle_remark VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_user ON agent_orders(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_upstream ON agent_orders(upstream_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_owner ON agent_orders(owner_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_order_no ON agent_orders(order_no)`,
  `CREATE TABLE IF NOT EXISTS fund_flows (
    id __AUTO__,
    user_id INTEGER NOT NULL,
    type VARCHAR(16) NOT NULL,
    amount VARCHAR(32) NOT NULL,
    balance_before VARCHAR(32) NOT NULL,
    balance_after VARCHAR(32) NOT NULL,
    order_id INTEGER,
    dock_record_id INTEGER,
    description VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fund_user ON fund_flows(user_id, id)`,
  `CREATE TABLE IF NOT EXISTS settlement_records (
    id __AUTO__,
    user_id INTEGER NOT NULL,
    payment_type VARCHAR(16),
    payment_qrcode VARCHAR(512),
    alipay_id VARCHAR(128),
    amount VARCHAR(32) NOT NULL,
    status VARCHAR(32) DEFAULT 'pending_review',
    remark TEXT,
    reject_reason VARCHAR(512),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_settle_user ON settlement_records(user_id)`,
  `CREATE TABLE IF NOT EXISTS qr_login_sessions (
    id __AUTO__,
    session_key VARCHAR(64) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    status VARCHAR(16) DEFAULT 'waiting',
    qr_url TEXT,
    cookie_value TEXT,
    xianyu_uid VARCHAR(64),
    xianyu_nick VARCHAR(255),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_qrlogin_user ON qr_login_sessions(user_id)`,

  // ===== 佣金联盟选品系统 =====
  `CREATE TABLE IF NOT EXISTS affiliate_accounts (
    id __AUTO__,
    user_id INTEGER NOT NULL,
    network_id VARCHAR(64) NOT NULL,
    display_name VARCHAR(128) DEFAULT '',
    credentials TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    remark VARCHAR(255),
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, network_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_aff_account_user ON affiliate_accounts(user_id)`,
  `CREATE TABLE IF NOT EXISTS affiliate_products (
    id __AUTO__,
    user_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    network_id VARCHAR(64) NOT NULL,
    item_id VARCHAR(128) NOT NULL,
    title TEXT,
    price VARCHAR(32),
    commission_rate VARCHAR(32),
    commission_amount VARCHAR(32),
    pic_url TEXT,
    item_url TEXT,
    shop_name VARCHAR(255),
    category VARCHAR(255),
    sales VARCHAR(32),
    coupon TEXT,
    raw_data TEXT,
    collected INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, item_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_aff_product_user ON affiliate_products(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_aff_product_account ON affiliate_products(account_id)`,

  // ===== 消息监听引擎 (内置 TS 引擎 / 远程代理配套) =====
  `CREATE TABLE IF NOT EXISTS auto_reply_logs (
    id __AUTO__,
    cookie_id VARCHAR(64) NOT NULL,
    chat_id VARCHAR(64) DEFAULT '',
    item_id VARCHAR(64) DEFAULT '',
    source_message_id VARCHAR(128) DEFAULT '',
    sender_user_id VARCHAR(64) DEFAULT '',
    sender_user_name VARCHAR(128) DEFAULT '',
    source_message TEXT,
    process_status VARCHAR(16) DEFAULT 'success',
    decision_reason VARCHAR(64) DEFAULT '',
    reply_strategy VARCHAR(16) DEFAULT 'none',
    matched_keyword VARCHAR(255) DEFAULT '',
    reply_text TEXT,
    error_message TEXT,
    send_status VARCHAR(16) DEFAULT 'unknown',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_autolog_cookie ON auto_reply_logs(cookie_id, id)`,
  `CREATE TABLE IF NOT EXISTS message_filters (
    id __AUTO__,
    cookie_id VARCHAR(64) NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    filter_type VARCHAR(16) DEFAULT 'skip_reply',
    enabled INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS default_reply_records (
    id __AUTO__,
    cookie_id VARCHAR(64) NOT NULL,
    chat_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cookie_id, chat_id)
  )`,
  `CREATE TABLE IF NOT EXISTS card_shipments (
    id __AUTO__,
    card_id INTEGER NOT NULL,
    card_name VARCHAR(128) DEFAULT '',
    content TEXT,
    order_id VARCHAR(64) DEFAULT '',
    item_id VARCHAR(64) DEFAULT '',
    buyer_id VARCHAR(64) DEFAULT '',
    cookie_id VARCHAR(64) DEFAULT '',
    user_id INTEGER DEFAULT 1,
    shipped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ship_card ON card_shipments(card_id, id)`,
  `CREATE TABLE IF NOT EXISTS im_conversations (
    id __AUTO__,
    cookie_id VARCHAR(64) NOT NULL,
    chat_id VARCHAR(64) NOT NULL,
    peer_user_id VARCHAR(64) DEFAULT '',
    peer_nick VARCHAR(128) DEFAULT '',
    item_id VARCHAR(64) DEFAULT '',
    last_message TEXT,
    last_message_type VARCHAR(16) DEFAULT 'text',
    last_message_time TIMESTAMP,
    unread INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cookie_id, chat_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_imconv_account ON im_conversations(cookie_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS im_messages (
    id __AUTO__,
    cookie_id VARCHAR(64) NOT NULL,
    chat_id VARCHAR(64) NOT NULL,
    direction VARCHAR(8) DEFAULT 'in',
    message_key VARCHAR(160) NOT NULL,
    sender_user_id VARCHAR(64) DEFAULT '',
    sender_nick VARCHAR(128) DEFAULT '',
    content TEXT,
    content_type VARCHAR(16) DEFAULT 'text',
    item_id VARCHAR(64) DEFAULT '',
    order_id VARCHAR(64) DEFAULT '',
    amount VARCHAR(32) DEFAULT '',
    status_text VARCHAR(64) DEFAULT '',
    msg_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cookie_id, message_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_immsg_chat ON im_messages(cookie_id, chat_id, id)`,
  `CREATE TABLE IF NOT EXISTS item_ai_settings (
    id __AUTO__,
    cookie_id VARCHAR(64) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    ai_enabled INTEGER DEFAULT 0,
    model_name VARCHAR(64) DEFAULT 'qwen-plus',
    api_key VARCHAR(255),
    base_url VARCHAR(255) DEFAULT 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    max_discount_percent INTEGER DEFAULT 10,
    max_discount_amount INTEGER DEFAULT 100,
    max_bargain_rounds INTEGER DEFAULT 3,
    custom_prompts TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cookie_id, item_id)
  )`,
  `CREATE TABLE IF NOT EXISTS delivery_block_rules (
    id __AUTO__,
    account_id VARCHAR(64) NOT NULL,
    rule_code VARCHAR(64) NOT NULL,
    enabled INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 5,
    block_reason TEXT,
    auto_close_order INTEGER DEFAULT 0,
    only_card_after_close INTEGER DEFAULT 0,
    excluded_item_ids TEXT DEFAULT '[]',
    config TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, rule_code)
  )`,
  // 监听引擎注册表: 内置引擎 (与本后台同进程) + 远程代理 (纯监听转发, 任意机器部署, Bearer 鉴权)
  `CREATE TABLE IF NOT EXISTS engines (
    id __AUTO__,
    slug VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(16) NOT NULL DEFAULT 'remote',
    host VARCHAR(255) DEFAULT '',
    port INTEGER DEFAULT 0,
    token VARCHAR(64) DEFAULT '',
    remark VARCHAR(255) DEFAULT '',
    enabled INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 0,
    last_seen_at TIMESTAMP,
    last_status TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // 事件发布订阅者: 引擎监听到的原始事件 (聊天/系统/风控) 转发给下游项目,
  // 鉴权为标准 Authorization: Bearer <token>, 转发不碰业务逻辑 (大脑决策不受影响)
  `CREATE TABLE IF NOT EXISTS engine_subscribers (
    id __AUTO__,
    name VARCHAR(128) NOT NULL,
    token VARCHAR(64) DEFAULT '',
    webhook_url TEXT DEFAULT '',
    remark VARCHAR(255) DEFAULT '',
    enabled INTEGER DEFAULT 1,
    total_delivered INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    consecutive_failures INTEGER DEFAULT 0,
    muted_until TIMESTAMP,
    last_delivery_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // API Key 管理: 远程调用验证码核销接口的业务方身份, 独立限速 (明文存储以便后台反复查看+复制)
  `CREATE TABLE IF NOT EXISTS api_keys (
    id __AUTO__,
    name VARCHAR(128) NOT NULL,
    api_key VARCHAR(64) NOT NULL UNIQUE,
    rate_limit_num INTEGER DEFAULT 30,
    rate_limit_window INTEGER DEFAULT 60,
    enabled INTEGER DEFAULT 1,
    total_calls INTEGER DEFAULT 0,
    total_success INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    remark VARCHAR(255) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // API Key 调用日志: 限速判定后的每次核销请求留痕, 聚合出统计报表
  `CREATE TABLE IF NOT EXISTS api_key_logs (
    id __AUTO__,
    api_key_id INTEGER NOT NULL,
    endpoint VARCHAR(64) DEFAULT '',
    success INTEGER DEFAULT 0,
    status_code INTEGER DEFAULT 200,
    message VARCHAR(255) DEFAULT '',
    ip VARCHAR(64) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_apilog_key ON api_key_logs(api_key_id, id)`,
]

/**
 * Idempotent column migrations (ALTER TABLE ADD COLUMN).
 * SQLite doesn't support ADD COLUMN IF NOT EXISTS, so each is wrapped in try/catch
 * at runtime. Safe to re-run.
 */
const MIGRATIONS: string[] = [
  // 返佣: users 增加对接码 + 提货秘钥
  `ALTER TABLE users ADD COLUMN dock_code VARCHAR(32)`,
  `ALTER TABLE users ADD COLUMN secret_key VARCHAR(64)`,
  `ALTER TABLE users ADD COLUMN phone VARCHAR(32)`,
  // 返佣: cards 增加对接相关字段
  `ALTER TABLE cards ADD COLUMN price VARCHAR(32) DEFAULT '0.00'`,
  `ALTER TABLE cards ADD COLUMN is_dockable INTEGER DEFAULT 0`,
  `ALTER TABLE cards ADD COLUMN fee_payer VARCHAR(16) DEFAULT 'distributor'`,
  `ALTER TABLE cards ADD COLUMN min_price VARCHAR(32)`,
  `ALTER TABLE cards ADD COLUMN dock_visibility VARCHAR(16) DEFAULT 'public'`,
  // 多账号: cookies 增加闲鱼账号元信息 + 登录方式
  `ALTER TABLE cookies ADD COLUMN xianyu_uid VARCHAR(64) DEFAULT ''`,
  `ALTER TABLE cookies ADD COLUMN avatar TEXT`,
  `ALTER TABLE cookies ADD COLUMN login_type VARCHAR(16) DEFAULT 'cookie'`,
  `ALTER TABLE cookies ADD COLUMN cookie_status_text VARCHAR(32) DEFAULT 'unknown'`,
  `ALTER TABLE cookies ADD COLUMN last_check_at TIMESTAMP`,
  // 自动发货: 仅已付款买家生效开关 (默认开启, 防止未付款咨询误发货)
  `ALTER TABLE delivery_rules ADD COLUMN require_paid INTEGER DEFAULT 1`,
  // 自动发货: 触发方式 (keyword=消息关键词触发, payment=付款成功自动发货) + 付款触发绑定的商品
  `ALTER TABLE delivery_rules ADD COLUMN trigger_type VARCHAR(16) DEFAULT 'keyword'`,
  `ALTER TABLE delivery_rules ADD COLUMN item_id VARCHAR(64) DEFAULT ''`,
  // 监听引擎: 规则作用域 (账号级隔离) + 订单状态机扩展列
  `ALTER TABLE delivery_rules ADD COLUMN cookie_id VARCHAR(64)`,
  `ALTER TABLE orders ADD COLUMN system_shipped INTEGER DEFAULT 0`,
  `ALTER TABLE orders ADD COLUMN version INTEGER DEFAULT 1`,
  `ALTER TABLE orders ADD COLUMN buy_num INTEGER DEFAULT 1`,
  `ALTER TABLE orders ADD COLUMN auction_price VARCHAR(32) DEFAULT ''`,
  `ALTER TABLE orders ADD COLUMN confirm_fee VARCHAR(32) DEFAULT ''`,
  `ALTER TABLE orders ADD COLUMN refund_fee VARCHAR(32) DEFAULT ''`,
  `ALTER TABLE orders ADD COLUMN post_fee VARCHAR(32) DEFAULT ''`,
  // 监听引擎: 账号级买家互动开关 + 公开资料回写列
  `ALTER TABLE cookies ADD COLUMN auto_rate_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE cookies ADD COLUMN auto_flower_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE cookies ADD COLUMN auto_thanks_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE cookies ADD COLUMN auto_receive_flower_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE cookies ADD COLUMN nickname VARCHAR(128) DEFAULT ''`,
  `ALTER TABLE cookies ADD COLUMN avatar_url TEXT`,
  `ALTER TABLE cookies ADD COLUMN location VARCHAR(255) DEFAULT ''`,
  `ALTER TABLE cookies ADD COLUMN bio TEXT`,
  `ALTER TABLE cookies ADD COLUMN followers INTEGER DEFAULT 0`,
  `ALTER TABLE cookies ADD COLUMN following INTEGER DEFAULT 0`,
  `ALTER TABLE cookies ADD COLUMN profile_updated_at TIMESTAMP`,
  // 监听引擎: AI 回复引擎上下文扩展列
  `ALTER TABLE ai_reply_settings ADD COLUMN user_agent VARCHAR(255) DEFAULT ''`,
  `ALTER TABLE ai_reply_settings ADD COLUMN context_enabled INTEGER DEFAULT 1`,
  `ALTER TABLE ai_reply_settings ADD COLUMN context_message_limit INTEGER DEFAULT 12`,
  `ALTER TABLE ai_reply_settings ADD COLUMN context_expire_minutes INTEGER DEFAULT 120`,
  // 自动发货: 无需邮寄发货模式 (none=仅发消息, dummy_consign=平台无需邮寄确认发货)
  `ALTER TABLE delivery_rules ADD COLUMN ship_mode VARCHAR(16) DEFAULT ''`,
  // AI 配置中心: 账号级/商品级通过 ai_config_id 引用统一配置 (0=未引用)
  `ALTER TABLE ai_reply_settings ADD COLUMN ai_config_id INTEGER DEFAULT 0`,
  `ALTER TABLE item_ai_settings ADD COLUMN ai_config_id INTEGER DEFAULT 0`,
  // 监听引擎: 通知规则事件类型过滤
  `ALTER TABLE message_notifications ADD COLUMN name VARCHAR(128) DEFAULT ''`,
  `ALTER TABLE message_notifications ADD COLUMN event_types TEXT`,
  // 监听引擎注册表 (新建表, CREATE IF NOT EXISTS 幂等) + 内置引擎种子行
  `CREATE TABLE IF NOT EXISTS engines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(16) NOT NULL DEFAULT 'remote',
    host VARCHAR(255) DEFAULT '',
    port INTEGER DEFAULT 0,
    token VARCHAR(64) DEFAULT '',
    remark VARCHAR(255) DEFAULT '',
    enabled INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 0,
    last_seen_at TIMESTAMP,
    last_status TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `INSERT OR IGNORE INTO engines (id, slug, name, type, is_active, remark)
   VALUES (1, 'builtin', '内置监听引擎', 'builtin', 1, '与后台同进程, 共享数据库')`,
  // 引擎接入令牌: 统一 Authorization: Bearer <token> 鉴权, 每个引擎独立令牌
  `ALTER TABLE engines ADD COLUMN token VARCHAR(64) DEFAULT ''`,
  // 风控: 设备指纹持久化 (重连/换机不换设备 ID, 避免风控)
  `ALTER TABLE cookies ADD COLUMN device_id VARCHAR(128) DEFAULT ''`,
  // 事件发布订阅者 (新建表, CREATE IF NOT EXISTS 幂等)
  `CREATE TABLE IF NOT EXISTS engine_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(128) NOT NULL,
    token VARCHAR(64) DEFAULT '',
    webhook_url TEXT DEFAULT '',
    remark VARCHAR(255) DEFAULT '',
    enabled INTEGER DEFAULT 1,
    total_delivered INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    consecutive_failures INTEGER DEFAULT 0,
    muted_until TIMESTAMP,
    last_delivery_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // 全局 AI 接入配置已下线 (统一收敛到 ai_configs 配置中心), 清理遗留设置项
  `DELETE FROM system_settings WHERE key_name IN ('ai_model', 'ai_api_url', 'ai_api_key')`,
  // API Key 有效期 (NULL=永久, 到期后核销调用返回 403)
  `ALTER TABLE api_keys ADD COLUMN expires_at TIMESTAMP`,
  // 卡密生成型卡券配置 (长度/字符构成/大小写/文案)
  `ALTER TABLE cards ADD COLUMN code_length INTEGER DEFAULT 6`,
  `ALTER TABLE cards ADD COLUMN code_letters INTEGER DEFAULT 1`,
  `ALTER TABLE cards ADD COLUMN code_digits INTEGER DEFAULT 1`,
  `ALTER TABLE cards ADD COLUMN code_case VARCHAR(8) DEFAULT 'mixed'`,
  `ALTER TABLE cards ADD COLUMN code_template TEXT`,
  // 卡密生成记录: 卡密型卡券发货时每次生成的随机码 + 分配上下文, 兼作核销账本
  // (时间/卡券/账号/商品/订单/买家 + 核销状态/核销方/时间/IP)
  `CREATE TABLE IF NOT EXISTS card_code_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER DEFAULT 0,
    card_name VARCHAR(128) DEFAULT '',
    code VARCHAR(64) DEFAULT '' UNIQUE,
    cookie_id VARCHAR(64) DEFAULT '',
    item_id VARCHAR(64) DEFAULT '',
    order_id VARCHAR(64) DEFAULT '',
    buyer_id VARCHAR(64) DEFAULT '',
    status VARCHAR(16) DEFAULT 'unused',
    used_at TIMESTAMP,
    used_ip VARCHAR(64) DEFAULT '',
    used_by_key_id INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cardcode_created ON card_code_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_cardcode_status ON card_code_logs(status, created_at)`,
  // 老库补齐核销列 (CREATE IF NOT EXISTS 不会加列, ALTER 幂等由 try/catch 兼容)
  `ALTER TABLE card_code_logs ADD COLUMN status VARCHAR(16) DEFAULT 'unused'`,
  `ALTER TABLE card_code_logs ADD COLUMN used_at TIMESTAMP`,
  `ALTER TABLE card_code_logs ADD COLUMN used_ip VARCHAR(64) DEFAULT ''`,
  `ALTER TABLE card_code_logs ADD COLUMN used_by_key_id INTEGER DEFAULT 0`,
  // 卡密唯一约束防重发 (空表/无重复时生效; 老数据若有重复由 try/catch 跳过)
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_cardcode_unique ON card_code_logs(code)`,
  // 提货验证码独立表已废弃, 卡密统一由 card_code_logs 承载 (发放+核销)
  `DROP TABLE IF EXISTS verify_codes`,
  // 发货规则废弃列清理: 是否发消息/是否发卡密改由卡券配置决定, 规则只保留发货方式
  `ALTER TABLE delivery_rules DROP COLUMN send_message_on_ship`,
  `ALTER TABLE delivery_rules DROP COLUMN send_verify_code`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(128) NOT NULL,
    api_key VARCHAR(64) NOT NULL UNIQUE,
    rate_limit_num INTEGER DEFAULT 30,
    rate_limit_window INTEGER DEFAULT 60,
    enabled INTEGER DEFAULT 1,
    total_calls INTEGER DEFAULT 0,
    total_success INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    remark VARCHAR(255) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS api_key_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id INTEGER NOT NULL,
    endpoint VARCHAR(64) DEFAULT '',
    success INTEGER DEFAULT 0,
    status_code INTEGER DEFAULT 200,
    message VARCHAR(255) DEFAULT '',
    ip VARCHAR(64) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_apilog_key ON api_key_logs(api_key_id, id)`,
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
  { key: 'mail_provider', value: 'smtp', description: '邮件服务商: smtp|resend' },
  { key: 'resend_api_key', value: '', description: 'Resend API Key' },
  { key: 'resend_from', value: '', description: 'Resend 发件人地址' },
  { key: 'default_reply', value: '亲爱的老板你好！所有宝贝都可以拍，秒发货的哈~不满意可以直接申请退款哈~', description: '全局默认回复内容' },
  { key: 'item_sync_enabled', value: 'true', description: '商品自动同步开关' },
  { key: 'item_sync_interval', value: '600', description: '商品同步间隔(秒)' },
  { key: 'item_sync_max_pages', value: '5', description: '商品同步最大页数' },
  { key: 'app_name', value: '闲鱼超级管家', description: '应用名称' },
  // 返佣分销系统设置
  { key: 'distribution.enabled', value: 'true', description: '是否开启返佣分销系统' },
  { key: 'distribution.fee_type', value: 'fixed', description: '分销手续费类型: fixed|percent' },
  { key: 'distribution.fee_rate', value: '0', description: '分销手续费率 (fixed=元, percent=百分数)' },
  { key: 'withdraw.min_amount', value: '1', description: '最低提现金额(元)' },
  { key: 'withdraw.max_amount', value: '10000', description: '单笔最高提现金额(元)' },
  { key: 'withdraw.notify_email', value: '', description: '提现通知邮箱(留空则需管理员后台审核)' },
  // 监听引擎配置 (监听引擎每轮循环读取)
  { key: 'order_sync_enabled', value: 'true', description: '订单定时同步开关(引擎从卖家端实查非终态订单对账)' },
  { key: 'order_sync_interval', value: '1800', description: '订单同步间隔(秒, 最低1800)' },
  { key: 'auto_polish_enabled', value: 'false', description: '商品自动擦亮开关' },
  { key: 'auto_polish_interval', value: '86400', description: '商品自动擦亮间隔(秒)' },
]

export async function initSchema(db: DatabaseAdapter): Promise<void> {
  const auto = AUTO[db.driver] || AUTO.sqlite
  for (const stmt of SCHEMA) {
    const finalSql = stmt.replace(/__AUTO__/g, auto)
    await db.exec(finalSql)
  }

  // Idempotent column migrations (ALTER TABLE ADD COLUMN) — ignore "duplicate column" errors
  for (const stmt of MIGRATIONS) {
    try {
      await db.exec(stmt)
    } catch {
      // column already exists — expected on re-run
    }
  }

  // 一次性数据迁移: 存量分散在账号级/商品级的模型接入信息聚合为 ai_configs 记录并建立引用。
  // 以 system_settings 标记位保证只跑一次, 避免用户删除配置后被重复找回。
  try {
    const migrated = await db.get<{ value: string }>(
      "SELECT value FROM system_settings WHERE key_name = 'ai_configs_migrated'",
    )
    if (!migrated) {
      await db.exec(`INSERT INTO ai_configs (name, model_name, api_key, base_url, remark)
        SELECT DISTINCT r.model_name, r.model_name, r.api_key, r.base_url, '存量配置自动迁移'
        FROM ai_reply_settings r
        WHERE IFNULL(r.api_key, '') != '' AND IFNULL(r.model_name, '') != ''
          AND NOT EXISTS (SELECT 1 FROM ai_configs c WHERE c.api_key = r.api_key AND c.model_name = r.model_name)`)
      await db.exec(`INSERT INTO ai_configs (name, model_name, api_key, base_url, remark)
        SELECT DISTINCT r.model_name, r.model_name, r.api_key, r.base_url, '存量配置自动迁移'
        FROM item_ai_settings r
        WHERE IFNULL(r.api_key, '') != '' AND IFNULL(r.model_name, '') != ''
          AND NOT EXISTS (SELECT 1 FROM ai_configs c WHERE c.api_key = r.api_key AND c.model_name = r.model_name)`)
      await db.exec(`UPDATE ai_reply_settings SET ai_config_id = (
          SELECT MIN(c.id) FROM ai_configs c
          WHERE c.api_key = ai_reply_settings.api_key AND c.model_name = ai_reply_settings.model_name
        ) WHERE ai_config_id = 0 AND IFNULL(api_key, '') != ''`)
      await db.exec(`UPDATE item_ai_settings SET ai_config_id = (
          SELECT MIN(c.id) FROM ai_configs c
          WHERE c.api_key = item_ai_settings.api_key AND c.model_name = item_ai_settings.model_name
        ) WHERE ai_config_id = 0 AND IFNULL(api_key, '') != ''`)
      await db.run(
        "INSERT INTO system_settings (key_name, value, description) VALUES ('ai_configs_migrated', '1', '存量分散 AI 配置已迁移至配置中心')",
      )
      console.log('[xianyu-admin] 存量分散 AI 配置已迁移至 ai_configs 配置中心')
    }
  } catch (e: any) {
    console.error('[xianyu-admin] ai_configs data migration failed:', e?.message || e)
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
