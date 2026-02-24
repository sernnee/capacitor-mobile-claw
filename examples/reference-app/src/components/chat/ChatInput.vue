<template>
  <div
    class="prompt-input-wrapper px-3 pb-3"
    style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom, 0px))"
  >
    <!-- Status indicator -->
    <div class="flex items-center gap-1.5 px-2 pb-2">
      <span
        class="w-1.5 h-1.5 rounded-full shrink-0"
        :class="isRunning
          ? 'bg-primary animate-pulse'
          : (workerReady ? 'bg-emerald-400' : 'bg-muted-foreground/60')"
      />
      <span class="text-[0.65rem]" :class="isRunning ? 'text-primary' : 'text-muted-foreground/60'">
        {{ statusText }}
      </span>
    </div>

    <!-- Input area -->
    <div
      class="flex items-end gap-2 rounded-2xl border border-border/50
             bg-card/80 backdrop-blur-xl shadow-[0_2px_12px_rgba(0,0,0,0.25)]
             px-3 py-2 transition-colors duration-150
             focus-within:border-primary/40"
    >
      <textarea
        ref="textareaRef"
        v-model="text"
        :placeholder="placeholder"
        :disabled="!workerReady"
        rows="1"
        class="flex-1 bg-transparent text-sm text-foreground resize-none outline-none
               min-h-[36px] max-h-[192px] py-1.5 leading-relaxed
               placeholder:text-muted-foreground/40
               disabled:opacity-50"
        style="field-sizing: content"
        @keydown="handleKeyDown"
      />

      <!-- Send / Stop button -->
      <button
        @click="isRunning ? $emit('stop') : submit()"
        :disabled="!isRunning && (!text.trim() || !workerReady)"
        class="w-8 h-8 rounded-full flex items-center justify-center shrink-0
               transition-all duration-150
               disabled:opacity-30 disabled:cursor-not-allowed"
        :class="isRunning
          ? 'bg-destructive/20 text-destructive hover:bg-destructive/30 active:scale-[0.92]'
          : 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.92]'"
      >
        <!-- Stop icon -->
        <svg v-if="isRunning" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect x="2" y="2" width="8" height="8" rx="1.5"/>
        </svg>
        <!-- Send icon -->
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'

const props = defineProps({
  isRunning: { type: Boolean, default: false },
  workerReady: { type: Boolean, default: false },
})

const emit = defineEmits(['send', 'stop'])

const text = ref('')
const textareaRef = ref(null)

const placeholder = computed(() => {
  if (!props.workerReady) return 'Agent starting...'
  if (props.isRunning) return 'Agent is thinking...'
  return 'Ask anything...'
})

const statusText = computed(() => {
  if (props.isRunning) return 'Thinking...'
  if (props.workerReady) return 'Ready'
  return 'Connecting...'
})

function submit() {
  const trimmed = text.value.trim()
  if (!trimmed || !props.workerReady) return
  emit('send', trimmed)
  text.value = ''
  nextTick(() => {
    if (textareaRef.value) textareaRef.value.focus()
  })
}

function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    if (props.isRunning) return
    submit()
  }
}

function focus() {
  textareaRef.value?.focus()
}

defineExpose({ focus })
</script>
