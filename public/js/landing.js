/* Landing page: swaps the "Start free / Log in" buttons for "Open my diagrams" when already logged in. */
import { api } from "/js/api.js";
api("/api/session").then(({ user }) => {
  if (!user) return;
  document.querySelectorAll("[data-out]").forEach((el) => { el.hidden = true; });
  document.querySelectorAll("[data-in]").forEach((el) => { el.hidden = false; });
}).catch(() => {});
