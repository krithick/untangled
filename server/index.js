import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, "..", "data");
const port = Number(process.env.PORT) || 3000;

const db = openDb(path.join(dataDir, "untangle.db"));
const app = createApp({ db, secureCookies: process.env.NODE_ENV === "production" });

const server = app.listen(port, () => console.log(`Untangle is running at http://localhost:${port}`));
const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
