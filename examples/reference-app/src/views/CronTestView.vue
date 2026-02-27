<template>
  <div
    class="h-full overflow-y-auto"
    style="padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px)"
  >
    <div class="max-w-lg mx-auto px-4 pt-16 pb-12 md:pt-6">

      <!-- Header -->
      <div class="flex items-center gap-3 mb-6">
        <button
          class="flex items-center justify-center w-8 h-8 rounded-lg
                 text-muted-foreground transition-colors duration-150
                 hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.95]"
          @click="$router.back()"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
               stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 3L5 8l5 5"/>
          </svg>
        </button>
        <h1 class="text-lg font-semibold text-foreground">MobileCron Test</h1>
      </div>

      <!-- Status Card -->
      <div class="mb-5 bg-card/80 backdrop-blur-xl border border-border/50 rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.15)]">
        <h2 class="text-sm font-medium text-muted-foreground mb-2">Plugin Status</h2>
        <pre class="text-xs text-foreground whitespace-pre-wrap break-words">{{ statusText }}</pre>
      </div>

      <!-- Actions -->
      <div class="space-y-3 mb-5">
        <button @click="registerJob" class="w-full px-4 py-3 bg-blue-600 text-white rounded-xl text-sm font-medium active:scale-[0.98]">
          Register 60s Job
        </button>
        <button @click="listJobs" class="w-full px-4 py-3 bg-indigo-600 text-white rounded-xl text-sm font-medium active:scale-[0.98]">
          List Jobs
        </button>
        <button @click="triggerFirst" class="w-full px-4 py-3 bg-green-600 text-white rounded-xl text-sm font-medium active:scale-[0.98]">
          Trigger First Job
        </button>
        <button @click="pauseToggle" class="w-full px-4 py-3 bg-amber-600 text-white rounded-xl text-sm font-medium active:scale-[0.98]">
          {{ isPaused ? 'Resume All' : 'Pause All' }}
        </button>
        <button @click="cycleMode" class="w-full px-4 py-3 bg-purple-600 text-white rounded-xl text-sm font-medium active:scale-[0.98]">
          Mode: {{ currentMode }} (tap to cycle)
        </button>
        <button @click="unregisterAll" class="w-full px-4 py-3 bg-red-600 text-white rounded-xl text-sm font-medium active:scale-[0.98]">
          Unregister All Jobs
        </button>
        <button @click="refreshStatus" class="w-full px-4 py-3 bg-gray-600 text-white rounded-xl text-sm font-medium active:scale-[0.98]">
          Refresh Status
        </button>
      </div>

      <!-- Event Log -->
      <div class="bg-card/80 backdrop-blur-xl border border-border/50 rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.15)]">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-sm font-medium text-muted-foreground">Event Log</h2>
          <button @click="logs = []" class="text-xs text-muted-foreground hover:text-foreground">Clear</button>
        </div>
        <div class="max-h-64 overflow-y-auto space-y-1">
          <div v-for="(log, i) in logs" :key="i" class="text-xs font-mono text-foreground/80">
            <span class="text-muted-foreground">{{ log.time }}</span> {{ log.msg }}
          </div>
          <div v-if="logs.length === 0" class="text-xs text-muted-foreground italic">No events yet</div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { MobileCron } from 'capacitor-mobilecron'

const statusText = ref('Loading...')
const logs = ref([])
const isPaused = ref(false)
const currentMode = ref('balanced')
const jobIds = ref([])
const listeners = []

const modes = ['eco', 'balanced', 'aggressive']

function addLog(msg) {
  const now = new Date()
  const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  logs.value.unshift({ time, msg })
  if (logs.value.length > 100) logs.value.length = 100
}

async function refreshStatus() {
  try {
    const s = await MobileCron.getStatus()
    statusText.value = JSON.stringify(s, null, 2)
    isPaused.value = s.paused
    currentMode.value = s.mode
  } catch (e) {
    statusText.value = `Error: ${e.message}`
    addLog(`getStatus error: ${e.message}`)
  }
}

async function registerJob() {
  try {
    const result = await MobileCron.register({
      name: `test-job-${Date.now()}`,
      schedule: { kind: 'every', everyMs: 60000 },
      data: { created: new Date().toISOString() }
    })
    jobIds.value.push(result.id)
    addLog(`Registered job: ${result.id}`)
    await refreshStatus()
  } catch (e) {
    addLog(`register error: ${e.message}`)
  }
}

async function listJobs() {
  try {
    const { jobs } = await MobileCron.list()
    addLog(`Jobs (${jobs.length}):`)
    for (const j of jobs) {
      addLog(`  ${j.id.slice(0, 8)} | ${j.name} | enabled=${j.enabled} | skips=${j.consecutiveSkips}`)
    }
    jobIds.value = jobs.map(j => j.id)
  } catch (e) {
    addLog(`list error: ${e.message}`)
  }
}

async function triggerFirst() {
  if (jobIds.value.length === 0) {
    addLog('No jobs to trigger')
    return
  }
  try {
    await MobileCron.triggerNow({ id: jobIds.value[0] })
    addLog(`Triggered: ${jobIds.value[0].slice(0, 8)}`)
  } catch (e) {
    addLog(`triggerNow error: ${e.message}`)
  }
}

async function pauseToggle() {
  try {
    if (isPaused.value) {
      await MobileCron.resumeAll()
      addLog('Resumed all')
    } else {
      await MobileCron.pauseAll()
      addLog('Paused all')
    }
    await refreshStatus()
  } catch (e) {
    addLog(`pause/resume error: ${e.message}`)
  }
}

async function cycleMode() {
  const idx = modes.indexOf(currentMode.value)
  const next = modes[(idx + 1) % modes.length]
  try {
    await MobileCron.setMode({ mode: next })
    addLog(`Mode changed to: ${next}`)
    await refreshStatus()
  } catch (e) {
    addLog(`setMode error: ${e.message}`)
  }
}

async function unregisterAll() {
  try {
    const { jobs } = await MobileCron.list()
    for (const j of jobs) {
      await MobileCron.unregister({ id: j.id })
    }
    jobIds.value = []
    addLog(`Unregistered ${jobs.length} jobs`)
    await refreshStatus()
  } catch (e) {
    addLog(`unregister error: ${e.message}`)
  }
}

onMounted(async () => {
  // Listen for events
  listeners.push(await MobileCron.addListener('jobDue', (event) => {
    addLog(`JOB DUE: ${event.name} | source=${event.source} | id=${event.id.slice(0, 8)}`)
  }))

  listeners.push(await MobileCron.addListener('jobSkipped', (event) => {
    addLog(`SKIPPED: ${event.name} | reason=${event.reason}`)
  }))

  listeners.push(await MobileCron.addListener('overdueJobs', (event) => {
    addLog(`OVERDUE: ${event.count} jobs`)
    for (const j of event.jobs) {
      addLog(`  ${j.name} overdue by ${Math.round(j.overdueMs / 1000)}s`)
    }
  }))

  listeners.push(await MobileCron.addListener('statusChanged', (status) => {
    addLog(`STATUS: mode=${status.mode} paused=${status.paused} jobs=${status.activeJobCount}`)
  }))

  // Also listen for native wake events (Android/iOS specific)
  try {
    listeners.push(await MobileCron.addListener('nativeWake', (data) => {
      addLog(`NATIVE WAKE: source=${data.source} paused=${data.paused}`)
    }))
  } catch (_) { /* nativeWake may not exist on web */ }

  await refreshStatus()
  addLog('Plugin initialized')
})

onUnmounted(() => {
  for (const l of listeners) {
    l.remove?.()
  }
})
</script>
