<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus';
import type { BlockView, SiteMap } from '../api';
import type { PageView } from '../../../src/model/map.js';
import { t } from '../strings';
import BlockCard from './BlockCard.vue';

const props = defineProps<{
  page: PageView;
  map: SiteMap;
  planned: boolean;
  filterTag: string | null;
  blockIndex: Map<string, BlockView>;
}>();
const emit = defineEmits<{
  move: [key: string, toPage: string, index: number];
  setTags: [key: string, tagIds: string[]];
  select: [key: string];
  restore: [key: string];
}>();

const source = computed<BlockView[]>(() =>
  props.planned
    ? props.page.blocks
    : props.page.realOrder.map((k) => props.blockIndex.get(k)).filter((b): b is BlockView => Boolean(b)),
);
const list = ref<BlockView[]>([]);
watch(source, (v) => (list.value = [...v]), { immediate: true });

function onDrop(e: SortableEvent) {
  const key = (e.item as HTMLElement).dataset.key;
  if (key && e.newIndex !== undefined) emit('move', key, props.page.path, e.newIndex);
}
</script>

<template>
  <section class="column" data-testid="page-column" :data-path="page.path">
    <header>
      <strong>{{ page.title || page.path }}</strong>
      <span class="muted path">{{ page.path }}{{ page.planned ? ` · ${t.column.planned}` : '' }}</span>
      <span v-if="page.status && page.status >= 400" class="pill err">HTTP {{ page.status }}</span>
    </header>
    <VueDraggable
      v-model="list"
      class="list"
      :group="{ name: 'blocks', pull: true, put: true }"
      :disabled="!planned"
      :force-fallback="true"
      :animation="150"
      filter=".edit, .tag-menu"
      :prevent-on-filter="false"
      @update="onDrop"
      @add="onDrop"
    >
      <BlockCard
        v-for="(b, i) in list"
        :key="b.key"
        :block="b"
        :map="map"
        :index="i"
        :filter-tag="filterTag"
        :show-moved="planned"
        @set-tags="(k, t) => emit('setTags', k, t)"
        @select="(k) => emit('select', k)"
        @restore="(k) => emit('restore', k)"
      />
    </VueDraggable>
    <p v-if="!list.length" class="muted empty">{{ planned ? t.column.dropHere : t.column.noBlocks }}</p>
  </section>
</template>

<style scoped>
.column { background: var(--column); border: 1px solid var(--border); border-radius: 12px; padding: 10px; width: 280px; flex: none; display: flex; flex-direction: column; max-height: calc(100vh - 150px); }
header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin-bottom: 8px; }
.path { font-size: 12px; }
.err { color: var(--danger); border: 1px solid var(--danger); }
.list { min-height: 60px; overflow-y: auto; flex: 1; }
.empty { font-size: 12px; margin: -50px 0 0; text-align: center; pointer-events: none; }
</style>
