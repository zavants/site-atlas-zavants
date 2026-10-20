import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { en } from '../i18n/en.js';
import type { BlockView, SiteMap } from '../model/map.js';
import { OpError, type OverlayOp } from '../model/ops.js';
import { getMap, getPlan, mutate, requireScan, SiteNotFoundError } from '../model/service.js';
import { runScan } from '../run.js';
import { startCanvasServer } from '../server/serve.js';
import type { SiteStore } from '../store/store.js';
import { VERSION } from '../version.js';

export const UNTRUSTED_NOTICE = en.untrustedNotice;
const UNTRUSTED_META = { 'site-atlas/untrusted': true };

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

const siteText = (body: string, extra: Content[] = []) => ({
  content: [{ type: 'text' as const, text: `${UNTRUSTED_NOTICE}\n\n${body}` }, ...extra],
  _meta: UNTRUSTED_META,
});
const plain = (body: string) => ({ content: [{ type: 'text' as const, text: body }] });
const failure = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

function blockLine(b: BlockView, i: number, tagNames: Map<string, string>): string {
  const tags = b.tags.map((t) => ` #${tagNames.get(t) ?? t}`).join('');
  const flags = [b.issues.length ? `⚠${b.issues.length}` : '', b.deleted ? en.mcp.flags.delete : '', b.isNew ? en.mcp.flags.new : '', b.moved ? en.mcp.flags.moved : '']
    .filter(Boolean)
    .join(' ');
  return `  ${String(i + 1).padStart(2, '0')}. ${b.name} [${en.kind[b.effectiveKind]}]${tags}${flags ? ` ${flags}` : ''}  (${b.key})`;
}

export function formatMap(map: SiteMap, page?: string): string {
  const tagNames = new Map(map.tags.map((t) => [t.id, t.name]));
  const lines = [
    en.mcp.mapHeader(map.site, map.scanId, map.rev),
    en.mcp.issueCounts(map.issueCount.error, map.issueCount.warn, map.issueCount.info),
    en.mcp.tags(map.tags.map((t) => `${t.name} (${t.id})`).join(', ') || en.mcp.none),
    '',
    en.mcp.globals,
    ...map.globals.map((b, i) => blockLine(b, i, tagNames)),
  ];
  for (const p of map.pages.filter((x) => !page || x.path === page)) {
    lines.push('', `${p.path}${p.planned ? ` ${en.mcp.planned}` : ''}${p.status && p.status >= 400 ? ` [HTTP ${p.status}]` : ''} — ${p.title}`);
    lines.push(...(p.blocks.length ? p.blocks.map((b, i) => blockLine(b, i, tagNames)) : [`  ${en.mcp.noBlocks}`]));
  }
  if (map.orphans.length) {
    lines.push('', en.mcp.orphans, ...map.orphans.map((o) => `  ${o.lastSeen.name} (${o.key})${o.suggestion ? ` ${en.mcp.suggestion(o.suggestion)}` : ''}`));
  }
  return lines.join('\n');
}

export function createMcpServer(store: SiteStore): McpServer {
  const server = new McpServer({ name: 'site-atlas', version: VERSION });

  const guard =
    <A>(fn: (args: A) => Promise<ReturnType<typeof plain> | ReturnType<typeof siteText>>) =>
    async (args: A) => {
      try {
        return await fn(args);
      } catch (err) {
        if (err instanceof OpError || err instanceof SiteNotFoundError) return failure(err.message);
        return failure(en.mcp.error((err as Error).message));
      }
    };

  const apply = async (site: string, op: OverlayOp) => siteText(formatMap(await mutate(store, site, op)));
  const resolveTagIds = async (site: string, tags: string[]) => {
    const overlay = await store.readOverlay(site);
    return tags.map((t) => overlay.tags.find((x) => x.id === t || x.name.toLowerCase() === t.toLowerCase())?.id ?? t);
  };

  server.registerTool(
    'atlas_scan',
    {
      description: en.mcp.tools.scan,
      inputSchema: {
        url: z.string().url().describe(en.mcp.tools.scanUrl),
        site: z.string().optional().describe(en.mcp.tools.scanSite),
        maxPages: z.number().int().min(1).max(500).optional(),
        include: z.array(z.string()).optional().describe(en.mcp.tools.scanInclude),
        exclude: z.array(z.string()).optional().describe(en.mcp.tools.scanExclude),
      },
    },
    guard(async ({ url, ...opts }) => {
      const { scan, overlay } = await runScan(store, url, opts);
      const blocks = scan.pages.reduce((n, p) => n + p.blocks.length, 0);
      const count = (l: string) => scan.issues.filter((i) => i.level === l).length;
      return plain(
        en.mcp.scanResult(scan.site, scan.scanId, scan.pages.length, blocks, count('error'), count('warn'), count('info'), overlay.orphans.length),
      );
    }),
  );

  server.registerTool(
    'atlas_list_sites',
    { description: en.mcp.tools.listSites, inputSchema: {} },
    guard(async () => {
      const sites = await store.listSites();
      return plain(sites.length ? sites.map((s) => en.mcp.siteLine(s.site, s.lastScan ?? '—')).join('\n') : en.mcp.noSites);
    }),
  );

  server.registerTool(
    'atlas_get_map',
    {
      description: en.mcp.tools.getMap,
      inputSchema: { site: z.string(), page: z.string().optional().describe(en.mcp.tools.getMapPage) },
    },
    guard(async ({ site, page }) => siteText(formatMap(await getMap(store, site), page))),
  );

  server.registerTool(
    'atlas_get_block',
    {
      description: en.mcp.tools.getBlock,
      inputSchema: { site: z.string(), blockKey: z.string(), withImage: z.boolean().optional() },
    },
    guard(async ({ site, blockKey, withImage }) => {
      const map = await getMap(store, site);
      const block = [...map.globals, ...map.pages.flatMap((p) => p.blocks)].find((b) => b.key === blockKey);
      if (!block) throw new OpError(en.op.noBlock(blockKey));
      const extra: Content[] = [];
      if (withImage && block.shot) {
        try {
          const data = await readFile(join(store.shotsDir(site, map.scanId), block.shot));
          extra.push({ type: 'image', data: data.toString('base64'), mimeType: 'image/webp' });
        } catch {
          // no thumbnail available
        }
      }
      const { shot: _shot, ...rest } = block;
      return siteText(JSON.stringify(rest, null, 2), extra);
    }),
  );

  server.registerTool(
    'atlas_list_issues',
    {
      description: en.mcp.tools.listIssues,
      inputSchema: { site: z.string(), level: z.enum(['error', 'warn', 'info']).optional() },
    },
    guard(async ({ site, level }) => {
      const scan = await requireScan(store, site);
      const issues = scan.issues.filter((i) => !level || i.level === level);
      return siteText(issues.length ? issues.map((i) => `[${i.level}] ${i.page}${i.blockKey ? ` ${i.blockKey}` : ''}: ${i.message}`).join('\n') : en.mcp.noIssues);
    }),
  );

  server.registerTool(
    'atlas_tags',
    {
      description: en.mcp.tools.tags,
      inputSchema: {
        site: z.string(),
        action: z.enum(['create', 'rename', 'delete']),
        name: z.string().optional(),
        tagId: z.string().optional().describe(en.mcp.tools.tagsId),
        color: z.string().optional(),
      },
    },
    guard(async ({ site, action, name, tagId, color }) => {
      if (action === 'create') {
        if (!name) throw new OpError(en.mcp.missingTagName);
        return apply(site, { type: 'createTag', name, color });
      }
      if (!tagId) throw new OpError(en.mcp.missingTagId);
      const [id] = await resolveTagIds(site, [tagId]);
      if (action === 'rename') {
        if (!name) throw new OpError(en.mcp.missingNewName);
        return apply(site, { type: 'renameTag', tagId: id!, name });
      }
      return apply(site, { type: 'deleteTag', tagId: id! });
    }),
  );

  server.registerTool(
    'atlas_set_block_tags',
    {
      description: en.mcp.tools.setBlockTags,
      inputSchema: { site: z.string(), blockKey: z.string(), tags: z.array(z.string()) },
    },
    guard(async ({ site, blockKey, tags }) => apply(site, { type: 'setBlockTags', blockKey, tagIds: await resolveTagIds(site, tags) })),
  );

  server.registerTool(
    'atlas_move_block',
    {
      description: en.mcp.tools.moveBlock,
      inputSchema: { site: z.string(), blockKey: z.string(), toPage: z.string(), index: z.number().int().min(0) },
    },
    guard(async ({ site, blockKey, toPage, index }) => apply(site, { type: 'moveBlock', blockKey, toPage, index })),
  );

  server.registerTool(
    'atlas_add_planned_page',
    {
      description: en.mcp.tools.addPlannedPage,
      inputSchema: { site: z.string(), path: z.string(), title: z.string() },
    },
    guard(async ({ site, path, title }) => apply(site, { type: 'addPlannedPage', path, title })),
  );

  server.registerTool(
    'atlas_get_plan',
    {
      description: en.mcp.tools.getPlan,
      inputSchema: { site: z.string() },
    },
    guard(async ({ site }) => {
      const { diffs, text } = await getPlan(store, site);
      return siteText(`${text}\n\n${JSON.stringify(diffs, null, 2)}`);
    }),
  );

  server.registerTool(
    'atlas_open_canvas',
    { description: en.mcp.tools.openCanvas, inputSchema: { site: z.string() } },
    guard(async ({ site }) => {
      await requireScan(store, site);
      const { url } = await startCanvasServer(store);
      return plain(`${url}/s/${encodeURIComponent(site)}`);
    }),
  );

  return server;
}

export async function startMcpStdio(store: SiteStore): Promise<void> {
  console.log = console.error;
  await createMcpServer(store).connect(new StdioServerTransport());
}
