<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="xian18-shop 同步" description="从十八线·商盟拉取商品 + 库存,触发发卡时扣减卡密">
      <template #actions>
        <button class="btn-secondary" @click="loadList" :disabled="loading">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="syncFromXian18" :disabled="syncing">
          <Icon name="download" v-if="!syncing" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ syncing ? '同步中...' : '从 xian18-shop 同步' }}
        </button>
      </template>
    </PageHeader>

    <!-- 状态提示 -->
    <div v-if="lastSyncedAt" class="card p-3 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
      <Icon name="check" class="text-emerald-500" />
      上次同步: {{ lastSyncedAt }}
      <span class="ml-auto">共 {{ list.length }} 个商品</span>
    </div>

    <!-- 商品列表 -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <div v-else-if="!list.length" class="p-10 text-center text-slate-400">
        <Icon name="inbox" class="text-4xl mb-2" />
        <p>暂无数据,点击右上角"从 xian18-shop 同步"按钮拉取商品</p>
      </div>
      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>商品名称</th>
                <th>分类</th>
                <th>售价</th>
                <th>会员价</th>
                <th>卡密库存</th>
                <th>配置库存</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in list" :key="c.id">
                <td class="text-slate-400">{{ c.id }}</td>
                <td>
                  <div class="font-medium text-slate-800 dark:text-white">{{ c.name }}</div>
                  <div class="text-xs text-slate-400 mt-0.5">code: {{ c.code }}</div>
                </td>
                <td>
                  <span class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">
                    {{ c.categoryName || `#${c.categoryId}` }}
                  </span>
                </td>
                <td class="text-brand-600 font-medium">¥{{ c.price }}</td>
                <td class="text-slate-500">¥{{ c.userPrice }}</td>
                <td>
                  <span :class="c.cardStock > 0 ? 'text-emerald-600 font-medium' : 'text-red-500'">
                    {{ c.cardStock }}
                  </span>
                </td>
                <td class="text-slate-400">{{ c.stock >= 999999 ? '∞' : c.stock }}</td>
                <td class="text-right">
                  <button
                    class="btn-sm btn-primary"
                    :disabled="consuming === c.id || c.cardStock <= 0"
                    @click="consumeOne(c)"
                  >
                    <Icon name="refresh" v-if="consuming === c.id" class="animate-spin" />
                    <Icon name="send" v-else />
                    发卡测试
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <!-- 发卡结果弹窗 -->
    <ModalBase :model-value="!!consumeResult" title="发卡结果" size="md" @update:model-value="consumeResult = null" @close="consumeResult = null">
      <div class="space-y-3">
        <div class="text-sm text-slate-600 dark:text-slate-300">
          商品: <span class="font-medium">{{ consumeResult?.commodityName }}</span>
        </div>
        <div class="text-sm text-slate-600 dark:text-slate-300">
          数量: <span class="font-medium text-brand-600">{{ consumeResult?.quantity }}</span> 张
        </div>
        <div class="pt-2 border-t border-slate-100 dark:border-slate-700">
          <label class="label">卡密内容</label>
          <div class="space-y-2">
            <div
              v-for="card in consumeResult?.cards || []"
              :key="card.id"
              class="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded font-mono text-xs"
            >
              <span class="text-slate-400">#{{ card.id }}</span>
              <span class="flex-1 text-slate-800 dark:text-slate-200 break-all">{{ card.secret }}</span>
              <button class="text-brand-600 hover:text-brand-700" @click="copyText(card.secret)">
                <Icon name="copy" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="consumeResult = null">关闭</button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { syncXian18, consumeXian18 } from '~/api/sync'
import type { Xian18Commodity, ConsumeResult } from '~/api/sync'

definePageMeta({ layout: 'default' })

const toast = useToast()

const list = ref<Xian18Commodity[]>([])
const loading = ref(false)
const syncing = ref(false)
const consuming = ref<number | null>(null)
const lastSyncedAt = ref('')
const consumeResult = ref<ConsumeResult | null>(null)

async function loadList() {
  // 仅从内存加载上次同步的结果(无后端持久化,刷新页面后需重新同步)
  if (list.value.length) return
  await syncFromXian18()
}

async function syncFromXian18() {
  syncing.value = true
  try {
    const r = await syncXian18()
    list.value = r.commodities || []
    lastSyncedAt.value = new Date(r.syncedAt || Date.now()).toLocaleString('zh-CN')
    toast.success(`同步成功,共 ${r.total} 个商品`)
  } catch (e: any) {
    toast.error(e.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

async function consumeOne(c: Xian18Commodity) {
  consuming.value = c.id
  try {
    const r = await consumeXian18({
      commodityId: c.id,
      quantity: 1,
      externalOrderNo: `xy-manual-${Date.now()}`,
    })
    consumeResult.value = r
    // 本地扣减库存
    c.cardStock = Math.max(0, c.cardStock - 1)
    toast.success(`发卡成功: ${r.quantity} 张`)
  } catch (e: any) {
    toast.error(e.message || '发卡失败')
  } finally {
    consuming.value = null
  }
}

function copyText(text: string) {
  if (import.meta.client && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast.success('已复制到剪贴板'))
  }
}

onMounted(() => {
  loadList()
})
</script>
