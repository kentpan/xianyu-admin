/**
 * 北京时间显示工具 (v2.3.0) — 全站时间统一按 Asia/Shanghai (UTC+8) 展示。
 *
 * 背景: 服务端/DB 统一以 UTC 存储 (SQLite CURRENT_TIMESTAMP / toISOString 均为 UTC),
 * 此前各页用 new Date('YYYY-MM-DD HH:mm:ss') 解析 — naive 字符串被当作浏览器本地时间,
 * 中国用户浏览器 (+8) 下等价于直接展示 UTC 墙钟 → 全站时间少了 8 小时。
 *
 * 规则:
 *   - naive 字符串 ('2026-11-05 13:31:07' / '2026-11-05T13:31:07') → 按 UTC 解析
 *   - 带时区 ISO ('...Z' / '+08:00') → 按原义解析
 *   - 纯日期 'YYYY-MM-DD' → 日期本身无时区语义, 原样展示
 *   - 数字 (epoch ms) / Date → 按绝对时刻展示
 * 输出一律用 Intl timeZone 'Asia/Shanghai' 格式化, 与浏览器所在时区无关。
 */

const BJ_TZ = 'Asia/Shanghai'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 把 DB/平台时间输入解析为绝对时刻 (Date); 纯日期/无法解析返回 null */
export function parseDbTime(t: string | number | Date | null | undefined): Date | null {
  if (t === null || t === undefined || t === '') return null
  if (t instanceof Date) return isNaN(t.getTime()) ? null : t
  if (typeof t === 'number') return new Date(t)
  const s = String(t).trim()
  if (!s) return null
  // 纯日期 YYYY-MM-DD: 无时区语义, 按当日 00:00 北京时间的绝对时刻处理 (仅用于展示日期, 无偏移影响)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  // naive: 'YYYY-MM-DD HH:mm:ss(.fff)' 或 'YYYY-MM-DDTHH:mm:ss(.fff)' 无时区尾缀 → 按 UTC
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/)
  if (m) {
    return new Date(
      Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), m[7] ? Number(String(m[7]).slice(0, 3)) : 0),
    )
  }
  const d = new Date(s) // ISO 带 Z/偏移 → 原义解析
  return isNaN(d.getTime()) ? null : d
}

/** 北京时间部件: 用 Intl 按上海时区取年月日时分秒 (不依赖设备时区) */
function bjParts(d: Date): { y: number; mo: number; da: number; h: number; mi: number; s: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: BJ_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value
  const h = Number(p.hour) % 24
  return { y: Number(p.year), mo: Number(p.month), da: Number(p.day), h, mi: Number(p.minute), s: Number(p.second) }
}

/** 北京时间完整格式 'YYYY-MM-DD HH:mm:ss'; 无法解析原样返回 */
export function bjTime(t: string | number | Date | null | undefined): string {
  const d = parseDbTime(t)
  if (!d) return t == null || t === '' ? '' : String(t)
  const p = bjParts(d)
  return `${p.y}-${pad2(p.mo)}-${pad2(p.da)} ${pad2(p.h)}:${pad2(p.mi)}:${pad2(p.s)}`
}

/** 北京时间短格式 'MM-DD HH:mm'; 无法解析原样返回 */
export function bjShort(t: string | number | Date | null | undefined): string {
  const d = parseDbTime(t)
  if (!d) return t == null || t === '' ? '' : String(t)
  const p = bjParts(d)
  return `${pad2(p.mo)}-${pad2(p.da)} ${pad2(p.h)}:${pad2(p.mi)}`
}

/** 北京时间日期 'YYYY-MM-DD' */
export function bjDay(t: string | number | Date | null | undefined): string {
  const d = parseDbTime(t)
  if (!d) return t == null || t === '' ? '' : String(t)
  const p = bjParts(d)
  return `${p.y}-${pad2(p.mo)}-${pad2(p.da)}`
}

/**
 * 消息会话用短格式: 同一天 (按北京日历) 只显示 HH:mm, 跨天显示 'MM-DD HH:mm'。
 * (messages.vue shortTime 的北京时间版)
 */
export function bjChatTime(t: string | number | Date | null | undefined): string {
  const d = parseDbTime(t)
  if (!d) return t == null || t === '' ? '' : String(t)
  const now = new Date()
  const today = bjParts(now)
  const p = bjParts(d)
  const sameDay = today.y === p.y && today.mo === p.mo && today.da === p.da
  return sameDay ? `${pad2(p.h)}:${pad2(p.mi)}` : `${pad2(p.mo)}-${pad2(p.da)} ${pad2(p.h)}:${pad2(p.mi)}`
}

/** 北京时间相对描述 (x 分钟前 / x 小时前 / 昨天 HH:mm / MM-DD HH:mm) */
export function bjAgo(t: string | number | Date | null | undefined): string {
  const d = parseDbTime(t)
  if (!d) return t == null || t === '' ? '' : String(t)
  const diff = Date.now() - d.getTime()
  if (diff >= 0 && diff < 60_000) return '刚刚'
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff >= 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return bjShort(t)
}

/** 当前时刻的北京日期 'YYYY-MM-DD' (服务端按天分组/标签用) */
export function bjToday(): string {
  return bjDay(new Date())
}

/**
 * ─── 全站标准格式化入口 (v2.3.1) ───
 * 各页面禁止再写本地时间转换/包装: 统一调用下面 4 个全局函数
 * (Nuxt auto-import, 模板与 <script setup> 内均可直接使用)。
 * 以后要切换时区 (如伦敦) 只需修改本文件 BJ_TZ 一处。
 */

/** 默认短格式 'MM-DD HH:mm' (北京时间); 空值/不可解析 → fallback */
export function formatTime(t: string | number | Date | null | undefined, fb = '—'): string {
  if (t === null || t === undefined || t === '') return fb
  return bjShort(t) || fb
}

/** 完整格式 'YYYY-MM-DD HH:mm:ss' (北京时间, 日志/流水/审计类页面用); 空值/不可解析 → fallback */
export function formatTimeFull(t: string | number | Date | null | undefined, fb = '—'): string {
  if (t === null || t === undefined || t === '') return fb
  return bjTime(t) || fb
}

/** 日期格式 'YYYY-MM-DD' (北京时间); 空值/不可解析 → fallback */
export function formatDay(t: string | number | Date | null | undefined, fb = '—'): string {
  if (t === null || t === undefined || t === '') return fb
  return bjDay(t) || fb
}

/** 相对描述 (刚刚 / x 分钟前 / x 小时前, 超过 1 天回落短格式); 空值/不可解析 → fallback */
export function formatAgo(t: string | number | Date | null | undefined, fb = '-'): string {
  if (t === null || t === undefined || t === '') return fb
  return bjAgo(t) || fb
}
