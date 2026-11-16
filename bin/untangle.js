#!/usr/bin/env node
/* The `untangled` command (local mode). It only parses arguments, picks the folder and a free port,
   and starts server/local.js. See "Use it on a Git repository" in the README. */
/* Untangle local mode: edit the Mermaid files of a folder in your browser.
     untangled                 open the diagrams of the current folder
     untangled docs/erd.mmd    open (or create) one file
     untangled path/to/repo    open the diagrams of another folder            */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) { console.error(`Untangle needs Node.js 20 or newer. You have ${process.versions.node}.`); process.exit(1); }

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const option = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
if (flag("--help") || flag("-h")) {
  console.log(`Untangle: edit Mermaid diagrams by dragging, and save them back to your files.

Usage:
  untangled [file.mmd | folder] [--port 4747] [--no-open]

Examples:
  untangled                   every .mmd file in this folder and below
  untangled docs/erd.mmd      open one diagram (it is created if it doesn't exist)

Changes are written straight to the files. Layout is kept in %% comments that
Mermaid ignores, so the files still render on GitHub, GitLab and elsewhere.
Commit them with Git as usual.`);
  process.exit(0);
}
const noOpen = flag("--no-open");
const wantPort = Number(option("--port")) || 4747;
const target = path.resolve(args[0] || ".");
const isDiagram = /\.(mmd|mermaid)$/i.test(target);

let root, openPath = "/";
if (fs.existsSync(target) && fs.statSync(target).isDirectory()) root = target;
else if (isDiagram) {
  const cwd = process.cwd();
  root = target.startsWith(cwd + path.sep) ? cwd : path.dirname(target);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "flowchart TD\n    a([Start]) --> b[First step]\n");
    console.log(`Created ${path.relative(cwd, target) || target}`);
  }
  openPath = "/f/" + path.relative(root, target).split(path.sep).map(encodeURIComponent).join("/");
} else { console.error(`${args[0]} is not a folder or a .mmd file.`); process.exit(1); }

const { createLocalApp } = await import("../server/local.js");
const app = createLocalApp({ root });

function listen(port, triesLeft) {
  const server = app.listen(port, "127.0.0.1");
  server.once("listening", () => {
    const url = `http://localhost:${port}${openPath}`;
    console.log(`Untangle is editing ${root}\n  ${url}\nPress Ctrl+C to stop.`);
    if (!noOpen) {
      const cmd = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
      try { spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* the address is printed above */ }
    }
  });
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && triesLeft > 0) listen(port + 1, triesLeft - 1);
    else { console.error(`Couldn't start on port ${port}: ${e.message}`); process.exit(1); }
  });
}
listen(wantPort, 20);
