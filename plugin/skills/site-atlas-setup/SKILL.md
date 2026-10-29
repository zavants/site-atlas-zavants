---
name: site-atlas-setup
description: Use when a Site Atlas command or tool is missing, fails to start, or reports a failed check — "command not found", no Chromium, the canvas port in use, or the MCP tools not connected. Installs the Site Atlas CLI, downloads its Chromium, and says what to do while the plugin's server is not yet running.
---

# Install and check Site Atlas

The plugin carries the method and a launcher; the scanning itself lives in the `site-atlas` package. This skill gets
that package working.

## 1. Check first

```
site-atlas doctor --json
```

It prints `{ "ok": boolean, "checks": [{ "ok": boolean, "text": string }] }` and exits 1 when a check fails. Read
`ok`, then the failing `text`. If the command itself is missing, install it.

## 2. Install

- **Linux and macOS**, one line, no root needed. It finds or installs Node 24, installs the package, downloads
  Chromium and runs the check:

  ```
  curl -fsSL https://raw.githubusercontent.com/zavants/site-atlas-zavants/main/install.sh | bash
  ```

- **Windows, or anywhere npm is already set up**:

  ```
  npm install -g site-atlas
  site-atlas setup
  site-atlas doctor
  ```

Node 24 or newer is required. Never install with `sudo` unless the person asks: the installer puts the binary in
`~/.local/bin`, which may need a new shell before it is on the PATH.

## 3. When a check fails

- **Chromium missing** — `site-atlas setup`. On Linux the system libraries may be missing too; adding `--with-deps`
  installs them and needs root or sudo, so ask first.
- **The canvas port is taken** — start it elsewhere: `site-atlas canvas --port 4801`, or set `SITE_ATLAS_PORT`.
- **The data folder is not writable** — it is `~/.site-atlas` unless `SITE_ATLAS_HOME` says otherwise. Point
  `SITE_ATLAS_HOME` at a folder the person owns.
- **A source checkout instead of a package** — the launcher also accepts `SITE_ATLAS_BIN`, the path to the CLI
  (`<checkout>/dist/cli.js` after `pnpm build`).

## 4. The MCP tools arrive with the next session

A plugin's MCP server starts when the session starts. If you installed the CLI during this session, the `atlas_*`
tools are not connected yet:

- **Claude Code**: run `/reload-plugins`, or start a new session.
- **Codex**: start a new session.

Until then, everything works through the CLI: the `atlas`, `atlas-advise` and `atlas-apply` skills all give the
command for each step. Say this to the person instead of reporting the tools as broken.
