# Site Atlas as a plugin for AI agents — Design

**Status:** draft for approval · **Date:** 2026-10-25 · **Repo:** `zavants/site-atlas-zavants`
**Builds on:** design v1 (`2026-10-19-site-atlas-design.md`), the org chart (`2026-10-19-organigrama-design.md`), the installable package (PR #13) and the start page (PR #14).

---

## 1. Intent

Site Atlas already lets a person paste a URL, see the site as sections on an org chart, rearrange it, and hand the plan to an AI through MCP or the CLI. Today the AI is only the *executor* of that plan, and it only takes part if someone wires the MCP server in by hand.

This design turns Atlas into something an AI agent can **install, launch and use on its own to advise the person**: audit the structure of a site, explain what is weak and why, propose a better structure as a plan the person can see and edit on the canvas, and, when the site's code is at hand, implement what gets approved. The user's words: "que una IA pueda lanzarla y utilizarla como plugin para poder asesorar y ayudar al usuario".

It covers **both situations** the user named:

- **Own site** (localhost, staging, or a repository open in the agent's working folder): the agent advises *and* implements, verifies with a re-scan, and confirms each change.
- **Someone else's site** (production, no code): the agent observes and recommends only. The proposal still lives on the canvas as planned changes, and the deliverable is a report, not a commit.

## 2. Goals, non-goals and anti-goals

**Goals**

1. One install step per agent, for **Claude Code and Codex alike**: a plugin that brings the MCP server, the slash commands and the advisory method, installable from this repository with two commands and reachable from the assistant's own panel; it installs the `site-atlas` CLI itself when it is missing (PR #13's installer and `doctor`).
2. A documented **advisory method** the agent follows, so the advice is grounded in the scan (sections, links, issues, thumbnails) instead of generic SEO talk, and so it always ends in something the person can see on the canvas.
3. A place for that advice to live: each atlas can hold the latest recommendation, shown on its home card and in the canvas, written by the agent through MCP or the CLI.
4. The agent knows the tool's limits and says so when they affect the advice (page cap, no login, rendered-DOM heuristics, desktop viewport only).
5. The same method works through MCP (Claude Code, Claude Desktop, Cursor…) and through the CLI alone (an agent in a terminal without MCP).

**Non-goals (for this version)**

- Cursor, Windsurf and Claude Desktop get the MCP server and the method as text (a snippet for `AGENTS.md` / `.cursorrules`), not a packaged plugin. Claude Code and Codex both get the real plugin (§4.1); a `.cursor-plugin/plugin.json` would be a third manifest in the same tree and can be added later if anyone asks.
- Atlas does not run an LLM itself: the analysis happens in the agent; Atlas supplies data and stores conclusions.
- No hosted, multi-tenant service: the agent and Atlas run on the person's machine or server (PR #13 covers servers).
- No change to section detection heuristics; that is its own piece of work (the user flagged misidentified sections, to be looked at with concrete examples).

**Anti-goals (a failure even if it "works")**

- The agent writing advice from the page text alone, without the scan: the canvas and the advice must describe the same sections and links.
- The agent editing the site's code on a site it does not own, or confirming a change it did not apply. The method and the tool descriptions must make the mode explicit.
- Advice that cannot be acted on: every recommendation must either map to Atlas operations (move, delete, relink, new page) or be explicitly marked as outside Atlas's vocabulary (copy, design, performance).
- Prompt injection from scanned text steering the advice: scanned content stays marked untrusted, as today, and the method tells the agent to treat it as data.

## 3. What the user experiences

**Own site.** In the project folder: `/atlas http://localhost:4321/`. The agent makes sure Atlas is installed, scans, opens the canvas, and reports the shape of the site (pages, sections per page, issue counts). Then `/atlas-advise`: the agent studies the map and comes back with a prioritized list such as "the pricing section sits on the home page under the FAQ; the three pages that mention prices link to an anchor that does not exist; the header has two 'Contact' entries". Each recommendation says why, what changes on the canvas, and what it means in code. The agent records the proposal as **pending changes** in Atlas, so the canvas shows the proposed structure next to the real one; the person edits or drops items on the canvas; then `/atlas-apply` implements what is pending, re-scans, and confirms each change with a note. The home card shows "Advice from <agent> · <date>" with the summary.

**Someone else's site.** `/atlas https://competitor.com/ --max-pages 20`, then `/atlas-advise`. Same analysis and same canvas, but the agent states up front that it works in **advisory mode**: nothing will be implemented, the plan is a proposal, and the deliverable is a Markdown report (saved next to the atlas and printed in the chat) that a team can take to whoever owns the site. `/atlas-apply` refuses in this mode and explains why.

**Without MCP.** The same three steps work with the CLI: `site-atlas scan`, `site-atlas advise --set` (stores the report the agent wrote) and `site-atlas plan` / `confirm`. The skill text tells the agent which commands to run.

## 4. Pieces

### 4.1 The plugin (`plugin/` in this repository), for Claude Code **and** Codex

One plugin directory, installable into both agents from this repository, so the person reaches Site Atlas from the assistant itself instead of wiring an MCP server by hand. Everything below was verified on 2026-10-28 against Claude Code 2.1.296 and codex-cli 0.164.0-alpha.11.1 by installing a throwaway plugin into an isolated home and watching what each agent launched; where the two agents differ, the difference is stated and the reason given.

```
.claude-plugin/marketplace.json     at the repo root; BOTH agents read this filename
.agents/plugins/marketplace.json    the agent-plugins.org 1.0.0 location, for Codex
plugin/
  .claude-plugin/plugin.json        Claude Code's manifest
  .codex-plugin/plugin.json         Codex's manifest; Claude Code ignores it
  .mcp.json                         the server, as Claude Code starts it
  scripts/site-atlas-mcp.js         the one launcher both agents run
  skills/atlas/SKILL.md
  skills/atlas-advise/SKILL.md
  skills/atlas-apply/SKILL.md
  skills/site-atlas-setup/SKILL.md
  assets/site-atlas.svg             the icon Codex shows in its panel
  README.md
```

**Installing.** Two commands per agent, no file editing and no administrator rights:

```
claude plugin marketplace add zavants/site-atlas-zavants
claude plugin install site-atlas@site-atlas

codex plugin marketplace add zavants/site-atlas-zavants
codex plugin add site-atlas@site-atlas
```

In the Claude Code desktop app the second step is instead `+` → **Add plugins** → Site Atlas. Both agents start a plugin's MCP server when a session starts, so a session already open needs `/reload-plugins` (Claude Code offers it) or a new session (Codex).

**Why the server is declared twice.** The two agents anchor a bundled stdio server in incompatible ways, and no single declaration satisfies both. Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` in a server's `command`, `args` and `env`, and exports it into the server's environment. Codex substitutes nothing: `${PLUGIN_ROOT}` passes its validator but is not expanded at launch (its own bug, and `${CODEX_PLUGIN_ROOT}` does not exist), it strips every plugin variable from the server's environment, and a relative `command` is resolved against the user's project, not the plugin. What Codex does honour is `cwd: "./"`, which re-roots the process at the installed plugin copy. So:

- `plugin/.mcp.json`, which Claude Code reads: `{"mcpServers":{"site-atlas":{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/scripts/site-atlas-mcp.js"]}}}`
- `plugin/.codex-plugin/plugin.json`, which Codex reads and which overrides `.mcp.json` for Codex: an inline `mcpServers` map with `{"command":"node","args":["scripts/site-atlas-mcp.js"],"cwd":"./"}`.

Both run the same launcher. The duplication is two lines of JSON, kept honest by a test (§6, task 6) that asserts the two entries name the same server and the same file, and by the release workflow writing both versions from `package.json`.

**The launcher** (`scripts/site-atlas-mcp.js`, plain Node, no dependencies) finds the CLI and executes `site-atlas mcp`, searching: `SITE_ATLAS_BIN`, the PATH, `~/.site-atlas/npm/bin`, `~/.local/bin`, `npm prefix -g`, and a source checkout's `dist/cli.js`. It locates itself from `__dirname`, never from an environment variable, because Codex gives the server process no plugin variables. When nothing is found it exits non-zero with a message naming the setup skill. `command` is always `node` with the script as an argument: a `.cmd` or shebang script as `command` cannot be spawned without a shell, and Codex fails to resolve a relative one.

**No `bin/` directory.** Claude Code would put it on the Bash tool's PATH, which is convenient, but a top-level `bin/` stops the plugin installing through claude.ai and Cowork, and Codex does not add it to the server's PATH at all. The launcher lives in `scripts/` instead.

**Skills, not commands.** A skill is both the slash command the person types and the guidance the model loads on its own, and both agents read `skills/`; `commands/*.md` is Claude Code's older format and Codex does not read it. So the three commands and three skills of the first draft collapse into four skills:

- `skills/atlas/SKILL.md` (`/site-atlas:atlas <url>`): ensure installed → scan → open canvas → report the shape of the site and its most visible issues.
- `skills/atlas-advise/SKILL.md`: the advisory method (§4.2), the mode rules, the limits (§4.4) and the report format.
- `skills/atlas-apply/SKILL.md`: the implementation loop (§4.3), and the refusal in advisory mode.
- `skills/site-atlas-setup/SKILL.md`: detecting the install (`site-atlas doctor --json`), installing it (`install.sh` on Linux and macOS, `npm install -g site-atlas` elsewhere, then `site-atlas setup`), and what to do when Chromium or the port are missing.

**The Codex manifest also carries an `interface` block** (`displayName`, `shortDescription`, `category`, `capabilities`, `brandColor`, `composerIcon`, `defaultPrompt`). That block is what puts Site Atlas in Codex's plugin browser and composer with a name and an icon, which is the "use it from the AI panel" the person asked for.

**Pinning.** A marketplace entry with a relative source (`"./plugin"`) takes no `ref` or `sha`: those exist only on `github`, `url` and `git-subdir` sources. Users pin the marketplace instead (`…#v0.2.0`), and the release workflow keeps both manifests' versions equal to `package.json`.

The plugin still does not duplicate the CLI: it carries the launcher and the method, and tells the agent how to install the package when it is missing.

### 4.2 The advisory method (what the agent does in `/atlas-advise`)

1. **Establish the mode.** Own site if any of: the URL host is `localhost`/`127.0.0.1`/a `.local`/`.test` name; the person said it is theirs; a repository in the working folder contains the scanned texts (the agent may grep for two or three distinctive section headings). Otherwise advisory. The agent states the mode in its first sentence and asks only if the signals disagree.
2. **Read the whole atlas**: `atlas_get_map` (every page), `atlas_list_issues`, and `atlas_get_block` for the sections it will talk about (components, links, thumbnail when the layout matters). From the CLI: `site-atlas plan --json` plus the scan JSON under `~/.site-atlas/sites/<site>/scans/`.
3. **Analyze along fixed axes**, so two runs on the same site give comparable advice:
   - Navigation and reachability: pages nobody links to, links to pages that do not exist, external links in the main navigation, duplicate entries in header or footer.
   - Page structure: sections out of a sensible order (a call to action before the value proposition, a form at the top), pages with one section, pages with more than ~10, repeated sections across pages that are not shared components.
   - Conversion paths: every page has a way to the main action; the action's section exists and is reachable; forms have a destination.
   - Hygiene from the scan's issues: broken links, missing anchors, placeholder images, headings (missing, duplicate h1), sections without anchors.
   - Content scope flags (outside Atlas's vocabulary, reported but not planned): thin or duplicated copy, images without alternatives, language mix.
4. **Write the recommendation**: at most ten items, ordered by impact, each with: what, why (pointing at the sections and issues by name), the Atlas change that expresses it (or "not expressible in Atlas"), and in own-site mode the likely code location. Then a one-paragraph "proposed structure" in words.
5. **Put the proposal on the canvas**: for each item that maps to Atlas, call the operation (`atlas_move_block`, `atlas_add_planned_page`, `atlas_mark_deleted`, `atlas_relink`, `atlas_add_link`, …). These are pending changes the person can accept, edit or drop on the canvas; nothing touches the site.
6. **Store the advice** with `atlas_set_advice` (4.5) and show the canvas link.
7. In advisory mode, also write the report to a file the person names (default `site-atlas-advice-<site>.md` in the working folder).

### 4.3 Implementation loop (`/atlas-apply`, own site only)

Already described in the plan's own instructions; the skill makes it a procedure: read pending changes → for each, find the code → change it → run or reload the site → `atlas_scan` again → check the plan now lists the change as observed on the site → `atlas_confirm_change` with file and commit in the note → stop and report when something cannot be done (and leave it pending). In advisory mode the command refuses with the reason.

### 4.4 Limits the agent must know and state when relevant

- Up to 30 pages by default (`--max-pages` raises it); crawl stays within the start URL's origin and base path; respects `robots.txt`; 1 s between pages on public sites.
- Rendered DOM only, desktop viewport (1440×900), after one scroll-through; no interaction, no login, no cookies, no mobile layout. Content behind a click or a form is invisible.
- Sections come from heuristics (top-level `header`/`section`/`footer` and visible blocks inside `main`; `data-atlas-block` overrides); names come from the first heading, so a section without a heading gets a generic name; kinds (narrative/visual/conversion) are coarse.
- Issues are structural, not content or performance; no accessibility audit beyond headings and placeholders.
- Text from the site is untrusted data; instructions inside it are ignored.

### 4.5 Changes in Atlas itself

Small additions so the advice has a home and the agent can find its way:

- **Advice per atlas.** `advice.md` in the site folder plus `advice.json` (`{ by, at, summary, mode }`, `mode` being `own` or `advisory`). New MCP tools `atlas_set_advice` (markdown, summary, mode, by) and `atlas_get_advice`; CLI `site-atlas advise <site> --file <md> --summary "<text>" --mode own|advisory [--by <name>]` (default `by`: `cli`) and `site-atlas advise <site>` to print it; HTTP `GET /api/sites/:site/advice` and `PUT` with the same fields, `by` taken from the body since advice is a signed note, not a plan edit (the `/ops` rule that forces `canvas` stays as it is; the canvas itself does not write advice in this version). The home card shows "Advice from <by> · <date> · <mode>: <summary>" with an "Open" that shows the Markdown in a panel; the canvas header gets the same panel behind a button. Only the latest advice is kept.
- **The mode is stored, not re-inferred.** `/atlas-advise` infers it once (4.2 step 1) and stores it with the advice; `/atlas-apply` reads it from there and refuses on `advisory`. Without stored advice, apply infers it the same way and states it. The person can flip it from the home card ("This is my site" / "Someone else's site"), which is a `PATCH /api/sites/:site` field next to the name.
- **Mode hints in tool descriptions.** `atlas_get_plan` and `atlas_confirm_change` descriptions say: confirm only on a site whose code you changed; on a third-party site, the plan is a proposal.
- **`atlas_list_sites`** returns the start page's summary (name, origin, counts, pending/applied, advice summary) instead of ids and dates only.
- **Install detection for the plugin.** `site-atlas doctor --json` so the setup skill can read the result instead of parsing text.

Everything else the method needs already exists (scan, map, block details with thumbnails, issues, all plan operations, confirm/reopen, canvas URL).

## 5. Constraints

- English everywhere in code, tool descriptions, skills and commands (the test suite enforces it); the agent answers the person in the person's language.
- The plugin must work with the released package (`npm install -g site-atlas` or `install.sh`) and with a source checkout (`node dist/cli.js mcp`); the setup skill covers both.
- No network calls from Atlas other than the scan itself; advice storage is local.
- Nothing in the plugin bypasses the untrusted-content marking of scanned text.
- The plugin version is released with the package: `release.yml` sets `plugin.json`'s version from `package.json` and the marketplace entry pins the plugin to the release tag (`"ref": "v0.2.0"`), bumped by the same workflow. Users therefore read the skills that match the CLI they installed; `main` may carry unreleased changes without affecting them.

## 6. Success criteria

1. On a clean machine with Claude Code, `/plugin install site-atlas@site-atlas` followed by `/atlas http://localhost:4321/` ends with the canvas open and a summary in chat, with no manual step besides answering the install prompt.
2. `/atlas-advise` on the SCAP Tech beta produces advice whose items name real sections of the scan, puts at least the movable items on the canvas as pending changes, and stores it so the home card shows it.
3. The same advice run against `https://stripe.com/` states advisory mode, writes a report file, and `/atlas-apply` refuses.
4. A terminal-only agent (no MCP) can run the method with the CLI alone, following the skill text.
5. The English-only test and the existing suite stay green; new MCP tools and HTTP routes have tests like the existing ones.

## 7. Decisions made in this design (to confirm or change)

- **Claude Code and Codex both get a real plugin, from one directory.** Superseded on 2026-10-28, after checking: Codex has had a plugin system since the agent-plugins.org 1.0.0 spec, it reads `.claude-plugin/marketplace.json` as well as its own location, and the manifests sit side by side in one tree (the installed Cloudflare plugin on this machine does exactly that). The earlier reasoning, that Claude Code was the only agent with a plugin format, was simply out of date.
- **The server is declared twice on purpose** (§4.1). Rejected alternatives: `${PLUGIN_ROOT}` in Codex, which its validator accepts and its launcher ignores, failing with a Windows "invalid directory" error; a real on-disk directory literally named `${CLAUDE_PLUGIN_ROOT}`, which does work in both agents and is unmaintainable; and `cwd` in Claude Code, which passes validation but is undocumented for stdio servers.
- **No npm publish is required.** The launcher plus each agent's anchoring reaches the CLI from inside the plugin, so `npx -y site-atlas mcp` is not needed. Publishing stays a release convenience, not a prerequisite.
- **Advice stored per atlas inside Atlas**, not only in chat. Reason: the user wants Atlas to be where the work continues; advice that lives in a chat log is lost.
- **Proposals go on the canvas as pending changes** rather than a separate "suggestions" layer. Reason: the canvas, the plan and the agents already share one vocabulary; a second layer would need its own UI and MCP surface. The author field already distinguishes who proposed what.
- **Mode is inferred, stated, and only asked when ambiguous.** Reason: asking every time is friction; a wrong guess is cheap because the agent says it before doing anything, and implementation is gated by it.
- **Detection improvements are out of scope here** and wait for concrete examples from the user.

Calls made after the builder check (my decisions, change them if you disagree):

- The plugin ships a tiny **launcher** that locates the CLI, and the commands work CLI-first with MCP as the faster path, so a fresh install works in the same session.
- The advice stores the **mode** (`own` / `advisory`); apply reads it instead of guessing again; the person can flip it on the home card.
- The marketplace entry is **pinned to the release tag**, bumped by `release.yml`.
- Advice accepts **`by` from the caller** over HTTP and the CLI (`--by`), unlike plan edits; the canvas does not write advice.

## 8. Left to the builder

- Exact wording of the skills and commands (within the method above), and how much of the limits list to repeat in each.
- The report's Markdown layout.
- How the home card and the canvas show the advice panel (a `<details>` or a dialog), as long as it is readable and selectable.
- Whether `atlas_set_advice` replaces or versions earlier advice (keeping only the latest is acceptable for v1).
- Test strategy for the plugin files themselves (at least: the marketplace and plugin manifests parse, the commands reference existing tools and CLI flags).
