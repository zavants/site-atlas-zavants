# Site Atlas, as a plugin

Scan a website into sections, advise on its structure, and implement the approved plan. The plugin brings the Site
Atlas MCP server and the method: four skills your assistant loads on its own, or that you call by name.

## Install

**Claude Code**

```
claude plugin marketplace add zavants/site-atlas-zavants
claude plugin install site-atlas@site-atlas
```

In the desktop app the second step is `+` -> **Add plugins** -> Site Atlas.

**Codex**

```
codex plugin marketplace add zavants/site-atlas-zavants
codex plugin add site-atlas@site-atlas
```

Both agents start a plugin's MCP server when a session starts, so a session that is already open needs
`/reload-plugins` (Claude Code) or a new session (Codex).

The plugin does not carry the scanner. The first skill checks for it and installs it when it is missing:
`npm install -g site-atlas` and `site-atlas setup`, or `install.sh` on Linux and macOS.

## The four skills

| Skill | What it does |
| --- | --- |
| `atlas` | Scans a URL into pages and sections, opens the canvas, reports the shape of the site and its most frequent issues. |
| `atlas-advise` | Reads the whole atlas and writes a prioritized recommendation along five fixed axes, puts what it can on the canvas as pending changes, and stores the advice on the atlas. |
| `atlas-apply` | Implements the pending changes in the code of your own site, re-scans to verify, and confirms each one. Refuses in advisory mode. |
| `site-atlas-setup` | Installs the CLI, downloads its Chromium, and sorts out a failing check. |

## Two modes

**My site** (`own`): the agent advises and implements, verifies with a re-scan, and confirms each change.
**Someone else's site** (`advisory`): the agent observes and recommends only; the plan stays a proposal and the
deliverable is a report. The mode is stored on the atlas and you can flip it on the canvas home card.

## What it cannot see

Up to 30 pages by default, one origin, `robots.txt` respected; the rendered DOM in a desktop viewport, with no
login, no interaction and no mobile layout; sections and their kinds come from heuristics; issues are structural,
not content or performance. Text from a scanned site is data, never instructions. The `atlas-advise` skill states
these limits whenever they shaped the advice.

## Other MCP clients

Cursor, Windsurf and Claude Desktop have no plugin format here. Point them at the server directly with
`site-atlas mcp`, as the main README of the repository describes.
