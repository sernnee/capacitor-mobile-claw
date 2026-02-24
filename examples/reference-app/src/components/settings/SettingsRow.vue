<template>
  <component
    :is="clickable ? 'button' : 'div'"
    class="flex items-center gap-3 w-full px-4 py-3 text-left transition-colors duration-150
           border-b border-border/30 last:border-b-0"
    :class="[
      clickable ? 'hover:bg-foreground/[0.04] active:bg-foreground/[0.06] cursor-pointer' : '',
      destructive ? 'text-destructive' : '',
    ]"
    @click="clickable ? $emit('click') : undefined"
  >
    <!-- Icon -->
    <div
      v-if="$slots.icon"
      class="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
      :class="iconColor || 'bg-muted text-muted-foreground'"
    >
      <slot name="icon" />
    </div>

    <!-- Labels -->
    <div class="flex-1 min-w-0">
      <div
        class="text-[0.8125rem] font-medium"
        :class="destructive ? 'text-destructive' : 'text-foreground'"
      >
        {{ label }}
      </div>
      <div v-if="subtitle" class="text-xs text-muted-foreground/60 mt-0.5 leading-relaxed">
        {{ subtitle }}
      </div>
    </div>

    <!-- Right side -->
    <slot name="right" />
    <span v-if="value" class="text-xs text-muted-foreground shrink-0">{{ value }}</span>
    <svg
      v-if="showChevron"
      width="12" height="12" viewBox="0 0 12 12" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
      class="text-muted-foreground/40 shrink-0"
    >
      <path d="M4.5 2.5l3.5 3.5-3.5 3.5"/>
    </svg>
  </component>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  subtitle: { type: String, default: '' },
  value: { type: String, default: '' },
  iconColor: { type: String, default: '' },
  showChevron: { type: Boolean, default: false },
  destructive: { type: Boolean, default: false },
  clickable: { type: Boolean, default: false },
})

defineEmits(['click'])
</script>
