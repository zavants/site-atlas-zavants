<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { SiteMap } from '../api';
import { AUTO_TAGS, autoColors, autoTags, roleLabel, type AutoTag } from '../org/autoTags';
import { blockIndex } from '../org/diagrams';
import { t } from '../strings';

const props = defineProps<{ map: SiteMap; filterTag: string | null; inline?: boolean }>();
/** Every piece of the map, shared components and footers included: they carry roles too. */
const autoCounts = computed(() => {
  const counts = new Map<AutoTag, number>();
  for (const b of blockIndex(props.map).values()) for (const id of autoTags(b)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
});
/** Only the roles the map actually has: the full list of 22 would bury the few that are there. */
const present = computed(() => AUTO_TAGS.filter((id) => (autoCounts.value.get(id) ?? 0) > 0));
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
  <div class="bar" :class="{ inline }" role="group" :aria-label="t.tags.aria">
    <span class="head muted">{{ t.tags.detected }}</span>
    <button
      v-for="id in present"
      :key="id"
      type="button"
      class="auto"
      data-testid="auto-tag"
      :style="{ '--c': autoColors[id] }"
      :data-id="id"
      :title="t.autoTags.hint"
      :aria-pressed="filterTag === id"
      @click="emit('filter', filterTag === id ? null : id)"
    ><i class="dot" />{{ roleLabel(id) }} <span class="muted n">{{ autoCounts.get(id) }}</span></button>
    <span class="head muted">{{ t.tags.yours }}</span>
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
.bar { display: grid; gap: 4px; font-size: 13px; }
.bar.inline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.bar.inline .head { margin: 0 2px 0 6px; }
.bar.inline .auto { border-color: var(--border); }
.head { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
.auto { display: flex; align-items: center; gap: 8px; text-align: left; border-color: transparent; }
.auto[aria-pressed='true'] { border-color: var(--c); }
.auto .n { margin-left: auto; }
.tag { display: flex; }
.tag > button:first-child { flex: 1; }
.tag > button:first-child,
.tag > input:first-child { border-radius: 6px 0 0 6px; display: inline-flex; align-items: center; gap: 6px; }
.x { border-left: none; border-radius: 0 6px 6px 0; padding: 4px 7px; color: var(--muted); }
.x.armed { color: var(--danger); border-color: var(--danger); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); display: inline-block; }
.name { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--accent); border-radius: 6px; padding: 4px 8px; width: 150px; }
</style>
