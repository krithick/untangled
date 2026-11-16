/* Local mode: edit the .mmd files of a folder (usually a Git repository) in place.
   No accounts and no database: the files are the storage, and Git is the history. */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { detectKind } from "./app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "..", "public");
const require = createRequire(import.meta.url);
const MERMAID_FILE = require.resolve("mermaid/dist/mermaid.min.js");

const EXT = /\.(mmd|mermaid)$/i;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "target", "vendor", "coverage"]);
const MAX_FILES = 2000, MAX_DEPTH = 10, MAX_SIZE = 2_000_000;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };

/** Lists diagram files under root, newest first. */
export function listDiagramFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1); }
      else if (e.isFile() && EXT.test(e.name)) {
        try { const st = fs.statSync(full); out.push({ rel: path.relative(root, full).split(path.sep).join("/"), mtime: Math.round(st.mtimeMs), size: st.size }); } catch { /* unreadable: skip */ }
      }
    }
  };
  walk(root, 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}

export function createLocalApp({ root }) {
  root = fs.realpathSync(path.resolve(root));
  const app = express();
  app.disable("x-powered-by");

  // Only answer requests addressed to this machine, so no outside website can reach the files.
  app.use((req, res, next) => (LOCAL_HOST.test(req.headers.host || "") ? next() : res.status(403).send("Untangle local mode only answers on localhost.")));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; " +
      "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    next();
  });

  /** Turns a path from the browser into a safe absolute path inside root, or refuses. */
  function resolveFile(rel, { mustExist = true } = {}) {
    rel = String(rel || "").replace(/\\/g, "/");
    if (!rel || rel.includes("\0") || !EXT.test(rel)) fail(400, "Only .mmd and .mermaid files can be opened.");
    if (rel.split("/").some((s) => s === ".." || s === "." || s === "" || s.startsWith("."))) fail(400, "That file path isn't allowed.");
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep)) fail(400, "That file is outside this folder.");
    // A link inside the folder must not lead outside it.
    let dir = path.dirname(full);
    while (!fs.existsSync(dir)) dir = path.dirname(dir);
    const realDir = fs.realpathSync(dir);
    if (realDir !== root && !realDir.startsWith(root + path.sep)) fail(400, "That file is outside this folder.");
    if (fs.existsSync(full)) {
      const real = fs.realpathSync(full);
      if (!real.startsWith(root + path.sep)) fail(400, "That file is outside this folder.");
      if (!fs.statSync(real).isFile()) fail(400, "That isn't a file.");
    } else if (mustExist) fail(404, "That file doesn't exist any more. It may have been moved or deleted.");
    return full;
  }
  const id = (rel) => encodeURIComponent(rel);
  function readDiagram(rel) {
    const full = resolveFile(rel);
    const st = fs.statSync(full);
    if (st.size > MAX_SIZE) fail(413, "This file is too large to open (over 2 MB).");
    const source = fs.readFileSync(full, "utf8");
    return { id: id(rel), title: rel, kind: detectKind(source), source, shareToken: null, createdAt: Math.round(st.birthtimeMs), updatedAt: Math.round(st.mtimeMs) };
  }
  function writeFile(full, source) {
    const text = source.replace(/\r\n/g, "\n").replace(/\s*$/, "") + "\n";
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = `${full}.untangle-${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, full); // replace in one step, so a crash can't leave half a file
  }

  const api = express.Router();
  api.use(express.json({ limit: "4mb" }));
  api.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  api.use((req, res, next) => (req.method !== "GET" && req.get("X-Requested-With") !== "untangle" ? next(new HttpError(403, "Missing request header.")) : next()));

  api.get("/session", (req, res) => res.json({ user: null, local: true, root }));
  api.get("/diagrams", wrap((req, res) => {
    const diagrams = listDiagramFiles(root).map((f) => {
      let kind = "unknown";
      try { if (f.size <= MAX_SIZE) kind = detectKind(fs.readFileSync(path.join(root, f.rel), "utf8").slice(0, 4000)); } catch { /* keep unknown */ }
      return { id: id(f.rel), title: f.rel, kind, shared: false, has_thumb: false, created_at: f.mtime, updated_at: f.mtime };
    });
    res.json({ diagrams, root, name: path.basename(root) });
  }));
  api.post("/diagrams", wrap((req, res) => {
    let rel = String(req.body.title || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel) fail(400, "Give the file a name, for example docs/checkout.mmd.");
    if (!EXT.test(rel)) rel += ".mmd";
    const full = resolveFile(rel, { mustExist: false });
    if (fs.existsSync(full)) fail(409, `${rel} already exists. Pick another name.`);
    const source = String(req.body.source || "");
    if (!source.trim()) fail(400, "The diagram is empty.");
    writeFile(full, source);
    res.status(201).json({ diagram: readDiagram(rel) });
  }));
  api.get("/diagrams/:id", wrap((req, res) => res.json({ diagram: readDiagram(req.params.id) })));
  api.put("/diagrams/:id", wrap((req, res) => {
    const rel = req.params.id;
    const before = readDiagram(rel);
    const source = req.body.source;
    if (source === undefined) return res.json({ diagram: before });
    if (typeof source !== "string" || !source.trim()) fail(400, "The diagram is empty.");
    if (source.length > MAX_SIZE) fail(413, "This diagram is too large to save (over 2 MB).");
    const same = source.replace(/\s*$/, "") === before.source.replace(/\r\n/g, "\n").replace(/\s*$/, "");
    const base = req.body.baseUpdatedAt;
    if (!same && typeof base === "number" && base !== before.updatedAt) {
      return res.status(409).json({ error: "This file was changed on disk since you opened it.", updatedAt: before.updatedAt });
    }
    if (!same) writeFile(resolveFile(rel), source);
    res.json({ diagram: readDiagram(rel) });
  }));
  api.use((req, res) => res.status(404).json({ error: "Not found." }));
  app.use("/api", api);

  const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC, file));
  app.get("/", page("local.html"));
  app.get(/^\/f\/.+/, page("editor.html"));
  app.get("/vendor/mermaid.min.js", (req, res) => res.sendFile(MERMAID_FILE, { maxAge: "7d" }));
  app.use(express.static(PUBLIC, { index: false, setHeaders: (res, file) => { if (/\.(js|css|html)$/.test(file)) res.setHeader("Cache-Control", "no-cache"); } }));
  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, "404.html")));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === "entity.too.large" ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Something went wrong. Check the terminal where Untangle is running." : err.message });
  });
  return app;
}
