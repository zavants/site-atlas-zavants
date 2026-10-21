<script setup lang="ts">
import { computed, inject } from 'vue';
import { t } from '../strings';
import Piece from './Piece.vue';
import { orgContextKey, type DiagramModel, type PieceModel } from './diagrams';

export interface ZoneItem {
  piece: PieceModel;
  hole: boolean;
}

const props = defineProps<{
  diagram: DiagramModel;
  zone: ZoneItem[] | null;
  x: number;
  y: number;
  moving: boolean;
  dropTarget: boolean;
  /** The dragged piece was released and its op is on its way: show it in place, not as a gap. */
  settled: boolean;
}>();
const emit = defineEmits<{ titleDown: [e: PointerEvent]; deletePage: [] }>();
const ctx = inject(orgContextKey)!;

const d = computed(() => props.diagram);
const count = computed(() => d.value.top.length + (props.zone?.filter((z) => !z.hole).length ?? 0) + d.value.bottom.length);
const snap = computed(() => d.value.linkable && ctx.snapId.value === `diagram:${d.value.id}`);
const kindTag = computed(() => {
  switch (d.value.kind) {
    case 'planned':
      return { text: t.diagram.planned, cls: 'planned' };
    case 'missing':
      return { text: t.diagram.notFound, cls: 'missing' };
    case 'external':
      return { text: t.diagram.external, cls: 'external' };
    case 'component':
      return { text: t.diagram.component, cls: 'external' };
    default:
      return null;
  }
});
</script>

<template>
  <section
    class="diagram"
    data-testid="diagram"
    :data-id="d.id"
    :data-kind="d.kind"
    :data-linkable="d.linkable"
    :data-droppable="d.droppable"
    :class="[`d-${d.kind}`, { small: d.small, moving, snap }]"
    :style="{ left: `${x}px`, top: `${y}px` }"
  >
    <header class="title" data-testid="diagram-title" @pointerdown="emit('titleDown', $event)">
      <span class="name" :title="d.title">{{ d.title }}</span>
      <span v-if="d.subtitle" class="sub muted">{{ d.subtitle }}</span>
    </header>
    <button
      v-if="d.kind === 'planned' && ctx.planned()"
      type="button"
      class="remove"
      data-testid="delete-page"
      :data-id="d.id"
      :title="t.diagram.deletePage"
      :aria-label="t.diagram.deletePage"
      @pointerdown.stop
      @click="emit('deletePage')"
    >×</button>
    <div class="tags">
      <span v-if="d.kind === 'page' || d.kind === 'planned' || d.kind === 'trash'" class="tag count">{{ t.diagram.pieces(count) }}</span>
      <span v-if="kindTag" class="tag" :class="kindTag.cls">{{ kindTag.text }}</span>
      <span v-if="d.status && d.status >= 400" class="tag missing">HTTP {{ d.status }}</span>
    </div>
    <Piece v-for="(p, i) in d.top" :key="`t-${p.key}`" :piece="p" :diagram-id="d.id" :number="i + 1" />
    <div v-if="zone" class="zone" data-zone :class="{ target: dropTarget }">
      <Piece
        v-for="(z, i) in zone"
        :key="z.piece.key"
        :piece="z.piece"
        :diagram-id="d.id"
        :number="d.top.length + i + 1"
        :hole="z.hole"
        :settled="settled"
      />
      <div v-if="!zone.length" class="hint">{{ d.kind === 'trash' ? t.diagram.trashHint : t.diagram.dropHere }}</div>
    </div>
    <div v-else-if="d.kind === 'external'" class="hint">{{ t.diagram.externalSite }}</div>
    <Piece
      v-for="(p, i) in d.bottom"
      :key="`b-${p.key}`"
      :piece="p"
      :diagram-id="d.id"
      :number="d.top.length + (zone?.length ?? 0) + i + 1"
    />
  </section>
</template>

<style scoped>
.diagram {
  position: absolute;
  width: 320px;
  background: var(--surface);
  border: 2px solid var(--text);
  border-radius: 14px;
  padding: 0 12px 12px;
  z-index: 1;
  font-size: 13px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.diagram.small { width: 230px; }
.diagram.d-trash { border-style: dashed; border-color: var(--danger); }
.diagram.snap { outline: 3px solid var(--line-blue); outline-offset: 2px; }
.diagram:has(> .title:hover),
.diagram.moving {
  border-color: var(--line-blue);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--line-blue) 22%, transparent), 0 6px 20px color-mix(in srgb, var(--line-blue) 18%, transparent);
}
.diagram.moving { z-index: 6; }
.title {
  margin: 0 -12px 4px;
  padding: 10px 12px 4px;
  font-size: 15px;
  font-weight: 600;
  cursor: move;
  user-select: none;
  -webkit-user-select: none;
  display: grid;
  min-width: 0;
}
.title .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 22px; }
.title .sub { font-size: 11px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.remove { position: absolute; top: 6px; right: 6px; font-size: 18px; font-weight: 600; line-height: 1; padding: 4px 9px; color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, var(--surface)); border-color: color-mix(in srgb, var(--danger) 60%, transparent); }
.remove:hover { background: color-mix(in srgb, var(--danger) 28%, var(--surface)); border-color: var(--danger); }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.tag { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 8px; background: var(--column); color: var(--muted); }
.tag.count, .tag.planned { background: color-mix(in srgb, var(--line-blue) 16%, transparent); color: var(--accent); }
.tag.missing { background: color-mix(in srgb, var(--line-red) 18%, transparent); color: var(--danger); }
.zone { min-height: 44px; border-radius: 8px; padding: 2px; }
.zone.target { background: color-mix(in srgb, var(--line-blue) 7%, transparent); outline: 2px dashed var(--line-blue); }
.hint { font-size: 12px; color: var(--muted); margin: 4px 0; }

.shots .diagram { width: 480px; }
.shots .diagram.small { width: 300px; }
</style>
