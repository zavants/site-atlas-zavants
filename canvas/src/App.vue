<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ConflictError, getMap, getPlan, getSites, rescan, sendOp, subscribe, type Change, type OverlayOp, type PlanFields, type SiteMap } from './api';
import { t } from './strings';
import TagBar from './components/TagBar.vue';
import OrgCanvas from './org/OrgCanvas.vue';
import { createHistory } from './org/history';
import { blockIndex, PAGES, type Mode } from './org/diagrams';

const site = decodeURIComponent(location.pathname.replace(/^\/s\/?/, '').replace(/\/$/, ''));
const map = ref<SiteMap | null>(null);
const changes = ref<Change[]>([]);
const sites = ref<{ site: string; lastScan: string | null }[]>([]);
const planned = ref(true);
const mode = ref<Mode>('diagram');
const view = ref<string>(PAGES);
const showAnchors = ref(true);
const filterTag = ref<string | null>(null);
const notice = ref('');
const error = ref('');
const live = ref(false);
let unsubscribe: (() => void) | null = null;

const history = createHistory(() => map.value!.planFields);
/** Reset target: the plan fields when the canvas opened, or when another client last changed them. */
let initial: PlanFields | null = null;
const snapshot = (): PlanFields => JSON.parse(JSON.stringify(map.value!.planFields)) as PlanFields;
/** Revs this tab wrote: their SSE echo is not "another client". */
const ownRevs = new Set<number>();

/** Every write and every SSE check runs in order, so an echo is never compared against a stale rev. */
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function reload() {
  try {
    map.value = await getMap(site);
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/** Another client (an agent, another tab, a re-scan) changed the map: reload and start a new history. */
async function changedElsewhere(message?: string) {
  const had = history.canUndo || history.canRedo;
  await reload();
  history.clear();
  if (map.value) initial = snapshot();
  if (message) notice.value = message;
  else if (had) notice.value = t.historyReset;
}

async function send(op: OverlayOp): Promise<boolean> {
  if (!map.value) return false;
  try {
    const next = await sendOp(site, map.value.rev, op);
    ownRevs.add(next.rev);
    map.value = next;
    return true;
  } catch (e) {
    if (e instanceof ConflictError) {
      map.value = e.map;
      history.clear();
      initial = snapshot();
      notice.value = e.message;
    } else {
      notice.value = (e as Error).message;
      await reload();
    }
    return false;
  }
}

function act(ops: OverlayOp[], step = true): Promise<boolean> {
  return enqueue(async () => {
    if (!map.value) return false;
    if (step) history.checkpoint();
    for (const op of ops) if (!(await send(op))) return false;
    if (notice.value === t.historyReset || notice.value === t.conflict) notice.value = '';
    return true;
  });
}

const apply = (fields: PlanFields | null) => (fields ? send({ type: 'replacePlanFields', fields }) : Promise.resolve(false));
const undo = () => void enqueue(() => apply(history.undo()));
const redo = () => void enqueue(() => apply(history.redo()));
const reset = () =>
  void enqueue(async () => {
    if (!map.value || !initial || JSON.stringify(snapshot()) === JSON.stringify(initial)) return false;
    history.checkpoint();
    return apply(initial);
  });

async function startRescan() {
  try {
    await rescan(site);
    notice.value = t.head.scanning;
  } catch (e) {
    notice.value = (e as Error).message;
  }
}

watch(
  () => (map.value ? `${map.value.scanId}|${map.value.rev}` : ''),
  async (k) => {
    if (!k) return;
    try {
      changes.value = (await getPlan(site)).changes;
    } catch {
      // The panel keeps the last list; the next change refreshes it.
    }
  },
);

const components = computed(() => map.value?.components ?? []);
const blockName = (key: string) => (map.value ? blockIndex(map.value).get(key)?.name : undefined) ?? key;
watch(components, (list) => {
  if (view.value !== PAGES && !list.some((c) => c.id === view.value)) view.value = PAGES;
});

onMounted(async () => {
  if (!site) {
    sites.value = await getSites();
    return;
  }
  await reload();
  if (map.value) initial = snapshot();
  unsubscribe = subscribe(site, (type, data) => {
    if (type === 'ready') live.value = true;
    else if (type === 'progress') notice.value = String(data.msg ?? '');
    else if (type === 'scan') void enqueue(() => changedElsewhere(t.head.scanDone));
    else if (type === 'overlay') {
      void enqueue(async () => {
        const rev = Number(data.rev);
        if (!map.value || rev === map.value.rev || ownRevs.has(rev)) return;
        await changedElsewhere();
      });
    }
  });
});
onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <main v-if="!site" class="home">
    <h1>Site Atlas</h1>
    <p v-if="!sites.length" class="muted">{{ t.home.empty }}<code>site-atlas scan &lt;url&gt;</code>{{ t.home.emptyOr }}<code>atlas_scan</code>.</p>
    <ul>
      <li v-for="s in sites" :key="s.site"><a :href="`/s/${encodeURIComponent(s.site)}`">{{ s.site }}</a> <span class="muted">{{ s.lastScan }}</span></li>
    </ul>
  </main>

  <main v-else-if="map" class="app">
    <header class="head">
      <div class="title">
        <h1>{{ map.site }}</h1>
        <span class="muted">{{ map.environment.origin }}{{ map.environment.basePath }} · {{ t.head.scan }} {{ map.scanId }}</span>
        <span class="counts">
          <span class="pill err">{{ map.issueCount.error }} {{ t.head.errors }}</span>
          <span class="pill warn">{{ map.issueCount.warn }} {{ t.head.warnings }}</span>
          <span class="pill info">{{ map.issueCount.info }} {{ t.head.info }}</span>
        </span>
        <span class="grow" />
        <div class="seg" role="group" :aria-label="t.head.mode">
          <button type="button" data-testid="toggle-real" :aria-pressed="!planned" @click="planned = false">{{ t.head.real }}</button>
          <button type="button" data-testid="toggle-planned" :aria-pressed="planned" @click="planned = true">{{ t.head.planned }}</button>
        </div>
        <button type="button" data-testid="rescan" @click="startRescan">{{ t.head.rescan }}</button>
      </div>
      <div class="toolbar">
        <span class="muted">{{ t.head.view }}</span>
        <div class="seg">
          <button type="button" data-testid="view-diagram" :aria-pressed="mode === 'diagram'" @click="mode = 'diagram'">{{ t.head.diagram }}</button>
          <button type="button" data-testid="view-screenshots" :aria-pressed="mode === 'shots'" @click="mode = 'shots'">{{ t.head.screenshots }}</button>
        </div>
        <span class="muted">{{ t.head.show }}</span>
        <button type="button" data-testid="show-pages" :aria-pressed="view === PAGES" @click="view = PAGES">{{ t.head.pages }}</button>
        <button
          v-for="c in components"
          :key="c.id"
          type="button"
          data-testid="show-component"
          :data-id="c.id"
          :aria-pressed="view === c.id"
          @click="view = c.id"
        >{{ c.name }}</button>
        <label class="check"><input v-model="showAnchors" type="checkbox" data-testid="anchors-toggle" /> {{ t.head.anchors }}</label>
      </div>
      <TagBar
        :map="map"
        :filter-tag="filterTag"
        @filter="(id) => (filterTag = id)"
        @create="(name) => act([{ type: 'createTag', name }], false)"
        @rename="(tagId, name) => act([{ type: 'renameTag', tagId, name }], false)"
        @remove="(tagId) => act([{ type: 'deleteTag', tagId }], false)"
      />
      <section v-if="map.orphans.length" class="orphans" :aria-label="t.orphans.title">
        <strong>{{ t.orphans.title }}</strong>
        <span class="muted">{{ t.orphans.hint }}</span>
        <div v-for="o in map.orphans" :key="o.key" class="orphan">
          <span>{{ o.lastSeen.name }} <span class="muted">({{ o.lastSeen.page }})</span></span>
          <button v-if="o.suggestion" type="button" @click="act([{ type: 'resolveOrphan', orphanKey: o.key, action: 'assign', targetKey: o.suggestion }], false)">
            {{ t.orphans.assignTo(blockName(o.suggestion)) }}
          </button>
          <button type="button" @click="act([{ type: 'resolveOrphan', orphanKey: o.key, action: 'discard' }], false)">{{ t.orphans.discard }}</button>
        </div>
      </section>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <p class="muted hint">{{ planned ? t.head.legend : t.head.realHint }}</p>
    </header>

    <OrgCanvas
      :map="map"
      :changes="changes"
      :planned="planned"
      :view="view"
      :mode="mode"
      :show-anchors="showAnchors"
      :filter-tag="filterTag"
      :can-undo="history.canUndo"
      :can-redo="history.canRedo"
      :live="live"
      :act="act"
      :undo="undo"
      :redo="redo"
      :reset="reset"
    />
    <p class="muted hint foot">{{ t.canvasHint }}</p>
  </main>

  <main v-else class="home">
    <p :class="error ? 'error' : 'muted'">{{ error || t.home.loading }}</p>
  </main>
</template>

<style scoped>
.home { padding: 32px; max-width: 720px; }
.app { padding: 12px 16px; height: 100vh; display: flex; flex-direction: column; gap: 8px; }
.head { display: grid; gap: 8px; }
.title { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.grow { flex: 1; }
h1 { font-size: 18px; margin: 0; }
.counts { display: inline-flex; gap: 4px; }
.err { color: var(--danger); border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent); }
.warn { color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); }
.info { color: var(--muted); border: 1px solid var(--border); }
.toolbar { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; font-size: 13px; }
.seg { display: inline-flex; }
.seg button:first-child { border-radius: 6px 0 0 6px; }
.seg button:last-child { border-radius: 0 6px 6px 0; border-left: none; }
.check { display: inline-flex; gap: 6px; align-items: center; margin-left: 8px; }
.notice { margin: 0; font-size: 13px; color: var(--accent); }
.hint { margin: 0; font-size: 12px; }
.foot { text-align: right; }
.orphans { display: grid; gap: 6px; padding: 10px; border: 1px solid color-mix(in srgb, var(--warn) 50%, transparent); border-radius: 12px; }
.orphan { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.error { color: var(--danger); }
</style>
