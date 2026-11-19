/* File list for local mode (the `untangled` command). Each entry is a .mmd file, or one ```mermaid block of a
   Markdown file (f.block is set, f.path is "README.md#2" and f.title is "README.md · <nearest heading>"). */
import { api, esc } from "/js/api.js";
const $ = (id) => document.getElementById(id);
const KIND = { er: "ER diagram", flow: "Flowchart", seq: "Sequence", classDiagram: "Class", stateDiagram: "State", "stateDiagram-v2": "State", gantt: "Gantt", pie: "Pie chart", mindmap: "Mindmap", timeline: "Timeline", gitGraph: "Git graph", journey: "Journey", quadrantChart: "Quadrant", unknown: "Mermaid" };
let files = [];
const link = (rel) => "/f/" + rel.split("/").map(encodeURIComponent).join("/");
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: s > 31536000 ? "numeric" : undefined });
}
function render() {
  const q = $("search").value.trim().toLowerCase();
  const list = files.filter((f) => f.title.toLowerCase().includes(q));
  $("count").textContent = `${files.length} diagram${files.length === 1 ? "" : "s"}`;
  $("empty").hidden = files.length > 0;
  $("files").hidden = files.length === 0;
  $("files").innerHTML = list.length ? list.map((f) => {
    const file = f.file || f.path || f.title, i = file.lastIndexOf("/");
    const part = f.block ? `<span class="fblock">${esc(f.title.slice(file.length + 3))}</span>` : "";
    return `<li><a href="${link(f.path || f.title)}"><span class="fname"><span class="fdir">${esc(file.slice(0, i + 1))}</span><b>${esc(file.slice(i + 1))}</b>${part}</span><span class="fmeta">${esc(KIND[f.kind] || f.kind)}${f.block ? " in Markdown" : ""} · ${ago(f.updated_at)}</span></a></li>`;
  }).join("") : `<li class="none">No files match "${esc(q)}".</li>`;
}
async function load() {
  try {
    const r = await api("/api/diagrams");
    files = r.diagrams; $("folder").textContent = r.name; $("root").textContent = r.root;
    document.title = `${r.name} · Untangle`;
    render();
  } catch (e) { $("dash-msg").className = "msg err"; $("dash-msg").textContent = e.message; }
}
function openNew() {
  const T = window.UNTANGLE_TEMPLATES || [];
  $("tpls").innerHTML = T.map((t) => `<button type="button" class="tpl" data-tpl="${t.id}"><span class="k">${esc(t.kind)}</span><b>${esc(t.title)}</b><small>${esc(t.desc)}</small></button>`).join("");
  $("tpls").querySelectorAll("[data-tpl]").forEach((b) => b.onclick = async () => {
    const t = T.find((x) => x.id === b.dataset.tpl);
    $("new-msg").textContent = "";
    try { const { diagram } = await api("/api/diagrams", { method: "POST", body: { title: $("new-name").value, source: t.source } }); location.href = link(diagram.path || diagram.title); }
    catch (e) { $("new-msg").className = "msg err"; $("new-msg").textContent = e.message; }
  });
  $("new-msg").textContent = ""; $("new-modal").hidden = false; $("new-name").focus(); $("new-name").select();
}
$("new-form").onsubmit = (e) => e.preventDefault();
$("new-btn").onclick = openNew; $("empty-new").onclick = openNew;
$("new-close").onclick = () => { $("new-modal").hidden = true; };
$("new-modal").addEventListener("click", (e) => { if (e.target === $("new-modal")) $("new-modal").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("new-modal").hidden = true; });
$("search").oninput = render;
{ const q = new URLSearchParams(location.search).get("q"); if (q) $("search").value = q; } // `untangled README.md` opens the list filtered to that file
window.addEventListener("focus", load); // pick up files changed by Git or another editor
load();
