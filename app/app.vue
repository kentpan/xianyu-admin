<template>
  <div>
    <NuxtLayout>
      <NuxtPage :transition="{ name: 'page', mode: 'out-in', appear: true }" />
    </NuxtLayout>
    <ToastContainer />
  </div>
</template>

<script setup lang="ts">
// Dark mode bootstrap (persisted in localStorage)
const colorMode = useState<'light' | 'dark'>('color_mode', () => 'light')
onMounted(() => {
  const saved = localStorage.getItem('color_mode')
  if (saved === 'dark' || saved === 'light') colorMode.value = saved
  else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) colorMode.value = 'dark'
  applyColorMode()
})
watch(colorMode, applyColorMode)
function applyColorMode() {
  if (import.meta.client) {
    document.documentElement.classList.toggle('dark', colorMode.value === 'dark')
    localStorage.setItem('color_mode', colorMode.value)
  }
}
provide('colorMode', colorMode)

// Theme color bootstrap
const { init: initTheme } = useThemeColor()
onMounted(initTheme)
</script>
