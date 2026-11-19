/* Markdown viewer for local mode, at /m/<path to a .md file>.
   The server sends the file's text with each ```mermaid block replaced by a marker line UNTANGLE-DIAGRAM-<n>
   (server/markdown.js, withPlaceholders). The rest is rendered with marked, cleaned with DOMPurify, and each
   marker becomes a live Untangle diagram: the editor in read-only embed mode (/f/<path>%23<n>?embed=1) in a frame.
   Relative links to other Markdown files open in this viewer; relative images are served from /raw/. */
import { Marked } from "/vendor/marked.esm.js";
import DOMPurify from "/vendor/purify.es.mjs";
import { api, esc } from "/js/api.js";

const $ = (id) => document.getElementById(id);
const FILE = decodeURIComponent(location.pathname.slice(3));
const DIR = FILE.includes("/") ? FILE.slice(0, FILE.lastIndexOf("/") + 1) : "";
const KIND = { er: "ER diagram", flow: "Flowchart", seq: "Sequence diagram", classDiagram: "Class diagram", stateDiagram: "State diagram", "stateDiagram-v2": "State diagram" };
const pathUrl = (p) => p.split("/").map(encodeURIComponent).join("/");
const marked = new Marked({ gfm: true });
let shown = null; // updatedAt of what's on screen

/** Resolves a link written relative to this document ("../x.md", "img/a.png") to a path from the folder root,
    or null when it leaves the folder or isn't relative. */
function resolve(href) {
  if (!href || /^([a-z][\w+.-]*:|\/\/|#|\/)/i.test(href)) return null;
  const out = [];
  for (const part of (DIR + href.split(/[?#]/)[0]).split("/")) {
    if (part === "..") { if (!out.length) return null; out.pop(); } else if (part && part !== ".") out.push(decodeURIComponent(part));
  }
  return out.join("/");
}
/** GitHub-style heading ids, so in-page links (#getting-started) work. */
function slugger() {
  const seen = new Map();
  return (text) => {
    const base = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(base) || 0; seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

function render(r) {
  const html = marked.parse(r.text).replace(/<p>UNTANGLE-DIAGRAM-(\d+)<\/p>|UNTANGLE-DIAGRAM-(\d+)/g, (_, a, b) => `<div class="md-diagram" data-block="${a || b}"></div>`);
  const doc = $("doc");
  doc.innerHTML = DOMPurify.sanitize(html);
  const slug = slugger();
  doc.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => { if (!h.id) h.id = slug(h.textContent); });
  doc.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href"), p = resolve(href), hash = href.includes("#") ? href.slice(href.indexOf("#")) : "";
    if (p && /\.(md|markdown)$/i.test(p)) a.href = "/m/" + pathUrl(p) + hash;
    else if (p && /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p)) a.href = "/raw/" + pathUrl(p);
    else if (/^https?:/i.test(href)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  });
  doc.querySelectorAll("img[src]").forEach((img) => { const p = resolve(img.getAttribute("src")); if (p && /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p)) img.src = "/raw/" + pathUrl(p); });
  doc.querySelectorAll(".md-diagram").forEach((box) => {
    const b = r.blocks.find((x) => String(x.index) === box.dataset.block);
    if (!b) { box.remove(); return; }
    const name = b.title.slice(r.path.length + 3) || "Diagram";
    box.innerHTML = `<div class="md-dbar"><div><b>${esc(name)}</b> <span>· ${esc(KIND[b.kind] || "Mermaid")}</span></div>
      <a class="btn primary" href="/f/${pathUrl(b.path)}">Edit</a></div>
      <div class="md-frame"><iframe src="/f/${pathUrl(b.path)}?embed=1" title="${esc(name)}" loading="lazy" allow="fullscreen"></iframe></div>`;
  });
  if (location.hash && !shown) { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView(); }
  shown = r.updatedAt;
}

async function load() {
  try {
    const r = await api(`/api/markdown/${encodeURIComponent(FILE)}`);
    if (r.updatedAt === shown) return; // unchanged since it was drawn: keep the diagrams as they are
    const name = FILE.slice(FILE.lastIndexOf("/") + 1);
    $("name").textContent = name; $("path").textContent = FILE; document.title = `${name} · Untangle`;
    $("count").textContent = r.blocks.length ? `Markdown · ${r.blocks.length} diagram${r.blocks.length === 1 ? "" : "s"}` : "Markdown · no diagrams";
    $("msg").textContent = "";
    render(r);
  } catch (e) { $("msg").className = "msg err"; $("msg").textContent = e.message; }
}
window.addEventListener("focus", load); // after editing a diagram, or a git pull
load();
