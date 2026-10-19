# Site Atlas — Design v2: the org chart

**Status:** draft for approval · **Date:** 2026-10-19 · **Extends:** `2026-10-19-site-atlas-design.md` (v1). Everything in v1 still applies unless this document explicitly changes it.
**Visual and interactive reference:** `docs/superpowers/prototypes/organigrama-v11.html`, a throwaway prototype validated with the user. To open it, replace `__DATA__` with the JSON of a site map. The prototype's labels are in Spanish; the product must be in English (§9).

---

## 1. Intent

v1 shows the site as columns of sections. That works for ordering, but it doesn't answer the questions the user has when reviewing a page:

- Should this section move to another page, or stay?
- Where does this section point, and what points to it?
- What happens if I move section A to page B and link it to X?
- Which sections say the same thing?

v2 turns the canvas into an **org chart**: each page is a diagram built from pieces (its sections, like Lego bricks), and **every link is a line that leaves the exact piece that contains it**. It shows what a person can't see by scrolling the page: threads, broken targets and repetition.

Everything the user changes in the org chart is a **plan**. Any AI (Claude, Codex, GPT or others) can read it and implement it. **No change counts as done until an AI confirms it applied it to the site.**

## 2. Goals, non-goals and anti-goals

**Goals for v2**

1. **Diagram** view: pages as diagrams of pieces, with their contents, one line per link, and shared components shown separately.
2. **Screenshots** view: the same org chart with every piece shown as its enlarged screenshot.
3. Direct editing:
   - drag pieces live, within a page or to another page;
   - move diagrams;
   - retarget arrows by snapping them to a new target;
   - create and delete connectors;
   - create and delete planned pages.
4. History: Undo, Redo and Reset.
5. **A plan any AI can read**, with *pending* and *applied* states, readable and confirmable through MCP and the CLI.
6. **Everything in English** (§9).

**Non-goals for v2**

- Automatic detection of topic redundancy across sections (the "topic × section" matrix from the mockups). Left for a later version; the org chart already makes repetition visible.
- Editing section content (copy, images).
- Applying changes to the site. That is done by an AI or a person in the code.
- Undo history that persists across browser sessions.
- Localization into other languages (English only for now).

**Anti-goals**

- **Site Atlas writing any file inside the scanned site's repository.** Everything lives in Atlas's data folder (`~/.site-atlas` or `SITE_ATLAS_HOME`).
- A change becoming "applied" without an AI or a person confirming it.
- A page diagram becoming unreadable because of threads from shared components.
- Dragging that feels clumsy: a piece detached from the cursor, a gap that doesn't follow, or text getting selected while dragging.

## 3. New concepts

| Concept | What it is |
|---|---|
| **Diagram** | A node of the org chart: a real page, a planned page, a **target** (a path that doesn't exist, or an external site) or a **component**. |
| **Piece** | The representation of a v1 block inside a diagram. |
| **Shared component** | A named global block: "Header 1", "Footer 1"… Variants with different fingerprints are numbered "Header 2" and so on (§10b). |
| **Line** | A link from a piece to another piece (anchor) or to a diagram (page or target). |
| **Link edit** | A change to the target of an existing link. |
| **New connector** | A link that doesn't exist on the site and that the user adds. |
| **Change** | Each difference between the real site and the plan. It has a stable id and a status. |
| **Change status** | `pending` (the default, always) or `applied` (only after confirmation). Separately, the canvas shows whether the latest scan already reflects the change. |

## 4. Diagram view

**Diagrams**
- **Real pages** from the scan, plus planned pages.
- **Automatic targets:** one diagram for each linked internal path that doesn't exist (in `missingPages` or behind a broken link), labeled NOT FOUND, and one for each linked external origin, labeled EXTERNAL.
- Each page shows how many pieces it has. Planned pages are labeled PLANNED and have a × to delete them (with confirmation; their pieces go back to their real page).

**Pieces**
- **Header row:** order number, name, counters (links ↗n, media ▣n) and issues ⚠n.
- **Background by type:** narrative, visual or conversion.
- **Details on click:** thumbnail, type and height, headings, every link with its effective target (marked "edited" if it was changed), forms and issues.
- **The v1 type selector and tags**, inside the details.

**Shared components**
- In a page diagram they appear as a piece labeled COMPONENT, **with no lines**.
- The **Show** selector offers "Pages" (all page diagrams) and one diagram per component. In a component's diagram, the component sits on the left with its lines; the pieces it points to are highlighted and the rest are dimmed. Its title says which pages use it.

**Lines**
- **Start:** the right edge of the exact piece.
- **End:** the nearest edge of the target piece or diagram; if the target is in the same column, the line loops out on the right.
- **Colors:**

| Color | Meaning |
|---|---|
| Blue | To another section |
| Red | To a page that doesn't exist |
| Gray | To an external site |
| Dashed green | Edited link |
| Dotted violet | New connector |

- The **"Show links within the page (#anchors)"** checkbox hides or shows lines between sections of the same page.
- Each line ends in a draggable **circle** (§6).

**v1 features kept inside the org chart:** tag filter and editing, the Real / Planned switch (no editing in Real), marking a section for deletion (a special "Delete" diagram), orphans with Assign or Discard, re-scan, and live updates over SSE.

## 5. Screenshots view

- A **View: Diagram | Screenshots** selector. Changes made in one view show in the other.
- In Screenshots, each piece shows its thumbnail at the full width of the diagram, with only its number and name overlaid at the top left. Counters, issues, tags, details and the ＋ handle are hidden.
- Diagrams get wider (pages 480 px, targets 300 px) and are spread horizontally ×1.6 relative to their Diagram position, so they don't overlap. There is one stored position; the factor is applied when rendering.
- On entering the view, zoom fits the content width and the view starts at the top.
- Dragging, lines, connectors and history work exactly as in Diagram.

## 6. Interactions

**Canvas**
- Dotted background.
- **Scroll:** wheel up and down; Shift + wheel sideways; or drag the background.
- **Zoom:** Ctrl + wheel, toward the cursor, from 20 % to 250 %.
- **Bottom-right bar:** −, percentage, +, 100 %, Fit (all content) and Center.
- **Top-left bar:** Undo (Ctrl+Z), Redo (Ctrl+Y or Ctrl+Shift+Z), Reset (asks to confirm "Are you sure you want to undo all changes?") and "+ New page".
- **Planned changes:** a panel collapsed by default, with the number of changes in its title.
- No text gets selected while dragging; the expanded details can still be selected.

**Dragging pieces** (custom drag; not the browser's native drag and not SortableJS)
- Starts after 5 px of movement; a click without movement opens the details.
- The piece floats **inside the canvas, with zoom applied**, stuck to the point where it was grabbed.
- A **gap** of the same height takes its place and moves live. The other pieces slide with a short animation (FLIP, about 160 ms).
- The drop index is computed from the pieces' **final layout positions** (`offsetTop`), not their animated ones.
- The receiving diagram is the one under the cursor (`elementFromPoint`); it gets a dashed blue outline.
- Components don't move between pages.

**Moving diagrams**
- Diagrams are dragged by their title. While the cursor is over the title, and while moving, the border **lights up** (blue with a halo) and the diagram stays on top.
- New pages appear near the center of the view, in a free spot.

**Arrows and connectors**
- **Retarget:** drag the end circle of a line. If it comes within 70 px of a valid piece or diagram, the target lights up and the line snaps to it; on release the link edit is saved.
- **Create:** drag from the violet ＋ handle that appears when hovering a piece (in a page diagram, any piece except components; in a component's diagram, the component).
- **Delete a new connector:** click its end circle without dragging, then confirm.
- Deleting a planned page also deletes the connectors and edits that pointed to it.

**Creating a page**
- A dialog with **Path** (normalized: leading `/`, lowercase, no trailing `/` and no doubled slashes) and **Title** (optional; defaults to the path).
- Empty or duplicate paths are rejected with a message inside the dialog.

**History**
- Each operation is one step: moving a piece, moving a diagram, editing or creating a link, creating or deleting a page or a connector, Reset.
- It lives in browser memory. Reset returns to the user layer as it was saved when the canvas was opened, not to an untouched v1.

## 7. Data (user layer, `overlay.json`)

New fields with `schemaVersion: 2`; the migration from v1 initializes them empty and translates the type values (§9).

- `layout`: `{ [diagramId]: { x, y } }`, each diagram's position (in Diagram-view coordinates).
- `componentNames`: `{ [componentId]: "Header 1" }`, editable.
- `linkEdits`: `{ [linkId]: Target & { by } }`. `linkId` = `<owner>|<original href>|<text>`, where `owner` is a `blockKey` or a `componentId`. It is stable across scans; the link's index is not used.
- `addedLinks`: `[{ id, from: owner, to: Target, label?, by }]`.
- `confirmations`: `{ [changeId]: { at, by, note } }`.
- `Target` = `{ block: blockKey } | { page: path or URL }`.

v1 reconciliation is extended: block keys inside `linkEdits`, `addedLinks` and as targets are also renamed, or become orphans, under the same rules.

## 8. A plan any AI can read

### 8.1 Changes

The plan is **derived** from the state (scan + user layer), like v1's `atlas_get_plan`, extended with these types:

| Type | Meaning |
|---|---|
| `newPage` | Create a planned page |
| `move` | Move a section to another page |
| `reorder` | Reorder sections within a page |
| `delete` | Delete a section |
| `relink` | Change the target of an existing link |
| `addLink` | Add a new link to a section |

Each change has:

- `id`: a stable hash of what the change means (§10b). If the user modifies that change, the id changes and the change is pending again.
- `status`: `pending` | `applied`. It is `applied` only when `confirmations[id]` exists.
- `observed`: `true` | `false` | `null`. Whether the latest scan already reflects the change (for example, the section is already on the target page). It is informational only and **never changes `status`**.
- `summary`: one line in English, for example `Move "Technology" from / to /es/soluciones/brokers`.
- `details`: the exact data needed to implement it:
  - source page and section (name, `blockKey`, heading, anchor, text excerpt);
  - target (page, position, and the sections immediately before and after);
  - for links: link text, current `href` and suggested new `href` (`/path#anchor` when the target has an anchor);
  - issues the change resolves (for example, the broken link to `/es/soluciones/brokers`);
  - who proposed it (`by`).
- `doneWhen`: a verifiable criterion in plain language, for example "Page /es/soluciones/brokers contains the 'Technology' section and / no longer does."

An applied change stays in the plan while the difference still exists in the state. It disappears once the scan shows the site matching the plan; its confirmation stays in `confirmations` as history.

### 8.2 How AIs read and edit it (without writing to the site's repository)

**MCP: read and confirm**
- `atlas_get_plan { site, status? }` returns the Markdown text plus the JSON with the fields from §8.1.
- **New:** `atlas_confirm_change { site, changeId, note }` marks a change as applied. `note` is required: what was done and where (file, commit). Returns the updated plan.
- **New:** `atlas_reopen_change { site, changeId, note }` sets a change back to pending.

**MCP: AIs can also propose changes** (decided by the user). Besides the v1 tools (`atlas_move_block`, `atlas_add_planned_page`, tags), MCP adds:
- `atlas_relink { site, owner, linkText, linkHref, to }`: retargets an existing link.
- `atlas_add_link { site, owner, to, label? }`: adds a connector.
- `atlas_remove_link { site, linkId }`: removes an added connector or a link edit.
- `atlas_remove_planned_page { site, path }`: deletes a planned page; its pieces go back to their real page.
- `atlas_mark_deleted { site, blockKey }` and `atlas_restore { site, blockKey }`.

These are the same operations the canvas uses, through the same service layer and with the same lock. Agents don't send `rev`; they validate the target and return a readable error if it doesn't exist. Every change proposed by an AI is **pending**, just like the user's. Each edit records who made it (`by`: `canvas`, or the name of the MCP client or of the CLI), and the changes panel shows it.

**CLI**, for AIs with a terminal but no MCP:
- `site-atlas plan <site> [--json] [--status pending|applied]` prints the plan to stdout.
- `site-atlas confirm <site> <changeId> --note "<text>"`.
- `site-atlas reopen <site> <changeId> --note "<text>"`.
- Equivalents for proposing: `site-atlas move`, `site-atlas page add|remove`, `site-atlas relink`, `site-atlas link add|remove`, `site-atlas delete|restore`, with the same inputs as MCP.

**Text format (Markdown):**
1. a header with the site and the scan;
2. a fixed paragraph of **instructions for the AI**: implement in the site's code, verify, and only then confirm with `atlas_confirm_change` or `site-atlas confirm`; never confirm without having applied the change;
3. the list of changes, each with id, status, summary, details and done criterion.

**A documented JSON schema** in `docs/plan-schema.md` in the Site Atlas repository (not the site's), with a complete example. The JSON carries `schemaVersion`.

**Text from the site** inside the plan (names, headings, excerpts) is marked as untrusted content, as in v1.

### 8.3 In the canvas

The "Planned changes" panel lists every change with its status. Applied ones show a mark and who confirmed them; ones observed on the site show an indicator. The user doesn't confirm from the canvas; the canvas only shows the status.

## 9. Language: English everywhere

The whole product is in English, including what v1 shipped in Spanish:

- canvas interface: labels, buttons, dialogs, empty states, tooltips and notices;
- MCP tool names stay as they are; their descriptions, parameter descriptions, outputs (map text, plan text, untrusted-content notice) and error messages are in English;
- CLI help and output;
- issue messages (`broken-link`, `missing-anchor`, etc.) and change `summary` / `doneWhen` texts;
- design documents: this document and the v1 design are in English; the v1 implementation plan stays as a historical record.

Section **type values** become English: `narrative`, `visual`, `conversion` (v1 stored `narrativa`). The user-layer migration translates `kindOverrides`, and scans saved by v1 are read with the same mapping.

Text taken from the scanned site (section names, headings, excerpts) is shown as it is, in whatever language the site uses.

## 10. Constraints

- Same as v1: everything local, server on `127.0.0.1`, no telemetry, no `v-html`.
- **No writes outside Atlas's data folder.** This is tested (§11).
- Drag performance: up to 60 pieces per page and 20 visible diagrams with no perceptible stutter. Lines are redrawn at most once per frame (`requestAnimationFrame`).
- Every mutation goes through the v1 service layer, with its lock and `rev` control.

## 10b. Precise rules (decided by Claude after review)

**History (Undo, Redo and Reset)**
- Each step stores a snapshot of only the plan fields of the user layer: `plannedOrder`, `plannedPages`, `plannedDeletions`, `layout`, `linkEdits`, `addedLinks`.
- Undo or Redo sends a `replacePlanFields` operation with the current `rev`. It never touches `confirmations`, `tags`, `blockTags`, `kindOverrides`, `componentNames` or orphans.
- If an SSE notice says another client wrote (an AI, another tab, a re-scan), the canvas reloads the map, **clears the history** and shows "The map changed elsewhere; history was reset." Reset uses the snapshot taken at that moment.

**Change identity** (the id never includes exact positions)

| Type | What the id is built from |
|---|---|
| `newPage` | path |
| `move` | `blockKey` + target page. The position goes in `details`, not the id. |
| `reorder` | one change **per displaced section** (outside the longest increasing subsequence): `blockKey` + page + key of the section immediately before it (or "start") |
| `delete` | `blockKey` |
| `relink` | `linkId` + target identity (`blockKey` or path/URL). If the target section moves, the id doesn't change; the suggested `href` does. |
| `addLink` | source owner + target identity |

**Links after a re-scan**
- **`relink`:** it is *observed* when the source section has a link whose resolved target matches the planned target (same page and, if the target is a section, its anchor). The link text doesn't matter. Once observed, reconciliation **removes** the edit from `linkEdits`: the change disappears from the plan and its confirmation stays as history. If it isn't observed and its `linkId` no longer exists, the edit becomes an orphan, like a block.
- **`addLink`:** same rule, by resolved target from the source owner.

**Shared components**
- Every top-level `header`, `footer`, `[role=banner]` and `[role=contentinfo]` is a component **even if it appears on only one page**. v1 global blocks (fingerprint repeated on two or more pages) are components too. v1 pieces with `global: true` stay as they are.
- **Identity:** `componentId` = `c:` + the fingerprint from the first scan it appeared in. Later scans reconcile it with v1 §5.5 rules (same fingerprint or similarity ≥ 0.8), so `componentNames` survives text changes.
- A component's link edits and connectors are stored under its `componentId` and **apply to every page that uses it**. The plan says so explicitly: "Header 1 (used on: /, /other)".

## 11. Success criteria

1. With SCAP Beta 1, the org chart shows the Home page with 15 pieces.
   - **Pages tab:** 4 lines of its own (2 from the Hero, 1 in red to `/es/soluciones/brokers`, 1 in gray to scapbroker.com) and the NOT FOUND and EXTERNAL targets.
   - **Header 1 tab:** its 7 lines.
2. The §6 interactions behave as in prototype v11. In particular, dragging "La plataforma" to between "Soluciones" and "Tecnología para brokers" advances the gap one position at a time, without flickering, and drops it exactly there, at a zoom level other than 100 %.
3. After moving a section, retargeting a link and adding a connector:
   - `atlas_get_plan` and `site-atlas plan` return those changes as `pending`, with `details` and `doneWhen`;
   - `atlas_confirm_change` sets them to `applied`;
   - a re-scan neither sets them back to pending nor confirms them on its own.
4. A test runs a full flow (scan, plan, confirm) and checks that the scanned site's file tree did not change.
5. An agent with a terminal but no MCP can read the plan and implement a change guided only by `site-atlas plan`. Verified with Codex or another agent on a copy of SCAP Beta 1.
6. No Spanish text remains in the interface, MCP or CLI, except text that comes from the scanned site. Checked by a test that scans the built canvas, MCP descriptions and CLI help for a list of common Spanish words.

## 12. Build decisions (proposed by Claude, to confirm)

- The org chart replaces the column board as the canvas view and keeps its features (§4).
- A custom drag instead of SortableJS / `vue-draggable-plus`: it was the only approach that respected zoom in the prototype. The dependency is removed.
- Lines in a single overlay SVG, in unzoomed canvas coordinates.
- `linkId` built from href + text, not index, so it survives re-scans.
- Change ids derived from content, with no event log: Undo, Redo and Reset stay simple, and a confirmation is tied to the exact change.
- English strings live in one module per side (server and canvas), not scattered through components, so a future translation is easy, even though localization is not a v2 goal.

## 13. Left to the builder

- Initial automatic layout of diagrams when no `layout` is stored.
- Exact palette and fine visual details (guide: prototype v11).
- Exact format of the plan's Markdown, following the order in §8.2.
- How to show many pages (more than 20): grouping or a minimap, if needed.
