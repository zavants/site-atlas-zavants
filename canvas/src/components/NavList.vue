<script setup lang="ts">
import { nextTick, ref } from 'vue';
import type { ComponentView } from '../api';
import { PAGES } from '../org/diagrams';
import { t } from '../strings';

/** What the canvas shows: every page, or one shared component. Components are renamed inline. */
defineProps<{ components: ComponentView[]; view: string; inline?: boolean }>();
const emit = defineEmits<{ select: [view: string]; rename: [id: string, name: string] }>();

// Inline field: window.prompt is not available in embedded browsers.
const renaming = ref<string | null>(null);
const draft = ref('');
const input = ref<HTMLInputElement[] | HTMLInputElement | null>(null);
async function start(c: ComponentView) {
  renaming.value = c.id;
  draft.value = c.name;
  await nextTick();
  const el = Array.isArray(input.value) ? input.value[0] : input.value;
  el?.focus();
  el?.select();
}
function commit(c: ComponentView) {
  if (renaming.value !== c.id) return;
  renaming.value = null;
  const name = draft.value.trim();
  if (name && name !== c.name) emit('rename', c.id, name);
}
</script>

<template>
  <div class="nav" :class="{ inline }">
    <button type="button" data-testid="show-pages" :aria-pressed="view === PAGES" @click="emit('select', PAGES)">{{ t.head.pages }}</button>
    <span v-for="c in components" :key="c.id" class="item">
      <input
        v-if="renaming === c.id"
        ref="input"
        v-model="draft"
        class="rename"
        data-testid="rename-component"
        :aria-label="t.head.renameComponent"
        @keydown.enter="commit(c)"
        @keydown.esc="renaming = null"
        @blur="commit(c)"
      />
      <button
        v-else
        type="button"
        data-testid="show-component"
        :data-id="c.id"
        :aria-pressed="view === c.id"
        :title="t.head.renameComponentHint"
        @click="emit('select', c.id)"
        @dblclick="start(c)"
      >{{ c.name }}</button>
      <button type="button" class="pen" data-testid="rename-component-button" :aria-label="t.head.renameComponent" :title="t.head.renameComponent" @click="start(c)">✎</button>
    </span>
  </div>
</template>

<style scoped>
.nav { display: grid; gap: 4px; }
.nav.inline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.item { display: flex; gap: 2px; }
.nav:not(.inline) .item > button:first-child,
.nav:not(.inline) > button { flex: 1; text-align: left; }
.pen { padding: 4px 7px; color: var(--muted); border-color: transparent; background: none; }
.pen:hover { color: var(--text); border-color: var(--border); }
.rename { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--accent); border-radius: 6px; padding: 4px 8px; width: 160px; }
</style>
