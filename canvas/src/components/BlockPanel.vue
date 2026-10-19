<script setup lang="ts">
import { computed } from 'vue';
import type { BlockView, SiteMap } from '../api';
import { shotUrl } from '../api';

const props = defineProps<{ block: BlockView; map: SiteMap }>();
const emit = defineEmits<{ close: []; setKind: [key: string, kind: BlockView['kind'] | null] }>();
const shot = computed(() => shotUrl(props.map, props.block));

function onKind(value: string) {
  emit('setKind', props.block.key, value === 'auto' ? null : (value as BlockView['kind']));
}
</script>

<template>
  <aside class="panel" aria-label="Detalle del bloque">
    <header>
      <h2>{{ block.name }}</h2>
      <button type="button" aria-label="Cerrar" @click="emit('close')">×</button>
    </header>
    <p class="muted key">{{ block.key }} · página {{ block.page }}</p>
    <img v-if="shot" :src="shot" alt="" class="shot" />
    <label class="row">
      Tipo
      <select :value="block.kindOverridden ? block.effectiveKind : 'auto'" @change="onKind(($event.target as HTMLSelectElement).value)">
        <option value="auto">Automático ({{ block.kind }})</option>
        <option value="narrativa">Narrativa</option>
        <option value="visual">Visual</option>
        <option value="conversion">Conversión</option>
      </select>
    </label>
    <section v-if="block.issues.length">
      <h3>Alertas</h3>
      <ul><li v-for="i in block.issues" :key="i.id" :class="i.level">{{ i.message }}</li></ul>
    </section>
    <section v-if="block.components.headings.length">
      <h3>Títulos</h3>
      <ul><li v-for="(h, n) in block.components.headings" :key="n">h{{ h.level }} · {{ h.text }}</li></ul>
    </section>
    <section v-if="block.components.links.length">
      <h3>Enlaces ({{ block.components.links.length }})</h3>
      <ul><li v-for="(l, n) in block.components.links.slice(0, 30)" :key="n">{{ l.text || '—' }} <span class="muted">→ {{ l.href }}</span></li></ul>
    </section>
    <section v-if="block.components.forms.length">
      <h3>Formularios</h3>
      <ul><li v-for="(f, n) in block.components.forms" :key="n">{{ f.fields }} campos · {{ f.method.toUpperCase() }} {{ f.action ?? '(sin destino)' }}</li></ul>
    </section>
    <section v-if="block.components.media.length">
      <h3>Medios ({{ block.components.media.length }})</h3>
      <ul><li v-for="(m, n) in block.components.media.slice(0, 20)" :key="n">{{ m.type }} <span class="muted">{{ m.src?.split('/').pop() }}</span></li></ul>
    </section>
    <section v-if="block.textExcerpt">
      <h3>Texto</h3>
      <p class="excerpt">{{ block.textExcerpt }}</p>
    </section>
  </aside>
</template>

<style scoped>
.panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); background: var(--surface); border-left: 1px solid var(--border); padding: 16px; overflow-y: auto; z-index: 10; }
header { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
h2 { font-size: 17px; margin: 0; }
h3 { font-size: 13px; margin: 14px 0 4px; color: var(--muted); font-weight: 500; }
.key { font: 12px ui-monospace, monospace; word-break: break-all; }
.shot { width: 100%; border: 1px solid var(--border); border-radius: 6px; }
.row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
ul { margin: 0; padding-left: 18px; font-size: 13px; }
li { overflow-wrap: anywhere; }
li.error { color: var(--danger); }
li.warn { color: var(--warn); }
.excerpt { font-size: 13px; margin: 0; }
</style>
