/** Presentation only: signal ownership and readiness remain in the shared runtime. */
export const isSystole = () => typeof document !== "undefined" && (document.documentElement.dataset.gameTheme === "systole" || new URLSearchParams(location.search).get("game") === "systole");

export function companionUrl(route: "controller" | "session-cockpit" | "flight", pageUrl: string) {
  const page = new URL(pageUrl);
  const nested = /\/games\/systole(?:\/index\.html|\/)?$/.test(page.pathname);
  const space = nested || page.searchParams.get("game") === "systole";
  if (nested) page.pathname = page.pathname.replace(/\/games\/systole(?:\/index\.html|\/)?$/, "/");
  const url = new URL(`${nested ? "./" : "../"}${route}/`, page);
  url.search = "";
  url.hash = "";
  if (space) url.searchParams.set("game", "systole");
  return url;
}
