# The editor (`public/js/editor.js`)

A tour of the editor script. The header comment at the top of the file is the short version of this page; keep the two in step when you change the model.

The file is one function wrapped around everything (`(function(){ ... })()`), so nothing leaks into the page. It is organised in sections marked with `/* ===== name ===== */` banners. Search for a banner to jump to a section.

## The core loop

```
Mermaid text ──build()──▶ model M ──renderInner()──▶ SVG in #world
      ▲                      │
      └────toMermaid()───────┘        user edits change M inside mutate()
```

1. **Load.** `boot()` fetches the Mermaid text and calls `build(src)`, which returns a model.
2. **Draw.** `draw()` calls `renderInner()` to produce SVG markup and puts it in `<g id="world">`.
3. **Edit.** Pointer and inspector handlers change `M` inside `mutate(() => { ... })`.
4. **React.** `mutate` records an undo step and calls `changed()`, which redraws, refreshes the code tab, schedules a save and rebuilds the side panel.
5. **Save.** `toMermaid()` turns `M` back into text.

Everything is redrawn from scratch on every change. There is no diffing; diagrams are small enough that it doesn't matter, and it keeps the code simple.

## Two families of diagram

| | Canvas-editable | Mermaid-drawn ("view") |
| --- | --- | --- |
| `M.kind` | `flow`, `er`, `seq`, `class` | `view` |
| Types | flowchart, state (a `flow` with `flavor: "state"`), ER, sequence, class | everything else: Gantt, pie, mindmap, C4... |
| Parsed by | our parsers (`parseFlow`, `parseER`...) | not parsed; the text is kept in `M.src` |
| Drawn by | `renderInner()` | the Mermaid library (`drawMermaid`) |
| Edited by | dragging, the inspector | `viewEditor()`: tables, outline, double-click text |

A canvas-editable type falls back to "view" when the file uses syntax the parser doesn't support (`parseSeq` and `parseState` return `unsupported`). `M.why` then holds the reason shown to the user.

`viewing()` is true whenever Mermaid's drawing is on screen: for "view" kinds, and when the user switches an editable diagram to **Mermaid view** (`S.mview`).

## The model

```js
M = {
  kind: "flow" | "er" | "seq" | "class" | "view",
  flavor: "state" | "",          // a state diagram is a flow model with this set
  dir: "TD" | "LR" | "BT" | "RL",
  lineStyle: "elbow" | "curved" | "straight",
  pre: "...",                    // lines above the diagram keyword, written back unchanged
  nodes: [ ... ],
  edges: [ ... ],
  // sequence only: title, auto (number the messages)
  // view only:     type, src, why
}
```

### Nodes

Every node has `id`, `key`, `text`, `shape`, `x`, `y`, `note` and `g`.

- `id` is internal (`"n12"`), made by `nid()`, unique for this page load and never saved. Edges refer to nodes by `id`.
- `key` is the Mermaid identifier: a table name, a flowchart node id, a participant alias.
- `g` is the `id` of the group this node sits in, or `null`.
- `w` and `h` are computed by `measure()` on every draw. Don't store them.

| Kind | `shape` values | Extra fields |
| --- | --- | --- |
| flowchart | `rect` `round` `stadium` `diamond` `circle` `sub` `group` | |
| state | `state` `start` `end` `choice` `fork` `join` `group` | `desc` (text under the name) |
| ER | (unused) | `attrs: [{type, name, keys: ["PK","FK","UK"], comment}]` |
| class | `class` `group` | `members: ["+String id", "+save() bool"]`, `stereo`, `generic` |
| sequence | `participant` `actor` | |

**Groups** (flowchart subgraphs, composite states, class namespaces) are ordinary nodes with `shape: "group"`. Children point at their group through `g`. A group's box is never stored: `layoutGroups()` recomputes it from the children on every draw. Dragging a group's title bar moves its descendants.

### Edges

Every edge has `a` and `b` (node ids), `label` and `bend`.

| Kind | Extra fields |
| --- | --- |
| flowchart, state | `style`: `solid` `thick` `dotted`; `arrow`: boolean |
| ER | `ka`, `kb`: `one` `zeroOne` `oneMany` `zeroMany`; `ident`: solid line |
| class | `ma`, `mb`: marker at each end (`tri` `dia` `odia` `arrow` `""`); `dotted`; `la`, `lb`: cardinality text |
| sequence | see below |

`bend` is `{dx, dy}`: how far the line's handle was dragged from the straight midpoint between the two nodes, or `null`. Fields starting with `_` (`_pA`, `_sA`, `_off`, `_nb`...) are computed during drawing and never saved.

### Sequence diagrams are different

A sequence diagram has no free layout. **Order is the layout**: the order of `M.nodes` is the column order, and `M.edges` is an ordered list of rows. Each row has a type `t`:

| `t` | Meaning | Fields |
| --- | --- | --- |
| `msg` | a message | `a`, `b`, `label`, `arrow` (`->>`, `-->>`...), `act` (`+`, `-`, `""`) |
| `note` | a note | `a`, `b` (optional), `pos` (`left of`, `right of`, `over`), `label` |
| `open` | start of a block | `kind` (`loop` `alt` `opt` `par` `critical` `break` `rect`), `label` |
| `mid` | a branch inside a block (`else`, `and`, `option`) | `label` |
| `close` | end of a block | |
| `act` | `activate` / `deactivate` | `a`, `on` |

`seqLayout()` turns that order into coordinates (`M._seq.cx` for columns, `M._seq.rows` for rows). Sequence diagrams have their own renderer (`renderSeq`), pointer handling (`seqDown`, `seqMove`), inspector (`seqInspector`) and walkthrough. They live together in the "sequence diagrams" section.

## Other state

| Name | Holds |
| --- | --- |
| `V` | Viewport `{tx, ty, k}`. `applyView()` applies it; `toWorld(ev)` converts a pointer event to world coordinates |
| `S` | `sel` (`{type:"node", id}` or `{type:"edge", i}` or `null`), `connect` and `src` (Connect tool), `snap`, `focus` and `focusId` (Focus tool), `mview` |
| `W` | Walkthrough: `on`, `trail` and `etrail` (flow/state), `si` (sequence) |
| `history` | Undo stack of `snapshot()` strings |
| `DOC`, `dirty`, `conflict` | The saved document and save state (app glue section) |
| `MV` | The last Mermaid drawing: its source, size and any error |

## Parsing and writing

Each editable type has a parser and a writer.

| Type | Parser | Writer |
| --- | --- | --- |
| flowchart | `parseFlow` | `flowBody` |
| state | `parseState` | `stateBody` |
| ER | `parseER` | inside `toMermaidBody` |
| class | `parseClass` | `classBody` |
| sequence | `parseSeq` | `seqToMermaid` |

- Parsers are line-based and forgiving. A line they can't read is added to `errors` (shown as "skipped lines") instead of failing the whole file.
- `parseMeta` reads Untangle's own `%% layout:` / `bend:` / `note:` / `lines:` comments. Every parser calls it for comment lines.
- `buildModel` turns parser output into a model: fresh ids, saved positions restored, automatic layout for nodes without a position.
- `toMermaid()` = preamble + `toMermaidBody()`.

**The contract to protect:** `build(toMermaid())` must give back an equivalent model, and Mermaid itself must accept what `toMermaid()` writes. The browser test checks the second for every template by switching to Mermaid view.

## Drawing

`renderInner(plain)` returns one SVG string:

1. `measure()` every node, `layoutGroups()`, `assignPorts()`.
2. Group boxes, then edges, then nodes, then edge labels (last, so boxes never cover them).
3. CSS classes carry state: `sel`, `src`, `dim`, `cur`, `next`, `visited`, `walked`. `litSets()` decides what is dimmed for Focus and the walkthrough.

`plain = true` is used for exports and thumbnails: no hit areas, handles or selection.

**Styles.** `SVG_CSS` (colours and fonts of the diagram) is injected into the page and also embedded in exported SVGs, so put anything an export needs there. `LIVE_CSS` holds editing-only styles. Colours are CSS variables defined in `editor.html`; exports use the fixed `PALETTE` in the export section instead, so they don't depend on the viewer's theme.

**Text.** Always create text with `T(cls, x, y, string, font, anchor)`. It escapes the string and, in exports, pins the text to its measured width so it can't overflow on a machine with different fonts. Widths come from `tw(string, font)`; the fonts are the `FT` table and are system fonts on purpose.

### Lines

`geom(edge)` returns `{pA, pB, H, pts, path, uA, uB}`: end points, the middle point (the drag handle), the line as a list of points, the SVG path and a unit direction at each end for markers.

- An edge the user hasn't bent gets **ports**: `assignPorts()` picks a side of each box, spreads the lines along it, and `routedGeom()` draws elbow, curved or straight per `M.lineStyle`.
- **Going around boxes.** `assignPorts()` first tries the sides that face each other. If that route would pass through another box (`crossings()`), it tries all 16 pairs of sides and keeps the one through the fewest boxes, then the shortest. `elbowPts()` turns a pair of sides into a route: opposite sides meet in the middle, the same side on both boxes makes a U around the outside, and one upright plus one flat side makes an L. Straight lines skip this, since they can't bend round anything.
- An edge with a `bend`, or a self-loop, is a quadratic curve through `H`. It has no `pts`.

**Labels.** `renderInner()` places labels one at a time. Labels that can't move (bent lines, self-loops) go first. Every other label goes through `labelSpot()`: it starts at the middle and, if that covers a box or an earlier label, slides along the line (`pts`), then tries just beside it, and keeps the spot that covers the least area. Dragging a label still bends the line and pins the label where it is dropped.

## Hit testing and gestures

Every clickable SVG element has a `data-hit` attribute:

| `data-hit` | Element |
| --- | --- |
| `node:<id>` | a node's body |
| `title:<id>` | an ER/class header or a group's title bar |
| `attr:<id>:<i>` | an ER column row |
| `mem:<id>:<i>` | a class member row |
| `rel:<edgeIndex>` | a line (wide invisible hit path) or a sequence row |
| `label:<edgeIndex>` | a line's label or drag handle |
| `end:<edgeIndex>:a` / `:b` | the end dots of a sequence message |
| `bg` | empty canvas |

One `pointerdown` handler (the "pointer interaction" section) reads `data-hit` and starts a gesture by setting `drag = {mode, ...}`. `pointermove` continues it; `endDrag()` finishes it, records undo and saves.

Double-clicks are detected by hand (two `pointerdown`s on the same target within 420 ms), because the native `dblclick` event is unreliable once the pointer is captured. `onDouble()` handles them.

In-place text editing uses one floating `<input id="inline">`, positioned over the SVG element by `edit(key, value, commit)`.

## The side panel

`inspector()` rebuilds the panel's HTML for the current selection: nothing selected, a node, or an edge, with a branch per diagram kind.

Two rules:

- **Structural changes** (buttons, dropdowns) go through `mutate()`, which rebuilds the panel.
- **Text fields** are bound with `live(element, apply)`. It updates the model and redraws on every keystroke but does **not** rebuild the panel, which would destroy the field being typed in. It records one undo step when the field loses focus.

`readonlyPanel()` is the share-link version; `walkPanel()` and `seqWalkPanel()` are shown during a walkthrough; `viewEditor()` is the panel for Mermaid-drawn types.

## Layout

| Function | Used for |
| --- | --- |
| `layered()` | Tidy, and the first layout of a file without saved positions. Despite the name it runs whichever arrangement is picked |
| `layerUnits()` | The **Layered** arrangement: ranks, then ordering to reduce crossings |
| `forceUnits()` | The **Organic** arrangement: force-directed |
| `gridUnits()` | The **Grid** arrangement: even rows, most connected first |
| `layoutGroups()` | Group boxes, every draw |
| `seqLayout()` | Sequence diagrams, every draw |

`layered()` works inside-out through `layoutScope(groupId)`: lay out the contents of the innermost groups, then treat each group as one block in its parent. The ranking and ordering are in `layerUnits()`. For ER, `flowDir()` orients each relationship from the "one" side to the "many" side so parents sit above children.

Parts of a diagram with no connection between them are laid out separately and packed together by `packBoxes()`, so they can't drift apart.

### Tidy options

The arrow next to Tidy opens the Tidy menu. Its choices live in `TIDY`, saved in the browser's localStorage under `untangle-tidy` (they are a viewer preference, not part of the file):

| Option | Values | Effect |
| --- | --- | --- |
| `style` | `layered`, `organic`, `grid` | `arrangeUnits()` calls `layerUnits()`, `forceUnits()` or `gridUnits()` |
| `dir` | `TD`, `LR` | ER only (`tidyHoriz()`). Other kinds use the diagram's own direction, so the menu changes `M.dir`, which also changes the Mermaid code |
| `space` | `compact`, `normal`, `roomy` | `tidySpace()` returns a factor (0.75, 1, 1.5) that scales every gap |

All three arrangements take the same input, boxes `[{w, h}]` and connections `[[i, j]]`, and return top-left corners. That means they all work inside groups, through `layoutScope()`. A new arrangement only needs a function with that signature and a line in `arrangeUnits()`, plus a button in `#tidy-menu` in `editor.html`.

### Line breaks in labels (`<br>`)

Mermaid uses `<br>`, `<br/>` or `<br />` for a line break inside a label. The model keeps labels **exactly as written**, so a file round-trips unchanged. Only measuring and drawing treat the tag as a break:

- `tw()` measures the widest line, `wrapText()` breaks at each tag before wrapping words, and `T()` draws one `<text>` per line.
- In the side panel, `brToNl()` shows the tags as new lines and `nlToBr()` turns new lines back into `<br>`.
- Where a label must fit on one line (panel headings, walkthrough choices, drop-down menus), use `oneLine()`.

When you add a place that shows a label, use these helpers rather than the raw text.

## Mermaid-drawn types

`M.src` is the source of truth. Three ways to change it, all in the "editing for every other diagram type" section:

- **Tables.** `VSPEC` describes, per type, how to recognise a data line and turn it into cells and back.
- **Outline.** Every line as an input with indent, move, add and delete buttons.
- **Double-click on the drawing.** `viewTextEdit()` finds the clicked words in `M.src` and replaces them.

`setSrcLive()` is for typing (debounced redraw); `structSrc()` is for adding, deleting or moving lines.

## Export

`buildExport(bg)` returns `{w, h, text}` with the SVG as a string, for our renderer or Mermaid's. `toPNG()` draws that onto a canvas at 1×, 2× or 4×. The same function makes the dashboard thumbnail (`makeThumb`).

## Modes and saving

`MODE` is `edit`, `local`, `share` or `demo` (see [ARCHITECTURE.md](ARCHITECTURE.md)). `READONLY` is true for share links; `SAVES` is true for edit and local. The "app glue" section at the end holds `api()`, `appSave()`, `flush()`, the share and history dialogs and `boot()`.

## Debugging tips

- The file is served unminified. Open DevTools → Sources → `js/editor.js` and set breakpoints.
- Everything is inside one function, so variables like `M` aren't reachable from the console. Pause on a breakpoint (for example in `draw`) and inspect them there.
- If a diagram draws wrongly, open the **Mermaid code** tab: it shows exactly what `toMermaid()` produces. Paste it into **Mermaid view** to see whether Mermaid agrees.
- If the side panel loses focus while typing, something is calling `inspector()` or `mutate()` on each keystroke. Use `live()`.
- If undo loses a field, it is missing from `snapshot()`.
