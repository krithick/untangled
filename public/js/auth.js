import { api, safeNext } from "/js/api.js";
const form = document.getElementById("auth-form");
const msg = document.getElementById("msg");
const mode = form.dataset.mode;
document.querySelectorAll("a[data-keep-next]").forEach((a) => {
  const n = new URLSearchParams(location.search).get("next");
  if (n) a.href += `?next=${encodeURIComponent(n)}`;
});
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = form.querySelector("button[type=submit]");
  const data = Object.fromEntries(new FormData(form));
  msg.className = "msg"; msg.textContent = "";
  btn.disabled = true;
  try {
    await api(`/api/auth/${mode}`, { method: "POST", body: data });
    location.href = safeNext();
  } catch (err) {
    msg.className = "msg err"; msg.textContent = err.message;
    btn.disabled = false;
  }
});
