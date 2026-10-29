/**
 * GET /api/listener/verify-stream — 风控人工验证警报 SSE 推送 (事件驱动, 前端零轮询)。
 *
 * 引擎侧 token 连败 ≥2 且持有挑战链接时, verify-state 发射警报事件, 本端点实时转发给
 * 所有已登录后台标签页 → VerifySliderModal 收到即弹全局弹窗 (butler 远程控制人工滑块)。
 *
 * 连接保持: 仅发送警报事件与结构化 JSON 心跳, 不触碰任何闲鱼接口。
 */
import { createEventStream } from 'h3'
import { onVerifyAlert } from '../../utils/xianyu/verify-state'
import { getDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireUser(event)

  const stream = createEventStream(event)

  const off = onVerifyAlert(async (s) => {
    let label = s.cookieId
    try {
      const db = await getDb()
      const row = await db.get<any>('SELECT remark, username FROM cookies WHERE id = ?', [s.cookieId])
      if (row) label = row.remark || row.username || s.cookieId
    } catch {}
    // push 传净荷字符串, SSE 帧格式 (data: 前缀/结尾空行) 由 h3 统一拼装 —
    // 手工拼帧会被 h3 二次加前缀变成 "data: data: {...}" 导致前端解析失败
    await stream.push(JSON.stringify({ cookie_id: s.cookieId, label, streak: s.streak, punish_url: s.punishUrl })).catch(() => {})
  })

  // SSE 心跳 (防止中间层断开空闲连接) — 结构化 JSON, 前端解析后按无 cookie_id 忽略; 纯通道保活, 零业务请求
  const hb = setInterval(() => {
    void stream.push(JSON.stringify({ hb: Date.now() })).catch(() => {})
  }, 25_000)

  stream.onClosed(async () => {
    clearInterval(hb)
    off()
  })

  // h3 1.15 不会自动识别 handler 返回的 EventStream (isStream 只认 pipe/pipeTo),
  // 必须显式 send(): 设置 text/event-stream 头并挂起管道直至连接关闭
  await stream.send()
})
