# Untangle

Untangle turns Mermaid diagrams into something you can move, edit, walk through and share, and gives you clean Mermaid code back.

- **Edit by dragging:** flowcharts (with subgraphs), sequence diagrams (with loop/alt/opt/par blocks and activations), class diagrams (with namespaces and every UML relationship), state diagrams (with composite states, choice, fork and join) and ER diagrams. Move boxes, bend lines, reorder messages, edit text in place.
- **Edit every other type:** Gantt, pie, timeline, journey, quadrant and Sankey charts get table editors; mindmaps, Git graphs, C4, kanban, block, requirement and the rest get a line-by-line outline editor. Double-click any text on the drawing to change it, and the code tab redraws as you type.
- **Walkthrough:** step through a flowchart one decision at a time, or play a sequence diagram message by message.
- **Accounts and a dashboard:** sign up, keep all your diagrams, search, rename, duplicate, delete, upload `.mmd` files (or drop them on the page).
- **Auto-save and version history:** changes save as you work; a version is kept every few minutes (last 50), and any version can be restored.
- **Share links:** a view-only link anyone can open, step through and export. Signed-in viewers can copy it into their own account.
- **Export:** PNG at 1×, 2× or 4×, SVG, light, dark or transparent background, Markdown, or plain Mermaid.
- **Try without an account:** `/demo` opens the editor with sample diagrams; work stays in that browser.

Layout, line bends and notes are stored as `%%` comments at the end of the Mermaid code. Mermaid ignores them, so the code still renders on GitHub, GitLab and Notion.

## Run it locally

Needs Node.js 22.13 or newer (it uses Node's built-in SQLite, so there is no database to install).

```bash
npm install
npm start
```

Open http://localhost:3000. Data is stored in `data/untangle.db`.

For development with auto-restart: `npm run dev`. Run the tests: `npm test`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port the server listens on |
| `DATA_DIR` | `./data` | Folder for the SQLite database |
| `NODE_ENV` | (unset) | Set to `production` to send session cookies over HTTPS only |

## Deploy

The app is one Node process plus one SQLite file, so any host with a persistent disk works (Render, Railway, Fly.io, a VPS).

```bash
docker build -t untangle .
docker run -p 3000:3000 -v untangle-data:/data untangle
```

Put it behind HTTPS in production (`NODE_ENV=production` marks cookies as secure). Back up the `/data` volume.

## How it's built

```
server/
  index.js   starts the server
  app.js     routes: pages, JSON API, security headers
  auth.js    password hashing (scrypt), sessions, rate limiting
  db.js      SQLite schema (users, sessions, diagrams, versions)
public/
  index.html landing page        app.html      dashboard
  login.html / signup.html       account.html  account settings
  editor.html editor, share view and demo (one page, three modes)
  js/editor.js   the diagram editor (parsers, layout, rendering, export)
  js/templates.js starter diagrams
test/api.test.js API tests (node:test)
```

Security notes: passwords are hashed with scrypt; sessions are random tokens stored hashed, in HttpOnly SameSite=Lax cookies; every API write needs a custom header, which blocks cross-site requests; logins are rate limited; pages send a strict Content-Security-Policy; uploaded preview images are served with a sandboxing policy so they can't run scripts.

## Not built yet

- Password reset by email (needs an email provider)
- Real-time collaboration and comments
- Teams, billing and plans
- Sequence diagram `box` groups and `create`/`destroy` (these open in the outline editor instead)
- State diagram concurrency regions (`--`), which also open in the outline editor
- Embeds for Notion, Confluence and GitHub READMEs
