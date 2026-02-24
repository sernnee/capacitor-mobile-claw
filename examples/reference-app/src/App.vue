<template>
  <div class="h-full bg-background text-foreground">
    <router-view />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { isNative } from '@/lib/platform.js'

onMounted(async () => {
  if (!isNative) return

  try {
    // Status bar
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setBackgroundColor({ color: '#0d0d0d' })
  } catch { /* web fallback */ }

  try {
    // Splash screen
    const { SplashScreen } = await import('@capacitor/splash-screen')
    setTimeout(() => SplashScreen.hide(), 2500)
  } catch { /* web fallback */ }

  try {
    // Keyboard tracking
    const { Keyboard } = await import('@capacitor/keyboard')
    Keyboard.addListener('keyboardWillShow', (info) => {
      document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`)
      document.body.classList.add('keyboard-open')
    })
    Keyboard.addListener('keyboardWillHide', () => {
      document.documentElement.style.setProperty('--keyboard-height', '0px')
      document.body.classList.remove('keyboard-open')
    })
  } catch { /* web fallback */ }
})
</script>
