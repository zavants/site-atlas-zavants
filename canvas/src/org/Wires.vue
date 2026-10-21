<script setup lang="ts">
import { t } from '../strings';

export type WireColor = 'section' | 'page' | 'missing' | 'external' | 'edited' | 'added';

export interface WireModel {
  id: string;
  /** Owner of the link: block key or component id. */
  from: string;
  /** Target block key or page path / origin. */
  to: string;
  color: WireColor;
  d: string;
  x: number;
  y: number;
}

defineProps<{ wires: WireModel[]; ghost: { d: string; color: 'edited' | 'added' } | null; interactive: boolean }>();
const emit = defineEmits<{ handleDown: [e: PointerEvent, wire: WireModel] }>();
</script>

<template>
  <svg class="wires" aria-hidden="true">
    <defs>
      <marker id="atlas-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" />
      </marker>
    </defs>
    <path
      v-for="(w, i) in wires"
      :key="`p-${i}-${w.id}`"
      data-testid="wire"
      :data-link="w.id"
      :data-from="w.from"
      :data-to="w.to"
      :data-color="w.color"
      :class="['wire', w.color]"
      :d="w.d"
      marker-end="url(#atlas-arrow)"
    />
    <circle
      v-for="(w, i) in wires"
      :key="`h-${i}-${w.id}`"
      data-testid="wire-handle"
      :data-link="w.id"
      :class="['handle', w.color, { interactive }]"
      :cx="w.x"
      :cy="w.y"
      r="6"
      @pointerdown="emit('handleDown', $event, w)"
    >
      <title>{{ t.wires.handle }}</title>
    </circle>
    <path v-if="ghost" class="ghost" :class="ghost.color" :d="ghost.d" />
  </svg>
</template>

<style scoped>
.wires { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; z-index: 3; }
.wire { fill: none; stroke-width: 1.6; opacity: 0.85; stroke: var(--line-blue); }
.wire.missing { stroke: var(--line-red); }
.wire.external { stroke: var(--line-gray); }
.wire.edited { stroke: var(--line-green); stroke-width: 2.4; stroke-dasharray: 6 4; }
.wire.added { stroke: var(--line-violet); stroke-dasharray: 2 4; }
.handle { fill: var(--surface); stroke-width: 2; stroke: var(--line-blue); }
.handle.interactive { pointer-events: all; cursor: crosshair; }
.handle.missing { stroke: var(--line-red); }
.handle.external { stroke: var(--line-gray); }
.handle.edited { stroke: var(--line-green); }
.handle.added { stroke: var(--line-violet); }
.ghost { fill: none; stroke-width: 2; stroke-dasharray: 4 4; stroke: var(--line-green); }
.ghost.added { stroke: var(--line-violet); }
</style>
