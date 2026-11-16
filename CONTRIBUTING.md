# Working on Untangle

## Start here

1. Install Node.js 22.13 or newer, then:

   ```bash
   npm install
   ```

   ```bash
   npm run dev
   ```

   The web app is at http://localhost:3000. Sign up with any email; in development, password reset links are printed in the terminal.
2. Read the guides in this order:
   - [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit, the database, the security model.
   - [docs/EDITOR.md](docs/EDITOR.md): how the editor script works.
   - [docs/HOW-TO.md](docs/HOW-TO.md): step-by-step recipes for common changes, and troubleshooting.
3. Each source file starts with a comment saying what it's for. `public/js/editor.js` starts with a description of its data model.

## Before you commit

```bash
npm test
```

```bash
npm run test:e2e
```

The browser test needs Playwright once: `npm install --no-save playwright && npx playwright install chromium`.

Both run on every push through GitHub Actions (`.github/workflows/ci.yml`).

## Conventions

- **No build step.** Files in `public/` run in the browser as written. Don't add a bundler or a framework without a strong reason; "edit a file, reload the page" is a feature.
- **Few dependencies.** The server uses Express, compression, nodemailer and Mermaid, and nothing else. Prefer Node's built-in modules.
- **No third-party requests.** Pages load everything from this site (fonts and Mermaid included). The Content-Security-Policy enforces it and the browser test checks it.
- **Messages are for users.** Error text passed to `fail()` on the server or shown by page scripts is read by people: say what happened and what to do, in plain words.
- **Escape user text.** Use `esc()` or `textContent` whenever user-provided text goes into the page.
- **Model changes go through `mutate()`** in the editor, so undo, saving and the code tab stay in step.
- **A diagram is Mermaid text.** Anything Untangle adds must be a `%%` comment Mermaid ignores, so files keep working everywhere else.
- **Tests describe behaviour a user would notice.** Add one with every feature and every bug fix.
- **Database changes are append-only migrations** (`MIGRATIONS` in `server/db.js`).

## Where to make a change

| I want to... | Look at |
| --- | --- |
| Change how a diagram type is parsed, drawn or edited | `public/js/editor.js` (see docs/EDITOR.md) |
| Add a template | `public/js/templates.js` |
| Add or change an API route | `server/app.js`, and `server/local.js` if local mode needs it |
| Change the database | `server/db.js` |
| Change sign-up, login or password rules | `server/app.js` (routes), `server/auth.js` (hashing, limits) |
| Change a page's look | `public/css/site.css`; the editor's styles are in `public/editor.html` |
| Change the `untangled` command | `bin/untangle.js`, `server/local.js` |
| Change deployment | `Dockerfile`, `docker-compose.yml`, `.env.example`, README |
