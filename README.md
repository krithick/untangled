# Untangle

Untangle turns Mermaid diagrams into something you can move, edit, walk through and share, and gives you clean Mermaid code back.

- **Edit by dragging:** flowcharts (with subgraphs), sequence diagrams (with loop/alt/opt/par blocks and activations), class diagrams (with namespaces and every UML relationship), state diagrams (with composite states, choice, fork and join) and ER diagrams.
- **Edit every other type:** Gantt, pie, timeline, journey, quadrant and Sankey charts get table editors; mindmaps, Git graphs, C4, kanban, block, requirement and the rest get a line-by-line outline editor. Double-click any text on the drawing to change it; the code tab redraws as you type.
- **Big diagrams:** Tidy packs separate parts together, with elbow, curved or straight lines; minimap, Find (press `/`), click a code line to jump to it, focus mode and full screen.
- **Walkthrough:** step through a flowchart or state diagram one decision at a time, or play a sequence diagram message by message.
- **Accounts and a dashboard:** sign up, password reset by email, search, rename, duplicate, delete, upload `.mmd` files.
- **Auto-save and version history:** a version every few minutes (last 50), restorable. A second tab or device is warned before it can overwrite newer work.
- **Share links:** a view-only link anyone can open, step through and export.
- **Export:** PNG at 1×, 2× or 4×, SVG, light, dark or transparent, Markdown, or plain Mermaid. Account settings can download every diagram at once.
- **Try without an account:** `/demo`; work stays in that browser.

Layout, line bends and notes are stored as `%%` comments at the end of the Mermaid code. Mermaid ignores them, so the code still renders on GitHub, GitLab and Notion.

## Run it locally

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

## How it's built

```
server/
  index.js   reads settings, starts the server
  app.js     routes: pages, JSON API, security headers, rate limits
  auth.js    password hashing (scrypt), sessions, rate limiter
  mail.js    email through SMTP
  db.js      SQLite schema (users, sessions, diagrams, versions, password_resets)
public/
  index.html landing            app.html      dashboard
  login / signup / forgot / reset             account.html
  privacy.html, terms.html      editor.html   editor, share view and demo
  js/editor.js   the diagram editor (parsers, layout, rendering, export)
  js/templates.js starter diagrams
  fonts/         bundled fonts (no third-party requests)
scripts/backup.js  database backup
test/api.test.js   API tests        test/e2e/smoke.cjs   browser test
```

Security: passwords are hashed with scrypt; sessions are random tokens stored hashed, in HttpOnly SameSite=Lax cookies; every API write needs a custom header, which blocks cross-site requests; logins, sign-ups, password resets and the API as a whole are rate limited; reset links work once, expire in 1 hour and log out every other session; pages send a strict Content-Security-Policy with no third-party hosts; preview images are served sandboxed.

## Not built yet

- Email verification at sign-up, and changing an account's email address
- Real-time collaboration and comments; teams, billing and plans
- Embeds for Notion, Confluence and GitHub READMEs
- Lines that route around boxes in very dense diagrams
- Canvas editing for sequence `box` groups and `create`/`destroy`, and state concurrency regions (`--`); these open in the outline editor
- Running more than one server instance (needs a shared database and rate limiter)
