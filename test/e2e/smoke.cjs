/* Browser smoke test of the main flows. Run with: npm run test:e2e
   Needs Playwright with Chromium: npm install --no-save playwright && npx playwright install chromium */
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
let chromium;
try { ({ chromium } = require("playwright")); }
catch { console.error("Playwright is not installed. Run: npm install --no-save playwright && npx playwright install chromium"); process.exit(2); }

const steps = [];
const step = (name, fn) => steps.push([name, fn]);
const FLOW = "flowchart TD\n    a[Start] --> b{Choice}\n    b -->|Yes| c[Done]\n    b -->|No| a";
const ISLANDS = "erDiagram\n" + ["A", "B", "C", "D", "E", "F"].map((p) => `  ${p}1 ||--o{ ${p}2 : has\n  ${p}2 ||--o{ ${p}3 : has`).join("\n");

(async () => {
  const root = path.join(__dirname, "..", "..");
  const { openDb } = await import(pathToFileURL(path.join(root, "server/db.js")));
  const { createApp } = await import(pathToFileURL(path.join(root, "server/app.js")));
  const sent = [];
  const app = createApp({ db: openDb(":memory:"), mailer: { configured: true, send: async (m) => { sent.push(m); } } });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const B = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, acceptDownloads: true });
  const errors = [], foreign = [];
  const watch = (p) => {
    p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error" && !/status of (401|404|409)/.test(m.text())) errors.push(`${p.url()}: ${m.text()}`); });
    p.on("request", (r) => { if (!r.url().startsWith(B) && !/^(data|blob):/.test(r.url())) foreign.push(r.url()); });
  };
  const page = await ctx.newPage(); watch(page);
  const api = (method, url, body) => page.evaluate(async ([m, u, b]) => {
    const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "untangle" }, body: b ? JSON.stringify(b) : undefined });
    return r.json();
  }, [method, url, body]);
  const saved = (p = page) => p.waitForFunction(() => document.getElementById("save-status").textContent === "All changes saved", null, { timeout: 15000 });
  const email = `e2e${Date.now()}@example.com`;
  let flowId, shareLink;

  step("landing page loads and links to sign-up", async () => {
    await page.goto(B + "/");
    assert.match(await page.textContent("h1"), /untangled/);
    await page.click('a.btn.primary.big[href="/signup"]');
    await page.waitForURL("**/signup");
  });
  step("sign up lands on an empty dashboard", async () => {
    await page.fill("#name", "E2E"); await page.fill("#email", email); await page.fill("#password", "first password");
    await page.click("button[type=submit]"); await page.waitForURL("**/app");
    await page.waitForSelector("#empty:not([hidden])");
  });
  step("every template opens, draws, and its code is valid Mermaid", async () => {
    await page.goto(B + "/demo"); await page.waitForSelector("#kind-tag");
    const templates = await page.evaluate(() => window.UNTANGLE_TEMPLATES.map((t) => ({ id: t.id, title: t.title, source: t.source })));
    assert.ok(templates.length >= 13);
    for (const t of templates) {
      const { diagram } = await api("POST", "/api/diagrams", { title: t.title, source: t.source });
      await page.goto(`${B}/d/${diagram.id}`);
      await page.waitForFunction(() => document.querySelector("#world .node, #mview svg"), null, { timeout: 20000 }).catch(() => { throw new Error(`${t.id}: nothing was drawn`); });
      if (!(await page.isDisabled("#m-edit"))) { // editable type: check Mermaid accepts the code we write
        await page.click("#m-mmd");
        await page.waitForFunction(() => document.querySelector("#mview svg") || /couldn't draw/.test(document.getElementById("pane-inspect").textContent), null, { timeout: 20000 });
        assert.equal(await page.locator("#mview svg").count(), 1, `${t.id}: Mermaid rejected the exported code`);
      } else {
        assert.equal(await page.isVisible("#v-err"), false, `${t.id}: Mermaid reported an error`);
      }
    }
  });
  step("dragging a box saves, and the layout survives a reload", async () => {
    flowId = (await api("POST", "/api/diagrams", { title: "Smoke flow", source: FLOW })).diagram.id;
    await page.goto(`${B}/d/${flowId}`); await page.waitForSelector(".node");
    const box = await page.locator('[data-hit^="node:"]').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 30, { steps: 5 }); await page.mouse.up();
    await saved();
    const before = (await api("GET", `/api/diagrams/${flowId}`)).diagram;
    assert.match(before.source, /%% layout: a /);
    await page.reload(); await page.waitForSelector(".node");
    await page.click("#tab-code");
    assert.equal((await page.inputValue("#code")).trim(), before.source.trim());
    assert.equal((await api("GET", `/api/diagrams/${flowId}`)).diagram.updatedAt, before.updatedAt, "opening a diagram doesn't mark it as edited");
  });
  step("a second tab is warned instead of overwriting", async () => {
    const tab2 = await ctx.newPage(); watch(tab2);
    await tab2.goto(`${B}/d/${flowId}`); await tab2.waitForSelector(".node");
    await page.fill("#doc-title", "Renamed in tab one"); await page.press("#doc-title", "Enter"); await saved();
    await tab2.fill("#doc-title", "Renamed in tab two"); await tab2.press("#doc-title", "Enter");
    await tab2.waitForSelector("#save-alert:not([hidden])");
    assert.equal((await api("GET", `/api/diagrams/${flowId}`)).diagram.title, "Renamed in tab one");
    await tab2.click("#cf-mine"); await saved(tab2);
    assert.equal((await api("GET", `/api/diagrams/${flowId}`)).diagram.title, "Renamed in tab two");
    await tab2.close();
  });
  step("Tidy keeps separate parts of a diagram together", async () => {
    const { diagram } = await api("POST", "/api/diagrams", { title: "Islands", source: ISLANDS });
    await page.goto(`${B}/d/${diagram.id}`); await page.waitForSelector(".node");
    await page.click("#t-tidy"); await page.waitForTimeout(400);
    const size = await page.evaluate(() => { const g = [...document.querySelectorAll(".node")].map((n) => n.getAttribute("transform").match(/translate\(([-\d.]+),([-\d.]+)\)/).slice(1).map(Number)); const xs = g.map((a) => a[0]), ys = g.map((a) => a[1]); return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), n: g.length }; });
    assert.equal(size.n, 18);
    assert.ok(size.w < 2200 && size.h < 1200, `diagram spread too far: ${size.w} × ${size.h}`);
  });
  step("exporting a PNG downloads a file", async () => {
    await page.click("#t-export"); await page.click('[data-x="image"]');
    await page.waitForFunction(() => !document.getElementById("x-save").disabled, null, { timeout: 15000 });
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#x-save")]);
    assert.match(download.suggestedFilename(), /\.png$/);
    await page.click("#x-close");
  });
  step("a share link is read-only for visitors", async () => {
    await page.goto(`${B}/d/${flowId}`); await page.waitForSelector(".node");
    await page.click("#b-share"); await page.check("#s-on");
    await page.waitForFunction(() => document.getElementById("s-link").value.includes("/s/"));
    shareLink = await page.inputValue("#s-link");
    const visitor = await browser.newContext(); const v = await visitor.newPage(); watch(v);
    await v.goto(shareLink); await v.waitForSelector(".node");
    assert.equal(await v.isHidden("#t-add"), true);
    assert.equal(await v.getAttribute("#doc-title", "readonly"), "");
    assert.match(await v.textContent("#owner"), /Shared by E2E/);
    await visitor.close();
  });
  step("forgotten password: the emailed link sets a new password and logs in", async () => {
    await api("POST", "/api/auth/logout", {});
    await page.goto(B + "/login"); await page.click('a[href="/forgot"]'); await page.waitForURL("**/forgot");
    await page.fill("#email", email); await page.click("button[type=submit]");
    await page.waitForSelector("#msg.ok");
    assert.equal(sent.length, 1);
    const link = sent[0].text.match(/http\S+\/reset\?token=[\w-]+/)[0];
    await page.goto(link); await page.fill("#password", "second password"); await page.click("button[type=submit]");
    await page.waitForURL("**/app");
    await page.waitForSelector(".card");
  });
  step("phone width: no sideways scrolling", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ["/", "/app", `/d/${flowId}`, "/account", "/privacy"]) {
      await page.goto(B + url); await page.waitForTimeout(300);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= 390, `${url} is ${w}px wide on a 390px screen`);
    }
  });
  step("no script errors and no requests to other sites", async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual([...new Set(foreign)], []);
  });

  let failed = 0;
  for (const [name, fn] of steps) {
    const t0 = Date.now();
    try { await fn(); console.log(`ok   ${name} (${Date.now() - t0} ms)`); }
    catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).split("\n")[0]}`); }
  }
  await browser.close(); server.close();
  console.log(failed ? `\n${failed} of ${steps.length} steps failed` : `\nAll ${steps.length} steps passed`);
  process.exit(failed ? 1 : 0);
})();
