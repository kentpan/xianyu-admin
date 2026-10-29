/**
 * useBreadcrumbs — generates breadcrumb items from the current route.
 * Uses NAV_ITEMS (single source of truth) for labels + icons, with special
 * handling for admin sub-pages and detail/edit routes.
 */
import { NAV_ITEMS } from './useNav'

const LABEL_MAP: Record<string, { label: string; icon?: string }> = {}
for (const item of NAV_ITEMS) {
  LABEL_MAP[item.path] = { label: item.label, icon: item.icon }
}

export function useBreadcrumbs() {
  const route = useRoute()

  const items = computed(() => {
    const path = route.path
    const segs = path.split('/').filter(Boolean)
    if (!segs.length) return [{ label: '首页', icon: 'dashboard' }]

    const result: { label: string; icon?: string; to?: string }[] = [
      { label: '首页', icon: 'dashboard', to: '/dashboard' },
    ]

    let acc = ''
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      acc += '/' + seg
      const meta = LABEL_MAP[acc]
      // Handle dynamic params (e.g. /admin/users/123 → treat last seg as detail)
      const isLast = i === segs.length - 1
      const nextSeg = segs[i + 1]

      if (meta) {
        result.push({
          label: meta.label,
          icon: meta.icon,
          to: isLast ? undefined : acc,
        })
      } else if (/^\d+$/.test(seg) || seg.startsWith('ord_') || seg.startsWith('acc_') || seg.startsWith('item_')) {
        // Numeric/id-looking segment → "详情"
        result.push({ label: '详情', to: isLast ? undefined : acc })
      } else if (seg === 'admin') {
        result.push({ label: '管理', icon: 'shield', to: isLast ? undefined : acc })
      } else {
        // Unknown segment → capitalize
        result.push({ label: seg.charAt(0).toUpperCase() + seg.slice(1), to: isLast ? undefined : acc })
      }
    }

    return result
  })

  return { items }
}
