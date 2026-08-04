/** Lightweight toast store (no external dep). */
export interface ToastItem {
  id: number
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
}

let _id = 0

export function useToast() {
  const toasts = useState<ToastItem[]>('toasts', () => [])

  function push(type: ToastItem['type'], message: string, duration = 3000) {
    const id = ++_id
    toasts.value = [...toasts.value, { id, type, message }]
    if (import.meta.client) {
      setTimeout(() => {
        toasts.value = toasts.value.filter((t) => t.id !== id)
      }, duration)
    }
  }
  return {
    toasts,
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
    info: (m: string) => push('info', m),
    warning: (m: string) => push('warning', m),
  }
}
