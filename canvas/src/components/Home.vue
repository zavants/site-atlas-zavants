<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { deleteSite, getSites, renameSite, rescan, startScan, subscribe, type SiteSummary } from '../api';
import { t } from '../strings';

const sites = ref<SiteSummary[] | null>(null);
const error = ref('');

/* ---------- new atlas ---------- */
const url = ref('');
const maxPages = ref(30);
const include = ref('');
const exclude = ref('');
const scanningNew = ref<string | null>(null);
const progress = ref<string[]>([]);
const globs = (s: string) => s.split(',').map((g) => g.trim()).filter(Boolean);
let unsubscribe: (() => void) | null = null;

/** Scans are announced per site: follow one until it ends, then stop listening. */
function follow(site: string, onDone: () => void) {
  unsubscribe?.();
  unsubscribe = subscribe(site, (type, data) => {
    if (type === 'progress') {
      progress.value = [...progress.value.slice(-7), String(data.msg ?? '')];
      if (data.failed) {
        error.value = String(data.msg ?? '');
        unsubscribe?.();
        unsubscribe = null;
        scanningNew.value = null;
        busy.value.delete(site);
      }
    } else if (type === 'scan') {
      unsubscribe?.();
      unsubscribe = null;
      onDone();
    }
  });
}

async function submit() {
  error.value = '';
  progress.value = [];
  try {
    const { site } = await startScan({
      url: url.value.trim(),
      maxPages: maxPages.value,
      include: globs(include.value).length ? globs(include.value) : undefined,
      exclude: globs(exclude.value).length ? globs(exclude.value) : undefined,
    });
    scanningNew.value = site;
    follow(site, () => {
      location.href = `/s/${encodeURIComponent(site)}`;
    });
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/* ---------- existing atlases ---------- */
const busy = ref(new Set<string>());
const renaming = ref<string | null>(null);
const newName = ref('');
const doomed = ref<SiteSummary | null>(null);
const removeDlg = ref<HTMLDialogElement | null>(null);
const copiedFor = ref<string | null>(null);

const reload = async () => {
  try {
    sites.value = await getSites();
  } catch (e) {
    error.value = (e as Error).message;
  }
};

async function startRescan(s: SiteSummary) {
  error.value = '';
  busy.value.add(s.site);
  try {
    await rescan(s.site);
    follow(s.site, () => {
      busy.value.delete(s.site);
      void reload();
    });
  } catch (e) {
    busy.value.delete(s.site);
    error.value = (e as Error).message;
  }
}

function startRename(s: SiteSummary) {
  renaming.value = s.site;
  newName.value = s.name;
}
async function saveRename(s: SiteSummary) {
  try {
    await renameSite(s.site, newName.value);
    renaming.value = null;
    await reload();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function askRemove(s: SiteSummary) {
  doomed.value = s;
  removeDlg.value?.showModal();
}
async function remove() {
  const s = doomed.value;
  removeDlg.value?.close();
  if (!s) return;
  try {
    await deleteSite(s.site);
    await reload();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function copyPrompt(s: SiteSummary) {
  try {
    await navigator.clipboard.writeText(t.home.aiPrompt(s.site));
    copiedFor.value = s.site;
    setTimeout(() => (copiedFor.value = null), 1500);
  } catch {
    // Clipboard blocked: the text stays selectable.
  }
}

/** Scan ids look like 2026-10-21T06-43-46.273Z: dashes stand in for the colons a file name cannot hold. */
const when = (id: string | null) => {
  if (!id) return t.home.neverScanned;
  const date = new Date(id.replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3'));
  return t.home.lastScan(Number.isNaN(date.getTime()) ? id : date.toLocaleString());
};

onMounted(reload);
onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <main class="home" data-testid="home">
    <h1>Site Atlas</h1>
    <p class="muted tagline">{{ t.home.tagline }}</p>

    <form class="new" data-testid="new-atlas" @submit.prevent="submit">
      <h2>{{ t.home.newAtlas }}</h2>
      <div class="row">
        <input v-model="url" type="url" required :placeholder="t.home.urlPlaceholder" :aria-label="t.home.url" data-testid="scan-url" :disabled="!!scanningNew" />
        <button type="submit" class="primary" data-testid="scan-start" :disabled="!!scanningNew" :aria-busy="!!scanningNew">{{ scanningNew ? t.home.scanning : t.home.scan }}</button>
      </div>
      <details class="options">
        <summary>{{ t.home.options }}</summary>
        <label>{{ t.home.maxPages }} <input v-model.number="maxPages" type="number" min="1" max="500" data-testid="scan-max-pages" /></label>
        <label>{{ t.home.include }} <input v-model="include" type="text" placeholder="/docs/**" /></label>
        <label>{{ t.home.exclude }} <input v-model="exclude" type="text" placeholder="/blog/**" /></label>
      </details>
      <div v-if="scanningNew" class="progress" role="status" data-testid="scan-progress">
        <strong>{{ t.home.scanningSite(scanningNew) }}</strong>
        <span class="muted">{{ t.home.opensWhenDone }}</span>
        <ol><li v-for="(m, i) in progress" :key="i">{{ m }}</li></ol>
      </div>
    </form>

    <p v-if="error" class="error" role="alert" data-testid="home-error">{{ error }}</p>

    <h2>{{ t.home.yourAtlases }}</h2>
    <p v-if="!sites" class="muted">{{ t.home.loading }}</p>
    <p v-else-if="!sites.length" class="muted">{{ t.home.empty }}<code>site-atlas scan &lt;url&gt;</code>{{ t.home.emptyOr }}<code>atlas_scan</code>.</p>
    <ul v-else class="cards">
      <li v-for="s in sites" :key="s.site" class="card" data-testid="atlas-card" :data-site="s.site">
        <div class="card-head">
          <template v-if="renaming === s.site">
            <input v-model="newName" type="text" :placeholder="t.home.renamePlaceholder" data-testid="rename-input" @keydown.enter.prevent="saveRename(s)" @keydown.escape="renaming = null" />
            <button type="button" data-testid="rename-save" @click="saveRename(s)">{{ t.home.save }}</button>
            <button type="button" @click="renaming = null">{{ t.home.cancel }}</button>
          </template>
          <template v-else>
            <a class="name" :href="`/s/${encodeURIComponent(s.site)}`" data-testid="atlas-name">{{ s.name || s.site }}</a>
            <span v-if="s.name" class="muted id">{{ s.site }}</span>
          </template>
        </div>
        <span class="muted">{{ s.origin ?? s.startUrl ?? '' }}</span>
        <span class="muted">{{ busy.has(s.site) ? t.home.scanning : when(s.lastScan) }}</span>
        <span>{{ t.home.size(s.pages, s.blocks) }} · {{ t.home.issues(s.issues.error, s.issues.warn) }}</span>
        <span data-testid="atlas-plan">{{ t.home.plan(s.pending, s.applied) }}</span>
        <div class="actions">
          <a class="button" :href="`/s/${encodeURIComponent(s.site)}`">{{ t.home.open }}</a>
          <button type="button" data-testid="atlas-rescan" :disabled="busy.has(s.site)" @click="startRescan(s)">{{ t.home.rescan }}</button>
          <button type="button" data-testid="atlas-rename" @click="startRename(s)">{{ t.home.rename }}</button>
          <button type="button" class="danger" data-testid="atlas-delete" @click="askRemove(s)">{{ t.home.remove }}</button>
        </div>
        <details class="ai">
          <summary>{{ t.home.forAi }}</summary>
          <p class="muted">{{ t.home.forAiHint }}</p>
          <pre data-testid="ai-prompt">{{ t.home.aiPrompt(s.site) }}</pre>
          <button type="button" @click="copyPrompt(s)">{{ copiedFor === s.site ? t.home.copied : t.home.copy }}</button>
        </details>
      </li>
    </ul>

    <dialog ref="removeDlg" data-testid="remove-dialog">
      <strong>{{ doomed ? t.home.removeTitle(doomed.name || doomed.site) : '' }}</strong>
      <p class="muted">{{ t.home.removeHint }}</p>
      <div class="row end">
        <button type="button" @click="removeDlg?.close()">{{ t.home.cancel }}</button>
        <button type="button" class="danger" data-testid="remove-confirm" @click="remove">{{ t.home.remove }}</button>
      </div>
    </dialog>
  </main>
</template>

<style scoped>
.home { padding: 32px; max-width: 880px; margin: 0 auto; display: grid; gap: 18px; }
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 15px; margin: 0; }
.tagline { margin: -10px 0 0; }
.new { display: grid; gap: 10px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.row { display: flex; gap: 8px; align-items: center; }
.row.end { justify-content: flex-end; margin-top: 14px; }
.row input[type='url'] { flex: 1; }
input { font: inherit; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); min-width: 0; }
.options { font-size: 13px; }
.options summary { cursor: pointer; color: var(--muted); }
.options label { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-top: 8px; }
.options input { width: 50%; }
.progress { display: grid; gap: 4px; font-size: 13px; }
.progress ol { margin: 4px 0 0; padding-left: 18px; color: var(--muted); font-family: ui-monospace, monospace; font-size: 12px; }
.cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.card { display: grid; gap: 4px; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); font-size: 13px; }
.card-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.card-head input { flex: 1; }
.name { font-size: 15px; font-weight: 600; text-decoration: none; }
.name:hover { text-decoration: underline; }
.id { font-size: 12px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
a.button { display: inline-block; padding: 4px 10px; border: 1px solid var(--accent); border-radius: 6px; color: var(--accent); text-decoration: none; font-size: 13px; }
.primary { background: var(--accent); border-color: var(--accent); color: var(--surface); }
.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
.ai { margin-top: 6px; }
.ai summary { cursor: pointer; color: var(--muted); }
.ai p { margin: 6px 0; }
.ai pre { white-space: pre-wrap; font-size: 12px; padding: 8px; border-radius: 8px; background: var(--bg); user-select: text; }
dialog { border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; font-size: 14px; max-width: 420px; background: var(--surface); color: var(--text); }
dialog::backdrop { background: rgba(0, 0, 0, 0.3); }
.error { color: var(--danger); margin: 0; }
</style>
