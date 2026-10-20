#!/usr/bin/env node
import { Command } from 'commander';
import { en } from './i18n/en.js';
import { runScan } from './run.js';
import { startCanvasServer } from './server/serve.js';
import { SiteStore } from './store/store.js';
import { VERSION } from './version.js';

const list = (v: string, prev: string[] = []) => [...prev, v];

const program = new Command()
  .name('site-atlas')
  .description(en.cli.description)
  .version(VERSION);

program
  .command('scan <url>')
  .description(en.cli.scan)
  .option('--site <id>', en.cli.siteOption)
  .option('--max-pages <n>', en.cli.maxPages, (v) => Number.parseInt(v, 10), 30)
  .option('--include <glob>', en.cli.include, list)
  .option('--exclude <glob>', en.cli.exclude, list)
  .action(async (url: string, o: { site?: string; maxPages: number; include?: string[]; exclude?: string[] }) => {
    const { scan } = await runScan(new SiteStore(), url, { ...o, onProgress: (m) => console.error(m) });
    const blocks = scan.pages.reduce((n, p) => n + p.blocks.length, 0);
    const count = (l: string) => scan.issues.filter((i) => i.level === l).length;
    console.log(en.cli.siteLine(scan.site));
    console.log(en.cli.scanLine(scan.scanId));
    console.log(en.cli.summary(scan.pages.length, blocks, count('error'), count('warn'), count('info')));
    for (const p of scan.pages) {
      console.log(`\n${p.path}${p.error ? `  [${p.error}]` : ''}`);
      p.blocks.forEach((b, i) => console.log(`  ${String(i + 1).padStart(2, '0')}. ${b.name} [${b.kind}]${b.global ? ` ${en.cli.global}` : ''}`));
    }
  });

program
  .command('canvas [site]')
  .description(en.cli.canvas)
  .option('--port <n>', en.cli.port, (v) => Number.parseInt(v, 10))
  .action(async (site: string | undefined, o: { port?: number }) => {
    const { url } = await startCanvasServer(new SiteStore(), { port: o.port });
    console.log(en.cli.canvasUrl(`${url}/s/${site ?? ''}`));
  });

program
  .command('mcp')
  .description(en.cli.mcp)
  .action(async () => {
    const { startMcpStdio } = await import('./mcp/server.js');
    await startMcpStdio(new SiteStore());
  });

program.parseAsync().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
