<script setup lang="ts">
import type { SiteMap } from '../api';

defineProps<{ map: SiteMap; filterTag: string | null }>();
const emit = defineEmits<{
  filter: [tagId: string | null];
  create: [name: string];
  rename: [tagId: string, name: string];
  remove: [tagId: string];
}>();

function create() {
  const name = window.prompt('Nombre de la etiqueta')?.trim();
  if (name) emit('create', name);
}
function rename(id: string, current: string) {
  const name = window.prompt('Nuevo nombre', current)?.trim();
  if (name && name !== current) emit('rename', id, name);
}
function remove(id: string, name: string) {
  if (window.confirm(`¿Borrar la etiqueta "${name}"? Se quitará de todos los bloques.`)) emit('remove', id);
}
</script>

<template>
  <div class="bar" role="toolbar" aria-label="Etiquetas">
    <span class="muted">Filtrar por etiqueta:</span>
    <span v-for="t in map.tags" :key="t.id" class="tag">
      <button
        type="button"
        data-testid="tag-filter"
        :aria-pressed="filterTag === t.id"
        :style="{ '--c': t.color }"
        title="Doble clic para renombrar"
        @click="emit('filter', filterTag === t.id ? null : t.id)"
        @dblclick="rename(t.id, t.name)"
      ><i class="dot" />{{ t.name }}</button>
      <button type="button" class="x" :aria-label="`Borrar ${t.name}`" @click="remove(t.id, t.name)">×</button>
    </span>
    <button type="button" data-testid="new-tag" @click="create">+ Etiqueta</button>
  </div>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; }
.tag { display: inline-flex; }
.tag > button:first-child { border-radius: 6px 0 0 6px; display: inline-flex; align-items: center; gap: 6px; }
.x { border-left: none; border-radius: 0 6px 6px 0; padding: 4px 7px; color: var(--muted); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); display: inline-block; }
</style>
