<script setup lang="ts">
import { computed, inject } from 'vue';
import { shotUrl, type BlockView } from '../api';
import { t } from '../strings';
import { hasTag } from './autoTags';
import { orgContextKey, PAGES, type PieceModel } from './diagrams';

const props = defineProps<{ piece: PieceModel; diagramId: string; number: number; hole?: boolean; settled?: boolean }>();
const ctx = inject(orgContextKey)!;

const b = computed(() => props.piece.block);
const name = computed(() => props.piece.component?.name ?? b.value.name);
const shot = computed(() => shotUrl(ctx.map(), b.value));
const open = computed(() => ctx.isOpen(props.diagramId, props.piece.key));
const showLabel = computed(() => Boolean(props.piece.component) && ctx.view() === PAGES);
const plug = computed(() => ctx.planned() && props.piece.source && !props.hole);
const filtered = computed(() => {
  const tag = ctx.filterTag();
  return tag !== null && !hasTag(b.value, tag);
});
const tagsById = computed(() => new Map(ctx.map().tags.map((x) => [x.id, x])));
const snap = computed(() => ctx.snapId.value === `piece:${props.piece.key}` && props.piece.linkable);

function onHeader() {
  ctx.toggle(props.diagramId, props.piece.key);
}
function onDown(e: PointerEvent) {
  ctx.grab(e, e.currentTarget as HTMLElement, props.diagramId, props.piece);
}
function onPlug(e: PointerEvent) {
  ctx.plug(e, (e.currentTarget as HTMLElement).closest('[data-testid="piece"]') as HTMLElement, props.piece);
}
function onKind(value: string) {
  ctx.setKind(b.value.key, value === 'auto' ? null : (value as BlockView['kind']));
}
function onTag(tagId: string, on: boolean) {
  ctx.setTags(b.value.key, on ? [...b.value.tags, tagId] : b.value.tags.filter((x) => x !== tagId));
}
</script>

<template>
  <div
    class="piece"
    data-testid="piece"
    :data-key="piece.key"
    :data-owner="piece.owner"
    :data-source="piece.source"
    :data-linkable="piece.linkable"
    :data-movable="piece.movable"
    :data-hole="hole && !settled ? 'true' : undefined"
    :class="[
      `k-${b.effectiveKind}`,
      piece.state,
      { comp: showLabel, open, hole: hole && !settled, movable: piece.movable, filtered, snap, deleted: b.deleted },
    ]"
    @pointerdown="onDown"
  >
    <div class="lh" @click="onHeader">
      <span class="n">{{ String(number).padStart(2, '0') }}</span>
      <b :title="name">{{ name }}</b>
      <span class="cnt">
        <span v-if="b.links.length" :title="t.piece.links(b.links.length)">↗{{ b.links.length }}</span>
        <span v-if="b.components.media.length" :title="t.piece.media(b.components.media.length)">▣{{ b.components.media.length }}</span>
      </span>
      <span v-if="b.issues.length" class="warn" :title="t.piece.issues(b.issues.length)">⚠{{ b.issues.length }}</span>
      <span v-if="showLabel" class="tag comp-tag">{{ t.piece.component }}</span>
    </div>
    <img v-if="shot" class="cap" :src="shot" alt="" loading="lazy" draggable="false" />
    <div v-else class="cap empty" />
    <span v-if="plug" class="plug" data-testid="plug" :data-key="piece.key" :title="t.piece.plug" @pointerdown.stop.prevent="onPlug">+</span>

    <div v-if="open" class="det">
      <img v-if="shot" :src="shot" alt="" draggable="false" />
      <label class="row">
        {{ t.piece.type }}
        <select :value="b.kindOverridden ? b.effectiveKind : 'auto'" @change="onKind(($event.target as HTMLSelectElement).value)">
          <option value="auto">{{ t.piece.auto }} ({{ t.kind[b.kind] }})</option>
          <option value="narrative">{{ t.kind.narrative }}</option>
          <option value="visual">{{ t.kind.visual }}</option>
          <option value="conversion">{{ t.kind.conversion }}</option>
        </select>
        <span class="muted">· {{ t.piece.height(Math.round(b.height)) }}</span>
      </label>
      <p v-if="b.deleted || b.isNew || b.moved" class="flags">
        <span v-if="b.deleted" class="pill flag">{{ t.piece.deleted }}</span>
        <span v-if="b.isNew" class="pill flag">{{ t.piece.isNew }}</span>
        <span v-if="b.moved && ctx.planned()" class="pill flag">{{ t.piece.moved }}</span>
        <button v-if="b.deleted && ctx.planned()" type="button" class="small" @click="ctx.restore(b.key)">{{ t.piece.restore }}</button>
      </p>
      <template v-if="b.components.headings.length">
        <div class="lbl">{{ t.piece.headings }}</div>
        <ul><li v-for="(h, i) in b.components.headings" :key="i">h{{ h.level }} · {{ h.text }}</li></ul>
      </template>
      <template v-if="b.links.length">
        <div class="lbl">{{ t.piece.linkList(b.links.length) }}</div>
        <ul>
          <li v-for="l in b.links" :key="l.id" class="link">
            {{ l.added ? l.text || t.piece.added : l.text || '—' }}
            <code>{{ ctx.targetLabel(l.target) }}</code>
            <b v-if="l.edited" class="edited">{{ t.piece.edited }}</b>
            <b v-if="l.added" class="added">{{ t.piece.added }}</b>
          </li>
        </ul>
      </template>
      <div v-else class="lbl">{{ t.piece.noLinks }}</div>
      <template v-if="b.components.forms.length">
        <div class="lbl">{{ t.piece.forms }}</div>
        <div v-for="(f, i) in b.components.forms" :key="i">{{ t.piece.form(f.fields, f.action) }}</div>
      </template>
      <template v-if="b.issues.length">
        <div class="lbl">{{ t.piece.issuesTitle }}</div>
        <ul><li v-for="i in b.issues" :key="i.id" class="warn">{{ i.message }}</li></ul>
      </template>
      <template v-if="!b.global">
        <div class="lbl">{{ t.piece.tags }}</div>
        <span v-if="!ctx.map().tags.length" class="muted">{{ t.piece.createTagHint }}</span>
        <div class="tagset">
          <span v-for="id in b.tags" :key="`on-${id}`" class="pill tagpill" :style="{ '--c': tagsById.get(id)?.color ?? '#888' }">{{ tagsById.get(id)?.name ?? id }}</span>
        </div>
        <label v-for="tag in ctx.map().tags" :key="tag.id" class="check">
          <input type="checkbox" :checked="b.tags.includes(tag.id)" @change="onTag(tag.id, ($event.target as HTMLInputElement).checked)" />
          {{ tag.name }}
        </label>
      </template>
    </div>
  </div>
</template>

<style scoped>
.piece {
  position: relative;
  border-radius: 8px;
  margin-bottom: 6px;
  background: var(--k-narrative);
  border: 1px solid transparent;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  transition: opacity 0.15s;
}
.piece.movable { cursor: grab; }
.piece.k-visual { background: var(--k-visual); }
.piece.k-conversion { background: var(--k-conversion); }
.piece.comp { background: var(--surface); border: 1px dashed var(--muted); }
.piece.dim { opacity: 0.35; }
.piece.filtered { opacity: 0.3; }
.piece.hit { outline: 2px solid var(--line-blue); }
.piece.snap { outline: 3px solid var(--line-blue); }
.piece.hole { opacity: 0.35; outline: 2px dashed var(--line-blue); outline-offset: -2px; }
.piece.deleted .lh b { text-decoration: line-through; }
.piece.float {
  position: absolute;
  z-index: 20;
  pointer-events: none;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
  transform: rotate(1.5deg);
  margin: 0;
  opacity: 1;
  outline: none;
}
.lh { display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
.lh b { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.n { font: 11px ui-monospace, monospace; color: var(--muted); }
.cnt { font-size: 10px; color: var(--muted); white-space: nowrap; display: inline-flex; gap: 4px; }
.warn { color: var(--danger); font-size: 11px; }
.tag { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 8px; }
.comp-tag { background: var(--column); color: var(--muted); }
.cap { display: none; }
.plug {
  position: absolute;
  right: -9px;
  top: 8px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--line-violet);
  color: #fff;
  font: 600 13px/18px system-ui;
  text-align: center;
  cursor: crosshair;
  opacity: 0;
  transition: opacity 0.12s;
  z-index: 4;
}
.piece:hover .plug { opacity: 1; }
.det { padding: 0 8px 8px; font-size: 12px; cursor: auto; user-select: text; -webkit-user-select: text; }
.det img { width: 100%; border-radius: 4px; border: 1px solid var(--border); margin: 4px 0; }
.det ul { margin: 2px 0 6px; padding-left: 16px; }
.det li { overflow-wrap: anywhere; }
.lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-top: 6px; }
.link code { font-size: 11px; background: var(--surface); padding: 0 4px; border-radius: 4px; overflow-wrap: anywhere; }
.edited { color: var(--line-green); }
.added { color: var(--line-violet); }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.row select { font: inherit; }
.flags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin: 6px 0 0; }
.flag { color: var(--accent); border: 1px dashed var(--accent); }
.small { font-size: 11px; padding: 0 6px; }
.tagset { display: flex; flex-wrap: wrap; gap: 4px; }
.tagpill { background: color-mix(in srgb, var(--c) 22%, transparent); }
.check { display: inline-flex; gap: 4px; align-items: center; margin-right: 10px; cursor: pointer; }

/* Screenshots view: the thumbnail at full width with only number and name on top. */
.shots .piece { background: transparent; border: 0; margin-bottom: 10px; }
.shots .lh {
  position: absolute;
  left: 6px;
  top: 6px;
  z-index: 2;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  border-radius: 6px;
  padding: 2px 8px;
  max-width: calc(100% - 12px);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}
.shots .cnt, .shots .warn, .shots .tag, .shots .det, .shots .plug { display: none !important; }
.shots .cap { display: block; width: 100%; border-radius: 8px; border: 1px solid var(--border); min-height: 40px; background: var(--k-narrative); pointer-events: none; }
.shots .cap.empty { height: 60px; }
.shots .piece.comp .cap { opacity: 0.85; }
</style>
