/* Mermaid diagrams inside Markdown files: finding the ```mermaid blocks and replacing one of them.
   Used by local mode (server/local.js) and the `untangled` command.

   The rule that matters most: saving a diagram changes only the lines inside its block. Every other byte
   of the file (text, other code blocks, line endings, the final newline) stays exactly as it was.
   test/markdown.test.js checks this.

   What counts as a diagram block:
     ```mermaid  or  ~~~mermaid   (three or more backticks or tildes, any case, extra info after it allowed)
     ...
     ```                          (same character, at least as many, nothing else on the line)
   The fence may be indented (for example inside a list item); that indent is removed when reading and put
   back when writing. Not supported: fences inside block quotes ("> ```mermaid"), and a block that is never
   closed (it is ignored rather than guessed at). Fences of other languages are skipped, so a ```markdown
   example that shows a ```mermaid block is not mistaken for a diagram. */
import crypto from "node:crypto";

const OPEN = /^( *)(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/** Short fingerprint of a diagram's text. The editor sends it back on save so the server can find the
    same block again if lines were added above it, and can tell when the block itself was changed. */
export const blockHash = (source) => crypto.createHash("sha1").update(source.replace(/\r\n/g, "\n").replace(/\s+$/, "")).digest("hex").slice(0, 16);

/** Finds the Mermaid blocks of a Markdown text.
    Returns [{ index (1-based), start, end, indent, source, heading }], where start..end-1 are the line
    numbers (0-based) of the block's content, without the fences, and heading is the nearest heading above. */
export function findMermaidBlocks(text) {
  const lines = String(text).split("\n").map((l) => l.replace(/\r$/, ""));
  const blocks = [];
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i]);
    if (!open) { const h = HEADING.exec(lines[i]); if (h) heading = h[1].replace(/[*_`]/g, "").trim(); continue; }
    const [, indent, fence, info] = open;
    const close = new RegExp(`^ *${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    if (j >= lines.length) break; // never closed: the rest of the file is one code block, so nothing more to find
    if (info.toLowerCase() === "mermaid") {
      const body = lines.slice(i + 1, j).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.replace(/^ +/, "")));
      blocks.push({ index: blocks.length + 1, start: i + 1, end: j, indent, source: body.join("\n"), heading });
    }
    i = j;
  }
  return blocks;
}

/** Returns text with the content of `block` replaced by `source`. Throws if source would break the file. */
export function replaceBlock(text, block, source) {
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const body = String(source).replace(/\r\n/g, "\n").replace(/\s+$/, "").split("\n");
  if (body.some((l) => /^\s*(`{3,}|~{3,})/.test(l))) throw new Error("A diagram inside a Markdown file can't contain a line starting with ``` or ~~~.");
  // Split on \n only, so the lines around the block keep their own \r if the file uses Windows line endings.
  const lines = String(text).split("\n");
  const out = body.map((l) => (l ? block.indent + l : l) + (eol === "\r\n" ? "\r" : ""));
  lines.splice(block.start, block.end - block.start, ...out);
  return lines.join("\n");
}

/** The Markdown text with each diagram block (fences included) replaced by a line `UNTANGLE-DIAGRAM-<n>`,
    so the viewer can render the rest as Markdown and put the live diagram where the marker lands.
    The numbers match findMermaidBlocks, so they are also the diagram ids (README.md#n). */
export function withPlaceholders(text, blocks = findMermaidBlocks(text)) {
  const lines = String(text).split("\n").map((l) => l.replace(/\r$/, ""));
  for (const b of [...blocks].reverse()) lines.splice(b.start - 1, b.end - b.start + 2, "", `${b.indent}UNTANGLE-DIAGRAM-${b.index}`, "");
  return lines.join("\n");
}
