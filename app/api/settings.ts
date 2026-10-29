import { useApi } from '~/composables/useApi'

export interface PublicSettingsResponse {
  settings: Record<string, any>
}

export interface SettingsExportResponse {
  settings: Record<string, any>
  exportedAt: string
  version: string
}

export interface SettingsImportResult {
  imported: number
  skipped: number
}

export interface SettingRow {
  key_name: string
  value: string
  description?: string
  updated_at?: string
}

/** 管理端: 读取全部系统设置 (含密钥字段, 需管理员) */
export function getAllSettings() {
  return useApi().get<SettingRow[]>('/api/settings')
}

export function getPublicSettings() {
  return useApi().get<PublicSettingsResponse>('/api/settings/public')
}

export function exportSettings() {
  return useApi().get<SettingsExportResponse>('/api/settings/export')
}

export function importSettings(settings: Record<string, any>) {
  return useApi().post<SettingsImportResult>('/api/settings/import', { settings })
}

export function updateSetting(key: string, value: any) {
  return useApi().put(`/api/settings/${encodeURIComponent(key)}`, { value })
}
