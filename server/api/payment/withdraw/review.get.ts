/**
 * GET /api/payment/withdraw/review — 提现审核 HTML 表单页 (无登录, token-gated)
 *
 * Query: ?id=<record_id>&action=<approve|reject>&token=<hmac>
 *
 * 校验 HMAC token → 返回 HTML 确认表单 (POST 到 /api/payment/withdraw/approve 或 /reject)
 * 用户输入的 id 会做整数校验, token 限制为 hex 字符
 */

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const id = Number(q.id || 0)
  const action = (q.action || '').toString() === 'reject' ? 'reject' : 'approve'
  const token = (q.token || '').toString().replace(/[^a-f0-9]/gi, '')

  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')

  if (!id || !token || !verifyReviewToken(id, action, token)) {
    return renderErrorHtml('审核链接无效或已过期')
  }

  const db = await getDb()
  const record = await db.get<{
    id: number; user_id: number; amount: string; payment_type: string | null
    payment_qrcode: string | null; status: string; created_at: string
    username: string
  }>(
    `SELECT s.id, s.user_id, s.amount, s.payment_type, s.payment_qrcode, s.status, s.created_at,
            u.username
     FROM settlement_records s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    [id],
  )

  if (!record) return renderErrorHtml('提现记录不存在')
  if (record.status !== 'pending_review') {
    return renderErrorHtml(`该提现记录当前状态为 "${escapeHtml(record.status)}", 无法再次审核`)
  }

  const safeId = record.id
  const safeToken = escapeHtml(token)
  const safeAmount = escapeHtml(record.amount)
  const safeUser = escapeHtml(record.username || `用户#${record.user_id}`)
  const safePaymentType = escapeHtml(record.payment_type || 'alipay')
  const safeQrcode = record.payment_qrcode ? escapeHtml(record.payment_qrcode) : ''
  const safeCreatedAt = escapeHtml(record.created_at)

  if (action === 'approve') {
    return renderApproveHtml({
      id: safeId, token: safeToken, amount: safeAmount, username: safeUser,
      paymentType: safePaymentType, qrcode: safeQrcode, createdAt: safeCreatedAt,
    })
  } else {
    return renderRejectHtml({
      id: safeId, token: safeToken, amount: safeAmount, username: safeUser,
      paymentType: safePaymentType, qrcode: safeQrcode, createdAt: safeCreatedAt,
    })
  }
})

function renderApproveHtml(o: {
  id: number; token: string; amount: string; username: string
  paymentType: string; qrcode: string; createdAt: string
}): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>提现审核 - 确认通过</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; padding: 20px; color: #333; }
    .container { max-width: 500px; margin: 40px auto; background: #fff; border-radius: 8px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h1 { font-size: 20px; margin: 0 0 16px; color: #16a34a; }
    .row { padding: 8px 0; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; }
    .row:last-of-type { border-bottom: none; }
    .label { color: #888; }
    .value { font-weight: 600; }
    .qrcode { max-width: 220px; max-height: 220px; margin: 12px 0; border: 1px solid #eee; }
    button { width: 100%; padding: 12px; background: #16a34a; color: #fff; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; margin-top: 16px; }
    button:hover { background: #15803d; }
    .cancel { display: block; text-align: center; margin-top: 12px; color: #888; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>确认通过提现审核</h1>
    <div class="row"><span class="label">用户</span><span class="value">${o.username}</span></div>
    <div class="row"><span class="label">金额</span><span class="value">¥${o.amount}</span></div>
    <div class="row"><span class="label">收款方式</span><span class="value">${o.paymentType === 'wechat' ? '微信' : '支付宝'}</span></div>
    <div class="row"><span class="label">申请时间</span><span class="value">${o.createdAt}</span></div>
    ${o.qrcode ? `<div style="text-align:center;"><img class="qrcode" src="${o.qrcode}" alt="收款码"></div>` : ''}
    <form method="POST" action="/api/payment/withdraw/approve">
      <input type="hidden" name="id" value="${o.id}">
      <input type="hidden" name="token" value="${o.token}">
      <button type="submit">确认通过审核</button>
    </form>
    <a class="cancel" href="javascript:window.close();">取消</a>
  </div>
</body>
</html>`
}

function renderRejectHtml(o: {
  id: number; token: string; amount: string; username: string
  paymentType: string; qrcode: string; createdAt: string
}): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>提现审核 - 拒绝</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; padding: 20px; color: #333; }
    .container { max-width: 500px; margin: 40px auto; background: #fff; border-radius: 8px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h1 { font-size: 20px; margin: 0 0 16px; color: #dc2626; }
    .row { padding: 8px 0; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; }
    .label { color: #888; }
    .value { font-weight: 600; }
    label { display: block; margin: 16px 0 6px; color: #555; }
    textarea { width: 100%; min-height: 80px; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; resize: vertical; box-sizing: border-box; }
    button { width: 100%; padding: 12px; background: #dc2626; color: #fff; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; margin-top: 16px; }
    button:hover { background: #b91c1c; }
    .cancel { display: block; text-align: center; margin-top: 12px; color: #888; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>拒绝提现申请</h1>
    <div class="row"><span class="label">用户</span><span class="value">${o.username}</span></div>
    <div class="row"><span class="label">金额</span><span class="value">¥${o.amount}</span></div>
    <div class="row"><span class="label">收款方式</span><span class="value">${o.paymentType === 'wechat' ? '微信' : '支付宝'}</span></div>
    <div class="row"><span class="label">申请时间</span><span class="value">${o.createdAt}</span></div>
    <form method="POST" action="/api/payment/withdraw/reject">
      <input type="hidden" name="id" value="${o.id}">
      <input type="hidden" name="token" value="${o.token}">
      <label for="reject_reason">拒绝原因 (将退款给用户)</label>
      <textarea id="reject_reason" name="reject_reason" placeholder="请输入拒绝原因..." required></textarea>
      <button type="submit">确认拒绝并退款</button>
    </form>
    <a class="cancel" href="javascript:window.close();">取消</a>
  </div>
</body>
</html>`
}

function renderErrorHtml(msg: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>审核链接无效</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; padding: 20px; color: #333; }
    .container { max-width: 400px; margin: 80px auto; background: #fff; border-radius: 8px; padding: 32px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h1 { color: #dc2626; font-size: 18px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(msg)}</h1>
  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
