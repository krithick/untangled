import { api } from "/js/api.js";
const $ = (id) => document.getElementById(id);
const say = (id, text, ok) => { $(id).className = `msg ${ok ? "ok" : "err"}`; $(id).textContent = text; };
api("/api/me").then(({ user }) => { $("name").value = user.name; $("email").textContent = user.email; })
  .catch((e) => { if (e.status === 401) location.href = "/login?next=/account"; });
$("name-form").onsubmit = async (e) => {
  e.preventDefault();
  try { await api("/api/me", { method: "PATCH", body: { name: $("name").value } }); say("name-msg", "Saved.", true); }
  catch (err) { say("name-msg", err.message); }
};
$("pw-form").onsubmit = async (e) => {
  e.preventDefault();
  try { await api("/api/me/password", { method: "POST", body: { current: $("current").value, next: $("next").value } }); e.target.reset(); say("pw-msg", "Password changed. Other devices have been logged out.", true); }
  catch (err) { say("pw-msg", err.message); }
};
$("del-form").onsubmit = async (e) => {
  e.preventDefault();
  try { await api("/api/me", { method: "DELETE", body: { password: $("del-pw").value } }); location.href = "/"; }
  catch (err) { say("del-msg", err.message); }
};
$("logout").onclick = async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.href = "/"; };
