/**
 * AI 知识库 API (v2.4.0 商品分组模型) — /api/kb
 *
 * 分组 = 商品组: 成员是商品 (cookie_id + item_id), 多账号商品可同组, 同一商品可进多组。
 * AI 回复时按当前商品所属分组聚合读取组内全部商品的历史真实对话作知识库
 * (买家=客户 / 卖家, 排除自动发货回复与系统消息)。
 *
 * 后端统一响应 { success, code, message, data }；useApi 解包后仅返回 data。
 */
import { useApi } from '~/composables/useApi'

/** 分组 (sort 即分组展示顺序) */
export interface KbGroup {
  id: number
  name: string
  sort: number
  created_at: string
  updated_at: string
}

/** 分组成员商品 (跨账号, LEFT JOIN 补齐展示字段) */
export interface KbGroupMemberItem {
  id: number
  group_id: number
  cookie_id: string
  item_id: string
  item_title: string
  cookie_remark: string
  created_at: string
}

/** GET /api/kb 全量数据 (分组/成员为人工精选规模, 全量拉取 + 前端渲染) */
export interface KbData {
  groups: KbGroup[]
  members: KbGroupMemberItem[]
  stats: { groups: number; members: number }
}

/** GET /api/kb — 全量数据 (分组按 sort 升序, 成员按分组聚合) */
export function getKbData() {
  return useApi().get<KbData>('/api/kb')
}

/** POST /api/kb/groups — 新建分组 */
export function createKbGroup(name: string) {
  return useApi().post<{ id: number }>('/api/kb/groups', { name })
}

/** PUT /api/kb/groups/:id — 分组改名 */
export function renameKbGroup(id: number, name: string) {
  return useApi().put<{ id: number }>(`/api/kb/groups/${id}`, { name })
}

/** DELETE /api/kb/groups/:id — 删除分组 (商品成员映射级联清理, 商品本身保留) */
export function deleteKbGroup(id: number) {
  return useApi().del<{ id: number }>(`/api/kb/groups/${id}`)
}

/** POST /api/kb/sort — 分组上移/下移 */
export function sortKbGroup(id: number, direction: 'up' | 'down') {
  return useApi().post<{ moved: boolean }>('/api/kb/sort', { id, direction })
}

/** POST /api/kb/group-items — 商品加入/移出分组 (同一商品允许加入多个分组) */
export function toggleKbGroupItem(
  groupId: number,
  cookieId: string,
  itemId: string,
  action: 'add' | 'remove',
) {
  return useApi().post<{ groupId: number; cookieId: string; itemId: string }>('/api/kb/group-items', {
    group_id: groupId,
    cookie_id: cookieId,
    item_id: itemId,
    action,
  })
}

/** GET /api/kb/item-groups — 单个商品所属分组列表 (商品级 AI 配置弹窗用) */
export function getItemKbGroups(cookieId: string, itemId: string) {
  return useApi().get<{ groups: { id: number; name: string }[] }>(
    `/api/kb/item-groups?cookie_id=${encodeURIComponent(cookieId)}&item_id=${encodeURIComponent(itemId)}`,
  )
}
