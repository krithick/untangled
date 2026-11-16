/* The database: one SQLite file, opened with Node's built-in node:sqlite (no native module to install).

   TABLES
     users            id, email (unique, lower-case), name, pw_hash, created_at
     sessions         token_hash (SHA-256 of the cookie value), user_id, created_at, expires_at
     diagrams         id, user_id, title, kind, source (Mermaid text incl. layout comments), thumb (SVG),
                      share_token (null = private), created_at, updated_at
     versions         id, diagram_id, source, created_at        (newest 50 per diagram are kept)
     password_resets  token_hash, user_id, created_at, expires_at
   Times are milliseconds since 1970. Deleting a user deletes everything of theirs (ON DELETE CASCADE).

   CHANGING THE SCHEMA
     New tables and indexes: add them below with IF NOT EXISTS; they are created on the next start.
     New columns on existing tables need a migration step, because CREATE TABLE IF NOT EXISTS does not
     alter a table that already exists. See "Change the database" in docs/HOW-TO.md. */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/* Numbered changes to tables that already exist in deployed databases (new columns, renamed columns...).
   Each entry is one SQL string and runs exactly once per database, in order; the database remembers how
   many have run (PRAGMA user_version). APPEND ONLY: never edit, remove or reorder an entry after it has
   shipped. Example:  "ALTER TABLE users ADD COLUMN verified_at INTEGER"  */
export const MIGRATIONS = [
];

/** Runs the migrations this database hasn't seen yet. Each runs in its own transaction. */
export function migrate(db, migrations = MIGRATIONS) {
  const done = db.prepare("PRAGMA user_version").get().user_version;
  for (let v = done; v < migrations.length; v++) {
    db.exec("BEGIN");
    try { db.exec(migrations[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); throw new Error(`Database migration ${v + 1} failed: ${e.message}`); }
  }
}

/** Opens (and if needed creates) the SQLite database and applies the schema. */
export function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      pw_hash     TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS diagrams (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      kind         TEXT NOT NULL,
      source       TEXT NOT NULL,
      thumb        TEXT,
      share_token  TEXT UNIQUE,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS diagrams_by_user ON diagrams(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS versions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      diagram_id  TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
      source      TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS versions_by_diagram ON versions(diagram_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash  TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );
  `);
  migrate(db);
  return db;
}
