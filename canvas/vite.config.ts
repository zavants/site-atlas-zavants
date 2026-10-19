import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: '/',
  plugins: [vue()],
  build: { outDir: fileURLToPath(new URL('../dist/canvas', import.meta.url)), emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:4800', '/shots': 'http://127.0.0.1:4800' } },
});
