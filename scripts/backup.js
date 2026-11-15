/* Writes a consistent copy of the database to DATA_DIR/backups and keeps the newest KEEP copies.
   Safe to run while the app is running. Usage: npm run backup */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, "..", "data");
const keep = Math.max(1, Number(process.env.KEEP) || 14);
const source = path.join(dataDir, "untangle.db");
const outDir = process.env.BACKUP_DIR || path.join(dataDir, "backups");

if (!fs.existsSync(source)) { console.error(`No database at ${source}`); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const target = path.join(outDir, `untangle-${stamp}.db`);

const db = new DatabaseSync(source);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

const check = new DatabaseSync(target, { readOnly: true });
const ok = check.prepare("PRAGMA integrity_check").get().integrity_check === "ok";
const users = check.prepare("SELECT COUNT(*) AS n FROM users").get().n;
const diagrams = check.prepare("SELECT COUNT(*) AS n FROM diagrams").get().n;
check.close();
if (!ok) { fs.rmSync(target); console.error("The backup failed its integrity check and was removed."); process.exit(1); }

const old = fs.readdirSync(outDir).filter((f) => /^untangle-\d{8}-\d{6}\.db$/.test(f)).sort().reverse().slice(keep);
old.forEach((f) => fs.rmSync(path.join(outDir, f)));
console.log(`Backed up ${users} accounts and ${diagrams} diagrams to ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB). Removed ${old.length} old backup(s).`);
