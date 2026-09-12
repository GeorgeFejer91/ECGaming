import iconUrl from "./phone-tilt.svg";
/** Shared artwork and label for the dedicated controller widget and in-flight action. */
export function decoratePhoneButton(button: HTMLButtonElement, widget = false) {
  button.className = widget ? "phone-tilt-button phone-tilt-widget" : "phone-tilt-button";
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  const icon = document.createElement("img"); icon.src = iconUrl; icon.alt = ""; icon.width = 64; icon.height = 48;
  const copy = document.createElement("span"); copy.className = "phone-tilt-button-copy";
  const label = document.createElement("strong"); label.textContent = "Connect phone controller";
  const status = document.createElement("span"); status.textContent = "Scan QR · tilt to fly";
  copy.append(label, status); button.replaceChildren(icon, copy);
  return status;
}
