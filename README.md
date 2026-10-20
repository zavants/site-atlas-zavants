# Site Atlas

**A semantic map of websites for people and AI agents.**
Site Atlas scans a site, splits every page into **sections** (header, hero, content sections, footer…), flags problems, and lets you rearrange the site on a drag‑and‑drop canvas. Everything you plan is exposed through **MCP** and the **CLI**, so any AI (Claude, Codex, GPT and others) can read it and implement it in the code.

![Site Atlas canvas with a sample site: pages as columns, sections with thumbnails, tags and a planned page](docs/assets/lienzo.png)

---

## Why it exists

Looking at a page doesn't answer questions like:

- Which sections does this page have, and in what order?
- Where does each button point, and which links are broken?
- Should this section live on another page?
- What changes if I move section A to page B?

Site Atlas makes that visible and turns your decisions into a **concrete plan** an AI can execute. Atlas never modifies the site itself: you decide, the AI implements.

## What it does today (v1)

| | |
|---|---|
| **Section-level scanning** | Renders each page in Chromium, splits it into sections and records name, type (narrative, visual, conversion), headings, links, forms, media and a thumbnail. |
| **Issues** | Broken links, missing anchors, forms without an action, placeholder images, sections without an anchor, missing or duplicate headings, duplicate ids. |
| **Canvas** | One column per page, a lane for shared components, drag to reorder or move between pages, planned pages, tags with filters, a trash zone, Real / Planned views and live updates. |
| **Plan for AI** | The differences between the real site and the plan, in plain language and JSON. |
| **Lossless re-scans** | Your organization survives site changes: sections are matched by anchor, fingerprint or text similarity, and anything unmatched becomes an orphan you can reassign. |
| **Local and safe** | Runs on your machine, the server listens on `127.0.0.1` only, protected against CSRF and DNS rebinding, no telemetry. Atlas never writes to your site's repository. |

### Coming next (v2): the org chart

Each page as a diagram of pieces, with **one line per link coming out of the exact section that contains it**. It adds shared components with their own diagram, arrows you can drag and snap to a new target, new connectors, a screenshot view, and changes that stay **pending until an AI confirms** it applied them. Design under review: [`organigrama-design.md`](https://github.com/zavants/site-atlas-zavants/blob/docs/organigrama-v2/docs/superpowers/specs/2026-10-19-organigrama-design.md).

## How it works

```
 your site (localhost, staging or production)
        │  Chromium scan (read-only)
        ▼
 ~/.site-atlas/sites/<site>/
   ├── scans/*.json      immutable snapshots of the site
   ├── shots/*.webp      a thumbnail per section
   └── overlay.json      your organization: order, pages, tags
        │
        ├──► local canvas   http://127.0.0.1:4800
        └──► MCP / CLI ──► Claude · Codex · GPT · …  ──► changes in the site's code
```

## Installation

Requirements: **Node 24+** and **pnpm** (`npm i -g pnpm`).

```bash
git clone https://github.com/zavants/site-atlas-zavants.git
cd site-atlas-zavants
pnpm install
pnpm exec playwright install chromium
pnpm build
```

## Quick start

```bash
# Scan (up to 30 pages by default)
node dist/cli.js scan http://localhost:4321/

# More options
node dist/cli.js scan https://example.com --max-pages 5 --exclude "/blog/**"

# Open the canvas
node dist/cli.js canvas
```

## Connect it to your AI (MCP)

The MCP server starts with `node <path>/dist/cli.js mcp` over stdio.

**Claude Code (terminal)**

```bash
claude mcp add site-atlas -- node /path/to/site-atlas-zavants/dist/cli.js mcp
```

**Claude Code (desktop app, without the `claude` CLI).** Add this to `~/.claude.json`, inside `mcpServers`:

```json
"site-atlas": { "type": "stdio", "command": "node", "args": ["/path/to/site-atlas-zavants/dist/cli.js", "mcp"] }
```

**Codex**, in `~/.codex/config.toml`:

```toml
[mcp_servers.site-atlas]
command = "node"
args = ["/path/to/site-atlas-zavants/dist/cli.js", "mcp"]
```

**Other MCP clients** (Cursor, Windsurf, Claude Desktop…):

```json
{ "mcpServers": { "site-atlas": { "command": "node", "args": ["/path/to/site-atlas-zavants/dist/cli.js", "mcp"] } } }
```

### Tools

| Tool | Purpose |
|---|---|
| `atlas_scan` | Scan a site and reconcile your existing organization |
| `atlas_list_sites` | List scanned sites |
| `atlas_get_map` | Map of pages and sections, with tags and planned order |
| `atlas_get_block` | Section details (components, issues, thumbnail) |
| `atlas_list_issues` | Issues from the latest scan |
| `atlas_tags` · `atlas_set_block_tags` | Create, rename, delete and assign tags |
| `atlas_move_block` · `atlas_add_planned_page` | Rearrange the planned order |
| `atlas_get_plan` | The plan (Markdown + JSON, optional `status`): what to change in the site's code |
| `atlas_confirm_change` · `atlas_reopen_change` | Mark a change applied (with a note) or set it back to pending |
| `atlas_relink` · `atlas_add_link` · `atlas_remove_link` | Propose, change or drop links |
| `atlas_mark_deleted` · `atlas_restore` · `atlas_remove_planned_page` | Propose deleting a section, undo it, remove a planned page |
| `atlas_open_canvas` | Canvas URL |

Example prompt for an agent:

> "Scan http://localhost:4321 with site-atlas, move the pricing section to /pricing and tell me what needs to change in the code."

Text extracted from the scanned site is marked as **untrusted content**, so agents treat it as data, not instructions.

## Optional markers

Atlas detects sections on its own: top-level `header`, `section` and `footer`, plus visible blocks inside `main`. On your own site you can set the exact split:

```html
<section data-atlas-block="Hero">…</section>
```

## Data and privacy

- Everything is stored in `~/.site-atlas/`, or in the folder set by `SITE_ATLAS_HOME`.
- Nothing leaves your machine, except the requests to the site you scan.
- On public sites it respects `robots.txt` and waits 1 s between pages.
- Atlas **never writes** to the site's repository.

## Development

```bash
pnpm test            # unit, integration and canvas tests (Vitest + Playwright)
pnpm typecheck       # server (tsc) and canvas (vue-tsc)
pnpm atlas scan …    # CLI without building (tsx)
pnpm dev:canvas      # canvas with hot reload (needs the server on :4800)
```

Stack: Node 24, TypeScript, Playwright, Hono, Vue 3 + Vite, Zod and `@modelcontextprotocol/sdk`.

> The interface and messages are currently in Spanish.

## Tested with

| Site | Result |
|---|---|
| Local marketing site (HTML, 15 sections) | 15 sections with their real names; found a broken link, 4 sections without an anchor, placeholder images and a form without an action |
| stripe.com (1 page) | 10 sections, 8 with a readable name, in 26 s |
| vercel.com (1 page) | 6 sections, all with a readable name |

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first to discuss them. Design decisions live in [`docs/superpowers/specs/`](docs/superpowers/specs/).

## License

Open source under the [MIT](LICENSE) license.
