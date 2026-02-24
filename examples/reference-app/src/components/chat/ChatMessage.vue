<template>
  <div
    class="flex w-full animate-[slide-up_0.2s_ease-out]"
    :class="from === 'user' ? 'justify-end' : 'justify-start'"
  >
    <!-- User message -->
    <div
      v-if="from === 'user'"
      class="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-secondary px-4 py-3"
    >
      <p class="text-sm text-foreground whitespace-pre-wrap break-words">{{ content }}</p>
      <div v-if="timestamp" class="text-[0.6rem] text-muted-foreground/40 mt-1.5 text-right">
        {{ formatTime(timestamp) }}
      </div>
    </div>

    <!-- Assistant message -->
    <div
      v-else
      class="w-full max-w-full"
    >
      <div
        class="markdown-body text-sm text-foreground"
        :class="streaming ? 'streaming-cursor' : ''"
        v-html="renderedContent"
      />
      <div class="flex items-center gap-3 mt-2">
        <div v-if="timestamp" class="text-[0.6rem] text-muted-foreground/40">
          {{ formatTime(timestamp) }}
        </div>
        <button
          v-if="!streaming && content"
          @click="copy"
          class="text-[0.6rem] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { marked } from 'marked'
import { copyToClipboard } from '@/lib/platform.js'

const props = defineProps({
  from: { type: String, required: true }, // 'user' | 'assistant'
  content: { type: String, default: '' },
  streaming: { type: Boolean, default: false },
  timestamp: { type: [Number, String, Date], default: null },
})

const copied = ref(false)

const renderedContent = computed(() => {
  if (!props.content) return ''
  return marked.parse(props.content, { breaks: true, gfm: true })
})

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

async function copy() {
  await copyToClipboard(props.content)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>
