/* Tests of finding and replacing ```mermaid blocks in Markdown (server/markdown.js). Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findMermaidBlocks, replaceBlock, blockHash, withPlaceholders } from "../server/markdown.js";

const DOC = `# Project

Intro text.

## Checkout flow

\`\`\`mermaid
flowchart TD
    a --> b
\`\`\`

## Not diagrams

\`\`\`js
const s = "\`\`\`mermaid";
\`\`\`

\`\`\`\`markdown
How to write one:
\`\`\`mermaid
flowchart LR
    x --> y
\`\`\`
\`\`\`\`

> \`\`\`mermaid
> flowchart TD
> \`\`\`

## Data model

- In a list:

  ~~~Mermaid title
  erDiagram
      A ||--o{ B : has
  ~~~

Last line, no final newline`;

test("finds only real mermaid blocks, with the nearest heading", () => {
  const blocks = findMermaidBlocks(DOC);
  assert.equal(blocks.length, 2, "skips other languages, a ```mermaid shown inside a longer fence, and block quotes");
  assert.equal(blocks[0].heading, "Checkout flow");
  assert.equal(blocks[0].source, "flowchart TD\n    a --> b");
  assert.equal(blocks[1].heading, "Data model");
  assert.equal(blocks[1].indent, "  ");
  assert.equal(blocks[1].source, "erDiagram\n    A ||--o{ B : has", "the list indent is removed");
  assert.deepEqual(blocks.map((b) => b.index), [1, 2]);
});

test("an unclosed fence hides everything after it", () => {
  assert.equal(findMermaidBlocks("```mermaid\nflowchart TD\n    a --> b\n").length, 0);
  assert.equal(findMermaidBlocks("```\nopen\n```mermaid\nflowchart TD\n```\n").length, 0, "the second fence closes nothing: it opens");
});

test("replacing a block changes only its lines", () => {
  const [, er] = findMermaidBlocks(DOC);
  const out = replaceBlock(DOC, er, "erDiagram\n    A ||--o{ C : owns\n%% layout: A 60 60\n\n");
  const lines = DOC.split("\n"), outLines = out.split("\n");
  assert.deepEqual(outLines.slice(0, er.start), lines.slice(0, er.start), "everything above is identical");
  assert.deepEqual(outLines.slice(er.start + 3), lines.slice(er.end), "everything below is identical");
  assert.deepEqual(outLines.slice(er.start, er.start + 3), ["  erDiagram", "      A ||--o{ C : owns", "  %% layout: A 60 60"], "the indent is put back");
  assert.ok(out.endsWith("no final newline"), "a missing final newline stays missing");
  assert.equal(findMermaidBlocks(out)[1].source, "erDiagram\n    A ||--o{ C : owns\n%% layout: A 60 60");
});

test("Windows line endings are kept", () => {
  const crlf = "Title\r\n\r\n```mermaid\r\nflowchart TD\r\n    a --> b\r\n```\r\nEnd\r\n";
  const [b] = findMermaidBlocks(crlf);
  assert.equal(b.source, "flowchart TD\n    a --> b");
  const out = replaceBlock(crlf, b, "flowchart LR\n    a --> c");
  assert.equal(out, "Title\r\n\r\n```mermaid\r\nflowchart LR\r\n    a --> c\r\n```\r\nEnd\r\n");
});

test("refuses text that would close the block early", () => {
  const [b] = findMermaidBlocks(DOC);
  assert.throws(() => replaceBlock(DOC, b, "flowchart TD\n```\nlater"), /can't contain/);
});

test("the fingerprint ignores trailing space and line endings", () => {
  assert.equal(blockHash("flowchart TD\r\n  a\n\n"), blockHash("flowchart TD\n  a"));
  assert.notEqual(blockHash("flowchart TD\n  a"), blockHash("flowchart TD\n  b"));
});

test("the viewer's text has a marker where each diagram was, numbered like the diagram ids", () => {
  const out = withPlaceholders(DOC);
  assert.equal((out.match(/UNTANGLE-DIAGRAM-\d+/g) || []).join(), "UNTANGLE-DIAGRAM-1,UNTANGLE-DIAGRAM-2");
  assert.doesNotMatch(out, /flowchart TD\n    a --> b/, "the first diagram's fences and text are gone");
  assert.match(out, /\n  UNTANGLE-DIAGRAM-2\n/, "the list indent is kept, so the marker stays inside the list item");
  assert.match(out, /```js\nconst s = "```mermaid";\n```/, "other code blocks are untouched");
  assert.ok(out.endsWith("Last line, no final newline"));
});
