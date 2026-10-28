import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSiteSummaries } from '../src/model/service.js';
import { SiteStore } from '../src/store/store.js';
import { sampleScan } from './helpers/sample.js';

const SITE = 'localhost-4405-demo';

describe('site summaries', () => {
  it('summarizes mode and advice', async () => {
    const store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
    await store.saveScan(sampleScan());
    expect((await listSiteSummaries(store))[0]).toMatchObject({ mode: null, advice: null });
    await store.setSiteMode(SITE, 'own');
    await store.writeAdvice(SITE, { by: 'claude-code', summary: 'Move pricing up', markdown: '…' });
    const [s] = await listSiteSummaries(store);
    expect(s).toMatchObject({ mode: 'own', advice: { by: 'claude-code', summary: 'Move pricing up' } });
    expect((s!.advice as { markdown?: string }).markdown).toBeUndefined();
  });

  it('still lists an atlas whose advice file cannot be read', async () => {
    const store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
    await store.saveScan(sampleScan());
    await store.writeAdvice(SITE, { by: 'claude-code', summary: 'Move pricing up', markdown: '…' });
    await writeFile(join(store.dir(SITE), 'advice.json'), '{ "by": "claude-code"');
    const [s] = await listSiteSummaries(store);
    expect(s).toMatchObject({ site: SITE, advice: null, pages: 2 });
  });
});
