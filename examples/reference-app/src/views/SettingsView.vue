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
          @click="goBack"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
               stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 3L5 8l5 5"/>
          </svg>
        </button>
        <h1 class="text-lg font-semibold text-foreground">Settings</h1>
      </div>

      <!-- Worker Status -->
      <div class="mb-5">
        <div class="bg-card/80 backdrop-blur-xl border border-border/50 rounded-xl overflow-hidden
                    shadow-[0_1px_4px_rgba(0,0,0,0.15)]">
          <div class="px-4 py-3">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                     class="text-purple-400">
                  <path d="M12 2a4 4 0 014 4v2H8V6a4 4 0 014-4z"/>
                  <rect x="3" y="8" width="18" height="12" rx="2"/>
                  <circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold text-foreground">Mobile Claw</div>
                <div class="flex items-center gap-1.5 mt-0.5">
                  <span
                    class="w-1.5 h-1.5 rounded-full shrink-0"
                    :class="workerReady ? 'bg-emerald-400' : 'bg-muted-foreground/60'"
                  />
                  <span class="text-xs" :class="workerReady ? 'text-emerald-400' : 'text-muted-foreground/60'">
                    {{ workerReady ? 'Ready' : 'Offline' }}
                  </span>
                  <span v-if="nodeVersion" class="text-[0.65rem] text-muted-foreground/50">
                    Node {{ nodeVersion }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- API Key -->
      <SettingsGroup label="API KEY">
        <SettingsRow
          label="Anthropic API Key"
          :subtitle="apiKeyStatus"
          :clickable="true"
          :show-chevron="true"
          icon-color="bg-amber-500/15 text-amber-400"
          @click="showApiKeyDialog = true"
        >
          <template #icon>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
          </template>
          <template #right>
            <span v-if="hasApiKey" class="text-xs text-emerald-400">Configured</span>
            <span v-else class="text-xs text-destructive animate-pulse">Not configured</span>
          </template>
        </SettingsRow>
      </SettingsGroup>

      <!-- Workspace Editor -->
      <div class="mb-5">
        <div class="px-4 pb-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          Workspace
        </div>
        <div class="bg-card/80 backdrop-blur-xl border border-border/50 rounded-xl overflow-hidden
                    shadow-[0_1px_4px_rgba(0,0,0,0.15)]">

          <!-- File tabs -->
          <div class="flex gap-1 px-3 pt-3 pb-2">
            <button
              v-for="file in files"
              :key="file.name"
              @click="selectFile(file)"
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150"
              :class="activeFile === file.name
                ? 'bg-purple-500/20 text-purple-300'
                : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'"
            >
              {{ file.label }}
            </button>
          </div>

          <!-- File info bar -->
          <div class="px-4 py-1.5 border-t border-border/20 flex items-center justify-between">
            <span class="text-[0.65rem] text-muted-foreground/60 font-mono">{{ activeFile }}</span>
            <span v-if="dirty" class="text-[0.65rem] text-amber-400">Unsaved</span>
            <span v-if="justSaved" class="text-[0.65rem] text-emerald-400">Saved</span>
          </div>

          <!-- Markdown toolbar -->
          <div class="flex gap-0.5 px-3 py-1 border-t border-border/20">
            <button
              v-for="btn in toolbarButtons"
              :key="btn.label"
              @click="insertMarkdown(btn.prefix, btn.suffix)"
              class="w-7 h-7 flex items-center justify-center rounded text-xs font-bold
                     text-muted-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground
                     transition-colors duration-100"
              :title="btn.title"
            >
              {{ btn.label }}
            </button>
          </div>

          <!-- Textarea editor -->
          <div class="border-t border-border/20">
            <div v-if="loadingFile" class="px-4 py-8 text-center text-sm text-muted-foreground/60">
              Loading...
            </div>
            <textarea
              v-else
              ref="editorRef"
              v-model="content"
              class="w-full min-h-[280px] px-4 py-3 bg-transparent text-sm text-foreground
                     font-mono leading-relaxed resize-y outline-none
                     placeholder:text-muted-foreground/40"
              placeholder="Write markdown content..."
              @input="onInput"
            />
          </div>

          <!-- Save / Revert buttons -->
          <div v-if="dirty" class="flex justify-end gap-2 px-3 py-2 border-t border-border/20">
            <button
              @click="revert"
              class="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground
                     hover:bg-foreground/[0.06] transition-colors duration-150"
            >
              Revert
            </button>
            <button
              @click="save"
              :disabled="saving"
              class="px-3 py-1.5 rounded-md text-xs font-medium
                     bg-primary/20 text-primary hover:bg-primary/30
                     disabled:opacity-50 transition-colors duration-150"
            >
              {{ saving ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Session History -->
      <SettingsGroup label="SESSIONS">
        <SettingsRow
          label="Session History"
          :subtitle="sessionCountLabel"
          :clickable="true"
          :show-chevron="true"
          icon-color="bg-emerald-500/15 text-emerald-400"
          @click="openSessionsDialog"
        >
          <template #icon>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/>
              <line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/>
              <line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </template>
        </SettingsRow>
      </SettingsGroup>

      <!-- Clear Conversation -->
      <SettingsGroup>
        <SettingsRow
          label="Clear Conversation"
          subtitle="Resets in-memory state. Session transcripts are preserved."
          :clickable="true"
          :destructive="true"
          @click="confirmClear"
        >
          <template #icon>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </template>
        </SettingsRow>
      </SettingsGroup>
    </div>

    <!-- API Key Dialog (overlay) -->
    <Teleport to="body">
      <div v-if="showApiKeyDialog" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showApiKeyDialog = false" />
        <div class="relative bg-card border border-border/50 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
          <div>
            <h3 class="text-base font-semibold text-foreground">API Key</h3>
            <p class="text-xs text-muted-foreground mt-1">Enter your Anthropic API key to use the agent.</p>
          </div>
          <input
            v-model="apiKeyDialogInput"
            type="password"
            placeholder="sk-ant-api03-..."
            class="w-full px-3 py-2.5 rounded-lg bg-secondary border border-border/50
                   text-sm text-foreground font-mono
                   placeholder:text-muted-foreground/40
                   focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p
            v-if="apiKeyDialogInput && !apiKeyDialogInput.startsWith('sk-ant-')"
            class="text-xs text-amber-400"
          >
            Anthropic API keys typically start with "sk-ant-"
          </p>
          <div class="flex gap-2 justify-end">
            <button
              @click="showApiKeyDialog = false"
              class="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground
                     border border-border/50 hover:bg-foreground/[0.04] transition-colors"
            >
              Cancel
            </button>
            <button
              @click="saveApiKeyFromDialog"
              :disabled="!apiKeyDialogInput.trim()"
              class="px-4 py-2 rounded-lg text-sm font-medium
                     bg-primary text-primary-foreground hover:bg-primary/90
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Sessions Dialog (overlay) -->
    <Teleport to="body">
      <div v-if="showSessionsDialog" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showSessionsDialog = false" />
        <div class="relative bg-card border border-border/50 rounded-2xl shadow-2xl w-full max-w-sm max-h-[60vh] overflow-y-auto p-5">
          <h3 class="text-base font-semibold text-foreground mb-4">Session History</h3>
          <div v-if="sessionsLoading" class="py-8 text-center text-muted-foreground text-sm">
            Loading...
          </div>
          <div v-else-if="sessions.length === 0" class="py-8 text-center text-muted-foreground text-sm">
            No sessions yet
          </div>
          <div v-else class="divide-y divide-border/30">
            <div v-for="s in sessions" :key="s.sessionKey" class="py-3">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-foreground truncate">{{ s.sessionKey }}</span>
                <span class="text-xs text-muted-foreground shrink-0 ml-2">{{ formatDate(s.updatedAt) }}</span>
              </div>
              <div v-if="s.totalTokens" class="text-xs text-muted-foreground/60 mt-0.5">
                {{ s.totalTokens.toLocaleString() }} tokens<span v-if="s.model"> &middot; {{ s.model }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useMobileClaw } from '@/composables/useMobileClaw'
import SettingsGroup from '@/components/settings/SettingsGroup.vue'
import SettingsRow from '@/components/settings/SettingsRow.vue'

const router = useRouter()
const {
  workerReady, nodeVersion,
  readFile, writeFile, updateConfig,
  getAuthStatus, listSessions, clearConversation,
} = useMobileClaw()

// ── Navigation ───────────────────────────────────────────────────────────────

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/chat')
}

// ── API Key ──────────────────────────────────────────────────────────────────

const showApiKeyDialog = ref(false)
const apiKeyDialogInput = ref('')
const hasApiKey = ref(false)
const apiKeyMasked = ref('')

const apiKeyStatus = computed(() => {
  if (!hasApiKey.value) return 'No API key set'
  return apiKeyMasked.value || 'sk-ant-***'
})

async function loadAuthStatus() {
  if (!workerReady.value) return
  try {
    const status = await getAuthStatus()
    hasApiKey.value = status.hasKey
    apiKeyMasked.value = status.masked || ''
  } catch { /* non-fatal */ }
}

async function saveApiKeyFromDialog() {
  await updateConfig({
    action: 'setApiKey',
    provider: 'anthropic',
    apiKey: apiKeyDialogInput.value.trim(),
  })
  apiKeyDialogInput.value = ''
  showApiKeyDialog.value = false
  await loadAuthStatus()
}

// ── Workspace Editor ─────────────────────────────────────────────────────────

const files = [
  { name: 'SOUL.md', label: 'SOUL.md' },
  { name: 'MEMORY.md', label: 'MEMORY.md' },
  { name: 'IDENTITY.md', label: 'IDENTITY.md' },
]

const activeFile = ref('SOUL.md')
const content = ref('')
const originalContent = ref('')
const dirty = ref(false)
const loadingFile = ref(false)
const saving = ref(false)
const justSaved = ref(false)
const editorRef = ref(null)

const toolbarButtons = [
  { label: 'B', title: 'Bold', prefix: '**', suffix: '**' },
  { label: 'I', title: 'Italic', prefix: '*', suffix: '*' },
  { label: '#', title: 'Heading', prefix: '# ', suffix: '' },
  { label: '-', title: 'List', prefix: '- ', suffix: '' },
]

async function selectFile(file) {
  if (dirty.value && !confirm('You have unsaved changes. Discard?')) return
  activeFile.value = file.name
  await loadFile()
}

async function loadFile() {
  loadingFile.value = true
  dirty.value = false
  justSaved.value = false
  try {
    const result = await readFile(activeFile.value)
    content.value = result.content || ''
    originalContent.value = content.value
  } catch {
    content.value = ''
    originalContent.value = ''
  } finally {
    loadingFile.value = false
  }
}

function onInput() {
  dirty.value = content.value !== originalContent.value
  justSaved.value = false
}

async function save() {
  saving.value = true
  try {
    await writeFile(activeFile.value, content.value)
    originalContent.value = content.value
    dirty.value = false
    justSaved.value = true
    setTimeout(() => { justSaved.value = false }, 2000)
  } finally {
    saving.value = false
  }
}

function revert() {
  content.value = originalContent.value
  dirty.value = false
}

function insertMarkdown(prefix, suffix) {
  const el = editorRef.value
  if (!el) return
  const start = el.selectionStart
  const end = el.selectionEnd
  const selected = content.value.substring(start, end)
  const replacement = prefix + (selected || 'text') + suffix
  content.value = content.value.substring(0, start) + replacement + content.value.substring(end)
  dirty.value = content.value !== originalContent.value
  nextTick(() => {
    el.selectionStart = start + prefix.length
    el.selectionEnd = start + prefix.length + (selected || 'text').length
    el.focus()
  })
}

// ── Session History ──────────────────────────────────────────────────────────

const showSessionsDialog = ref(false)
const sessions = ref([])
const sessionsLoading = ref(false)
const sessionCount = ref(0)

const sessionCountLabel = computed(() => {
  return `${sessionCount.value} session${sessionCount.value !== 1 ? 's' : ''}`
})

async function openSessionsDialog() {
  showSessionsDialog.value = true
  sessionsLoading.value = true
  try {
    const result = await listSessions('main')
    sessions.value = result.sessions || []
    sessionCount.value = sessions.value.length
  } catch {
    sessions.value = []
  } finally {
    sessionsLoading.value = false
  }
}

function formatDate(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString()
}

// ── Clear Conversation ───────────────────────────────────────────────────────

async function confirmClear() {
  if (confirm('Clear conversation? In-memory state will be reset. Session transcripts are preserved.')) {
    await clearConversation()
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

watch(workerReady, (ready) => {
  if (ready) {
    loadAuthStatus()
    loadFile()
  }
}, { immediate: true })
</script>
