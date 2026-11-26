<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="AI 知识库" description="按商品分组管理知识库 · AI 回复时自动读取所属分组内全部商品 (跨账号) 的买家/卖家真实对话作上下文, 自动排除自动发货回复与系统消息">
      <template #actions>
        <span class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300" title="分组数量">
          <Icon name="book" class="text-[10px]" /> 分组 {{ groups.length }}
        </span>
        <span class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300" title="分组内商品成员总数 (可跨账号, 同一商品可进多组)">
          成员商品 {{ members.length }}
        </span>
        <button class="btn-secondary" @click="reload" :disabled="loading">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
      <!-- 第 1 列: 商品分组 -->
      <div class="card flex flex-col" :class="selectedGroup ? 'hidden xl:flex' : 'flex'">
        <div class="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
          <p class="text-sm font-medium text-slate-700 dark:text-slate-200">商品分组</p>
          <div class="flex gap-2">
            <input v-model="newGroupName" class="input flex-1" placeholder="新分组名称" maxlength="128" @keyup.enter="createGroup" />
            <button class="btn-primary shrink-0" :disabled="creating || !newGroupName.trim()" @click="createGroup">
              <Icon name="plus" /> 新建
            </button>
          </div>
        </div>
        <div class="overflow-y-auto max-h-[560px]">
          <div v-if="loading && !groups.length" class="p-8 flex items-center justify-center text-slate-400">
            <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
          </div>
          <div
            v-for="g in groups"
            :key="g.id"
            class="w-full px-4 py-3 border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
            :class="selectedGroupId === g.id ? 'bg-brand-50 dark:bg-brand-900/20' : ''"
            @click="selectGroup(g)"
          >
            <div class="flex items-center justify-between gap-2">
              <p class="font-medium text-slate-800 dark:text-slate-100 truncate">{{ g.name }}</p>
              <span class="shrink-0 badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ membersOf(g.id).length }} 商品</span>
            </div>
            <div class="flex items-center gap-1 mt-1.5">
              <button class="btn-ghost !px-1.5 !py-0.5 text-slate-400" title="上移" @click.stop="sortGroup(g, 'up')"><Icon name="chevronRight" class="rotate-[-90deg]" /></button>
              <button class="btn-ghost !px-1.5 !py-0.5 text-slate-400" title="下移" @click.stop="sortGroup(g, 'down')"><Icon name="chevronRight" class="rotate-90" /></button>
              <span class="flex-1" />
              <button class="btn-ghost !px-1.5 !py-0.5" title="重命名" @click.stop="renameGroup(g)"><Icon name="edit" /></button>
              <button class="btn-ghost !px-1.5 !py-0.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除分组" @click.stop="deleteGroup(g)"><Icon name="trash" /></button>
            </div>
          </div>
          <EmptyState v-if="!loading && !groups.length" message="暂无分组, 输入名称点击「新建」创建商品分组" icon="book" />
        </div>
      </div>

      <!-- 第 2 列: 选中分组的商品成员 (跨账号) -->
      <div class="card flex flex-col" :class="selectedGroup ? 'flex' : 'hidden xl:flex'">
        <template v-if="selectedGroup">
          <div class="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
            <button class="btn-ghost !px-2 !py-1 xl:hidden" @click="selectedGroupId = 0"><Icon name="chevronRight" class="rotate-180" /></button>
            <div class="flex items-center justify-between gap-2">
              <p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">「{{ selectedGroup.name }}」成员商品</p>
              <span class="shrink-0 badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">{{ membersOf(selectedGroup.id).length }}</span>
            </div>
            <div class="flex gap-2 flex-wrap">
              <select v-model="addCookieId" class="input !w-auto min-w-[140px] flex-1">
                <option value="" disabled>选择账号</option>
                <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
              </select>
              <select v-model="addItemId" class="input !w-auto min-w-[180px] flex-[2]">
                <option value="" disabled>{{ addCookieId ? (itemsForAccount.length ? '选择商品' : '该账号暂无商品, 请先同步') : '请先选择账号' }}</option>
                <option v-for="i in itemsForAccount" :key="i.item_id" :value="i.item_id">{{ i.item_id }} · {{ i.item_title || '无标题' }}</option>
              </select>
              <button class="btn-primary shrink-0" :disabled="adding || !addCookieId || !addItemId" @click="addMember">
                <Icon name="plus" /> 加入
              </button>
            </div>
            <p class="text-xs text-slate-400">多账号下的同一商品可加入同一分组; 同一商品也允许加入多个分组</p>
          </div>
          <div class="overflow-y-auto max-h-[560px]">
            <div v-for="m in membersOf(selectedGroup.id)" :key="m.id" class="flex items-center gap-2 px-4 py-3 border-b border-slate-50 dark:border-slate-800/60">
              <div class="min-w-0 flex-1">
                <p class="text-slate-800 dark:text-slate-100 truncate">{{ m.item_title || '无标题' }}</p>
                <p class="text-xs text-slate-400 truncate">{{ m.cookie_remark || m.cookie_id }} · {{ m.item_id }}</p>
              </div>
              <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0" title="移出分组" @click="removeMember(m)">
                <Icon name="trash" />
              </button>
            </div>
            <EmptyState v-if="!membersOf(selectedGroup.id).length" message="该分组还没有商品, 选择账号和商品后点「加入」" icon="itemReply" />
          </div>
        </template>
      </div>

      <!-- 第 3 列: 商品归属总览 (全部商品 → 所属分组, 支持直接移出) -->
      <div class="card flex flex-col xl:col-span-1">
        <div class="p-4 border-b border-slate-100 dark:border-slate-800">
          <p class="text-sm font-medium text-slate-700 dark:text-slate-200">商品归属总览</p>
          <p class="text-xs text-slate-400 mt-1">全部商品的分组归属 (点分组徽标上的 × 可将其移出该分组)</p>
          <input v-model="itemFilter" class="input mt-2" placeholder="搜索商品标题 / ID" />
        </div>
        <div class="overflow-y-auto max-h-[560px]">
          <div v-for="i in filteredItems" :key="i.cookie_id + ':' + i.item_id" class="px-4 py-3 border-b border-slate-50 dark:border-slate-800/60">
            <div class="flex items-center justify-between gap-2">
              <p class="text-slate-800 dark:text-slate-100 truncate">{{ i.item_title || '无标题' }}</p>
              <span class="shrink-0 text-xs text-slate-400">{{ i.cookie_remark || i.cookie_id }}</span>
            </div>
            <div class="flex flex-wrap gap-1.5 mt-1.5">
              <span
                v-for="g in groupsOfItem(i.cookie_id, i.item_id)"
                :key="g.id"
                class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 cursor-pointer"
                :title="`点击从「${g.name}」移出`"
                @click="removeItemFromGroup(i, g)"
              >
                {{ g.name }} <Icon name="x" class="text-[10px]" />
              </span>
              <span v-if="!groupsOfItem(i.cookie_id, i.item_id).length" class="text-xs text-slate-400">未加入分组 (AI 回复时不读取消息知识库)</span>
            </div>
          </div>
          <EmptyState v-if="!filteredItems.length" message="暂无商品, 请先在商品管理页同步" icon="itemReply" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getKbData, createKbGroup, renameKbGroup, deleteKbGroup, sortKbGroup, toggleKbGroupItem } from '~/api/kb'
import type { KbGroup, KbGroupMemberItem } from '~/api/kb'
import { getAccounts } from '~/api/accounts'
import type { AccountLite } from '~/api/accounts'
import { getItems } from '~/api/items'
import type { Item } from '~/api/items'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const groups = ref<KbGroup[]>([])
const members = ref<KbGroupMemberItem[]>([])
const accounts = ref<AccountLite[]>([])
const items = ref<Item[]>([])

const selectedGroupId = ref(0)
const selectedGroup = computed(() => groups.value.find((g) => g.id === selectedGroupId.value) || null)

const newGroupName = ref('')
const creating = ref(false)
const addCookieId = ref('')
const addItemId = ref('')
const adding = ref(false)
const itemFilter = ref('')

const itemsForAccount = computed(() => items.value.filter((i) => i.cookie_id === addCookieId.value))

const filteredItems = computed(() => {
  const k = itemFilter.value.trim().toLowerCase()
  if (!k) return items.value
  return items.value.filter(
    (i) => (i.item_title || '').toLowerCase().includes(k) || i.item_id.toLowerCase().includes(k),
  )
})

function membersOf(groupId: number): KbGroupMemberItem[] {
  return members.value.filter((m) => m.group_id === groupId)
}

function groupsOfItem(cookieId: string, itemId: string): KbGroup[] {
  const ids = members.value.filter((m) => m.cookie_id === cookieId && m.item_id === itemId).map((m) => m.group_id)
  return groups.value.filter((g) => ids.includes(g.id))
}

async function reload() {
  loading.value = true
  try {
    const [kbData, accountData, itemData] = await Promise.all([
      getKbData(),
      getAccounts().catch(() => [] as AccountLite[]),
      getItems().catch(() => [] as Item[]),
    ])
    groups.value = kbData.groups
    members.value = kbData.members
    accounts.value = accountData
    items.value = itemData
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function selectGroup(g: KbGroup) {
  selectedGroupId.value = g.id
  addCookieId.value = ''
  addItemId.value = ''
}

async function createGroup() {
  const name = newGroupName.value.trim()
  if (!name) return
  creating.value = true
  try {
    await createKbGroup(name)
    toast.success(`分组「${name}」已创建`)
    newGroupName.value = ''
    await reload()
  } catch (e: any) {
    toast.error(e.message || '创建失败')
  } finally {
    creating.value = false
  }
}

async function renameGroup(g: KbGroup) {
  const name = prompt('修改分组名称', g.name)?.trim()
  if (!name || name === g.name) return
  try {
    await renameKbGroup(g.id, name)
    toast.success('分组已重命名')
    await reload()
  } catch (e: any) {
    toast.error(e.message || '重命名失败')
  }
}

async function deleteGroup(g: KbGroup) {
  if (!confirm(`确认删除分组「${g.name}」？组内商品成员映射同步清理, 商品与消息数据不受影响`)) return
  try {
    await deleteKbGroup(g.id)
    toast.success('分组已删除')
    if (selectedGroupId.value === g.id) selectedGroupId.value = 0
    await reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  }
}

async function sortGroup(g: KbGroup, direction: 'up' | 'down') {
  try {
    const r = await sortKbGroup(g.id, direction)
    if (!r?.moved) toast.info(direction === 'up' ? '已在最前' : '已在最后')
    await reload()
  } catch (e: any) {
    toast.error(e.message || '排序失败')
  }
}

async function addMember() {
  const g = selectedGroup.value
  if (!g || !addCookieId.value || !addItemId.value) return
  adding.value = true
  try {
    await toggleKbGroupItem(g.id, addCookieId.value, addItemId.value, 'add')
    toast.success('商品已加入分组')
    addItemId.value = ''
    await reload()
  } catch (e: any) {
    toast.error(e.message || '加入失败')
  } finally {
    adding.value = false
  }
}

async function removeMember(m: KbGroupMemberItem) {
  if (!confirm(`将商品「${m.item_title || m.item_id}」(${m.cookie_remark || m.cookie_id}) 从分组移出?`)) return
  try {
    await toggleKbGroupItem(m.group_id, m.cookie_id, m.item_id, 'remove')
    toast.success('商品已移出分组')
    await reload()
  } catch (e: any) {
    toast.error(e.message || '移出失败')
  }
}

async function removeItemFromGroup(i: Item, g: KbGroup) {
  if (!confirm(`将商品「${i.item_title || i.item_id}」从分组「${g.name}」移出?`)) return
  try {
    await toggleKbGroupItem(g.id, i.cookie_id, i.item_id, 'remove')
    toast.success('商品已移出分组')
    await reload()
  } catch (e: any) {
    toast.error(e.message || '移出失败')
  }
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
