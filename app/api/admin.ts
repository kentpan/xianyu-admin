import { useApi } from '~/composables/useApi'

// ===================== Users =====================

export interface AdminUser {
  id: number
  username: string
  email: string
  is_active: number
  is_admin: number
  created_at: string
}

export function getAdminUsers() {
  return useApi().get<AdminUser[]>('/api/admin/users')
}

export function updateAdminUser(id: number, body: Partial<AdminUser>) {
  return useApi().put(`/api/admin/users/${id}`, body)
}

export function toggleUserActive(id: number, is_active: boolean) {
  return useApi().put(`/api/admin/users/${id}`, { is_active })
}

export function toggleUserAdmin(id: number, is_admin: boolean) {
  return useApi().put(`/api/admin/users/${id}`, { is_admin })
}

export function deleteAdminUser(id: number) {
  return useApi().del(`/api/admin/users/${id}`)
}

// ===================== Logs =====================

export interface AdminLog {
  id: number
  level: string
  module: string | null
  message: string
  meta: string | null
  user_id: number | null
  created_at: string
}

export interface LogQuery {
  page?: number
  pageSize?: number
  level?: string
  module?: string
  keyword?: string
}

export interface LogListResponse {
  data: AdminLog[]
  total: number
  page: number
  pageSize: number
}

export interface LogStatsResponse {
  stats: Record<string, number>
  total: number
}

export function getAdminLogs(query: LogQuery = {}) {
  const qs = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '' && v !== null)
      .reduce<Record<string, string>>((acc, [k, v]) => {
        acc[k] = String(v)
        return acc
      }, {}),
  ).toString()
  return useApi().get<LogListResponse>(`/api/admin/logs?${qs}`)
}

export function getAdminLogStats() {
  return useApi().get<LogStatsResponse>('/api/admin/logs/stats')
}

export function clearAdminLogs(level?: string) {
  return useApi().post('/api/admin/logs/clear', level ? { level } : {})
}

// ===================== Risk Logs =====================

export interface RiskLog {
  id: number
  cookie_id: string
  event_type: string
  event_description: string | null
  processing_result: string | null
  processing_status: string
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface RiskLogQuery {
  page?: number
  pageSize?: number
  cookie_id?: string
  status?: string
}

export interface RiskLogListResponse {
  data: RiskLog[]
  total: number
  page: number
  pageSize: number
}

export function getRiskLogs(query: RiskLogQuery = {}) {
  const qs = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '' && v !== null)
      .reduce<Record<string, string>>((acc, [k, v]) => {
        acc[k] = String(v)
        return acc
      }, {}),
  ).toString()
  return useApi().get<RiskLogListResponse>(`/api/admin/risk-logs?${qs}`)
}

export function deleteRiskLog(id: number) {
  return useApi().del(`/api/admin/risk-logs/${id}`)
}

// ===================== Data / Backup =====================

export interface TableInfo {
  name: string
  rows: number
}

export interface TableListResponse {
  tables: TableInfo[]
  total: number
}

export interface TableQuery {
  page?: number
  pageSize?: number
}

export interface TableDataResponse {
  columns: string[]
  rows: any[]
  total: number
  page: number
  pageSize: number
}

export interface BackupImportReport {
  report: Record<string, { inserted: number; updated: number; skipped: number }>
}

export function getAdminTables() {
  return useApi().get<TableListResponse>('/api/admin/data')
}

export function getAdminTableData(table: string, query: TableQuery = {}) {
  const qs = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '' && v !== null)
      .reduce<Record<string, string>>((acc, [k, v]) => {
        acc[k] = String(v)
        return acc
      }, {}),
  ).toString()
  return useApi().get<TableDataResponse>(`/api/admin/data/${encodeURIComponent(table)}?${qs}`)
}

export function deleteAdminRow(table: string, pk: string) {
  return useApi().del(`/api/admin/data/${encodeURIComponent(table)}/${encodeURIComponent(pk)}`)
}

export function truncateAdminTable(table: string) {
  return useApi().del(`/api/admin/data/${encodeURIComponent(table)}`, { body: { confirm: true } })
}

export function exportBackup() {
  return useApi().get<any>('/api/admin/backup/export')
}

export function importBackup(payload: any) {
  return useApi().post<BackupImportReport>('/api/admin/backup/import', payload)
}

// ===================== Settlement Records =====================

export interface AdminSettlementRecord {
  id: number
  user_id: number
  payment_type: string
  payment_qrcode: string | null
  alipay_id: string | null
  amount: string
  status: string
  remark: string | null
  reject_reason: string | null
  created_at: string
  updated_at: string | null
  username?: string | null
  email?: string | null
}

export interface SettlementQuery {
  page?: number
  page_size?: number
  status?: string
  search?: string
}

export interface SettlementListResponse {
  items: AdminSettlementRecord[]
  total: number
  page: number
  page_size: number
}

export function getAdminSettlementRecords(query: SettlementQuery = {}) {
  const params = new URLSearchParams()
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.page_size !== undefined) params.set('page_size', String(query.page_size))
  if (query.status) params.set('status', query.status)
  if (query.search) params.set('search', query.search)
  return useApi().get<SettlementListResponse>(`/api/admin/settlement-records?${params.toString()}`)
}

export function approveSettlementRecord(id: number) {
  return useApi().put(`/api/admin/settlement-records/${id}`, { status: 'approved' })
}

export function rejectSettlementRecord(id: number, reject_reason?: string) {
  return useApi().put(`/api/admin/settlement-records/${id}`, {
    status: 'rejected',
    reject_reason: reject_reason || undefined,
  })
}

export function markSettlementPaid(id: number) {
  return useApi().put(`/api/admin/settlement-records/${id}`, { status: 'paid' })
}
