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
/** Issue level whose list is open, from a click on its counter. */
const issueLevel = ref<'error' | 'warn' | 'info' | null>(null);
const shownIssues = computed(() => (map.value && issueLevel.value ? map.value.issues.filter((i) => i.level === issueLevel.value) : []));
const toggleIssues = (level: 'error' | 'warn' | 'info') => (issueLevel.value = issueLevel.value === level ? null : level);
let unsubscribe: (() => void) | null = null;

const history = createHistory(() => map.value!.planFields);
/** Reset target: no planned changes, so every page shows as the real site. */
const EMPTY: PlanFields = { plannedOrder: {}, plannedPages: [], plannedDeletions: [], layout: {}, linkEdits: {}, addedLinks: [], removedLinks: {} };
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
  const text = [message, had && t.historyReset].filter(Boolean).join(' ');
  if (text) notice.value = text;
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
      // A foreign write won the lock: with steps to lose, say that history was reset.
      notice.value = history.canUndo || history.canRedo ? t.historyReset : e.message;
      map.value = e.map;
      history.clear();
    } else {
      // Unknown server state: a foreign write may land in the reload, so no step may undo over it.
      await changedElsewhere((e as Error).message);
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
    if (!map.value || JSON.stringify(map.value.planFields) === JSON.stringify(EMPTY)) return false;
    history.checkpoint();
    return apply(EMPTY);
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
  unsubscribe = subscribe(site, (type, data) => {
    if (type === 'ready') live.value = true;
    else if (type === 'progress') notice.value = String(data.msg ?? '');
    else if (type === 'scan') {
      // The rescan route and the file watcher both announce a scan: react to the first only.
      void enqueue(async () => {
        if (map.value && data.scanId === map.value.scanId) return;
        await changedElsewhere(t.head.scanDone);
      });
    }
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
          <button type="button" class="pill err" data-testid="issues-error" :aria-pressed="issueLevel === 'error'" @click="toggleIssues('error')">{{ map.issueCount.error }} {{ t.head.errors }}</button>
          <button type="button" class="pill warn" data-testid="issues-warn" :aria-pressed="issueLevel === 'warn'" @click="toggleIssues('warn')">{{ map.issueCount.warn }} {{ t.head.warnings }}</button>
          <button type="button" class="pill info" data-testid="issues-info" :aria-pressed="issueLevel === 'info'" @click="toggleIssues('info')">{{ map.issueCount.info }} {{ t.head.info }}</button>
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
      <section v-if="issueLevel" class="issues" data-testid="issues-panel" :aria-label="t.issues.title[issueLevel]">
        <strong>{{ t.issues.title[issueLevel] }}</strong>
        <button type="button" class="close" :aria-label="t.issues.close" @click="issueLevel = null">×</button>
        <ul>
          <li v-for="i in shownIssues" :key="i.id">
            {{ i.message }}
            <span class="muted">· {{ i.blockKey ? blockName(i.blockKey) : '' }} {{ t.issues.page(i.page) }}</span>
          </li>
        </ul>
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
.counts .pill { cursor: pointer; background: none; }
.counts .pill[aria-pressed='true'] { background: var(--surface); }
.issues { position: relative; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); font-size: 13px; }
.issues ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 3px; }
.issues .close { position: absolute; top: 6px; right: 8px; padding: 0 7px; }
.err { color: var(--danger); border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent); }
.warn { color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); }
.info { color: var(--muted); border: 1px solid var(--border); }
.toolbar { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; font-size: 13px; }
.seg { display: inline-flex; }
.seg button:first-child { border-radius: 6px 0 0 6px; }
.seg button:last-child { border-radius: 0 6px 6px 0; margin-left: -1px; }
.seg button[aria-pressed='true'] { position: relative; z-index: 1; }
.check { display: inline-flex; gap: 6px; align-items: center; margin-left: 8px; }
.notice { margin: 0; font-size: 13px; color: var(--accent); }
.hint { margin: 0; font-size: 12px; }
.foot { text-align: right; }
.orphans { display: grid; gap: 6px; padding: 10px; border: 1px solid color-mix(in srgb, var(--warn) 50%, transparent); border-radius: 12px; }
.orphan { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.error { color: var(--danger); }
</style>
