/* The web app: every page and API route, built by createApp().
   index.js reads the settings and calls createApp(); the tests call it with an in-memory database.

   ORDER OF MIDDLEWARE (order matters)
     request log → /healthz → gzip → security headers → session (sets req.user) → /api router → pages → static files → 404 → errors

   API (all under /api, JSON in and out; every non-GET needs the header X-Requested-With: untangle)
     POST   /auth/signup | /auth/login | /auth/logout | /auth/forgot | /auth/reset
     GET    /session               who is logged in, or null (never 401; used by the landing page)
     GET    /me    PATCH /me    POST /me/password    DELETE /me
     GET    /export                every diagram of the account as one JSON download
     GET    /diagrams              list           POST /diagrams           create
     GET    /diagrams/:id          read           PUT  /diagrams/:id       save (409 if baseUpdatedAt is stale)
     DELETE /diagrams/:id                         POST /diagrams/:id/duplicate
     POST   /diagrams/:id/share    turn the share link on or off
     GET    /diagrams/:id/versions      GET /diagrams/:id/versions/:vid      GET /diagrams/:id/thumb
     GET    /share/:token          public read    POST /share/:token/copy  copy into my account

   CONVENTIONS
     - Handlers are wrapped in wrap() so a thrown error reaches the error handler at the bottom.
     - fail(status, message) throws; the message is shown to the user, so write it for them.
     - needUser(req) and ownDiagram(req) do the access checks. A diagram that isn't yours is a 404, not a 403,
       so ids can't be probed.
     - All SQL lives in the `q` object as prepared statements.
   server/local.js implements the same /api/diagrams routes on top of files, for the `untangled` command. */
import express from "express";
import compression from "compression";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  hashPassword, verifyPassword, newId, newToken, sha256, parseCookies,
  rateLimiter, SESSION_COOKIE, SESSION_DAYS,
} from "./auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "..", "public");
const require = createRequire(import.meta.url);
const MERMAID_FILE = require.resolve("mermaid/dist/mermaid.min.js");

const LIMITS = { source: 500_000, thumb: 400_000, title: 120, diagramsPerUser: 500, versionsKept: 50 };
const VERSION_EVERY_MS = 5 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const PRIVATE_PATHS = /^\/(app|account|d|s|api|reset|forgot)(\/|$)/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reads the diagram type from the first meaningful line of Mermaid source. */
export function detectKind(source) {
  const text = String(source || "").replace(/^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, "");
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith("%%")) continue;
    const w = t.split(/\s+/)[0];
    if (w === "erDiagram") return "er";
    if (w === "flowchart" || w === "graph") return "flow";
    if (w === "sequenceDiagram") return "seq";
    return w.slice(0, 40);
  }
  return "unknown";
}

/* An error with an HTTP status. Messages of 4xx errors are shown to the user as they are. */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };

const noMail = { configured: false, send: async () => {}, verify: async () => true };

/**
 * @param db            open database (see db.js)
 * @param secureCookies send cookies over HTTPS only and enable HSTS (production)
 * @param mailer        { send({to, subject, text}) } (see mail.js)
 * @param appUrl        public address, e.g. https://untangle.example.com; used in emailed links
 * @param contactEmail  shown on the privacy and terms pages
 * @param log           function called with one object per request, or null for no request log
 */
export function createApp({ db, secureCookies = false, mailer = noMail, appUrl = "", contactEmail = "", log = null } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  const startedAt = Date.now();

  /* Every SQL statement the app runs, prepared once. Add new queries here. */
  const q = {
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    userById: db.prepare("SELECT id, email, name, created_at FROM users WHERE id = ?"),
    userHash: db.prepare("SELECT pw_hash FROM users WHERE id = ?"),
    insertUser: db.prepare("INSERT INTO users (id, email, name, pw_hash, created_at) VALUES (?, ?, ?, ?, ?)"),
    updateName: db.prepare("UPDATE users SET name = ? WHERE id = ?"),
    updateHash: db.prepare("UPDATE users SET pw_hash = ? WHERE id = ?"),
    deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
    insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    sessionUser: db.prepare("SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?"),
    purgeSessions: db.prepare("DELETE FROM sessions WHERE expires_at < ?"),
    listDiagrams: db.prepare("SELECT id, title, kind, share_token IS NOT NULL AS shared, (thumb IS NOT NULL) AS has_thumb, created_at, updated_at FROM diagrams WHERE user_id = ? ORDER BY updated_at DESC"),
    countDiagrams: db.prepare("SELECT COUNT(*) AS n FROM diagrams WHERE user_id = ?"),
    getDiagram: db.prepare("SELECT id, user_id, title, kind, source, share_token, created_at, updated_at FROM diagrams WHERE id = ?"),
    getThumb: db.prepare("SELECT user_id, thumb, share_token FROM diagrams WHERE id = ?"),
    insertDiagram: db.prepare("INSERT INTO diagrams (id, user_id, title, kind, source, thumb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    updateDiagram: db.prepare("UPDATE diagrams SET title = ?, kind = ?, source = ?, thumb = COALESCE(?, thumb), updated_at = ? WHERE id = ?"),
    setShare: db.prepare("UPDATE diagrams SET share_token = ? WHERE id = ?"),
    deleteDiagram: db.prepare("DELETE FROM diagrams WHERE id = ?"),
    byShare: db.prepare("SELECT d.id, d.title, d.kind, d.source, d.updated_at, u.name AS owner FROM diagrams d JOIN users u ON u.id = d.user_id WHERE d.share_token = ?"),
    lastVersion: db.prepare("SELECT id, created_at FROM versions WHERE diagram_id = ? ORDER BY created_at DESC, id DESC LIMIT 1"),
    insertVersion: db.prepare("INSERT INTO versions (diagram_id, source, created_at) VALUES (?, ?, ?)"),
    updateVersion: db.prepare("UPDATE versions SET source = ? WHERE id = ?"),
    listVersions: db.prepare("SELECT id, created_at, length(source) AS size FROM versions WHERE diagram_id = ? ORDER BY created_at DESC, id DESC"),
    getVersion: db.prepare("SELECT source, created_at FROM versions WHERE id = ? AND diagram_id = ?"),
    insertReset: db.prepare("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    getReset: db.prepare("SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?"),
    deleteResets: db.prepare("DELETE FROM password_resets WHERE user_id = ?"),
    purgeResets: db.prepare("DELETE FROM password_resets WHERE expires_at < ?"),
    deleteAllSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
    touchThumb: db.prepare("UPDATE diagrams SET thumb = ? WHERE id = ?"),
    exportDiagrams: db.prepare("SELECT title, kind, source, created_at, updated_at FROM diagrams WHERE user_id = ? ORDER BY updated_at DESC"),
    ping: db.prepare("SELECT 1 AS ok"),
    trimVersions: db.prepare("DELETE FROM versions WHERE diagram_id = ? AND id NOT IN (SELECT id FROM versions WHERE diagram_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)"),
  };

  const loginLimit = rateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
  const signupLimit = rateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });
  const forgotIpLimit = rateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });
  const forgotEmailLimit = rateLimiter({ max: 3, windowMs: 60 * 60 * 1000 });
  const resetLimit = rateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });
  const apiLimit = rateLimiter({ max: 1500, windowMs: 5 * 60 * 1000 });
  // A real hash to compare against when the email is unknown, so both cases take the same time.
  const dummyHash = hashPassword(newToken());

  /* ---------- request log ---------- */
  if (log) app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.on("finish", () => {
      if (req.path === "/healthz") return;
      log({ time: new Date().toISOString(), method: req.method, path: req.path.replace(/^\/(s|reset)\/[^/]+/, "/$1/…"), status: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e6), user: req.user ? req.user.id : undefined });
    });
    next();
  });

  app.get("/healthz", (req, res) => {
    try { q.ping.get(); res.json({ ok: true, uptime: Math.round((Date.now() - startedAt) / 1000) }); }
    catch { res.status(503).json({ ok: false }); }
  });

  app.use(compression());

  /* ---------- security headers ---------- */
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (secureCookies) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (PRIVATE_PATHS.test(req.path)) res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; " +
      "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    next();
  });

  /* ---------- session ---------- */
  app.use((req, res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    req.user = token ? q.sessionUser.get(sha256(token), Date.now()) || null : null;
    req.sessionToken = req.user ? token : null;
    next();
  });

  /* Logs a user in: stores the hash of a random token and sends the token itself in an HttpOnly cookie. */
  function startSession(res, userId) {
    const token = newToken();
    const now = Date.now();
    q.insertSession.run(sha256(token), userId, now, now + SESSION_DAYS * 864e5);
    if (Math.random() < 0.05) q.purgeSessions.run(now);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: secureCookies, path: "/", maxAge: SESSION_DAYS * 864e5,
    });
  }

  /* ---------- API ---------- */
  const api = express.Router();
  api.use((req, res, next) => (apiLimit(req.ip) ? next() : next(new HttpError(429, "Too many requests. Wait a few minutes and try again."))));
  api.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  api.use(express.json({ limit: "2mb" }));
  // Cross-site requests can't set custom headers without a CORS preflight, which we never allow.
  api.use((req, res, next) => {
    if (req.method !== "GET" && req.get("X-Requested-With") !== "untangle") return next(new HttpError(403, "Missing request header."));
    next();
  });
  /* Access checks and input cleaning shared by the routes below. */
  const needUser = (req) => req.user || fail(401, "Please log in.");
  const ownDiagram = (req) => {
    const user = needUser(req);
    const d = q.getDiagram.get(req.params.id);
    if (!d || d.user_id !== user.id) fail(404, "Diagram not found.");
    return d;
  };
  const cleanTitle = (t, fallback) => String(t ?? fallback ?? "").trim().slice(0, LIMITS.title) || "Untitled diagram";
  const checkSource = (s) => {
    if (typeof s !== "string" || !s.trim()) fail(400, "The diagram is empty.");
    if (s.length > LIMITS.source) fail(413, "This diagram is too large to save (over 500 KB).");
    return s;
  };
  const checkThumb = (t) => (typeof t === "string" && t.startsWith("<svg") && t.length <= LIMITS.thumb ? t : null);
  const publicDiagram = (d) => ({
    id: d.id, title: d.title, kind: d.kind, source: d.source,
    shareToken: d.share_token || null, createdAt: d.created_at, updatedAt: d.updated_at,
  });
  /* Version history: edits within VERSION_EVERY_MS of the last version overwrite it, so typing doesn't
     create hundreds of versions. force = true always starts a new one (create, restore, "Keep my version"). */
  function addVersion(id, source, now, force) {
    const last = q.lastVersion.get(id);
    if (!force && last && now - last.created_at < VERSION_EVERY_MS) q.updateVersion.run(source, last.id);
    else { q.insertVersion.run(id, source, now); q.trimVersions.run(id, id, LIMITS.versionsKept); }
  }

  api.post("/auth/signup", wrap((req, res) => {
    if (!signupLimit(req.ip)) fail(429, "Too many sign-ups from this network. Try again later.");
    const email = String(req.body.email || "").trim().toLowerCase();
    const name = String(req.body.name || "").trim().slice(0, 80);
    const password = String(req.body.password || "");
    if (!name) fail(400, "Enter your name.");
    if (!EMAIL_RE.test(email) || email.length > 200) fail(400, "Enter a valid email address.");
    if (password.length < 8) fail(400, "Use a password of at least 8 characters.");
    if (password.length > 200) fail(400, "That password is too long.");
    if (q.userByEmail.get(email)) fail(409, "An account with this email already exists. Log in instead.");
    const id = newId();
    q.insertUser.run(id, email, name, hashPassword(password), Date.now());
    startSession(res, id);
    res.status(201).json({ user: { id, email, name } });
  }));

  api.post("/auth/login", wrap((req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!loginLimit(`${req.ip}|${email}`)) fail(429, "Too many attempts. Wait 15 minutes and try again.");
    const u = q.userByEmail.get(email);
    const ok = verifyPassword(String(req.body.password || "").slice(0, 200), u ? u.pw_hash : dummyHash);
    if (!u || !ok) fail(401, "That email and password don't match.");
    startSession(res, u.id);
    res.json({ user: { id: u.id, email: u.email, name: u.name } });
  }));

  api.post("/auth/logout", wrap((req, res) => {
    if (req.sessionToken) q.deleteSession.run(sha256(req.sessionToken));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  }));

  /* Password reset. The reply never says whether the email has an account. */
  api.post("/auth/forgot", wrap(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) fail(400, "Enter a valid email address.");
    if (!forgotIpLimit(req.ip)) fail(429, "Too many requests. Try again in an hour.");
    const u = q.userByEmail.get(email);
    if (u && forgotEmailLimit(email)) {
      const token = newToken(), now = Date.now();
      q.purgeResets.run(now);
      q.insertReset.run(sha256(token), u.id, now, now + RESET_TTL_MS);
      const base = appUrl || `${req.protocol}://${req.get("host")}`;
      const link = `${base}/reset?token=${token}`;
      try {
        await mailer.send({
          to: u.email,
          subject: "Reset your Untangle password",
          text: `Hi ${u.name},\n\nSomeone asked to reset the password for your Untangle account. To choose a new password, open this link within 1 hour:\n\n${link}\n\nIf this wasn't you, you can ignore this email. Your password stays the same.`,
        });
      } catch (e) { console.error("[mail] Could not send the password reset email:", e.message); }
    }
    res.json({ ok: true });
  }));

  api.post("/auth/reset", wrap((req, res) => {
    if (!resetLimit(req.ip)) fail(429, "Too many attempts. Try again in an hour.");
    const password = String(req.body.password || "");
    if (password.length < 8) fail(400, "Use a password of at least 8 characters.");
    if (password.length > 200) fail(400, "That password is too long.");
    const row = q.getReset.get(sha256(String(req.body.token || "")), Date.now());
    if (!row) fail(400, "This reset link has expired or was already used. Ask for a new one.");
    q.updateHash.run(hashPassword(password), row.user_id);
    q.deleteResets.run(row.user_id);
    q.deleteAllSessions.run(row.user_id);
    startSession(res, row.user_id);
    res.json({ ok: true });
  }));

  api.get("/session", (req, res) => res.json({ user: req.user ? { id: req.user.id, name: req.user.name } : null }));

  api.get("/me", wrap((req, res) => {
    const u = needUser(req);
    res.json({ user: q.userById.get(u.id) });
  }));

  api.patch("/me", wrap((req, res) => {
    const u = needUser(req);
    const name = String(req.body.name || "").trim().slice(0, 80);
    if (!name) fail(400, "Enter your name.");
    q.updateName.run(name, u.id);
    res.json({ user: q.userById.get(u.id) });
  }));

  api.post("/me/password", wrap((req, res) => {
    const u = needUser(req);
    const next = String(req.body.next || "");
    if (!verifyPassword(String(req.body.current || ""), q.userHash.get(u.id).pw_hash)) fail(400, "Your current password isn't right.");
    if (next.length < 8) fail(400, "Use a new password of at least 8 characters.");
    if (next.length > 200) fail(400, "That password is too long.");
    q.updateHash.run(hashPassword(next), u.id);
    q.deleteUserSessions.run(u.id, sha256(req.sessionToken));
    res.json({ ok: true });
  }));

  api.delete("/me", wrap((req, res) => {
    const u = needUser(req);
    if (!verifyPassword(String(req.body.password || ""), q.userHash.get(u.id).pw_hash)) fail(400, "Your password isn't right.");
    q.deleteUser.run(u.id);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  }));

  api.get("/export", wrap((req, res) => {
    const u = needUser(req);
    const diagrams = q.exportDiagrams.all(u.id).map((d) => ({ title: d.title, kind: d.kind, source: d.source, createdAt: new Date(d.created_at).toISOString(), updatedAt: new Date(d.updated_at).toISOString() }));
    res.setHeader("Content-Disposition", `attachment; filename="untangle-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ exportedAt: new Date().toISOString(), account: { name: u.name, email: u.email }, diagrams });
  }));

  api.get("/diagrams", wrap((req, res) => {
    const u = needUser(req);
    res.json({ diagrams: q.listDiagrams.all(u.id).map((d) => ({ ...d, shared: !!d.shared, has_thumb: !!d.has_thumb })) });
  }));

  api.post("/diagrams", wrap((req, res) => {
    const u = needUser(req);
    if (q.countDiagrams.get(u.id).n >= LIMITS.diagramsPerUser) fail(403, "You've reached the limit of 500 diagrams. Delete some to make room.");
    const source = checkSource(req.body.source);
    const id = newId(), now = Date.now();
    q.insertDiagram.run(id, u.id, cleanTitle(req.body.title), detectKind(source), source, checkThumb(req.body.thumb), now, now);
    addVersion(id, source, now, true);
    res.status(201).json({ diagram: publicDiagram(q.getDiagram.get(id)) });
  }));

  api.get("/diagrams/:id", wrap((req, res) => res.json({ diagram: publicDiagram(ownDiagram(req)) })));

  api.put("/diagrams/:id", wrap((req, res) => {
    const d = ownDiagram(req);
    const source = req.body.source === undefined ? d.source : checkSource(req.body.source);
    const title = req.body.title === undefined ? d.title : cleanTitle(req.body.title);
    const thumb = checkThumb(req.body.thumb);
    const changed = source !== d.source || title !== d.title;
    // Refuse to overwrite a newer save from another tab or device unless the client says so.
    const base = req.body.baseUpdatedAt;
    if (changed && typeof base === "number" && base !== d.updated_at) {
      return res.status(409).json({ error: "This diagram was changed somewhere else since you opened it.", updatedAt: d.updated_at });
    }
    if (changed) {
      const now = Date.now();
      q.updateDiagram.run(title, detectKind(source), source, thumb, now, d.id);
      if (source !== d.source) addVersion(d.id, source, now, !!req.body.checkpoint);
      else if (req.body.checkpoint) addVersion(d.id, source, now, true);
    } else {
      if (thumb) q.touchThumb.run(thumb, d.id); // a new preview alone doesn't count as an edit
      if (req.body.checkpoint) addVersion(d.id, source, Date.now(), true);
    }
    res.json({ diagram: publicDiagram(q.getDiagram.get(d.id)) });
  }));

  api.delete("/diagrams/:id", wrap((req, res) => {
    const d = ownDiagram(req);
    q.deleteDiagram.run(d.id);
    res.json({ ok: true });
  }));

  api.post("/diagrams/:id/duplicate", wrap((req, res) => {
    const d = ownDiagram(req);
    if (q.countDiagrams.get(d.user_id).n >= LIMITS.diagramsPerUser) fail(403, "You've reached the limit of 500 diagrams.");
    const id = newId(), now = Date.now();
    const thumb = q.getThumb.get(d.id).thumb;
    q.insertDiagram.run(id, d.user_id, cleanTitle(`${d.title} (copy)`), d.kind, d.source, thumb, now, now);
    addVersion(id, d.source, now, true);
    res.status(201).json({ diagram: publicDiagram(q.getDiagram.get(id)) });
  }));

  api.post("/diagrams/:id/share", wrap((req, res) => {
    const d = ownDiagram(req);
    const token = req.body.enabled ? d.share_token || newToken(12) : null;
    q.setShare.run(token, d.id);
    res.json({ shareToken: token });
  }));

  api.get("/diagrams/:id/versions", wrap((req, res) => {
    const d = ownDiagram(req);
    res.json({ versions: q.listVersions.all(d.id) });
  }));

  api.get("/diagrams/:id/versions/:vid", wrap((req, res) => {
    const d = ownDiagram(req);
    const v = q.getVersion.get(Number(req.params.vid), d.id) || fail(404, "Version not found.");
    res.json({ version: v });
  }));

  api.get("/diagrams/:id/thumb", wrap((req, res) => {
    const u = needUser(req);
    const row = q.getThumb.get(req.params.id);
    if (!row || row.user_id !== u.id || !row.thumb) fail(404, "No preview yet.");
    sendSvg(res, row.thumb);
  }));

  api.get("/share/:token", wrap((req, res) => {
    const d = q.byShare.get(req.params.token) || fail(404, "This link doesn't work. The owner may have turned sharing off.");
    res.json({ diagram: { title: d.title, kind: d.kind, source: d.source, updatedAt: d.updated_at, owner: d.owner } });
  }));

  api.post("/share/:token/copy", wrap((req, res) => {
    const u = needUser(req);
    const d = q.byShare.get(req.params.token) || fail(404, "This link doesn't work any more.");
    if (q.countDiagrams.get(u.id).n >= LIMITS.diagramsPerUser) fail(403, "You've reached the limit of 500 diagrams.");
    const id = newId(), now = Date.now();
    q.insertDiagram.run(id, u.id, cleanTitle(d.title), d.kind, d.source, null, now, now);
    addVersion(id, d.source, now, true);
    res.status(201).json({ diagram: publicDiagram(q.getDiagram.get(id)) });
  }));

  api.use((req, res) => res.status(404).json({ error: "Not found." }));
  app.use("/api", api);

  function sendSvg(res, svg) {
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    // User-supplied SVG: never let it run scripts, even if opened directly.
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(svg);
  }

  /* ---------- pages ---------- */
  /* page: anyone. loggedIn: redirects to /login?next=... loggedOut: redirects logged-in users to /app.
     editor.html serves three routes; its script picks the mode from the address (see MODE in editor.js). */
  const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC, file));
  const loggedIn = (file) => (req, res) => req.user ? res.sendFile(path.join(PUBLIC, file)) : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  const loggedOut = (file) => (req, res) => req.user ? res.redirect("/app") : res.sendFile(path.join(PUBLIC, file));

  // Privacy and terms carry the operator's contact address.
  const legal = (file) => {
    const html = fs.readFileSync(path.join(PUBLIC, file), "utf8")
      .replaceAll("{{CONTACT}}", contactEmail ? `at <a href="mailto:${contactEmail}">${contactEmail}</a>` : "through the address this site was shared from");
    return (req, res) => res.type("html").send(html);
  };
  app.get("/", page("index.html"));
  app.get("/privacy", legal("privacy.html"));
  app.get("/terms", legal("terms.html"));
  app.get("/forgot", loggedOut("forgot.html"));
  app.get("/reset", page("reset.html"));
  app.get("/login", loggedOut("login.html"));
  app.get("/signup", loggedOut("signup.html"));
  app.get("/app", loggedIn("app.html"));
  app.get("/account", loggedIn("account.html"));
  app.get("/d/:id", loggedIn("editor.html"));
  app.get("/s/:token", page("editor.html"));
  app.get("/demo", page("editor.html"));
  app.get("/vendor/mermaid.min.js", (req, res) => res.sendFile(MERMAID_FILE, { maxAge: "7d" }));
  // Scripts and styles change with every release: make browsers check for a newer copy each time (cheap with ETags).
  app.use(express.static(PUBLIC, {
    index: false, maxAge: "1h",
    setHeaders: (res, file) => {
      if (/\.(js|css|html)$/.test(file)) res.setHeader("Cache-Control", "no-cache");
      else if (/\.woff2$/.test(file)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }));

  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, "404.html")));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === "entity.too.large" ? 413 : 500);
    if (status >= 500) console.error(err);
    const message = status >= 500 ? "Something went wrong on our side. Please try again." : err.message;
    if (res.headersSent) return;
    if (req.originalUrl.startsWith("/api/")) res.status(status).json({ error: message });
    else if (status >= 500) res.status(status).sendFile(path.join(PUBLIC, "500.html"));
    else res.status(status).send(message);
  });

  return app;
}
