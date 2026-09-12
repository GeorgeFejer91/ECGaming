import type { EcgGameModule } from "../game/ecg-game-module";

export function installFlightSteering(host: HTMLElement, game: EcgGameModule) {
  const controls = document.createElement("div");
  controls.className = "remote-pilot-steering";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Plane steering");
  const held = new Map<number | string, number>();
  const buttons: HTMLButtonElement[] = [];
  const update = () => {
    game.setSteering(Math.max(-1, Math.min(1, [...held.values()].reduce((a, b) => a + b, 0))));
    buttons.forEach((button, i) => button.setAttribute("aria-pressed", String([...held.values()].includes(i ? 1 : -1))));
  };
  const clear = () => { held.clear(); update(); };
  for (const axis of [-1, 1]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = axis < 0 ? "←" : "→";
    button.setAttribute("aria-label", axis < 0 ? "Steer left" : "Steer right");
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("pointerdown", event => {
      event.preventDefault(); held.set(event.pointerId, axis); update();
      button.setPointerCapture(event.pointerId);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(type, event => { held.delete((event as PointerEvent).pointerId); update(); });
    button.addEventListener("keydown", event => {
      if (![" ", "Enter"].includes(event.key)) return;
      event.preventDefault(); held.set(`key${axis}`, axis); update();
    });
    button.addEventListener("keyup", event => {
      if (![" ", "Enter"].includes(event.key)) return;
      event.preventDefault(); held.delete(`key${axis}`); update();
    });
    button.addEventListener("blur", clear);
    buttons.push(button); controls.append(button);
  }
  const changed = () => {
    const state = game.snapshot();
    controls.hidden = !state.running || state.paused || state.crashed;
    if (controls.hidden) clear();
  };
  const visibility = () => { if (document.hidden) clear(); };
  host.append(controls);
  changed();
  game.addEventListener("state", changed);
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    clear(); controls.remove(); game.removeEventListener("state", changed);
    window.removeEventListener("blur", clear);
    document.removeEventListener("visibilitychange", visibility);
  };
}
