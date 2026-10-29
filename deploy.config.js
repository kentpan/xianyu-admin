// 调用方仓库根目录 deploy.config.js 契约(可重用工作流由此读取全部部署配置)
export default {
  scriptsRepository: 'kentpan/actions-scripts-base', // 脚本宿主仓库; 同仓方式=运行时临时拉取源, 跨仓方式=base 工作流脚本来源
  scriptsRef: '', // 脚本分支/tag; 留空 = 默认分支
  target: 'CLOUDFLARE', // 发布目标(默认 CLOUDFLARE)
  
  projectName: 'xianyu-admin', // Cloudflare 项目名(必填)
  deployType: 'pages', // pages | workers | both(默认 pages)
  accountId: '', // 可选; 留空自动探测
  d1Name: 'xianyu-admin', // D1 库名; 留空 = 不使用 D1 数据库
  d1Id: '', // 可选; 已知 ID 直接复用(跳过创建)
  kvName: '', // KV 命名空间名; 留空 = 不使用 KV 数据库
  kvId: '', // 可选; 已知 ID 直接复用
  ai: {
    enabled: false, // true 时要求调用方配置 AI_API_KEY secret
    vars: { AI_MODEL: 'glm-4.6' }, // 注入运行时的 AI 普通变量
  },
  // ── 自定义环境变量注入(可选) ─────────────────────────────
  // 同仓/跨仓调用都会自动注入到 Cloudflare: Workers = [vars] + secret put; Pages = env_vars(production+preview)
  vars: {
    // 安装完成标志(与本地 .env 语义一致) —— 运行时 isInstalled() 只认环境变量
    // (XY_INSTALLED/ADMIN_SECRET/JWT_SECRET), 不查数据库; 缺它部署后必跳 /install。
    // 兼容日期 >=2025-04-01 时 workerd 自动把 Pages env vars 桥接进 process.env,
    // server/utils/config.ts 的 loadState() 即可读到。
    XY_INSTALLED: 'true',
    // APP_NAME: 'xianyu-admin', // 普通变量(明文, 控制台可见); 数字/布尔自动转字符串, 对象/数组自动 JSON.stringify
  },
  secrets: {
    // 敏感变量(以加密 Secret 注入, 写入后控制台不可再读)
    // ⚠ 本文件会提交进 Git 仓库, secret 值是明文存放的; 高敏感值请继续用 GitHub Secrets(JWT_SECRET / ADMIN_SECRET / AI_API_KEY)
    // (已配置 ADMIN Secret/Variable 的仓库无需再配 ADMIN_SECRET, 工作流会自动把 ADMIN 赋值给 ADMIN_SECRET)
    // THIRD_PARTY_API_KEY: 'sk-xxxx',
  },
  // 键名规则: 仅字母/数字/下划线且不以数字开头; 不得使用系统保留名
  // (DB / KV / ASSETS / AI / NODE_ENV / PROXY_MODE / ADMIN_SECRET / JWT_SECRET / AI_API_KEY / REMOTE_WS_URL / CLOUDFLARE_D1_DATABASE_ID / REALTIME_DO / REALTIME_HUB)

  // ── 边缘实时通道(Cloudflare Durable Objects; 可选) ─────────────────────
  // Pages 项目不能在自身内承载 DO 类(平台限制), 由仓库 edge-realtime/ 配套 Worker
  // 独立承载 DO hub: CI 部署该 Worker 并把 REALTIME_DO 绑定(script_name)随站点
  // wrangler.toml 注入 —— 站点服务端 /api/realtime/ws 鉴权后把 WS 升级直呼转发进 DO,
  // publishToHub 广播同走绑定, 浏览器始终只连站点域名(同源, 前端零改动)。
  // Nuxt + workers 部署类型则不自配 Worker: 构建切换 cloudflare-durable 预设自承载
  // $DurableObject(见 wrangler.edge.toml), CI 自动按本开关选择预设与绑定。
  realtime: {
    enabled: true, // true = CI 部署/绑定 DO hub 实时通道; false/缺失 = 不部署(实时走 SSE)
    workerName: '', // 配套 Worker 名; 留空 = projectName + '-realtime'
    className: 'EdgeRealtimeDO', // DO 类名(须与 edge-realtime/index.js 导出一致)
  },
};
