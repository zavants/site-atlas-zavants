<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus';
import { ConflictError, getMap, getSites, rescan, sendOp, subscribe, type BlockView, type OverlayOp, type SiteMap } from './api';
import BlockCard from './components/BlockCard.vue';
import BlockPanel from './components/BlockPanel.vue';
import PageColumn from './components/PageColumn.vue';
import TagBar from './components/TagBar.vue';

const site = decodeURIComponent(location.pathname.replace(/^\/s\/?/, '').replace(/\/$/, ''));
const map = ref<SiteMap | null>(null);
const sites = ref<{ site: string; lastScan: string | null }[]>([]);
const planned = ref(false);
const filterTag = ref<string | null>(null);
const selectedKey = ref<string | null>(null);
const notice = ref('');
const error = ref('');
const trash = ref<BlockView[]>([]);
let unsubscribe: (() => void) | null = null;

const blockIndex = computed(() => {
  const m = new Map<string, BlockView>();
  for (const b of map.value?.globals ?? []) m.set(b.key, b);
  for (const p of map.value?.pages ?? []) for (const b of p.blocks) m.set(b.key, b);
  return m;
});
const selected = computed(() => (selectedKey.value ? blockIndex.value.get(selectedKey.value) ?? null : null));

async function reload() {
  try {
    map.value = await getMap(site);
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function op(o: OverlayOp) {
  if (!map.value) return;
  try {
    map.value = await sendOp(site, map.value.rev, o);
    notice.value = '';
  } catch (e) {
    if (e instanceof ConflictError) {
      map.value = e.map;
      notice.value = e.message;
    } else {
      notice.value = (e as Error).message;
      await reload();
    }
  }
}

function onTrash(e: SortableEvent) {
  const key = (e.item as HTMLElement).dataset.key;
  trash.value = [];
  if (key) void op({ type: 'markDeleted', blockKey: key });
}

function addPage() {
  const path = window.prompt('Ruta de la página planificada (por ejemplo /soluciones)')?.trim();
  if (!path) return;
  const title = window.prompt('Título de la página', path.replace(/^\//, ''))?.trim() ?? path;
  void op({ type: 'addPlannedPage', path, title });
}

async function startRescan() {
  try {
    await rescan(site);
    notice.value = 'Escaneo en curso…';
  } catch (e) {
    notice.value = (e as Error).message;
  }
}

onMounted(async () => {
  if (!site) {
    sites.value = await getSites();
    return;
  }
  await reload();
  unsubscribe = subscribe(site, (type, data) => {
    if (type === 'progress') notice.value = String(data.msg ?? '');
    else if (type === 'scan') {
      notice.value = 'Escaneo terminado.';
      void reload();
    } else if (type === 'overlay' && map.value && Number(data.rev) !== map.value.rev) void reload();
  });
});
onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <main v-if="!site" class="home">
    <h1>Site Atlas</h1>
    <p v-if="!sites.length" class="muted">Todavía no hay sitios escaneados. Ejecuta <code>site-atlas scan &lt;url&gt;</code> o usa la herramienta MCP <code>atlas_scan</code>.</p>
    <ul>
      <li v-for="s in sites" :key="s.site"><a :href="`/s/${encodeURIComponent(s.site)}`">{{ s.site }}</a> <span class="muted">{{ s.lastScan }}</span></li>
    </ul>
  </main>

  <main v-else-if="map" class="app">
    <header class="head">
      <div class="title">
        <h1>{{ map.site }}</h1>
        <span class="muted">{{ map.environment.origin }}{{ map.environment.basePath }} · escaneo {{ map.scanId }}</span>
        <span class="counts">
          <span class="pill err">{{ map.issueCount.error }} errores</span>
          <span class="pill warn">{{ map.issueCount.warn }} avisos</span>
          <span class="pill info">{{ map.issueCount.info }} info</span>
        </span>
      </div>
      <div class="actions">
        <div class="seg" role="group" aria-label="Vista">
          <button type="button" :aria-pressed="!planned" @click="planned = false">Real</button>
          <button type="button" data-testid="toggle-planned" :aria-pressed="planned" @click="planned = true">Planificado</button>
        </div>
        <button type="button" @click="addPage">+ Página planificada</button>
        <button type="button" data-testid="rescan" @click="startRescan">Re-escanear</button>
      </div>
      <TagBar
        :map="map"
        :filter-tag="filterTag"
        @filter="(t) => (filterTag = t)"
        @create="(name) => op({ type: 'createTag', name })"
        @rename="(tagId, name) => op({ type: 'renameTag', tagId, name })"
        @remove="(tagId) => op({ type: 'deleteTag', tagId })"
      />
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <p v-if="!planned" class="muted hint">Cambia a Planificado para reorganizar.</p>
    </header>

    <section v-if="map.globals.length" class="globals" data-testid="global-lane" aria-label="Bloques globales">
      <span class="muted label">Global</span>
      <BlockCard
        v-for="(b, i) in map.globals"
        :key="b.key"
        :block="b"
        :map="map"
        :index="i"
        :filter-tag="filterTag"
        :show-moved="false"
        @select="(k) => (selectedKey = k)"
      />
    </section>

    <section v-if="map.orphans.length" class="orphans" aria-label="Huérfanos">
      <strong>Huérfanos</strong>
      <span class="muted">Bloques organizados que ya no aparecen en el sitio.</span>
      <div v-for="o in map.orphans" :key="o.key" class="orphan">
        <span>{{ o.lastSeen.name }} <span class="muted">({{ o.lastSeen.page }})</span></span>
        <button v-if="o.suggestion" type="button" @click="op({ type: 'resolveOrphan', orphanKey: o.key, action: 'assign', targetKey: o.suggestion })">
          Asignar a {{ blockIndex.get(o.suggestion)?.name ?? o.suggestion }}
        </button>
        <button type="button" @click="op({ type: 'resolveOrphan', orphanKey: o.key, action: 'discard' })">Descartar</button>
      </div>
    </section>

    <div class="board">
      <PageColumn
        v-for="p in map.pages"
        :key="p.path"
        :page="p"
        :map="map"
        :planned="planned"
        :filter-tag="filterTag"
        :block-index="blockIndex"
        @move="(key, toPage, index) => op({ type: 'moveBlock', blockKey: key, toPage, index })"
        @set-tags="(key, tagIds) => op({ type: 'setBlockTags', blockKey: key, tagIds })"
        @select="(k) => (selectedKey = k)"
        @restore="(k) => op({ type: 'restore', blockKey: k })"
      />
      <div v-if="planned" class="trash" data-testid="trash-zone">
        <p class="muted">Suelta aquí para marcar como eliminado</p>
        <VueDraggable
          v-model="trash"
          class="trash-drop"
          :group="{ name: 'blocks', pull: false, put: true }"
          :force-fallback="true"
          @add="onTrash"
        />
      </div>
    </div>

    <BlockPanel
      v-if="selected"
      :block="selected"
      :map="map"
      @close="selectedKey = null"
      @set-kind="(key, kind) => op({ type: 'setKind', blockKey: key, kind })"
    />
  </main>

  <main v-else class="home">
    <p :class="error ? 'error' : 'muted'">{{ error || 'Cargando…' }}</p>
  </main>
</template>

<style scoped>
.home { padding: 32px; max-width: 720px; }
.app { padding: 16px 20px; }
.head { display: grid; gap: 10px; margin-bottom: 12px; }
.title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
h1 { font-size: 18px; margin: 0; }
.counts { display: inline-flex; gap: 4px; }
.err { color: var(--danger); border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent); }
.warn { color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); }
.info { color: var(--muted); border: 1px solid var(--border); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.seg { display: inline-flex; }
.seg button:first-child { border-radius: 6px 0 0 6px; }
.seg button:last-child { border-radius: 0 6px 6px 0; border-left: none; }
.notice { margin: 0; font-size: 13px; color: var(--accent); }
.hint { margin: 0; font-size: 12px; }
.globals { display: flex; gap: 8px; align-items: start; overflow-x: auto; padding: 8px; border: 1px dashed var(--border); border-radius: 12px; margin-bottom: 12px; }
.globals :deep(.card) { width: 220px; flex: none; margin: 0; cursor: pointer; }
.label { font-size: 12px; align-self: center; }
.orphans { display: grid; gap: 6px; padding: 10px; border: 1px solid color-mix(in srgb, var(--warn) 50%, transparent); border-radius: 12px; margin-bottom: 12px; }
.orphan { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.board { display: flex; gap: 12px; align-items: start; overflow-x: auto; padding-bottom: 16px; }
.trash { position: relative; width: 200px; min-height: 120px; flex: none; border: 1px dashed var(--danger); border-radius: 12px; padding: 10px; display: grid; place-items: center; text-align: center; font-size: 12px; }
.trash-drop { position: absolute; inset: 0; }
.trash-drop :deep(.card) { display: none; }
.error { color: var(--danger); }
</style>
