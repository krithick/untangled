import { api, safeNext } from "/js/api.js";
const form = document.getElementById("auth-form");
const msg = document.getElementById("msg");
const mode = form.dataset.mode; // signup, login, forgot or reset
const token = new URLSearchParams(location.search).get("token") || "";
document.querySelectorAll("a[data-keep-next]").forEach((a) => {
  const n = new URLSearchParams(location.search).get("next");
  if (n) a.href += `?next=${encodeURIComponent(n)}`;
});
if (mode === "reset" && !token) {
  msg.className = "msg err"; msg.textContent = "This reset link is incomplete. Ask for a new one.";
  form.querySelector("button[type=submit]").disabled = true;
}
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = form.querySelector("button[type=submit]");
  const data = Object.fromEntries(new FormData(form));
  if (mode === "reset") data.token = token;
  msg.className = "msg"; msg.textContent = "";
  btn.disabled = true;
  try {
    await api(`/api/auth/${mode}`, { method: "POST", body: data });
    if (mode === "forgot") {
      msg.className = "msg ok";
      msg.textContent = "If that email has an account, a reset link is on its way. It works for 1 hour. Check your spam folder if you don't see it.";
      return;
    }
    location.href = mode === "reset" ? "/app" : safeNext();
  } catch (err) {
    msg.className = "msg err"; msg.textContent = err.message;
    btn.disabled = false;
  }
});
