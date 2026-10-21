<script setup lang="ts">
import { computed, inject, ref } from 'vue';
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
/** The trash is an icon with a badge, docked by the zoom bar; a click opens its list of pieces. */
const open = ref(false);
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
    :class="[`d-${d.kind}`, { small: d.small, moving, snap, open, target: dropTarget }]"
    :style="d.kind === 'trash' ? undefined : { left: `${x}px`, top: `${y}px` }"
  >
    <template v-if="d.kind === 'trash'">
      <button
        type="button"
        class="bin"
        data-testid="diagram-title"
        :title="t.diagram.trashHint"
        :aria-label="t.diagram.trashLabel(count)"
        :aria-expanded="open"
        @pointerdown.stop
        @click="open = !open"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span v-if="count" class="badge" data-testid="trash-badge">{{ count > 99 ? '99+' : count }}</span>
      </button>
      <div v-if="zone" v-show="open" class="zone" data-zone>
        <Piece v-for="(z, i) in zone" :key="z.piece.key" :piece="z.piece" :diagram-id="d.id" :number="i + 1" :hole="z.hole" :settled="settled" />
        <div v-if="!zone.length" class="hint">{{ t.diagram.trashHint }}</div>
      </div>
    </template>
    <template v-else>
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
      <span v-if="d.kind === 'page' || d.kind === 'planned'" class="tag count">{{ t.diagram.pieces(count) }}</span>
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
      <div v-if="!zone.length" class="hint">{{ t.diagram.dropHere }}</div>
    </div>
    <div v-else-if="d.kind === 'external'" class="hint">{{ t.diagram.externalSite }}</div>
    <Piece
      v-for="(p, i) in d.bottom"
      :key="`b-${p.key}`"
      :piece="p"
      :diagram-id="d.id"
      :number="d.top.length + (zone?.length ?? 0) + i + 1"
    />
    </template>
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
.diagram.d-trash { position: absolute; left: auto; top: auto; right: 0; bottom: 0; width: auto; padding: 0; border: none; background: none; display: flex; flex-direction: column-reverse; align-items: flex-end; z-index: 5; }
.diagram.d-trash.open { width: 260px; max-height: 60vh; overflow: auto; padding: 8px; border: 2px dashed var(--danger); background: var(--surface); }
.diagram.d-trash .zone { width: 100%; }
.diagram.d-trash.target .bin { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 18%, var(--surface)); transform: scale(1.08); }
.bin { position: relative; flex: none; display: grid; place-items: center; width: 36px; height: 36px; margin: 0; padding: 0; border-radius: 10px; border: 1px solid var(--border); color: var(--danger); background: var(--surface); cursor: pointer; transition: transform 0.12s, background 0.12s; }
.badge { position: absolute; top: -7px; right: -7px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #e5484d; color: #fff; font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; box-shadow: 0 0 0 2px var(--canvas-bg); }
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
.shots .diagram.d-trash { width: auto; }
.shots .diagram.d-trash.open { width: 260px; }
</style>
