# How-to recipes

Step-by-step instructions for the changes you're most likely to make. Read [ARCHITECTURE.md](ARCHITECTURE.md) first, and [EDITOR.md](EDITOR.md) before touching `public/js/editor.js`.

After any change, run both test suites:

```bash
npm test
```

```bash
npm run test:e2e
```

## Contents

1. [Daily commands](#1-daily-commands)
2. [Add a starter template](#2-add-a-starter-template)
3. [Give a Mermaid-drawn type a table editor](#3-give-a-mermaid-drawn-type-a-table-editor)
4. [Add a flowchart node shape](#4-add-a-flowchart-node-shape)
5. [Add a field to nodes or edges](#5-add-a-field-to-nodes-or-edges)
6. [Make a new diagram type editable on the canvas](#6-make-a-new-diagram-type-editable-on-the-canvas)
7. [Add an API route](#7-add-an-api-route)
8. [Change the database](#8-change-the-database)
9. [Add a page](#9-add-a-page)
10. [Add a setting](#10-add-a-setting)
11. [Send another kind of email](#11-send-another-kind-of-email)
12. [Upgrade Mermaid and other dependencies](#12-upgrade-mermaid-and-other-dependencies)
13. [Write tests](#13-write-tests)
14. [Release and deploy](#14-release-and-deploy)
15. [Troubleshooting](#15-troubleshooting)

## 1. Daily commands

| Command | What it does |
| --- | --- |
| `npm install` | Installs dependencies (once, and after pulling changes to `package.json`) |
| `npm run dev` | Runs the web app at http://localhost:3000 and restarts it when server files change |
| `npm run local` | Runs local mode on this folder's `.mmd` files and Markdown diagrams (add a path: `npm run local -- docs/x.mmd` or `-- README.md`) |
| `npm test` | API tests for the web app and local mode |
| `npm run test:e2e` | Browser test. Needs Playwright once: `npm install --no-save playwright && npx playwright install chromium` |
| `npm run backup` | Backs up the database |

Files in `public/` are served as they are, with no build. After editing one, reload the browser page. `npm run dev` only needs to restart for files in `server/`.

In development, password reset emails aren't sent: the link is printed in the terminal where the server runs.

## 2. Add a starter template

Templates are in `public/js/templates.js`.

1. Append an entry to `window.UNTANGLE_TEMPLATES`:

   ```js
   {id:"deploy", title:"Deploy pipeline", kind:"Flowchart", desc:"Build, test and release steps.",
    source:"flowchart LR\n    build[Build] --> test[Test]\n    test --> release([Release])"},
   ```

   `id` must be unique (it's used in `/demo?t=deploy`). `kind` is only a label. `source` is Mermaid text with `\n` for line breaks.
2. Run `npm run test:e2e`. The step "every template opens, draws, and its code is valid Mermaid" picks up the new entry automatically.

It appears in the dashboard's New diagram dialog, in local mode's, and in the demo's sample menu.

## 3. Give a Mermaid-drawn type a table editor

Types drawn by Mermaid (`M.kind === "view"`) always get the outline editor. A type whose data is one item per line can also get a table by adding an entry to `VSPEC` in `editor.js` (section "editing for every other diagram type").

Example: packet diagrams, whose lines look like `0-15: "Source Port"`.

```js
"packet-beta":{name:"Fields",cols:["Bits","Label"],
  re:/^(\s*)(\d+(?:-\d+)?)\s*:\s*"([^"]*)"\s*$/,
  get:m=>[m[2],m[3]],
  make:(c,ind)=>`${ind||"    "}${c[0].replace(/[^\d-]/g,"")}: "${c[1].replace(/"/g,"'")}"`,
  blank:["0-7","New field"]},
```

- The key is the diagram keyword exactly as written in the file.
- `re` matches one data line. **Its first group must be the indentation**, so edits keep it.
- `get(match)` returns the cell values; `make(cells, indentation)` builds the line back. Clean the cells in `make` so a stray quote or colon can't break the syntax.
- `blank` is the row added by the "Add" button.
- If the type has a `title` line, add its keyword to the `TITLED` list to get a title field.

Check that `re` doesn't also match non-data lines (titles, sections, settings). The Gantt entry shows how to exclude keywords with a negative lookahead.

## 4. Add a flowchart node shape

Example: hexagon, written `id{{text}}` in Mermaid. All in `editor.js`.

1. **Name it.** Add `hex:"Hexagon"` to `SHAPES` and `hex:["{{","}}"]` to `WRAP` (how it's written back).
2. **Parse it.** Add an alternative to `NODE_RE` and its group number to the map in `parseFlow`'s `def()`. Put `\{\{([^}]*)\}\}` **before** the plain `\{([^}]*)\}` alternative, or `{{` will be read as a diamond. Adding a group shifts the later group numbers, so update the map (`{3:"sub", 4:"stadium", ...}`) and the list of indexes it scans.
3. **Size it.** Add a branch in `measure()` if it needs more room than a rectangle.
4. **Draw it.** In `renderInner()`, in the flowchart branch, add the SVG for the shape. Give the element `class="fn-shape hex"` and `data-hit="node:${n.id}"` so it's selectable and styled.
5. **Attach lines.** If the outline isn't a rectangle, add a case to `border()`, and add the shape to `POINTY` if lines should all meet at the middle of a side.
6. Add a node of the new shape to a template so the browser test covers the round trip.

## 5. Add a field to nodes or edges

Example: a colour on flowchart nodes.

| Step | Where |
| --- | --- |
| Decide how it's stored in the Mermaid text. If Mermaid has no syntax for it, add a `%%` comment and read it in `parseMeta` | `parseMeta`, the parser |
| Carry it from the parser's output onto the node | the `nodes = P.nodes.map(...)` line in `buildModel` |
| **Include it in `snapshot()`**, or undo will lose it | `snapshot` |
| Write it back | the writer (`flowBody` etc.) or the end of `toMermaidBody` |
| Use it when drawing. For colours, put rules in `SVG_CSS` so exports get them | `renderInner`, `SVG_CSS` |
| Let the user change it | the matching branch of `inspector()`; use `mutate()` for dropdowns, `live()` for text |
| Default for newly added items | `addNode`, `connectClick` |

## 6. Make a new diagram type editable on the canvas

This is the biggest kind of change. The class-diagram support is the best model to copy: search `editor.js` for `"class"`.

Checklist, in the order to do it:

1. **Recognise it**: `detectKind()` returns a new kind for the keyword.
2. **Parse it**: write `parseX(src)` returning `{kind, dir, nodes, edges, meta, errors}`. Call `parseMeta` for comment lines. Return `unsupported: {word, line}` for syntax you won't handle, so those files open in the outline editor.
3. **Build it**: add it to the parser choice at the top of `buildModel`.
4. **Write it**: `xBody(L)` pushing Mermaid lines; call it from `toMermaidBody`.
5. **Measure and draw**: branches in `measure()` and `renderInner()`; markers for edge ends if needed.
6. **Edit it**: node, edge and nothing-selected branches in `inspector()`; defaults in `addNode()` and `connectClick()`; double-click behaviour in `onDouble()`.
7. **Label it**: `kindUI()` (toolbar and hint), `readonlyPanel()`, `fileBase()`, the "Loaded N ..." message in `applySource()`.
8. **Lay it out**: make sure `tidy()` and `layoutInto()` do something sensible.
9. **Undo**: add new model fields to `snapshot()`.
10. **Lists outside the editor**: `detectKind` in `server/app.js` (the stored `kind`) and the `KIND` label maps in `public/js/dashboard.js` and `public/js/local.js`.
11. **Template and tests**: add a template; the browser test then checks that Mermaid accepts what you write back.

Sequence diagrams took the other route (their own renderer and pointer handling) because their layout is an ordered list, not free positions. Prefer the shared path unless the type really doesn't fit boxes and lines.

## 7. Add an API route

Example: let a user star a diagram.

1. **Database**: add the column with a migration (next recipe).
2. **Query**: add a prepared statement to the `q` object in `server/app.js`:

   ```js
   setStar: db.prepare("UPDATE diagrams SET starred = ? WHERE id = ?"),
   ```

3. **Route**: add it in the API section, before the final `api.use(...404...)` line:

   ```js
   api.post("/diagrams/:id/star", wrap((req, res) => {
     const d = ownDiagram(req);            // 401 if logged out, 404 if not theirs
     q.setStar.run(req.body.starred ? 1 : 0, d.id);
     res.json({ ok: true });
   }));
   ```

4. **List it** in the route table in the comment at the top of `app.js`.
5. **Call it** from the page script with the shared helper:

   ```js
   await api(`/api/diagrams/${id}/star`, { method: "POST", body: { starred: true } });
   ```

   The helper adds the `X-Requested-With` header that every non-GET call needs.
6. **Test it** in `test/api.test.js`: the happy path, logged out (401), and someone else's diagram (404).

Use `fail(400, "A sentence for the user.")` for bad input. If the editor should work with the route in local mode too, add the same route to `server/local.js`.

## 8. Change the database

**A new table or index**: add it to the `CREATE TABLE IF NOT EXISTS` block in `server/db.js`. It's created on the next start.

**A change to an existing table** (new column, renamed column): append one SQL string to `MIGRATIONS` in `server/db.js`:

```js
export const MIGRATIONS = [
  "ALTER TABLE diagrams ADD COLUMN starred INTEGER NOT NULL DEFAULT 0",
];
```

Rules:

- **Append only.** Never edit, delete or reorder an entry once it has been deployed: each database remembers how many entries it has run, by position.
- One entry runs in one transaction. If it fails, nothing changes and the app refuses to start, with the error in the log.
- New columns on existing rows need a `DEFAULT` or must allow `NULL`.
- For a brand-new database, the `CREATE TABLE` block runs first and then every migration. So **don't** also add the new column to the `CREATE TABLE` statement, or the migration will fail with "duplicate column".
- Take a backup before deploying a migration: `npm run backup`.

## 9. Add a page

1. Create `public/thing.html`. Copy the `<head>` of an existing page (`account.html` is a good base) so it gets the fonts, `site.css` and the icon.
2. Put its script in `public/js/thing.js` and load it with `<script type="module" src="/js/thing.js"></script>`. Inline scripts are blocked by the Content-Security-Policy.
3. Add the route in the pages section of `server/app.js`, using `page("thing.html")`, `loggedIn(...)` or `loggedOut(...)`.
4. If it's private, add its path to `PRIVATE_PATHS` (keeps it out of search engines) and to `public/robots.txt`.
5. Add it to the list of pages checked in `test/api.test.js` ("pages: ...").

Always put user-provided text into HTML through `esc()` (from `/js/api.js`) or `textContent`.

## 10. Add a setting

1. Read it in `server/index.js` from `process.env`.
2. If a wrong value would break production, add a check to the `problems` list there.
3. Pass it to `createApp({ ... })` and add it to that function's parameters and doc comment in `app.js`. Don't read `process.env` inside `app.js`: the tests configure the app through parameters.
4. Document it in the README settings table and in `.env.example`.

## 11. Send another kind of email

Call `mailer.send({ to, subject, text })` inside a route in `app.js` (see `/auth/forgot`). Build links from `appUrl`, never from the request's Host header. Wrap the call in `try/catch` so a mail outage doesn't fail the request, unless the email is the whole point. In tests, the fake mailer collects messages in the `sent` array.

## 12. Upgrade Mermaid and other dependencies

```bash
npm outdated
```

```bash
npm install mermaid@latest
```

Then run both test suites. The browser test opens every template and eight less common types, so a Mermaid release that changes syntax or output shows up there. If a type breaks:

- An **error in Mermaid view of an editable type** means Mermaid no longer accepts what a writer (`flowBody`, `classBody`...) produces. Fix the writer.
- **"Mermaid returned no drawing"** means the SVG couldn't be read; see `mermaidSVG()`.

Check for security advisories with `npm audit --omit=dev`, and apply safe fixes with `npm audit fix --omit=dev`. Re-run the tests afterwards.

## 13. Write tests

**API and unit tests** (`test/api.test.js`, `test/local.test.js`, `test/markdown.test.js`) use Node's built-in test runner.

```js
test("starring a diagram", async () => {
  const c = client();   // its own cookie jar = its own logged-in user
  await c("POST", "/api/auth/signup", { name: "A", email: "a-star@example.com", password: "long enough pw" });
  const { diagram } = (await c("POST", "/api/diagrams", { title: "T", source: FLOW })).body;
  const r = await c("POST", `/api/diagrams/${diagram.id}/star`, { starred: true });
  assert.equal(r.status, 200);
});
```

All tests in a file share one in-memory database, so give each test its own email addresses. Sign-ups are rate limited to 20 per hour per address, and the tests all come from one address; if a new test's sign-up fails with 429, reuse an account inside that test.

**Browser test** (`test/e2e/smoke.cjs`): add a `step("what the user can do", async () => { ... })`. Steps run in order and share one browser page and one account. Helpers: `api(method, url, body)` calls the API as the logged-in user, `saved()` waits for "All changes saved". The last step fails if any page logged a script error or requested another website.

Test what a user would notice (the file on disk changed, the title is on the dashboard) rather than internal state.

## 14. Release and deploy

1. `npm test` and `npm run test:e2e` pass.
2. Bump `version` in `package.json` if you publish the package.
3. Commit and push. GitHub Actions (`.github/workflows/ci.yml`) runs both suites.
4. On the server, back up first: `npm run backup` (or your scheduled job).
5. Deploy: `git pull && docker compose up -d --build`, or let your platform redeploy from the repository.
6. Check `/healthz`, log in, open a diagram, and save a change.

Database migrations run by themselves on start. To roll back a release that included a migration, restore the backup from step 4 along with the old code.

## 15. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "Untangle can't start: APP_URL is required..." | Production needs `APP_URL` set to the public https address |
| Logging in works locally but not on the server | `NODE_ENV=production` makes cookies HTTPS-only. The site must be served over HTTPS, behind exactly one proxy |
| Every visitor seems to share a rate limit | The app isn't seeing real client addresses. It trusts one proxy hop (`trust proxy` in `app.js`); adjust if your host adds more |
| Password reset emails don't arrive | `SMTP_URL` / `EMAIL_FROM` missing or wrong; the server log has a `[mail]` line. The sender address must be verified with your email provider |
| "Database migration N failed" on start | The SQL in `MIGRATIONS[N-1]` is wrong, or the column already exists. Nothing was changed; fix the entry (only if it never shipped) and restart |
| A browser shows an old version of the editor | Scripts are served with `no-cache`, so a normal reload should fetch them. Check a proxy or CDN in front isn't overriding the header |
| A script or style is blocked in the browser console | The Content-Security-Policy in `app.js` only allows files from this site. Host the file in `public/` rather than loading it from elsewhere |
| A diagram opens in the outline editor instead of the canvas | The file uses syntax the parser doesn't support; the side panel names the line. See `unsupported` in `parseSeq` / `parseState` |
| Saving a hand-written file removed comments | Expected: see "How a diagram is stored" in ARCHITECTURE.md |
| `npm run test:e2e` says Playwright is not installed | `npm install --no-save playwright && npx playwright install chromium` |
