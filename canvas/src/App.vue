<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ConflictError, getMap, getPlan, getSites, rescan, sendOp, subscribe, type Change, type OverlayOp, type PlanFields, type SiteMap } from './api';
import { t } from './strings';
import Menu from './components/Menu.vue';
import NavList from './components/NavList.vue';
import TagBar from './components/TagBar.vue';
import { AUTO_TAGS, autoColors, CONFIGURABLE, resetAutoColors, saveAutoColors } from './org/autoTags';
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
/** Issues the pending plan fixes: those its changes list as resolved, and those of sections planned for deletion. */
const fixedByPlan = computed(() => {
  const ids = new Set<string>();
  for (const c of changes.value) {
    if (c.status !== 'pending') continue;
    for (const r of (c.details.resolves as { id: string }[] | undefined) ?? []) ids.add(r.id);
  }
  const deleted = new Set(map.value?.planFields.plannedDeletions ?? []);
  for (const i of map.value?.issues ?? []) if (i.blockKey && deleted.has(i.blockKey)) ids.add(i.id);
  return ids;
});
const fixedCount = (level: 'error' | 'warn' | 'info') => (map.value?.issues ?? []).filter((i) => i.level === level && fixedByPlan.value.has(i.id)).length;
const scanning = ref(false);
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
  scanning.value = true;
  try {
    await rescan(site);
    notice.value = t.head.scanning;
  } catch (e) {
    scanning.value = false;
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
/** Not an undo step: history only snapshots plan fields, and component names are not one (spec §10b). */
const renameComponent = (id: string, name: string) => void act([{ type: 'renameComponent', componentId: id, name }], false);

/** Which optional bars show under the menus: a per-browser preference. */
const UI_KEY = 'site-atlas:ui';
const ui = ref({ navBar: false, filterBar: false, legend: true });
try {
  Object.assign(ui.value, JSON.parse(localStorage.getItem(UI_KEY) ?? '{}'));
} catch {
  // Storage blocked or unreadable: defaults.
}
watch(ui, (v) => {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(v));
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}, { deep: true });

const viewName = computed(() => (view.value === PAGES ? t.head.pages : components.value.find((c) => c.id === view.value)?.name ?? t.head.pages));
const filterName = computed(() => {
  const id = filterTag.value;
  if (!id) return null;
  if (id.startsWith('auto:')) return { name: t.autoTags[id as (typeof AUTO_TAGS)[number]], color: autoColors[id as (typeof AUTO_TAGS)[number]] };
  const tag = map.value?.tags.find((x) => x.id === id);
  return tag ? { name: tag.name, color: tag.color } : null;
});
const colorsDlg = ref<HTMLDialogElement | null>(null);
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
      scanning.value = false;
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
          <button type="button" class="pill err" data-testid="issues-error" :aria-pressed="issueLevel === 'error'" @click="toggleIssues('error')">{{ map.issueCount.error }} {{ t.head.errors }}<template v-if="fixedCount('error')"> · {{ t.issues.fixed(fixedCount('error')) }}</template></button>
          <button type="button" class="pill warn" data-testid="issues-warn" :aria-pressed="issueLevel === 'warn'" @click="toggleIssues('warn')">{{ map.issueCount.warn }} {{ t.head.warnings }}<template v-if="fixedCount('warn')"> · {{ t.issues.fixed(fixedCount('warn')) }}</template></button>
          <button type="button" class="pill info" data-testid="issues-info" :aria-pressed="issueLevel === 'info'" @click="toggleIssues('info')">{{ map.issueCount.info }} {{ t.head.info }}<template v-if="fixedCount('info')"> · {{ t.issues.fixed(fixedCount('info')) }}</template></button>
        </span>
        <span class="grow" />
        <div class="seg" role="group" :aria-label="t.head.mode">
          <button type="button" data-testid="toggle-real" :aria-pressed="!planned" @click="planned = false">{{ t.head.real }}</button>
          <button type="button" data-testid="toggle-planned" :aria-pressed="planned" @click="planned = true">{{ t.head.planned }}</button>
        </div>
        <button type="button" data-testid="rescan" :disabled="scanning" :aria-busy="scanning" @click="startRescan">{{ scanning ? t.head.scanningShort : t.head.rescan }}</button>
      </div>
      <nav class="menubar" :aria-label="t.menus.aria">
        <Menu id="navigation" :label="`${t.menus.navigation} · ${viewName}`" v-slot="{ close }">
          <NavList :components="components" :view="view" @select="(v) => { view = v; close(); }" @rename="renameComponent" />
          <p class="muted note">{{ t.menus.navigationHint }}</p>
        </Menu>
        <Menu id="filters" :label="t.menus.filters">
          <TagBar :map="map"
          :filter-tag="filterTag"
          @filter="(id) => (filterTag = id)"
          @create="(name) => act([{ type: 'createTag', name }], false)"
          @rename="(tagId, name) => act([{ type: 'renameTag', tagId, name }], false)"
          @remove="(tagId) => act([{ type: 'deleteTag', tagId }], false)" />
        </Menu>
        <Menu id="views" :label="`${t.menus.views} · ${mode === 'diagram' ? t.head.diagram : t.head.screenshots}`">
          <span class="group muted">{{ t.menus.canvas }}</span>
          <div class="seg">
            <button type="button" data-testid="view-diagram" :aria-pressed="mode === 'diagram'" @click="mode = 'diagram'">{{ t.head.diagram }}</button>
            <button type="button" data-testid="view-screenshots" :aria-pressed="mode === 'shots'" @click="mode = 'shots'">{{ t.head.screenshots }}</button>
          </div>
          <label class="check"><input v-model="showAnchors" type="checkbox" data-testid="anchors-toggle" /> {{ t.head.anchors }}</label>
          <span class="group muted">{{ t.menus.bars }}</span>
          <label class="check"><input v-model="ui.navBar" type="checkbox" data-testid="bar-navigation" /> {{ t.menus.navBar }}</label>
          <label class="check"><input v-model="ui.filterBar" type="checkbox" data-testid="bar-filters" /> {{ t.menus.filterBar }}</label>
          <label class="check"><input v-model="ui.legend" type="checkbox" data-testid="bar-legend" /> {{ t.menus.legend }}</label>
        </Menu>
        <Menu id="options" :label="t.menus.options" v-slot="{ close }">
          <button type="button" class="item" data-testid="open-tag-colors" @click="close(); colorsDlg?.showModal()">{{ t.options.colors }}</button>
        </Menu>
        <span v-if="filterName" class="active-filter" data-testid="active-filter">
          <i class="dot" :style="{ background: filterName.color }" />{{ t.menus.filteredBy(filterName.name) }}
          <button type="button" class="clear" :aria-label="t.menus.clearFilter" @click="filterTag = null">×</button>
        </span>
      </nav>
      <div v-if="ui.navBar" class="strip">
        <span class="muted">{{ t.head.show }}</span>
        <NavList inline :components="components" :view="view" @select="(v) => (view = v)" @rename="renameComponent" />
      </div>
      <div v-if="ui.filterBar" class="strip">
        <TagBar inline :map="map"
          :filter-tag="filterTag"
          @filter="(id) => (filterTag = id)"
          @create="(name) => act([{ type: 'createTag', name }], false)"
          @rename="(tagId, name) => act([{ type: 'renameTag', tagId, name }], false)"
          @remove="(tagId) => act([{ type: 'deleteTag', tagId }], false)" />
      </div>
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
          <li v-for="i in shownIssues" :key="i.id" :class="{ fixed: fixedByPlan.has(i.id) }">
            {{ i.message }}
            <span v-if="fixedByPlan.has(i.id)" class="fixed-tag">{{ t.issues.fixedTag }}</span>
            <span class="muted">· {{ i.blockKey ? blockName(i.blockKey) : '' }} {{ t.issues.page(i.page) }}</span>
          </li>
        </ul>
      </section>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <p v-if="ui.legend" class="muted hint">{{ planned ? t.head.legend : t.head.realHint }}</p>
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
    <dialog ref="colorsDlg" class="colors" data-testid="tag-colors-dialog">
      <h2>{{ t.options.colorsTitle }}</h2>
      <p class="muted">{{ t.options.colorsHint }}</p>
      <label v-for="id in CONFIGURABLE" :key="id" class="color-row">
        <input v-model="autoColors[id]" type="color" :data-testid="`color-${id}`" @change="saveAutoColors" />
        {{ t.autoTags[id] }}
      </label>
      <p class="color-row muted"><i class="dot" :style="{ background: autoColors['auto:default'] }" /> {{ t.autoTags['auto:default'] }} · {{ t.options.defaultFixed }}</p>
      <div class="row">
        <button type="button" @click="resetAutoColors">{{ t.options.reset }}</button>
        <button type="button" class="primary" @click="colorsDlg?.close()">{{ t.options.done }}</button>
      </div>
    </dialog>
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
.issues li.fixed { color: var(--muted); }
.fixed-tag { font-size: 11px; color: var(--line-green); border: 1px solid color-mix(in srgb, var(--line-green) 45%, transparent); border-radius: 8px; padding: 0 6px; margin-left: 4px; }
.issues .close { position: absolute; top: 6px; right: 8px; padding: 0 7px; }
.err { color: var(--danger); border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent); }
.warn { color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); }
.info { color: var(--muted); border: 1px solid var(--border); }
.menubar { display: flex; flex-wrap: wrap; gap: 2px 4px; align-items: center; font-size: 13px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
.strip { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; font-size: 13px; }
.group { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
.note { margin: 2px 0 0; font-size: 11px; }
.item { text-align: left; }
.active-filter { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; padding: 2px 4px 2px 10px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.active-filter .clear { border: none; background: none; padding: 0 6px; color: var(--muted); }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
dialog.colors { border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; background: var(--surface); color: var(--text); min-width: 300px; }
dialog.colors h2 { font-size: 15px; margin: 0 0 4px; }
dialog.colors::backdrop { background: rgba(0, 0, 0, 0.3); }
.color-row { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
.color-row input { width: 34px; height: 26px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: none; }
.row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
.primary { background: var(--accent); border-color: var(--accent); color: var(--surface); }
.seg { display: inline-flex; }
.seg button:first-child { border-radius: 6px 0 0 6px; }
.seg button:last-child { border-radius: 0 6px 6px 0; margin-left: -1px; }
.seg button[aria-pressed='true'] { position: relative; z-index: 1; }
.check { display: flex; gap: 8px; align-items: center; }
.notice { margin: 0; font-size: 13px; color: var(--accent); }
.hint { margin: 0; font-size: 12px; }
.foot { text-align: right; }
.orphans { display: grid; gap: 6px; padding: 10px; border: 1px solid color-mix(in srgb, var(--warn) 50%, transparent); border-radius: 12px; }
.orphan { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.error { color: var(--danger); }
</style>
