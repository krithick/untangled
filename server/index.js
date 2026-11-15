import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { createMailer } from "./mail.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const production = env.NODE_ENV === "production";
const dataDir = env.DATA_DIR || path.join(here, "..", "data");
const port = Number(env.PORT) || 3000;
const appUrl = (env.APP_URL || "").replace(/\/+$/, "");
const contactEmail = env.CONTACT_EMAIL || "";

/* Check settings before accepting traffic, so a bad deploy fails loudly instead of half-working. */
const problems = [];
if (appUrl && !/^https?:\/\/[^\s/]+$/.test(appUrl)) problems.push("APP_URL must look like https://untangle.example.com (no path).");
if (production && !appUrl) problems.push("APP_URL is required in production. Password reset emails link to it.");
if (production && appUrl.startsWith("http://")) problems.push("APP_URL must use https:// in production. Logins only work over HTTPS.");
if (contactEmail && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(contactEmail)) problems.push("CONTACT_EMAIL is not a valid email address.");
if (env.SMTP_URL && !env.EMAIL_FROM) problems.push("EMAIL_FROM is required when SMTP_URL is set, e.g. \"Untangle <hello@example.com>\".");
if (problems.length) { console.error("Untangle can't start:\n- " + problems.join("\n- ")); process.exit(1); }

const mailer = createMailer({ smtpUrl: env.SMTP_URL, from: env.EMAIL_FROM, production });
if (production && !mailer.configured) console.warn("Warning: SMTP_URL is not set, so password reset emails will not be sent.");
if (mailer.configured) mailer.verify().catch((e) => console.error("Warning: could not connect to the email server:", e.message));

let db;
try { db = openDb(path.join(dataDir, "untangle.db")); }
catch (e) { console.error(`Untangle can't start: could not open the database in ${dataDir} (${e.message}). Check that DATA_DIR exists and is writable.`); process.exit(1); }
const app = createApp({
  db, mailer, appUrl, contactEmail,
  secureCookies: production,
  log: env.LOG_REQUESTS === "0" ? null : (entry) => console.log(JSON.stringify(entry)),
});

const server = app.listen(port, () => console.log(`Untangle is running at ${appUrl || `http://localhost:${port}`} (port ${port})`));

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down.`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref(); // don't hang on stuck connections
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e));
