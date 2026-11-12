import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../server/db.js";
import { createApp, detectKind } from "../server/app.js";

let server, base;
before(async () => {
  const app = createApp({ db: openDb(":memory:") });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/** A tiny client that keeps its own session cookie. */
function client() {
  let cookie = "";
  return async (method, path, body, { header = true } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: "manual",
      headers: { "Content-Type": "application/json", ...(header ? { "X-Requested-With": "untangle" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") || "";
    return { status: res.status, body: type.includes("json") ? await res.json() : await res.text(), headers: res.headers };
  };
}
const FLOW = "flowchart TD\n    a[Start] --> b[End]";

test("detectKind reads the diagram type", () => {
  assert.equal(detectKind(FLOW), "flow");
  assert.equal(detectKind("%% comment\nerDiagram\n A ||--o{ B : x"), "er");
  assert.equal(detectKind("---\ntitle: x\n---\nsequenceDiagram\n A->>B: hi"), "seq");
  assert.equal(detectKind("pie title X\n \"a\" : 1"), "pie");
});

test("sign up, log out, log in", async () => {
  const c = client();
  let r = await c("POST", "/api/auth/signup", { name: "Asha", email: "Asha@Example.com", password: "short" });
  assert.equal(r.status, 400);
  r = await c("POST", "/api/auth/signup", { name: "Asha", email: "Asha@Example.com", password: "long enough pw" });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.email, "asha@example.com");
  r = await c("GET", "/api/me");
  assert.equal(r.body.user.name, "Asha");
  r = await c("POST", "/api/auth/signup", { name: "Again", email: "asha@example.com", password: "long enough pw" });
  assert.equal(r.status, 409);
  r = await c("POST", "/api/auth/logout", {});
  assert.equal((await c("GET", "/api/me")).status, 401);
  r = await c("POST", "/api/auth/login", { email: "asha@example.com", password: "wrong password" });
  assert.equal(r.status, 401);
  r = await c("POST", "/api/auth/login", { email: "ASHA@example.com", password: "long enough pw" });
  assert.equal(r.status, 200);
  assert.equal((await c("GET", "/api/me")).status, 200);
});

test("mutations without the custom header are refused", async () => {
  const c = client();
  const r = await c("POST", "/api/auth/signup", { name: "X", email: "x@example.com", password: "long enough pw" }, { header: false });
  assert.equal(r.status, 403);
});

test("diagram create, list, update, versions, duplicate, delete", async () => {
  const c = client();
  await c("POST", "/api/auth/signup", { name: "Ravi", email: "ravi@example.com", password: "long enough pw" });
  let r = await c("POST", "/api/diagrams", { title: "Checkout", source: FLOW });
  assert.equal(r.status, 201);
  const id = r.body.diagram.id;
  assert.equal(r.body.diagram.kind, "flow");
  r = await c("POST", "/api/diagrams", { title: "Empty", source: "   " });
  assert.equal(r.status, 400);
  r = await c("PUT", `/api/diagrams/${id}`, { source: FLOW + "\n    b --> c[More]", thumb: "<svg xmlns='http://www.w3.org/2000/svg'></svg>" });
  assert.equal(r.status, 200);
  r = await c("PUT", `/api/diagrams/${id}`, { source: "sequenceDiagram\n    A->>B: hi", checkpoint: true });
  assert.equal(r.body.diagram.kind, "seq");
  r = await c("GET", `/api/diagrams/${id}/versions`);
  assert.equal(r.body.versions.length, 2, "edits within 5 minutes fold into one version; a checkpoint starts a new one");
  const old = r.body.versions[1].id;
  r = await c("GET", `/api/diagrams/${id}/versions/${old}`);
  assert.match(r.body.version.source, /More/);
  r = await c("GET", "/api/diagrams");
  assert.equal(r.body.diagrams.length, 1);
  assert.equal(r.body.diagrams[0].has_thumb, true);
  r = await c("GET", `/api/diagrams/${id}/thumb`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /sandbox/);
  r = await c("POST", `/api/diagrams/${id}/duplicate`);
  assert.equal(r.body.diagram.title, "Checkout (copy)");
  assert.equal((await c("GET", "/api/diagrams")).body.diagrams.length, 2);
  r = await c("DELETE", `/api/diagrams/${id}`);
  assert.equal(r.status, 200);
  assert.equal((await c("GET", `/api/diagrams/${id}`)).status, 404);
});

test("other people can't read or change your diagrams", async () => {
  const owner = client(), other = client();
  await owner("POST", "/api/auth/signup", { name: "O", email: "owner@example.com", password: "long enough pw" });
  await other("POST", "/api/auth/signup", { name: "P", email: "other@example.com", password: "long enough pw" });
  const id = (await owner("POST", "/api/diagrams", { title: "Private", source: FLOW })).body.diagram.id;
  assert.equal((await other("GET", `/api/diagrams/${id}`)).status, 404);
  assert.equal((await other("PUT", `/api/diagrams/${id}`, { title: "Hacked" })).status, 404);
  assert.equal((await other("DELETE", `/api/diagrams/${id}`)).status, 404);
  assert.equal((await other("GET", `/api/diagrams/${id}/versions`)).status, 404);
  assert.equal((await client()("GET", `/api/diagrams/${id}`)).status, 401);
});

test("share links: on, public read, copy, off", async () => {
  const owner = client(), viewer = client(), anon = client();
  await owner("POST", "/api/auth/signup", { name: "Meena", email: "meena@example.com", password: "long enough pw" });
  await viewer("POST", "/api/auth/signup", { name: "Viewer", email: "viewer@example.com", password: "long enough pw" });
  const id = (await owner("POST", "/api/diagrams", { title: "Shared flow", source: FLOW })).body.diagram.id;
  const token = (await owner("POST", `/api/diagrams/${id}/share`, { enabled: true })).body.shareToken;
  assert.ok(token);
  let r = await anon("GET", `/api/share/${token}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.diagram.owner, "Meena");
  assert.equal(r.body.diagram.id, undefined, "the private id is not exposed");
  assert.equal((await anon("POST", `/api/share/${token}/copy`)).status, 401);
  r = await viewer("POST", `/api/share/${token}/copy`);
  assert.equal(r.status, 201);
  assert.equal((await viewer("GET", "/api/diagrams")).body.diagrams.length, 1);
  await owner("POST", `/api/diagrams/${id}/share`, { enabled: false });
  assert.equal((await anon("GET", `/api/share/${token}`)).status, 404);
});

test("account: rename, change password, delete", async () => {
  const c = client();
  await c("POST", "/api/auth/signup", { name: "Kumar", email: "kumar@example.com", password: "long enough pw" });
  assert.equal((await c("PATCH", "/api/me", { name: "Kumar R" })).body.user.name, "Kumar R");
  assert.equal((await c("POST", "/api/me/password", { current: "nope nope", next: "another long pw" })).status, 400);
  assert.equal((await c("POST", "/api/me/password", { current: "long enough pw", next: "another long pw" })).status, 200);
  assert.equal((await c("GET", "/api/me")).status, 200, "the current session survives a password change");
  await c("POST", "/api/diagrams", { title: "Doomed", source: FLOW });
  assert.equal((await c("DELETE", "/api/me", { password: "long enough pw" })).status, 400);
  assert.equal((await c("DELETE", "/api/me", { password: "another long pw" })).status, 200);
  assert.equal((await client()("POST", "/api/auth/login", { email: "kumar@example.com", password: "another long pw" })).status, 401);
});

test("pages: logged-out users are sent to log in; public pages load", async () => {
  const anon = client();
  let r = await anon("GET", "/app");
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location"), /^\/login\?next=%2Fapp/);
  for (const p of ["/", "/login", "/signup", "/demo", "/s/whatever", "/js/editor.js", "/vendor/mermaid.min.js"]) {
    assert.equal((await anon("GET", p)).status, 200, p);
  }
  assert.equal((await anon("GET", "/nope")).status, 404);
  const user = client();
  await user("POST", "/api/auth/signup", { name: "L", email: "l@example.com", password: "long enough pw" });
  r = await user("GET", "/login");
  assert.equal(r.status, 302, "logged-in users skip the login page");
});
