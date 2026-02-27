import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'
import './app.css'

const app = createApp(App)
app.use(router)
app.mount('#app')

// Auto-run sentinel E2E tests if HTTP test server is detected (iOS test mode)
import { Capacitor } from '@capacitor/core'
if (Capacitor.isNativePlatform()) {
  import('./lib/sentinel-e2e.js').then((m) => m.runSentinelE2E?.()).catch(() => {})
}
