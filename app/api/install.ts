import { useApi } from '~/composables/useApi'

export interface InstallForm {
  dbDriver: string
  dbUrl?: string
  dbHost?: string
  dbPort?: string
  dbUser?: string
  dbPassword?: string
  dbName?: string
  adminSecret: string
  jwtSecret: string
  adminUsername: string
  adminEmail: string
  adminPassword: string
  cfAccountId?: string
  cfApiToken?: string
  cfProjectName?: string
  [key: string]: any
}

export interface InstallResponse {
  runtime: string
  message?: string
}

export function installSystem(body: InstallForm) {
  return useApi().post<InstallResponse>('/api/install', body)
}
