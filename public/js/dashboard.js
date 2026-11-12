import { api, esc } from "/js/api.js";
const $ = (id) => document.getElementById(id);
const KIND = { er: "ER diagram", flow: "Flowchart", seq: "Sequence", sequenceDiagram: "Sequence", classDiagram: "Class", stateDiagram: "State", "stateDiagram-v2": "State", gantt: "Gantt", pie: "Pie chart", mindmap: "Mindmap", timeline: "Timeline", gitGraph: "Git graph", journey: "Journey", quadrantChart: "Quadrant" };
let diagrams = [], target = null;

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: s > 31536000 ? "numeric" : undefined });
}
function message(text, cls = "") { const m = $("dash-msg"); m.className = `msg ${cls}`; m.textContent = text; }

function render() {
  const q = $("search").value.trim().toLowerCase();
  const list = diagrams.filter((d) => d.title.toLowerCase().includes(q));
  $("count").textContent = `${diagrams.length} diagram${diagrams.length === 1 ? "" : "s"}`;
  $("empty").hidden = diagrams.length > 0;
  $("grid").hidden = diagrams.length === 0;
  $("grid").innerHTML = list.length ? list.map((d) => `
    <article class="card">
      <a class="open" href="/d/${d.id}" aria-label="Open ${esc(d.title)}"></a>
      <div class="thumb">${d.has_thumb ? `<img src="/api/diagrams/${d.id}/thumb?v=${d.updated_at}" alt="" loading="lazy">` : `<span class="ph">${esc(KIND[d.kind] || d.kind)}</span>`}</div>
      <div class="card-body">
        <div class="card-text"><b title="${esc(d.title)}">${esc(d.title)}</b><small>${esc(KIND[d.kind] || d.kind)} · ${ago(d.updated_at)}${d.shared ? ' <span class="badge">Shared</span>' : ""}</small></div>
        <div class="card-menu">
          <button class="dots" data-menu="${d.id}" aria-label="More actions for ${esc(d.title)}" aria-haspopup="true">⋯</button>
          <div class="menu" id="m-${d.id}" hidden role="menu">
            <button role="menuitem" data-act="open" data-id="${d.id}">Open</button>
            <button role="menuitem" data-act="rename" data-id="${d.id}">Rename</button>
            <button role="menuitem" data-act="duplicate" data-id="${d.id}">Duplicate</button>
            <button role="menuitem" class="danger" data-act="delete" data-id="${d.id}">Delete</button>
          </div>
        </div>
      </div>
    </article>`).join("") : `<p class="msg">No diagrams match "${esc(q)}".</p>`;
}

async function load() {
  try { diagrams = (await api("/api/diagrams")).diagrams; render(); }
  catch (e) { if (e.status === 401) location.href = "/login?next=/app"; else message(e.message, "err"); }
}

async function create(title, source) {
  const { diagram } = await api("/api/diagrams", { method: "POST", body: { title, source } });
  return diagram;
}
const titleFromFile = (name) => name.replace(/\.(mmd|mermaid|md|txt)$/i, "").replace(/[-_]+/g, " ").trim() || "Untitled diagram";
const extract = (text) => { const m = text.match(/```mermaid\s*\n([\s\S]*?)```/); return (m ? m[1] : text).trim(); };

async function uploadFiles(files) {
  const made = [];
  for (const f of files) {
    try { const text = extract(await f.text()); if (!text) throw new Error("The file is empty."); made.push(await create(titleFromFile(f.name), text)); }
    catch (e) { message(`${f.name}: ${e.message}`, "err"); }
  }
  if (made.length === 1) location.href = `/d/${made[0].id}`;
  else if (made.length > 1) { message(`Uploaded ${made.length} diagrams.`, "ok"); load(); }
}

/* new diagram dialog */
function openNew() {
  const T = window.UNTANGLE_TEMPLATES || [];
  $("tpls").innerHTML = T.map((t) => `<button class="tpl" data-tpl="${t.id}"><span class="k">${esc(t.kind)}</span><b>${esc(t.title)}</b><small>${esc(t.desc)}</small></button>`).join("");
  $("tpls").querySelectorAll("[data-tpl]").forEach((b) => b.onclick = async () => {
    const t = T.find((x) => x.id === b.dataset.tpl); b.disabled = true;
    try { const d = await create(t.title.startsWith("Blank") ? "Untitled diagram" : t.title, t.source); location.href = `/d/${d.id}`; }
    catch (e) { $("new-msg").className = "msg err"; $("new-msg").textContent = e.message; b.disabled = false; }
  });
  $("new-msg").textContent = ""; $("new-modal").hidden = false; $("tpls").querySelector("button")?.focus();
}
$("paste-go").onclick = async () => {
  const src = extract($("paste").value);
  if (!src) { $("new-msg").className = "msg err"; $("new-msg").textContent = "Paste some Mermaid code first."; return; }
  try { const d = await create("Untitled diagram", src); location.href = `/d/${d.id}`; }
  catch (e) { $("new-msg").className = "msg err"; $("new-msg").textContent = e.message; }
};

/* card actions */
document.addEventListener("click", (e) => {
  const menuBtn = e.target.closest("[data-menu]");
  document.querySelectorAll(".card .menu").forEach((m) => { if (!menuBtn || m.id !== `m-${menuBtn.dataset.menu}`) m.hidden = true; });
  if (menuBtn) { const m = $(`m-${menuBtn.dataset.menu}`); m.hidden = !m.hidden; if (!m.hidden) m.querySelector("button").focus(); return; }
  if (!e.target.closest(".user-menu")) { $("user-menu").hidden = true; $("user-btn").setAttribute("aria-expanded", "false"); }
  const act = e.target.closest("[data-act]");
  if (!act) return;
  target = diagrams.find((d) => d.id === act.dataset.id);
  if (!target) return;
  if (act.dataset.act === "open") location.href = `/d/${target.id}`;
  if (act.dataset.act === "rename") { $("rename-in").value = target.title; $("rename-modal").hidden = false; $("rename-in").select(); }
  if (act.dataset.act === "duplicate") api(`/api/diagrams/${target.id}/duplicate`, { method: "POST" }).then(() => { message("Duplicated.", "ok"); load(); }).catch((err) => message(err.message, "err"));
  if (act.dataset.act === "delete") { $("delete-text").textContent = `"${target.title}" and its version history will be deleted for good.${target.shared ? " Its share link will stop working." : ""}`; $("delete-modal").hidden = false; $("delete-close").focus(); }
});
$("rename-form").onsubmit = async (e) => {
  e.preventDefault();
  try { await api(`/api/diagrams/${target.id}`, { method: "PUT", body: { title: $("rename-in").value } }); $("rename-modal").hidden = true; load(); }
  catch (err) { message(err.message, "err"); }
};
$("delete-go").onclick = async () => {
  try { await api(`/api/diagrams/${target.id}`, { method: "DELETE" }); $("delete-modal").hidden = true; message(`Deleted "${target.title}".`, "ok"); load(); }
  catch (err) { message(err.message, "err"); }
};
["new", "rename", "delete"].forEach((k) => {
  $(`${k}-close`).onclick = () => { $(`${k}-modal`).hidden = true; };
  $(`${k}-modal`).addEventListener("click", (e) => { if (e.target === $(`${k}-modal`)) $(`${k}-modal`).hidden = true; });
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal").forEach((m) => { m.hidden = true; }); });

$("new-btn").onclick = openNew; $("empty-new").onclick = openNew;
$("upload-btn").onclick = () => $("file").click(); $("empty-upload").onclick = () => $("file").click();
$("file").onchange = (e) => { const files = [...e.target.files]; e.target.value = ""; uploadFiles(files); };
$("search").oninput = render;
document.addEventListener("dragover", (e) => { e.preventDefault(); });
document.addEventListener("drop", (e) => { e.preventDefault(); const files = [...(e.dataTransfer?.files || [])]; if (files.length) uploadFiles(files); });

/* user menu */
$("user-btn").onclick = (e) => { e.stopPropagation(); const m = $("user-menu"); m.hidden = !m.hidden; $("user-btn").setAttribute("aria-expanded", String(!m.hidden)); };
$("go-account").onclick = () => { location.href = "/account"; };
$("logout").onclick = async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.href = "/"; };
api("/api/me").then(({ user }) => { $("user-name").textContent = user.name; }).catch(() => {});

load();
