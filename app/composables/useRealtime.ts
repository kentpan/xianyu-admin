/**
 * useRealtime — 管理后台实时推送统一客户端 (自动选择传输形态)。
 *
 *   edge (DO hub 部署)  → WebSocket /api/realtime/ws  (Durable Object 广播, hibernation)
 *   node (进程内总线)   → SSE      /api/messages/stream (行为与 v2.0.3 一致)
 *
 * 传输形态由 /api/system/status 的 realtime 字段决定, 仅首连询问一次;
 * WS 握手失败(如部署形态不带 DO)自动永久回落 SSE, 断线指数退避重连。
 * 事件载荷两种形态同构: { type, cookie_id, chat_id, message? }。
 */
export interface RealtimeEvent {
  type: 'chat' | 'system' | 'conversation' | 'sent'
  cookie_id?: string
  chat_id?: string
  message?: Record<string, any>
  [key: string]: any
}

export type RealtimeStatus = 'connecting' | 'open' | 'closed'

export function useRealtime() {
  const status = ref<RealtimeStatus>('closed')
  const handlers = new Set<(e: RealtimeEvent) => void>()

  let mode: 'ws' | 'sse' = 'sse'
  let ws: WebSocket | null = null
  let es: EventSource | null = null
  let wsOpened = false
  let retry = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = true

  function emit(e: RealtimeEvent) {
    for (const fn of [...handlers]) {
      try {
        fn(e)
      } catch {}
    }
  }

  function scheduleRetry() {
    if (stopped) return
    status.value = 'closed'
    const delay = Math.min(30_000, 1000 * 2 ** retry++)
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = null
      connect()
    }, delay)
  }

  function connectWs(base: string) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    try {
      ws = new WebSocket(`${proto}://${location.host}${base}/api/realtime/ws`)
    } catch {
      mode = 'sse'
      connect()
      return
    }
    ws.onopen = () => {
      wsOpened = true
      retry = 0
      status.value = 'open'
    }
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}')
        if (d?.type === 'pong' || d?.type === 'ready') return
        emit(d)
      } catch {}
    }
    ws.onclose = () => {
      ws = null
      if (stopped) return
      if (!wsOpened) {
        // WS 从未成功建立 (部署形态不带 DO / 网关不支持) → 永久回落 SSE
        mode = 'sse'
        connect()
        return
      }
      scheduleRetry()
    }
    ws.onerror = () => {
      try {
        ws?.close()
      } catch {}
    }
  }

  function connectSse(base: string) {
    try {
      es = new EventSource(`${base}/api/messages/stream`)
    } catch {
      scheduleRetry()
      return
    }
    es.onopen = () => {
      retry = 0
      status.value = 'open'
    }
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}')
        if (d.hb) {
          status.value = 'open'
          return
        }
        emit(d)
      } catch {}
    }
    // EventSource 原生自动重连, 这里只同步状态
    es.onerror = () => {
      if (!stopped) status.value = 'closed'
    }
  }

  async function connect() {
    if (!import.meta.client) return
    stopped = false
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    status.value = 'connecting'
    const base = (useRuntimeConfig().public.basePath as string) || ''
    if (mode === 'sse') {
      connectSse(base)
      return
    }
    if (ws) return
    // 首连询问服务端实时通道形态 (带 DO hub 的 edge 部署 → ws, 其余 → sse)
    try {
      const r: any = await $fetch(`${base}/api/system/status`)
      if (stopped) return
      mode = r?.data?.realtime === 'ws' ? 'ws' : 'sse'
    } catch {
      if (stopped) return
      mode = 'sse'
    }
    if (mode === 'ws') connectWs(base)
    else connectSse(base)
  }

  function disconnect() {
    stopped = true
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    try {
      ws?.close()
    } catch {}
    ws = null
    try {
      es?.close()
    } catch {}
    es = null
    status.value = 'closed'
  }

  if (getCurrentScope()) onScopeDispose(disconnect)

  return {
    status,
    connect,
    disconnect,
    on(fn: (e: RealtimeEvent) => void) {
      handlers.add(fn)
      return () => handlers.delete(fn)
    },
  }
}
