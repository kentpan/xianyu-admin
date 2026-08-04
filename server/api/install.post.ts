/**
 * POST /api/install — runs the first-time install wizard.
 *
 * On Node.js: writes ADMIN_SECRET / JWT_SECRET / DB config to .env, creates the admin user.
 * On Cloudflare Pages: uses the Cloudflare API (with user-provided API token) to set
 *   environment variables on the Pages project, since .env is read-only.
 *
 * Idempotency: if already installed, refuses.
 */
export default defineEventHandler(
  withApi(async (event) => {
    if (isInstalled()) {
      throw new ApiError(400, '系统已安装，如需重新安装请清空 ADMIN_SECRET 环境变量')
    }

    const body = await readBody(event)
    const {
      adminSecret,
      jwtSecret,
      dbDriver,
      dbUrl,
      dbHost,
      dbPort,
      dbUser,
      dbPassword,
      dbName,
      adminUsername,
      adminPassword,
      adminEmail,
      // Cloudflare-specific
      cfAccountId,
      cfApiToken,
      cfProjectName,
    } = body || {}

    // Validate required fields
    if (!adminSecret || adminSecret.length < 6) throw new ApiError(400, 'ADMIN_SECRET 至少 6 位')
    if (!jwtSecret || jwtSecret.length < 16) throw new ApiError(400, 'JWT_SECRET 至少 16 位')
    if (!adminUsername || !adminPassword || !adminEmail) throw new ApiError(400, '请填写完整的管理员信息')
    if (!['sqlite', 'mysql', 'd1', 'memory'].includes(dbDriver)) {
      throw new ApiError(400, '不支持的数据库类型')
    }
    if (dbDriver === 'mysql' && (!dbHost || !dbUser || !dbName)) {
      throw new ApiError(400, 'MySQL 需要填写主机/用户名/数据库名')
    }

    const runtime = detectRuntime()

    // Build the env vars to set
    const envVars: Record<string, string> = {
      XY_ADMIN_SECRET: adminSecret,
      XY_JWT_SECRET: jwtSecret,
      XY_DB_DRIVER: dbDriver,
      XY_INSTALLED: 'true',
    }
    if (dbUrl !== undefined && dbUrl !== '') envVars.XY_DATABASE_URL = dbUrl
    if (dbHost) envVars.XY_DB_HOST = dbHost
    if (dbPort) envVars.XY_DB_PORT = dbPort
    if (dbUser) envVars.XY_DB_USER = dbUser
    if (dbPassword) envVars.XY_DB_PASSWORD = dbPassword
    if (dbName) envVars.XY_DB_NAME = dbName

    if (runtime === 'cloudflare' && cfAccountId && cfApiToken && cfProjectName) {
      // Cloudflare Pages: set env vars via API
      const results = await applyCloudflareEnvVars({
        accountId: cfAccountId,
        apiToken: cfApiToken,
        projectName: cfProjectName,
        vars: envVars,
      })
      const failed = results.filter((r) => !r.success)
      if (failed.length) {
        throw new ApiError(500, `Cloudflare API 设置环境变量失败: ${failed[0].error}`)
      }
      // Update runtime state for current process
      const s = getRuntimeState()
      s.adminSecret = adminSecret
      s.jwtSecret = jwtSecret
      s.dbDriver = dbDriver
      s.installed = true
    } else {
      // Node.js: write to .env
      applyInstallConfig({
        adminSecret, jwtSecret, dbDriver, dbUrl, dbHost, dbPort, dbUser, dbPassword, dbName,
        adminUsername, adminPassword, adminEmail,
      })
    }

    // Reset the cached adapter so it reconnects with the new driver/config
    await resetDb()
    const db = await getDb(event)
    await initSchema(db)

    // Create the admin user (idempotent)
    const existing = await db.get('SELECT id FROM users WHERE username = ?', [adminUsername])
    if (!existing) {
      await db.run(
        'INSERT INTO users (username, email, password_hash, is_active, is_admin) VALUES (?, ?, ?, 1, 1)',
        [adminUsername, adminEmail, hashPassword(adminPassword)],
      )
    } else {
      await db.run(
        'UPDATE users SET password_hash = ?, email = ?, is_admin = 1, is_active = 1 WHERE username = ?',
        [hashPassword(adminPassword), adminEmail, adminUsername],
      )
    }

    return ok({
      installed: true,
      driver: dbDriver,
      runtime,
      message: runtime === 'cloudflare'
        ? '安装完成！环境变量已通过 Cloudflare API 设置，请重新部署 Pages 项目后生效。'
        : '安装完成，即将跳转登录',
    }, '安装完成')
  }),
)
