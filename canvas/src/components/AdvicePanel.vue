<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getAdvice, localDate, type Advice } from '../api';
import { t } from '../strings';

const props = defineProps<{ site: string }>();
defineEmits<{ close: [] }>();

const advice = ref<Advice | null>(null);
const error = ref('');
const loading = ref(true);

/** The panel loads when it opens: the home page and the canvas both mount it fresh each time. */
onMounted(async () => {
  try {
    advice.value = await getAdvice(props.site);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="advice" data-testid="advice-panel">
    <header>
      <strong>{{ advice ? t.home.adviceBy(advice.by, localDate(advice.at)) : t.head.advice }}</strong>
      <button type="button" class="close" @click="$emit('close')">{{ t.home.adviceClose }}</button>
    </header>
    <p v-if="loading" class="muted">{{ t.home.loading }}</p>
    <p v-else-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="!advice" class="muted">{{ t.home.noAdvice }}</p>
    <!-- Markdown written by an agent quotes text from the scanned site: it is shown as text, never rendered as HTML. -->
    <pre v-else data-testid="advice-text">{{ advice.markdown }}</pre>
  </section>
</template>

<style scoped>
.advice { display: grid; gap: 8px; font-size: 13px; min-width: 0; }
header { display: flex; gap: 12px; align-items: baseline; justify-content: space-between; }
.close { flex: none; }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; max-height: 60vh; overflow: auto; padding: 10px; border-radius: 8px; background: var(--bg); font-size: 12px; }
p { margin: 0; }
.error { color: var(--danger); }
</style>
