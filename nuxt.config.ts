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
    // XY_-prefixed to avoid collision with host Next.js project env vars.
    adminSecret: process.env.XY_ADMIN_SECRET || '',
    jwtSecret: process.env.XY_JWT_SECRET || '',
    dbDriver: process.env.XY_DB_DRIVER || 'sqlite',
    dbUrl: process.env.XY_DATABASE_URL || 'data/xianyu_admin.db',
    dbHost: process.env.XY_DB_HOST || '',
    dbPort: process.env.XY_DB_PORT || '',
    dbUser: process.env.XY_DB_USER || '',
    dbPassword: process.env.XY_DB_PASSWORD || '',
    dbName: process.env.XY_DB_NAME || '',
    installed: process.env.XY_INSTALLED === 'true',
    public: {
      appName: process.env.XY_APP_NAME || '闲鱼超级管家',
      appVersion: '1.0.0',
      brandColor: 'amber',
      basePath: '/xianyu',
    },
  },

  app: {
    // Served behind the main Next.js project's /admin/* rewrite proxy, so all
    // routes & assets live under /admin/ — guarantees assets resolve on the
    // same origin without XTransformPort query tricks.
    baseURL: '/xianyu/',
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
        { rel: 'icon', type: 'image/svg+xml', href: '/xianyu/favicon.svg' },
        { rel: 'manifest', href: '/xianyu/manifest.json' },
        { rel: 'apple-touch-icon', href: '/xianyu/favicon.svg' },
      ],
    },
  },

  nitro: {
    port: 3001,
    host: '0.0.0.0',
    // Auto-detect Cloudflare Pages preset when deploying to Cloudflare
    // (set NITRO_PRESET=cloudflare-pages or CF_PAGES=1 to override)
    preset: process.env.CF_PAGES ? 'cloudflare-pages' : 'node-server',
  },

  typescript: {
    strict: true,
  },

  experimental: {
    // Avoid Nitro trying to bundle native better-sqlite3 incorrectly
    asyncContext: true,
  },
})
