#!/usr/bin/env node
import { Command, Option } from 'commander';
import { en } from './i18n/en.js';
import { OpError, type OverlayOp } from './model/ops.js';
import { getPlan, mutate } from './model/service.js';
import type { Target } from './schema/overlay.js';
import { runScan } from './run.js';
import { startCanvasServer } from './server/serve.js';
import { SiteStore } from './store/store.js';
import { VERSION } from './version.js';

const list = (v: string, prev: string[] = []) => [...prev, v];
const BY = 'cli';
const store = () => new SiteStore();
const propose = async (site: string, op: OverlayOp) => {
  await mutate(store(), site, op);
  console.log(en.cli.planUpdated(site));
};
const targetOf = (o: { toBlock?: string; toPage?: string }): Target => {
  if (!o.toBlock === !o.toPage) throw new OpError(en.cli.needTarget);
  return o.toBlock ? { block: o.toBlock } : { page: o.toPage! };
};

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
  .command('plan <site>')
  .description(en.cli.plan)
  .option('--json', en.cli.planJson)
  .addOption(new Option('--status <status>', en.cli.planStatus).choices(['pending', 'applied']))
  .action(async (site: string, o: { json?: boolean; status?: 'pending' | 'applied' }) => {
    const { markdown, changes, schemaVersion } = await getPlan(store(), site, o.status);
    console.log(o.json ? JSON.stringify({ schemaVersion, changes }, null, 2) : markdown.trimEnd());
  });

program
  .command('confirm <site> <changeId>')
  .description(en.cli.confirm)
  .option('--note <text>', en.cli.note)
  .action(async (site: string, changeId: string, o: { note?: string }) => {
    await mutate(store(), site, { type: 'confirmChange', changeId, note: o.note ?? '', by: BY });
    console.log(en.cli.confirmed(changeId));
  });

program
  .command('reopen <site> <changeId>')
  .description(en.cli.reopen)
  .option('--note <text>', en.cli.reopenNote)
  .action(async (site: string, changeId: string, o: { note?: string }) => {
    await mutate(store(), site, { type: 'reopenChange', changeId, note: o.note ?? '', by: BY });
    console.log(en.cli.reopened(changeId));
  });

program
  .command('move <site> <blockKey> <toPage>')
  .description(en.cli.move)
  .option('--index <n>', en.cli.index, (v) => Number.parseInt(v, 10))
  .action((site: string, blockKey: string, toPage: string, o: { index?: number }) =>
    propose(site, { type: 'moveBlock', blockKey, toPage, index: o.index ?? Number.MAX_SAFE_INTEGER }),
  );

const page = program.command('page').description(en.cli.page);
page
  .command('add <site> <path>')
  .description(en.cli.pageAdd)
  .option('--title <title>', en.cli.pageTitle)
  .action((site: string, path: string, o: { title?: string }) => propose(site, { type: 'addPlannedPage', path, title: o.title ?? '' }));
page
  .command('remove <site> <path>')
  .description(en.cli.pageRemove)
  .action((site: string, path: string) => propose(site, { type: 'removePlannedPage', path, by: BY }));

program
  .command('relink <site> <owner>')
  .description(en.cli.relink)
  .requiredOption('--text <text>', en.cli.linkText)
  .requiredOption('--href <href>', en.cli.linkHref)
  .option('--to-block <blockKey>', en.cli.toBlock)
  .option('--to-page <path>', en.cli.toPage)
  .action((site: string, owner: string, o: { text: string; href: string; toBlock?: string; toPage?: string }) =>
    propose(site, { type: 'relink', owner, linkText: o.text, linkHref: o.href, to: targetOf(o), by: BY }),
  );

const link = program.command('link').description(en.cli.link);
link
  .command('add <site> <owner>')
  .description(en.cli.linkAdd)
  .option('--to-block <blockKey>', en.cli.toBlock)
  .option('--to-page <path>', en.cli.toPage)
  .option('--label <text>', en.cli.linkLabel)
  .action((site: string, owner: string, o: { toBlock?: string; toPage?: string; label?: string }) =>
    propose(site, { type: 'addLink', owner, to: targetOf(o), label: o.label, by: BY }),
  );
link
  .command('remove <site> <linkId>')
  .description(en.cli.linkRemove)
  .action((site: string, linkId: string) => propose(site, { type: 'removeLink', linkId, by: BY }));

program
  .command('delete <site> <blockKey>')
  .description(en.cli.delete)
  .action((site: string, blockKey: string) => propose(site, { type: 'markDeleted', blockKey }));

program
  .command('restore <site> <blockKey>')
  .description(en.cli.restore)
  .action((site: string, blockKey: string) => propose(site, { type: 'restore', blockKey }));

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
