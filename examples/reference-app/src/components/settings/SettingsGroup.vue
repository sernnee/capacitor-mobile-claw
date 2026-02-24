<template>
  <div class="mb-5">
    <div
      v-if="label"
      class="px-4 pb-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground"
    >
      {{ label }}
    </div>
    <div
      class="bg-card/80 backdrop-blur-xl border border-border/50 rounded-xl overflow-hidden
             shadow-[0_1px_4px_rgba(0,0,0,0.15)]"
    >
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, default: '' },
})
</script>
