import { useApi } from '~/composables/useApi'

export interface Keyword {
  id: number
  cookie_id: string
  keyword: string
  reply: string
  item_id: string
  type: string
  image_url: string | null
  created_at: string
  item_title?: string | null
}

export interface CreateKeywordPayload {
  keyword: string
  reply: string
  item_id: string
  type: string
  image_url: string
}

export type UpdateKeywordPayload = CreateKeywordPayload

export interface KeywordTestResult {
  matched: any[]
  total: number
  hasDefaultReply: boolean
  defaultReply: string
}

export interface KeywordImportResult {
  inserted: number
}

export interface KeywordExportResult {
  keywords: Keyword[]
  count: number
}

export function getKeywords(cookieId: string) {
  return useApi().get<Keyword[]>(`/api/keywords/${encodeURIComponent(cookieId)}`)
}

export function createKeyword(cookieId: string, body: CreateKeywordPayload) {
  return useApi().post(`/api/keywords/${encodeURIComponent(cookieId)}`, body)
}

export function updateKeyword(cookieId: string, index: number, body: UpdateKeywordPayload) {
  return useApi().put(`/api/keywords/${encodeURIComponent(cookieId)}/${index}`, body)
}

export function deleteKeyword(cookieId: string, index: number) {
  return useApi().del(`/api/keywords/${encodeURIComponent(cookieId)}/${index}`)
}

export function testKeywordMatch(body: { cookie_id: string; message: string }) {
  return useApi().post<KeywordTestResult>('/api/keywords/test', body)
}

export function importKeywords(cookieId: string, keywords: any[]) {
  return useApi().post<KeywordImportResult>(`/api/keywords-import/${encodeURIComponent(cookieId)}`, { keywords })
}

export function exportKeywords(cookieId: string) {
  return useApi().get<KeywordExportResult>(`/api/keywords-export/${encodeURIComponent(cookieId)}`)
}
