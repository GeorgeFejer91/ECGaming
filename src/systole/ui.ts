import { layout, prepare } from "@chenglou/pretext";
import { flightAssetUrl } from "../game/aircraft";

const terms: [RegExp, string][] = [
  [/Ground Control/g, "Mission Control"], [/ground control/g, "mission control"],
  [/Control tower/g, "Mission control"], [/Remote tower/g, "Remote beacon"],
  [/Remote cockpit/g, "Remote navigator"], [/Flight settings/g, "Navigation settings"],
  [/Cockpit flight/gi, "SYSTOLE / NAVIGATOR"], [/REWARD POINTS/g, "PASSAGES"],
  [/Flight options/g, "Navigation options"], [/Start Cockpit Flight/g, "Begin passage"],
  [/Start flight/gi, "Begin passage"], [/runway clearance/gi, "departure clearance"],
  [/Runway/g, "Departure"], [/runway/g, "departure bay"],
  [/Aircraft/g, "Spacecraft"], [/aircraft/g, "spacecraft"], [/airplane/g, "spacecraft"],
  [/the plane/g, "the vessel"], [/plane altitude/g, "vessel altitude"],
  [/Wing ECG/g, "Vane ECG"], [/wing flex/g, "drive pulse"],
  [/animated propeller/gi, "pulse drive"], [/exhaust puffs/gi, "drive pulses"],
  [/Choose your cardiac spacecraft/g, "Choose your vessel"],
];
export const spaceCopy = (text: string) => terms.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);

const iconPaths = {
  heart: 'M12 22C9 18 4 15 5 9c.5-3 4-4 6-1l1-5 4 1-1 4c5-2 7 3 5 6-2 4-5 6-8 8ZM8 11l2 2 2-3 2 5 3-3',
  beacon: 'M12 11v11M8 22h8M8 8a6 6 0 0 1 8 0M4 4a12 12 0 0 1 16 0M9 13l3-3 3 3-3 3-3-3Z',
  vessel: 'm12 2 4 5-1 8-3 7-3-7-1-8 4-5ZM8 8 3 14l5 3m8-9 5 6-5 3M10 9l2-2 2 2-2 6-2-6Z',
  orbit: 'M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0M1 14l6-4 10 4 6-4M12 3v3m0 12v3',
};
const glyph = (name: keyof typeof iconPaths) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${iconPaths[name]}"/></svg>`;

/** Fit by reflow, never undo text enlargement. Measurements use the painted font. */
function installMeasurements(root: HTMLElement) {
  let pending = false;
  const measured = new WeakSet<HTMLElement>();
  const resize = new ResizeObserver(() => schedule());
  const flush = () => {
    pending = false;
    root.querySelectorAll<HTMLElement>("button span, button strong, summary, h1, h2, h3, .systole-caption, .systole-intro p, .flight-gate p, dialog p, .header-state, .instrument-header > strong").forEach(el => {
      if (!el.clientWidth || el.children.length || !el.textContent?.trim()) return;
      if (!measured.has(el)) { measured.add(el); resize.observe(el); }
      const style = getComputedStyle(el);
      const width = Math.max(1, el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const result = layout(prepare(el.textContent, font, { letterSpacing: parseFloat(style.letterSpacing) || 0 }), width, parseFloat(style.lineHeight) || parseFloat(style.fontSize)*1.4);
      const fits = result.height <= el.clientHeight+2 && el.scrollWidth <= el.clientWidth+2;
      // Once reflow provides room, keep it: clearing it because the wrapped
      // label now fits would reinstate the constraint and oscillate each frame.
      if (!fits) el.dataset.systoleMeasured = "reflow";
      else if (!el.dataset.systoleMeasured) el.dataset.systoleMeasured = "fit";
    });
  };
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(flush); } };
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  void document.fonts.ready.then(schedule);
  addEventListener("pagehide", () => { observer.disconnect(); resize.disconnect(); }, { once: true });
}

export function installSystoleUI() {
  document.body.classList.add("systole");
  const intro = document.createElement("section");
  intro.className = "systole-intro";
  intro.setAttribute("aria-labelledby", "systole-title");
  intro.innerHTML = '<div><p class="systole-kicker">A CARDIAC SPACE ODYSSEY</p><h1 id="systole-title">Systole<span>The Quiet Vessel</span></h1></div><p class="systole-caption">There is no wind here.<br>Only the rhythm you brought with you.</p>';
  document.querySelector("#ground-view")?.prepend(intro);
  const brand = document.querySelector<HTMLAnchorElement>(".unified-header .brand");
  if (brand) { brand.innerHTML = glyph("orbit")+'<span>EC GAMES <small>/ SYSTOLE</small></span>'; brand.href = "../../"; }
  const set = (selector: string, text: string) => { const el = document.querySelector(selector); if (el) el.textContent = text; };
  set("#ground-view-toggle strong", "Mission Control"); set("#cockpit-view-toggle strong", "Navigator");
  set("#flight-gate-title", "Departure");
  set(".aircraft-showcase-header > span", "VESSEL / ORGANIC CORE");
  set("#altitude-metric-title", "What moves you through the void");
  set(".altitude-metric-panel > p", "Choose the heart or breathing signal that raises and lowers your vessel.");
  set(".music-quick-copy strong", "The sound of the void");
  set(".music-quick-copy small", "An evolving score shaped by your signal.");
  set(".music-quick-variant > span", "Soundscape");
  set("#cockpit-runway-title", "The vessel awaits a pulse.");
  set("#cockpit-runway-copy", "Connect your Polar H10 in Mission Control, or choose the explicitly simulated Practice heartbeat. Your signal sets your height; steer toward the luminous passages.");
  const settings = document.createElement("dialog"); settings.className = "systole-settings";
  settings.setAttribute("aria-label", "Signal and navigation settings");
  const settingsTitle = document.createElement("h2"); settingsTitle.textContent = "Signal & navigation";
  const settingsClose = document.createElement("button"); settingsClose.type = "button"; settingsClose.textContent = "Return to observatory";
  settingsClose.addEventListener("click", () => settings.close());
  const internals = document.getElementById("ground-control-setup-internals")!;
  settings.append(settingsTitle, settingsClose); document.body.append(settings);
  const settingsButton = document.createElement("button"); settingsButton.type = "button"; settingsButton.className = "systole-settings-button";
  settingsButton.textContent = "Signal settings"; settingsButton.setAttribute("aria-haspopup", "dialog");
  settingsButton.addEventListener("click", () => { settings.append(internals); internals.hidden = false; internals.removeAttribute("aria-hidden"); settings.showModal(); });
  settings.addEventListener("close", () => { internals.hidden = true; internals.setAttribute("aria-hidden", "true"); settingsButton.focus(); });
  intro.append(settingsButton);
  const icons: [string, keyof typeof iconPaths][] = [
    [".tower-widget", "beacon"], [".cockpit-widget", "vessel"], ["#connect-remote-tower", "beacon"],
    ["#connect-remote-cockpit", "vessel"], ["#connect-polar", "heart"], ["[data-aircraft-choice]", "vessel"],
  ];
  for (const [selector, icon] of icons) document.querySelectorAll(selector).forEach(el => {
    const old = el.querySelector("svg"); if (old) old.outerHTML = glyph(icon);
  });
  document.querySelector(".aircraft-hangar-surround")?.remove();
  document.querySelectorAll<HTMLImageElement>(".metric-widget-button img, .scope-metric-badge img, #practice-heart img, .phone-tilt-button img").forEach(img => {
    const key = img.closest<HTMLElement>("[data-scope-metric]")?.dataset.scopeMetric;
    img.src = flightAssetUrl(`assets/systole/${key ?? (img.closest("#practice-heart") ? "practice" : img.closest(".phone-tilt-button") ? "steering" : "signal")}.svg`);
  });
  const credits = document.createElement("details"); credits.className = "systole-credits";
  credits.innerHTML = '<summary>Vessel archives & controls</summary><p>Pass through the luminous gates. A / D, arrow keys, drag, phone tilt or a gamepad steer sideways. Your selected cardiac or breathing signal sets height. Impact with a ruin ruptures the vessel; reassemble to begin again.</p><p>Practice heartbeat is simulated. Live ECG stays local. Connection loss holds the vessel until the signal recovers.</p><p>BodyParts3D, © The Database Center for Life Science licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC Attribution 4.0 International</a>. Converted by <a href="https://github.com/organui/heart-3d">OrganUI</a>; spacecraft materials and fragmentation are artistic adaptations. Anatomically sourced geometry; not a physiological simulation.</p><p><a href="../../assets/systole/anatomy-provenance.json">Asset manifest</a> · <a href="../../ground-control/">Play the original Polar Plane</a></p>';
  document.querySelector("#ground-view")?.append(credits);
  const translate = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE && !node.parentElement?.closest("script,style,canvas,.systole-credits")) {
      const next = spaceCopy(node.textContent ?? ""); if (next !== node.textContent) node.textContent = next;
    } else if (node instanceof HTMLElement || node instanceof SVGElement) {
      for (const attr of ["aria-label", "title", "placeholder"]) if (node.hasAttribute(attr)) {
        const next = spaceCopy(node.getAttribute(attr)!); if (next !== node.getAttribute(attr)) node.setAttribute(attr, next);
      }
      node.childNodes.forEach(translate);
    }
  };
  translate(document.body);
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData" || mutation.type === "attributes") translate(mutation.target);
      else mutation.addedNodes.forEach(translate);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "title", "placeholder"] });
  addEventListener("pagehide", () => observer.disconnect(), { once: true });
  installMeasurements(document.body);
}
