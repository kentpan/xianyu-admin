/**
 * POST /api/orders/hot-trends/sync — 全平台热门商品趋势同步 (v2.3.0)。
 * Body: { keyword: string, pages?: number, cookie_id?: string }
 *
 * 用账号 Cookie 调闲鱼站内搜索 (mtop.taobao.idle.pc.search, goofish.com 搜索页同源),
 * 按 keyword 抓取**全平台**在售商品 (默认 3 页), 聚合进 trend_hot_items 快照表:
 *   - 新商品: 插入 (first_seen_at = now, seen_count = 1)
 *   - 已有商品: want_count/价格/卖家取最新快照, seen_count + 1 (在售稳定度),
 *     last_seen_at 刷新, keyword 更新为本次搜索词
 * Cookie 轮换逐页回写 (与订单同步同语义)。整体预算 50s, 逐页 500ms 限速。
 *
 * 返回 { synced, new_items, updated_items, pages, errors[] }。
 */
import { fetchIdleSearch } from '../../../utils/xianyu/mtop'
import { persistCookieRotation } from '../../../utils/xianyu/cookie-store'
import { classifyItemType } from '../../../utils/xianyu/item-classify'

interface HotItemRow {
  item_id: string
  title: string
  price: string
  seller_id: string
  seller_nick: string
  area: string
  pic_url: string
  want_count: string
}

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const keyword = String(body?.keyword || '').trim()
    if (!keyword) throw new ApiError(400, '请输入搜索关键词 (如: TG API / 贴纸 / 手办)')
    const MAX_PAGES = Math.min(Math.max(Number(body?.pages) || 3, 1), 5)

    // 指定账号或第一个 Cookie 非空账号 (搜索以账号 Cookie 为凭证, 结果是全平台数据)
    let acct = { id: '', value: '' }
    if (body?.cookie_id) {
      const row = await db.get<{ id: string; value: string }>('SELECT id, value FROM cookies WHERE id = ?', [String(body.cookie_id)])
      if (row) acct = row
    } else {
      const rows = await db
        .all<{ id: string; value: string }>(
          "SELECT id, value FROM cookies WHERE value IS NOT NULL AND value != '' ORDER BY created_at DESC LIMIT 1",
        )
        .catch(() => [])
      if (rows.length) acct = rows[0]
    }
    if (!acct.id || !acct.value) throw new ApiError(400, '无可用账号 Cookie — 请先在「账号管理」添加闲鱼账号')

    const BUDGET_MS = 50_000
    const deadline = Date.now() + BUDGET_MS
    let cookieStr = String(acct.value)
    let synced = 0
    let newItems = 0
    let updatedItems = 0
    let pages = 0
    const errors: string[] = []

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (Date.now() > deadline) {
        errors.push(`时间预算耗尽 (${BUDGET_MS / 1000}s), 第 ${page} 页起未抓取`)
        break
      }
      let pg = await fetchIdleSearch(cookieStr, keyword, page)
      if (pg.finalCookieStr && pg.finalCookieStr !== cookieStr) {
        await persistCookieRotation(db, String(acct.id), String(acct.value), pg.finalCookieStr).catch(() => {})
      }
      cookieStr = pg.finalCookieStr || cookieStr
      // 风控冷却重试 (RGV587 滑块为间歇性): 退避 4s 重试一次, 仍失败才显性报错
      if (pg.retMsg && /风控|RGV587|挤爆/.test(pg.retMsg)) {
        await new Promise((resolve) => setTimeout(resolve, 4000))
        pg = await fetchIdleSearch(cookieStr, keyword, page)
        if (pg.finalCookieStr && pg.finalCookieStr !== cookieStr) {
          await persistCookieRotation(db, String(acct.id), String(acct.value), pg.finalCookieStr).catch(() => {})
        }
        cookieStr = pg.finalCookieStr || cookieStr
      }
      if (pg.retMsg) {
        errors.push(`第 ${page} 页: ${pg.retMsg.slice(0, 150)}`)
        break
      }
      pages++
      for (const it of pg.items as HotItemRow[]) {
        if (!it.item_id) continue
        const want = parseInt(String(it.want_count || '0').replace(/[^\d]/g, ''), 10) || 0
        const itemType = classifyItemType(it.title)
        const r = await db
          .run(
            `INSERT INTO trend_hot_items (item_id, title, price, seller_id, seller_nick, area, pic_url, want_count, keyword, item_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(item_id) DO UPDATE SET
               title = CASE WHEN excluded.title != '' THEN excluded.title ELSE trend_hot_items.title END,
               price = CASE WHEN excluded.price != '' THEN excluded.price ELSE trend_hot_items.price END,
               seller_id = CASE WHEN excluded.seller_id != '' THEN excluded.seller_id ELSE trend_hot_items.seller_id END,
               seller_nick = CASE WHEN excluded.seller_nick != '' THEN excluded.seller_nick ELSE trend_hot_items.seller_nick END,
               area = CASE WHEN excluded.area != '' THEN excluded.area ELSE trend_hot_items.area END,
               pic_url = CASE WHEN excluded.pic_url != '' THEN excluded.pic_url ELSE trend_hot_items.pic_url END,
               want_count = CASE WHEN excluded.want_count > 0 THEN excluded.want_count ELSE trend_hot_items.want_count END,
               keyword = excluded.keyword,
               item_type = excluded.item_type,
               seen_count = seen_count + 1,
               last_seen_at = CURRENT_TIMESTAMP`,
            [it.item_id, it.title || '', it.price || '', it.seller_id || '', it.seller_nick || '', it.area || '', it.pic_url || '', want, keyword, itemType],
          )
          .catch((e: any) => {
            errors.push(`商品 ${String(it.item_id).slice(0, 20)} 落库失败: ${String(e?.message || e).slice(0, 100)}`)
            return null
          })
        if (!r) continue
        synced++
        // lastInsertRowid 在 upsert 命中冲突时不可靠, 用 changes 判断插入/更新
        const changes = Number((r as any)?.changes ?? 0)
        if (changes === 1) newItems++
        else updatedItems++
      }
      if (!pg.nextPage || !pg.items.length) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    return ok(
      { synced, new_items: newItems, updated_items: updatedItems, pages, errors },
      synced ? `全平台搜索完成: 抓取 ${synced} 件在售商品 (新增 ${newItems} / 更新 ${updatedItems})` : '搜索完成, 本次未抓到商品',
    )
  }),
)
