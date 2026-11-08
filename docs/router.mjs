const views = {
  nacional: { panel: document.getElementById("view-national"), load: () => import("./dashboard.js") },
  aeroportos: { panel: document.getElementById("view-air"), load: () => import("./aeroportos/aeroportos.js") },
};
const navigation = [...document.querySelectorAll("[data-view]")];

function showView() {
  const params = new URLSearchParams(location.search);
  const airLink = params.get("visao") === "aeroportos" || (!params.has("visao") && params.has("origem"));
  const name = airLink ? "aeroportos" : "nacional";
  for (const [key, view] of Object.entries(views)) view.panel.hidden = key !== name;
  for (const link of navigation) {
    if (link.dataset.view === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const view = views[name];
  if (!view.module) {
    view.module = view.load().catch((error) => {
      console.error(error);
      view.module = null;
      const warning = view.panel.querySelector("[role=alert]");
      warning.textContent = "Não foi possível carregar esta visão. Recarregue a página.";
      warning.hidden = false;
    });
  }
}

for (const link of navigation) {
  link.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (link.getAttribute("aria-current") === "page") return;
    const url = new URL(location.href);
    url.searchParams.set("visao", link.dataset.view);
    url.hash = "";
    history.pushState(null, "", url);
    showView();
    window.scrollTo(0, 0);
    views[link.dataset.view].panel.querySelector("h1").focus({ preventScroll: true });
  });
}
window.addEventListener("popstate", showView);
showView();
