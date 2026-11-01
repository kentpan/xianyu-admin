/**
 * Backup API — 备份管理 (v2.1.15)。
 * 表清单/导出下载/定时配置/立即备份/备份列表/下载/导入/删除。
 */
import { useApi } from '~/composables/useApi'

export interface BackupTableInfo {
  name: string
  rows: number
}

export interface BackupConfigInfo {
  enabled: boolean
  interval_days: number
  hour: number
  minute: number
  second: number
  tables: string
  last_run_at: string
  cron_token: string
}

export interface BackupObjectInfo {
  key: string
  size: number
  modified_at: string
}

export function getBackupTables() {
  return useApi().get<{ tables: BackupTableInfo[]; driver: string }>('/api/admin/backup/tables')
}

/** 导出下载地址 (直接触发浏览器下载, Cookie 同源自动携带)。 */
export function backupExportUrl(tables: string, format: 'sql' | 'db' | 'json'): string {
  const basePath = useRuntimeConfig().public.basePath || ''
  const qs = new URLSearchParams({ tables, format })
  return `${basePath}/api/admin/backup/export?${qs.toString()}`
}

export function getBackupConfig() {
  return useApi().get<{ config: BackupConfigInfo; storage: string; storage_error: string; next_due: string; storage_settings?: { driver: string; configured: boolean; missing: string; cdn_base_url: string } }>(
    '/api/admin/backup/config',
  )
}

export function updateBackupConfig(payload: {
  enabled?: boolean
  interval_days?: number
  hour?: number
  minute?: number
  second?: number
  tables?: string
  generate_cron_token?: boolean
}) {
  return useApi().put<{ config: BackupConfigInfo }>('/api/admin/backup/config', payload)
}

export function runBackupNow() {
  return useApi().post<{ backup: { key: string; size: number; storage: string; tables: string[]; rows: number } }>(
    '/api/admin/backup/run',
  )
}

export function listBackups() {
  return useApi().get<{ driver: string; storage: string; items: BackupObjectInfo[] }>('/api/admin/backup/list')
}

export function deleteBackup(key: string) {
  return useApi().del(`/api/admin/backup/${encodeURIComponent(key)}`)
}

export function restoreBackup(key: string) {
  return useApi().post<{ key: string; report: Record<string, { inserted: number; updated: number; skipped: number }> }>(
    `/api/admin/backup/${encodeURIComponent(key)}/restore`,
  )
}

/** 备份对象下载地址 (原始字节流, Cookie 同源自动携带)。 */
export function backupDownloadUrl(key: string): string {
  const basePath = useRuntimeConfig().public.basePath || ''
  return `${basePath}/api/admin/backup/${encodeURIComponent(key)}/download`
}
