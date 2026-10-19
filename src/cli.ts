#!/usr/bin/env node
import { Command } from 'commander';
import { runScan } from './run.js';
import { startCanvasServer } from './server/serve.js';
import { SiteStore } from './store/store.js';
import { VERSION } from './version.js';

const list = (v: string, prev: string[] = []) => [...prev, v];

const program = new Command()
  .name('site-atlas')
  .description('Mapa semántico de sitios web: escaneo por bloques, lienzo y servidor MCP.')
  .version(VERSION);

program
  .command('scan <url>')
  .description('Escanea un sitio y guarda su mapa.')
  .option('--site <id>', 'nombre del sitio (por defecto se deriva de la URL)')
  .option('--max-pages <n>', 'máximo de páginas', (v) => Number.parseInt(v, 10), 30)
  .option('--include <glob>', 'incluir solo rutas que coincidan (repetible)', list)
  .option('--exclude <glob>', 'excluir rutas que coincidan (repetible)', list)
  .action(async (url: string, o: { site?: string; maxPages: number; include?: string[]; exclude?: string[] }) => {
    const { scan } = await runScan(new SiteStore(), url, { ...o, onProgress: (m) => console.error(m) });
    const blocks = scan.pages.reduce((n, p) => n + p.blocks.length, 0);
    const count = (l: string) => scan.issues.filter((i) => i.level === l).length;
    console.log(`Sitio: ${scan.site}`);
    console.log(`Escaneo: ${scan.scanId}`);
    console.log(`Páginas: ${scan.pages.length} · Bloques: ${blocks} · Alertas: ${count('error')} errores, ${count('warn')} avisos, ${count('info')} info`);
    for (const p of scan.pages) {
      console.log(`\n${p.path}${p.error ? `  [${p.error}]` : ''}`);
      p.blocks.forEach((b, i) => console.log(`  ${String(i + 1).padStart(2, '0')}. ${b.name} [${b.kind}]${b.global ? ' (global)' : ''}`));
    }
  });

program
  .command('canvas [site]')
  .description('Abre el lienzo local en el navegador.')
  .option('--port <n>', 'puerto', (v) => Number.parseInt(v, 10))
  .action(async (site: string | undefined, o: { port?: number }) => {
    const { url } = await startCanvasServer(new SiteStore(), { port: o.port });
    console.log(`Lienzo: ${url}/s/${site ?? ''}`);
  });

program
  .command('mcp')
  .description('Inicia el servidor MCP por stdio.')
  .action(async () => {
    const { startMcpStdio } = await import('./mcp/server.js');
    await startMcpStdio(new SiteStore());
  });

program.parseAsync().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
