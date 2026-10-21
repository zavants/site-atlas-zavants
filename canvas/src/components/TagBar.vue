<script setup lang="ts">
import type { SiteMap } from '../api';
import { t } from '../strings';

defineProps<{ map: SiteMap; filterTag: string | null }>();
const emit = defineEmits<{
  filter: [tagId: string | null];
  create: [name: string];
  rename: [tagId: string, name: string];
  remove: [tagId: string];
}>();

function create() {
  const name = window.prompt(t.tags.name)?.trim();
  if (name) emit('create', name);
}
function rename(id: string, current: string) {
  const name = window.prompt(t.tags.newName, current)?.trim();
  if (name && name !== current) emit('rename', id, name);
}
function remove(id: string, name: string) {
  if (window.confirm(t.tags.confirmDelete(name))) emit('remove', id);
}
</script>

<template>
  <div class="bar" role="toolbar" :aria-label="t.tags.aria">
    <span class="muted">{{ t.tags.filter }}</span>
    <span v-for="tag in map.tags" :key="tag.id" class="tag">
      <button
        type="button"
        data-testid="tag-filter"
        :aria-pressed="filterTag === tag.id"
        :style="{ '--c': tag.color }"
        :title="t.tags.dblclick"
        @click="emit('filter', filterTag === tag.id ? null : tag.id)"
        @dblclick="rename(tag.id, tag.name)"
      ><i class="dot" />{{ tag.name }}</button>
      <button type="button" class="x" :aria-label="t.tags.delete(tag.name)" @click="remove(tag.id, tag.name)">×</button>
    </span>
    <button type="button" data-testid="new-tag" @click="create">{{ t.tags.add }}</button>
  </div>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; }
.tag { display: inline-flex; }
.tag > button:first-child { border-radius: 6px 0 0 6px; display: inline-flex; align-items: center; gap: 6px; }
.x { border-left: none; border-radius: 0 6px 6px 0; padding: 4px 7px; color: var(--muted); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); display: inline-block; }
</style>
