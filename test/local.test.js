/* Tests of local mode (server/local.js) against a temporary folder, including attempts to escape it.
   Run with: npm test */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createLocalApp, listDiagramFiles } from "../server/local.js";

let server, base, root, outside;
const FLOW = "flowchart TD\n    a[Start] --> b[End]\n";
before(async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "untangle-local-")));
  root = path.join(tmp, "repo"); outside = path.join(tmp, "outside");
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, "docs/flow.mmd"), FLOW);
  fs.writeFileSync(path.join(root, "erd.mermaid"), "erDiagram\n  A ||--o{ B : has\n");
  fs.writeFileSync(path.join(root, "README.md"), "# not a diagram\n");
  fs.writeFileSync(path.join(root, "node_modules/pkg/x.mmd"), FLOW);
  fs.writeFileSync(path.join(root, ".git/y.mmd"), FLOW);
  fs.writeFileSync(path.join(outside, "secret.mmd"), "flowchart TD\n    secret --> data\n");
  fs.symlinkSync(outside, path.join(root, "link"));
  await new Promise((r) => { server = createLocalApp({ root }).listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, url, body, headers = { "X-Requested-With": "untangle" }) => {
  const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.includes("json") ? await res.json() : await res.text() };
};
const id = (rel) => encodeURIComponent(rel);

test("lists .mmd and .mermaid files, skipping node_modules and hidden folders", () => {
  const files = listDiagramFiles(root).map((f) => f.rel).sort();
  assert.deepEqual(files.filter((f) => !f.startsWith("link/")), ["docs/flow.mmd", "erd.mermaid"]);
});

test("reads a file, and saves only when the content changed", async () => {
  let r = await call("GET", `/api/diagrams/${id("docs/flow.mmd")}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.diagram.kind, "flow");
  assert.equal(r.body.diagram.title, "docs/flow.mmd");
  const opened = r.body.diagram.updatedAt;
  r = await call("PUT", `/api/diagrams/${id("docs/flow.mmd")}`, { source: FLOW.trimEnd(), baseUpdatedAt: opened });
  assert.equal(r.body.diagram.updatedAt, opened, "an identical save leaves the file untouched");
  r = await call("PUT", `/api/diagrams/${id("docs/flow.mmd")}`, { source: FLOW + "    b --> c[More]", baseUpdatedAt: opened });
  assert.equal(r.status, 200);
  const onDisk = fs.readFileSync(path.join(root, "docs/flow.mmd"), "utf8");
  assert.match(onDisk, /b --> c\[More\]\n$/, "written with one trailing newline");
  assert.deepEqual(fs.readdirSync(path.join(root, "docs")), ["flow.mmd"], "no temporary files left behind");
});

test("a change on disk (Git, another editor) is reported instead of overwritten", async () => {
  const opened = (await call("GET", `/api/diagrams/${id("erd.mermaid")}`)).body.diagram.updatedAt;
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(path.join(root, "erd.mermaid"), "erDiagram\n  A ||--o{ C : pulled\n");
  let r = await call("PUT", `/api/diagrams/${id("erd.mermaid")}`, { source: "erDiagram\n  A ||--o{ B : mine", baseUpdatedAt: opened });
  assert.equal(r.status, 409);
  assert.match(fs.readFileSync(path.join(root, "erd.mermaid"), "utf8"), /pulled/);
  r = await call("PUT", `/api/diagrams/${id("erd.mermaid")}`, { source: "erDiagram\n  A ||--o{ B : mine" });
  assert.equal(r.status, 200, "saving without a base overwrites on purpose");
  assert.match(fs.readFileSync(path.join(root, "erd.mermaid"), "utf8"), /mine/);
});

test("creates new files, adds .mmd, makes folders, refuses to overwrite", async () => {
  let r = await call("POST", "/api/diagrams", { title: "design/new/checkout", source: FLOW });
  assert.equal(r.status, 201);
  assert.equal(r.body.diagram.title, "design/new/checkout.mmd");
  assert.ok(fs.existsSync(path.join(root, "design/new/checkout.mmd")));
  assert.equal((await call("POST", "/api/diagrams", { title: "design/new/checkout.mmd", source: FLOW })).status, 409);
  assert.equal((await call("POST", "/api/diagrams", { title: "empty", source: "  " })).status, 400);
});

test("can't read or write outside the folder or other file types", async () => {
  for (const bad of ["../outside/secret.mmd", "link/secret.mmd", "README.md", ".git/y.mmd", "docs/../../outside/secret.mmd", "/etc/passwd", path.join(outside, "secret.mmd")]) {
    const r = await call("GET", `/api/diagrams/${id(bad)}`);
    assert.ok(r.status === 400 || r.status === 404, `${bad} gave ${r.status}`);
    assert.doesNotMatch(JSON.stringify(r.body), /secret --> data/);
  }
  assert.equal((await call("POST", "/api/diagrams", { title: "../outside/evil.mmd", source: FLOW })).status, 400);
  assert.equal((await call("POST", "/api/diagrams", { title: "link/evil.mmd", source: FLOW })).status, 400);
  assert.equal((await call("PUT", `/api/diagrams/${id("link/secret.mmd")}`, { source: FLOW })).status, 400);
  assert.equal(fs.readdirSync(outside).join(), "secret.mmd", "nothing was written outside");
});

test("other websites can't drive it: custom header and localhost-only Host", async () => {
  assert.equal((await call("PUT", `/api/diagrams/${id("docs/flow.mmd")}`, { source: FLOW }, {})).status, 403);
  const status = await new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port: server.address().port, path: "/api/diagrams", headers: { Host: "evil.example.com" } }, (res) => resolve(res.statusCode));
  });
  assert.equal(status, 403, "a request addressed to another host name is refused");
});

test("pages load", async () => {
  for (const p of ["/", "/f/docs/flow.mmd", "/js/editor.js", "/js/local.js", "/vendor/mermaid.min.js"]) assert.equal((await call("GET", p)).status, 200, p);
});
