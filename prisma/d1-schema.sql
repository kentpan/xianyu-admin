-- ⚠️ 自动生成文件: 由 server/utils/schema.ts 的 initSchema() 在临时库上物化导出, 请勿手改
-- 重新生成: 对新库跑 initSchema 后 dump sqlite_master (SCHEMA + MIGRATIONS 全量终态)

CREATE TABLE affiliate_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  );

CREATE TABLE affiliate_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  );

CREATE TABLE agent_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  );

CREATE TABLE ai_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(128) NOT NULL,
    model_name VARCHAR(64) DEFAULT 'qwen-plus',
    api_key VARCHAR(255) DEFAULT '',
    base_url VARCHAR(255) DEFAULT 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    enabled INTEGER DEFAULT 1,
    remark VARCHAR(255) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE ai_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cookie_id VARCHAR(64) NOT NULL,
    chat_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    intent VARCHAR(32),
    bargain_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE ai_reply_settings (
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
  , user_agent VARCHAR(255) DEFAULT '', context_enabled INTEGER DEFAULT 1, context_message_limit INTEGER DEFAULT 12, context_expire_minutes INTEGER DEFAULT 120, ai_config_id INTEGER DEFAULT 0);

CREATE TABLE api_key_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id INTEGER NOT NULL,
    endpoint VARCHAR(64) DEFAULT '',
    success INTEGER DEFAULT 0,
    status_code INTEGER DEFAULT 200,
    message VARCHAR(255) DEFAULT '',
    ip VARCHAR(64) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE api_keys (
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
  , expires_at TIMESTAMP);

CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  );

CREATE TABLE auto_reply_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            );

CREATE TABLE card_code_logs (
    id __AUTO__,
    card_id INTEGER DEFAULT 0,
    card_name VARCHAR(128) DEFAULT '',
    code VARCHAR(64) DEFAULT '',
    cookie_id VARCHAR(64) DEFAULT '',
    item_id VARCHAR(64) DEFAULT '',
    order_id VARCHAR(64) DEFAULT '',
    buyer_id VARCHAR(64) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE card_shipments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id INTEGER NOT NULL,
                card_name VARCHAR(128) DEFAULT '',
                content TEXT,
                order_id VARCHAR(64) DEFAULT '',
                item_id VARCHAR(64) DEFAULT '',
                buyer_id VARCHAR(64) DEFAULT '',
                cookie_id VARCHAR(64) DEFAULT '',
                user_id INTEGER DEFAULT 1,
                shipped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

CREATE TABLE cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  , price VARCHAR(32) DEFAULT '0.00', is_dockable INTEGER DEFAULT 0, fee_payer VARCHAR(16) DEFAULT 'distributor', min_price VARCHAR(32), dock_visibility VARCHAR(16) DEFAULT 'public', code_length INTEGER DEFAULT 6, code_letters INTEGER DEFAULT 1, code_digits INTEGER DEFAULT 1, code_case VARCHAR(8) DEFAULT 'mixed', code_template TEXT);

CREATE TABLE cookie_status (
    cookie_id VARCHAR(64) PRIMARY KEY,
    enabled INTEGER DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE cookies (
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
  , xianyu_uid VARCHAR(64) DEFAULT '', avatar TEXT, login_type VARCHAR(16) DEFAULT 'cookie', cookie_status_text VARCHAR(32) DEFAULT 'unknown', last_check_at TIMESTAMP, auto_rate_enabled INTEGER DEFAULT 0, auto_flower_enabled INTEGER DEFAULT 0, auto_thanks_enabled INTEGER DEFAULT 0, auto_receive_flower_enabled INTEGER DEFAULT 0, nickname VARCHAR(128) DEFAULT '', avatar_url TEXT, location VARCHAR(255) DEFAULT '', bio TEXT, followers INTEGER DEFAULT 0, following INTEGER DEFAULT 0, profile_updated_at TIMESTAMP, device_id VARCHAR(128) DEFAULT '');

CREATE TABLE default_replies (
    cookie_id VARCHAR(64) PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    reply_content TEXT,
    reply_image_url TEXT,
    reply_once INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE default_reply_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cookie_id VARCHAR(64) NOT NULL,
                chat_id VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(cookie_id, chat_id)
            );

CREATE TABLE delivery_block_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            );

CREATE TABLE delivery_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword VARCHAR(255) NOT NULL,
    card_id INTEGER NOT NULL,
    delivery_count INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1,
    description TEXT,
    delivery_times INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  , require_paid INTEGER DEFAULT 1, trigger_type VARCHAR(16) DEFAULT 'keyword', item_id VARCHAR(64) DEFAULT '', cookie_id VARCHAR(64), ship_mode VARCHAR(16) DEFAULT '', send_message_on_ship INTEGER DEFAULT 1, send_verify_code INTEGER DEFAULT 0);

CREATE TABLE dock_code_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    dock_code VARCHAR(32) NOT NULL,
    target_user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, target_user_id)
  );

CREATE TABLE dock_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  );

CREATE TABLE engine_subscribers (
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
  );

CREATE TABLE engine_event_dedup (
    event_id VARCHAR(80) PRIMARY KEY,
    actions_json TEXT DEFAULT '[]',
    pending INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE chat_pauses (
    cookie_id VARCHAR(64) NOT NULL,
    chat_id VARCHAR(64) NOT NULL,
    paused_until TIMESTAMP NOT NULL,
    PRIMARY KEY (cookie_id, chat_id)
  );

CREATE TABLE engines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(16) NOT NULL DEFAULT 'remote',
    host VARCHAR(255) DEFAULT '',
    port INTEGER DEFAULT 0,
    remark VARCHAR(255) DEFAULT '',
    enabled INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 0,
    last_seen_at TIMESTAMP,
    last_status TEXT,
    last_poll_ip VARCHAR(64) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  , token VARCHAR(64) DEFAULT '');

CREATE TABLE fund_flows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type VARCHAR(16) NOT NULL,
    amount VARCHAR(32) NOT NULL,
    balance_before VARCHAR(32) NOT NULL,
    balance_after VARCHAR(32) NOT NULL,
    order_id INTEGER,
    dock_record_id INTEGER,
    description VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE im_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  );

CREATE TABLE im_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  );

CREATE TABLE in_app_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type VARCHAR(32) DEFAULT 'info',
    title VARCHAR(255) NOT NULL,
    message TEXT,
    read INTEGER DEFAULT 0,
    link VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE item_ai_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ai_config_id INTEGER DEFAULT 0,
    UNIQUE(cookie_id, item_id)
  );

CREATE TABLE item_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  );

CREATE TABLE item_replay (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id VARCHAR(64) NOT NULL,
    cookie_id VARCHAR(64) NOT NULL,
    reply_content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cookie_id VARCHAR(64) NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    reply TEXT NOT NULL,
    item_id VARCHAR(64) DEFAULT '',
    type VARCHAR(16) DEFAULT 'text',
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE message_filters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cookie_id VARCHAR(64) NOT NULL,
                keyword VARCHAR(255) NOT NULL,
                filter_type VARCHAR(16) DEFAULT 'skip_reply',
                enabled INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

CREATE TABLE message_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cookie_id VARCHAR(64) NOT NULL,
    channel_id INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, name VARCHAR(128) DEFAULT '', event_types TEXT,
    UNIQUE(cookie_id, channel_id)
  );

CREATE TABLE notification_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(32) NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE orders (
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
  , system_shipped INTEGER DEFAULT 0, version INTEGER DEFAULT 1, buy_num INTEGER DEFAULT 1, auction_price VARCHAR(32) DEFAULT '', confirm_fee VARCHAR(32) DEFAULT '', refund_fee VARCHAR(32) DEFAULT '', post_fee VARCHAR(32) DEFAULT '', consign_status VARCHAR(16) DEFAULT '', consign_message VARCHAR(255) DEFAULT '', consign_at TIMESTAMP);

CREATE TABLE qr_login_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  );

CREATE TABLE risk_control_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cookie_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL DEFAULT 'slider_captcha',
    event_description TEXT,
    processing_result TEXT,
    processing_status VARCHAR(32) DEFAULT 'processing',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE settlement_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  );

CREATE TABLE system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level VARCHAR(16) DEFAULT 'INFO',
    module VARCHAR(64),
    message TEXT,
    meta TEXT,
    user_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE system_settings (
    key_name VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE user_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_name VARCHAR(64) NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, key_name)
  );

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(128) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active INTEGER DEFAULT 1,
    is_admin INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  , dock_code VARCHAR(32), secret_key VARCHAR(64), phone VARCHAR(32));

CREATE TABLE verify_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(16) NOT NULL UNIQUE,
    order_id VARCHAR(64) DEFAULT '',
    item_id VARCHAR(64) DEFAULT '',
    buyer_id VARCHAR(64) DEFAULT '',
    cookie_id VARCHAR(64) DEFAULT '',
    rule_id INTEGER DEFAULT 0,
    card_id INTEGER DEFAULT 0,
    status VARCHAR(16) DEFAULT 'unused',
    used_at TIMESTAMP,
    used_ip VARCHAR(64) DEFAULT '',
    used_by_key_id INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE INDEX idx_aff_account_user ON affiliate_accounts(user_id);

CREATE INDEX idx_aff_product_account ON affiliate_products(account_id);

CREATE INDEX idx_aff_product_user ON affiliate_products(user_id);

CREATE INDEX idx_agent_order_no ON agent_orders(order_no);

CREATE INDEX idx_agent_owner ON agent_orders(owner_user_id);

CREATE INDEX idx_agent_upstream ON agent_orders(upstream_user_id);

CREATE INDEX idx_agent_user ON agent_orders(user_id);

CREATE INDEX idx_apilog_key ON api_key_logs(api_key_id, id);

CREATE INDEX idx_autolog_cookie ON auto_reply_logs(cookie_id, id);

CREATE INDEX idx_cardcode_created ON card_code_logs(created_at);

CREATE INDEX idx_dock_card ON dock_records(card_id);

CREATE INDEX idx_dock_parent ON dock_records(parent_dock_id);

CREATE INDEX idx_dock_user ON dock_records(user_id);

CREATE INDEX idx_fund_user ON fund_flows(user_id, id);

CREATE INDEX idx_imconv_account ON im_conversations(cookie_id, updated_at);

CREATE INDEX idx_immsg_chat ON im_messages(cookie_id, chat_id, id);

CREATE INDEX idx_qrlogin_user ON qr_login_sessions(user_id);

CREATE INDEX idx_settle_user ON settlement_records(user_id);

CREATE INDEX idx_ship_card ON card_shipments(card_id, id);

CREATE INDEX idx_vcode_order ON verify_codes(order_id);

CREATE INDEX idx_vcode_status ON verify_codes(status, created_at);

