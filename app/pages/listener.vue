<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="监听服务" description="闲鱼消息监听引擎实时状态：长连接监听买家消息、自动回复、自动发货；内置引擎随本服务自动运行，远程代理可任意机器独立部署">
      <template #actions>
        <button class="btn-secondary" @click="load">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- 监听引擎管理 -->
    <div class="card overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 class="font-semibold text-slate-900 dark:text-white">监听引擎 / 远程代理</h2>
          <p class="text-slate-400 mt-0.5">代理只做纯粹的消息监听与转发，无业务状态；接入鉴权统一为 Authorization: Bearer，且后台对回连请求限速。同一时刻只有一个引擎在使用。</p>
        </div>
        <button class="btn-secondary" @click="openCreate">
          <Icon name="plus" /> 新增远程代理
        </button>
      </div>

      <div v-if="enginesLoading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>引擎</th>
              <th>类型</th>
              <th>部署地址</th>
              <th>接入令牌</th>
              <th>在线状态</th>
              <th>使用状态</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in engines" :key="e.id">
              <td>
                <div class="font-medium text-slate-900 dark:text-white">{{ e.name }}</div>
                <div class="text-slate-400 mt-0.5">{{ e.slug }}</div>
              </td>
              <td>
                <span class="badge" :class="e.type === 'builtin' ? 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'">
                  {{ e.type === 'builtin' ? '内置' : '远程代理' }}
                </span>
              </td>
              <td class="text-slate-500 dark:text-slate-400">
                <template v-if="e.type === 'remote'">
                  <template v-if="e.host">{{ e.host }}<span v-if="e.port">:{{ e.port }}</span></template>
                  <template v-else>未登记（代理主动外呼，无需公网入站）</template>
                  <div v-if="e.remark" class="text-slate-400 mt-0.5">{{ e.remark }}</div>
                </template>
                <template v-else-if="e.runtime_supported === false">
                  <span class="text-amber-600 dark:text-amber-400">本机无常驻进程 · 请部署远程代理（自有设备 Node 版 / Cloudflare Edge 版）</span>
                </template>
                <template v-else>本进程内运行 · 自动随服务启停</template>
              </td>
              <td>
                <template v-if="e.type === 'remote'">
                  <code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{{ maskToken(e.token) }}</code>
                  <button class="ml-1 text-brand-600 hover:underline" @click="copyToken(e.token)">复制</button>
                  <button class="ml-1 text-rose-600 hover:underline" @click="resetToken(e)">重置</button>
                </template>
                <template v-else><span class="text-slate-400">—</span></template>
              </td>
              <td>
                <span class="inline-flex items-center gap-1.5">
                  <template v-if="e.type === 'builtin' && e.runtime_supported === false">
                    <span class="text-amber-600 dark:text-amber-400">不可用</span>
                  </template>
                  <template v-else>
                    <span class="inline-block w-2 h-2 rounded-full" :class="e.online ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'" />
                    <span class="text-slate-500 dark:text-slate-400">{{ e.online ? '在线' : '离线' }}</span>
                  </template>
                </span>
              </td>
              <td>
                <span v-if="e.is_active" class="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                  <Icon name="check" /> 使用中
                </span>
                <span v-else class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">备用</span>
              </td>
              <td class="text-right">
                <div class="inline-flex items-center gap-1.5 flex-wrap justify-end">
                  <button v-if="!e.is_active && !(e.type === 'builtin' && e.runtime_supported === false)" class="btn-secondary" :disabled="switching === e.id" @click="switchTo(e)">
                    {{ switching === e.id ? '切换中...' : '设为使用' }}
                  </button>
                  <button v-if="e.type === 'remote'" class="btn-secondary" @click="openDeploy(e)">部署</button>
                  <button class="btn-secondary" @click="openEdit(e)">编辑</button>
                  <button v-if="e.type === 'remote'" class="btn-secondary !text-rose-600 dark:!text-rose-400" @click="removeEngine(e)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 事件发布 / 订阅者 -->
    <div class="card overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 class="font-semibold text-slate-900 dark:text-white">事件发布 / 订阅者</h2>
          <p class="text-slate-400 mt-0.5">把引擎监听到的原始事件（聊天/系统/风控）转发给其他项目使用；鉴权为标准 Authorization: Bearer，纯转发不碰业务逻辑（回复/发货决策完全不受影响）。</p>
        </div>
        <button class="btn-secondary" @click="openSubscriberCreate">
          <Icon name="plus" /> 新增订阅者
        </button>
      </div>

      <div v-if="subscribersLoading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <div v-else-if="!subscribers.length" class="p-10 text-center text-slate-400">
        还没有订阅者。添加后本后台会向其 Webhook 地址 POST 原始事件（请求头带 Authorization: Bearer 令牌，下游项目用它做服务端鉴权）。
      </div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>订阅者</th>
              <th>订阅令牌</th>
              <th>Webhook 地址</th>
              <th>状态</th>
              <th>送达 / 失败</th>
              <th>最近送达</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in subscribers" :key="s.id">
              <td>
                <div class="font-medium text-slate-900 dark:text-white">{{ s.name }}</div>
                <div v-if="s.remark" class="text-slate-400 mt-0.5">{{ s.remark }}</div>
              </td>
              <td>
                <code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{{ maskToken(s.token) }}</code>
                <button class="ml-1 text-brand-600 hover:underline" @click="copyToken(s.token)">复制</button>
                <button class="ml-1 text-rose-600 hover:underline" @click="resetSubscriberToken(s)">重置</button>
              </td>
              <td class="text-slate-500 dark:text-slate-400 max-w-[240px] truncate" :title="s.webhook_url">{{ s.webhook_url }}</td>
              <td>
                <span v-if="!s.enabled" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">已停用</span>
                <span v-else-if="s.muted" class="badge bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                  <Icon name="alert" /> 静默中
                </span>
                <span v-else class="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">转发中</span>
              </td>
              <td class="text-slate-500 dark:text-slate-400">{{ s.total_delivered }} / <span :class="s.total_failed > 0 ? 'text-rose-500' : ''">{{ s.total_failed }}</span></td>
              <td class="text-slate-500 dark:text-slate-400">{{ formatTime(s.last_delivery_at) }}</td>
              <td class="text-right">
                <div class="inline-flex items-center gap-1.5 flex-wrap justify-end">
                  <button class="btn-secondary" :disabled="testing === s.id" @click="testPush(s)">{{ testing === s.id ? '发送中...' : '测试' }}</button>
                  <button class="btn-secondary" @click="openSubscriberEdit(s)">编辑</button>
                  <button class="btn-secondary !text-rose-600 dark:!text-rose-400" @click="removeSubscriber(s)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-slate-400">
        投递保护：单次 10s 超时、对端 429 自动退避、连续 5 次失败自动静默 10 分钟（恢复后自动续转）；每订阅者限速 120 次/分钟。
      </div>
    </div>

    <!-- 引擎总览 -->
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <div class="card p-4">
        <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <Icon name="server" />
          <span>引擎状态</span>
        </div>
        <p class="mt-2 text-xl font-semibold" :class="status?.engine_online ? 'text-emerald-600 dark:text-emerald-400' : enginesRuntime === 'cloudflare' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'">
          {{ status?.engine_online ? '运行中' : enginesRuntime === 'cloudflare' ? '待接入代理' : '未运行' }}
        </p>
        <p class="text-slate-400 mt-1">{{ enginesRuntime === 'cloudflare' ? 'Cloudflare 无常驻进程，内置引擎不可用；部署独立代理后「设为使用」' : '按内置引擎进程心跳判定，与账号状态无关' }}</p>
      </div>
      <div class="card p-4">
        <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <Icon name="accounts" />
          <span>监听中</span>
        </div>
        <p class="mt-2 text-xl font-semibold text-slate-900 dark:text-white">{{ status?.listening ?? '-' }}</p>
        <p class="text-slate-400 mt-1">长连接保持中</p>
      </div>
      <div class="card p-4">
        <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <Icon name="refresh" />
          <span>连接中</span>
        </div>
        <p class="mt-2 text-xl font-semibold text-amber-600 dark:text-amber-400">{{ status?.connecting ?? '-' }}</p>
        <p class="text-slate-400 mt-1">正在建立/重连</p>
      </div>
      <div class="card p-4">
        <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <Icon name="alert" />
          <span>需重新扫码</span>
        </div>
        <p class="mt-2 text-xl font-semibold text-rose-600 dark:text-rose-400">{{ status?.need_relogin ?? '-' }}</p>
        <p class="text-slate-400 mt-1">登录态过期，去账号管理更新</p>
      </div>
      <div class="card p-4">
        <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <Icon name="riskLogs" />
          <span>异常</span>
        </div>
        <p class="mt-2 text-xl font-semibold text-rose-600 dark:text-rose-400">{{ status?.errored ?? '-' }}</p>
        <p class="text-slate-400 mt-1">连接失败待恢复</p>
      </div>
    </div>

    <!-- 引擎说明 -->
    <div class="card p-4">
      <div class="flex items-start gap-3">
        <Icon name="info" class="text-sky-500 mt-0.5 shrink-0" />
        <div class="text-slate-600 dark:text-slate-300 space-y-1">
          <p v-if="enginesRuntime === 'node'">内置引擎已内置在本服务进程内，随服务自动启停，无需任何额外进程；在「账号管理」启用/停用账号、更新 Cookie 后 5 秒内自动对齐。</p>
          <p v-else class="text-amber-600 dark:text-amber-400">当前部署在 Cloudflare Pages（workerd 无常驻进程），内置监听引擎不可用 —— 两种远程形态任选：<b>① 自有设备 Node 版</b>（推荐，住宅 IP 风控友好）：在任意能出网的机器（你的电脑/服务器）部署单文件 <code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">scripts/xianyu-proxy.mjs</code>；<b>② Cloudflare Edge 版</b>（无常驻设备时）：<code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">cloudflare/xianyu-edge-listener</code> Durable Object 监听器，wrangler 部署一次跑在边缘（需 Workers Paid，出口 IP 为数据中心段，风控面不同，详见包内 README）。代理上线后在其行内点「设为使用」即可接管监听。</p>
          <p>风控自愈：token 接口命中风控挑战时计入连败并按阶梯静默（30min → 2h，高频重试只会加深风控）；连败 ≥ 2 次后通过 SSE 实时推送全局弹窗（前端零轮询），弹窗内直接 iframe 嵌入闲鱼官方验证页（真实 h5api.m.goofish.com 页面，无代理无截图无后端浏览器），你在页面上人工拖动滑块，通过后官方页面按 addCookieToHeader 契约把 x5sec 凭证 postMessage 回本弹窗，自动合并进账号 Cookie 并重试 Token 恢复监听；弹窗打开期间引擎对该账号完全静默（不重试 token），避免并发调用作废你正在验证的挑战。</p>
          <p>引擎能力：收发闲鱼消息（关键词/AI/指定商品/默认回复四级链）、付款消息触发自动发货（卡券延时在卡券管理配置）、回复决策日志与消息过滤。</p>
          <p>远程代理：单文件 <code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">scripts/xianyu-proxy.mjs</code>（零 npm 依赖，Node ≥ 20；Node 20 无内置 WebSocket 时同目录 npm i ws），只做消息监听与转发，所有规则/卡券/订单等业务状态都保留在本后台；代理主动外呼本后台（无需公网入站端口），部署说明点引擎行的「部署」按钮查看。</p>
          <p class="text-slate-400">部署位置任选：能出网即入 —— 本地电脑（与浏览器同源环境风控最友好）、家里的闲置主机、任意 VPS；代理崩溃/断网自动重连与退避，Cookie 在后台重新扫码后 30s 内自动同步到代理。</p>
          <p class="text-slate-400">风控保护：设备指纹持久化、心跳/重连随机抖动、指数退避、发送人化队列（随机间隔 + 限速 12 条/分钟）、风控挑战自动冷却阶梯；后台对代理回连请求按 Bearer 令牌限速。</p>
        </div>
      </div>
    </div>

    <!-- 账号监听状态 -->
    <div class="card overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <h2 class="font-semibold text-slate-900 dark:text-white">账号监听状态</h2>
        <p class="text-slate-400">共 {{ status?.accounts.length ?? 0 }} 个账号</p>
      </div>
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <div v-else-if="!status?.accounts.length" class="p-10 text-center text-slate-400">
        还没有闲鱼账号，请先到 <NuxtLink to="/accounts" class="text-brand-600 underline">账号管理</NuxtLink> 添加。
      </div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>账号</th>
              <th>备注</th>
              <th>启用</th>
              <th>监听状态</th>
              <th>最近心跳</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in status.accounts" :key="a.id">
              <td>
                <div class="flex items-center gap-2">
                  <span class="font-medium text-slate-900 dark:text-white">{{ a.id }}</span>
                </div>
              </td>
              <td class="text-slate-500 dark:text-slate-400">{{ a.remark || a.username || '-' }}</td>
              <td>
                <span class="badge" :class="a.enabled ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'">
                  {{ a.enabled ? '启用' : '停用' }}
                </span>
              </td>
              <td>
                <span class="badge" :class="stateMeta(a.state).cls">
                  <Icon :name="stateMeta(a.state).icon" /> {{ stateMeta(a.state).label }}
                </span>
                <span v-if="(a.token_fail_streak || 0) > 0 && a.state !== 'listening'" class="badge bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 ml-1">
                  token 连败 {{ a.token_fail_streak }} 次
                </span>
              </td>
              <td class="text-slate-500 dark:text-slate-400">{{ formatTime(a.last_check_at) }}</td>
              <td>
                <div class="flex items-center justify-end gap-1.5">
                  <button class="btn-secondary !px-2.5 !py-1" :disabled="tokenFetching === a.id" @click="fetchToken(a)">
                    <Icon name="refresh" :class="tokenFetching === a.id ? 'animate-spin' : ''" />
                    {{ tokenFetching === a.id ? '请求中...' : '获取Token' }}
                  </button>
                  <button v-if="a.need_manual_verify" class="btn-primary !px-2.5 !py-1" @click="openManualVerify(a)">
                    <Icon name="shield" /> 手动验证
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新增/编辑代理弹窗 -->
    <ModalBase v-model="formOpen" :title="editing ? '编辑监听引擎' : '新增远程代理'" size="md">
      <div class="space-y-4">
        <div>
          <label class="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">名称</label>
          <input v-model="form.name" class="input w-full" placeholder="如：香港服务器代理" />
        </div>
        <template v-if="!editing || editing.type === 'remote'">
          <div>
            <label class="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">IP 地址 / 域名（选填登记）</label>
            <input v-model="form.host" class="input w-full" placeholder="如：123.45.67.89，代理主动外呼时可不填" />
          </div>
          <div>
            <label class="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">端口（选填）</label>
            <input v-model.number="form.port" type="number" min="0" class="input w-full" placeholder="代理健康检查端口，仅登记展示用" />
          </div>
        </template>
        <div>
          <label class="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">备注</label>
          <input v-model="form.remark" class="input w-full" placeholder="选填" />
        </div>
        <div v-if="editing && editing.type === 'remote'">
          <label class="inline-flex items-center gap-2 cursor-pointer">
            <input v-model="form.enabled" type="checkbox" class="rounded border-slate-300" />
            <span class="text-slate-700 dark:text-slate-300">启用该代理（允许被设为使用中）</span>
          </label>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="formOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving || !form.name.trim()" @click="saveForm">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </template>
    </ModalBase>

    <!-- 新增/编辑订阅者弹窗 -->
    <ModalBase v-model="subFormOpen" :title="subEditing ? '编辑订阅者' : '新增订阅者'" size="md">
      <div class="space-y-4">
        <div>
          <label class="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">名称</label>
          <input v-model="subForm.name" class="input w-full" placeholder="如：订单看板 / 客服机器人项目" />
        </div>
        <div>
          <label class="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">Webhook 回调地址</label>
          <input v-model="subForm.webhook_url" class="input w-full" placeholder="https://你的项目/api/xxx，本后台将 POST 原始事件到此地址" />
        </div>
        <div>
          <label class="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">备注</label>
          <input v-model="subForm.remark" class="input w-full" placeholder="选填" />
        </div>
        <div>
          <label class="inline-flex items-center gap-2 cursor-pointer">
            <input v-model="subForm.enabled" type="checkbox" class="rounded border-slate-300" />
            <span class="text-slate-700 dark:text-slate-300">启用该订阅者（事件将转发到其 Webhook）</span>
          </label>
        </div>
        <div class="text-slate-400">
          下游项目鉴权方式：校验请求头 Authorization: Bearer 的令牌与本页展示的订阅令牌一致（建议恒定时间比对）。测试按钮会向该地址发送一条标记测试事件。
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="subFormOpen = false">取消</button>
        <button class="btn-primary" :disabled="subSaving || !subForm.name.trim()" @click="saveSubscriberForm">
          {{ subSaving ? '保存中...' : '保存' }}
        </button>
      </template>
    </ModalBase>

    <!-- 远程代理部署说明弹窗 -->
    <ModalBase v-model="deployOpen" title="远程代理部署说明（单文件 · 零依赖）" size="md">
      <div class="space-y-4">
        <div class="text-slate-600 dark:text-slate-300 space-y-2">
          <p>1. 将项目内 <code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">scripts/xianyu-proxy.mjs</code> 单个文件上传到任意能出网的服务器（仅需 Node ≥ 20，零 npm 依赖；Node 20 可在同目录 npm i ws）。</p>
          <p>2. 配置 XY_ADMIN_URL / XY_ENGINE_TOKEN（鉴权统一为 Authorization: Bearer，令牌即本行代理的接入令牌），三种方式任选其一：① 启动命令内联环境变量；② 在脚本同目录放 <code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">.env</code> 文件（每行 KEY=VALUE），脚本启动时自动加载（真实环境变量优先）；③ Wispbyte 等面板的「Environment/环境变量」编辑页写入的正是这个 .env 文件，同样会被自动读取（面板 Startup/启动页的变量才是真环境变量，两处是分开的）。</p>
        </div>
        <div class="relative">
          <pre class="p-3 rounded-lg bg-slate-900 text-slate-100 overflow-x-auto leading-relaxed"><code>{{ deploySnippet }}</code></pre>
          <button class="absolute top-2 right-2 px-2 py-1 rounded bg-slate-700 text-slate-100 hover:bg-slate-600" @click="copySnippet">
            {{ snippetCopied ? '已复制' : '复制' }}
          </button>
        </div>
        <div class="text-slate-600 dark:text-slate-300 space-y-2">
          <p>3. 启动：<code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">node xianyu-proxy.mjs</code>。代理主动拉取账号配置 → 连闲鱼长连接 → 事件上报本后台，后台决策的回复/发货动作由代理人化执行；无需公网入站端口。</p>
          <p>4. 回到本页，确认该代理显示「在线」后，点「设为使用」即可切换；原内置引擎会在 5 秒内自动停止监听，不会重复回复。令牌泄露点「重置」即时作废。</p>
          <p class="text-slate-400">提示：代理与后台共用一套风控约束（设备指纹持久化/随机抖动/冷却阶梯/人化发送队列）；本地电脑运行代理时若装有 Playwright Chromium 会自动探测真实浏览器 UA（风控更友好），无则回退内置静态 UA。</p>
          <p class="text-slate-400">说明：XY_ADMIN_URL 必须是代理所在机器能访问到的本后台地址；XY_PROXY_PORT 为代理本地健康检查端口（选填，Bearer 鉴权）。</p>
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
            <p class="font-medium text-slate-700 dark:text-slate-200">没有常驻设备？Cloudflare Edge 版</p>
            <p>项目内 <code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">cloudflare/xianyu-edge-listener/</code> 是跑在 Cloudflare Durable Object 上的监听器（与 Edgechat 同形态：出站 WebSocket + alarm 保活），对接协议与 Node 版完全一致。<code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">wrangler deploy</code> 一次即可，无需任何自有设备在线。</p>
            <p class="text-slate-400">如实提示：需 Workers Paid（$5/月起，DO 常驻连接计 duration 费）；出口 IP 为数据中心段，闲鱼风控面与住宅 IP 不同，如遇风控会自动冷却退避并在本页显示。详见该目录 README。</p>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-primary" @click="deployOpen = false">知道了</button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getListenerStatus, manualFetchToken, type ListenerStatus, type ListenerAccount } from '~/api/listener'
import { useVerifyGuard } from '~/composables/useVerifyGuard'
import { getEngines, createEngine, updateEngine, deleteEngine, activateEngine, type EngineRow } from '~/api/engines'
import { getSubscribers, createSubscriber, updateSubscriber, deleteSubscriber, testSubscriber, type SubscriberRow } from '~/api/subscribers'
import { useToast } from '~/composables/useToast'

const toast = useToast()
const status = ref<ListenerStatus | null>(null)
const loading = ref(true)
const tokenFetching = ref('')
const { openVerify } = useVerifyGuard()

/** 手动获取 IM token: 立即实调一次, 结果如实回显; 被风控拦截时直接打开滑块验证弹窗 */
async function fetchToken(a: ListenerAccount) {
  tokenFetching.value = a.id
  try {
    const r = await manualFetchToken(a.id)
    if (r.ok) {
      toast.success(r.message || 'Token 获取成功')
    } else if (r.verdict === 'risk' && r.punish_url) {
      toast.warning(r.message || '仍被风控拦截')
      openVerify(a.id, a.remark || a.username || a.id, r.punish_url)
    } else {
      toast.error(r.message || 'Token 获取未成功')
    }
  } catch (e: any) {
    toast.error(e?.message || '请求失败')
  } finally {
    tokenFetching.value = ''
    load()
  }
}

/** 打开人工滑块验证弹窗 (弹窗内直接加载官方验证页, 无挑战链接时会引导「获取 Token」换新) */
function openManualVerify(a: ListenerAccount) {
  openVerify(a.id, a.remark || a.username || a.id)
}

// ---- 引擎管理 ----
const engines = ref<EngineRow[]>([])
const origin = ref('')
const enginesRuntime = ref<'node' | 'cloudflare'>('node')
const enginesLoading = ref(true)
const switching = ref(0)

const formOpen = ref(false)
const saving = ref(false)
const editing = ref<EngineRow | null>(null)
const form = reactive({ name: '', host: '', port: 8765, remark: '', enabled: true })

const deployOpen = ref(false)
const deployEngine = ref<EngineRow | null>(null)
const snippetCopied = ref(false)

function maskToken(token: string): string {
  if (!token) return '未生成'
  return token.length > 12 ? `${token.slice(0, 8)}••••••••${token.slice(-4)}` : token
}

const deploySnippet = computed(() => {
  const e = deployEngine.value
  return [
    `XY_ADMIN_URL=${origin.value || 'https://你的后台域名'}`,
    `XY_ENGINE_TOKEN=${e?.token || '后台-监听服务页-复制该代理的接入令牌'}`,
    `XY_PROXY_PORT=8765      # 选填: 本地健康检查端口`,
    `XY_POLL_SECONDS=30      # 选填: 配置轮询间隔`,
  ].join('\n')
})

async function loadEngines() {
  enginesLoading.value = true
  try {
    const r = await getEngines()
    engines.value = r.engines || []
    origin.value = r.origin || ''
    enginesRuntime.value = r.runtime || 'node'
  } catch (e: any) {
    toast.error(e?.message || '获取引擎列表失败')
  } finally {
    enginesLoading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.name = ''
  form.host = ''
  form.port = 8765
  form.remark = ''
  form.enabled = true
  formOpen.value = true
}

function openEdit(e: EngineRow) {
  editing.value = e
  form.name = e.name
  form.host = e.host
  form.port = e.port || 8765
  form.remark = e.remark
  form.enabled = e.enabled
  formOpen.value = true
}

async function saveForm() {
  saving.value = true
  try {
    if (editing.value) {
      await updateEngine(editing.value.id, {
        name: form.name,
        host: editing.value.type === 'remote' ? form.host : undefined,
        port: editing.value.type === 'remote' ? form.port : undefined,
        remark: form.remark,
        enabled: editing.value.type === 'remote' ? form.enabled : undefined,
      })
      toast.success('引擎已更新')
    } else {
      await createEngine({ name: form.name, host: form.host, port: form.port, remark: form.remark })
      toast.success('远程代理已添加，部署代理进程后可设为使用')
    }
    formOpen.value = false
    await loadEngines()
  } catch (e: any) {
    toast.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function switchTo(e: EngineRow) {
  switching.value = e.id
  try {
    const r = await activateEngine(e.id)
    toast.success(r?.message || `已切换为使用「${e.name}」`)
    await loadEngines()
  } catch (err: any) {
    toast.error(err?.message || '切换失败')
  } finally {
    switching.value = 0
  }
}

async function removeEngine(e: EngineRow) {
  if (!confirm(`确定删除远程代理「${e.name}」？`)) return
  try {
    await deleteEngine(e.id)
    toast.success('代理已删除')
    await loadEngines()
  } catch (err: any) {
    toast.error(err?.message || '删除失败')
  }
}

function openDeploy(e: EngineRow) {
  deployEngine.value = e
  snippetCopied.value = false
  deployOpen.value = true
}

async function copyToken(token: string) {
  try {
    await navigator.clipboard.writeText(token)
    toast.success('令牌已复制')
  } catch {
    toast.error('复制失败，请从「部署」弹窗中复制')
  }
}

async function resetToken(e: EngineRow) {
  if (!confirm(`重置「${e.name}」的接入令牌？该代理旧令牌将立即失效，需同步更新其 XY_ENGINE_TOKEN。`)) return
  try {
    await updateEngine(e.id, { regenerate_token: true })
    toast.success('令牌已重置，请重新复制并更新代理配置')
    await loadEngines()
  } catch (err: any) {
    toast.error(err?.message || '重置失败')
  }
}

async function copySnippet() {
  try {
    await navigator.clipboard.writeText(deploySnippet.value)
    snippetCopied.value = true
    setTimeout(() => (snippetCopied.value = false), 2000)
  } catch {
    toast.error('复制失败，请手动选择复制')
  }
}

async function load() {
  loading.value = true
  try {
    status.value = await getListenerStatus()
  } catch (e: any) {
    toast.error(e?.message || '获取监听状态失败')
  } finally {
    loading.value = false
  }
}

function stateMeta(state: ListenerAccount['state']) {
  switch (state) {
    case 'listening':
      return { label: '监听中', icon: 'check', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' }
    case 'connecting':
      return { label: '连接中', icon: 'refresh', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' }
    case 'reconnecting':
      return { label: '重连中', icon: 'refresh', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' }
    case 'risk_cooldown':
      return { label: '风控冷却', icon: 'alert', cls: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' }
    case 'error':
      return { label: '连接异常', icon: 'alert', cls: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' }
    case 'need_relogin':
      return { label: '需重新扫码', icon: 'alert', cls: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' }
    case 'engine_offline':
      return { label: '引擎离线', icon: 'server', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
    case 'disabled':
      return { label: '已停用', icon: 'close', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
    default:
      return { label: '未知', icon: 'info', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
  }
}

function formatTime(t: string | null) {
  if (!t) return '-'
  try {
    const d = t.includes('T') || t.includes('Z') ? new Date(t) : new Date(t.replace(' ', 'T') + 'Z')
    if (Number.isNaN(d.getTime())) return t
    const diff = Date.now() - d.getTime()
    if (diff >= 0 && diff < 60_000) return '刚刚'
    if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return t
  }
}

// ---- 事件发布 / 订阅者 ----
const subscribers = ref<SubscriberRow[]>([])
const subscribersLoading = ref(true)
const testing = ref(0)
const subFormOpen = ref(false)
const subSaving = ref(false)
const subEditing = ref<SubscriberRow | null>(null)
const subForm = reactive({ name: '', webhook_url: '', remark: '', enabled: true })

async function loadSubscribers() {
  subscribersLoading.value = true
  try {
    const r = await getSubscribers()
    subscribers.value = r.subscribers || []
  } catch (e: any) {
    toast.error(e?.message || '获取订阅者列表失败')
  } finally {
    subscribersLoading.value = false
  }
}

function openSubscriberCreate() {
  subEditing.value = null
  subForm.name = ''
  subForm.webhook_url = ''
  subForm.remark = ''
  subForm.enabled = true
  subFormOpen.value = true
}

function openSubscriberEdit(s: SubscriberRow) {
  subEditing.value = s
  subForm.name = s.name
  subForm.webhook_url = s.webhook_url
  subForm.remark = s.remark
  subForm.enabled = s.enabled
  subFormOpen.value = true
}

async function saveSubscriberForm() {
  subSaving.value = true
  try {
    if (subEditing.value) {
      await updateSubscriber(subEditing.value.id, {
        name: subForm.name,
        webhook_url: subForm.webhook_url,
        remark: subForm.remark,
        enabled: subForm.enabled,
      })
      toast.success('订阅者已更新')
    } else {
      await createSubscriber({ name: subForm.name, webhook_url: subForm.webhook_url, remark: subForm.remark })
      toast.success('订阅者已添加，事件将开始转发')
    }
    subFormOpen.value = false
    await loadSubscribers()
  } catch (e: any) {
    toast.error(e?.message || '保存失败')
  } finally {
    subSaving.value = false
  }
}

async function resetSubscriberToken(s: SubscriberRow) {
  if (!confirm(`重置「${s.name}」的订阅令牌？下游项目需同步更新，旧令牌立即失效。`)) return
  try {
    await updateSubscriber(s.id, { regenerate_token: true })
    toast.success('令牌已重置，请重新复制给下游项目')
    await loadSubscribers()
  } catch (err: any) {
    toast.error(err?.message || '重置失败')
  }
}

async function testPush(s: SubscriberRow) {
  testing.value = s.id
  try {
    const r = await testSubscriber(s.id)
    toast.success(r?.message || '测试事件已送达')
    await loadSubscribers()
  } catch (err: any) {
    toast.error(err?.message || '投递失败')
  } finally {
    testing.value = 0
  }
}

async function removeSubscriber(s: SubscriberRow) {
  if (!confirm(`确定删除订阅者「${s.name}」？其事件转发将立即停止。`)) return
  try {
    await deleteSubscriber(s.id)
    toast.success('订阅者已删除')
    await loadSubscribers()
  } catch (err: any) {
    toast.error(err?.message || '删除失败')
  }
}

onMounted(() => {
  load()
  loadEngines()
  loadSubscribers()
})
</script>
