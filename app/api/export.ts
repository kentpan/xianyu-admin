import { useApi } from '~/composables/useApi'

export interface ExportCsvPayload {
  filename: string
  headers: string[]
  rows: any[][]
}

export function exportCsv(body: ExportCsvPayload) {
  // The CSV endpoint returns a raw CSV string (no success envelope); useApi passes it through.
  return useApi().post<string>('/api/export/csv', body)
}
