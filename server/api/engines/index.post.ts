/**
 * POST /api/engines — 新增远程监听代理。
 * Body: { name, host?, port?, remark? }
 *
 * 远程代理 = 纯消息监听转发的独立 TS 进程 (scripts/xianyu-proxy.mjs, 零 npm 依赖),
 * 部署在任意机器: 主动拉取账号配置 → 连闲鱼长连接 → 事件经 Bearer 上报回本后台。
 * host/port 为可选登记信息 (健康检查/展示用); 数据面为代理主动外呼, 无需公网入站端口。
 * 创建时自动生成独立接入令牌 (Authorization: Bearer)。
 */
import crypto from 'node:crypto'

export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const body = await readBody(event) || {}
    const name = String(body.name || '').trim()
    const host = String(body.host || '').trim()
    const port = Math.round(Number(body.port) || 0)
    const remark = String(body.remark || '').trim()
    if (!name) throw new ApiError(400, '请填写代理名称')

    const db = await getDb()
    const slug = 'engine-' + crypto.randomUUID().replaceAll('-', '').slice(0, 8)
    const dup = await db.get('SELECT id FROM engines WHERE name = ?', [name])
    if (dup) throw new ApiError(409, '已存在同名引擎')

    await db.run(
      `INSERT INTO engines (slug, name, type, host, port, token, remark, enabled, is_active)
       VALUES (?, ?, 'remote', ?, ?, ?, ?, 1, 0)`,
      [slug, name, host, port, generateEngineToken(), remark],
    )
    const row = await db.get<any>('SELECT * FROM engines WHERE slug = ?', [slug])
    return ok(row, '远程代理已添加 (默认停用, 部署代理进程后可设为使用中)')
  }),
)
