/**
 * E2E: 无需邮寄发货 + API/卡密/文本/图片 4 种卡券类型 — 自动发送与变量解析替换全链路验证。
 *
 * 走真实链路: 本地 mock 发卡接口 → /api/engine/events (独立代理上报协议, 引擎令牌鉴权)
 *           → brain 决策 (规则匹配/变量上下文/卡券提取/无需邮寄 mtop) → actions 回收 → DB 落库核验。
 *
 * 测试数据一律带 e2edel 前缀, 结束后全量清理, 不触碰真实数据 (xy_2214722801206 / 真实卡券 / 79 条日志)。
 * 运行: node scripts/e2e-delivery-flow.mjs   (要求 dev 服务器已在 3000 端口运行)
 */
import { DatabaseSync } from 'node:sqlite'
import http from 'node:http'

const BASE = 'http://localhost:3000'
const DB_PATH = 'prisma/xianyu_admin.db'
const ACC = 'xy_e2edel_acc'
// 每用例独立商品 (payment 直配规则一商品一条, 用例间互不干扰)
const ITEM_T = 'E2EDEL-ITEM-T'
const ITEM_C = 'E2EDEL-ITEM-C'
const ITEM_A = 'E2EDEL-ITEM-A'
const ITEM_I = 'E2EDEL-ITEM-I'
const ITEM_F = 'E2EDEL-ITEM-F'
const ITEM_D = 'E2EDEL-ITEM-D'
const ALL_ITEMS = [ITEM_T, ITEM_C, ITEM_A, ITEM_I, ITEM_F, ITEM_D]
const BUYER = 'e2edel-buyer-1'
const NICK = 'E2E买家昵称'
const CHAT = 'e2edel-chat-1'
const TITLE = 'E2E测试会员季度卡'
const PRICE = '25.9'
const APIKEY = 'sk-e2edel-key-888'
const ENGINE_TOKEN = 'e2edel-engine-token-0001'
// 每轮运行唯一后缀: 订单号/event_id 随轮变化 — 发货成功后的 orderCooldown (10min, 内存 Map, dev 不重启跨轮保留)
// 与 engine_event_dedup 都不会拦同轮新单, 但会拦跨轮重用的旧单号
const RUN = String(Date.now()).slice(-8)
const mkOrderId = (n) => `3021${RUN}${n}`
const mkEvt = (tag) => `e2edel-evt-${RUN}-${tag}`

const db = new DatabaseSync(DB_PATH)
const q = (sql, p = []) => db.prepare(sql).all(...p)
const run = (sql, p = []) => db.prepare(sql).run(...p)
const one = (sql, p = []) => db.prepare(sql).get(...p)

let mockHits = []
let mockServer = null

/* ------------------------- mock 发卡接口 (API 卡券目标) ------------------------- */
function startMockApi() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        mockHits.push({ url: req.url, headers: req.headers, body })
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ code: 0, msg: 'ok', data: { url: 'https://share.example.com/e2edel/xyz123', token: 'ignored' } }))
      })
    })
    mockServer.listen(0, '127.0.0.1', () => resolve(mockServer.address().port))
  })
}

/* ------------------------------- HTTP 工具 ------------------------------- */
async function postEvents(events, extraHeaders = {}) {
  const res = await fetch(`${BASE}/api/engine/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ENGINE_TOKEN}`, ...extraHeaders },
    body: JSON.stringify({ events }),
  })
  const json = await res.json().catch(() => null)
  // 响应包装层: { success, code, message, data: { actions, pending } }
  return { status: res.status, json: json?.data || json }
}

/* ------------------------------- 断言工具 ------------------------------- */
let passCount = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) {
    passCount++
    console.log(`  PASS  ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/* ------------------------------- 测试数据准备 ------------------------------- */
function seed() {
  // 引擎 (is_active=1, 专用令牌)
  run(
    `INSERT INTO engines (slug, name, type, host, port, enabled, is_active, token) VALUES ('e2edel-engine', 'E2E发货验证引擎', 'proxy', '127.0.0.1', 1, 1, 1, ?)`,
    [ENGINE_TOKEN],
  )
  // 账号 (auto_confirm=0: ship_mode 全部走规则显式配置, 排除账号级开关干扰)
  run(
    `INSERT INTO cookies (id, value, user_id, auto_confirm, cookie_status_text) VALUES (?, 'cookie=e2edel-fake', 'e2edel-uid-1', 0, 'listening')`,
    [ACC],
  )
  // 商品 (每用例独立 item_id, 共用标题/价格)
  for (const it of ALL_ITEMS) {
    run(
      `INSERT INTO item_info (cookie_id, item_id, item_title, item_price, item_description) VALUES (?, ?, ?, ?, 'E2E 规则匹配 haystack')`,
      [ACC, it, TITLE, PRICE],
    )
  }
  // 会话 (peer_nick → {username} 变量来源)
  run(
    `INSERT INTO im_conversations (cookie_id, chat_id, peer_nick, item_id, peer_user_id, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [ACC, CHAT, NICK, ITEM_T, BUYER],
  )
}

/** 建 4 类卡券 + 规则; 返回 { textRule, codeRule, apiRule, imageRule } 的 rule id */
function seedCardsAndRules({ mockPort }) {
  // 文本卡券 (全变量渲染; 非 API 卡券无 api_config → {apikey} 置空串)
  const cardText = run(
    `INSERT INTO cards (name, type, text_content, enabled) VALUES ('e2edel-文本卡券', 'text', ?, 1)`,
    ['文本卡券发货: {title} | 单价 {price} | 买家 {username}({userid}) | 密钥 {apikey}'],
  )
  const ruleText = run(
    `INSERT INTO delivery_rules (keyword, card_id, delivery_count, enabled, require_paid, trigger_type, item_id, cookie_id, ship_mode) VALUES ('e2edel-haystack-text', ?, 1, 1, 1, 'payment', ?, ?, 'none')`,
    [cardText.lastInsertRowid, ITEM_T, ACC],
  )

  // 卡密卡券 (delivery_count=2 验证按份生成; 模板含 {code} + {title})
  const cardCode = run(
    `INSERT INTO cards (name, type, code_length, code_letters, code_digits, code_case, code_template, enabled) VALUES ('e2edel-卡密卡券', 'code', 12, 1, 1, 'upper', ?, 1)`,
    ['您购买 {title} 的卡密: {code} (单价 {price})'],
  )
  const ruleCode = run(
    `INSERT INTO delivery_rules (keyword, card_id, delivery_count, enabled, require_paid, trigger_type, item_id, cookie_id, ship_mode) VALUES ('e2edel-haystack-code', ?, 2, 1, 1, 'payment', ?, ?, 'none')`,
    [cardCode.lastInsertRowid, ITEM_C, ACC],
  )

  // API 卡券 (url/header/body 全变量; price 整值占位 → 数字; data_path=data.url; shareURL 回写渲染)
  const apiConfig = JSON.stringify({
    api_key: APIKEY,
    url: `http://127.0.0.1:${mockPort}/api/issue?uid={userid}&k={apikey}&t={title}`,
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer {apikey}' },
    body: { user: '{username}', price: '{price}', title: '{title}', extra: { nested: '{userid}' } },
    data_path: 'data.url',
  })
  const cardApi = run(
    `INSERT INTO cards (name, type, api_config, text_content, description, enabled) VALUES ('e2edel-API卡券', 'api', ?, ?, ?, 1)`,
    [apiConfig, '您的专属链接: {shareURL} (订单价 {price} 元)', '感谢购买 {title}, 提取链接: {shareURL}'],
  )
  const ruleApi = run(
    `INSERT INTO delivery_rules (keyword, card_id, delivery_count, enabled, require_paid, trigger_type, item_id, cookie_id, ship_mode) VALUES ('e2edel-haystack-api', ?, 1, 1, 1, 'payment', ?, ?, 'none')`,
    [cardApi.lastInsertRowid, ITEM_A, ACC],
  )

  // 图片卡券 (image_url + text_content 变量)
  const cardImage = run(
    `INSERT INTO cards (name, type, image_url, text_content, enabled) VALUES ('e2edel-图片卡券', 'image', 'https://img.example.com/e2edel/redeem-guide.png', ?, 1)`,
    ['图片卡券附言: {title} 单价 {price}'],
  )
  const ruleImage = run(
    `INSERT INTO delivery_rules (keyword, card_id, delivery_count, enabled, require_paid, trigger_type, item_id, cookie_id, ship_mode) VALUES ('e2edel-haystack-image', ?, 1, 1, 1, 'payment', ?, ?, 'none')`,
    [cardImage.lastInsertRowid, ITEM_I, ACC],
  )

  return {
    ruleText: Number(ruleText.lastInsertRowid),
    ruleCode: Number(ruleCode.lastInsertRowid),
    ruleApi: Number(ruleApi.lastInsertRowid),
    ruleImage: Number(ruleImage.lastInsertRowid),
    cardText: Number(cardText.lastInsertRowid),
    cardCode: Number(cardCode.lastInsertRowid),
    cardApi: Number(cardApi.lastInsertRowid),
    cardImage: Number(cardImage.lastInsertRowid),
  }
}

/** 付款卡片事件 (isPaymentTrigger 命中 + raw 全文兜底 orderId) */
function paymentEvent(orderId, eventId, itemId = ITEM_T) {
  return {
    type: 'chat',
    account: ACC,
    event_id: eventId,
    chat_id: CHAT,
    sender_user_id: BUYER,
    sender_nick: NICK,
    content: '[我已付款，等待你发货]',
    item_id: itemId,
    create_time: Date.now(),
    session_type: '1',
    is_self: false,
    remark: `orderId=${orderId}`, // extractOrderId 全文兜底
  }
}

/* ------------------------------- 清理 ------------------------------- */
function cleanup() {
  const ids = {
    account: ACC,
    chat: CHAT,
  }
  run(`DELETE FROM engine_event_dedup WHERE event_id LIKE 'e2edel-evt-%'`)
  run(`DELETE FROM auto_reply_logs WHERE cookie_id = ? OR chat_id = ?`, [ACC, CHAT])
  run(`DELETE FROM card_shipments WHERE cookie_id = ?`, [ACC])
  run(`DELETE FROM card_code_logs WHERE cookie_id = ?`, [ACC])
  run(`DELETE FROM orders WHERE cookie_id = ?`, [ACC])
  run(`DELETE FROM delivery_rules WHERE keyword LIKE 'e2edel-haystack-%'`)
  run(`DELETE FROM cards WHERE name LIKE 'e2edel-%'`)
  run(`DELETE FROM item_info WHERE cookie_id = ? OR item_id LIKE 'E2EDEL-ITEM-%'`, [ids.account])
  run(`DELETE FROM im_conversations WHERE cookie_id = ? OR chat_id = ?`, [ids.account, ids.chat])
  run(`DELETE FROM im_messages WHERE cookie_id = ? OR chat_id = ?`, [ids.account, ids.chat])
  run(`DELETE FROM cookies WHERE id = ?`, [ids.account])
  run(`DELETE FROM engines WHERE slug = 'e2edel-engine' OR token = ?`, [ENGINE_TOKEN])
}

/* ================================ 用例 ================================ */
async function caseTextCard(ids) {
  console.log('\n■ 用例1: 文本卡券 — 变量全替换 + 自动发送 + 落库')
  const orderId = mkOrderId(1)
  const { json } = await postEvents([paymentEvent(orderId, mkEvt('text'))])
  const acts = (json?.actions || []).filter((a) => a.type === 'send_text')
  check('付款事件触发自动发货 (返回动作)', acts.length >= 1, JSON.stringify(json).slice(0, 200))
  // 非 API 卡券: apiConf={} → {apikey} 替换为空串
  check(
    '变量解析替换正确 ({title}{price}{username}{userid}{apikey}, 非API卡券 apikey 置空)',
    acts[0]?.text === `文本卡券发货: ${TITLE} | 单价 ${PRICE} | 买家 ${NICK}(${BUYER}) | 密钥 `,
    `实际: ${acts[0]?.text}`,
  )
  const ord = one(`SELECT order_status, system_shipped, consign_status, amount FROM orders WHERE order_id = ?`, [orderId])
  check('订单 system_shipped=1 状态 shipped', ord?.system_shipped === 1 && ord?.order_status === 'shipped', JSON.stringify(ord))
  check('ship_mode=none 不触发无需邮寄 (consign_status 空)', !ord?.consign_status, String(ord?.consign_status))
  check('订单金额回填商品定价', String(ord?.amount) === PRICE, String(ord?.amount))
  const ship = one(`SELECT content FROM card_shipments WHERE order_id = ?`, [orderId])
  check('发货记录落库 (card_shipments)', !!ship, JSON.stringify(ship))
  const log = one(`SELECT id, decision_reason, reply_strategy, process_status, send_status FROM auto_reply_logs WHERE cookie_id = ? AND decision_reason = 'auto_delivered' ORDER BY id DESC`, [ACC])
  check('决策日志 auto_delivered/delivery/success', log?.decision_reason === 'auto_delivered' && log?.reply_strategy === 'delivery' && log?.process_status === 'success', JSON.stringify(log))
  check('动作携带 log_id (发送状态联动)', Number(acts[0]?.log_id) === Number(log?.id), `act.log_id=${acts[0]?.log_id} log.id=${log?.id}`)
  const rule = one(`SELECT delivery_times FROM delivery_rules WHERE id = ?`, [ids.ruleText])
  check('规则发货计数 +1', Number(rule?.delivery_times) === 1, String(rule?.delivery_times))
  // 幂等: 同订单重复上报不再发
  const again = await postEvents([paymentEvent(orderId, mkEvt('text-again'))])
  check('重复触发不再发货 (system_shipped 短路)', (again.json?.actions || []).length === 0, JSON.stringify(again.json?.actions).slice(0, 120))
}

async function caseCodeCard() {
  console.log('\n■ 用例2: 卡密卡券 — 按份生成 + 落库一致 + 文案渲染')
  const orderId = mkOrderId(2)
  const { json } = await postEvents([paymentEvent(orderId, mkEvt('code'), ITEM_C)])
  const texts = (json?.actions || []).filter((a) => a.type === 'send_text' && a.text.includes('卡密'))
  check('delivery_count=2 生成两份卡密动作', texts.length === 2, `收到 ${texts.length} 条: ${JSON.stringify((json?.actions || []).map((a) => a.text))}`)
  const codes = texts.map((a) => {
    const m = String(a.text || '').match(/卡密: ([A-Z0-9]+)/)
    return m ? m[1] : ''
  })
  check('卡密 12 位大写字母+数字', codes.every((c) => /^[A-Z0-9]{12}$/.test(c)), JSON.stringify(codes))
  check('两份卡密互不相同', codes[0] !== codes[1], JSON.stringify(codes))
  check('文案变量渲染 ({title}{price})', texts.every((a) => a.text === `您购买 ${TITLE} 的卡密: ${a.text.match(/卡密: ([A-Z0-9]+)/)?.[1]} (单价 ${PRICE})`), JSON.stringify(texts.map((t) => t.text)))
  const rows = q(`SELECT code, status FROM card_code_logs WHERE order_id = ? ORDER BY id`, [orderId])
  check('card_code_logs 落库 2 条 unused 且与文案一致', rows.length === 2 && rows.every((r, i) => r.status === 'unused' && r.code === codes[i]), JSON.stringify(rows))
}

async function caseApiCard() {
  console.log('\n■ 用例3: API 卡券 — 请求构建变量替换 + shareURL 回写 + 发货文案/消息回复渲染')
  mockHits = []
  const orderId = mkOrderId(3)
  const { json } = await postEvents([paymentEvent(orderId, mkEvt('api'), ITEM_A)])
  await new Promise((r) => setTimeout(r, 300))
  check('mock 发卡接口恰好被调用 1 次', mockHits.length === 1, `实际 ${mockHits.length} 次`)
  const hit = mockHits[0] || { url: '', headers: {}, body: '' }
  const u = new URL(hit.url, 'http://x')
  check('URL 变量替换 ({userid}{apikey}{title})', u.searchParams.get('uid') === BUYER && u.searchParams.get('k') === APIKEY && u.searchParams.get('t') === TITLE, hit.url)
  check('Header 变量替换 (Authorization: Bearer {apikey})', hit.headers['authorization'] === `Bearer ${APIKEY}`, String(hit.headers['authorization']))
  let bodyObj = {}
  try { bodyObj = JSON.parse(hit.body) } catch {}
  check('Body 变量替换: {username}/{title} 字符串', bodyObj.user === NICK && bodyObj.title === TITLE, hit.body)
  check('Body 整值占位 {price} → 数字 25.9', bodyObj.price === 25.9, `实际类型 ${typeof bodyObj.price} 值 ${JSON.stringify(bodyObj.price)}`)
  check('Body 嵌套对象递归替换 ({userid})', bodyObj.extra?.nested === BUYER, hit.body)
  const acts = json?.actions || []
  const deliverText = acts.find((a) => a.type === 'send_text' && String(a.text).includes('您的专属链接'))
  const replyText = acts.find((a) => a.type === 'send_text' && String(a.text).includes('感谢购买'))
  check('发货文案 {shareURL} 渲染为 API 提取结果', deliverText?.text === '您的专属链接: https://share.example.com/e2edel/xyz123 (订单价 25.9 元)', String(deliverText?.text))
  check('消息回复 (卡券描述) {shareURL}{title} 渲染', replyText?.text === `感谢购买 ${TITLE}, 提取链接: https://share.example.com/e2edel/xyz123`, String(replyText?.text))
  const ord = one(`SELECT system_shipped FROM orders WHERE order_id = ?`, [orderId])
  check('API 卡券发货订单 system_shipped=1', Number(ord?.system_shipped) === 1, JSON.stringify(ord))
}

async function caseImageCard() {
  console.log('\n■ 用例4: 图片卡券 — send_image + 附言变量渲染')
  const orderId = mkOrderId(4)
  const { json } = await postEvents([paymentEvent(orderId, mkEvt('image'), ITEM_I)])
  const img = (json?.actions || []).find((a) => a.type === 'send_image')
  const txt = (json?.actions || []).find((a) => a.type === 'send_image' ? false : String(a.text || '').includes('图片卡券附言'))
  check('图片动作 send_image URL 正确', img?.image_url === 'https://img.example.com/e2edel/redeem-guide.png' && img?.chat_id === CHAT && img?.to_user_id === BUYER, JSON.stringify(img))
  check('附言文本变量渲染 ({title}{price})', txt?.text === `图片卡券附言: ${TITLE} 单价 ${PRICE}`, String(txt?.text))
  const ord = one(`SELECT system_shipped FROM orders WHERE order_id = ?`, [orderId])
  check('图片卡券发货订单 system_shipped=1', Number(ord?.system_shipped) === 1, JSON.stringify(ord))
}

async function caseTradeCompleteFallback() {
  console.log('\n■ 用例5: [买家确认收货，交易成功] 兜底补发 (图1 场景回归)')
  const orderId = mkOrderId(5)
  // 付款卡片丢失: 订单直接预落库为 pending_ship (人工补录形态), 无付款触发
  // 商品用 ITEM_T (文本规则直配商品) — 兜底链路复用同一规则体系
  run(
    `INSERT INTO orders (order_id, item_id, buyer_id, order_status, cookie_id, chat_id, amount, version, system_shipped) VALUES (?, ?, ?, 'pending_ship', ?, ?, '', 1, 0)`,
    [orderId, ITEM_T, BUYER, ACC, CHAT],
  )
  const { json } = await postEvents([
    {
      type: 'chat',
      account: ACC,
      event_id: mkEvt('trade'),
      chat_id: CHAT,
      sender_user_id: BUYER,
      sender_nick: NICK,
      content: '[买家确认收货，交易成功]',
      item_id: ITEM_T,
      create_time: Date.now(),
      session_type: '1',
      is_self: false,
      remark: `orderId=${orderId}`,
    },
  ])
  const texts = (json?.actions || []).filter((a) => a.type === 'send_text')
  check('交易成功卡片触发兜底补发', texts.length >= 1, JSON.stringify(json?.actions).slice(0, 200))
  const log = one(`SELECT decision_reason, reply_strategy FROM auto_reply_logs WHERE cookie_id = ? AND source_message = '[买家确认收货，交易成功]' AND decision_reason = 'auto_delivered' ORDER BY id DESC`, [ACC])
  check('兜底发货决策日志 auto_delivered', !!log, JSON.stringify(log))
  const ord = one(`SELECT system_shipped, order_status FROM orders WHERE order_id = ?`, [orderId])
  check('兜底发货后 system_shipped=1', Number(ord?.system_shipped) === 1, JSON.stringify(ord))
  // 已发货后再来一条交易成功卡片 → 不补发
  const again = await postEvents([
    { type: 'chat', account: ACC, event_id: mkEvt('trade2'), chat_id: CHAT, sender_user_id: BUYER, sender_nick: NICK, content: '[买家确认收货，交易成功]', item_id: ITEM_T, create_time: Date.now(), session_type: '1', is_self: false, remark: `orderId=${orderId}` },
  ])
  check('已发货订单收到交易成功卡片不再补发', (again.json?.actions || []).length === 0, JSON.stringify(again.json?.actions).slice(0, 150))
}

async function caseDummyConsign() {
  // (v2.1.16) 断言对齐现行凭证语义 (v2.1.7 起): 成功 → 文本随发货凭证提交平台不占聊天消息;
  // 失败 (含沙盒 Session 过期) → 静默阻断不标记已发货, 由 [记得及时发货]/付款重报重试链自动补发。
  // 旧「mtop 失败不阻塞照发消息」语义已废弃 — 断言改为与发货结果自洽, Session 存活/过期两种环境均成立。
  console.log('\n■ 用例6: 无需邮寄发货 (ship_mode=dummy_consign) — mtop 调用 + 状态回写 + 凭证/重试语义')
  const orderId = mkOrderId(6)
  const cardText = one(`SELECT id FROM cards WHERE name = 'e2edel-文本卡券'`)
  const rule = run(
    `INSERT INTO delivery_rules (keyword, card_id, delivery_count, enabled, require_paid, trigger_type, item_id, cookie_id, ship_mode) VALUES ('e2edel-haystack-dummy', ?, 1, 1, 1, 'payment', ?, ?, 'dummy_consign')`,
    [cardText.id, ITEM_D, ACC],
  )
  const { json } = await postEvents([paymentEvent(orderId, 'e2edel-evt-dummy', ITEM_D)])
  const texts = (json?.actions || []).filter((a) => a.type === 'send_text')
  check('发货内容不降级为聊天消息 (成功走发货凭证 / 失败静默等重试)', texts.length === 0, JSON.stringify(json?.actions).slice(0, 200))
  const ord = one(`SELECT system_shipped, consign_status, consign_message, consign_at FROM orders WHERE order_id = ?`, [orderId])
  check(
    '无需邮寄发货已尝试 (consign_status success/failed 二值, mtop 已外呼)',
    ['success', 'failed'].includes(String(ord?.consign_status)) && !!ord?.consign_at,
    JSON.stringify(ord),
  )
  const consigned = String(ord?.consign_status) === 'success'
  check('system_shipped 与平台发货结果一致 (success=1 / failed=0 等重试链补发)', Number(ord?.system_shipped) === (consigned ? 1 : 0), JSON.stringify(ord))
  console.log(`  INFO  mtop dummy consign 返回: ${ord?.consign_status} — ${ord?.consign_message}`)
  const times = Number(one(`SELECT delivery_times FROM delivery_rules WHERE id = ?`, [Number(rule.lastInsertRowid)])?.delivery_times)
  check('规则计数与发货结果一致 (success +1 / failed 不计等重试)', consigned ? times === 1 : times === 0)
}

/* ================================ 主流程 ================================ */
async function main() {
  console.log('=== E2E: 无需邮寄 + 4 种卡券类型自动发货全链路 ===')
  cleanup() // 先清一次防残留
  const mockPort = await startMockApi()
  console.log(`mock 发卡接口: http://127.0.0.1:${mockPort}/api/issue`)
  seed()
  const ids = seedCardsAndRules({ mockPort })

  await caseTextCard(ids)
  await caseCodeCard()
  await caseApiCard()
  await caseImageCard()
  await caseTradeCompleteFallback()
  await caseDummyConsign()

  // 清理 + 关闭
  cleanup()
  mockServer.close()

  console.log(`\n=== 结果: ${passCount} PASS / ${failures.length} FAIL ===`)
  if (failures.length) {
    console.log('失败项:')
    failures.forEach((f) => console.log(`  ✗ ${f}`))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('E2E 异常:', e)
  cleanup()
  mockServer?.close()
  process.exit(1)
})
