<template>
  <div class="card p-6">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h3 class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Icon name="database" class="text-brand-500" /> 数据库表关系图
        </h3>
        <p class="text-xs text-slate-400 mt-0.5">核心表结构与关联关系概览</p>
      </div>
      <span class="badge bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">{{ tables.length }} 张表</span>
    </div>

    <!-- Legend -->
    <div class="flex items-center gap-4 mb-4 text-xs text-slate-500 flex-wrap">
      <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-brand-400" /> 主表</span>
      <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-sky-400" /> 业务表</span>
      <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-emerald-400" /> 系统表</span>
      <span class="flex items-center gap-1.5"><span class="w-6 h-0.5 bg-slate-400" /> 外键关联</span>
    </div>

    <!-- Diagram grid -->
    <div class="overflow-x-auto scrollbar-thin">
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 min-w-[700px]">
        <div
          v-for="t in tables"
          :key="t.name"
          class="rounded-lg border-2 p-3 transition-all hover:shadow-md cursor-pointer"
          :class="tableBorderClass(t.category)"
          @click="$emit('select', t.name)"
        >
          <div class="flex items-center gap-2 mb-2">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="tableDotClass(t.category)" />
            <span class="text-xs font-mono font-semibold text-slate-800 dark:text-slate-100 truncate">{{ t.name }}</span>
            <span class="ml-auto text-[10px] text-slate-400 shrink-0">{{ t.rowCount }}</span>
          </div>
          <div class="space-y-0.5">
            <div v-for="col in t.columns" :key="col.name" class="flex items-center gap-1.5 text-[10px]">
              <Icon v-if="col.pk" name="lock" class="text-amber-500 shrink-0" />
              <Icon v-else-if="col.fk" name="external" class="text-sky-500 shrink-0" />
              <span v-else class="w-3 shrink-0" />
              <span class="font-mono text-slate-600 dark:text-slate-300 truncate" :class="col.pk ? 'font-bold' : ''">{{ col.name }}</span>
              <span class="ml-auto text-slate-400 shrink-0">{{ col.type }}</span>
            </div>
          </div>
          <!-- FK relations -->
          <div v-if="t.relations.length" class="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 space-y-0.5">
            <div v-for="r in t.relations" :key="r" class="text-[10px] text-sky-500 flex items-center gap-1">
              <Icon name="arrowRight" class="text-[9px]" /> {{ r }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Column { name: string; type: string; pk?: boolean; fk?: boolean }
interface Table { name: string; category: 'main' | 'business' | 'system'; columns: Column[]; relations: string[]; rowCount: number }

defineProps<{ tables: Table[] }>()
defineEmits<{ select: [name: string] }>()

function tableBorderClass(cat: string) {
  return {
    main: 'border-brand-300 dark:border-brand-700 bg-brand-50/30 dark:bg-brand-900/10',
    business: 'border-sky-300 dark:border-sky-700 bg-sky-50/30 dark:bg-sky-900/10',
    system: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10',
  }[cat] || 'border-slate-200'
}
function tableDotClass(cat: string) {
  return {
    main: 'bg-brand-400',
    business: 'bg-sky-400',
    system: 'bg-emerald-400',
  }[cat] || 'bg-slate-400'
}
</script>
