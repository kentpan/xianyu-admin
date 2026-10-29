# 🐟 闲鱼超级管家 (Xianyu Admin)

> 现代化的闲鱼自动回复与管理平台，基于 Nuxt 4.4.8 + Tailwind CSS 3.4.19 构建

[![License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Nuxt](https://img.shields.io/badge/Nuxt-4.4.8-00DC82.svg)](https://nuxt.com)
[![Tailwind](https://img.shields.io/badge/Tailwind-3.4.19-38BDF8.svg)](https://tailwindcss.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6.svg)](https://www.typescriptlang.org)

基于 Nuxt 4 + Tailwind 3 技术栈独立构建的闲鱼账号管理与自动回复平台。

**v2.0.3 新增**: 擦亮宝贝(真实生效) · 发布模板(规避风控) · 联盟选品→卡券→闲鱼自动回复闭环 · 15 国内外主流佣金联盟

---

## 🔁 闭环流程: 联盟选品 → 闲鱼自动回复 → 赚取佣金

闲鱼超级管家提供完整的返佣闭环, 将联盟选品与闲鱼自动回复打通:

```
联盟选品 (货源广场)
    ↓ 一键转卡券
卡券管理 (含联盟推广链接)
    ↓ 绑定闲鱼商品 ID
闲鱼商品 (扫码登录后同步)
    ↓ 关键词自动回复
买家咨询 → 自动回复发送联盟链接 → 买家购买 → 赚取佣金
```

### 使用步骤
1. **配置联盟账号**: 货源广场 → 联盟账号 → 新增 (选 15 个联盟之一, 填凭据)
2. **选品搜索**: 货源广场 → 选品搜索 → 关键词搜索 → 收藏商品
3. **转卡券**: 我的选品 → 选品商品 → 点「转卡券」→ 填闲鱼商品 ID + 关键词
4. **自动回复**: 买家在闲鱼咨询该关键词 → 自动回复发送联盟链接
5. **赚佣金**: 买家点击链接购买 → 你获得联盟佣金

---

## ⚠️ 免责声明

> 本项目**仅用于学习和研究**，如商业使用出现任何问题，后果自负，概不负责。
>
> 使用本项目时请遵守相关法律法规，因使用本项目而产生的一切后果由使用者自行承担。

---

## ✨ 核心特性

- 🤖 **智能回复** — 关键词匹配回复、AI 智能议价、默认回复、商品专属回复
- 🚚 **自动发货** — 多规格商品、延时发货、卡券管理、发货规则配置
- 📦 **订单管理** — 订单列表、批量同步、收货人信息、手动发货、导入导出
- 📱 **账号管理** — 多账号支持、Cookie 录入、启停、自动确认、健康度检测
- 📊 **数据看板** — 7天趋势图、订单状态环形图、实时活动流、数据对比、系统健康
- 🔔 **通知中心** — QQ/钉钉/飞书/Bark/邮件/Webhook/微信/Telegram 多渠道
- 🛡️ **管理后台** — 用户管理、操作审计日志、风控日志、数据备份恢复、ER 图
- 🎨 **多主题** — 5 种主题色实时切换、深浅色模式、响应式设计
- ⌨️ **快捷操作** — Cmd+K 命令面板、键盘快捷键、批量操作倒计时确认
- 📱 **PWA** — 离线缓存、可安装到桌面
- 🗄️ **多数据库** — SQLite / MySQL / Cloudflare D1 / 内存模式无缝切换
- ☁️ **双环境** — Node.js 自托管 + Cloudflare Pages Serverless

---

## 🚀 快速开始

### 环境要求

- Node.js 18+ / Bun 1.0+
- npm / pnpm / bun（任选其一）

### 安装依赖

```bash
cd xianyu-admin
bun install  # 或 npm install / pnpm install
```

### 本地开发

```bash
bun run dev
# 访问 http://localhost:3001/
```

首次访问会自动跳转到安装向导，按步骤完成配置即可。

### 生产构建

```bash
bun run build
bun run start
```

---

## 📖 部署指南

### 方式一：Node.js 部署（自托管 / VPS / Docker）

适用于有自己的服务器，需要完整功能（包括 better-sqlite3 原生模块）的场景。

#### 1. 构建生产版本

```bash
cd xianyu-admin
bun install
bun run build
```

#### 2. 配置环境变量

构建后，首次启动访问 `/install` 完成安装向导，或手动创建 `.env`：

```env
XY_ADMIN_SECRET=your-admin-secret-at-least-6-chars
XY_JWT_SECRET=your-jwt-secret-at-least-16-chars
XY_DB_DRIVER=sqlite
XY_DATABASE_URL=prisma/xianyu_admin.db
XY_INSTALLED=true
```

#### 3. 启动服务

```bash
bun run start
# 或
node .output/server/index.mjs
```

#### 4. 使用 PM2 / Supervisor 持久化

```bash
# PM2
pm2 start .output/server/index.mjs --name xianyu-admin

# 或使用项目自带的 supervisor.sh
bash supervisor.sh
```

#### MySQL 配置（可选）

如需使用 MySQL，修改 `.env`：

```env
XY_DB_DRIVER=mysql
XY_DB_HOST=127.0.0.1
XY_DB_PORT=3306
XY_DB_USER=root
XY_DB_PASSWORD=your-password
XY_DB_NAME=xianyu_admin
```

#### Docker 部署

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY . .
RUN npm install && npm run build
EXPOSE 3001
CMD ["node", ".output/server/index.mjs"]
```

```bash
docker build -t xianyu-admin .
docker run -p 3001:3001 -v $(pwd)/data:/app/data xianyu-admin
```

---

### 方式二：Cloudflare Pages 部署（Serverless）

适用于无服务器、全球 CDN、自动扩缩容的场景。使用 Cloudflare D1 作为数据库。

#### 1. 前置准备

- 注册 [Cloudflare](https://cloudflare.com) 账号
- 创建一个 D1 数据库
- 创建一个 Pages 项目

#### 2. 创建 D1 数据库

```bash
# 安装 wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建 D1 数据库
wrangler d1 create xianyu-admin-db
# 记下输出的 database_id
```

#### 3. 配置 wrangler.toml

复制模板并修改：

```bash
cp wrangler.toml.example wrangler.toml
```

编辑 `wrangler.toml`，填入你的 D1 `database_id`：

```toml
name = "xianyu-admin"
compatibility_date = "2025-01-01"
pages_build_output_dir = "./.output/public"

[[d1_databases]]
binding = "DB"
database_name = "xianyu-admin-db"
database_id = "你的-D1-数据库-ID"
```

#### 4. 构建并部署

```bash
# 设置 Cloudflare Pages 环境标记
export CF_PAGES=1

# 安装依赖并构建
bun install
bun run build

# 部署到 Cloudflare Pages
wrangler pages deploy .output/public --project-name=xianyu-admin
```

#### 5. 完成安装向导

部署后访问 `https://你的项目.pages.dev/install`：

- 安装向导会**自动检测到 Cloudflare 环境**
- 选择 **D1** 数据库
- 填写 **Cloudflare API 配置**：
  - Account ID（在 Cloudflare 仪表盘右侧获取）
  - Pages 项目名
  - API Token（在 Cloudflare API Tokens 页面创建，权限选择 "Cloudflare Pages - Edit"）
- 填写管理员账号和密钥
- 点击"完成安装"

安装向导会通过 **Cloudflare API 自动设置环境变量**到 Pages 项目（无需手动在控制台配置），包括：
- `XY_ADMIN_SECRET` — 管理密钥
- `XY_JWT_SECRET` — JWT 签发密钥
- `XY_DB_DRIVER` — 设为 `d1`
- `XY_INSTALLED` — 设为 `true`

#### 6. 重新部署生效

安装完成后，**需要重新部署 Pages 项目**，新的环境变量才会生效：

```bash
wrangler pages deploy .output/public --project-name=xianyu-admin
```

#### Cloudflare Pages 持续部署

在 Cloudflare Pages 控制台连接 Git 仓库，设置：
- 构建命令：`bash && export CF_PAGES=1 && bun install && bun run build`
- 输出目录：`.output/public`
- 环境变量：`CF_PAGES=1`

每次 push 代码会自动构建部署。

---

## 🎛️ 后台功能使用说明

### 🔐 登录与安装

1. **首次访问** → 自动跳转安装向导（4 步：环境选择 → 密钥配置 → 管理员账号 → 确认）
2. **登录** → 使用安装时创建的管理员账号

### 📊 工作台 (Dashboard)

- **统计卡片** — 账号数/关键词/订单/商品一览
- **数据对比** — 今日 vs 昨日、本周 vs 上周（订单量+收入涨跌幅）
- **账号在线状态** — 实时显示各账号在线/离线/停用状态（脉冲动画）
- **7天订单趋势** — 双折线图（订单量 + 收入），可导出 PNG
- **订单状态分布** — 环形图 + 图例 + 进度条，可导出 PNG
- **系统健康** — 运行时长/内存/数据库大小/表数量/记录数
- **实时活动流** — 合并订单/日志/风控/账号事件，30s 自动刷新
- **导出报告** — 一键生成 HTML 报告（可 Ctrl+P 转 PDF）

### 📱 账号管理

- 添加闲鱼账号（Cookie / 用户名密码）
- 启用/停用、自动确认收货、暂停时长设置
- **账号健康度面板** — 健康分(0-100)、等级(good/fair/poor)、关键词/订单统计
- 编辑/删除（级联删除关键词、AI设置等）

### 📦 商品管理

- 商品列表（标题/价格/分类/多规格/多数量发货）
- 按账号筛选、批量删除
- 编辑多规格/多数量发货设置

### 🛒 订单管理

- 订单列表 + **高级筛选**（状态/账号/关键词/日期范围/金额区间）
- **批量操作** — 全选、批量发货、批量删除（3秒倒计时确认防误操作）、导出选中
- **订单详情抽屉** — 右侧滑入面板，可编辑收货人信息、修改状态、手动发货
- 导入/导出（JSON + CSV 格式，Excel 兼容）

### 🤖 自动回复

- 关键词管理（文本/图片/商品绑定）
- **关键词匹配测试器** — 输入消息测试匹配（精确/包含/前缀*/后缀*/*包含*）
- **批量导入向导** — 3 步（选格式 JSON/CSV → 粘贴/上传 → 预览确认），支持模板下载
- 导入/导出

### 💳 卡券管理

- 4 种类型：API / 文本 / 数据 / 图片
- 多规格、延时发货、启用/停用

### 🚚 自动发货

- 发货规则配置（关键词 → 卡券映射）
- 发货数量、已发货次数统计

### 🔔 通知渠道

- 8 种渠道：QQ / 钉钉 / 飞书 / Bark / 邮件 / Webhook / 微信 / Telegram
- **测试发送** — 每个渠道可一键发送测试消息验证配置
- 消息通知矩阵 — 账号 × 渠道开关网格

### ⚙️ 系统设置

- **4 个 Tab** — 通用 / AI 回复 / SMTP / 商品同步
- **配置导入导出** — JSON 格式，可跨环境迁移配置
- **主题色实时预览** — 5 种主题色（琥珀/青色/玫红/翠绿/天蓝）即时切换

### 👤 个人中心

- 修改密码（验证当前密码）
- 界面偏好 — 主题模式/侧边栏默认收起/通知声音/每页条数

### 🛡️ 管理员功能

- **用户管理** — 切换管理员/启用/删除（防止删除最后一个管理员）
- **操作审计日志** — 自动记录所有写操作（谁在什么时间做了什么），支持筛选/分页
- **系统日志** — 日志级别统计、按级别/模块筛选、清空
- **风控日志** — 滑块验证等风控事件追踪
- **数据管理** — ER 图可视化、表数据查看（搜索+排序）、清空/导出/导入备份

### ⌨️ 全局快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+K` / `Cmd+K` | 打开命令面板（页面导航 + 操作） |
| `?` | 查看快捷键帮助 |
| `Esc` | 关闭弹窗/面板 |
| `Ctrl+R` | 刷新当前页数据 |
| `g` + `d/a/o/s` | 快速导航到工作台/账号/订单/设置 |
| `n` | 新增（当前页） |
| `/` | 搜索/筛选 |
| `Ctrl+D` | 切换深色/浅色 |

---

## 🏗️ 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Nuxt 4.4.8 (Vue 3 + Nitro) |
| 样式 | Tailwind CSS 3.4.19 |
| 语言 | TypeScript 5 |
| 数据库 | SQLite / MySQL / Cloudflare D1 / Memory |
| 认证 | JWT + bcrypt + HttpOnly Cookie |
| API | 统一 `{ success, code, message, data }` 响应格式 |
| 部署 | Node.js / Cloudflare Pages |

---

## 📂 项目结构

```
xianyu-admin/
├── app/                    # Nuxt 应用目录
│   ├── components/         # Vue 组件 (Icon, Sidebar, ModalBase, DonutChart...)
│   ├── composables/        # 组合式函数 (useApi, useAuth, useNav, useThemeColor...)
│   ├── layouts/            # 布局 (default, auth, blank)
│   ├── middleware/         # 路由中间件 (auth.global.ts)
│   ├── pages/              # 页面 (dashboard, accounts, orders, admin/...)
│   ├── plugins/            # 客户端插件 (sw.client.ts - Service Worker)
│   └── assets/css/         # 全局样式
├── server/                 # Nitro 服务端
│   ├── api/                # API 路由 (~70 个端点)
│   ├── utils/              # 工具 (db, auth, config, response, audit, schema)
│   ├── plugins/            # 服务端插件 (init, audit)
│   └── middleware/         # 服务端中间件 (install guard)
├── public/                 # 静态资源 (favicon, manifest, sw.js)
├── nuxt.config.ts          # Nuxt 配置
├── tailwind.config.js      # Tailwind 配置
├── wrangler.toml.example   # Cloudflare 配置模板
├── supervisor.sh           # 生产环境守护脚本
└── LICENSE                 # GNU AGPL v3.0 许可证
```

---

## 🔄 功能模块

本项目采用 Nuxt 4 + Tailwind 3 技术栈构建：

- ✅ 18 个功能模块（含闲鱼多账号管理、返佣分销系统、联盟选品闭环）
- ✅ 27+ 个数据库表结构
- ✅ 统一 API 响应格式
- ✅ 数据驱动 + 单一数据源（无硬编码）
- ✅ 多数据库适配层（SQLite/MySQL/D1/Memory）

---

## 📜 License

[GNU AGPL v3.0](./LICENSE) © Kentpan

本仓库采用 GNU Affero General Public License v3.0 开源。若您通过网络提供服务, 必须公开修改后的源代码。
