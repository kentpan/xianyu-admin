/**
 * useClipboard — 剪贴板写入统一实现 (全站唯一复制通道)。
 *
 * 根因背景 (线上实锤): admin/api-keys 等页面直接 navigator.clipboard.writeText,
 * 旧内核浏览器 (国产双核浏览器 IE 兼容模式 / 旧版 Chromium) 与受限上下文下
 * navigator.clipboard 为 undefined (或 writeText 被 Permissions-Policy 拒绝),
 * 直接抛 TypeError → 所有复制点统一报「复制失败」。
 *
 * 写入顺序 (MDN 标准两段式, 非业务兜底而是跨浏览器 API 兼容层):
 *   1. Clipboard API (异步, 安全上下文首选);
 *   2. API 缺失或写入被拒 → document.execCommand('copy') 传统同步方案
 *      (隐藏 textarea + select + execCommand, 覆盖旧内核/受限上下文);
 *   3. 两条路径都失败才抛出真实错误 (由调用方大声呈现, 绝不静默)。
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (import.meta.server) throw new Error('剪贴板写入仅在客户端可用')
  if (!text && text !== '') throw new Error('复制内容为空')

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Clipboard API 被拒 (权限/失焦) → 落入 execCommand 标准回退, 最终失败会抛
    }
  }

  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '-9999px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
  if (!copied) {
    throw new Error(navigator.clipboard ? '剪贴板写入被浏览器拒绝' : '浏览器不支持剪贴板 API 且无回退能力')
  }
}
