<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="卡券管理" description="维护 API / 文本 / 卡密 / 图片 卡券；卡密型发货时按配置生成随机码并留档">
      <template #actions>
        <button class="btn-secondary" @click="varModalOpen = true">
          <Icon name="edit" /> 变量配置
        </button>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate">
          <Icon name="plus" /> 新增卡券
        </button>
      </template>
    </PageHeader>

    <!-- Search -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-[240px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input v-model="keyword" class="input pl-9" placeholder="搜索卡券名称 / 描述" />
        </div>
        <div class="flex items-center gap-2">
          <button
            v-for="t in TYPE_OPTIONS"
            :key="t.value"
            class="badge cursor-pointer transition-colors"
            :class="filterType === t.value ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
            @click="filterType = filterType === t.value ? '' : t.value"
          >
            {{ t.label }}
          </button>
        </div>
        <p class="text-xs text-slate-400">共 {{ filtered.length }} 张</p>
      </div>
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>多规格</th>
                <th>对接</th>
                <th>延时</th>
                <th>状态</th>
                <th>创建时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in filtered" :key="c.id">
                <td>
                  <button class="text-slate-800 dark:text-white font-medium hover:text-brand-600" @click="openEdit(c)">
                    {{ c.name }}
                  </button>
                  <p v-if="c.description" class="text-xs text-slate-400 mt-0.5 truncate max-w-[240px]">{{ c.description }}</p>
                </td>
                <td>
                  <span class="badge" :class="typeMeta(c.type).cls">
                    <Icon :name="typeMeta(c.type).icon" /> {{ typeMeta(c.type).label }}
                  </span>
                </td>
                <td>
                  <template v-if="c.is_multi_spec">
                    <span class="text-xs text-slate-500 dark:text-slate-400">
                      {{ c.spec_name || '规格' }}: {{ c.spec_value || '—' }}
                    </span>
                  </template>
                  <span v-else class="text-slate-400">—</span>
                </td>
                <td>
                  <template v-if="c.is_dockable">
                    <span class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                      <Icon name="link" /> 可对接
                    </span>
                    <p class="text-xs text-slate-400 mt-0.5 tabular-nums">¥{{ c.price || '0.00' }}</p>
                  </template>
                  <span v-else class="text-xs text-slate-400">未开放</span>
                </td>
                <td>{{ c.delay_seconds || 0 }}s</td>
                <td>
                  <button
                    class="badge transition-colors"
                    :class="c.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
                    @click="toggleEnabled(c)"
                  >
                    <span class="w-1.5 h-1.5 rounded-full" :class="c.enabled ? 'bg-emerald-500' : 'bg-slate-400'" />
                    {{ c.enabled ? '启用' : '停用' }}
                  </button>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTimeFull(c.created_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(c)">
                      <Icon name="edit" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="confirmDelete(c)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!filtered.length" message="还没有卡券，点击右上角「新增卡券」开始" icon="cards" />
      </template>
    </div>

    <!-- 卡密生成/消费记录 -->
    <div class="card overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
        <h3 class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Icon name="key" class="text-brand-500" /> 卡密生成/消费记录
          <span class="badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300">共 {{ codeLogTab === 'gen' ? codeLogTotal : consumeLogTotal }} 条</span>
        </h3>
        <div class="flex items-center gap-2 flex-wrap">
          <div class="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button
              class="px-3 py-1.5 text-sm font-medium transition-colors"
              :class="codeLogTab === 'gen' ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'"
              @click="switchCodeLogTab('gen')"
            >生成记录</button>
            <button
              class="px-3 py-1.5 text-sm font-medium transition-colors border-l border-slate-200 dark:border-slate-700"
              :class="codeLogTab === 'consume' ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'"
              @click="switchCodeLogTab('consume')"
            >消费记录</button>
          </div>
          <button class="btn-secondary !px-2.5 !py-1.5" title="测试生成卡密 (与真实发货一致, 不真实发货)" @click="openDeliverTestDoc">
            <Icon name="sparkles" /> 卡密发货测试
          </button>
          <button class="btn-secondary !px-2.5 !py-1.5" title="外部消费 API 调用流程说明" @click="consumeDocOpen = true">
            <Icon name="info" /> 消费流程
          </button>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
            <input v-model="codeLogKeyword" class="input pl-9 !w-64" placeholder="卡密 / 订单号 / 买家 / 商品 / 卡券" @keyup.enter="resetCodeLogsAndReload" />
          </div>
          <button class="btn-secondary !px-2.5 !py-1.5" :disabled="codeLogsLoading" @click="reloadCodeLogs">
            <Icon name="refresh" :class="codeLogsLoading ? 'animate-spin' : ''" />
          </button>
        </div>
      </div>
      <div v-if="codeLogsLoading" class="p-8 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <!-- 生成记录 -->
        <template v-if="codeLogTab === 'gen'">
        <div class="table-wrap max-h-96 overflow-y-auto">
          <table class="table">
            <thead>
              <tr>
                <th>生成时间</th>
                <th>卡密</th>
                <th>状态</th>
                <th>卡券</th>
                <th>账号</th>
                <th>商品</th>
                <th>订单号</th>
                <th>买家</th>
                <th>核销时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in codeLogs" :key="l.id">
                <td class="text-slate-500 whitespace-nowrap">{{ formatTimeFull(l.created_at) }}</td>
                <td>
                  <span class="font-mono font-semibold tracking-wider text-slate-800 dark:text-white">{{ l.code }}</span>
                  <span v-if="l.source === 'test'" class="badge ml-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">测试</span>
                </td>
                <td>
                  <span class="badge" :class="l.status === 'used' ? 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'">
                    {{ l.status === 'used' ? '已核销' : '未核销' }}
                  </span>
                </td>
                <td class="text-slate-500">{{ l.card_name || '—' }}</td>
                <td class="font-mono text-slate-500 max-w-[140px]"><p class="truncate" :title="l.cookie_id">{{ l.cookie_id || '—' }}</p></td>
                <td class="font-mono text-slate-500 max-w-[140px]"><p class="truncate" :title="l.item_id">{{ l.item_id || '—' }}</p></td>
                <td class="font-mono text-slate-500 max-w-[160px]"><p class="truncate" :title="l.order_id">{{ l.order_id || '—' }}</p></td>
                <td class="font-mono text-slate-500">{{ l.buyer_id || '—' }}</td>
                <td class="text-slate-500 whitespace-nowrap">{{ formatTimeFull(l.used_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="复制卡密" @click="copyCodeLog(l.code)">
                      <Icon name="copy" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!codeLogs.length" message="暂无卡密生成记录；卡密型卡券发货时自动生成并留档" icon="key" />
        </template>
        <!-- 消费记录 -->
        <template v-else>
        <div class="table-wrap max-h-96 overflow-y-auto">
          <table class="table">
            <thead>
              <tr>
                <th>消费时间</th>
                <th>卡密</th>
                <th>结果</th>
                <th>说明</th>
                <th>卡券</th>
                <th>订单号</th>
                <th>买家</th>
                <th>消费 Key</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in consumeLogs" :key="l.id">
                <td class="text-slate-500 whitespace-nowrap">{{ formatTimeFull(l.created_at) }}</td>
                <td>
                  <span class="font-mono font-semibold tracking-wider text-slate-800 dark:text-white">{{ l.code }}</span>
                  <span v-if="l.source === 'test'" class="badge ml-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">测试</span>
                </td>
                <td>
                  <span class="badge" :class="l.result === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'">
                    {{ l.result === 'success' ? '验证成功' : '验证失败' }}
                  </span>
                </td>
                <td class="text-slate-500 max-w-[220px]"><p class="truncate" :title="l.message">{{ l.message || '—' }}</p></td>
                <td class="text-slate-500">{{ l.card_name || '—' }}</td>
                <td class="font-mono text-slate-500 max-w-[160px]"><p class="truncate" :title="l.order_id">{{ l.order_id || '—' }}</p></td>
                <td class="font-mono text-slate-500">{{ l.buyer_id || '—' }}</td>
                <td class="text-slate-500 max-w-[140px]"><p class="truncate" :title="l.api_key_name">{{ l.api_key_name || '—' }}</p></td>
                <td class="font-mono text-slate-500">{{ l.ip || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!consumeLogs.length" message="暂无卡密消费记录；业务方携 API Key 调用核销接口后自动留痕（成功/失败均记录），点右上角「消费流程」查看调用方式" icon="key" />
        </template>
        <div v-if="codeLogActiveTotal > codeLogPageSize" class="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
          <p class="text-slate-500">共 {{ codeLogActiveTotal }} 条，第 {{ codeLogActivePage }} / {{ codeLogActiveTotalPages }} 页</p>
          <div class="flex items-center gap-1">
            <button class="btn-secondary !px-2.5 !py-1.5" :disabled="codeLogActivePage <= 1" @click="goCodeLogPage(codeLogActivePage - 1)">
              <Icon name="chevronRight" class="rotate-180" />
            </button>
            <button class="btn-secondary !px-2.5 !py-1.5" :disabled="codeLogActivePage >= codeLogActiveTotalPages" @click="goCodeLogPage(codeLogActivePage + 1)">
              <Icon name="chevronRight" />
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- 卡密发货测试/流程说明弹窗 (含交互式测试器) -->
    <ModalBase v-model="deliverTestDocOpen" title="卡密发货测试 · 测试生成流程" size="lg">
      <div class="space-y-4">
        <div>
          <label class="label">测试流程（与真实发货完全一致, 但不会真实发货）</label>
          <ol class="list-decimal list-inside space-y-1.5 text-slate-600 dark:text-slate-300">
            <li>选择一张卡密型（生成型）卡券 → 调用下方测试接口</li>
            <li>接口走与真实发货完全相同的生成链路：按卡券配置的长度/英文/数字/大小写随机生成 → 文案模板 {code} 渲染 → 启用变量替换（模拟上下文 = 发货规则绑定商品的真实数据）</li>
            <li>返回模拟生成的卡密与发货文案，可直接预览买家将收到的加群验证码样式；卡密同时落库「生成记录」并带<span class="font-medium text-amber-600 dark:text-amber-400">「测试」标签</span>（订单号 TEST- 前缀，状态=未核销）</li>
            <li>测试卡密可用「消费 API」<span class="font-mono">/api/verify-codes/verify</span> 真实核销验证 — 与正常消费完全同一链路，消费记录同样带「测试」标签，成功/失败均有详细日志（原因/消费方 Key/IP/时间）</li>
            <li>外部系统/模拟器可直接携 API Key（<span class="font-mono">Bearer xyk_</span>）调用本接口，无需登录；card_id 可省略（自动选第一张卡密型卡券），每次调用均留痕到「API Key管理」调用日志</li>
            <li>不会真实发货的部分：不发送买家消息 / 不写发货记录 / 不改订单状态 / 不加规则发货计数；测试卡密与真实卡密同库唯一，核销后同样失效，可放心反复测试</li>
          </ol>
        </div>
        <div>
          <label class="label">请求方式与参数（登录令牌 或 Bearer apikey 均可）</label>
          <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">POST /api/cards/deliver-test
Content-Type: application/json

{ "card_id": 1, "count": 1 }        ← card_id 可选 (缺省自动选第一张卡密型卡券); count 1-10 默认 1

鉴权 (二选一, 自动识别):
  Authorization: Bearer &lt;登录令牌&gt;    ← 后台登录态 / 在线测试器
  Authorization: Bearer xyk_xxxxxxxx  ← 「API Key管理」生成的 Key, 供外部系统/模拟器调用 (受限速+留痕)</pre>
        </div>
        <div>
          <label class="label">响应示例</label>
          <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">200 { "success": true, "data": {
  "card_id": 1, "card_name": "会员季度卡", "count": 1,
  "order_id": "TEST-1769999999999", "persisted_count": 1,
  "items": [ { "code": "aB3x9K2m", "text": "你的验证码为: aB3x9K2m, 请复制后加群验证!", "preview": "[卡密] aB3x9K2m", "persisted": true } ],
  "config": { "length": 8, "letters": true, "digits": true, "case": "mixed", "template": "..." },
  "note": "测试生成: ... 已入库 (带「测试」标签), 可用消费 API 真实核销验证" } }</pre>
          <p class="mt-1.5 text-slate-500 dark:text-slate-400">拿到 <span class="font-mono">items[].code</span> 后即可按右侧「消费流程」用 API Key 调核销接口做全链路验证；在「生成记录/消费记录」中按订单号 <span class="font-mono">TEST-...</span> 或「测试」标签即可筛出本批测试数据。</p>
        </div>
        <div>
          <label class="label">curl 调用示例（外部系统/模拟器用 apikey）</label>
          <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">curl -X POST 'https://你的域名/api/cards/deliver-test' \
  -H 'Authorization: Bearer xyk_xxxxxxxx' \
  -H 'Content-Type: application/json' \
  -d '{"count":1}'</pre>
        </div>
        <div class="border-t border-slate-100 dark:border-slate-700 pt-4">
          <label class="label">在线测试（选卡密型卡券，立即生成预览）</label>
          <div class="flex items-center gap-2 flex-wrap">
            <select v-model="deliverTestCardId" class="input !w-auto min-w-[200px]">
              <option :value="0" disabled>选择卡密型卡券</option>
              <option v-for="c in codeCards" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <input v-model.number="deliverTestCount" type="number" min="1" max="10" class="input !w-20" title="生成份数 (1-10)" />
            <button class="btn-primary !px-3 !py-1.5" :disabled="deliverTestRunning || !deliverTestCardId" @click="runDeliverTest">
              <Icon name="sparkles" :class="deliverTestRunning ? 'animate-spin' : ''" /> {{ deliverTestRunning ? '生成中...' : '生成测试卡密' }}
            </button>
          </div>
          <p v-if="codeCards.length === 0" class="mt-2 text-slate-400">还没有卡密型卡券，先新增一个「卡密」类型卡券</p>
          <div v-if="deliverTestResult" class="mt-3 space-y-2">
            <div class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
              <p class="font-medium text-slate-700 dark:text-slate-200">卡券「{{ deliverTestResult.card_name }}」× {{ deliverTestResult.count }} 份</p>
              <p class="mt-0.5 text-slate-500 dark:text-slate-400">批次订单号: <span class="font-mono">{{ deliverTestResult.order_id }}</span>（已入库 {{ deliverTestResult.persisted_count }} 份，可在「生成记录」中搜索）</p>
              <p class="mt-0.5 text-slate-400">{{ deliverTestResult.note }}</p>
            </div>
            <div v-for="(it, i) in deliverTestResult.items" :key="i" class="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-mono font-semibold tracking-wider text-slate-800 dark:text-white">{{ it.code }}</span>
                <button class="btn-ghost !px-2 !py-1" title="复制卡密" @click="copyCodeLog(it.code)"><Icon name="copy" /></button>
                <span class="badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300">第 {{ i + 1 }} 份</span>
                <span v-if="it.persisted" class="badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">测试·已入库</span>
                <span v-else class="badge bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">入库失败</span>
              </div>
              <p class="mt-1.5 text-slate-500 dark:text-slate-400 whitespace-pre-wrap">发货文案: {{ it.text }}</p>
            </div>
          </div>
        </div>
      </div>
    </ModalBase>

    <!-- 消费流程/API 文档弹窗 -->
    <ModalBase v-model="consumeDocOpen" title="卡密消费 API · 外部调用流程" size="lg">
      <div class="space-y-4">
        <div>
          <label class="label">消费流程（自动发货生成的卡密如何被外部系统核销）</label>
          <ol class="list-decimal list-inside space-y-1.5 text-slate-600 dark:text-slate-300">
            <li>买家拍下付款 → 自动发货命中卡密型卡券 → 系统生成唯一卡密发给买家，同时在「生成记录」留档（状态=未核销）</li>
            <li>买家把卡密提供给你方的业务系统（发卡平台/充值站/验证系统等）</li>
            <li>业务方在「API Key管理」生成专用 Key（<span class="font-mono">xyk_</span> 前缀），携 Key 调用下方核销接口</li>
            <li>接口原子核销（未核销 → 已核销，并发重复请求只成功一次），返回卡密对应的订单/商品/买家回执</li>
            <li>无论成功/失败，本次请求都会在「消费记录」留痕（消费方 Key/IP/结果/说明），可直接核对</li>
          </ol>
        </div>
        <div>
          <label class="label">请求方式与参数</label>
          <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">POST /api/verify-codes/verify
Authorization: Bearer &lt;API Key&gt;      ← 「API Key管理」生成的业务方 Key (xyk_ 前缀)
Content-Type: application/json

{ "code": "A3b9xK" }                  ← 买家收到的卡密 (兼容字段名: code / card / key)</pre>
        </div>
        <div>
          <label class="label">响应示例（统一 envelope，业务结果一律 HTTP 200）</label>
          <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">验证成功 → 200 { "success": true, "msg": "验证成功", "data": {
  "code": "A3b9xK", "card_name": "会员季度卡", "order_id": "5127...",
  "item_id": "1090...", "buyer_id": "2088...", "status": "used",
  "used_at": "2026-11-02 12:00:00", "verified_by": "发卡平台A" } }

验证失败 → 200 { "success": false, "msg": "验证失败: 卡密不存在/已被使用 (使用时间 ...)/格式错误", "data": { ...原卡密信息 } }
鉴权/停用/过期/限速 → 401/403/429 { "success": false, "msg": "原因", "data": {} }</pre>
        </div>
        <div>
          <label class="label">curl 调用示例</label>
          <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">curl -X POST 'https://你的域名/api/verify-codes/verify' \
  -H 'Authorization: Bearer xyk_xxxxxxxx' \
  -H 'Content-Type: application/json' \
  -d '{"code":"A3b9xK"}'</pre>
        </div>
        <p class="text-slate-500 dark:text-slate-400">验证成功后卡密立即失效（生成记录中状态变为已核销）；每个 Key 独立限速（默认 30 次/60 秒，超限 429）+ 可配置有效期（到期后 403）。Key 在「管理员 → API Key管理」页生成与维护。</p>
      </div>
    </ModalBase>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑卡券' : '新增卡券'" size="lg">
      <div class="space-y-4">
        <div>
          <label class="label">名称 <span class="text-red-500">*</span></label>
          <input v-model="form.name" class="input" placeholder="如 30元话费卡" />
        </div>
        <div>
          <label class="label">类型 <span class="text-red-500">*</span></label>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="t in TYPE_OPTIONS"
              :key="t.value"
              type="button"
              class="rounded-lg border px-3 py-2 text-sm transition-colors"
              :class="form.type === t.value
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'"
              @click="form.type = t.value"
            >
              <Icon :name="t.icon" class="block mx-auto mb-1" />
              {{ t.label }}
            </button>
          </div>
        </div>

        <!-- Type-specific content -->
        <div v-if="form.type === 'api'" class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="sm:col-span-2">
              <label class="label">接口地址 <span class="text-red-500">*</span></label>
              <input v-model="form.api_url" class="input" placeholder="https://你的-cards-hub-域名/api/issue" />
            </div>
            <div>
              <label class="label">请求方式</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="m in ['GET', 'POST']"
                  :key="m"
                  type="button"
                  class="rounded-lg border px-2 py-2 transition-colors"
                  :class="form.api_method === m
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'"
                  @click="form.api_method = m"
                >
                  {{ m }}
                </button>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="label">鉴权密钥 (apikey)</label>
              <input v-model="form.api_key" class="input font-mono" placeholder="ak-... / sk-..." />
              <p class="text-slate-400 mt-1">发货时 {apikey} 替换为这里填写的密钥</p>
            </div>
            <div>
              <label class="label">返回数据格式 (data_path)</label>
              <input v-model="form.data_path" class="input font-mono" placeholder="data.url" />
              <p class="text-slate-400 mt-1">从响应 JSON 提取分享链接的字段路径, 如 data.url</p>
            </div>
          </div>
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <p class="font-medium text-slate-700 dark:text-slate-200">请求参数勾选 (发货时代码自动拼装进请求)</p>
            <div class="flex flex-wrap gap-x-6 gap-y-2">
              <label class="flex items-center gap-2 cursor-pointer">
                <input v-model="form.use_auth" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
                <span class="text-slate-700 dark:text-slate-200">鉴权头 Authorization: Bearer {apikey}</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input v-model="form.use_item_id" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
                <span class="text-slate-700 dark:text-slate-200">商品ID item_id</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input v-model="form.use_title" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
                <span class="text-slate-700 dark:text-slate-200">商品名称 title</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input v-model="form.use_price" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
                <span class="text-slate-700 dark:text-slate-200">价格 price</span>
              </label>
            </div>
            <p class="text-slate-400">勾选后以 POST JSON 拼装请求体 (item_id/title/price 发货时替换为实际商品值; 资源交付平台按 item_id 匹配绑定资源, 对接 autoship/cards-hub 必勾); 不勾选则发 GET 无体</p>
          </div>
          <div class="flex flex-wrap gap-2 items-center">
            <button type="button" class="btn-secondary !py-1.5 !px-3" @click="fillCardsHubTemplate">填入 cards-hub 模板</button>
            <button type="button" class="btn-ghost !py-1.5 !px-3" :disabled="apiTesting" @click="testApiConfig">测试请求</button>
            <span v-if="apiTestResult" class="text-slate-500 break-all">{{ apiTestResult }}</span>
          </div>
          <p class="text-slate-400">测试请求按真实发货模拟: 编辑已有卡券时自动取其发货规则绑定商品的 item_id / title / price 拼装请求 (新卡券取最新同步商品); 上游接口返回的错误原因会原样显示, 便于排查地址/密钥/资源绑定问题 (每点一次测试, 资源交付平台会真实发一张卡, 可在其后台作废)</p>
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <p class="text-slate-600 dark:text-slate-300 font-medium">对接 cloudflare-cards-hub（资源交付系统）</p>
            <p class="text-slate-500 mt-1">填入模板后改 3 处：① 接口地址换你的 cards-hub 域名 ② 鉴权密钥填「APIKEY 管理」里的 ak- 密钥 ③ 资源 ID。发货时自动调 /api/issue 生成一单一密的加密提取页链接发给买家，买家打开即自动核销下载（全程看不到真实文件路径）。</p>
          </div>
          <div>
            <label class="label">发货文案 (可选)</label>
            <textarea id="card-input-text_content" v-model="form.text_content" rows="3" class="input" placeholder="留空发送接口返回原文；可写 恭喜购买{title}！您的资源链接：{shareURL} 请查收" />
            <VarHints @insert="(v: string) => insertVar('text_content', v)" />
          </div>
        </div>
        <div v-else-if="form.type === 'text'">
          <label class="label">文本内容</label>
          <textarea id="card-input-text_content" v-model="form.text_content" rows="4" class="input" placeholder="直接回复的文本内容" />
          <VarHints @insert="(v: string) => insertVar('text_content', v)" />
        </div>
        <div v-else-if="form.type === 'code'" class="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="label">卡密长度</label>
              <input v-model.number="form.code_length" type="number" min="4" max="32" class="input" />
              <p class="text-xs text-slate-400 mt-1">生成的卡密字符数，默认 6 (4-32)</p>
            </div>
            <div>
              <label class="label">字符构成</label>
              <div class="flex items-center gap-4 h-[38px]">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="form.code_letters" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
                  <span class="text-slate-700 dark:text-slate-200">英文</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="form.code_digits" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
                  <span class="text-slate-700 dark:text-slate-200">数字</span>
                </label>
              </div>
              <p class="text-xs text-slate-400 mt-1">默认英文+数字都勾选，至少保留一项</p>
            </div>
          </div>
          <div v-if="form.code_letters">
            <label class="label">英文字母大小写</label>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="c in CODE_CASE_OPTIONS"
                :key="c.value"
                type="button"
                class="rounded-lg border px-2 py-2 transition-colors"
                :class="form.code_case === c.value
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'"
                @click="form.code_case = c.value"
              >
                {{ c.label }}
              </button>
            </div>
          </div>
          <div>
            <label class="label">卡密文案</label>
            <input id="card-input-code_template" v-model="form.code_template" class="input" placeholder="你的验证码为: {code}, 请复制后加群验证!" />
            <div class="flex items-center gap-2 mt-1 flex-wrap">
              <p class="text-xs text-slate-400">发货时发送给买家的消息，{code} 会替换为本次生成的随机卡密</p>
              <VarHints inline @insert="(v: string) => insertVar('code_template', v)" />
            </div>
          </div>
        </div>
        <div v-else-if="form.type === 'image'">
          <label class="label">图片 URL</label>
          <input v-model="form.image_url" class="input" placeholder="https://.../card.png" />
          <div class="mt-2">
            <label class="label">随图文字 (可选)</label>
            <textarea id="card-input-text_content" v-model="form.text_content" rows="2" class="input" placeholder="随图片一起发送的文本" />
            <VarHints @insert="(v: string) => insertVar('text_content', v)" />
          </div>
        </div>

        <div>
          <label class="label">消息回复</label>
          <textarea id="card-input-description" v-model="form.description" rows="2" class="input" placeholder="可选，如 感谢购买，请加群 xxx 获取售后" />
          <p class="text-xs text-slate-400 mt-1">发货时随卡券内容一起发送给买家；留空则发货时不同时发送消息</p>
          <VarHints @insert="(v: string) => insertVar('description', v)" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">延时发货 (秒)</label>
            <input v-model.number="form.delay_seconds" type="number" min="0" class="input" />
          </div>
          <div class="flex items-end pb-1">
            <label class="flex items-center gap-3 cursor-pointer select-none">
              <ToggleSwitch v-model="form.enabled" />
              <span class="text-slate-700 dark:text-slate-200">{{ form.enabled ? '启用中' : '已停用' }}</span>
            </label>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-100 dark:border-slate-700 space-y-3">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.is_multi_spec" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
            <span class="text-sm text-slate-700 dark:text-slate-200">多规格卡券</span>
          </label>
          <div v-if="form.is_multi_spec" class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">规格名称</label>
              <input v-model="form.spec_name" class="input" placeholder="如 面值" />
            </div>
            <div>
              <label class="label">规格值</label>
              <input v-model="form.spec_value" class="input" placeholder="如 30元" />
            </div>
          </div>
        </div>

        <!-- 分销对接设置 -->
        <div class="pt-3 border-t border-slate-100 dark:border-slate-700 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Icon name="link" class="text-brand-500" />
              <h4 class="text-sm font-semibold text-slate-900 dark:text-white">分销对接设置</h4>
            </div>
            <label class="flex items-center gap-2 cursor-pointer text-xs text-slate-500 dark:text-slate-400">
              <input v-model="form.is_dockable" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
              允许其他分销商对接
            </label>
          </div>
          <div v-if="form.is_dockable" class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">对接价 (元)</label>
              <input v-model="form.price" type="number" min="0" step="0.01" class="input" placeholder="0.00" />
            </div>
            <div>
              <label class="label">最低售价 (元)</label>
              <input v-model="form.min_price" type="number" min="0" step="0.01" class="input" placeholder="可选" />
            </div>
            <div>
              <label class="label">手续费承担方</label>
              <select v-model="form.fee_payer" class="input">
                <option value="distributor">货主承担</option>
                <option value="dealer">分销商承担</option>
              </select>
            </div>
            <div>
              <label class="label">对接可见性</label>
              <select v-model="form.dock_visibility" class="input">
                <option value="public">公开（所有分销商可见）</option>
                <option value="dealer_only">仅指定分销商</option>
              </select>
            </div>
          </div>
          <p v-else class="text-xs text-slate-400">开启后，该卡券会出现在货源广场供其他分销商对接。</p>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="modalOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving" @click="saveCard">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </template>
    </ModalBase>

    <!-- 发货变量配置弹窗 (右上角入口: CRUD/多选启用, 启用后出现在各输入框可用变量列表) -->
    <VariableConfigModal v-model="varModalOpen" />

    <!-- Delete confirm modal -->
    <ModalBase :model-value="!!deleteTarget" title="删除卡券" size="sm" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-sm text-slate-500 mt-2">
          确认删除卡券 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.name }}</span>？
          关联的自动发货规则将保留但不再生效。
        </p>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="deleteTarget = null">取消</button>
        <button class="btn-danger flex-1" :disabled="deleting" @click="doDelete">
          <Icon name="refresh" v-if="deleting" class="animate-spin" />
          确认删除
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getCards, createCard, updateCard, deleteCard, deliverTestCard } from '~/api/cards'
import type { Card } from '~/api/cards'
import type { DeliverTestResult } from '~/api/cards'
import { getCardCodeLogs } from '~/api/card-codes'
import type { CardCodeLogRow } from '~/api/card-codes'
import { getCardConsumeLogs } from '~/api/card-consumes'
import type { CardConsumeLogRow } from '~/api/card-consumes'

definePageMeta({ layout: 'default' })

const toast = useToast()

const TYPE_OPTIONS = [
  { value: 'api',  label: 'API',  icon: 'server',   cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  { value: 'text',  label: '文本',  icon: 'message',  cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { value: 'code',  label: '卡密',  icon: 'key',      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'image', label: '图片',  icon: 'package',  cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
] as const

const CODE_CASE_OPTIONS = [
  { value: 'mixed', label: '大小写' },
  { value: 'lower', label: '小写' },
  { value: 'upper', label: '大写' },
]

const DEFAULT_CODE_TEMPLATE = '你的验证码为: {code}, 请复制后加群验证!'

function typeMeta(t: string) {
  return TYPE_OPTIONS.find((o) => o.value === t) || TYPE_OPTIONS[1]
}

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const cards = ref<Card[]>([])
const keyword = ref('')
const filterType = ref('')
const modalOpen = ref(false)
const editing = ref(false)
const deleteTarget = ref<Card | null>(null)
const varModalOpen = ref(false)

const form = ref<any>({
  id: null,
  name: '',
  type: 'text',
  api_url: '',
  api_method: 'POST',
  api_key: '',
  use_auth: true,
  use_item_id: true,
  use_title: true,
  use_price: true,
  data_path: 'data.url',
  text_content: '',
  image_url: '',
  code_length: 6,
  code_letters: true,
  code_digits: true,
  code_case: 'mixed',
  code_template: DEFAULT_CODE_TEMPLATE,
  description: '',
  enabled: true,
  delay_seconds: 0,
  is_multi_spec: false,
  spec_name: '',
  spec_value: '',
  // 分销对接设置
  price: '0.00',
  is_dockable: false,
  fee_payer: 'distributor',
  min_price: '',
  dock_visibility: 'public',
})

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return cards.value.filter((c) => {
    if (filterType.value && c.type !== filterType.value) return false
    if (!k) return true
    return c.name.toLowerCase().includes(k) || (c.description || '').toLowerCase().includes(k)
  })
})

const apiTesting = ref(false)
const apiTestResult = ref('')

/** 一键填入 cards-hub (资源交付系统) 加密 URL 发货模板, 用户只需改域名/密钥/资源 ID 三处 */
function fillCardsHubTemplate() {
  form.value.type = 'api'
  form.value.api_url = 'https://你的-cards-hub-域名/api/issue'
  form.value.api_method = 'POST'
  form.value.api_key = 'ak-你的APIKEY'
  form.value.use_auth = true
  form.value.use_item_id = true
  form.value.use_title = true
  form.value.use_price = true
  form.value.data_path = 'data.url'
}

/** 表单 → api_config 对象 (勾选鉴权头/商品ID/商品名称/价格 → 代码拼装, 存储结构不变向后兼容)。网络传输一律用对象, 仅存库时在调用点 JSON.stringify */
function buildApiConfigObject(): Record<string, any> {
  const conf: any = { url: form.value.api_url.trim(), method: form.value.api_method }
  if (form.value.use_auth) {
    if (form.value.api_key.trim()) conf.api_key = form.value.api_key.trim()
    conf.headers = { 'content-type': 'application/json', Authorization: 'Bearer {apikey}' }
  }
  const body: any = {}
  if (form.value.use_item_id) body.item_id = '{item_id}'
  if (form.value.use_title) body.title = '{title}'
  if (form.value.use_price) body.price = '{price}'
  if (Object.keys(body).length) conf.body = body
  conf.data_path = form.value.data_path.trim() || 'data'
  return conf
}

/** api_config JSON → 表单回填 (兼容旧手写 JSON: Authorization 真实密钥/任意 body) */
function parseApiConfig(raw: string): void {
  let conf: any = {}
  try { conf = JSON.parse(raw || '{}') } catch { conf = {} }
  form.value.api_url = String(conf.url || '')
  form.value.api_method = String(conf.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
  const auth = String(conf.headers?.Authorization || conf.headers?.authorization || '')
  const bearerKey = auth.replace(/^Bearer\s+/i, '')
  form.value.use_auth = !!auth
  form.value.api_key = String(conf.api_key || (bearerKey && bearerKey !== '{apikey}' ? bearerKey : ''))
  form.value.use_item_id = conf.body != null && typeof conf.body === 'object' && 'item_id' in conf.body
  form.value.use_title = conf.body != null && typeof conf.body === 'object' && 'title' in conf.body
  form.value.use_price = conf.body != null && typeof conf.body === 'object' && 'price' in conf.body
  form.value.data_path = String(conf.data_path || 'data')
}

/** 点击变量徽章插入到指定输入框光标处 */
function insertVar(field: 'text_content' | 'code_template' | 'description', token: string) {
  const el = document.getElementById(`card-input-${field}`) as HTMLTextAreaElement | HTMLInputElement | null
  const cur = String(form.value[field] || '')
  if (el && typeof el.selectionStart === 'number') {
    const s = el.selectionStart
    const e = el.selectionEnd ?? s
    form.value[field] = cur.slice(0, s) + token + cur.slice(e)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = s + token.length
    })
  } else {
    form.value[field] = cur + token
  }
}

/** 服务端代发一次请求并按 data_path 提取 (浏览器直连外部接口有 CORS 限制) */
async function testApiConfig() {
  if (apiTesting.value) return
  if (!form.value.api_url.trim()) {
    toast.error('请填写接口地址')
    return
  }
  apiTesting.value = true
  apiTestResult.value = ''
  try {
    const r: any = await $fetch('/api/cards/test-api', {
      method: 'POST',
      body: { api_config: buildApiConfigObject(), card_id: form.value.id || null },
    })
    const d = r?.data || {}
    apiTestResult.value = d.ok
      ? `✓ HTTP ${d.status} 提取成功: ${String(d.text || '').slice(0, 120)}`
      : `✗ ${d.message || r?.message || '测试未成功'}${d.status ? ` (HTTP ${d.status})` : ''}`
    if (d.ok) toast.success('API 配置测试通过')
    else toast.error(d.message || r?.message || '测试未成功')
  } catch (e: any) {
    apiTestResult.value = `✗ ${e?.message || '请求失败'}`
    toast.error(e?.message || '测试请求失败')
  } finally {
    apiTesting.value = false
  }
}

async function reload() {
  loading.value = true
  try {
    cards.value = await getCards()
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  form.value = {
    id: null, name: '', type: 'text',
    api_url: '', api_method: 'POST', api_key: '', use_auth: true, use_item_id: true, use_title: true, use_price: true, data_path: 'data.url',
    text_content: '', image_url: '',
    code_length: 6, code_letters: true, code_digits: true, code_case: 'mixed', code_template: DEFAULT_CODE_TEMPLATE,
    description: '', enabled: true, delay_seconds: 0,
    is_multi_spec: false, spec_name: '', spec_value: '',
    price: '0.00', is_dockable: false, fee_payer: 'distributor',
    min_price: '', dock_visibility: 'public',
  }
  modalOpen.value = true
}

function openEdit(c: Card) {
  editing.value = true
  form.value = {
    id: c.id, name: c.name, type: c.type,
    api_url: '', api_method: 'POST', api_key: '', use_auth: false, use_item_id: false, use_title: false, use_price: false, data_path: 'data',
    text_content: c.text_content || '',
    image_url: c.image_url || '',
    code_length: c.code_length || 6,
    code_letters: Number(c.code_letters ?? 1) === 1,
    code_digits: Number(c.code_digits ?? 1) === 1,
    code_case: c.code_case || 'mixed',
    code_template: c.code_template || DEFAULT_CODE_TEMPLATE,
    description: c.description || '',
    enabled: !!c.enabled,
    delay_seconds: c.delay_seconds || 0,
    is_multi_spec: !!c.is_multi_spec,
    spec_name: c.spec_name || '',
    spec_value: c.spec_value || '',
    price: c.price || '0.00',
    is_dockable: !!c.is_dockable,
    fee_payer: c.fee_payer || 'distributor',
    min_price: c.min_price || '',
    dock_visibility: c.dock_visibility || 'public',
  }
  if (c.type === 'api') parseApiConfig(c.api_config || '')
  modalOpen.value = true
}

async function saveCard() {
  if (!form.value.name.trim()) {
    toast.error('请填写卡券名称')
    return
  }
  saving.value = true
  try {
    const payload: any = {
      name: form.value.name,
      type: form.value.type,
      description: form.value.description,
      enabled: form.value.enabled,
      delay_seconds: Number(form.value.delay_seconds) || 0,
      is_multi_spec: form.value.is_multi_spec,
      spec_name: form.value.spec_name,
      spec_value: form.value.spec_value,
      // 分销对接设置
      price: form.value.price || '0.00',
      is_dockable: form.value.is_dockable,
      fee_payer: form.value.fee_payer,
      min_price: form.value.min_price || null,
      dock_visibility: form.value.dock_visibility,
    }
    if (form.value.type === 'api') {
      if (!form.value.api_url.trim()) {
        toast.error('请填写 API 接口地址')
        return
      }
      payload.api_config = JSON.stringify(buildApiConfigObject())
    }
    if (form.value.type === 'text' || form.value.type === 'image' || form.value.type === 'api') {
      payload.text_content = form.value.text_content
    }
    if (form.value.type === 'image') payload.image_url = form.value.image_url
    if (form.value.type === 'code') {
      if (!form.value.code_letters && !form.value.code_digits) {
        toast.error('卡密字符构成至少勾选 英文/数字 一项')
        return
      }
      payload.code_length = Math.min(32, Math.max(4, Number(form.value.code_length) || 6))
      payload.code_letters = form.value.code_letters
      payload.code_digits = form.value.code_digits
      payload.code_case = form.value.code_case
      payload.code_template = (form.value.code_template || '').trim()
    }

    if (editing.value) {
      await updateCard(form.value.id, payload)
      toast.success('卡券已更新')
    } else {
      await createCard(payload)
      toast.success('卡券已创建')
    }
    modalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(c: Card) {
  try {
    await updateCard(c.id, { enabled: !c.enabled })
    c.enabled = c.enabled ? 0 : 1
    toast.success(c.enabled ? '已启用' : '已停用')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

function confirmDelete(c: Card) {
  deleteTarget.value = c
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteCard(deleteTarget.value.id)
    toast.success('卡券已删除')
    deleteTarget.value = null
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

const codeLogs = ref<CardCodeLogRow[]>([])
const codeLogTotal = ref(0)
const codeLogPage = ref(1)
const codeLogPageSize = ref(20)
const codeLogKeyword = ref('')
const codeLogsLoading = ref(false)
const codeLogTotalPages = computed(() => Math.max(1, Math.ceil(codeLogTotal.value / codeLogPageSize.value)))
// 生成/消费双 Tab + 消费记录状态 (共用搜索词/分页尺寸/加载态)
const codeLogTab = ref<'gen' | 'consume'>('gen')
const consumeLogs = ref<CardConsumeLogRow[]>([])
const consumeLogTotal = ref(0)
const consumeLogPage = ref(1)
const consumeLogTotalPages = computed(() => Math.max(1, Math.ceil(consumeLogTotal.value / codeLogPageSize.value)))
const consumeDocOpen = ref(false)
// 卡密发货测试弹窗 + 在线测试器状态
const deliverTestDocOpen = ref(false)
const deliverTestCardId = ref(0)
const deliverTestCount = ref(1)
const deliverTestRunning = ref(false)
const deliverTestResult = ref<DeliverTestResult | null>(null)
const codeCards = computed(() => cards.value.filter((c) => c.type === 'code'))

function openDeliverTestDoc() {
  deliverTestDocOpen.value = true
  if (!deliverTestCardId.value && codeCards.value.length) deliverTestCardId.value = codeCards.value[0].id
}

async function runDeliverTest() {
  if (!deliverTestCardId.value) {
    toast.error('请先选择卡密型卡券')
    return
  }
  deliverTestRunning.value = true
  try {
    deliverTestResult.value = await deliverTestCard({
      card_id: deliverTestCardId.value,
      count: Math.min(10, Math.max(1, Number(deliverTestCount.value) || 1)),
    })
  } catch (e: any) {
    toast.error(e.message || '发货测试失败')
  } finally {
    deliverTestRunning.value = false
  }
}
const codeLogActiveTotal = computed(() => (codeLogTab.value === 'gen' ? codeLogTotal.value : consumeLogTotal.value))
const codeLogActivePage = computed(() => (codeLogTab.value === 'gen' ? codeLogPage.value : consumeLogPage.value))
const codeLogActiveTotalPages = computed(() => (codeLogTab.value === 'gen' ? codeLogTotalPages.value : consumeLogTotalPages.value))

function switchCodeLogTab(tab: 'gen' | 'consume') {
  if (codeLogTab.value === tab) return
  codeLogTab.value = tab
  codeLogPage.value = 1
  consumeLogPage.value = 1
  reloadCodeLogs()
}

async function reloadCodeLogs() {
  codeLogsLoading.value = true
  try {
    if (codeLogTab.value === 'gen') {
      const res = await getCardCodeLogs({
        page: codeLogPage.value,
        pageSize: codeLogPageSize.value,
        keyword: codeLogKeyword.value.trim() || undefined,
      })
      codeLogs.value = res.data
      codeLogTotal.value = res.total
    } else {
      const res = await getCardConsumeLogs({
        page: consumeLogPage.value,
        pageSize: codeLogPageSize.value,
        keyword: codeLogKeyword.value.trim() || undefined,
      })
      consumeLogs.value = res.data
      consumeLogTotal.value = res.total
    }
  } catch (e: any) {
    toast.error(e.message || '卡密记录加载失败')
  } finally {
    codeLogsLoading.value = false
  }
}

function resetCodeLogsAndReload() {
  codeLogPage.value = 1
  consumeLogPage.value = 1
  reloadCodeLogs()
}

function goCodeLogPage(p: number) {
  if (p < 1 || p > codeLogActiveTotalPages.value) return
  if (codeLogTab.value === 'gen') codeLogPage.value = p
  else consumeLogPage.value = p
  reloadCodeLogs()
}

async function copyCodeLog(code: string) {
  try {
    await copyToClipboard(code)
    toast.success(`卡密 ${code} 已复制`)
  } catch (e: any) {
    toast.error(`复制失败 (${e?.message || e}), 请手动复制`)
  }
}

onMounted(reload)
onMounted(reloadCodeLogs)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
