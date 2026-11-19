/* Browser smoke test of the main flows. Run with: npm run test:e2e
   Needs Playwright with Chromium: npm install --no-save playwright && npx playwright install chromium */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
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
    p.on("request", (r) => { if (!r.url().startsWith(B) && !r.url().startsWith(L) && !/^(data|blob):/.test(r.url())) foreign.push(r.url()); });
  };
  const page = await ctx.newPage(); watch(page);
  const api = (method, url, body) => page.evaluate(async ([m, u, b]) => {
    const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "untangle" }, body: b ? JSON.stringify(b) : undefined });
    return r.json();
  }, [method, url, body]);
  const saved = (p = page) => p.waitForFunction(() => document.getElementById("save-status").textContent === "All changes saved", null, { timeout: 15000 });
  const email = `e2e${Date.now()}@example.com`;

  /* local mode: a folder of .mmd files, as the `untangled` command serves it */
  const { createLocalApp } = await import(pathToFileURL(path.join(root, "server/local.js")));
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "untangle-e2e-")));
  fs.mkdirSync(path.join(repo, "docs"));
  const HAND = "%% Team data model. Owner: platform team.\nerDiagram\n  %% identity\n  USERS ||--o{ ORDERS : places\n  ORDERS ||--|{ ORDER_ITEMS : contains\n";
  const erd = path.join(repo, "docs/erd.mmd");
  fs.writeFileSync(erd, HAND);
  const localServer = await new Promise((r) => { const s = createLocalApp({ root: repo }).listen(0, "127.0.0.1", () => r(s)); });
  const L = `http://localhost:${localServer.address().port}`;
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
  step("the less common Mermaid types draw too (catches breakage when Mermaid is upgraded)", async () => {
    const OTHER = {
      gitGraph: "gitGraph\n    commit\n    branch feature\n    checkout feature\n    commit\n    checkout main\n    merge feature",
      xychart: "xychart-beta\n    title \"Orders per day\"\n    x-axis [Mon, Tue, Wed]\n    y-axis \"Orders\" 0 --> 100\n    bar [20, 35, 50]",
      quadrant: "quadrantChart\n    title Features\n    x-axis Low effort --> High effort\n    y-axis Low value --> High value\n    Walkthrough: [0.3, 0.8]",
      sankey: "sankey-beta\n\nVisitors,Signups,40\nVisitors,Left,60",
      kanban: "kanban\n  Todo\n    [Write docs]\n  Doing\n    [Build editor]",
      c4: "C4Context\n    title Delivery system\n    Person(customer, \"Customer\")\n    System(app, \"Delivery app\")\n    Rel(customer, app, \"Orders food\")",
      block: "block-beta\n    columns 3\n    a[\"App\"] b[\"API\"] c[\"DB\"]",
      requirement: "requirementDiagram\n    requirement fast {\n    id: 1\n    text: Load in 2 seconds\n    risk: low\n    verifymethod: test\n    }",
    };
    for (const [name, source] of Object.entries(OTHER)) {
      const { diagram } = await api("POST", "/api/diagrams", { title: name, source });
      await page.goto(`${B}/d/${diagram.id}`);
      await page.waitForFunction(() => document.querySelector("#mview svg") || (document.getElementById("v-err") && !document.getElementById("v-err").hidden), null, { timeout: 20000 });
      assert.equal(await page.locator("#mview svg").count(), 1, `${name}: ${await page.textContent("#v-err").catch(() => "not drawn")}`);
      assert.ok(await page.locator(".orow").count() > 0, `${name}: the outline editor is empty`);
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
  step("lines go around boxes instead of through them, and labels stay off boxes", async () => {
    const SKIP = "flowchart LR\n    a[Start] -->|next| b[Middle] -->|then| c[End]\n    a -->|skip the middle| c\n    b -->|back| a";
    const { diagram } = await api("POST", "/api/diagrams", { title: "Skip", source: SKIP });
    await page.goto(`${B}/d/${diagram.id}`); await page.waitForSelector(".node");
    await page.click("#t-tidy"); await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll("#world .node:not(.grp)")].map((e) => e.getBoundingClientRect());
      const inBox = (x, y) => boxes.some((b) => x > b.left + 3 && x < b.right - 3 && y > b.top + 3 && y < b.bottom - 3);
      let through = 0;
      document.querySelectorAll("#world .edge-line").forEach((pa) => { const L = pa.getTotalLength(), m = pa.getScreenCTM();
        for (let d = 6; d < L - 6; d += 4) { const q = pa.getPointAtLength(d); if (inBox(m.a * q.x + m.e, m.d * q.y + m.f)) { through++; break; } } });
      const onBox = [...document.querySelectorAll("#world .lbl rect")].map((e) => e.getBoundingClientRect())
        .filter((l) => boxes.some((b) => l.left < b.right - 1 && b.left < l.right - 1 && l.top < b.bottom - 1 && b.top < l.bottom - 1)).length;
      return { through, onBox, lines: document.querySelectorAll("#world .edge-line").length };
    });
    assert.equal(r.lines, 4);
    assert.equal(r.through, 0, "a line passes through a box");
    assert.equal(r.onBox, 0, "a label covers a box");
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
  step("local mode: the folder's files are listed, and opening one doesn't change it", async () => {
    await page.setViewportSize({ width: 1366, height: 860 });
    await page.goto(L + "/"); await page.waitForSelector(".files a");
    assert.match(await page.textContent(".files"), /docs\/erd\.mmd/);
    const before = fs.statSync(erd).mtimeMs;
    await page.click(".files a"); await page.waitForSelector(".node");
    assert.equal(await page.locator(".node").count(), 3);
    assert.match(await page.textContent("#info-alert"), /1 comment line inside the diagram/);
    assert.equal(await page.getAttribute("#doc-title", "readonly"), "");
    assert.equal(await page.isHidden("#b-share"), true);
    await page.waitForTimeout(1500); await page.reload(); await page.waitForSelector(".node");
    assert.equal(fs.readFileSync(erd, "utf8"), HAND);
    assert.equal(fs.statSync(erd).mtimeMs, before, "the file was not rewritten");
  });
  step("local mode: an edit is written to the file, keeping the comment at the top", async () => {
    const box = await page.locator('[data-hit^="title:"]').first().boundingBox();
    await page.mouse.move(box.x + 20, box.y + 10); await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 60, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(() => document.getElementById("save-status").textContent === "Saved to file", null, { timeout: 10000 });
    const text = fs.readFileSync(erd, "utf8");
    assert.ok(text.startsWith("%% Team data model. Owner: platform team.\nerDiagram\n"), "top comment kept");
    assert.match(text, /USERS \|\|--o\{ ORDERS : places/);
    assert.match(text, /%% layout: USERS /);
    assert.ok(text.endsWith("\n") && !text.endsWith("\n\n"));
  });
  step("local mode: a change made on disk is not overwritten", async () => {
    await page.waitForTimeout(30);
    fs.writeFileSync(erd, "erDiagram\n  USERS ||--o{ INVOICES : pulled_from_git\n");
    await page.click("#t-add"); await page.keyboard.type("PAYMENTS"); await page.keyboard.press("Enter");
    await page.waitForSelector("#save-alert:not([hidden])");
    assert.match(await page.textContent("#save-alert"), /changed on disk/);
    assert.match(fs.readFileSync(erd, "utf8"), /pulled_from_git/);
    await Promise.all([page.waitForEvent("load"), page.click("#cf-latest")]);
    await page.waitForSelector(".node");
    assert.match(await page.textContent("#world"), /INVOICES/);
  });
  step("local mode: a new diagram creates a file", async () => {
    await page.goto(L + "/"); await page.click("#new-btn");
    await page.fill("#new-name", "design/login-flow"); await page.click('[data-tpl="blank-flow"]');
    await page.waitForURL("**/f/design/login-flow.mmd"); await page.waitForSelector(".node");
    assert.match(fs.readFileSync(path.join(repo, "design/login-flow.mmd"), "utf8"), /^flowchart TD/);
  });
  step("local mode: a diagram inside a Markdown file is edited in place, and <br> labels survive", async () => {
    const md = path.join(repo, "docs/guide.md");
    const GUIDE = "# Guide\n\nIntro paragraph.\n\n## Login\n\n```mermaid\nflowchart TD\n    a[Open app] --> b[Sign in]\n```\n\n## Data model\n\n```mermaid\nflowchart LR\n    u[Two<br/>lines] -->|first<br>second| v[End]\n```\n\nOutro.\n";
    fs.writeFileSync(md, GUIDE);
    await page.goto(L + "/"); await page.waitForSelector(".files a");
    assert.match(await page.textContent(".files"), /guide\.mdData model/, "the heading is shown next to the file name");
    await page.click('.files a[href$="guide.md%232"]'); await page.waitForSelector(".node");
    assert.equal(await page.inputValue("#doc-title"), "docs/guide.md · Data model");
    const texts = await page.$$eval("#world text", (t) => t.map((x) => x.textContent));
    assert.ok(texts.includes("Two") && texts.includes("lines") && texts.includes("first") && texts.includes("second"), `<br> should split lines: ${texts}`);
    assert.ok(!texts.some((t) => /<br/i.test(t)), "no literal <br> on the canvas");
    const box = await page.locator('[data-hit^="node:"]').first().boundingBox();
    await page.mouse.move(box.x + 20, box.y + 10); await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 90, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(() => document.getElementById("save-status").textContent === "Saved to file", null, { timeout: 10000 });
    const text = fs.readFileSync(md, "utf8"), [head, rest] = GUIDE.split("```mermaid\nflowchart LR");
    assert.ok(text.startsWith(head + "```mermaid\nflowchart LR\n"), "everything above the block is unchanged");
    assert.ok(text.endsWith("```\n\nOutro.\n"), "everything below the block is unchanged");
    assert.match(text, /u\["Two<br\/>lines"\]/, "the <br/> is written back as it was");
    assert.match(text, /\|first<br>second\|/);
    assert.match(text, /%% layout: u /, "the layout is saved inside the block");
    assert.equal(rest.length > 0, true);
  });
  step("local mode: the Markdown viewer shows the document with live diagrams, and scripts in it don't run", async () => {
    const md = path.join(repo, "docs/viewer.md");
    fs.writeFileSync(md, "# Viewer test\n\nSee [the guide](guide.md).\n\n<script>window.HACKED = 1</script><img src=x onerror=\"window.HACKED = 2\">\n\n## Flow\n\n```mermaid\nflowchart TD\n    a[One] --> b[Two]\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n");
    await page.goto(L + "/"); await page.waitForSelector(".doc-row");
    await Promise.all([page.waitForURL("**/m/docs/viewer.md"), page.click('.doc-row a[href="/m/docs/viewer.md"]')]);
    await page.waitForSelector(".md-diagram iframe");
    assert.equal(await page.textContent("#doc h1"), "Viewer test");
    assert.equal(await page.locator("#doc table").count(), 1);
    assert.equal(await page.getAttribute('#doc a[href^="/m/"]', "href"), "/m/docs/guide.md", "links to other Markdown files open in the viewer");
    const frame = page.frameLocator(".md-diagram iframe");
    await frame.locator("#world .node").first().waitFor();
    assert.equal(await frame.locator("#world .node").count(), 2);
    assert.equal(await frame.locator("#t-add").isHidden(), true, "the embedded diagram is read-only");
    assert.equal(await page.evaluate(() => window.HACKED), undefined, "script in the Markdown was not run");
    await Promise.all([page.waitForURL("**/f/docs/viewer.md%231"), page.click(".md-dbar a")]);
    await page.waitForSelector(".node");
    assert.equal(await page.isVisible("#t-add"), true, "Edit opens the full editor");
  });
  step("Tidy options rearrange at once, can be undone, and are remembered", async () => {
    await page.click("#t-tidy-opt"); await page.waitForSelector("#tidy-menu:not([hidden])");
    await page.click('#tidy-menu [data-opt="style"] [data-v="grid"]'); await page.waitForTimeout(300);
    assert.equal(await page.getAttribute('#tidy-menu [data-v="grid"]', "aria-pressed"), "true");
    assert.equal(await page.isEnabled("#t-undo"), true);
    await page.click('#tidy-menu [data-opt="style"] [data-v="organic"]'); await page.waitForTimeout(300);
    assert.equal(await page.isDisabled('#tidy-menu [data-opt="dir"] [data-v="LR"]'), true, "organic has no direction");
    await page.keyboard.press("Escape"); assert.equal(await page.isHidden("#tidy-menu"), true);
    await page.reload(); await page.waitForSelector(".node");
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("untangle-tidy"))).style, "organic");
    await page.evaluate(() => localStorage.removeItem("untangle-tidy"));
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
  await browser.close(); server.close(); localServer.close(); fs.rmSync(repo, { recursive: true, force: true });
  console.log(failed ? `\n${failed} of ${steps.length} steps failed` : `\nAll ${steps.length} steps passed`);
  process.exit(failed ? 1 : 0);
})();
