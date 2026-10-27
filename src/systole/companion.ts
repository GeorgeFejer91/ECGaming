import { isSystole } from "./theme";
import "./companion.css";

if (isSystole()) {
  document.documentElement.dataset.gameTheme = "systole";
  document.body.classList.add("systole-companion");
  document.title = "Systole · Remote navigation";
  const translate = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE && !node.parentElement?.closest("script,style,input")) {
      const value = (node.textContent ?? "").replace(/Ground Control/g,"Mission Control").replace(/Aircraft/g,"Vessel").replace(/Start flight/g,"Begin passage").replace(/Flight yoke/g,"Navigation helm").replace(/Airplane steering yoke/g,"Spacecraft navigation helm");
      if (value !== node.textContent) node.textContent = value;
    } else node.childNodes.forEach(translate);
  };
  translate(document.body);
  const observer = new MutationObserver(records => records.forEach(record => {
    if (record.type === "characterData") translate(record.target);
    else record.addedNodes.forEach(translate);
  }));
  observer.observe(document.body, { subtree:true, childList:true, characterData:true });
  addEventListener("pagehide", () => observer.disconnect(), {once:true});
}
