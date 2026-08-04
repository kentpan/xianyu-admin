<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="用户管理" description="系统用户与权限管理">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>状态</th>
                <th>创建时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td>
                  <div class="font-medium text-slate-800 dark:text-white flex items-center gap-2">
                    {{ u.username }}
                    <span v-if="u.id === me?.userId" class="text-xs text-brand-600">(我)</span>
                  </div>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ u.email }}</td>
                <td>
                  <span class="badge" :class="u.is_admin
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300'">
                    <Icon :name="u.is_admin ? 'shield' : 'user'" />
                    {{ u.is_admin ? '管理员' : '普通' }}
                  </span>
                </td>
                <td>
                  <button
                    class="badge transition-colors"
                    :class="u.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
                    @click="toggleActive(u)"
                  >
                    <span class="w-1.5 h-1.5 rounded-full" :class="u.is_active ? 'bg-emerald-500' : 'bg-slate-400'" />
                    {{ u.is_active ? '启用' : '禁用' }}
                  </button>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(u.created_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button
                      class="btn-ghost !px-2 !py-1"
                      :class="u.is_admin ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20' : ''"
                      :title="u.is_admin ? '取消管理员' : '设为管理员'"
                      @click="toggleAdmin(u)"
                    >
                      <Icon name="shield" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除用户" :disabled="u.id === me?.userId" @click="confirmDelete(u)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!users.length" message="暂无用户" icon="users" />
      </template>
    </div>

    <!-- Delete confirm modal -->
    <ModalBase :model-value="!!deleteTarget" title="删除用户" size="sm" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-sm text-slate-500 mt-2">
          确认删除用户 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.username }}</span>？
          该操作不可撤销。
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
import { useApi } from '~/composables/useApi'

definePageMeta({ layout: 'default' })

const api = useApi()
const toast = useToast()

interface User {
  id: number
  username: string
  email: string
  is_active: number
  is_admin: number
  created_at: string
}

const loading = ref(false)
const deleting = ref(false)
const users = ref<User[]>([])
const deleteTarget = ref<User | null>(null)
const me = ref<{ userId: number } | null>(null)

async function reload() {
  loading.value = true
  try {
    const [usersData, meData] = await Promise.all([
      api.get<User[]>('/api/admin/users'),
      api.get<{ userId: number; username: string; isAdmin: boolean }>('/api/auth/verify').catch(() => null),
    ])
    users.value = usersData
    me.value = meData as any
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function toggleActive(u: User) {
  try {
    await api.put(`/api/admin/users/${u.id}`, { is_active: !u.is_active })
    u.is_active = u.is_active ? 0 : 1
    toast.success(u.is_active ? '已启用' : '已禁用')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function toggleAdmin(u: User) {
  try {
    await api.put(`/api/admin/users/${u.id}`, { is_admin: !u.is_admin })
    u.is_admin = u.is_admin ? 0 : 1
    toast.success(u.is_admin ? '已设为管理员' : '已取消管理员')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

function confirmDelete(u: User) {
  if (me.value && u.id === me.value.userId) {
    toast.error('不能删除自己')
    return
  }
  deleteTarget.value = u
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await api.del(`/api/admin/users/${deleteTarget.value.id}`)
    toast.success('用户已删除')
    deleteTarget.value = null
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(t.replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
