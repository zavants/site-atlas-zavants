# Section roles: richer detection of what each section is — Design

**Status:** draft for approval · **Date:** 2026-10-25 · **Repo:** `zavants/site-atlas-zavants`
**Builds on:** design v1 (`2026-10-19-site-atlas-design.md`), the org chart (`2026-10-19-organigrama-design.md`). Independent of the AI plugin design (`2026-10-25-ai-plugin-design.md`), which will benefit from it.

---

## 1. Intent

On the canvas every section carries a detected tag. Today there are four (Navigation, Hero, Form, Call to action) and everything else is "Default", so on a typical marketing page eleven sections in a row look the same and the person learns nothing from the tags. The user's words, looking at SCAP Tech: "mejoremos la detección".

This design replaces that with a **role** per section: what kind of section it is in the vocabulary of marketing sites (features, logos, steps, pricing, FAQ, testimonials…). The role is detected by the scanner from the rendered page, stored with the scan, shown on the canvas, exposed to agents through MCP and the CLI, and correctable by hand in a way that survives re-scans. A better role vocabulary is also what the advisory method of the AI plugin needs to reason about structure ("the pricing section sits below the FAQ").

## 2. Goals, non-goals and anti-goals

**Goals**

1. Every section gets one **primary role** from a fixed list (§3), plus up to two secondary roles, plus a boolean "has a call to action".
2. Detection runs in the **scanner**, from structure and text signals of the rendered DOM (§4), so the canvas, the plan, MCP and the CLI all see the same roles.
3. The person can **override** a role from the canvas; the override is keyed by block key and survives re-scans and moves exactly as the kind override does today.
4. Keyword rules work in **Spanish, English and Portuguese**.
5. On the SCAP Tech home (the acceptance set, §7) no section is "Default" and every role matches the expected one.

**Non-goals**

- Changing the narrative / visual / conversion *kind*: it stays as it is (it drives colors and the plan's wording).
- Changing how sections are split or named.
- Learning or LLM-based classification: rules only, so results are explainable and stable between scans.
- Page-level roles (landing vs blog post vs legal page).

**Anti-goals**

- A role that flips between two scans of an unchanged page. Rules are deterministic over the extracted signals; the extracted signals do not depend on viewport scroll position or timing.
- Hiding the old data: scans made before this change still load; their sections get a role computed from the signals they have (mostly Default), and a re-scan upgrades them.
- Text from the site steering anything beyond classification: keywords are matched, never executed or echoed as instructions.

## 3. The roles

| Role | What it is | Primary signals (details in §5) |
|---|---|---|
| `navigation` | header or nav | landmark header / nav tag, many internal links, few words |
| `footer` | page footer | landmark footer |
| `hero` | the main promise | contains the page's h1, or is the first non-navigation section with a heading and a CTA |
| `form` | a form to fill | a form with at least one field |
| `contact` | ways to reach the company | form or links `tel:` / `mailto:`, an `address` element, or contact keywords; wins over `form` when those hints exist |
| `pricing` | prices and plans | prices (currency or "/month"), or pricing keywords with cards |
| `faq` | questions and answers | ≥ 3 headings or summaries ending in "?", or accordions with faq keywords |
| `testimonials` | opinions | ≥ 2 quotes (blockquote, `q`, or quoted text with a name after it) or testimonial keywords with cards |
| `logos` | wall of logos or integrations | ≥ 6 small images or icon-chips, few words per item, no heading inside each one |
| `stats` | figures | ≥ 3 big numbers (large font, with `%`, `+`, `k`, `M`, `x` or a unit) |
| `steps` | a process | numbered or ordered items **and** process keywords, or an `ol` with ≥ 3 items |
| `audience` | who it is for | audience keywords ("para quién", "who is it for", "para quem") with cards |
| `solutions` | by business model or industry | solutions / industries keywords with cards |
| `products` | catalog, modules, plans without prices | product keywords, or a list of ≥ 5 short items next to one large image (tabbed showcase) |
| `team` | the people | team keywords; ≥ 3 cards with an image and a short name + role text confirm them |
| `about` | who we are | about keywords, no cards |
| `gallery` | images dominate | ≥ 4 large images and few words |
| `banner` | a closing band with a line and maybe one button | one heading, ≤ 40 words, a large image or visual ratio ≥ 0.3 (a CSS background sized to fill the band counts as the ratio), not the hero |
| `features` | grid of benefits or modules | ≥ 3 cards with a heading each |
| `feature` | one benefit spotlighted | one heading, one large image, ≤ 120 words, no cards |
| `content` | long text | ≥ 150 words, no cards, no large image |
| `default` | none of the above | — |

"Call to action" stops being a role: `cta: boolean` is set when the section has a button-styled link or a button outside a form (today's rule), and the canvas shows it as a small secondary chip on any role.

## 4. Signals the scanner extracts

Added to each block by the in-page extraction (`src/scan/extract.ts`), stored under `block.signals` in the scan (schema stays v1; the field is optional so old scans parse):

```
signals: {
  words: number;            // words of visible text
  cards: number;            // largest group of ≥ 2 consecutive sibling elements with the same tag, each holding a heading or an image (0 when none)
  cardHeadingLevel: number | null;
  listItems: number;        // li count
  orderedItems: number;     // li inside ol
  numbered: number;         // short texts like "01", "02", "1.", "3)" (≤ 3 chars, ≥ 2 of them)
  accordions: number;       // details, [aria-expanded], [role=tab]
  quotes: number;           // blockquote, q, or “…” / "…" runs ≥ 20 chars
  prices: number;           // [$€£R$] digits, digits + USD/EUR/BRL, "/mes" "/month" "/mês"
  bigNumbers: number;       // elements with font-size ≥ 32px whose text is a number with optional % + k M x or ≤ 2 unit words
  questions: number;        // h2-h4 or summary ending in "?"
  smallImages: number;      // img/svg/picture with rendered width ≤ 160px
  largeImages: number;      // img/video/canvas/picture with area ≥ 20% of the block (an element, never a background)
  imageRatio: number;       // largest single image/video/canvas area ÷ block area, and a url() background on the block or a descendant up to two levels down, at the share of the box its painting covers (cover, contain or an explicit size; an auto size cannot be measured and a repeating tile is a texture) (replaces today's canvas/video-only visualRatio for roles; kind keeps using visualRatio)
  contactHints: number;     // tel: / mailto: links, <address>, phone-like text (a thousands-separated figure such as "+1.000.000" or "+1 000 000" is not one)
  tabs: number;             // [role=tab]
}
```

Every element count above is of **rendered** elements only: one with no box of its own area (`display: none`, inside a `display: none` subtree, or collapsed to zero) is not counted, and the text signals come from `innerText`, which already leaves it out. A responsive page that ships a desktop copy and a hidden mobile copy of the same block therefore counts that block once. A `display: contents` wrapper has no box of its own, which does not hide its children: the cards inside it count. A `visibility: hidden` copy is the one case still counted, because seeing it costs a style read per node.

Keywords are matched by the classifier (not in the page) against the **kicker, the heading and the anchor only** (never the body text, where words like "about" or "process" appear in passing), lower-cased and accent-stripped, as whole words or phrases, per role, in three languages (§5.2). The one exception is `contactHints`, which the extraction counts in the body (links and an `address` element, not words).

## 5. Classification

`src/scan/roles.ts` exports:

- `type SectionRole = 'navigation' | 'footer' | 'hero' | 'form' | 'contact' | 'pricing' | 'faq' | 'testimonials' | 'logos' | 'stats' | 'steps' | 'audience' | 'solutions' | 'products' | 'team' | 'about' | 'gallery' | 'banner' | 'features' | 'feature' | 'content' | 'default'`
- `classify(input: RoleInput): Detection` where `RoleInput` is `{ tag, landmark, isFirstSection, pageHasH1Here, heading, kicker, anchor, text, components, signals }` and `Detection = { role: SectionRole; secondary: SectionRole[]; cta: boolean; reasons: string[] }`. `reasons` are short rule names ("cards>=3", "kw:steps") kept for `atlas_get_block` and debugging; they are not shown on the canvas.

### 5.1 Precedence

Rules are evaluated in this order and the first match is the primary role; the next two matches (if any) are secondary:

`navigation` → `footer` → `hero` → `contact` → `form` → `pricing` → `faq` → `testimonials` → `logos` → `stats` → `steps` → `audience` → `solutions` → `products` → `team` → `about` → `gallery` → `banner` → `features` → `feature` → `content` → `default`.

Why this order: landmarks are certain; a hero wins over anything it also looks like; conversion sections (contact, form, pricing) beat descriptive ones; FAQ, testimonials, logos and stats have unmistakable signals; steps must be checked before audience/solutions (all three use numbered cards, and steps needs process keywords to win); products before features because a product list looks like a feature grid; banner before features/feature because it is short; content and default close the list.

### 5.2 Keywords (matched as whole words, accent-insensitive)

- steps: cómo trabajamos, cómo funciona, proceso, pasos, metodología, how it works, process, steps, how we work, como funciona, como trabalhamos, processo, etapas
- audience: para quién, para quienes, who is it for, for whom, built for, made for, para quem
- solutions: soluciones, por industria, sectores, casos de uso, solutions, industries, use cases, soluções, setores
- products: productos, módulos, plataforma, catálogo, planes, products, modules, plans, catalog, produtos, módulos, planos
- pricing: precios, tarifas, planes y precios, pricing, prices, plans & pricing, preços
- faq: preguntas frecuentes, faq, dudas, frequently asked, questions, perguntas frequentes
- testimonials: testimonios, opiniones, clientes dicen, testimonials, reviews, what our customers say, depoimentos
- logos: integraciones, partners, clientes, confían, integrations, trusted by, partners, integrações, parceiros
- stats: cifras, números, en números, stats, by the numbers, números
- team: equipo, nuestro equipo, team, our team, equipe, nossa equipe
- about: nosotros, quiénes somos, sobre nosotros, about, about us, who we are, our story, sobre nós, quem somos
- contact: contacto, contáctenos, cotización, presupuesto, hablemos, contact, get in touch, request a quote, contato, orçamento
- hero: none (structural)

The builder keeps the list in one table in `roles.ts`; adding a language is adding a column.

### 5.3 Rules (the exact conditions)

- navigation: `landmark && tag in (header, nav)` or `tag == nav`.
- footer: `landmark && tag == footer`.
- hero: `pageHasH1Here` or (`isFirstSection && heading && cta`).
- contact: (`form` or `contactHints ≥ 1`) and (`contactHints ≥ 1` or kw:contact).
- form: `components.forms.some(f => f.fields ≥ 1)`.
- pricing: `prices ≥ 2` or (kw:pricing and `cards ≥ 2`).
- faq: `questions ≥ 3` or (`accordions ≥ 3` and kw:faq).
- testimonials: `quotes ≥ 2` or (kw:testimonials and `cards ≥ 2`).
- logos: `smallImages ≥ 6 && words / max(1, smallImages) ≤ 6 && cardHeadingLevel == null` or (kw:logos and `smallImages ≥ 4`). A logo carries a caption at most, so a card with a heading of its own is not one.
- stats: `bigNumbers ≥ 3`.
- steps: (`numbered ≥ 3` or `orderedItems ≥ 3` or `cards ≥ 3`) and kw:steps, or `orderedItems ≥ 3 && cards == 0`.
- audience: kw:audience and (`cards ≥ 2` or `numbered ≥ 2`).
- solutions: kw:solutions and `cards ≥ 2`.
- products: kw:products and (`cards ≥ 3` or `listItems ≥ 5`), or (`listItems ≥ 5 && largeImages ≥ 1 && words ≤ 200`), or `tabs ≥ 3`.
- team: kw:team. The card shape (`cards ≥ 3 && smallImages + largeImages ≥ cards && cardHeadingLevel ≥ 3 && words / cards ≤ 25`) is added to the reasons when it also holds, but it no longer classifies on its own: a card icon is a small image, so it cannot be told from a portrait.
- about: kw:about and `cards == 0`.
- gallery: `largeImages ≥ 4 && words ≤ 60`.
- banner: `headings.length ≤ 2 && words ≤ 40 && (imageRatio ≥ 0.3 || largeImages ≥ 1) && !pageHasH1Here`.
- features: `cards ≥ 3 && cardHeadingLevel != null`.
- feature: `headings.length ≥ 1 && largeImages ≥ 1 && words ≤ 120 && cards == 0`.
- content: `words ≥ 150 && cards == 0 && largeImages == 0`.
- default: otherwise.

`cta`: today's rule (`links.some(l => l.cta) || (!form && buttons.length > 0)`), moved into `classify`.

### 5.4 Old scans

`block.signals` missing → `classify` runs with `signals` set to zeros and `words` from `textExcerpt`; this yields navigation, footer, hero, form and default, which is what the canvas computes today. No migration step.

## 6. Where the role shows up

- **Scan**: `block.role`, `block.roles` (secondary), `block.cta`, `block.signals`, `block.roleReasons`.
- **Overlay**: `roleOverrides: Record<blockKey, SectionRole>` (default `{}`), carried by the same code paths as `kindOverrides` (moves, orphans, migrations). New op `setRole { blockKey, role | null }`.
- **Map** (`BlockView`): `role`, `effectiveRole`, `roleOverridden`, `secondaryRoles`, `cta`.
- **Canvas**: the detected chip shows `effectiveRole`; a second small chip "CTA" when `cta`; the chip is a `<select>`-style control in Edit mode to override (like the kind control on the piece) with "Auto" to clear. The filter bar lists every role present on the map with counts, ids `auto:<role>`, colors configurable per role (same mechanism as today, defaults assigned per role family: conversion roles green, structure roles violet, content roles gray-blue, visual roles pink).
- **MCP**: `formatMap` adds the role in brackets next to the kind (`[narrative · features]`); `atlas_get_block` returns role, secondary roles, cta and reasons; new tool `atlas_set_block_role { site, blockKey, role | null }`; `atlas_get_map`'s description mentions roles.
- **CLI**: `scan` output prints `name [kind · role]`; new `role <site> <blockKey> <role|auto>`.
- **Plan**: unchanged (roles are descriptive, not planned changes).

## 7. Acceptance set

The SCAP Tech beta home (`http://localhost:4400/beta-1/`, scanned as `localhost-4400-beta-1`), expected roles in page order:

Header → navigation · Tecnología financiera → hero · Integraciones → logos · La plataforma → feature · Tecnología → features · Gestión tecnológica → features · Productos → products · Soluciones → solutions · Tecnología para brokers → features · Para quién → audience · Cómo trabajamos → steps · Nosotros → about · Tecnología de vanguardia. Control absoluto. → banner · Cotización → contact (secondary: form) · Explorar → footer.

That list was checked against the scan of 2026-10-25 (section names as they are today; the older `tests/acceptance.test.ts` still names the contact block "Solicite una propuesta" and should be updated to "Cotización" in the same change).

Two tests cover it. Always on: a **fixture page** `tests/fixtures/site/roles.html` with one section per role, built with the same structures (cards, numbers, logos, quotes, prices, FAQ accordions, a tabbed product list, a big-image banner), scanned by the existing fixture server and asserted role by role. Live, like the existing acceptance test (`skipIf(!process.env.ATLAS_BETA1_URL)`): scan SCAP Tech and assert the list above, and that no section is `default`. The user runs the live one with the site up; it is the real acceptance.

## 8. Constraints

- English everywhere in code and copy; role ids are the lower-case English words above and never change (they are stored in overlays).
- Determinism: `classify` is pure; signals are computed after the page is settled, as the extraction does today.
- Performance: the in-page extraction stays a single `page.evaluate`; signal counting walks each block once; the existing "finishes quickly on huge pages" test must stay green.
- `schemaVersion` of scans and overlays does not change; new fields are optional with defaults.

## 9. Decisions made in this design (to confirm or change)

- **Rules with precedence, not scores.** Explainable, testable one by one, and stable. A scoring model would be more flexible but harder to reason about when the user asks "why is this a feature grid".
- **Roles in the scanner, overrides in the overlay.** Same split as kinds; agents and the canvas see one truth.
- **Keywords in three languages in one table.** Enough for the user's sites; adding more is data, not code.
- **CTA as an attribute**, so a pricing section with buttons is still pricing.
- **Kind stays.** Removing it would touch the plan wording and colors for no gain here.
- **Changed after review (2026-10-25):** every structural count is of rendered elements, so a hidden responsive copy of a block does not double its signals; `quotes` and `contactHints` were the last two raw counts and now follow the same rule.
- **Changed after review (2026-10-25):** a CSS background feeds `imageRatio` only, at the measured share of the box its painting covers, and never `largeImages`. Counting any `url()` background as a full-block image made a 24px icon or a repeating tile a `banner`, and took `content` away from every long text section with a texture behind it. A backdrop says how visual a band is; it is not one of the images the block shows, which is what `largeImages` feeds (`products`, `gallery`, `feature`, `content`). `banner` reads the ratio, so the band D4 asked for still classifies as `banner`.
- **Changed after review (2026-10-25):** the structural arm of `logos` also asks for `cardHeadingLevel == null`. An icon grid with one word per card is few words per image, and `logos` precedes `features`, so the sections §7 expects as `features` would have landed there instead of on `team`. A logo carries a caption, not a heading.
- **Changed after review (2026-10-25):** the structural arm of `team` now needs kw:team as well, because an icon-per-card feature grid satisfied it (six icons are six small images), which made §7 expect `features` for sections the rules called `team`.
- **Order of work.** Roles land first, on a branch cut from `feat/start-page` (the current tip); the AI plugin plan comes after and reads `role` from the map. Both touch `formatMap`, `atlas_get_block` and `en.ts`, so the second one rebases.

Calls made after the builder check: `cards` counts groups of two or more; keywords match headings, kickers and anchors only (ambiguous single words such as "time" dropped); the SCAP acceptance is a live test behind `ATLAS_BETA1_URL` plus the always-on fixture page; roles go before the plugin.

## 10. Left to the builder

- Exact card-detection walk (how deep to look for repeating siblings) as long as the fixture passes and the huge-page test stays fast.
- Default colors per role, as long as the four existing ones keep their current colors.
- How the role control looks on the piece (select vs menu), as long as it has `data-testid="role-select"` and an "Auto" option.
- The exact phrasing of `reasons`.
