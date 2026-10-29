/**
 * useThemeColor — multi-theme color management.
 * Themes: amber (default), teal, rose, emerald, slate, sky.
 * Persists to localStorage + system_settings (single source of truth).
 * Applies via CSS custom property override on :root.
 */

export type ThemeColor = 'amber' | 'teal' | 'rose' | 'emerald' | 'slate' | 'sky'

interface ThemeDef {
  key: ThemeColor
  label: string
  // Tailwind-equivalent hex values for brand-500/600/700
  500: string
  600: string
  700: string
}

export const THEMES: ThemeDef[] = [
  { key: 'amber', label: '琥珀', 500: '#f59e0b', 600: '#d97706', 700: '#b45309' },
  { key: 'teal', label: '青色', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e' },
  { key: 'rose', label: '玫红', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c' },
  { key: 'emerald', label: '翠绿', 500: '#10b981', 600: '#059669', 700: '#047857' },
  { key: 'sky', label: '天蓝', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1' },
]

const THEME_KEY = 'xianyu_theme_color'

export function useThemeColor() {
  const current = useState<ThemeColor>('theme_color', () => 'amber')

  function apply(theme: ThemeColor) {
    current.value = theme
    if (import.meta.client) {
      const def = THEMES.find((t) => t.key === theme) || THEMES[0]
      const root = document.documentElement
      root.style.setProperty('--brand-500', def[500])
      root.style.setProperty('--brand-600', def[600])
      root.style.setProperty('--brand-700', def[700])
      localStorage.setItem(THEME_KEY, theme)
      // Override Tailwind's brand color classes via a style element
      let styleEl = document.getElementById('theme-override')
      if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.id = 'theme-override'
        document.head.appendChild(styleEl)
      }
      styleEl.textContent = `
        .bg-brand-500 { background-color: ${def[500]} !important; }
        .bg-brand-600 { background-color: ${def[600]} !important; }
        .bg-brand-700 { background-color: ${def[700]} !important; }
        .text-brand-500 { color: ${def[500]} !important; }
        .text-brand-600 { color: ${def[600]} !important; }
        .text-brand-700 { color: ${def[700]} !important; }
        .border-brand-400 { border-color: ${def[500]} !important; }
        .border-brand-500 { border-color: ${def[500]} !important; }
        .focus\\:ring-brand-500:focus { --tw-ring-color: ${def[500]} !important; }
        .hover\\:bg-brand-600:hover { background-color: ${def[600]} !important; }
        .hover\\:bg-brand-700:hover { background-color: ${def[700]} !important; }
        .hover\\:border-brand-400:hover { border-color: ${def[500]} !important; }
      `
    }
  }

  function init() {
    if (import.meta.client) {
      const saved = localStorage.getItem(THEME_KEY) as ThemeColor | null
      if (saved && THEMES.some((t) => t.key === saved)) {
        apply(saved)
      }
    }
  }

  return { current, themes: THEMES, apply, init }
}
