# Site Atlas, end to end

A walk from an empty machine to a site you have reorganized and handed to an AI agent to implement. Every command here is one you can paste. If you only want the reference, the [README](../README.md) has it; this is the guided version.

By the end you will have: Site Atlas installed, a site scanned into sections, a plan of changes you made by dragging, and an agent in Claude Code or Codex that can read that plan and write the code.

---

## 1. Install

**Linux or macOS, one line.** It finds or installs Node 24, installs the package, downloads Chromium and checks the result. No root needed: without a system Node it puts a private one under `~/.site-atlas/node`, and without a writable global npm folder it installs under `~/.site-atlas/npm` and links the command into `~/.local/bin`.

```bash
curl -fsSL https://raw.githubusercontent.com/zavants/site-atlas-zavants/main/install.sh | bash
```

**Any OS with Node 24, including Windows:**

```bash
npm install -g site-atlas
site-atlas setup
```

`setup` downloads the Chromium that scans run in. On Linux add `--with-deps` as root to also install the system libraries it needs.

**Docker**, if you would rather not install Node:

```bash
docker build -t site-atlas https://github.com/zavants/site-atlas-zavants.git
docker run -d --name site-atlas -p 4800:4800 -v site-atlas:/data -e SITE_ATLAS_TOKEN=<a secret> site-atlas
```

**Check it:**

```bash
site-atlas doctor
```

Five lines, all starting with `ok`. If one says `FAIL`, it also says what to do.

---

## 2. Your first atlas

Start the canvas and let it do the rest:

```bash
site-atlas canvas
```

Open `http://127.0.0.1:4800`. The start page has one field: paste the URL of a site and press **Scan**. A local site, a staging URL or a public one all work.

Atlas opens the page in Chromium, waits for it to settle, scrolls it so lazy content loads, splits it into sections and takes a thumbnail of each. You will see the progress page by page. When it finishes, the canvas of your new atlas opens by itself.

The same from the terminal, if you prefer:

```bash
site-atlas scan https://example.com/
site-atlas scan https://example.com/ --max-pages 5 --exclude "/blog/**"
```

Thirty pages is the default ceiling. Atlas stays inside the starting URL's origin and path, respects `robots.txt`, and waits a second between pages on public sites.

Everything it learns lives in `~/.site-atlas/`. Nothing leaves your machine except the requests to the site itself.

---

## 3. Reading the canvas

Each page of the site is a card, and inside it every section is a piece in the order the page shows them. Shared headers and footers get their own card, because they belong to all the pages at once.

**The lines between cards are the links**, each drawn from the exact section that contains it. Blue goes to another section, gray to an external site, and red to a page that does not exist, which is how a broken link looks before anyone reports it.

**Each piece carries its detected role**: Hero, Features, Pricing, FAQ, Testimonials, Steps, Logos, Contact and so on, with a second chip when the section holds a call to action. Atlas works the role out from the structure of the page, not from its words alone: repeated cards, numbered steps, quotes with a name, prices, big figures, questions. If it gets one wrong, click the piece and set it by hand in **Role**; your correction survives every future scan.

**The counters at the top are clickable.** Errors, warnings and notices open the list of what Atlas found: broken links, anchors that point nowhere, forms without a destination, placeholder images, sections nobody can link to, missing or duplicated headings.

**The menus** hold the rest. Navigation switches between the pages and a shared component. Filters narrows the canvas to one role or one of your own tags. Views swaps the diagram for the real screenshots, which is the fastest way to recognize a section you do not remember. Options sets the colors.

---

## 4. Planning changes

The switch at the top right says **View** and **Edit**. View is the site exactly as it was scanned. Edit is where you rearrange it, and nothing you do there touches the site: you are writing a plan.

What you can do:

- **Drag a piece** to reorder it inside its page, or onto another card to move it there.
- **Drag a line's end** onto another section or page to point that link somewhere else.
- **Drag from the `+` of a piece** to add a link that does not exist yet.
- **Drop a piece on the trash** to mark it for deletion. The badge counts what is marked, and the trash shows you what will go before you let go.
- **New page** adds a page the site does not have yet, so you can move sections into it.
- **Undo and redo** with the buttons or `Ctrl+Z` and `Ctrl+Y`.

The **Planned changes** panel lists everything you have decided, in plain language. The same list in the terminal:

```bash
site-atlas plan my-site
site-atlas plan my-site --json
```

Each change says what to do and how to know it is done. They stay **pending** until whoever implements them confirms, which is the next step.

---

## 5. Connect your AI

Site Atlas speaks the Model Context Protocol, so an agent reads the map and the plan through tools instead of through you.

**Claude Code:**

```bash
claude mcp add site-atlas -- site-atlas mcp
```

**Codex:**

```bash
codex mcp add site-atlas -- site-atlas mcp
```

That writes a `[mcp_servers.site-atlas]` entry into `~/.codex/config.toml`, leaving the rest of the file alone.

**Any other MCP client** (Cursor, Windsurf, Claude Desktop) takes the same thing as JSON:

```json
{ "mcpServers": { "site-atlas": { "command": "site-atlas", "args": ["mcp"] } } }
```

On Windows, npm installs `site-atlas.cmd`. If a client cannot start it, use `"command": "node"` with `"args": ["<npm prefix>/node_modules/site-atlas/dist/cli.js", "mcp"]`; `npm prefix -g` prints the folder.

Start a new session after adding the server, then ask the agent for something real:

> Scan http://localhost:4321 with site-atlas, move the pricing section to its own page, and tell me what has to change in the code.

The agent gets 22 tools: scanning, the map with its roles and issues, the plan, and every operation the canvas offers. Text taken from the scanned site reaches it marked as untrusted data, so instructions hidden in a page are treated as content, never as orders.

---

## 6. The round trip

This is the loop Site Atlas is built around, and the part worth understanding.

1. **You decide** on the canvas, or ask the agent to propose it. Either way the decision lands in the same plan.
2. **The agent reads the plan**, with `atlas_get_plan` or `site-atlas plan my-site`. Every pending change says what to do and what "done" looks like.
3. **The agent writes the code** in your repository. Atlas never touches your site: it has no idea where your source lives, and that is deliberate.
4. **The agent verifies** the change in the running site.
5. **The agent confirms it**, with `atlas_confirm_change` or:

   ```bash
   site-atlas confirm my-site <changeId> --note "moved the section to src/pages/pricing.astro"
   ```

   The change moves from pending to applied, with a note saying what was done and where. If it turns out it was not really done, `site-atlas reopen` puts it back.
6. **You re-scan**, from the canvas or with `site-atlas scan` again. Atlas matches the old sections to the new ones by anchor, fingerprint and text, so your organization survives the change. Anything it cannot match becomes an orphan you can reassign in one click. The plan now reports that the site matches it.

An agent with no MCP at all can do the whole loop from the terminal: `plan`, implement, `confirm`.

---

## 7. On a server

Scanning and planning work the same on a server. For the canvas you have two ways in.

**An SSH tunnel**, which exposes nothing:

```bash
ssh -L 4800:127.0.0.1:4800 user@server
```

Then open `http://127.0.0.1:4800` on your own machine.

**Or bind it to the network with a token.** Anything other than localhost requires one, and Atlas generates it if you do not:

```bash
site-atlas canvas --host 0.0.0.0 --token "$(openssl rand -base64 24)"
```

It prints a link that sets the token as a cookie once. Every request except the health check then needs that cookie or a bearer header. The token travels in clear text over HTTP, so put a reverse proxy with HTTPS in front before using it outside a trusted network. `SITE_ATLAS_HOST`, `SITE_ATLAS_PORT` and `SITE_ATLAS_TOKEN` do the same for a service unit; the README has one ready to copy.

---

## 8. When something goes wrong

**Start here:**

```bash
site-atlas doctor
```

**The scan found almost nothing.** The site probably builds its content after load in a way the scan does not wait for, or hides it behind a click. Atlas reads the rendered page at desktop size after one scroll through; it does not log in, click or open menus. On your own site you can set the split exactly with `data-atlas-block="Hero"` on a section.

**Sections have odd names.** The name comes from the first heading, or the small label above it. A section with no heading gets a generic one; rename it from the canvas.

**"Canvas not built"** means the interface was not compiled. From a source checkout, run `pnpm build`.

**Chromium will not start on Linux.** Run `sudo site-atlas setup --with-deps` to install the system libraries.

**The port is taken.** The canvas walks 4800 to 4810 and reuses an Atlas already running. `--port` picks another.

**Git Bash on Windows rewrites your arguments.** An argument starting with `/`, like a block key, becomes a Windows path before Atlas sees it. Start the command with `MSYS_NO_PATHCONV=1`. Atlas detects it and says so. PowerShell and cmd are unaffected.

---

## What Atlas will not do

It never writes to your site's repository, it has no telemetry, and it does not decide for you. It reads a site, shows you what is there, keeps what you decide, and hands that decision to whoever writes the code, whether that is you or an agent.
