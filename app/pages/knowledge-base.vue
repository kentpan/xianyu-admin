<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="AI 知识库" description="手动沉淀问话与回答供 AI 回复引用 · 排序即优先级 · 重复添加频次累加作置信度">
      <template #actions>
        <!-- 统计徽标 -->
        <span class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300" title="分组数量">
          <Icon name="book" class="text-[10px]" /> 分组 {{ stats.groups }}
        </span>
        <span class="badge bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" title="问话条数">问话 {{ stats.questions }}</span>
        <span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" title="回答条数">回答 {{ stats.answers }}</span>
        <span class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300" title="所有条目 AI 命中引用次数累计">
          AI 累计引用 {{ stats.ai_hits }}
        </span>
        <!-- 浏览 / 编辑模式切换 -->
        <div class="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800" role="group" aria-label="浏览/编辑模式切换">
          <button
            type="button"
            class="px-3 py-2 text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
            :class="!isEdit ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'"
            title="浏览模式：查看、排序、移除"
            @click="mode = 'browse'"
          >
            <Icon name="eye" /> 浏览
          </button>
          <button
            type="button"
            class="px-3 py-2 text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
            :class="isEdit ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'"
            title="编辑模式：新增 / 编辑 / 删除 / 分组管理"
            @click="mode = 'edit'"
          >
            <Icon name="edit" /> 编辑
          </button>
        </div>
        <button class="btn-secondary" :disabled="loading" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- 并列三列: 分组 / 问话 / 回答 -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
      <!-- 分组列 -->
      <div class="card overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <Icon name="book" class="text-brand-600 dark:text-brand-400" />
          <h3 class="text-sm font-semibold text-slate-900 dark:text-white">分组</h3>
          <span class="badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300">{{ groups.length }}</span>
          <div class="flex-1" />
          <button v-if="isEdit" class="btn-primary !px-2.5 !py-1 !text-xs" @click="openCreateGroup">
            <Icon name="plus" /> 新建分组
          </button>
        </div>
        <div class="max-h-[480px] overflow-y-auto scrollbar-thin" style="scrollbar-width: thin">
          <div v-if="loading && !data" class="p-10 flex items-center justify-center text-slate-400">
            <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
          </div>
          <template v-else>
            <div
              v-for="g in gPageItems"
              :key="g.id"
              class="group/g flex items-stretch border-b border-slate-100 dark:border-slate-700/60 last:border-b-0 transition-colors"
              :class="isSelected(g) ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'"
            >
              <button type="button" class="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 text-left" @click="toggleGroup(g)">
                <span class="w-2 h-2 rounded-full shrink-0" :class="isSelected(g) ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600'" />
                <span
                  class="flex-1 min-w-0 truncate text-sm"
                  :class="isSelected(g) ? 'font-medium text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'"
                >{{ g.name }}</span>
                <span class="badge shrink-0 bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300" title="关联问话/回答条数">
                  {{ groupMemberCount(Number(g.id)) }} 项
                </span>
              </button>
              <div v-if="isEdit" class="flex items-center gap-0.5 pr-2 opacity-0 group-hover/g:opacity-100 focus-within:opacity-100 transition-opacity">
                <button class="btn-ghost !px-1.5 !py-1" title="编辑名称" @click="openRenameGroup(g)">
                  <Icon name="edit" />
                </button>
                <button
                  class="btn-ghost !px-1.5 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  title="删除分组 (组内问答保留)"
                  :disabled="busy(`group:del:${g.id}`)"
                  @click="removeGroup(g)"
                >
                  <Icon :name="busy(`group:del:${g.id}`) ? 'refresh' : 'trash'" :class="busy(`group:del:${g.id}`) ? 'animate-spin' : ''" />
                </button>
              </div>
            </div>
            <EmptyState v-if="!gPageItems.length" message="暂无分组，切换到编辑模式点击「新建分组」创建" icon="book" />
          </template>
        </div>
        <!-- 选中分组摘要 -->
        <div
          v-if="selectedGroup"
          class="px-3 py-2.5 border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap"
        >
          <span>
            分组「<span class="font-medium text-brand-700 dark:text-brand-300">{{ selectedGroup.name }}</span>」：关联问话
            <b class="text-slate-700 dark:text-slate-200">{{ qList.length }}</b> 条 · 回答
            <b class="text-slate-700 dark:text-slate-200">{{ aList.length }}</b> 条
          </span>
          <button class="ml-auto inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline" @click="clearSelection">
            <Icon name="close" class="text-[10px]" /> 取消选中
          </button>
        </div>
        <div
          v-if="groups.length"
          class="px-3 py-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400"
        >
          <button class="btn-ghost !px-2 !py-1 !text-xs" :disabled="gPage <= 1" @click="gPage--">上一页</button>
          <span>第 {{ gPage }} / {{ gTotalPages }} 页</span>
          <button class="btn-ghost !px-2 !py-1 !text-xs" :disabled="gPage >= gTotalPages" @click="gPage++">下一页</button>
        </div>
      </div>

      <!-- 问话列 -->
      <div class="card overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <Icon name="itemReply" class="text-sky-600 dark:text-sky-400" />
          <h3 class="text-sm font-semibold text-slate-900 dark:text-white">问话</h3>
          <span class="badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300">{{ qList.length }}</span>
          <div class="flex-1" />
          <button v-if="isEdit" class="btn-primary !px-2.5 !py-1 !text-xs" @click="openCapture('question')">
            <Icon name="plus" /> 新增问话
          </button>
        </div>
        <div
          v-if="selectedGroup"
          class="flex items-center gap-2 px-3 py-2 bg-brand-50 dark:bg-brand-900/20 border-b border-brand-100 dark:border-brand-900/40 text-xs text-brand-700 dark:text-brand-300"
        >
          <Icon name="book" /> 仅显示分组「{{ selectedGroup.name }}」的关联条目
          <button class="ml-auto inline-flex items-center gap-0.5 hover:underline" @click="clearSelection">
            <Icon name="close" class="text-[10px]" /> 取消
          </button>
        </div>
        <div class="max-h-[480px] overflow-y-auto scrollbar-thin" style="scrollbar-width: thin">
          <div v-if="loading && !data" class="p-10 flex items-center justify-center text-slate-400">
            <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
          </div>
          <template v-else>
            <div
              v-for="(q, qi) in qPageItems"
              :key="q.id"
              class="group/row px-3 py-2.5 border-b border-slate-100 dark:border-slate-700/60 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
            >
              <div class="flex items-start gap-2">
                <span class="shrink-0 w-8 text-xs text-slate-400 tabular-nums pt-0.5 text-right">#{{ (qPage - 1) * PAGE_SIZE + qi + 1 }}</span>
                <p class="flex-1 min-w-0 text-sm leading-5 text-slate-700 dark:text-slate-200 line-clamp-2" :title="q.content">{{ q.content }}</p>
                <!-- 浏览模式: 上移 / 下移 / 移除 -->
                <div v-if="!isEdit" class="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    class="btn-ghost !px-1.5 !py-1"
                    title="上移 (优先级更高)"
                    :disabled="busy(`sort:question:${q.id}`)"
                    @click="moveItem('question', q.id, 'up')"
                  >
                    <Icon :name="busy(`sort:question:${q.id}`) ? 'refresh' : 'chevronUp'" :class="busy(`sort:question:${q.id}`) ? 'animate-spin' : ''" />
                  </button>
                  <button
                    class="btn-ghost !px-1.5 !py-1"
                    title="下移 (优先级更低)"
                    :disabled="busy(`sort:question:${q.id}`)"
                    @click="moveItem('question', q.id, 'down')"
                  >
                    <Icon :name="busy(`sort:question:${q.id}`) ? 'refresh' : 'chevronDown'" :class="busy(`sort:question:${q.id}`) ? 'animate-spin' : ''" />
                  </button>
                  <button
                    class="btn-ghost !px-1.5 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="移除出知识库"
                    :disabled="busy(`del:question:${q.id}`)"
                    @click="removeItem('question', q)"
                  >
                    <Icon :name="busy(`del:question:${q.id}`) ? 'refresh' : 'trash'" :class="busy(`del:question:${q.id}`) ? 'animate-spin' : ''" />
                  </button>
                </div>
                <!-- 编辑模式: 编辑 / 删除 -->
                <div v-else class="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button class="btn-ghost !px-1.5 !py-1" title="编辑内容" @click="openEditItem('question', q)">
                    <Icon name="edit" />
                  </button>
                  <button
                    class="btn-ghost !px-1.5 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="删除"
                    :disabled="busy(`del:question:${q.id}`)"
                    @click="removeItem('question', q)"
                  >
                    <Icon :name="busy(`del:question:${q.id}`) ? 'refresh' : 'trash'" :class="busy(`del:question:${q.id}`) ? 'animate-spin' : ''" />
                  </button>
                </div>
              </div>
              <div class="mt-1 pl-10 flex items-center gap-1.5 flex-wrap">
                <span
                  v-if="Number(q.freq) > 1"
                  class="badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300"
                  title="重复添加次数 (作置信度依据)"
                >频次×{{ q.freq }}</span>
                <span
                  v-if="Number(q.ai_hit_count) > 0"
                  class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                  :title="`AI 累计引用 ${q.ai_hit_count} 次${q.ai_last_used_at ? ' · 最近: ' + formatTimeFull(q.ai_last_used_at) : ''}`"
                >AI引用 {{ q.ai_hit_count }}</span>
                <!-- 浏览模式: 分组归属小点 -->
                <span
                  v-if="!isEdit && itemGroups('question', q).length"
                  class="inline-flex items-center gap-0.5"
                  :title="'归属分组: ' + itemGroups('question', q).map((g) => g.name).join('、')"
                >
                  <span
                    v-for="(g, gi) in itemGroups('question', q).slice(0, 3)"
                    :key="g.id"
                    class="w-2 h-2 rounded-full"
                    :class="dotColor(gi)"
                  />
                  <span v-if="itemGroups('question', q).length > 3" class="text-[10px] text-slate-400">+{{ itemGroups('question', q).length - 3 }}</span>
                </span>
                <span v-if="!isEdit && !itemGroups('question', q).length" class="text-[10px] text-slate-300 dark:text-slate-600">未分组</span>
                <!-- 编辑模式: 点击管理分组归属 -->
                <button
                  v-if="isEdit"
                  class="badge bg-slate-100 text-slate-500 hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-700/40 dark:text-slate-300 dark:hover:bg-brand-900/30 dark:hover:text-brand-300 transition-colors"
                  title="点击管理分组归属"
                  @click="openMemberModal('question', q)"
                >
                  <Icon name="book" class="text-[10px]" />
                  {{ itemGroups('question', q).length ? `分组 ${itemGroups('question', q).length}` : '未分组' }}
                </button>
              </div>
            </div>
            <EmptyState v-if="!qPageItems.length" message="从消息管理页 hover 消息手动添加，或点击新增" icon="itemReply" />
          </template>
        </div>
        <div
          v-if="qList.length"
          class="px-3 py-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400"
        >
          <button class="btn-ghost !px-2 !py-1 !text-xs" :disabled="qPage <= 1" @click="qPage--">上一页</button>
          <span>第 {{ qPage }} / {{ qTotalPages }} 页 · 共 {{ qList.length }} 条</span>
          <button class="btn-ghost !px-2 !py-1 !text-xs" :disabled="qPage >= qTotalPages" @click="qPage++">下一页</button>
        </div>
      </div>

      <!-- 回答列 -->
      <div class="card overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <Icon name="itemReply" class="text-emerald-600 dark:text-emerald-400" />
          <h3 class="text-sm font-semibold text-slate-900 dark:text-white">回答</h3>
          <span class="badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300">{{ aList.length }}</span>
          <div class="flex-1" />
          <button v-if="isEdit" class="btn-primary !px-2.5 !py-1 !text-xs" @click="openCapture('answer')">
            <Icon name="plus" /> 新增回答
          </button>
        </div>
        <div
          v-if="selectedGroup"
          class="flex items-center gap-2 px-3 py-2 bg-brand-50 dark:bg-brand-900/20 border-b border-brand-100 dark:border-brand-900/40 text-xs text-brand-700 dark:text-brand-300"
        >
          <Icon name="book" /> 仅显示分组「{{ selectedGroup.name }}」的关联条目
          <button class="ml-auto inline-flex items-center gap-0.5 hover:underline" @click="clearSelection">
            <Icon name="close" class="text-[10px]" /> 取消
          </button>
        </div>
        <div class="max-h-[480px] overflow-y-auto scrollbar-thin" style="scrollbar-width: thin">
          <div v-if="loading && !data" class="p-10 flex items-center justify-center text-slate-400">
            <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
          </div>
          <template v-else>
            <div
              v-for="(a, ai) in aPageItems"
              :key="a.id"
              class="group/row px-3 py-2.5 border-b border-slate-100 dark:border-slate-700/60 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
            >
              <div class="flex items-start gap-2">
                <span class="shrink-0 w-8 text-xs text-slate-400 tabular-nums pt-0.5 text-right">#{{ (aPage - 1) * PAGE_SIZE + ai + 1 }}</span>
                <p class="flex-1 min-w-0 text-sm leading-5 text-slate-700 dark:text-slate-200 line-clamp-2" :title="a.content">{{ a.content }}</p>
                <!-- 浏览模式: 上移 / 下移 / 移除 -->
                <div v-if="!isEdit" class="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    class="btn-ghost !px-1.5 !py-1"
                    title="上移 (优先级更高)"
                    :disabled="busy(`sort:answer:${a.id}`)"
                    @click="moveItem('answer', a.id, 'up')"
                  >
                    <Icon :name="busy(`sort:answer:${a.id}`) ? 'refresh' : 'chevronUp'" :class="busy(`sort:answer:${a.id}`) ? 'animate-spin' : ''" />
                  </button>
                  <button
                    class="btn-ghost !px-1.5 !py-1"
                    title="下移 (优先级更低)"
                    :disabled="busy(`sort:answer:${a.id}`)"
                    @click="moveItem('answer', a.id, 'down')"
                  >
                    <Icon :name="busy(`sort:answer:${a.id}`) ? 'refresh' : 'chevronDown'" :class="busy(`sort:answer:${a.id}`) ? 'animate-spin' : ''" />
                  </button>
                  <button
                    class="btn-ghost !px-1.5 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="移除出知识库"
                    :disabled="busy(`del:answer:${a.id}`)"
                    @click="removeItem('answer', a)"
                  >
                    <Icon :name="busy(`del:answer:${a.id}`) ? 'refresh' : 'trash'" :class="busy(`del:answer:${a.id}`) ? 'animate-spin' : ''" />
                  </button>
                </div>
                <!-- 编辑模式: 编辑 / 删除 -->
                <div v-else class="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button class="btn-ghost !px-1.5 !py-1" title="编辑内容" @click="openEditItem('answer', a)">
                    <Icon name="edit" />
                  </button>
                  <button
                    class="btn-ghost !px-1.5 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="删除"
                    :disabled="busy(`del:answer:${a.id}`)"
                    @click="removeItem('answer', a)"
                  >
                    <Icon :name="busy(`del:answer:${a.id}`) ? 'refresh' : 'trash'" :class="busy(`del:answer:${a.id}`) ? 'animate-spin' : ''" />
                  </button>
                </div>
              </div>
              <div class="mt-1 pl-10 flex items-center gap-1.5 flex-wrap">
                <span
                  v-if="Number(a.freq) > 1"
                  class="badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300"
                  title="重复添加次数 (作置信度依据)"
                >频次×{{ a.freq }}</span>
                <span
                  v-if="Number(a.ai_hit_count) > 0"
                  class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                  :title="`AI 累计引用 ${a.ai_hit_count} 次${a.ai_last_used_at ? ' · 最近: ' + formatTimeFull(a.ai_last_used_at) : ''}`"
                >AI引用 {{ a.ai_hit_count }}</span>
                <!-- 浏览模式: 分组归属小点 -->
                <span
                  v-if="!isEdit && itemGroups('answer', a).length"
                  class="inline-flex items-center gap-0.5"
                  :title="'归属分组: ' + itemGroups('answer', a).map((g) => g.name).join('、')"
                >
                  <span
                    v-for="(g, gi) in itemGroups('answer', a).slice(0, 3)"
                    :key="g.id"
                    class="w-2 h-2 rounded-full"
                    :class="dotColor(gi)"
                  />
                  <span v-if="itemGroups('answer', a).length > 3" class="text-[10px] text-slate-400">+{{ itemGroups('answer', a).length - 3 }}</span>
                </span>
                <span v-if="!isEdit && !itemGroups('answer', a).length" class="text-[10px] text-slate-300 dark:text-slate-600">未分组</span>
                <!-- 编辑模式: 点击管理分组归属 -->
                <button
                  v-if="isEdit"
                  class="badge bg-slate-100 text-slate-500 hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-700/40 dark:text-slate-300 dark:hover:bg-brand-900/30 dark:hover:text-brand-300 transition-colors"
                  title="点击管理分组归属"
                  @click="openMemberModal('answer', a)"
                >
                  <Icon name="book" class="text-[10px]" />
                  {{ itemGroups('answer', a).length ? `分组 ${itemGroups('answer', a).length}` : '未分组' }}
                </button>
              </div>
            </div>
            <EmptyState v-if="!aPageItems.length" message="从消息管理页 hover 消息手动添加，或点击新增" icon="itemReply" />
          </template>
        </div>
        <div
          v-if="aList.length"
          class="px-3 py-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400"
        >
          <button class="btn-ghost !px-2 !py-1 !text-xs" :disabled="aPage <= 1" @click="aPage--">上一页</button>
          <span>第 {{ aPage }} / {{ aTotalPages }} 页 · 共 {{ aList.length }} 条</span>
          <button class="btn-ghost !px-2 !py-1 !text-xs" :disabled="aPage >= aTotalPages" @click="aPage++">下一页</button>
        </div>
      </div>
    </div>

    <!-- 新增问话/回答 弹窗 -->
    <ModalBase v-model="captureModal.open" :title="captureModal.type === 'question' ? '新增问话' : '新增回答'" size="md">
      <div class="space-y-3">
        <div class="rounded-lg bg-brand-50 dark:bg-brand-900/20 p-3 text-xs text-brand-700 dark:text-brand-300">
          内容将进入知识库供 AI 回复引用 · 与已有条目重复时自动去重 (频次 +1 作置信度) · 新条目排到末尾，可在浏览模式用箭头调整优先级
        </div>
        <div>
          <label class="label">内容 <span class="text-red-500">*</span></label>
          <textarea
            v-model="captureModal.content"
            rows="6"
            maxlength="2000"
            class="input"
            :placeholder="captureModal.type === 'question' ? '买家常问的问题内容' : '对应的回答话术内容'"
          ></textarea>
          <p class="mt-1 text-xs text-slate-400 text-right">{{ captureModal.content.length }}/2000</p>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="captureModal.open = false">取消</button>
        <button class="btn-primary" :disabled="busy('capture') || !captureModal.content.trim()" @click="submitCapture">
          <Icon :name="busy('capture') ? 'refresh' : 'plus'" :class="busy('capture') ? 'animate-spin' : ''" />
          添加
        </button>
      </template>
    </ModalBase>

    <!-- 编辑条目 弹窗 -->
    <ModalBase v-model="editModal.open" :title="editModal.type === 'question' ? '编辑问话' : '编辑回答'" size="md">
      <div class="space-y-3">
        <div>
          <label class="label">内容 <span class="text-red-500">*</span></label>
          <textarea v-model="editModal.content" rows="6" maxlength="2000" class="input" placeholder="条目内容 (与其他条目重复会被拒绝)"></textarea>
          <p class="mt-1 text-xs text-slate-400 text-right">{{ editModal.content.length }}/2000</p>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="editModal.open = false">取消</button>
        <button class="btn-primary" :disabled="busy('edit') || !editModal.content.trim()" @click="submitEditItem">
          <Icon :name="busy('edit') ? 'refresh' : 'check'" :class="busy('edit') ? 'animate-spin' : ''" />
          保存
        </button>
      </template>
    </ModalBase>

    <!-- 新建分组 弹窗 (名称 + 勾选问话/回答加入) -->
    <ModalBase v-model="groupModal.open" title="新建分组" size="lg">
      <div class="space-y-4">
        <div>
          <label class="label">分组名称 <span class="text-red-500">*</span></label>
          <input v-model="groupModal.name" class="input" maxlength="128" placeholder="如: 尺寸咨询 / 发货时效 / 售后话术" />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-sm font-medium text-slate-700 dark:text-slate-200">问话</span>
              <span class="badge bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">已选 {{ groupModal.qIds.length }}</span>
            </div>
            <div class="relative mb-2">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
              <input v-model="groupModal.qSearch" class="input pl-9 !py-1.5 !text-xs" placeholder="搜索问话内容" />
            </div>
            <div class="max-h-48 overflow-y-auto scrollbar-thin space-y-0.5" style="scrollbar-width: thin">
              <label
                v-for="q in groupModalQFiltered"
                :key="q.id"
                class="flex items-start gap-2 text-xs p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer"
              >
                <input v-model="groupModal.qIds" :value="Number(q.id)" type="checkbox" class="w-4 h-4 mt-0.5 rounded text-brand-600 focus:ring-brand-500" />
                <span class="flex-1 min-w-0 line-clamp-2 text-slate-600 dark:text-slate-300">{{ q.content }}</span>
              </label>
              <p v-if="!groupModalQFiltered.length" class="text-xs text-slate-400 text-center py-3">无匹配问话</p>
            </div>
          </div>
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-sm font-medium text-slate-700 dark:text-slate-200">回答</span>
              <span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">已选 {{ groupModal.aIds.length }}</span>
            </div>
            <div class="relative mb-2">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
              <input v-model="groupModal.aSearch" class="input pl-9 !py-1.5 !text-xs" placeholder="搜索回答内容" />
            </div>
            <div class="max-h-48 overflow-y-auto scrollbar-thin space-y-0.5" style="scrollbar-width: thin">
              <label
                v-for="a in groupModalAFiltered"
                :key="a.id"
                class="flex items-start gap-2 text-xs p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer"
              >
                <input v-model="groupModal.aIds" :value="Number(a.id)" type="checkbox" class="w-4 h-4 mt-0.5 rounded text-brand-600 focus:ring-brand-500" />
                <span class="flex-1 min-w-0 line-clamp-2 text-slate-600 dark:text-slate-300">{{ a.content }}</span>
              </label>
              <p v-if="!groupModalAFiltered.length" class="text-xs text-slate-400 text-center py-3">无匹配回答</p>
            </div>
          </div>
        </div>
        <p class="text-xs text-slate-400">
          共已选 {{ groupModal.qIds.length + groupModal.aIds.length }} 条 · 勾选的问话/回答将在创建时加入该分组；也可创建后在条目上单独管理归属
        </p>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="groupModal.open = false">取消</button>
        <button class="btn-primary" :disabled="busy('group:create') || !groupModal.name.trim()" @click="submitCreateGroup">
          <Icon :name="busy('group:create') ? 'refresh' : 'plus'" :class="busy('group:create') ? 'animate-spin' : ''" />
          创建分组
        </button>
      </template>
    </ModalBase>

    <!-- 分组改名 弹窗 -->
    <ModalBase v-model="renameModal.open" title="编辑分组名称" size="sm">
      <div>
        <label class="label">分组名称 <span class="text-red-500">*</span></label>
        <input v-model="renameModal.name" class="input" maxlength="128" placeholder="分组名称" @keyup.enter="submitRenameGroup" />
      </div>
      <template #footer>
        <button class="btn-secondary" @click="renameModal.open = false">取消</button>
        <button class="btn-primary" :disabled="busy('group:rename') || !renameModal.name.trim()" @click="submitRenameGroup">
          <Icon :name="busy('group:rename') ? 'refresh' : 'check'" :class="busy('group:rename') ? 'animate-spin' : ''" />
          保存
        </button>
      </template>
    </ModalBase>

    <!-- 分组归属管理 弹窗 (编辑模式点击条目分组徽标) -->
    <ModalBase v-model="memberModal.open" title="管理分组归属" size="md">
      <div class="space-y-3">
        <div class="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
          <p class="text-xs text-slate-400 mb-1">条目内容</p>
          <p class="text-sm text-slate-700 dark:text-slate-200 line-clamp-2">{{ memberModal.content }}</p>
        </div>
        <p class="text-xs text-slate-400">勾选 = 加入分组，取消勾选 = 移出分组 (条目本身不受影响)</p>
        <div class="max-h-64 overflow-y-auto scrollbar-thin space-y-1" style="scrollbar-width: thin">
          <label
            v-for="g in groups"
            :key="g.id"
            class="flex items-center gap-2.5 text-sm p-2 rounded-lg border border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer"
          >
            <input
              type="checkbox"
              class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500"
              :checked="isInGroup(Number(g.id), memberModal.type, memberModal.itemId)"
              :disabled="busy(`member:${g.id}:${memberModal.type}:${memberModal.itemId}`)"
              @change="toggleMember(Number(g.id), $event)"
            />
            <Icon name="book" class="text-slate-400 shrink-0" />
            <span class="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200">{{ g.name }}</span>
            <span class="badge shrink-0 bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300">{{ groupMemberCount(Number(g.id)) }} 项</span>
          </label>
          <EmptyState v-if="!groups.length" message="暂无分组，请先在分组列点击「新建分组」" icon="book" />
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="memberModal.open = false">完成</button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import {
  getKbData,
  captureKb,
  updateKbItem,
  deleteKbItem,
  sortKbItem,
  createKbGroup,
  renameKbGroup,
  deleteKbGroup,
  toggleKbGroupMember,
} from '~/api/kb'
import type { KbData, KbGroup, KbItemType, KbQuestion, KbAnswer } from '~/api/kb'

definePageMeta({ layout: 'default' })

const toast = useToast()

const PAGE_SIZE = 20

const loading = ref(false)
const data = ref<KbData | null>(null)
const mode = ref<'browse' | 'edit'>('browse')
const selectedGroupId = ref<number | null>(null)

const isEdit = computed(() => mode.value === 'edit')
const stats = computed(() => data.value?.stats || { groups: 0, questions: 0, answers: 0, ai_hits: 0 })
const groups = computed(() => data.value?.groups || [])

/* ---------- busy 管理 (操作中按钮 loading 态) ---------- */
const busyKeys = ref<Record<string, boolean>>({})
function busy(key: string) {
  return !!busyKeys.value[key]
}
async function run(key: string, fn: () => Promise<void>) {
  if (busyKeys.value[key]) return
  busyKeys.value = { ...busyKeys.value, [key]: true }
  try {
    await fn()
  } catch (e: any) {
    toast.error(e?.message || '操作失败')
  } finally {
    busyKeys.value = { ...busyKeys.value, [key]: false }
  }
}

/* ---------- 数据加载 (所有操作后重新 GET /api/kb) ---------- */
async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    data.value = await getKbData()
    clampPages()
  } catch (e: any) {
    if (!silent) toast.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}
function reload() {
  load()
}

/* ---------- 分组成员映射 ---------- */
function memberKey(groupId: number, type: KbItemType, itemId: number) {
  return `${Number(groupId)}|${type}|${Number(itemId)}`
}
const memberSet = computed(() => {
  const s = new Set<string>()
  for (const m of data.value?.members || []) s.add(memberKey(Number(m.group_id), m.item_type, Number(m.item_id)))
  return s
})
function isInGroup(groupId: number, type: KbItemType, itemId: number) {
  return memberSet.value.has(memberKey(groupId, type, itemId))
}
function itemGroups(type: KbItemType, it: KbQuestion | KbAnswer): KbGroup[] {
  return groups.value.filter((g) => isInGroup(Number(g.id), type, Number(it.id)))
}
function groupMemberCount(groupId: number, type?: KbItemType) {
  return (data.value?.members || []).filter((m) => Number(m.group_id) === groupId && (!type || m.item_type === type)).length
}

/* ---------- 分组选中 / 列表过滤 ---------- */
const selectedGroup = computed(() => groups.value.find((g) => Number(g.id) === Number(selectedGroupId.value)) || null)
function isSelected(g: KbGroup) {
  return Number(selectedGroupId.value) === Number(g.id)
}
function toggleGroup(g: KbGroup) {
  selectedGroupId.value = isSelected(g) ? null : Number(g.id)
  qPage.value = 1
  aPage.value = 1
}
function clearSelection() {
  selectedGroupId.value = null
  qPage.value = 1
  aPage.value = 1
}

const qList = computed(() => {
  const all = data.value?.questions || []
  const gid = selectedGroupId.value
  return gid ? all.filter((q) => isInGroup(gid, 'question', Number(q.id))) : all
})
const aList = computed(() => {
  const all = data.value?.answers || []
  const gid = selectedGroupId.value
  return gid ? all.filter((a) => isInGroup(gid, 'answer', Number(a.id))) : all
})

/* ---------- 前端分页 (每列独立, 每页 20 条) ---------- */
const qPage = ref(1)
const aPage = ref(1)
const gPage = ref(1)
const qTotalPages = computed(() => Math.max(1, Math.ceil(qList.value.length / PAGE_SIZE)))
const aTotalPages = computed(() => Math.max(1, Math.ceil(aList.value.length / PAGE_SIZE)))
const gTotalPages = computed(() => Math.max(1, Math.ceil(groups.value.length / PAGE_SIZE)))
const qPageItems = computed(() => qList.value.slice((qPage.value - 1) * PAGE_SIZE, qPage.value * PAGE_SIZE))
const aPageItems = computed(() => aList.value.slice((aPage.value - 1) * PAGE_SIZE, aPage.value * PAGE_SIZE))
const gPageItems = computed(() => groups.value.slice((gPage.value - 1) * PAGE_SIZE, gPage.value * PAGE_SIZE))
function clampPages() {
  qPage.value = Math.min(Math.max(1, qPage.value), qTotalPages.value)
  aPage.value = Math.min(Math.max(1, aPage.value), aTotalPages.value)
  gPage.value = Math.min(Math.max(1, gPage.value), gTotalPages.value)
}
watch(selectedGroupId, () => {
  qPage.value = 1
  aPage.value = 1
})

/* ---------- 浏览模式: 排序 / 移除 ---------- */
async function moveItem(type: KbItemType, id: number, direction: 'up' | 'down') {
  await run(`sort:${type}:${id}`, async () => {
    const r = await sortKbItem(type, Number(id), direction)
    // useApi 仅透出 data (message 不透出) — 按 moved/direction 复现后端文案
    if (r?.moved) toast.success('排序已更新 (排序即优先级)')
    else toast.info(direction === 'up' ? '已在最前' : '已在最后')
    await load(true)
  })
}

function removeItem(type: KbItemType, it: KbQuestion | KbAnswer) {
  if (!confirm('确认从知识库移除该条目？删除后 AI 不再引用此内容 (分组归属同步清理)。')) return
  run(`del:${type}:${it.id}`, async () => {
    await deleteKbItem(type, Number(it.id))
    toast.success('已删除')
    await load(true)
  })
}

/* ---------- 编辑模式: 新增问话/回答 ---------- */
const captureModal = ref<{ open: boolean; type: KbItemType; content: string }>({ open: false, type: 'question', content: '' })
function openCapture(type: KbItemType) {
  captureModal.value = { open: true, type, content: '' }
}
async function submitCapture() {
  const m = captureModal.value
  const content = m.content.trim()
  if (!content) {
    toast.error('内容不能为空')
    return
  }
  if (content.length > 2000) {
    toast.error('内容过长 (上限 2000 字)')
    return
  }
  await run('capture', async () => {
    const r = await captureKb({ role: m.type, content })
    // 按 duplicated/freq 复现后端文案
    if (r?.duplicated) toast.info(r.freq ? `已存在于知识库, 未重复添加 (频次 +1 → ${r.freq})` : '已存在于知识库, 未重复添加')
    else toast.success('已添加到知识库')
    captureModal.value.open = false
    await load(true)
    // 新条目 sort 排到末尾 → 跳到最后一页便于确认
    if (m.type === 'question') qPage.value = qTotalPages.value
    else aPage.value = aTotalPages.value
  })
}

/* ---------- 编辑模式: 编辑条目内容 ---------- */
const editModal = ref<{ open: boolean; type: KbItemType; id: number; content: string }>({ open: false, type: 'question', id: 0, content: '' })
function openEditItem(type: KbItemType, it: KbQuestion | KbAnswer) {
  editModal.value = { open: true, type, id: Number(it.id), content: it.content }
}
async function submitEditItem() {
  const m = editModal.value
  const content = m.content.trim()
  if (!content) {
    toast.error('内容不能为空')
    return
  }
  await run('edit', async () => {
    await updateKbItem(m.type, m.id, content)
    toast.success('已更新')
    editModal.value.open = false
    await load(true)
  })
}

/* ---------- 编辑模式: 分组 CRUD ---------- */
const groupModal = ref<{ open: boolean; name: string; qIds: number[]; aIds: number[]; qSearch: string; aSearch: string }>({
  open: false,
  name: '',
  qIds: [],
  aIds: [],
  qSearch: '',
  aSearch: '',
})
function openCreateGroup() {
  groupModal.value = { open: true, name: '', qIds: [], aIds: [], qSearch: '', aSearch: '' }
}
function filterBySearch(list: (KbQuestion | KbAnswer)[], kw: string) {
  const k = kw.trim().toLowerCase()
  if (!k) return list
  return list.filter((x) => (x.content || '').toLowerCase().includes(k))
}
const groupModalQFiltered = computed(() => filterBySearch(data.value?.questions || [], groupModal.value.qSearch))
const groupModalAFiltered = computed(() => filterBySearch(data.value?.answers || [], groupModal.value.aSearch))
async function submitCreateGroup() {
  const m = groupModal.value
  const name = m.name.trim()
  if (!name) {
    toast.error('分组名称不能为空')
    return
  }
  await run('group:create', async () => {
    const r = await createKbGroup(name, { questions: m.qIds, answers: m.aIds })
    toast.success(r?.added ? `分组「${name}」已创建, 关联 ${r.added} 条问答` : `分组「${name}」已创建`)
    groupModal.value.open = false
    await load(true)
  })
}

const renameModal = ref<{ open: boolean; id: number; name: string }>({ open: false, id: 0, name: '' })
function openRenameGroup(g: KbGroup) {
  renameModal.value = { open: true, id: Number(g.id), name: g.name }
}
async function submitRenameGroup() {
  const m = renameModal.value
  const name = m.name.trim()
  if (!name) {
    toast.error('分组名称不能为空')
    return
  }
  await run('group:rename', async () => {
    await renameKbGroup(m.id, name)
    toast.success('分组已更新')
    renameModal.value.open = false
    await load(true)
  })
}

function removeGroup(g: KbGroup) {
  if (!confirm(`确认删除分组「${g.name}」？组内问答保留。`)) return
  run(`group:del:${g.id}`, async () => {
    await deleteKbGroup(Number(g.id))
    toast.success('分组已删除 (组内问答保留)')
    if (Number(selectedGroupId.value) === Number(g.id)) selectedGroupId.value = null
    await load(true)
  })
}

/* ---------- 编辑模式: 分组归属管理 ---------- */
const memberModal = ref<{ open: boolean; type: KbItemType; itemId: number; content: string }>({ open: false, type: 'question', itemId: 0, content: '' })
function openMemberModal(type: KbItemType, it: KbQuestion | KbAnswer) {
  memberModal.value = { open: true, type, itemId: Number(it.id), content: it.content }
}
async function toggleMember(groupId: number, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  const m = memberModal.value
  await run(`member:${groupId}:${m.type}:${m.itemId}`, async () => {
    await toggleKbGroupMember(groupId, checked ? 'add' : 'remove', m.type, m.itemId)
    toast.success(checked ? '已加入分组' : '已从分组移除')
    await load(true)
  })
}

/* ---------- 工具 ---------- */
const DOT_COLORS = ['bg-brand-500', 'bg-sky-500', 'bg-emerald-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500']
function dotColor(i: number) {
  return DOT_COLORS[i % DOT_COLORS.length]
}
onMounted(load)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
