<script setup lang="ts">
import { nextTick, ref } from 'vue';
import type { SiteMap } from '../api';
import { t } from '../strings';

defineProps<{ map: SiteMap; filterTag: string | null }>();
const emit = defineEmits<{
  filter: [tagId: string | null];
  create: [name: string];
  rename: [tagId: string, name: string];
  remove: [tagId: string];
}>();

// Inline editing instead of window.prompt/confirm, which embedded browsers may not support.
/** Tag being named: its id, or 'new' for a new tag. */
const editing = ref<string | null>(null);
const draft = ref('');
const input = ref<HTMLInputElement[] | HTMLInputElement | null>(null);
/** Tag whose × was clicked once: the second click deletes it. */
const arming = ref<string | null>(null);

async function edit(id: string, current = '') {
  editing.value = id;
  draft.value = current;
  await nextTick();
  const el = Array.isArray(input.value) ? input.value[0] : input.value;
  el?.focus();
  el?.select();
}
function commit(current = '') {
  const id = editing.value;
  const name = draft.value.trim();
  editing.value = null;
  if (!id || !name || name === current) return;
  if (id === 'new') emit('create', name);
  else emit('rename', id, name);
}
function remove(id: string) {
  if (arming.value !== id) return void (arming.value = id);
  arming.value = null;
  emit('remove', id);
}
</script>

<template>
  <div class="bar" role="toolbar" :aria-label="t.tags.aria">
    <span class="muted">{{ t.tags.filter }}</span>
    <span v-for="tag in map.tags" :key="tag.id" class="tag">
      <input
        v-if="editing === tag.id"
        ref="input"
        v-model="draft"
        class="name"
        :aria-label="t.tags.newName"
        @keydown.enter="commit(tag.name)"
        @keydown.esc="editing = null"
        @blur="commit(tag.name)"
      />
      <button
        v-else
        type="button"
        data-testid="tag-filter"
        :aria-pressed="filterTag === tag.id"
        :style="{ '--c': tag.color }"
        :title="t.tags.dblclick"
        @click="emit('filter', filterTag === tag.id ? null : tag.id)"
        @dblclick="edit(tag.id, tag.name)"
      ><i class="dot" />{{ tag.name }}</button>
      <button
        type="button"
        class="x"
        :class="{ armed: arming === tag.id }"
        data-testid="tag-delete"
        :aria-label="t.tags.delete(tag.name)"
        @click="remove(tag.id)"
        @blur="arming = null"
      >{{ arming === tag.id ? t.tags.confirmShort : '×' }}</button>
    </span>
    <input
      v-if="editing === 'new'"
      ref="input"
      v-model="draft"
      class="name"
      data-testid="new-tag-name"
      :placeholder="t.tags.name"
      :aria-label="t.tags.name"
      @keydown.enter="commit()"
      @keydown.esc="editing = null"
      @blur="commit()"
    />
    <button v-else type="button" data-testid="new-tag" @click="edit('new')">{{ t.tags.add }}</button>
  </div>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; }
.tag { display: inline-flex; }
.tag > button:first-child,
.tag > input:first-child { border-radius: 6px 0 0 6px; display: inline-flex; align-items: center; gap: 6px; }
.x { border-left: none; border-radius: 0 6px 6px 0; padding: 4px 7px; color: var(--muted); }
.x.armed { color: var(--danger); border-color: var(--danger); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); display: inline-block; }
.name { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--accent); border-radius: 6px; padding: 4px 8px; width: 150px; }
</style>
