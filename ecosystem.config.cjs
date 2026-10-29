// ============================================================================
// ecosystem.config.cjs — pm2 持久化运行脚本(项目根目录使用, 端口 3730)
// ----------------------------------------------------------------------------
// 使用前提: 先执行 `npm run build`(产物 .output/server/index.mjs)
//   启动:     pm2 start ecosystem.config.cjs
//   开机自启:  pm2 save && pm2 startup   (一次性, 按提示执行输出的命令)
//   日常运维:  pm2 logs xianyu-admin | pm2 restart xianyu-admin | pm2 stop xianyu-admin | pm2 delete xianyu-admin
//
// 说明:
//   - script=npm + args=start → 执行 package.json 的 start
//     (node --env-file-if-exists=.env .output/server/index.mjs)
//   - 端口: 由项目根 .env 的 PORT=3730 决定(--env-file 加载), pm2 层绝不注入
//     PORT —— 否则 pm2 注入会覆盖 .env 导致用户配置永远不生效(实测事故)。
//   - ADMIN_SECRET / JWT_SECRET / DATABASE_URL 同样由 .env 提供。
//   - instances=1 强制单实例(SQLite 单写者, 绝不能 cluster 多实例同写一个库)。
// ============================================================================
module.exports = {
  apps: [{
    name: 'xianyu-admin',
    cwd: __dirname,
    script: 'npm',
    args: 'start',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
    env: { NODE_ENV: 'production' },
  }],
}
