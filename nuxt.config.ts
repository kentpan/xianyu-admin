// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  ssr: true,

  modules: ['@nuxtjs/tailwindcss'],

  css: ['~/assets/css/main.css'],

  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },

  runtimeConfig: {
    // XY_-prefixed to avoid collision with host env vars.
    adminSecret: process.env.XY_ADMIN_SECRET || '',
    jwtSecret: process.env.XY_JWT_SECRET || '',
    dbDriver: process.env.XY_DB_DRIVER || 'sqlite',
    // NOTE: the single source of truth for the DB path is server/utils/db-config.ts
    // (DATABASE_URL ← .env XY_DATABASE_URL). This runtimeConfig entry is only a
    // pass-through mirror for boot-time diagnostics and must not be read by the data layer.
    dbUrl: process.env.XY_DATABASE_URL || 'file:./prisma/xianyu_admin.db',
    dbHost: process.env.XY_DB_HOST || '',
    dbPort: process.env.XY_DB_PORT || '',
    dbUser: process.env.XY_DB_USER || '',
    dbPassword: process.env.XY_DB_PASSWORD || '',
    dbName: process.env.XY_DB_NAME || '',
    installed: process.env.XY_INSTALLED === 'true',
    public: {
      appName: process.env.XY_APP_NAME || '闲鱼超级管家',
      appVersion: '2.0.3',
      brandColor: 'amber',
      basePath: '',
    },
  },

  app: {
    // xianyu-admin is the main server on :3000 (no Next.js proxy in front),
    // so it serves at the site root '/'.
    baseURL: '/',
    buildAssetsDir: 'assets/',
    cdnURL: '',
    head: {
      title: '闲鱼超级管家',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: '闲鱼超级管家 - 现代化的闲鱼自动回复与管理平台' },
        { name: 'theme-color', content: '#f59e0b' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'apple-mobile-web-app-title', content: '闲鱼管家' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'manifest', href: '/manifest.json' },
        { rel: 'apple-touch-icon', href: '/favicon.svg' },
      ],
    },
  },

  nitro: {
    // Honor PORT from .env (default 3000)
    port: Number(process.env.PORT) || 3000,
    host: '0.0.0.0',
    // Preset 解析优先级(与 CI 部署链对齐):
    //   1. NITRO_PRESET 环境变量(actions-scripts-base CI 显式指定)
    //   2. CF_PAGES=1 自动检测 Cloudflare Pages
    //   3. 默认 node-server
    // 注意: nuxt.config 的 preset 属于 nitro 的 configOverrides, 优先级高于
    // NITRO_PRESET 环境变量, 因此这里必须显式透传 env, 否则 CI 构建产物错误。
    preset: process.env.NITRO_PRESET || (process.env.CF_PAGES ? 'cloudflare-pages' : 'node-server'),
  },

  devServer: {
    host: '0.0.0.0',
    allowedHosts: true,
  },

  vite: {
    server: {
      // Allow any Host header in dev (behind proxies / preview panels)
      allowedHosts: true,
      host: true,
    },
  },

  typescript: {
    strict: true,
  },

  experimental: {
    asyncContext: true,
  },
})
