/**
 * E2E: 闲鱼后台(xianyu-admin) → autoship 资源交付平台 全流程打通验证。
 *
 * 链路: 买家付款事件 → brain autoDeliver (API卡券) → POST autoship /api/issue
 *       (Bearer apikey + body{title,price,item_id}) → autoship 按商品ID匹配绑定资源
 *       → 返回加密分享链接 (data.url) → {shareURL} 回写渲染发货文案 → 发给买家
 *       → 买家打开 /s/<token> 提取页 → /api/redeem 核销成功。
 *
 * 测试数据一律带 e2edel 前缀, 结束后两侧全量清理 (xianyu_admin.db + cards-autoship/db/custom.db)。
 * 运行: node scripts/e2e-autoship-flow.mjs   (要求 3000/3010 两服务均在运行)
 */
import { DatabaseSync } from 'node:sqlite'

const XY_BASE = 'http://localhost:3000'
const AS_BASE = 'http://localhost:3010'
const XY_DB = 'prisma/xianyu_admin.db'
const AS_DB = 'cards-autoship/db/custom.db'

const ACC = 'xy_e2edel_acc'
const ITEM = 'e2edel-item-a1' // 与 autoship 绑定资源一致的商品ID
const BUYER = 'e2edel-buyer-1'
const NICK = 'E2E买家昵称'
const CHAT = 'e2edel-chat-1'
const TITLE = 'E2E联动测试资源'
const PRICE = '19.9'
const ENGINE_TOKEN = 'e2edel-engine-token-0001'
const AS_KEY = 'ak-e2edel' + String(Date.now()).slice(-8) + 'ff'
const RUN = String(Date.now()).slice(-8)
const ORDER_ID = `3022${RUN}1`
const EVT_ID = `e2edel-evt-${RUN}-as`

const xy = new DatabaseSync(XY_DB)
const as = new DatabaseSync(AS_DB)
const xq = (sql, p = []) => xy.prepare(sql).all(...p)
const xr = (sql, p = []) => xy.prepare(sql).run(...p)
const aq = (sql, p = []) => as.prepare(sql).all(...p)
const ar = (sql, p = []) => as.prepare(sql).run(...p)

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

/* ------------------------------- 测试数据 ------------------------------- */
async function warmup() {
  // 触发 autoship ensureSchema (幂等建表 + 旧库补列迁移): redeem 对空体会先跑迁移再报格式错误
  await fetch(`${AS_BASE}/api/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }).catch(() => {})
}

function seed() {
  // ── autoship 侧: APIKEY + 绑定商品的资源 ──
  ar(`INSERT INTO apikeys (name, key, status, rate_limit, rate_window, calls, created_at) VALUES ('e2edel-闲鱼对接', ?, 'active', 60, 60, 0, ?)`, [AS_KEY, Date.now()])
  ar(
    `INSERT INTO scripts (name, filename, path, type, delivery_style, item_id, size, status, created_at, updated_at)
     VALUES ('e2edel-联动测试资源', 'e2edel-tool.ps1', 'https://example.com/e2edel-tool.ps1', 'ps1', 'auto', ?, 0, 'active', ?, ?)`,
    [ITEM, Date.now(), Date.now()],
  )
  // ── xianyu-admin 侧: 引擎/账号/商品/会话 ──
  xr(
    `INSERT INTO engines (slug, name, type, host, port, enabled, is_active, token) VALUES ('e2edel-engine', 'E2E发货验证引擎', 'proxy', '127.0.0.1', 1, 1, 1, ?)`,
    [ENGINE_TOKEN],
  )
  xr(`INSERT INTO cookies (id, value, user_id, auto_confirm, cookie_status_text) VALUES (?, 'cookie=e2edel-fake', 'e2edel-uid-1', 0, 'listening')`, [ACC])
  xr(
    `INSERT INTO item_info (cookie_id, item_id, item_title, item_price, item_description) VALUES (?, ?, ?, ?, 'E2E联动商品')`,
    [ACC, ITEM, TITLE, PRICE],
  )
  xr(
    `INSERT INTO im_conversations (cookie_id, chat_id, peer_nick, item_id, peer_user_id, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [ACC, CHAT, NICK, ITEM, BUYER],
  )
  // API 卡券: 直指 autoship /api/issue, 传商品ID匹配, data_path=data.url 取加密分享链接
  const apiConfig = JSON.stringify({
    api_key: AS_KEY,
    url: `${AS_BASE}/api/issue`,
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer {apikey}' },
    body: { title: '{title}', price: '{price}', item_id: '{item_id}' },
    data_path: 'data.url',
  })
  xr(
    `INSERT INTO cards (name, type, api_config, text_content, description, enabled) VALUES ('e2edel-autoship卡券', 'api', ?, ?, ?, 1)`,
    [apiConfig, '您购买的资源已就绪, 提取链接: {shareURL} (打开后按页面提示提取)', '感谢购买 {title}'],
  )
  xr(
    `INSERT INTO delivery_rules (keyword, card_id, delivery_count, enabled, require_paid, trigger_type, item_id, cookie_id, ship_mode) VALUES ('e2edel-rule-as', (SELECT id FROM cards WHERE name = 'e2edel-autoship卡券'), 1, 1, 1, 'payment', ?, ?, 'none')`,
    [ITEM, ACC],
  )
}

function paymentEvent() {
  return {
    type: 'chat',
    account: ACC,
    event_id: EVT_ID,
    chat_id: CHAT,
    sender_user_id: BUYER,
    sender_nick: NICK,
    content: '[我已付款，等待你发货]',
    item_id: ITEM,
    create_time: Date.now(),
    session_type: '1',
    is_self: false,
    remark: `orderId=${ORDER_ID}`,
  }
}

/* ------------------------------- 清理 ------------------------------- */
function cleanup() {
  ar(`DELETE FROM apikey_logs WHERE apikey_id IN (SELECT id FROM apikeys WHERE name LIKE 'e2edel-%')`)
  ar(`DELETE FROM apikeys WHERE name LIKE 'e2edel-%'`)
  ar(`DELETE FROM orders WHERE title = ?`, [TITLE])
  ar(`DELETE FROM cards WHERE note LIKE 'API发卡: ${TITLE}%' OR note LIKE ?`, [`API发卡: ${TITLE}%`])
  ar(`DELETE FROM logs WHERE detail LIKE '%e2edel%' OR action IN ('issue','share_download','redeem') AND detail LIKE '%${TITLE}%'`)
  ar(`DELETE FROM scripts WHERE name LIKE 'e2edel-%'`)
  xr(`DELETE FROM engine_event_dedup WHERE event_id = ?`, [EVT_ID])
  xr(`DELETE FROM auto_reply_logs WHERE cookie_id = ? OR chat_id = ?`, [ACC, CHAT])
  xr(`DELETE FROM card_shipments WHERE cookie_id = ?`, [ACC])
  xr(`DELETE FROM card_code_logs WHERE cookie_id = ?`, [ACC])
  xr(`DELETE FROM orders WHERE cookie_id = ?`, [ACC])
  xr(`DELETE FROM delivery_rules WHERE keyword LIKE 'e2edel-%'`)
  xr(`DELETE FROM cards WHERE name LIKE 'e2edel-%'`)
  xr(`DELETE FROM item_info WHERE cookie_id = ? OR item_id = ?`, [ACC, ITEM])
  xr(`DELETE FROM im_conversations WHERE cookie_id = ? OR chat_id = ?`, [ACC, CHAT])
  xr(`DELETE FROM im_messages WHERE cookie_id = ? OR chat_id = ?`, [ACC, CHAT])
  xr(`DELETE FROM cookies WHERE id = ?`, [ACC])
  xr(`DELETE FROM engines WHERE slug = 'e2edel-engine' OR token = ?`, [ENGINE_TOKEN])
}

/* ================================ 主流程 ================================ */
async function main() {
  console.log('═ E2E: xianyu-admin → autoship 资源交付平台 全流程打通')
  await warmup()
  seed()

  try {
    // 1. 付款事件 → xianyu-admin 决策 → 自动发货
    const res = await fetch(`${XY_BASE}/api/engine/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ENGINE_TOKEN}` },
      body: JSON.stringify({ events: [paymentEvent()] }),
    })
    const json = await res.json().catch(() => null)
    const actions = json?.data?.actions || json?.actions || []
    const texts = actions.filter((a) => a.type === 'send_text').map((a) => String(a.text || ''))
    check('付款事件返回发货动作', actions.length >= 1, JSON.stringify(json).slice(0, 200))

    // 2. autoship 侧落库: 卡密 + 订单 (按商品ID匹配发卡)
    const asCard = aq(`SELECT * FROM cards WHERE note LIKE ?`, [`API发卡: ${TITLE}%`])
    check('autoship 生成卡密 (cards 落库)', asCard.length === 1, `rows=${asCard.length}`)
    const asOrder = aq(`SELECT * FROM orders WHERE title = ? AND price = ?`, [TITLE, Number(PRICE)])
    check('autoship 订单落库 (标题/金额一致)', asOrder.length === 1 && asCard.length === 1, `rows=${asOrder.length}`)
    const asScript = aq(`SELECT * FROM scripts WHERE item_id = ? AND name LIKE 'e2edel-%'`, [ITEM])
    check('autoship 按商品ID命中绑定资源', asScript.length === 1 && asCard[0]?.script_id === asScript[0]?.id)

    // 3. 发货文案含 {shareURL} → 加密分享链接
    const shareMsg = texts.find((t) => t.includes('提取链接:'))
    check('发货文案渲染 {shareURL}', !!shareMsg, JSON.stringify(texts).slice(0, 200))
    const shareUrl = shareMsg?.match(/https?:\/\/\S+\/s\/[A-Za-z0-9_-]+/)?.[0] || ''
    check('shareURL 为 autoship 加密分享链接', shareUrl.startsWith(`${AS_BASE}/s/`), shareUrl || '(空)')

    // 4. 买家打开分享链接 → 提取页 (/s/ 302 → /?s= 200)
    const pageRes = await fetch(shareUrl, { redirect: 'follow' })
    const pageHtml = await pageRes.text().catch(() => '')
    check('分享链接打开提取页 (HTTP 200)', pageRes.status === 200, `status=${pageRes.status}`)
    check('提取页含验证码/提取交互元素', pageHtml.includes('提取码') && pageHtml.includes('立即提取'))

    // 5. 提取页核销 → 可复制命令 + 加密下载链接
    const token = shareUrl.split('/s/')[1] || ''
    const redeemRes = await fetch(`${AS_BASE}/api/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ s: token, pwd: '' }),
    })
    const redeem = await redeemRes.json().catch(() => null)
    check('提取页核销成功 (返回命令+下载链接)', redeem?.ok === true && !!redeem?.data?.command && !!redeem?.data?.download_url, JSON.stringify(redeem).slice(0, 200))
    check('命令含加密下载链接 (irm | iex)', String(redeem?.data?.command || '').includes(`${AS_BASE}/s/`))

    // 6. xianyu-admin 侧发货记录落库
    const shipments = xq(`SELECT * FROM card_shipments WHERE cookie_id = ?`, [ACC])
    check('发货记录落库 (card_shipments)', shipments.length === 1 && String(shipments[0].content || '').includes('提取链接'), JSON.stringify(shipments).slice(0, 160))
    const xyOrder = xq(`SELECT * FROM orders WHERE cookie_id = ?`, [ACC])
    check('订单金额回填商品标价', xyOrder.length === 1 && String(xyOrder[0].amount || '') === PRICE, JSON.stringify(xyOrder.map((o) => o.amount)).slice(0, 80))

    // 7. autoship 订单来源/APIKEY 快照
    const ord = asOrder[0] || {}
    check('autoship 订单来源 api + apikey 快照', ord.source === 'api' && !!ord.apikey_name, JSON.stringify({ source: ord.source, name: ord.apikey_name }))
  } finally {
    cleanup()
  }

  console.log(`\n${passCount} 通过 / ${failures.length} 失败`)
  if (failures.length) {
    console.log('失败项:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('E2E 执行异常:', e)
  cleanup()
  process.exit(1)
})
