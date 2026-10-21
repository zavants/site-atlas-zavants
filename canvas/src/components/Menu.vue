<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

/** A menu-bar button with a dropdown panel. The panel closes on Escape or a press outside it. */
const props = defineProps<{ id: string; label: string }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const close = () => (open.value = false);

const outside = (e: PointerEvent) => {
  if (!root.value?.contains(e.target as Node)) close();
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') close();
};
watch(open, (o) => {
  if (o) {
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', onKey);
  } else {
    window.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('keydown', onKey);
  }
});
onBeforeUnmount(close);
</script>

<template>
  <div ref="root" class="menu">
    <button
      type="button"
      class="trigger"
      :data-testid="`menu-${props.id}`"
      aria-haspopup="true"
      :aria-expanded="open"
      @click="open = !open"
    >{{ label }} <span class="caret" aria-hidden="true">▾</span></button>
    <div v-if="open" class="panel" role="menu" :data-testid="`menu-${props.id}-panel`">
      <slot :close="close" />
    </div>
  </div>
</template>

<style scoped>
.menu { position: relative; }
.trigger { border-color: transparent; background: none; }
.trigger[aria-expanded='true'],
.trigger:hover { background: var(--surface); border-color: var(--border); }
.caret { font-size: 10px; color: var(--muted); }
.panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  min-width: 220px;
  max-height: 70vh;
  overflow: auto;
  display: grid;
  gap: 4px;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  font-size: 13px;
}
</style>
