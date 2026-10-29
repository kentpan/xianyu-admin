import { useApi } from '~/composables/useApi'

export interface SystemStatusResponse {
  installed?: boolean
  runtime: 'node' | 'cloudflare'
}

export function getSystemStatus() {
  return useApi().get<SystemStatusResponse>('/api/system/status')
}
