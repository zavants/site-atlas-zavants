<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BlockView, SiteMap } from '../api';
import { shotUrl } from '../api';
import { t } from '../strings';

const props = defineProps<{
  block: BlockView;
  map: SiteMap;
  index: number;
  filterTag: string | null;
  showMoved: boolean;
}>();
const emit = defineEmits<{
  setTags: [key: string, tagIds: string[]];
  select: [key: string];
  restore: [key: string];
}>();

const editing = ref(false);
const tagsById = computed(() => new Map(props.map.tags.map((t) => [t.id, t])));
const dim = computed(() => props.filterTag !== null && !props.block.tags.includes(props.filterTag));
const shot = computed(() => shotUrl(props.map, props.block));

function toggle(tagId: string, on: boolean) {
  const next = on ? [...props.block.tags, tagId] : props.block.tags.filter((t) => t !== tagId);
  emit('setTags', props.block.key, next);
}
</script>

<template>
  <article
    class="card"
    :class="{ dim, deleted: block.deleted }"
    data-testid="block-card"
    :data-key="block.key"
    @click="emit('select', block.key)"
  >
    <div class="top">
      <span class="n">{{ String(index + 1).padStart(2, '0') }}</span>
      <strong class="name" :title="block.name">{{ block.name }}</strong>
      <span class="pill kind" :class="block.effectiveKind">{{ t.kind[block.effectiveKind] }}</span>
    </div>
    <img v-if="shot" class="shot" :src="shot" alt="" loading="lazy" draggable="false" />
    <div class="meta">
      <span
        v-for="id in block.tags"
        :key="id"
        class="pill tag"
        :style="{ '--c': tagsById.get(id)?.color ?? '#888' }"
      >{{ tagsById.get(id)?.name ?? id }}</span>
      <span v-if="block.issues.length" class="pill issues" :title="block.issues.map((i) => i.message).join('\n')">⚠ {{ block.issues.length }}</span>
      <span v-if="block.isNew" class="pill flag">{{ t.card.new }}</span>
      <span v-if="showMoved && block.moved" class="pill flag">{{ t.card.moved }}</span>
      <button
        v-if="!block.global"
        class="edit"
        type="button"
        data-testid="edit-tags"
        :aria-expanded="editing"
        :aria-label="t.card.editTags"
        @click.stop="editing = !editing"
      >{{ editing ? t.card.done : '+' }}</button>
      <button v-if="block.deleted" type="button" class="edit" @click.stop="emit('restore', block.key)">{{ t.card.restore }}</button>
    </div>
    <fieldset v-if="editing" class="tag-menu" @click.stop>
      <legend class="muted">{{ t.card.tags }}</legend>
      <span v-if="!map.tags.length" class="muted">{{ t.card.createTagHint }}</span>
      <label v-for="t in map.tags" :key="t.id">
        <input type="checkbox" :checked="block.tags.includes(t.id)" @change="toggle(t.id, ($event.target as HTMLInputElement).checked)" />
        {{ t.name }}
      </label>
    </fieldset>
  </article>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  cursor: grab;
  transition: opacity 0.15s;
  user-select: none;
}
.card:hover { border-color: var(--muted); }
.card.dim { opacity: 0.3; }
.card.deleted .name { text-decoration: line-through; color: var(--muted); }
.top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.n { font: 11px ui-monospace, monospace; color: var(--muted); }
.name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.kind { border: 1px solid var(--border); color: var(--muted); }
.kind.visual { color: #7f77dd; border-color: color-mix(in srgb, #7f77dd 40%, transparent); }
.kind.conversion { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.shot { display: block; width: 100%; max-height: 120px; object-fit: cover; object-position: top; border-radius: 4px; margin-top: 6px; border: 1px solid var(--border); }
.meta { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 6px; }
.tag { background: color-mix(in srgb, var(--c) 22%, transparent); color: var(--text); }
.issues { color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); }
.flag { color: var(--accent); border: 1px dashed var(--accent); }
.edit { font-size: 11px; line-height: 16px; padding: 0 6px; margin-left: auto; }
.tag-menu { margin: 6px 0 0; border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px 6px; display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; cursor: default; }
.tag-menu legend { font-size: 11px; padding: 0 4px; }
.tag-menu label { display: flex; gap: 4px; align-items: center; cursor: pointer; }
</style>
