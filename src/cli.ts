#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Argument, Command, Option } from 'commander';
import { en } from './i18n/en.js';
import { OpError, type OverlayOp } from './model/ops.js';
import { getPlan, mutate, requireScan } from './model/service.js';
import type { Target } from './schema/overlay.js';
import type { SectionRole } from './schema/scan.js';
import { runScan } from './run.js';
import { ROLE_ORDER } from './scan/roles.js';
import { startCanvasServer } from './server/serve.js';
import { SiteStore, type SiteMode } from './store/store.js';
import { VERSION } from './version.js';

const list = (v: string, prev: string[] = []) => [...prev, v];
const envInt = (name: string): number | undefined => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isNaN(n) ? undefined : n;
};
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
  .version(VERSION)
  .addHelpText('after', en.cli.helpWindows);

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
      p.blocks.forEach((b, i) =>
        console.log(`  ${String(i + 1).padStart(2, '0')}. ${b.name} [${b.kind} · ${b.role}]${b.cta ? ' CTA' : ''}${b.global ? ` ${en.cli.global}` : ''}`),
      );
    }
  });

program
  .command('canvas [site]')
  .description(en.cli.canvas)
  .option('--port <n>', en.cli.port, (v) => Number.parseInt(v, 10), envInt('SITE_ATLAS_PORT'))
  .option('--host <host>', en.cli.host, process.env.SITE_ATLAS_HOST)
  .option('--token <token>', en.cli.token, process.env.SITE_ATLAS_TOKEN)
  .action(async (site: string | undefined, o: { port?: number; host?: string; token?: string }) => {
    const { url, token } = await startCanvasServer(new SiteStore(), o);
    const page = `${url}/s/${site ?? ''}`;
    console.log(en.cli.canvasUrl(page));
    if (token) {
      console.log(en.cli.canvasOpen(`${page}?token=${token}`));
      console.log(en.cli.canvasToken(token));
      console.log(en.cli.canvasRemoteHint);
    }
  });

program
  .command('setup')
  .description(en.cli.setup)
  .option('--with-deps', en.cli.withDeps)
  .action(async (o: { withDeps?: boolean }) => {
    const { installChromium } = await import('./setup.js');
    const code = await installChromium({ withDeps: Boolean(o.withDeps) });
    if (code !== 0) throw new Error(en.cli.setupFailed(code));
    console.log(en.cli.setupDone);
    if (process.platform === 'linux' && !o.withDeps) console.log(en.cli.setupLinuxHint);
  });

program
  .command('doctor')
  .description(en.cli.doctor)
  .option('--json', en.cli.doctorJson)
  .action(async (o: { json?: boolean }) => {
    const { doctor } = await import('./setup.js');
    const checks = await doctor(store());
    const fails = checks.filter((c) => !c.ok).length;
    if (o.json) {
      console.log(JSON.stringify({ ok: fails === 0, checks }, null, 2));
    } else {
      for (const c of checks) console.log(`${c.ok ? en.cli.doctorOk : en.cli.doctorFail}  ${c.text}`);
      console.log(en.cli.doctorSummary(fails));
    }
    if (fails) process.exitCode = 1;
  });

program
  .command('advise <site>')
  .description(en.cli.advise)
  .option('--file <path>', en.cli.adviseFile)
  .option('--summary <text>', en.cli.adviseSummary)
  .addOption(new Option('--mode <mode>', en.cli.adviseMode).choices(['own', 'advisory']))
  .option('--by <name>', en.cli.adviseBy, BY)
  .action(async (site: string, o: { file?: string; summary?: string; mode?: SiteMode; by: string }) => {
    const sites = store();
    if (o.file === undefined && o.summary === undefined && o.mode === undefined) {
      const advice = await sites.readAdvice(site);
      const { mode } = await sites.readSiteInfo(site);
      if (!advice) {
        // The mode is what the apply skill refuses on, and a person can set it on the canvas long
        // before any advice exists. Without MCP this command is the only way to read it, so say it
        // here too; silence would let an agent treat someone else's site as its own. Still exit 1:
        // there is no advice to print.
        if (mode) console.log(en.cli.adviceMode(site, mode));
        throw new Error(en.cli.noAdvice);
      }
      console.log(`${en.cli.adviceHeader(advice.by, advice.at, mode)}\n\n${advice.markdown.trimEnd()}`);
      return;
    }
    if (o.file === undefined || o.summary === undefined || o.mode === undefined) throw new Error(en.cli.adviseNeedsAll);
    // A site with no scan has no atlas to advise on: fail before writing, so no folder is created for it.
    // The advice goes first because it is what validates the summary, and the mode is the gate the apply
    // skill reads: a rejected call must not leave the mode flipped with no advice behind it.
    await requireScan(sites, site);
    await sites.writeAdvice(site, { by: o.by, summary: o.summary, markdown: await readFile(o.file, 'utf8') });
    await sites.setSiteMode(site, o.mode);
    console.log(en.cli.adviceSaved(site));
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
    propose(site, { type: 'moveBlock', blockKey, toPage, index: o.index ?? Number.MAX_SAFE_INTEGER, by: BY }),
  );

const page = program.command('page').description(en.cli.page);
page
  .command('add <site> <path>')
  .description(en.cli.pageAdd)
  .option('--title <title>', en.cli.pageTitle)
  .action((site: string, path: string, o: { title?: string }) => propose(site, { type: 'addPlannedPage', path, title: o.title ?? '', by: BY }));
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

program
  .command('unlink <site> <owner>')
  .description(en.cli.unlink)
  .requiredOption('--text <text>', en.cli.linkText)
  .requiredOption('--href <href>', en.cli.linkHref)
  .action((site: string, owner: string, o: { text: string; href: string }) => propose(site, { type: 'unlink', owner, linkText: o.text, linkHref: o.href, by: BY }));

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
  .action((site: string, blockKey: string) => propose(site, { type: 'markDeleted', blockKey, by: BY }));

program
  .command('restore <site> <blockKey>')
  .description(en.cli.restore)
  .action((site: string, blockKey: string) => propose(site, { type: 'restore', blockKey, by: BY }));

program
  .command('role')
  .description(en.cli.role)
  .argument('<site>')
  .argument('<blockKey>')
  .addArgument(new Argument('<role>', en.cli.roleValue).choices([...ROLE_ORDER, 'auto']))
  .action(async (site: string, blockKey: string, role: string) => {
    await mutate(store(), site, { type: 'setRole', blockKey, role: role === 'auto' ? null : (role as SectionRole) });
    console.log(en.cli.roleSet(blockKey, role));
  });

program
  .command('component')
  .description(en.cli.component)
  .command('rename <site> <componentId> <name>')
  .description(en.cli.componentRename)
  .action(async (site: string, componentId: string, name: string) => {
    await mutate(store(), site, { type: 'renameComponent', componentId, name });
    console.log(en.cli.componentRenamed(componentId, name.trim()));
  });

program
  .command('mcp')
  .description(en.cli.mcp)
  .action(async () => {
    const { startMcpStdio } = await import('./mcp/server.js');
    await startMcpStdio(new SiteStore());
  });

// Git Bash (MSYS) rewrites arguments that start with "/" into Windows paths before Node sees them.
const MSYS_PREFIX = /^[A-Za-z]:[\\/](Program Files[\\/]Git|msys64|usr)[\\/]/i;
const mangled = process.argv.slice(2).find((a) => MSYS_PREFIX.test(a));
if (mangled) {
  console.error(en.cli.mangledPath(mangled));
  process.exit(1);
}

program.parseAsync().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
