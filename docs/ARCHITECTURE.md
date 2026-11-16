# Architecture

How Untangle is put together. Read this first; then [EDITOR.md](EDITOR.md) for the editor's internals and [HOW-TO.md](HOW-TO.md) for step-by-step recipes.

## The big picture

Untangle is one editor served in two ways.

| | Web app | Local mode |
| --- | --- | --- |
| Started with | `npm start` | `untangled` command (`bin/untangle.js`) |
| Server code | `server/index.js` → `server/app.js` | `server/local.js` |
| Diagrams are stored in | SQLite (`data/untangle.db`) | `.mmd` / `.mermaid` files in a folder |
| Accounts, sharing, history | Yes | No (Git is the history) |
| Listens on | Any address, behind an HTTPS proxy | `127.0.0.1` only |

Both serve the same `public/` folder and the same editor script. Local mode implements the same `/api/diagrams` routes as the web app, but on top of files, so the editor barely knows the difference.

There is no build step and no front-end framework. The browser runs the files in `public/` exactly as they are in the repository. The server is Express with no template engine.

```
Browser                                Server
───────                                ──────
public/*.html  ── page request ──────▶ app.js "pages" section (or local.js)
public/js/*.js ── fetch /api/... ────▶ app.js "API" section ──▶ db.js (SQLite)
                                       local.js ──────────────▶ files on disk
public/js/editor.js ── loads ────────▶ /vendor/mermaid.min.js (from node_modules/mermaid)
```

## Folder map

```
server/
  index.js    Web app entry point: reads settings, checks them, starts listening
  app.js      Web app: middleware, every API route, every page route (createApp)
  auth.js     Password hashing, tokens, cookie parsing, in-memory rate limiter
  db.js       SQLite schema and numbered migrations
  mail.js     SMTP email (password reset)
  local.js    Local mode: the diagrams API backed by files (createLocalApp)
bin/
  untangle.js The `untangled` command: argument parsing, then starts local.js
public/
  index.html  Landing page                  js/landing.js
  signup / login / forgot / reset .html     js/auth.js   (one script, four forms)
  app.html    Dashboard                     js/dashboard.js
  account.html                              js/account.js
  local.html  File list in local mode       js/local.js
  editor.html The editor, in four modes     js/editor.js  (the bulk of the project)
  privacy.html, terms.html, 404.html, 500.html, robots.txt
  js/api.js       fetch wrapper shared by the page scripts
  js/templates.js Starter diagrams
  css/site.css    Styles for every page except the editor
  css/fonts.css, fonts/   Bundled fonts
scripts/
  backup.js   Database backup (npm run backup)
test/
  api.test.js    Web app API tests
  local.test.js  Local mode API tests
  e2e/smoke.cjs  Browser test of the main flows
docs/          These guides
```

## The four editor modes

`public/editor.html` is served at four kinds of address. `editor.js` picks its mode from the address (the `MODE` constant at the top of the file).

| Address | Mode | Loads from | Saves to |
| --- | --- | --- | --- |
| `/d/<id>` | `edit` | `GET /api/diagrams/<id>` | `PUT /api/diagrams/<id>` |
| `/f/<path>` | `local` | same route, served by `local.js` | the file on disk |
| `/s/<token>` | `share` | `GET /api/share/<token>` | nothing (read-only) |
| `/demo` | `demo` | a template, or the browser's localStorage | localStorage |

## How a diagram is stored

A diagram is **Mermaid text and nothing else**. Everything Untangle adds lives in `%%` comment lines at the end, which Mermaid ignores:

```
erDiagram
    CUSTOMER ||--o{ ORDER : places
    CUSTOMER {
        uuid id PK
    }
%% Layout saved by Untangle. Mermaid ignores these lines.
%% lines: curved
%% layout: CUSTOMER 60 60
%% layout: ORDER 60 300
%% bend: CUSTOMER ORDER 40 0
%% note: ORDER status is one of placed, accepted, delivered
```

- `%% layout: KEY X Y` is a node's position.
- `%% bend: KEY_A KEY_B DX DY` is how far a line's handle was dragged from the straight midpoint.
- `%% note: KEY text` is a note on a node (ER and flowcharts; class and state diagrams use Mermaid's own note syntax).
- `%% lines: elbow|curved|straight` is the line style, written only when it isn't the default.

This is the reason the same file works in the web app, in local mode, on GitHub and in any other Mermaid tool. It also means the database column `diagrams.source` and a `.mmd` file on disk hold exactly the same thing.

**The round trip is lossy for hand-written files.** Saving regenerates the text from the editor's model. Comment and front-matter lines above the diagram keyword are kept (`preambleOf` in editor.js). Comments inside the diagram, styling lines (`classDef`, `style`, `click`) and the original line order are not. Local mode warns about this before the first edit (`lossOf`).

## Request flow in the web app (`server/app.js`)

`createApp({ db, mailer, appUrl, ... })` builds the Express app. Middleware runs in this order, and the order matters:

1. **Request log** (optional): one JSON line per request.
2. **`/healthz`**: answers before anything else, so monitors don't need a session.
3. **gzip**.
4. **Security headers**: Content-Security-Policy (only this site's own scripts, styles, fonts and images), no framing, HSTS in production, `noindex` on private pages.
5. **Session**: reads the `ut_session` cookie and sets `req.user` (or `null`).
6. **`/api` router**: rate limit → JSON body parser → the custom-header check → the routes.
7. **Pages**: `/`, `/app`, `/d/:id` and so on, each sending a file from `public/`.
8. **Static files**, then the 404 page, then the error handler.

The top of `app.js` lists every API route.

### Conventions in app.js

- Route handlers are wrapped in `wrap()`, so a thrown error reaches the error handler.
- `fail(status, message)` throws an `HttpError`. The message of a 4xx error is shown to the user unchanged, so write it for them.
- `needUser(req)` requires a login. `ownDiagram(req)` loads a diagram and checks it belongs to the user.
- A diagram that isn't yours answers **404, not 403**, so ids can't be probed.
- All SQL is in the `q` object as prepared statements.

## Database (`server/db.js`)

One SQLite file, opened with Node's built-in `node:sqlite`. Times are milliseconds since 1970.

| Table | Purpose |
| --- | --- |
| `users` | `id`, `email` (unique, lower-case), `name`, `pw_hash`, `created_at` |
| `sessions` | `token_hash`, `user_id`, `expires_at`. One row per logged-in browser |
| `diagrams` | `id`, `user_id`, `title`, `kind`, `source`, `thumb` (SVG preview), `share_token`, `created_at`, `updated_at` |
| `versions` | `diagram_id`, `source`, `created_at`. The newest 50 per diagram |
| `password_resets` | `token_hash`, `user_id`, `expires_at` |

Deleting a user deletes their sessions, diagrams, versions and reset tokens (`ON DELETE CASCADE`).

New tables go in the `CREATE TABLE IF NOT EXISTS` block. Changes to existing tables go in the `MIGRATIONS` list, which runs each entry once per database. See "Change the database" in [HOW-TO.md](HOW-TO.md).

## Security model

| Concern | How it's handled | Where |
| --- | --- | --- |
| Passwords | scrypt with a random salt; the cost is stored with each hash | `auth.js` |
| Sessions | Random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only its SHA-256 is stored | `auth.js`, `startSession` in `app.js` |
| Cross-site requests (CSRF) | Every non-GET API call must carry `X-Requested-With: untangle`. Browsers won't let another site send a custom header without permission the server never gives | `app.js` API router |
| Script injection (XSS) | Content-Security-Policy allows only this site's scripts. Page scripts escape user text with `esc()`. Preview SVGs are served with a sandboxing policy | `app.js`, `esc` in page scripts |
| Guessing ids | Ids and share tokens are random; other people's diagrams answer 404 | `ownDiagram` |
| Brute force | Rate limits on login (per IP and email), sign-up, password reset and the API as a whole | `rateLimiter` in `auth.js` |
| Password reset | Token works once, expires in 1 hour, logs out every session. The reply never says whether an email has an account. Links use `APP_URL`, never the request's Host header | `/auth/forgot`, `/auth/reset` |
| Local mode | Answers only on `localhost` (Host header check), same custom-header rule, only `.mmd`/`.mermaid` files inside the folder, links leading outside are refused | `resolveFile` in `local.js` |

## Saving and conflicts

The editor saves by itself. The logic is in the "app glue" section at the end of `editor.js`.

1. Any edit calls `appSave()`, which sets `dirty = true` and schedules `flush()` 0.9 seconds later.
2. `flush()` sends `PUT /api/diagrams/<id>` with the Mermaid text and `baseUpdatedAt`, the `updatedAt` the editor last saw.
3. The server compares `baseUpdatedAt` with the stored value. If someone else saved in between it answers **409** and changes nothing. The editor then shows "Load the latest version" or "Keep my version"; the latter saves again without `baseUpdatedAt`.
4. Local mode does the same with the file's modification time, which is how a `git pull` under an open editor is caught.

Nothing is saved until `dirty` is true, so opening a diagram never changes it. A preview image sent on its own does not change `updated_at`.

## Versions

`addVersion` in `app.js`. Saves within 5 minutes of the last version overwrite that version, so a typing session doesn't create hundreds. A forced save (creating, restoring, "Keep my version") always starts a new one. Only the newest 50 per diagram are kept.

## Settings

Environment variables, read in `server/index.js` and documented in the README and `.env.example`. `index.js` refuses to start in production when `APP_URL` is missing or not https.

## Known limits and debts

Worth knowing before you plan bigger changes.

- **`editor.js` is one long file with long lines.** It works and is commented, but it would be easier to change if it were formatted with Prettier and split into ES modules (parsers, layout, rendering, inspector, app glue). Do that as its own change with no behaviour changes, and run both test suites after.
- **Single instance only.** SQLite, the rate limiter and the session lookups all assume one process. Scaling out needs a shared database (Postgres) and a shared rate limiter.
- **`node:sqlite` is marked experimental** in Node 22. It has been stable in practice, but re-run the tests when upgrading Node.
- **Lines don't route around boxes.** `assignPorts` spreads connection points and staggers elbow segments, but a long line can still pass behind an unrelated box.
- **Hand-written files lose inner comments and styling on save** (see "How a diagram is stored").
- **No email verification** at sign-up, and an account's email can't be changed.
