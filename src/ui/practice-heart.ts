import heartUrl from "./mechanical-heart.svg";
import "./practice-heart.css";

export function createPracticeHeart(toggle: () => void) {
  const button = document.createElement("button");
  button.id = "practice-heart"; button.type = "button";
  button.setAttribute("aria-label", "Practice heartbeat"); button.setAttribute("aria-pressed", "false");
  button.title = "Practice heartbeat";
  const image = document.createElement("img"); image.src = heartUrl; image.alt = "";
  image.width = image.height = 64;
  const label = document.createElement("span"); label.textContent = "Practice";
  button.append(image, label); button.addEventListener("click", toggle);
  document.querySelector("#polar-source-controls .button-row")!.append(button);
  return button;
}
