/**
 * listener — 内置监听引擎 Nitro 启动钩子。
 *
 * 仅 Node 运行时启动 (Cloudflare Workers 无 WebSocket 客户端/无长驻进程, 引擎自动跳过):
 *   - 惰性补齐引擎 Bearer 令牌
 *   - 启动 5s 门控巡检调度器 (engines.is_active === builtin 才真正服务, 切远程代理自动待命)
 */
export default defineNitroPlugin((nitro) => {
  // 运行时判别唯一真源 = detectRuntime() (server/utils/config.ts)。
  // 不能用 process.env.NITRO_PRESET 判断: 它是构建期变量, 部署后的
  // Worker bundle 内不存在, 守卫失效会让下方 setTimeout 在 Worker
  // 全局作用域求值, Pages 发布验证直接报
  // "Disallowed operation called within global scope" 部署失败。
  if (detectRuntime() === 'cloudflare') {
    console.log('[xianyu-engine] Cloudflare 运行时不支持长驻监听, 内置引擎跳过 (请部署远程代理)')
    return
  }

  nitro.hooks.hook('close', () => {
    stopBuiltinEngineSupervisor()
  })

  // 延迟启动: 等数据库初始化插件完成, 不阻塞主服务启动
  setTimeout(() => {
    Promise.resolve()
      .then(async () => {
        await ensureEngineTokens()
        startBuiltinEngineSupervisor()
      })
      .catch((e: any) => {
        console.log(`[xianyu-engine] 启动失败 (5s 后随巡检重试): ${e?.message}`)
      })
  }, 3000)
})
