/** POST /api/xianyu/qr-login/start — kick off a new QR login session.
 *
 * Returns `{ sessionKey, qrUrl }`. The frontend renders `qrUrl` as a QR code
 * (e.g. via `qrcode` npm) and then polls `/api/xianyu/qr-login/status`.
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const r = await startQrLogin(payload.userId)
    return ok(r, '二维码已生成')
  }),
)
