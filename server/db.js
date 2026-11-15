import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

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
  return db;
}
