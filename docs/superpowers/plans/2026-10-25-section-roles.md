# Section Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every scanned section gets a detected role (features, logos, steps, pricing, FAQ…) that the canvas shows and filters by, agents read through MCP and the CLI, and the person can override in a way that survives re-scans.

**Architecture:** The in-page extraction adds a `signals` block per section (cards, numbers, quotes, prices, images…). A pure classifier `classify()` in `src/scan/roles.ts` turns tag, headings, keywords and signals into a primary role, secondary roles and a CTA flag, following a fixed precedence. The scan stores them; the overlay stores `roleOverrides` next to `kindOverrides`; the map exposes `effectiveRole`; the canvas replaces its four auto tags with roles; MCP and CLI gain a way to read and set them.

**Tech Stack:** Node 24, TypeScript, Playwright (in-page `String.raw` script, no transpiled helpers), Zod, Vue 3, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-section-roles-design.md`

## Global Constraints

- English in code, copy, tool descriptions and canvas strings (`tests/english.test.ts`).
- Role ids are exactly the 22 lower-case words of spec §3 and never change (they are stored in overlays).
- Scan and overlay `schemaVersion` unchanged; every new field is optional with a default (`signals?`, `role` default `'default'`, `roles` default `[]`, `cta` default `false`, `roleReasons` default `[]`, `roleOverrides` default `{}`).
- `classify` is pure and deterministic; keyword matching is accent-insensitive, whole-word, on kicker + heading + anchor only.
- The in-page script stays one `page.evaluate` and the existing test "termina rápido en páginas enormes" stays green.
- Branch `feat/section-roles`, cut from `feat/start-page`.

## Review Focus

1. A section with two columns of text and image (a "two cards" layout): must count `cards = 2` so audience/solutions rules can fire and `feature`/`content` do not swallow it (Task 1 fixture `two-up` section; Task 2 unit test).
2. A heading like "About our process" on a feature grid: keyword `about` and `process` must not beat `features` (Task 2 test: cards=3 + kw about → `features`, because `about` requires `cards == 0`; and kw steps without numbers/ordered/cards → not steps).
3. An old scan without `signals`: map build and canvas must not throw; role falls back to navigation/footer/hero/form/default (Task 3 test with `sampleScan()` which has no signals).
4. A role override on a block that later moves to another page (block key changes): the override follows it, as `kindOverrides` do (Task 3 test via `moveBlock` + reconcile path `renameKey`).
5. A huge page (the existing 2,000-element fixture): signal counting must stay under the current time budget (Task 1 reuses that test's assertion, unchanged).

---

### Task 1: Signals in the extraction and the scan schema

**Files:**
- Modify: `src/schema/scan.ts` (`SignalsSchema`, block fields `signals`, `role`, `roles`, `cta`, `roleReasons`)
- Modify: `src/scan/extract.ts` (`IN_PAGE`), `src/scan/blocks.ts` (`RawBlock.signals`)
- Create: `tests/fixtures/site/roles.html`
- Test: `tests/extract.test.ts`

**Interfaces:**
- Produces, in `src/schema/scan.ts`:
  - `export const SectionRoleSchema = z.enum([...22 ids of spec §3...])`, `export type SectionRole`.
  - `export const SignalsSchema = z.object({ words, cards, cardHeadingLevel: z.number().nullable(), listItems, orderedItems, numbered, accordions, quotes, prices, bigNumbers, questions, smallImages, largeImages, imageRatio, contactHints, tabs })` (all `z.number()` except where noted), `export type Signals`.
  - `BaseBlockSchema` gains `signals: SignalsSchema.optional()`, `role: SectionRoleSchema.default('default')`, `roles: z.array(SectionRoleSchema).default([])`, `cta: z.boolean().default(false)`, `roleReasons: z.array(z.string()).default([])`.
- Produces, in `src/scan/blocks.ts`: `RawBlock.signals: Signals`.
- Produces: `tests/fixtures/site/roles.html`, one `<section id="…">` per role in this order with these ids: `nav` (header), `hero` (h1 + button-styled link), `logos` (8 small `<img width=120>` chips, ≤ 3 words each), `feature` (h2 + one large img + 60 words), `features` (h2 + 6 `<article>` with h3), `two-up` (h2 "Para quienes empiezan" kicker "Para quién" + 2 `<article>` with h3 and 40 words each), `products` (h2 "Productos" + `<ul>` of 6 `<li>` + one large img), `solutions` (kicker "Soluciones", 3 cards), `steps` (kicker "Cómo trabajamos", 4 cards with `<span>01</span>`…), `stats` (3 `<strong style="font-size:48px">` numbers "25+", "99.9%", "12k"), `testimonials` (3 `<blockquote>` with `<cite>`), `pricing` (3 cards with "$29/mes"), `faq` (4 `<details><summary>…?</summary>`), `team` (4 cards with `<img>` + h3 name + 3-word role), `about` (kicker "Nosotros", 2 paragraphs, no cards), `gallery` (5 large imgs, 10 words), `banner` (h2 + large background img + 12 words), `contact` (form with 2 fields + `<a href="mailto:…">`), `content` (200 words, no images), `plain` (one `<p>` of 30 words → default), footer. Images point at `tests/fixtures/site/` assets that already exist (reuse the current fixture's images; add a 1×1 `pixel.png` if needed and size it with width/height attributes).

- [ ] **Step 1: Write the failing extraction test** in `tests/extract.test.ts`:

```ts
it('counts the role signals of each section of roles.html', async () => {
  const raws = await extract('roles.html');
  const by = (id: string) => raws.find((r) => r.anchor === id)!.signals;
  expect(by('features')).toMatchObject({ cards: 6, cardHeadingLevel: 3 });
  expect(by('two-up')).toMatchObject({ cards: 2 });
  expect(by('logos').smallImages).toBeGreaterThanOrEqual(8);
  expect(by('stats').bigNumbers).toBe(3);
  expect(by('testimonials').quotes).toBe(3);
  expect(by('pricing').prices).toBeGreaterThanOrEqual(3);
  expect(by('faq')).toMatchObject({ questions: 4, accordions: 4 });
  expect(by('steps').numbered).toBe(4);
  expect(by('products')).toMatchObject({ listItems: 6 });
  expect(by('products').largeImages).toBeGreaterThanOrEqual(1);
  expect(by('contact').contactHints).toBeGreaterThanOrEqual(1);
  expect(by('content').words).toBeGreaterThanOrEqual(150);
  expect(by('gallery').largeImages).toBeGreaterThanOrEqual(4);
  expect(by('banner').imageRatio).toBeGreaterThanOrEqual(0.3);
});
```

(`extract(file)` is the helper the file already uses to scan a fixture page and return raws; if it does not exist as a function, add it next to the existing tests.)

- [ ] **Step 2: Run** `pnpm exec vitest run tests/extract.test.ts` — Expected: FAIL (`signals` undefined / fixture missing).
- [ ] **Step 3: Create** `roles.html` as specified; **implement** the `signals` object in `IN_PAGE` per spec §4 (cards: for the block and each descendant container up to depth 3, the largest run of ≥ 2 consecutive children sharing a tag where each child contains a heading or an image; `cardHeadingLevel`: the lowest heading level found inside those cards; `bigNumbers`: `getComputedStyle(el).fontSize ≥ 32` and text matching `/^\D{0,2}\d[\d.,]*\s?(%|\+|k|M|x|[A-Za-zÀ-ÿ]{1,12}( [A-Za-zÀ-ÿ]{1,12})?)?$/`; `imageRatio`: like today's `visualRatio` but over `img, picture, video, canvas`); add the schema fields.
- [ ] **Step 4: Run** `pnpm exec vitest run tests/extract.test.ts tests/scan.test.ts` — Expected: PASS, including the huge-page test.
- [ ] **Step 5: Commit** — `git add src/schema/scan.ts src/scan tests/fixtures/site/roles.html tests/extract.test.ts && git commit -m "feat(scan): role signals per section"`

---

### Task 2: The classifier

**Files:**
- Create: `src/scan/roles.ts`
- Modify: `src/scan/scan.ts:160-185` (fill `role`, `roles`, `cta`, `roleReasons` per block)
- Test: `tests/roles.test.ts` (new), `tests/scan.test.ts`

**Interfaces:**
- Consumes: `Signals`, `SectionRole`, `RawBlock` from Task 1.
- Produces, in `src/scan/roles.ts`:
  - `export interface RoleInput { tag: string; landmark: boolean; isFirstSection: boolean; pageHasH1Here: boolean; heading: string | null; kicker: string | null; anchor: string | null; components: Components; signals: Signals | undefined }`
  - `export interface Detection { role: SectionRole; secondary: SectionRole[]; cta: boolean; reasons: string[] }`
  - `export function classify(input: RoleInput): Detection` — precedence and rules exactly as spec §5.1 and §5.3; `secondary` = the next matching roles after the primary, at most 2, never `default`; missing `signals` → all zeros and `words = heading/text word count` (spec §5.4).
  - `export const ROLE_KEYWORDS: Record<SectionRole, string[]>` — the table of spec §5.2.
  - `export function matchesKeyword(role: SectionRole, texts: (string | null)[]): boolean` — accent-stripped (`normalize('NFD')` + strip marks), lower-case, whole-word or whole-phrase match.
  - `export const ROLE_ORDER: SectionRole[]` — the precedence list.
- Produces, in `src/scan/scan.ts`: each block built with `...classify({ …raw, isFirstSection: i === firstNonLandmarkIndex, pageHasH1Here: raw.components.headings.some(h => h.level === 1) })` → `role`, `roles`, `cta`, `roleReasons`, and `signals: raw.signals`.

- [ ] **Step 1: Write the failing unit tests** in `tests/roles.test.ts`, with a helper `input(over: Partial<RoleInput> & { signals?: Partial<Signals> })` that fills zeros:

```ts
it('follows the precedence: a hero with cards is a hero, a form with contact hints is contact', () => {
  expect(classify(input({ pageHasH1Here: true, signals: { cards: 3 } })).role).toBe('hero');
  expect(classify(input({ components: withForm(2), signals: { contactHints: 1 } })).role).toBe('contact');
  expect(classify(input({ components: withForm(2) }))).toMatchObject({ role: 'form', secondary: [] });
});
it('needs process words for numbered cards to be steps; audience words make them audience', () => {
  expect(classify(input({ kicker: 'Cómo trabajamos', signals: { cards: 4, numbered: 4, cardHeadingLevel: 3 } })).role).toBe('steps');
  expect(classify(input({ kicker: 'Para quién', signals: { cards: 3, numbered: 3, cardHeadingLevel: 3 } })).role).toBe('audience');
  expect(classify(input({ heading: 'Our platform', signals: { cards: 3, numbered: 3, cardHeadingLevel: 3 } })).role).toBe('features');
});
it('matches keywords only in kicker, heading and anchor, accent-insensitively', () => {
  expect(matchesKeyword('about', ['NOSOTROS'])).toBe(true);
  expect(matchesKeyword('about', ['Sobre nos'])).toBe(true);
  expect(matchesKeyword('steps', ['Processing payments'])).toBe(false); // whole word
  expect(classify(input({ heading: 'About our process', signals: { cards: 3, cardHeadingLevel: 3 } })).role).toBe('features');
});
it('recognizes logos, stats, testimonials, pricing, faq, team, gallery, banner, feature, content, default', () => {
  expect(classify(input({ signals: { smallImages: 8, words: 20 } })).role).toBe('logos');
  expect(classify(input({ signals: { bigNumbers: 3, words: 30 } })).role).toBe('stats');
  expect(classify(input({ signals: { quotes: 2, cards: 2 } })).role).toBe('testimonials');
  expect(classify(input({ signals: { prices: 3, cards: 3, cardHeadingLevel: 3 } })).role).toBe('pricing');
  expect(classify(input({ signals: { questions: 4, accordions: 4 } })).role).toBe('faq');
  expect(classify(input({ signals: { cards: 4, cardHeadingLevel: 3, smallImages: 4, words: 60 } })).role).toBe('team');
  expect(classify(input({ signals: { largeImages: 5, words: 10 } })).role).toBe('gallery');
  expect(classify(input({ heading: 'Control absoluto', signals: { largeImages: 1, imageRatio: 0.8, words: 12 } })).role).toBe('banner');
  expect(classify(input({ heading: 'Una sola infraestructura', signals: { largeImages: 1, words: 80 } })).role).toBe('feature');
  expect(classify(input({ signals: { words: 300 } })).role).toBe('content');
  expect(classify(input({ signals: { words: 30 } })).role).toBe('default');
});
it('products: keyword with a list, or a list next to a large image, or tabs', () => {
  expect(classify(input({ kicker: 'Productos', signals: { listItems: 6, words: 120 } })).role).toBe('products');
  expect(classify(input({ signals: { listItems: 6, largeImages: 1, words: 120 } })).role).toBe('products');
  expect(classify(input({ signals: { tabs: 3 } })).role).toBe('products');
});
it('secondary roles list the next matches, never default; cta is an attribute', () => {
  const d = classify(input({ components: { ...withForm(2), links: [{ text: 'Go', href: '/x', kind: 'internal', cta: true }] }, signals: { contactHints: 1 } }));
  expect(d).toMatchObject({ role: 'contact', secondary: ['form'], cta: true });
});
it('classifies an old block without signals like today', () => {
  expect(classify(input({ tag: 'header', landmark: true, signals: undefined })).role).toBe('navigation');
  expect(classify(input({ signals: undefined })).role).toBe('default');
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run tests/roles.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/scan/roles.ts` and wire it in `src/scan/scan.ts`.
- [ ] **Step 4: Write the failing fixture test** in `tests/scan.test.ts`:

```ts
it('assigns one role per section of roles.html', async () => {
  const scan = await scanSite(`${server.url}/roles.html`, { site: 'roles', maxPages: 1, shotsDir: () => shots });
  const roles = Object.fromEntries(scan.pages[0]!.blocks.map((b) => [b.anchor ?? b.name, b.role]));
  expect(roles).toMatchObject({ hero: 'hero', logos: 'logos', feature: 'feature', features: 'features', 'two-up': 'audience', products: 'products', solutions: 'solutions', steps: 'steps', stats: 'stats', testimonials: 'testimonials', pricing: 'pricing', faq: 'faq', team: 'team', about: 'about', gallery: 'gallery', banner: 'banner', contact: 'contact', content: 'content', plain: 'default' });
  expect(scan.pages[0]!.blocks[0]!.role).toBe('navigation');
  expect(scan.pages[0]!.blocks.at(-1)!.role).toBe('footer');
});
```

- [ ] **Step 5: Run** `pnpm exec vitest run tests/roles.test.ts tests/scan.test.ts` — Expected: PASS. Adjust `roles.html` (never the rules) when a fixture section does not carry the signals the spec says it must.
- [ ] **Step 6: Update the live acceptance test** `tests/acceptance.test.ts`: rename "Solicite una propuesta" to "Cotización" and add the expected role list of spec §7 as a `toEqual` on `blocks.map(b => b.role)`, plus `expect(roles).not.toContain('default')`. It stays `skipIf(!process.env.ATLAS_BETA1_URL)`.
- [ ] **Step 7: Commit** — `git add src/scan tests && git commit -m "feat(scan): classify sections into roles"`

---

### Task 3: Overrides in the overlay, roles on the map

**Files:**
- Modify: `src/schema/overlay.ts` (`roleOverrides`), `src/model/ops.ts` (`setRole` op, migration in `renameKey`, orphan cleanup), `src/model/map.ts` (`BlockView` fields), `src/i18n/en.ts` (`op.noRole`)
- Test: `tests/ops.test.ts`, `tests/map-v2.test.ts` (or `tests/overlay-v2.test.ts`, where kind overrides are tested today)

**Interfaces:**
- Consumes: `SectionRoleSchema` from Task 1.
- Produces:
  - `OverlaySchema.roleOverrides: z.record(z.string(), SectionRoleSchema).default({})`; `emptyOverlay()` includes it.
  - `OverlayOp` gains `{ type: 'setRole'; blockKey: string; role: SectionRole | null }` with the same validation as `setKind` (block must exist in the scan → `OpError(en.op.noBlock)`); `renameKey` moves `roleOverrides[from]` to `to` like `kindOverrides`; orphan discard deletes it.
  - `BlockView` gains `effectiveRole: SectionRole`, `roleOverridden: boolean` (`role`, `roles`, `cta` come from `Block`).

- [ ] **Step 1: Write the failing tests** (next to the `setKind` tests):

```ts
it('setRole overrides the detected role, null clears it, and the override follows a renamed key', () => {
  const scan = sampleScan();
  let o = applyOp(emptyOverlay(), scan, { type: 'setRole', blockKey: '/#top', role: 'banner' });
  expect(o.roleOverrides['/#top']).toBe('banner');
  expect(buildMap(scan, o).pages[0]!.blocks.find((b) => b.key === '/#top')).toMatchObject({ effectiveRole: 'banner', roleOverridden: true });
  expect(() => applyOp(o, scan, { type: 'setRole', blockKey: '/#nada', role: 'banner' })).toThrow(/No section/);
  o = applyOp(o, scan, { type: 'setRole', blockKey: '/#top', role: null });
  expect(o.roleOverrides).toEqual({});
});
it('an old scan without signals still builds a map with roles', () => {
  const map = buildMap(sampleScan(), emptyOverlay());
  for (const b of map.pages.flatMap((p) => p.blocks)) expect(typeof b.effectiveRole).toBe('string');
});
```

plus, in the test that covers `renameKey` / moves of `kindOverrides`, the same assertion for `roleOverrides`.

- [ ] **Step 2: Run** — Expected: FAIL (unknown op type).
- [ ] **Step 3: Implement** schema, op, migration, map fields.
- [ ] **Step 4: Run** `pnpm exec vitest run tests/ops.test.ts tests/map-v2.test.ts tests/overlay-v2.test.ts tests/reconcile.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(model): role overrides and effective roles"`

---

### Task 4: MCP and CLI

**Files:**
- Modify: `src/mcp/server.ts` (`formatMap`, `atlas_get_block` already returns the block, new `atlas_set_block_role`, `atlas_get_map` description), `src/cli.ts` (`scan` output, new `role` command), `src/i18n/en.ts`
- Test: `tests/mcp.test.ts`, `tests/cli.test.ts`, `tests/english.test.ts` (add `['role']`)

**Interfaces:**
- `formatMap` block line: `… ${b.name} [${en.kind[b.effectiveKind]} · ${b.effectiveRole}]${b.cta ? ' CTA' : ''}…`.
- `atlas_set_block_role` input `{ site: string; blockKey: string; role: SectionRole | null }`, description `en.mcp.tools.setBlockRole = 'Correct the detected role of a section (features, pricing, faq, steps…), or null to go back to the detected one. The correction is kept across scans. Does not modify the site.'`; returns `apply(site, { type: 'setRole', … })`. Tool count 22 (24 if the plugin's two land first; the test lists names, so update the list and the length together).
- `en.mcp.tools.getMap` appended: ` Each section shows its kind and its detected role (hero, features, logos, steps, pricing, faq, testimonials, contact…).`
- CLI: `scan` prints `  01. Name [narrative · features] CTA`; `site-atlas role <site> <blockKey> <role|auto>` → `propose`-style call with `setRole`, prints `en.cli.roleSet(blockKey, role)`; invalid role → commander `.choices([...ROLE_ORDER, 'auto'])`.

- [ ] **Step 1: Write the failing tests**: in `tests/mcp.test.ts` extend the tool list; add

```ts
it('shows roles on the map, in block details, and lets the agent correct one', async () => {
  expect(text(await call('atlas_get_map', { site: SITE }))).toMatch(/\[(narrative|visual|conversion) · [a-z]+\]/);
  const before = JSON.parse(text(await call('atlas_get_block', { site: SITE, blockKey: '/#top' })).split('\n\n').slice(1).join('\n\n'));
  expect(before).toHaveProperty('effectiveRole');
  expect((await call('atlas_set_block_role', { site: SITE, blockKey: '/#top', role: 'banner' })).isError).toBeFalsy();
  expect(text(await call('atlas_get_map', { site: SITE }))).toContain('· banner]');
});
```

and in `tests/cli.test.ts`:

```ts
it('role sets and clears an override', SLOW, async () => {
  const { cli } = await setup();
  expect((await cli('role', SITE, '/#top', 'pricing')).code).toBe(0);
  expect((await cli('role', SITE, '/#top', 'nonsense')).code).toBe(1);
  expect((await cli('role', SITE, '/#top', 'auto')).code).toBe(0);
});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `pnpm exec vitest run tests/mcp.test.ts tests/cli.test.ts tests/english.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(mcp,cli): read and correct section roles"`

---

### Task 5: Canvas: role chips, filter, override control

**Files:**
- Modify: `canvas/src/org/autoTags.ts` (roles replace the four tags), `canvas/src/org/Piece.vue`, `canvas/src/components/TagBar.vue`, `canvas/src/App.vue` (colors dialog lists roles), `canvas/src/strings.ts` (`roles.*`), `canvas/src/org/OrgCanvas.vue` / `diagrams.ts` only if `OrgContext` needs `setRole`
- Test: `tests/canvas.e2e.test.ts`

**Interfaces:**
- `autoTags.ts`: `export const ROLE_IDS = ROLE_ORDER.map(r => \`auto:${r}\`)` (import `ROLE_ORDER` from `../../src/scan/roles.js`, type-only + value is fine, the file has no Node imports); `autoTags(b: BlockView): string[]` returns `[\`auto:${b.effectiveRole}\`, ...(b.cta ? ['auto:cta'] : [])]`; `DEFAULT_AUTO_COLORS` per role with the four existing colors kept for `auto:navigation`, `auto:hero`, `auto:form`, `auto:cta` and `auto:default` gray; stored colors under the old ids `auto:nav` migrate to `auto:navigation` on load.
- `TagBar`: lists only the roles present on the map (count > 0) plus `auto:cta` when present; `data-testid="auto-tag"` and `data-id` unchanged.
- `Piece.vue`: detected chips from `autoTags(b)`; in Edit mode, a `<select data-testid="role-select">` with "Auto (detected)" + the 22 roles, value `b.roleOverridden ? b.effectiveRole : 'auto'`, `@change` → `ctx.setRole(key, value === 'auto' ? null : value)`; `OrgContext.setRole` added next to `setKind`, implemented in `OrgCanvas.vue` as `act([{ type: 'setRole', blockKey, role }], false)`.
- Strings: `t.roles: Record<SectionRole, string>` with the display names of spec §3 ("Navigation", "Footer", "Hero", "Form", "Contact", "Pricing", "FAQ", "Testimonials", "Logos", "Stats", "Steps", "Audience", "Solutions", "Products", "Team", "About", "Gallery", "Banner", "Features", "Feature", "Content", "Default"), `t.roles.cta = 'Call to action'`, `t.roles.auto = 'Auto (detected)'`.

- [ ] **Step 1: Write the failing e2e tests** (main describe; the `demo` site is scanned from `tests/fixtures/site/index.html`, whose sections now carry roles):

```ts
it('shows the detected role on each piece and filters by it', async () => {
  const chips = page.locator('[data-testid="detected-tag"]');
  await expect.poll(() => chips.count()).toBeGreaterThan(5);
  expect(await chips.filter({ hasText: 'Default' }).count()).toBeLessThan(await chips.count() / 2);
  await openMenu('filters');
  const roleButtons = page.locator('[data-testid="auto-tag"]');
  expect(await roleButtons.count()).toBeGreaterThanOrEqual(3);
  await roleButtons.filter({ hasText: 'Hero' }).click();
  await closeMenus();
  await expect.poll(() => piece('/', '/#top').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await openMenu('filters'); await roleButtons.filter({ hasText: 'Hero' }).click(); await closeMenus();
});
it('overrides a role from the piece and the map remembers it', async () => {
  const top = piece('/', '/#top');
  await top.locator('.lh').click();
  await top.getByTestId('role-select').selectOption('banner');
  await expect.poll(async () => (await serverMap()).pages[0]!.blocks.find((b) => b.key === '/#top')!.effectiveRole).toBe('banner');
  expect(await top.locator('[data-testid="detected-tag"]').first().textContent()).toBe('Banner');
  await top.getByTestId('role-select').selectOption('auto');
  await expect.poll(async () => (await serverMap()).pages[0]!.blocks.find((b) => b.key === '/#top')!.roleOverridden).toBe(false);
  await top.locator('.lh').click();
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run tests/canvas.e2e.test.ts` — Expected: FAIL (no `role-select`).
- [ ] **Step 3: Implement** the canvas changes; keep the tag-colors dialog test (`color-auto:form`) working by keeping the id `auto:form`.
- [ ] **Step 4: Run** `pnpm exec vitest run tests/canvas.e2e.test.ts tests/english.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add canvas tests && git commit -m "feat(canvas): detected roles, role filter and override"`

---

### Task 6: Docs, full run, PR

**Files:**
- Modify: `README.md` ("What it does" row for Issues/Org chart gains a "Roles" sentence; the MCP tools table gains `atlas_set_block_role`; CLI table gains `role`), `docs/plan-schema.md` only if it lists block fields.

- [ ] **Step 1: Update** the README rows and tool count.
- [ ] **Step 2: Run the whole suite** `pnpm typecheck && pnpm test` — Expected: green. If `ATLAS_BETA1_URL` can be set (SCAP Tech running on `http://localhost:4400/beta-1/`), run `ATLAS_BETA1_URL=http://localhost:4400/beta-1/ pnpm exec vitest run tests/acceptance.test.ts` and record the role list in the PR.
- [ ] **Step 3: Commit** — `git commit -am "docs: section roles"`
- [ ] **Step 4: Push** `git push -u origin feat/section-roles` and open the PR against `feat/start-page`; in the description, paste the roles of `roles.html` and, if run, the SCAP list.
