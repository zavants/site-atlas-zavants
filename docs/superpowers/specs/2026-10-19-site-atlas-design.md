# Site Atlas — Design v1

**Status:** implemented (merged in PR #1) · **Date:** 2026-10-19 · **Repo:** `zavants/site-atlas-zavants` (public, MIT)
**Note:** originally written in Spanish and translated to English on 2026-10-19. Design v2 (`2026-10-19-organigrama-design.md`) extends it.

---

## 1. Intent

See a website **by sections** on one screen, and organize it by hand. Today, understanding a page's structure (which sections it has, in what order, what's inside each one, what's broken or provisional) means reading the code or drawing it manually in draw.io. Site Atlas builds that map on its own from the rendered site, and shows it on a canvas where sections can be dragged, reordered and tagged.

It works for any site. The first one is SCAP Tech (the Beta 1 prototype of its Home page), but the tool doesn't depend on it.

It is **MCP-compatible from day one**: any agent (Claude Code, Codex, Antigravity…) can scan a site, read the map, read what the team organized on the canvas, and change it. The same data feeds the screen and the MCP tools.

## 2. Goals, non-goals and anti-goals

**Goals for v1**

1. Scan a site (localhost, staging or production) and get its pages split into sections, each with name, type, components, thumbnail and issues.
2. A drag-and-drop canvas: reorder sections within a page and move them between pages, including planned pages that don't exist yet.
3. Tags as an attribute of each section (not as a drop zone), with a filter bar.
4. An MCP server that exposes the map, issues, tags and planned order, and lets agents change them.

**Non-goals for v1** (may come later)

- Applying canvas changes to the real site. In v1 the canvas produces a **planned order**; an agent reads it through MCP (`atlas_get_plan`) and makes the change in the code.
- Reading structure from source code (Astro or otherwise). v1 works on the rendered site.
- A shared team URL (hosted, with sign-in) and real-time multi-user collaboration. v1 is local only (decided 2026-10-19). To keep that door open, the canvas talks to its server only through the HTTP + SSE API in §6: hosting later means changing storage and authentication, not the canvas.
- Showing the canvas inside AI clients (MCP Apps).
- Pages behind a login.
- A screen to compare scans (the data is kept so it can be built later).
- Export to Figma, Miro or other canvases.

**Anti-goals** (if these happen, it failed even if it works)

- The tool modifying the scanned site.
- Requiring changes to the scanned site in order to work (the optional markers in §5.1 help, but are not required).
- A re-scan wiping the tags or order the team organized.
- Sending site data to third-party services.

## 3. Concepts

| Concept | What it is |
|---|---|
| **Site** | A named project (e.g. `scap-tech`) that groups one or more **environments**: origins with a base path (e.g. `http://localhost:4405/beta-1/`, `https://staging.…/`). The user layer belongs to the site, not the environment: what was organized on localhost is still there when scanning staging or production. If `atlas_scan` gets no `site`, it is derived from host + port + first path segment. |
| **Scan** | A snapshot of the site at a point in time: pages, sections, components, issues, thumbnails. Immutable; all of them are kept. |
| **Page** | A URL of the site. It can be **real** (it came from the scan) or **planned** (created on the canvas or through MCP). |
| **Section** (block) | A top-level section of a page (header, hero, a section, footer). In code and keys it is called a *block*. |
| **Component** | What's inside a section: headings, links, buttons, forms, media (img, video, canvas). Summarized, not edited. |
| **Section type** | `narrative`, `visual` or `conversion`. Inferred, and the user can correct it. (v1 stored `narrativa`; design v2 switches to English values.) |
| **Tag** | A name + color defined per site. A section can have several. |
| **Issue** | A problem detected in a section or page (§5.4). |
| **User layer** | What the team decides on top of the scan: tags, corrected type, planned order, planned pages. Stored separately from the scan so it survives re-scans. |

## 4. Walkthrough

1. An agent calls `atlas_scan({ url })` (or someone runs `site-atlas scan <url>` in the terminal).
2. The canvas opens (`atlas_open_canvas` returns `http://localhost:4800/s/<siteId>`).
3. The team drags, reorders, creates planned pages and tags.
4. An agent calls `atlas_get_plan` and gets the differences between the real and planned order, ready to implement in code.
5. After changing the site, it is re-scanned; the canvas shows the new state with the user layer preserved.

## 5. Scanning

### 5.1 Detecting sections

Each page is rendered in headless Chromium at 1440×900, with `prefers-reduced-motion: reduce` emulated. The page is scrolled to the bottom to trigger lazy content and reveal animations, then the scanner waits for the network to go idle. Elements hidden only by entrance animations (opacity 0 with a reveal class) count as visible.

Rules:

1. **Explicit markers:** if the page has `[data-atlas-block]` elements, those are the sections and the other rules don't apply. `data-atlas-block="Name"` sets the name. Optional, intended for your own sites.
2. **Semantic structure:** top-level `header` / `[role=banner]`, every `section` not nested in another `section`, and top-level `footer` / `[role=contentinfo]`. Wrappers (a `div` containing only one `section`, like `.hero-track` in SCAP Beta 1) are traversed. A `nav` inside the header is not a separate section.
3. **Fallback, combined with rule 2:** visible direct children of `main` (or `body` if there's no `main`) at least 80 px tall that neither contain nor are a rule-2 section are also sections. That way a page mixing `section` and `div` doesn't lose content.

**Global sections:** a section whose fingerprint (§5.5) appears on two or more pages, like the header and footer, is marked global. The canvas shows it once, in a "Global" lane, instead of repeating it in every column.

Fixed or overlaid elements that take no space in the flow (e.g. floating prototype labels) are not sections.

### 5.2 Data per section

- **Name:** `data-atlas-block` → `aria-label` → eyebrow text (the first short text element before the heading, such as `.kicker` or `.eyebrow`) → h1/h2 text → `id` → `"<HTML tag> <n>"`.
- **Heading:** the section's first h1/h2.
- **Anchor:** the section's `id`, if any.
- **Order** on the page and **height** in px.
- **Inferred type:** contains a `form` → `conversion`; contains a `canvas`, `video` or WebGL element covering ≥ 30 % of the section → `visual`; otherwise → `narrative`.
- **Components (summary):** headings (level + text), links (text, target, internal/external/anchor), buttons, forms (field count, `action`, method), media (img with `src`, video, canvas), and a text excerpt of up to 200 characters.
- **Thumbnail:** a capture of the section at 1440 px, stored as WebP.

### 5.3 Crawling

- Follows same-origin links from the start URL. Default page limit: 30 (`maxPages`).
- Optional `include` / `exclude` path patterns.
- On hosts that aren't local development hosts, respects `robots.txt` and waits 1 s between pages.
- Normalizes URLs (no fragment, no duplicated trailing slash) so pages aren't repeated.

### 5.4 Issues

| Issue | Level | Rule |
|---|---|---|
| Broken internal link | error | A same-origin target that responds 4xx/5xx. |
| Missing anchor | error | `href="#x"` or `/path#x` with no element with that `id` on the target page. |
| Form without an action | warning | A `form` with no `action` (or an empty one). |
| Placeholder image | warning | `src` or `alt` containing `placeholder`, `provisional`, `lorem` or `dummy` (case-insensitive). |
| Section without an anchor | info | A content section (not header/footer) with no `id`: it can't be linked to. |
| Missing or duplicate heading | warning | A page with no h1 or more than one; a content section with no h2 and no accessible name. |
| Duplicate `id` | warning | Two elements with the same `id` on a page. |

On SCAP Beta 1 this must detect: the broken link to `/es/soluciones/brokers`, "Para quién" and "Cómo trabajamos" without an anchor, placeholder images in "Gestión tecnológica", and the quote form without an action.

### 5.5 Section identity across scans

Each section has a stable key, `blockKey`:

1. `<path>#<anchor>` if it has an `id`;
2. otherwise `<path>~<slug of the name>`;
3. if the slug repeats on the page, `-2`, `-3` is appended in order.

Each section also stores a **fingerprint**: a hash of its normalized heading + the first 200 characters of text + the sequence of its direct children's HTML tags.

The user layer references `blockKey`. On re-scan, reconciliation goes in this order:

1. Same `blockKey` → same section.
2. Same `id` on another page (the section moved, as the plan asked) → same section; its key is updated in the user layer.
3. Identical fingerprint, or text similarity ≥ 0.8, on any page → same section (covers heading or page changes without an `id`).
4. Anything that doesn't reconcile becomes an **orphan**, with the best matching suggestion if there is one, and the canvas shows it separately to reassign or discard with one click. It is never deleted automatically.

## 6. Data and storage

Working folder: `~/.site-atlas/` (configurable with the `SITE_ATLAS_HOME` variable).

```
~/.site-atlas/sites/<siteId>/
├── site.json               ← origin, name, creation date
├── scans/<ISO-date>.json   ← immutable scans
├── shots/<scanId>/<hash>.webp
└── overlay.json            ← user layer
```

`overlay.json` holds: `rev` (revision number), `tags` (id, name, color), `blockTags` (`blockKey` → tag ids), `kindOverrides`, `plannedPages` (path, title), `plannedOrder` (page path → ordered list of `blockKey`, which can include sections from other pages) and `orphans`.

**Planned order semantics:**

- A page with no planned order inherits the real order. The planned order is created the first time the page is touched.
- Moving a section to another page **removes** it from the source page; it isn't copied. Global sections don't move between pages.
- `plannedDeletions`: a list of `blockKey` marked for deletion (the canvas's "Delete" zone). They can be restored.
- If a re-scan brings a new section on a page with a planned order, it is inserted right after its preceding neighbor in the real order (or at the start if there is none) and marked "new".
- Once the real site matches the plan, the planned order is kept and `atlas_get_plan` reports no differences for that page. It is not cleaned up automatically.
- `atlas_get_plan` reports four kinds of difference: reorder, move to another page, delete, new page.

Writes: atomic (temp file + rename), with optimistic control by `rev`. A write with a stale `rev` is rejected and the client reloads. The canvas receives, over SSE, the changes agents make through MCP, and vice versa.

The `scan` and `overlay` schemas are defined with Zod and carry `schemaVersion`.

## 7. Canvas

- One column per page: real ones first, in crawl order, then planned ones. A "+ Planned page" button.
- Section card: order number, thumbnail, name, type badge, tags, and an issue icon if it has any.
- Drag to reorder within a page or move to another. Moving creates or updates the planned order; it doesn't touch the scan.
- Tags: a "+" button on the card opens the list to check/uncheck; a top bar filters (dims what doesn't match) and creates, renames or deletes tags.
- **Real / Planned** switch: in Planned, sections that changed place carry a mark.
- Clicking a card: a side panel with a large thumbnail, components, issues and an editable type.
- A "Global" lane at the top with sections shared across pages.
- A "Delete" zone: dropping a section there marks it for deletion (it shows struck through on its page and can be restored).
- An orphans zone, visible only if there are any.
- A "Re-scan" button.
- Works on desktop; on mobile it only needs to be viewable, not draggable.

Visual reference: the 2026-10-19 mockups had one column per page with compact cards, flat surfaces, thin borders, tags as colored pills inside the card, and the tag filter in a horizontal bar above the canvas. This section is enough; there are no separate mockup files.

## 8. MCP server

`stdio` transport. Tools:

| Tool | Input | Returns |
|---|---|---|
| `atlas_scan` | `url`, `maxPages?`, `include?`, `exclude?` | `siteId`, `scanId`, counts of pages, sections and issues |
| `atlas_list_sites` | — | sites with their latest scan |
| `atlas_get_map` | `site`, `page?` | pages with sections (user layer applied), compact form |
| `atlas_get_block` | `site`, `blockKey`, `withImage?` | details, components, issues; thumbnail as an MCP image if `withImage` |
| `atlas_list_issues` | `site`, `level?` | issues with page and section |
| `atlas_tags` | `site`, `action` (`create`/`rename`/`delete`), data | updated tags |
| `atlas_set_block_tags` | `site`, `blockKey`, `tags[]` | updated section |
| `atlas_move_block` | `site`, `blockKey`, `toPage`, `index` | updated planned order |
| `atlas_add_planned_page` | `site`, `path`, `title` | created page |
| `atlas_get_plan` | `site` | real vs. planned differences per page, in plain language and JSON |
| `atlas_open_canvas` | `site` | the canvas's local URL (starts the server if needed) |

MCP responses mark text coming from the scanned site (headings, excerpts) as untrusted content, so agents treat it as data and not as instructions.

## 9. Constraints

- Everything local. The canvas server listens on `127.0.0.1` only.
- No code from the scanned site runs outside the headless browser.
- No telemetry.
- Scanning a typical page (like SCAP Beta 1) takes under 30 s.

## 10. Build decisions (proposed by Claude, confirmed by implementation)

- **Node 24 LTS + strict TypeScript + pnpm**: the same stack the team uses at SCAP.
- **`@modelcontextprotocol/sdk`** for the MCP server.
- **Playwright (Chromium)** to render and capture.
- **Canvas in Vue 3 + Vite** with **SortableJS** (`vue-draggable-plus`) for dragging: the team already works with Vue/Nuxt in its CRM. (Design v2 replaces SortableJS with a custom drag.)
- **Hono** as the canvas's local HTTP server (API + SSE + static files).
- **Vitest** for unit tests of the extractor with test HTML, plus an integration test that scans a sample page served locally.
- One package with two entry points: `site-atlas` (CLI: `scan`, `canvas`, `mcp`) and the MCP server (`site-atlas mcp`). Installed in Claude Code with `claude mcp add site-atlas -- node <path>/dist/cli.js mcp`. Not published to npm in v1.
- License: originally private; the project was open-sourced under MIT on 2026-10-19.

## 11. Success criteria for v1

1. `atlas_scan` on `http://localhost:4405/beta-1/index.html` (SCAP Tech) returns 15 sections, in this order and with these names: Header (or whatever name the §5.2 chain gives), Tecnología financiera (hero), Integraciones, La plataforma, Tecnología, Gestión tecnológica, Productos, Soluciones, Tecnología para brokers, Para quién, Cómo trabajamos, Nosotros, Tecnología de vanguardia. Control absoluto. (impact piece, from its `aria-label`), Solicite una propuesta (closing) and Footer. It also returns the §5.4 issues. The names come from each section's eyebrow; that proves the chain works. The exact header and footer names are not required.
2. On the canvas, the Home page is reordered, a section is moved to a planned page and tagged; after a re-scan none of that is lost.
3. From Claude Code, `atlas_get_plan` describes those changes so that an agent can implement them.
4. Scanning `https://stripe.com` and `https://vercel.com` (SCAP's visual references) produces reasonable maps with no configuration. "Reasonable" means every section visible at a glance is a section, with no empty sections or fragments under 80 px, and readable names on at least 80 % of sections.

## 12. Left to the builder

- Internal folder and module structure.
- Fine visual design of the canvas, following the mockups.
- Tag color palette.
- Exact text format of `atlas_get_plan`.
- How `siteId`s are named on collision.
