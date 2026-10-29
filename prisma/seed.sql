-- ⚠️ 自动生成文件: 由 scripts/generate-d1-schema.mjs 从 server/utils/schema.ts 物化导出, 请勿手改
-- 重新生成: node scripts/generate-d1-schema.mjs

-- 默认系统配置 (key_name 主键, INSERT OR IGNORE 幂等, 可重复执行)
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('theme_color', 'amber', '主题颜色');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('registration_enabled', 'false', '是否开启用户注册');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('show_default_login_info', 'false', '是否显示默认登录信息');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('login_captcha_enabled', 'false', '登录验证码开关');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('smtp_server', '', 'SMTP服务器地址');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('smtp_port', '587', 'SMTP端口');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('smtp_user', '', 'SMTP用户名');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('smtp_password', '', 'SMTP密码');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('smtp_from', '', '发件人地址');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('ai_model', 'qwen-plus', '默认AI模型');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('ai_api_url', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'AI API地址');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('default_reply', '亲爱的老板你好！所有宝贝都可以拍，秒发货的哈~不满意可以直接申请退款哈~', '默认回复内容');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('item_sync_enabled', 'true', '商品自动同步开关');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('item_sync_interval', '600', '商品同步间隔(秒)');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('item_sync_max_pages', '5', '商品同步最大页数');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('app_name', '闲鱼超级管家', '应用名称');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('distribution.enabled', 'true', '是否开启返佣分销系统');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('distribution.fee_type', 'fixed', '分销手续费类型: fixed|percent');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('distribution.fee_rate', '0', '分销手续费率 (fixed=元, percent=百分数)');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('withdraw.min_amount', '1', '最低提现金额(元)');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('withdraw.max_amount', '10000', '单笔最高提现金额(元)');
INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('withdraw.notify_email', '', '提现通知邮箱(留空则需管理员后台审核)');
