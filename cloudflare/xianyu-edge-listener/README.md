# xianyu-edge-listener — 闲鱼监听 Cloudflare Edge 版 (Durable Object)

跑在 **Cloudflare Worker + Durable Object** 上的闲鱼消息监听器，是 `scripts/xianyu-proxy.mjs`
（Node 自托管版）的 **Edge 原生替代**：部署一次后跑在 Cloudflare 边缘节点上，
**不需要自己的电脑/服务器开机**。

对接协议与 Node 版完全一致（`GET /api/engine/config` / `POST /api/engine/events`），
后台零改动——监听服务页直接显示"在线"，"设为使用"即接管全部账号。

## 先读：与 Edgechat 的关系 & 诚实的边界

Edgechat 证明了 edge 上可做实时消息系统（DO WebSocket Hibernation + TG webhook），
但它的实时性全部来自"对方主动推"（浏览器入站 WS / TG 官方 webhook）。闲鱼不同：
**没有 webhook，必须主动外呼闲鱼 IM 网关维持出站长连接**。本监听器靠两件事实现：

1. **workerd 出站 WebSocket 客户端**：`fetch(wss, { headers: { Upgrade: 'websocket', Cookie, 'User-Agent', ... } })`
   → `response.webSocket` → `accept()`。自定义握手头（Cookie/UA/Origin）**实测原样透传**。
2. **DO alarm 保活**：出站连接打开期间 DO 不被驱逐（官方文档：最长 15 分钟，任意 I/O 延长）。
   监听器以 1s alarm tick 自续（心跳 15s / 配置轮询 30s / 重连退避 / 发送队列全部由 tick 调度），
   连接永续在线；DO 重启（部署/迁移）后从存储恢复账号并重建连接，离线消息由协议 ackDiff 机制补齐。

## 如实的风险与成本声明

| 项目 | 事实 |
|---|---|
| Workers Paid | **需要**（$5/月起）。常驻出站连接的 DO 持续占用内存时长（duration），免费额度装不下。单账号估 $2~5/月，多账号线性增长 |
| 出口 IP | Cloudflare 数据中心 IP 段。闲鱼/阿里风控对数据中心 IP 的 IM 连接态度未知——如触发风控（RGV587/挑战页），监听器会按冷却阶梯自动退避并在后台显示 risk 事件 |
| UA/指纹 | Edge 上无本地 Chromium 可探测，UA 为恒定 Chrome 133 串（风控硬约束是"恒定一致"，满足）；TLS 指纹为 workerd (BoringSSL) |
| 多引擎互斥 | 与 Node 版一致：后台"设为使用"哪个引擎，哪个在线生效 |

**建议**：住宅/家宽环境优先用 `scripts/xianyu-proxy.mjs`（风控面与浏览器同源）；
Edge 版适合**没有可常驻设备**、愿意承担上述成本与风控不确定性的场景。

## 部署（三步）

```bash
# 0. 准备: Node ≥ 18, 一个 Cloudflare 账号 (已开通 Workers Paid)
npm i -g wrangler

# 1. 登录 (浏览器授权一次)
wrangler login

# 2. 配置并部署
cp wrangler.toml.example wrangler.toml
#   编辑 wrangler.toml [vars]:
#     XY_ADMIN_URL    = "https://你的后台域名.pages.dev"
#     XY_ENGINE_TOKEN = "后台-监听服务页-该代理行的接入令牌"
wrangler deploy
```

部署完成后：

- 首次 cron（≤5 分钟内）或手动访问 `https://xianyu-edge-listener.<你的子域>.workers.dev/` 即启动监听
- 后台「监听服务」页该引擎行在 30s 内显示"在线"，账号逐个进入"监听中"
- 「设为使用」后接管全部账号（自动回复/自动发货决策仍在后台执行）

## 健康检查

```
GET https://xianyu-edge-listener.<你的子域>.workers.dev/health
→ { ok, engine_active, accounts: [{id, state, detail}], alarm }
```

## 架构速览

```
Worker (fetch/scheduled)  →  XianyuEdgeDO (idFromName('default'))
                              ├─ alarm() 每 1s tick:
                              │    ├─ 配置轮询 (30s) / 账号对齐 / Cookie 热替换
                              │    ├─ 每账号: 风控冷却·重连退避·心跳(15s)·token 刷新(1h)
                              │    ├─ 出站 WS 消息事件 → 解析同步包 → 上报队列
                              │    └─ 上报 flush (450ms 节流) → 回收决策动作 → 人化执行
                              ├─ storage: 配置快照 + 每账号运行时状态 (重启恢复)
                              └─ cron */5 兜底唤醒 (alarm 链意外断开时拉起)
```

## 文件

- `src/index.js` — 单文件实现（协议层与 `server/utils/xianyu/protocol.ts` 同源直译）
- `wrangler.toml.example` — DO 绑定 + migration + vars 模板
