<template>
  <div class="flex size-full flex-col items-center justify-center gap-4 p-8 text-center">
    <!-- Icon -->
    <div class="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
           class="text-primary">
        <path d="M12 2a4 4 0 014 4v2H8V6a4 4 0 014-4z"/>
        <rect x="3" y="8" width="18" height="12" rx="2"/>
        <circle cx="9" cy="14" r="1.5" fill="currentColor"/>
        <circle cx="15" cy="14" r="1.5" fill="currentColor"/>
      </svg>
    </div>

    <!-- Text -->
    <div class="space-y-1.5">
      <h3 class="font-semibold text-foreground text-base">Mobile Claw</h3>
      <p class="text-sm text-muted-foreground max-w-[280px]">
        On-device AI assistant. Ask me anything — I can read, write, and run code right on your device.
      </p>
    </div>

    <!-- Suggestion chips -->
    <div class="flex flex-wrap gap-2 justify-center mt-2 max-w-[320px]">
      <button
        v-for="suggestion in suggestions"
        :key="suggestion"
        @click="$emit('suggest', suggestion)"
        class="px-3 py-1.5 rounded-full text-xs font-medium
               bg-secondary/80 text-muted-foreground border border-border/30
               hover:bg-secondary hover:text-foreground
               active:scale-[0.97] transition-all duration-150"
      >
        {{ suggestion }}
      </button>
    </div>
  </div>
</template>

<script setup>
defineEmits(['suggest'])

const suggestions = [
  'What can you do?',
  'List workspace files',
  'Write a Python script',
  'Help me plan a project',
]
</script>
