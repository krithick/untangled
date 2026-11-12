import express from "express";
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

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };

export function createApp({ db, secureCookies = false } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

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
    trimVersions: db.prepare("DELETE FROM versions WHERE diagram_id = ? AND id NOT IN (SELECT id FROM versions WHERE diagram_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)"),
  };

  const loginLimit = rateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
  const signupLimit = rateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

  /* ---------- security headers ---------- */
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; " +
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
  api.use(express.json({ limit: "2mb" }));
  // Cross-site requests can't set custom headers without a CORS preflight, which we never allow.
  api.use((req, res, next) => {
    if (req.method !== "GET" && req.get("X-Requested-With") !== "untangle") return next(new HttpError(403, "Missing request header."));
    next();
  });
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
    if (!u || !verifyPassword(String(req.body.password || ""), u.pw_hash)) fail(401, "That email and password don't match.");
    startSession(res, u.id);
    res.json({ user: { id: u.id, email: u.email, name: u.name } });
  }));

  api.post("/auth/logout", wrap((req, res) => {
    if (req.sessionToken) q.deleteSession.run(sha256(req.sessionToken));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
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
    const now = Date.now();
    q.updateDiagram.run(title, detectKind(source), source, checkThumb(req.body.thumb), now, d.id);
    if (source !== d.source) addVersion(d.id, source, now, !!req.body.checkpoint);
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
  const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC, file));
  const loggedIn = (file) => (req, res) => req.user ? res.sendFile(path.join(PUBLIC, file)) : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  const loggedOut = (file) => (req, res) => req.user ? res.redirect("/app") : res.sendFile(path.join(PUBLIC, file));

  app.get("/", page("index.html"));
  app.get("/login", loggedOut("login.html"));
  app.get("/signup", loggedOut("signup.html"));
  app.get("/app", loggedIn("app.html"));
  app.get("/account", loggedIn("account.html"));
  app.get("/d/:id", loggedIn("editor.html"));
  app.get("/s/:token", page("editor.html"));
  app.get("/demo", page("editor.html"));
  app.get("/vendor/mermaid.min.js", (req, res) => res.sendFile(MERMAID_FILE, { maxAge: "7d" }));
  app.use(express.static(PUBLIC, { index: false, maxAge: "1h" }));

  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, "404.html")));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === "entity.too.large" ? 413 : 500);
    if (status >= 500) console.error(err);
    const message = status >= 500 ? "Something went wrong on our side. Please try again." : err.message;
    if (req.originalUrl.startsWith("/api/")) res.status(status).json({ error: message });
    else res.status(status).send(message);
  });

  return app;
}
