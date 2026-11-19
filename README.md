# Untangle

Untangle turns Mermaid diagrams into something you can move, edit, walk through and share, and gives you clean Mermaid code back.

- **Edit by dragging:** flowcharts (with subgraphs), sequence diagrams (with loop/alt/opt/par blocks and activations), class diagrams (with namespaces and every UML relationship), state diagrams (with composite states, choice, fork and join) and ER diagrams.
- **Edit every other type:** Gantt, pie, timeline, journey, quadrant and Sankey charts get table editors; mindmaps, Git graphs, C4, kanban, block, requirement and the rest get a line-by-line outline editor. Double-click any text on the drawing to change it; the code tab redraws as you type.
- **Big diagrams:** Tidy arranges everything in layers, organically or in a grid, top to bottom or left to right, compact or roomy, and packs separate parts together; elbow, curved or straight lines; minimap, Find (press `/`), click a code line to jump to it, focus mode and full screen.
- **Walkthrough:** step through a flowchart or state diagram one decision at a time, or play a sequence diagram message by message.
- **Accounts and a dashboard:** sign up, password reset by email, search, rename, duplicate, delete, upload `.mmd` files.
- **Auto-save and version history:** a version every few minutes (last 50), restorable. A second tab or device is warned before it can overwrite newer work.
- **Share links:** a view-only link anyone can open, step through and export.
- **Export:** PNG at 1×, 2× or 4×, SVG, light, dark or transparent, Markdown, or plain Mermaid. Account settings can download every diagram at once.
- **Try without an account:** `/demo`; work stays in that browser.

Layout, line bends and notes are stored as `%%` comments at the end of the Mermaid code. Mermaid ignores them, so the code still renders on GitHub, GitLab and Notion.

## Use it on a Git repository (local mode)

Run Untangle inside any repository and it edits that repository's `.mmd` and `.mermaid` files, and the ```` ```mermaid ```` blocks in its Markdown files, in place. There are no accounts and no database: the files are the storage and Git is the history. Because nothing depends on the Git host, it works the same with GitHub, Bitbucket, GitLab or no host at all.

```bash
npx github:krithick/untangled                 # every diagram in this folder and below
```

```bash
npx github:krithick/untangled docs/erd.mmd    # one file (created if it doesn't exist)
```

```bash
npx github:krithick/untangled README.md       # the diagrams in a Markdown file
```

It opens in your browser at `http://localhost:4747`. Options: `--port 5000`, `--no-open`.

- Opening a file never changes it. The first edit saves it in Untangle's format: your layout goes into `%% layout:` comments at the end, comments above the diagram keyword are kept, and comments or styling lines inside the diagram are dropped (the editor warns you first).
- **Markdown files:** each ```` ```mermaid ```` block is listed as its own diagram, named after the heading above it. Saving rewrites only the lines inside that block; the rest of the file is left exactly as it was. The layout comments go inside the block, so GitHub and Bitbucket still draw it.
- If the file changes on disk while it's open (a `git pull`, another editor), Untangle asks before overwriting. In a Markdown file, changes outside the diagram's block aren't a conflict, and a block that moved because lines were added above it is found again.
- It only answers on `localhost`, and only reads and writes `.mmd`, `.mermaid` and Markdown files inside the folder you started it in.
- Needs Node.js 20 or newer.

## Run the web app locally

Needs Node.js 22.13 or newer. It uses Node's built-in SQLite, so there is no database to install.

```bash
npm install
npm start
```

Open http://localhost:3000. Data is stored in `data/untangle.db`. Without email settings, password reset links are printed in the server log.

- `npm run dev` restarts on changes.
- `npm test` runs the API tests.
- `npm run test:e2e` runs the browser test. It needs Playwright: `npm install --no-save playwright && npx playwright install chromium`.

## Settings

| Variable | Needed in production | Purpose |
| --- | --- | --- |
| `NODE_ENV=production` | Yes | HTTPS-only cookies and headers; stricter settings checks |
| `APP_URL` | Yes | Public address, e.g. `https://untangle.example.com`. Used in emailed links |
| `SMTP_URL` | For password reset | Any SMTP provider, e.g. `smtps://user:pass@smtp.example.com:465` |
| `EMAIL_FROM` | With `SMTP_URL` | Sender, e.g. `Untangle <hello@example.com>` |
| `CONTACT_EMAIL` | Recommended | Shown on the privacy and terms pages |
| `PORT` | No (3000) | Port the server listens on |
| `DATA_DIR` | No (`./data`) | Folder for the database; must be on a persistent disk |
| `LOG_REQUESTS=0` | No | Turns off the one-line-per-request log |

The app refuses to start in production if `APP_URL` is missing or not https.

## Deploy

Untangle is one Node process and one SQLite file. It needs a host with a **persistent disk** and **HTTPS**, and must run as a **single instance** (SQLite and the rate limits live in that one process).

**A server with Docker** (HTTPS is set up automatically by Caddy):

```bash
cp .env.example .env    # then fill it in
docker compose up -d --build
```

Point your domain's DNS at the server first. The app sits behind exactly one proxy, which is what its `trust proxy` setting expects.

**A platform such as Render, Railway or Fly.io:** deploy the `Dockerfile`, attach a disk mounted at `/data`, set the variables above, and use `/healthz` as the health check. Keep it to one instance.

The image runs as the container's default user so it can write to mounted disks on any host. To run it as a non-root user, add `--user node` and make the data volume writable by uid 1000.

## Backups

```bash
npm run backup
```

writes a checked copy of the database to `DATA_DIR/backups` and keeps the newest 14 (`KEEP=30` changes that). It is safe while the app is running. Run it daily (cron, or your platform's scheduled jobs) and copy the files off the server: a backup on the same disk doesn't survive losing the disk. To restore, stop the app, replace `untangle.db` with a backup file, delete `untangle.db-wal` and `untangle.db-shm` if present, and start the app.

## Launch checklist

- [ ] Domain pointing at the host, `APP_URL` set, site loads over HTTPS
- [ ] SMTP provider set up; request a password reset for your own account and check the email arrives
- [ ] `CONTACT_EMAIL` set; read `/privacy` and `/terms` and adjust them to your situation (they are plain-language drafts, not legal advice)
- [ ] Daily backup scheduled and copied off the server; do one test restore
- [ ] An uptime monitor watching `/healthz`
- [ ] `npm audit` reviewed (2 low-severity KaTeX advisories remain until Mermaid 12)

## Maintaining and extending

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, conventions, where to make a change
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit, storage format, database, security, known limits
- [docs/EDITOR.md](docs/EDITOR.md): the editor's data model, rendering, gestures and layout
- [docs/HOW-TO.md](docs/HOW-TO.md): recipes (add a template, a shape, a diagram type, an API route, a database change), upgrading, releasing, troubleshooting

## How it's built

```
server/
  index.js   reads settings, starts the server
  app.js     routes: pages, JSON API, security headers, rate limits
  auth.js    password hashing (scrypt), sessions, rate limiter
  mail.js    email through SMTP
  db.js      SQLite schema (users, sessions, diagrams, versions, password_resets)
  local.js   local mode: the same editor API backed by files in a folder
bin/untangle.js  the `untangled` command (local mode)
public/
  index.html landing            app.html      dashboard
  login / signup / forgot / reset             account.html
  privacy.html, terms.html      editor.html   editor, share view and demo
  js/editor.js   the diagram editor (parsers, layout, rendering, export)
  js/templates.js starter diagrams
  fonts/         bundled fonts (no third-party requests)
scripts/backup.js  database backup
test/api.test.js, test/local.test.js, test/markdown.test.js   API and unit tests   test/e2e/smoke.cjs   browser test
docs/              architecture, editor internals and how-to guides
```

Security: passwords are hashed with scrypt; sessions are random tokens stored hashed, in HttpOnly SameSite=Lax cookies; every API write needs a custom header, which blocks cross-site requests; logins, sign-ups, password resets and the API as a whole are rate limited; reset links work once, expire in 1 hour and log out every other session; pages send a strict Content-Security-Policy with no third-party hosts; preview images are served sandboxed.

## Not built yet

- A VS Code extension and a browser extension for GitHub and Bitbucket pages
- Email verification at sign-up, and changing an account's email address
- Real-time collaboration and comments; teams, billing and plans
- Embeds for Notion, Confluence and GitHub READMEs
- Full line routing for very dense diagrams (lines pick a route around boxes, but it isn't a full router)
- Markdown diagrams inside block quotes (`> ```mermaid`), and adding a new diagram to a Markdown file from Untangle
- Canvas editing for sequence `box` groups and `create`/`destroy`, and state concurrency regions (`--`); these open in the outline editor
- Running more than one server instance (needs a shared database and rate limiter)
