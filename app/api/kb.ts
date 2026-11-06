/**
 * AI 知识库 API (v2.3.0) — /api/kb
 *
 * 后端统一响应 { success, code, message, data }；useApi 解包后仅返回 data，
 * message 不随返回值透出 —— 需要后端文案的提示（「已在最前」「频次 +1」等）
 * 由调用方依据 data 字段 (moved / duplicated / freq / added) 复现同款文案，
 * 见 app/pages/knowledge-base.vue。
 */
import { useApi } from '~/composables/useApi'

export type KbItemType = 'question' | 'answer'

/** 分组 (sort 即分组展示顺序) */
export interface KbGroup {
  id: number
  name: string
  sort: number
  created_at: string
  updated_at: string
}

/** 问话条目 (买家消息沉淀, sort 升序 = 优先级, 越小越优先) */
export interface KbQuestion {
  id: number
  content: string
  source_message_id: string
  source_chat_id: string
  source_cookie_id: string
  item_id: string
  buyer_id: string
  /** 重复添加次数 (频次作置信度依据) */
  freq: number
  sort: number
  /** AI 回复命中引用次数 */
  ai_hit_count: number
  ai_last_used_at: string | null
  created_at: string
  updated_at: string
}

/** 回答条目 (卖家消息/话术沉淀) */
export interface KbAnswer {
  id: number
  content: string
  source_message_id: string
  source_chat_id: string
  source_cookie_id: string
  item_id: string
  /** 0/1 — 是否 AI 生成的回答 */
  is_ai_generated: number
  freq: number
  sort: number
  ai_hit_count: number
  ai_last_used_at: string | null
  created_at: string
  updated_at: string
}

/** 分组 ↔ 条目 成员映射 */
export interface KbMember {
  group_id: number
  item_type: KbItemType
  item_id: number
}

export interface KbStats {
  groups: number
  questions: number
  answers: number
  ai_hits: number
}

/** GET /api/kb 全量数据 (知识库为人工精选规模, 全量拉取 + 前端分页) */
export interface KbData {
  groups: KbGroup[]
  questions: KbQuestion[]
  answers: KbAnswer[]
  members: KbMember[]
  /** 已添加到知识库的 source_message_id 集合 (消息管理页「已添加 ✅」标志依据) */
  captured: string[]
  stats: KbStats
}

/** POST /api/kb/capture 入参 (消息管理页手动添加 / 本页新增) */
export interface KbCapturePayload {
  role: KbItemType
  content: string
  source_message_id?: string
  source_chat_id?: string
  source_cookie_id?: string
  item_id?: string
  buyer_id?: string
  is_ai_generated?: boolean
}

/** capture 返回: duplicated=true 表示命中去重 (未新增, 频次 +1) */
export interface KbCaptureResult {
  duplicated: boolean
  id?: number
  freq?: number
}

/** sort 返回: moved=false 表示已在最前/最后 (未移动) */
export interface KbSortResult {
  moved: boolean
}

/** POST /api/kb/groups 建组时可一次性勾选加入的条目 */
export interface KbGroupItemIds {
  questions?: number[]
  answers?: number[]
}

/** GET /api/kb — 全量数据 (分组/问话/回答按 sort 升序) */
export function getKbData() {
  return useApi().get<KbData>('/api/kb')
}

/** POST /api/kb/capture — 添加内容 (重复内容自动去重, freq+1) */
export function captureKb(body: KbCapturePayload) {
  return useApi().post<KbCaptureResult>('/api/kb/capture', body)
}

/** capture-remove 返回: removed=删除条目数 */
export interface KbCaptureRemoveResult {
  removed: number
}

/** POST /api/kb/capture-remove — 从知识库移除 (消息管理页 ✅ → + toggle, v2.3.1) */
export function removeKbCapture(sourceMessageId: string, role?: KbItemType) {
  return useApi().post<KbCaptureRemoveResult>('/api/kb/capture-remove', {
    source_message_id: sourceMessageId,
    role,
  })
}

/** PUT /api/kb/items/:type/:id — 编辑条目内容 */
export function updateKbItem(type: KbItemType, id: number, content: string) {
  return useApi().put<{ id: number }>(`/api/kb/items/${type}/${id}`, { content })
}

/** DELETE /api/kb/items/:type/:id — 删除条目 (分组归属同步清理) */
export function deleteKbItem(type: KbItemType, id: number) {
  return useApi().del<{ id: number }>(`/api/kb/items/${type}/${id}`)
}

/** POST /api/kb/sort — 上移/下移 (排序即优先级) */
export function sortKbItem(type: KbItemType, id: number, direction: 'up' | 'down') {
  return useApi().post<KbSortResult>('/api/kb/sort', { type, id, direction })
}

/** POST /api/kb/groups — 新建分组 (可一次性勾选问话/回答加入) */
export function createKbGroup(name: string, itemIds?: KbGroupItemIds) {
  return useApi().post<{ id: number; added: number }>('/api/kb/groups', { name, item_ids: itemIds })
}

/** PUT /api/kb/groups/:id — 分组改名 */
export function renameKbGroup(id: number, name: string) {
  return useApi().put<{ id: number }>(`/api/kb/groups/${id}`, { name })
}

/** DELETE /api/kb/groups/:id — 删除分组 (组内问答保留) */
export function deleteKbGroup(id: number) {
  return useApi().del<{ id: number }>(`/api/kb/groups/${id}`)
}

/** POST /api/kb/groups/:id/members — 分组成员 add/remove */
export function toggleKbGroupMember(groupId: number, action: 'add' | 'remove', itemType: KbItemType, itemId: number) {
  return useApi().post<{ groupId: number; itemId: number }>(`/api/kb/groups/${groupId}/members`, {
    action,
    item_type: itemType,
    item_id: itemId,
  })
}
